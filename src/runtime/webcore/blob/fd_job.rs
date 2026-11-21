//! A read or write on the work pool that leaves it while its descriptor is not ready.

use bun_core::from_field_ptr;
use bun_io::{self as io, IoRequestLoop};
use bun_jsc::job::JsAffine;
use bun_jsc::node_path::{JoinedPath, PathLike};
use bun_jsc::{Completion, Job, JobContext, JsResult, JsThread, SystemError};
use bun_sys::{E, Fd, FdExt as _, File, O};
use bun_threading::{WorkPool, WorkPoolTask};

use crate::node::fs as node_fs;
use crate::node::types::PathLikeExt as _;
use crate::webcore::blob::io_parking::IoParking;
use crate::webcore::blob::{Store, creating_parents, sys_error_with_path_like};
use crate::webcore::node_types::PathOrFileDescriptor;

#[derive(Clone, Copy)]
pub(crate) enum Interest {
    Readable,
    Writable,
}

impl Interest {
    #[cold]
    fn cancelled(self) -> bun_sys::Error {
        let syscall = match self {
            Interest::Readable => bun_sys::Tag::read,
            Interest::Writable => bun_sys::Tag::write,
        };
        bun_sys::Error::from_code(E::ECANCELED, syscall)
    }
}

/// What a job reads or writes.
pub(crate) enum JobFd {
    Borrowed(Fd),
    Opened(Fd),
}

impl JobFd {
    pub(crate) fn get(&self) -> Fd {
        let (Self::Borrowed(fd) | Self::Opened(fd)) = *self;
        fd
    }
}

impl Drop for JobFd {
    fn drop(&mut self) {
        if let Self::Opened(fd) = *self {
            let _ = fd.close_allowing_bad_file_descriptor(None);
        }
    }
}

pub(crate) enum Step {
    Done,
    /// Call again when the descriptor is ready.
    Wait,
}

pub(crate) trait FdOp: Send + Sized + 'static {
    const INTEREST: Interest;
    /// `crate::dispatch` finds the type of the job by it.
    const IO_TAG: io::Tag;
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
    /// From `run` to `finish`.
    open: Option<(JobFd, Completion<Self>)>,
    task: WorkPoolTask,
    pub(crate) io_poll: io::Poll,
    io_request: io::Request,
    io_parking: IoParking,
}

impl<Op: FdOp> JobContext for FdJob<Op> {
    const CANCELLABLE: bool = true;
    type OffThread = Self;
    type Js = Op::Js;

    fn run(this: &mut Self, done: Completion<Self>) -> Option<Completion<Self>> {
        match this.op.open() {
            Ok((fd, step)) => {
                this.open = Some((fd, done));
                this.advance(Ok(step));
                None
            }
            Err(err) => {
                this.result = Err(err);
                Some(done)
            }
        }
    }

    fn then(this: Self, js: Op::Js, _: &JsThread<'_>) -> JsResult<()> {
        this.op.then(this.result, js)
    }

    unsafe fn cancel(this: *mut Self) {
        // SAFETY: fn contract; `io_parking` is atomic, and a `true` means no
        // other thread touches `io_request` until it is queued again here.
        unsafe {
            if (*this).io_parking.cancel() {
                IoRequestLoop::schedule(&mut (*this).io_request);
            }
        }
    }
}

impl<Op: FdOp> FdJob<Op> {
    #[track_caller]
    pub(crate) fn schedule(op: Op, js: Op::Js, cx: &JsThread<'_>) {
        let job = Self {
            op,
            result: Ok(()),
            open: None,
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::resume,
            },
            io_poll: io::Poll::default(),
            io_request: io::Request::new(Self::watch),
            io_parking: IoParking::new(),
        };
        Job::<Self>::schedule(cx, job, js);
    }

    fn fd(&self) -> Fd {
        self.open.as_ref().map_or(Fd::INVALID, |(fd, _)| fd.get())
    }

    /// Pool thread. The job is another thread's when this returns.
    fn advance(&mut self, step: Result<Step, Box<SystemError>>) {
        self.result = match step {
            Ok(Step::Done) => Ok(()),
            Ok(Step::Wait) => match self.park() {
                Ok(()) => return,
                Err(err) => Err(err.into()),
            },
            Err(err) => Err(err),
        };
        self.finish();
    }

    fn park(&mut self) -> bun_sys::Result<()> {
        IoRequestLoop::ensure_init()?;
        if !self.io_parking.park() {
            return Err(Op::INTEREST.cancelled());
        }
        IoRequestLoop::schedule(&mut self.io_request);
        Ok(())
    }

    fn finish(&mut self) {
        if let Some((fd, done)) = self.open.take() {
            #[cfg(any(target_os = "linux", target_os = "android"))]
            self.io_poll.unregister(fd.get());
            drop(fd);
            done.finish();
        }
    }

    /// IO thread.
    fn watch(request: &mut io::Request) -> io::Action<'_> {
        // SAFETY: the field of a job that was queued for this thread.
        let this = unsafe { &mut *from_field_ptr!(Self, io_request, &raw mut *request) };
        if !this.io_parking.arm() {
            this.result = Err(Op::INTEREST.cancelled().into());
            return this.close_action();
        }
        let action = io::FileAction {
            // SAFETY: the `ctx` below.
            on_error: |ctx, err| unsafe { (*ctx.cast::<Self>()).on_io_error(err) },
            ctx: (&raw mut *this).cast(),
            fd: this.fd(),
            poll: &mut this.io_poll,
            tag: Op::IO_TAG,
        };
        match Op::INTEREST {
            Interest::Readable => io::Action::Readable(action),
            Interest::Writable => io::Action::Writable(action),
        }
    }

    fn close_action(&mut self) -> io::Action<'_> {
        io::Action::Close(io::CloseAction {
            // SAFETY: the `ctx` below.
            on_done: |ctx| unsafe { (*ctx.cast::<Self>()).on_unwatched() },
            ctx: (&raw mut *self).cast(),
            fd: self.fd(),
            poll: &mut self.io_poll,
            tag: Op::IO_TAG,
        })
    }

    /// IO thread.
    pub(crate) fn on_ready(&mut self) {
        if self.io_parking.fire() {
            self.give_to_pool(Self::resume);
        }
    }

    /// IO thread.
    pub(crate) fn on_io_error(&mut self, err: &bun_sys::Error) {
        if self.io_parking.fire() {
            self.result = Err(err.clone().into());
            self.give_to_pool(Self::resume);
        }
    }

    /// IO thread.
    fn on_unwatched(&mut self) {
        // SAFETY: as `resume`.
        self.give_to_pool(|task| unsafe { (*from_field_ptr!(Self, task, task)).finish() });
    }

    fn give_to_pool(&mut self, callback: unsafe fn(*mut WorkPoolTask)) {
        self.task.callback = callback;
        WorkPool::schedule(&raw mut self.task);
    }

    unsafe fn resume(task: *mut WorkPoolTask) {
        // SAFETY: the field of a job that the IO thread gave back.
        let this = unsafe { &mut *from_field_ptr!(Self, task, task) };
        let woken = core::mem::replace(&mut this.result, Ok(()));
        let fd = this.fd();
        let step = woken.and_then(|()| this.op.step(fd, true));
        this.advance(step);
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
    let opened = opened.map(|file| JobFd::Opened(file.into_raw()));
    opened.map_err(|err| {
        // mkdir failed: a compiled program reports the resolved path, not the one in the script.
        if mkdirp && err.get_errno() == E::ENOENT {
            return err.with_path(path.slice()).into();
        }
        sys_error_with_path_like(&err, file).into()
    })
}
