//! A read or write on the work pool that leaves it while its descriptor is not ready.

use bun_io::fd_wait::{Canceller, FdWait, Interest, JobFd, Key};
use bun_jsc::job::{JsAffine, OwnedJob, Running};
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

pub(crate) struct FdJob<Op> {
    op: Op,
    key: Key,
}

impl<Op: FdOp> OwnedJob for FdJob<Op> {
    type OffThread = Self;
    type Js = (Op::Js, Canceller);
    type Outcome = Result<(), Box<SystemError>>;
    const CANCELLABLE: bool = true;
    const OUTLIVES_SCRIPT: bool = false;

    fn run(mut job: Running<Self>) {
        let Self { op, key } = job.off();
        match op.open() {
            Ok((fd, step)) => {
                let wait = FdWait::new(*key, Op::INTEREST, fd);
                Self::advance(job, wait, Ok(step))
            }
            Err(err) => job.finish(Err(err)),
        }
    }

    fn unrun() -> Self::Outcome {
        Err(Op::INTEREST.cancelled().into())
    }

    fn then(this: Self, outcome: Self::Outcome, js: Self::Js, _: &JsThread<'_>) -> JsResult<()> {
        this.op.then(outcome, js.0)
    }

    fn cancel((_, canceller): &mut Self::Js) {
        canceller.cancel();
    }
}

impl<Op: FdOp> FdJob<Op> {
    #[track_caller]
    pub(crate) fn schedule(op: Op, js: Op::Js, cx: &JsThread<'_>) {
        let (key, canceller) = Key::next();
        Job::<Self>::schedule(cx, Self { op, key }, (js, canceller));
    }

    fn advance(mut job: Running<Self>, wait: FdWait, mut step: Result<Step, Box<SystemError>>) {
        let outcome = loop {
            step = match step {
                Ok(Step::Done) => break Ok(()),
                Ok(Step::Wait) => return wait.park(|woken| Self::resume(job, woken)),
                Ok(Step::Again) => match wait.check_cancelled() {
                    Ok(()) => job.off().op.step(wait.fd(), false),
                    Err(err) => break Err(err.into()),
                },
                Err(err) => break Err(err),
            };
        };
        drop(wait);
        job.finish(outcome);
    }

    fn resume(mut job: Running<Self>, woken: bun_sys::Result<FdWait>) {
        match woken {
            Ok(wait) => {
                let step = job.off().op.step(wait.fd(), true);
                Self::advance(job, wait, step)
            }
            Err(err) => job.finish(Err(err.into())),
        }
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
    let mut buf = bun_paths::path_buffer_pool::get();
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
