//! A read or write on the work pool that waits on the IO thread while its descriptor is not ready.

use bun_io::fd_wait::{FdWait, Interest, JobFd};
use bun_jsc::job::JsAffine;
use bun_jsc::node_path::{JoinedPath, PathLike};
use bun_jsc::{Completion, Job, JobContext, JsResult, JsThread, SystemError};
use bun_sys::{E, Fd, File, O};
use bun_threading::{IntrusiveWorkTask as _, WorkPoolTask};

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

pub(crate) struct FdJob<Op: FdOp> {
    op: Op,
    result: Result<(), Box<SystemError>>,
    wait: FdWait,
    done: Option<Completion<Self>>,
}

impl<Op: FdOp> JobContext for FdJob<Op> {
    const CANCELLABLE: bool = true;
    type OffThread = Self;
    type Js = Op::Js;

    fn run(this: &mut Self, done: Completion<Self>) -> Option<Completion<Self>> {
        this.done = Some(done);
        let opened = this.op.open();
        this.advance(opened);
        None
    }

    fn then(this: Self, js: Op::Js, _: &JsThread<'_>) -> JsResult<()> {
        this.op.then(this.result, js)
    }

    unsafe fn cancel(this: *mut Self) {
        // SAFETY: fn contract.
        unsafe { FdWait::cancel(&raw mut (*this).wait) }
    }
}

impl<Op: FdOp> FdJob<Op> {
    #[track_caller]
    pub(crate) fn schedule(op: Op, js: Op::Js, cx: &JsThread<'_>) {
        let job = Self {
            op,
            result: Ok(()),
            wait: FdWait::new(Op::INTEREST, Self::resume),
            done: None,
        };
        Job::<Self>::schedule(cx, job, js);
    }

    unsafe fn resume(task: *mut WorkPoolTask) {
        // SAFETY: the task of the `wait` that `step_until_parked` parked: the job is back.
        unsafe {
            let this = bun_core::from_field_ptr!(Self, wait, FdWait::from_task_ptr(task));
            let stepped = (*this).wait.unpark().map_err(Into::into).and_then(|fd| {
                let step = (*this).op.step(fd.get(), true)?;
                Ok((fd, step))
            });
            (*this).advance(stepped);
        }
    }

    /// The job is another thread's when this returns.
    fn advance(&mut self, stepped: Result<(JobFd, Step), Box<SystemError>>) {
        self.result = match stepped.and_then(|(fd, step)| self.step_until_parked(fd, step)) {
            Ok(true) => return,
            Ok(false) => Ok(()),
            Err(err) => Err(err),
        };
        if let Some(done) = self.done.take() {
            done.finish();
        }
    }

    /// `false`: done.
    fn step_until_parked(&mut self, fd: JobFd, mut step: Step) -> Result<bool, Box<SystemError>> {
        loop {
            match step {
                Step::Done => return Ok(false),
                Step::Again => {
                    self.wait.check_cancelled()?;
                    step = self.op.step(fd.get(), false)?;
                }
                Step::Wait => {
                    // SAFETY: this thread has the boxed job, and every frame returns without touching it.
                    unsafe { FdWait::park(&raw mut self.wait, fd)? };
                    return Ok(true);
                }
            }
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
        PathOrFileDescriptor::Fd(fd) => return Ok(JobFd::borrowed(*fd)),
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
