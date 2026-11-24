//! A read or write on the work pool that leaves it while its descriptor is not ready.

use bun_io::fd_wait::{FdWait, Interest, JobFd, LazyPoller, Parking, Waiter};
use bun_jsc::job::{JsAffine, OwnedJob, Running, Suspended};
use bun_jsc::node_path::{JoinedPath, PathLike};
use bun_jsc::{Job, JsResult, JsThread, SystemError};
use bun_sys::{E, Fd, File, O};

use crate::node::fs as node_fs;
use crate::node::types::PathLikeExt as _;
use crate::webcore::blob::{Store, creating_parents, sys_error_with_path_like};
use crate::webcore::node_types::PathOrFileDescriptor;

pub(crate) enum Step {
    Done,
    /// Call again when the descriptor is ready.
    Wait,
    /// Call again now, unless the job was cancelled.
    Again,
}

pub(crate) trait FdOp: Send + Sized + 'static {
    const INTEREST: Interest;
    type Js: JsAffine;

    /// Pool thread, once. Takes the first step too.
    fn open(&mut self) -> Result<(JobFd, Step), Box<SystemError>>;
    /// Pool thread. `ready`: the wait has just ended.
    fn step(&mut self, fd: Fd, ready: bool) -> Result<Step, Box<SystemError>>;
    /// JS thread.
    fn then(self, result: Result<(), Box<SystemError>>, js: Self::Js) -> JsResult<()>;
}

/// The wait, and how it ended.
type Woken = (FdWait, Result<(), Box<SystemError>>);

pub(crate) struct Parked(Suspended<Parking<Parked>, Woken>);

// SAFETY: a job has one handle, is on the heap, and `with` borrows another field than `shared`.
unsafe impl Waiter for Parked {
    fn parking(&self) -> &Parking<Self> {
        self.0.shared()
    }

    fn wait(&mut self) -> &mut FdWait {
        &mut self.0.with().0
    }

    fn wake(mut self, outcome: bun_sys::Result<()>) {
        self.0.with().1 = outcome.map_err(Into::into);
        self.0.resume();
    }
}

static POLLER: LazyPoller<Parked> = LazyPoller::new();

pub(crate) struct FdJob<Op> {
    op: Op,
    result: Result<(), Box<SystemError>>,
}

impl<Op: FdOp> OwnedJob for FdJob<Op> {
    type OffThread = Self;
    type Js = Op::Js;
    type Shared = Parking<Parked>;
    type Resume = Woken;
    const OUTLIVES_SCRIPT: bool = false;

    fn run(mut job: Running<Self>) {
        match job.off().op.open() {
            Ok((fd, step)) => Self::advance(job, FdWait::new(Op::INTEREST, fd), Ok(step)),
            Err(err) => Self::finish(job, Err(err)),
        }
    }

    fn resume(mut job: Running<Self>, (wait, woken): Woken) {
        let step = woken.and_then(|()| job.off().op.step(wait.fd(), true));
        Self::advance(job, wait, step)
    }

    fn then(this: Self, js: Op::Js, _: &JsThread<'_>) -> JsResult<()> {
        this.op.then(this.result, js)
    }
}

impl<Op: FdOp> FdJob<Op> {
    #[track_caller]
    pub(crate) fn schedule(op: Op, js: Op::Js, cx: &JsThread<'_>) {
        Job::<Self>::schedule(cx, Self { op, result: Ok(()) }, js);
    }

    fn advance(mut job: Running<Self>, wait: FdWait, mut step: Result<Step, Box<SystemError>>) {
        let result = loop {
            step = match step {
                Ok(Step::Done) => break Ok(()),
                Ok(Step::Wait) => match POLLER.admit(job.shared(), &wait) {
                    Ok(poller) => return poller.park(Parked(job.suspend((wait, Ok(()))))),
                    Err(err) => break Err(err.into()),
                },
                Ok(Step::Again) => match job.shared().check_cancelled(&wait) {
                    Ok(()) => job.off().op.step(wait.fd(), false),
                    Err(err) => break Err(err.into()),
                },
                Err(err) => break Err(err),
            };
        };
        drop(wait);
        Self::finish(job, result);
    }

    fn finish(mut job: Running<Self>, result: Result<(), Box<SystemError>>) {
        job.off().result = result;
        job.finish();
    }
}

/// What a job opens. A copy, so that no borrow of the store is held across `Store::data_mut`.
pub(super) enum Target {
    Fd(Fd),
    Path(Box<[u8]>),
    Joined(Box<JoinedPath>),
}

impl Target {
    pub(super) fn of(store: &Store) -> Self {
        match &store.data.as_file().pathlike {
            PathOrFileDescriptor::Fd(fd) => Self::Fd(*fd),
            PathOrFileDescriptor::Path(PathLike::Joined(path)) => Self::Joined(path.clone()),
            PathOrFileDescriptor::Path(path) => Self::Path(path.slice().into()),
        }
    }

    pub(super) fn get(&self) -> PathOrFileDescriptor<'_> {
        match self {
            Self::Fd(fd) => PathOrFileDescriptor::Fd(*fd),
            Self::Path(path) => PathOrFileDescriptor::Path(PathLike::borrowed(path)),
            Self::Joined(path) => PathOrFileDescriptor::Path(PathLike::Joined(path.clone())),
        }
    }
}

pub(super) fn open(
    file: &PathOrFileDescriptor<'_>,
    flags: i32,
    mut mkdirp: bool,
) -> Result<JobFd, Box<SystemError>> {
    let path = match file {
        PathOrFileDescriptor::Fd(fd) => return Ok(JobFd::Borrowed(*fd)),
        PathOrFileDescriptor::Path(path) => path,
    };
    let mut buf = bun_paths::Path::new();
    let path_z = path.slice_z(&mut buf);
    let flags = flags | O::NONBLOCK | O::CLOEXEC;
    let opened = creating_parents(&mut mkdirp, path_z.as_bytes(), || {
        File::open(path_z, flags, node_fs::DEFAULT_PERMISSION)
    });
    opened.map(JobFd::opened).map_err(|err| {
        // mkdir failed: a compiled program reports the resolved path, not the one in the script.
        if mkdirp && err.get_errno() == E::ENOENT {
            return err.with_path(path.slice()).into();
        }
        sys_error_with_path_like(&err, file).into()
    })
}
