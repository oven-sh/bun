//! A read or write on the work pool that waits on the IO thread while its descriptor is not ready.

use bun_io::fd_wait::{FdWait, Interest, JobFd};
use bun_jsc::job::JsAffine;
use bun_jsc::{Completion, Job, JobContext, JsResult, JsThread, SystemError};
use bun_sys::{E, Fd, File, O};
use bun_threading::{IntrusiveWorkTask as _, WorkPoolTask};

use crate::node::fs as node_fs;
use crate::node::types::PathLikeExt as _;
use crate::webcore::blob::{creating_parents, sys_error_with_path_like};
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

    /// Pool thread, once.
    fn open(&mut self) -> Result<JobFd, Box<SystemError>>;
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
        let fd = this.op.open();
        this.advance(fd, false);
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
            let fd = (*this).wait.unpark().map_err(Into::into);
            (*this).advance(fd, true);
        }
    }

    /// The job is another thread's when this returns.
    fn advance(&mut self, fd: Result<JobFd, Box<SystemError>>, ready: bool) {
        self.result = match fd.and_then(|fd| self.step_until_parked(fd, ready)) {
            Ok(true) => return,
            Ok(false) => Ok(()),
            Err(err) => Err(err),
        };
        self.done.take().expect("finished once").finish();
    }

    /// `false`: done.
    fn step_until_parked(&mut self, fd: JobFd, mut ready: bool) -> Result<bool, Box<SystemError>> {
        loop {
            match self.op.step(fd.get(), core::mem::take(&mut ready))? {
                Step::Done => return Ok(false),
                Step::Again => self.wait.check_cancelled()?,
                Step::Wait => {
                    // SAFETY: this thread has the boxed job, and every frame returns without touching it.
                    unsafe { FdWait::park(&raw mut self.wait, fd)? };
                    return Ok(true);
                }
            }
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
        // A compiled program shows the path that it tried when mkdir failed, not the one that was written.
        if mkdirp && err.get_errno() == E::ENOENT {
            return err.with_path(path.slice()).into();
        }
        sys_error_with_path_like(&err, file).into()
    })
}
