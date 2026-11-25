use core::cell::{Cell, RefCell};
use core::time::Duration;
use std::collections::VecDeque;
use std::os::windows::io::OwnedHandle;
use std::rc::{Rc, Weak};
use std::time::Instant;

use bun_core::WStr;
use bun_core::env_var::BUN_DEBUG_TEST_PIPE_CONNECT_TIMEOUT_MS;
use bun_iocp::{Handle, OverlappedFile, Port, Request};
use bun_ptr::OptionCellExt as _;
use bun_sys::windows::{self as w, NT_ERROR, NTSTATUS, Win32Error, named_pipe};
use bun_sys::windows_format::wtf16;
use bun_sys::{self as sys, E, Tag};

use super::Pipe;

const PIPE_PREFIX: &[u16] = bun_core::w!("\\\\.\\pipe\\");

/// Bounds the connections accepted in one loop iteration.
const LISTENING_INSTANCE_COUNT: usize = 16;

/// Returns the NUL-terminated full path.
fn resolve_pipe_path(name: &[u8], tag: Tag) -> sys::Result<Vec<u16>> {
    let mut buffer = vec![0; name.len() + 1];
    let wide_name =
        wtf16::encode(name, &mut buffer).map_err(|_| sys::Error::from_code(E::EINVAL, tag))?;
    match w::get_full_path_name(wide_name) {
        Ok(mut path) if path.starts_with(PIPE_PREFIX) => {
            path.push(0);
            Ok(path)
        }
        _ => Err(sys::Error::from_code(E::EACCES, tag)),
    }
}

/// Accepts connections until dropped. Does not keep the loop alive.
pub struct PipeServer {
    _server: Rc<Server>,
}

struct Server {
    port: Rc<Port>,
    path: Vec<u16>,
    on_connection: Rc<dyn Fn(Pipe)>,
    accept_requests: [Cell<Option<Request>>; LISTENING_INSTANCE_COUNT],
}

enum PreviousInstance {
    None,
    Connected(Rc<OverlappedFile>),
    Broken { _file: Rc<OverlappedFile> },
}

impl PipeServer {
    pub fn listen(
        port: &Rc<Port>,
        name: &[u8],
        on_connection: impl Fn(Pipe) + 'static,
    ) -> sys::Result<PipeServer> {
        let path = resolve_pipe_path(name, Tag::listen)?;
        let first_instance = named_pipe::create_instance(WStr::from_slice_with_nul(&path), true);
        let first_instance = first_instance.map_err(|err| match err {
            Win32Error::ACCESS_DENIED => sys::Error::from_code(E::EADDRINUSE, Tag::listen),
            Win32Error::PATH_NOT_FOUND | Win32Error::INVALID_NAME => {
                sys::Error::from_code(E::EACCES, Tag::listen)
            }
            err => sys::Error::from_win32(err, Tag::listen),
        })?;
        let server = Rc::new(Server {
            port: Rc::clone(port),
            path,
            on_connection: Rc::new(on_connection),
            accept_requests: Default::default(),
        });
        server.start_accept(0, first_instance);
        for index in 1..server.accept_requests.len() {
            Rc::clone(&server).replace_instance(index, PreviousInstance::None);
        }
        Ok(PipeServer { _server: server })
    }
}

impl Server {
    fn replace_instance(self: Rc<Self>, index: usize, previous: PreviousInstance) {
        let path = WStr::from_slice_with_nul(&self.path);
        let Ok(instance) = named_pipe::create_instance(path, false) else {
            return self.schedule_replace_instance(index, previous);
        };
        self.start_accept(index, instance);
        if let PreviousInstance::Connected(file) = previous {
            let on_connection = Rc::clone(&self.on_connection);
            drop(self);
            on_connection(Pipe::from_exclusive_file(file, usize::MAX));
        }
    }

    fn schedule_replace_instance(self: &Rc<Self>, index: usize, previous: PreviousInstance) {
        const RETRY_INTERVAL: Duration = Duration::from_millis(100);
        let this = Rc::downgrade(self);
        let request = Request::delay(&self.port, RETRY_INTERVAL, move || {
            if let Some(this) = this.upgrade() {
                this.replace_instance(index, previous);
            }
        });
        self.accept_requests[index].set(Some(request));
    }

    fn start_accept(self: &Rc<Self>, index: usize, instance: OwnedHandle) {
        let handle = Handle::from_owned(instance);
        let file = Rc::new(OverlappedFile::new_exclusive(&self.port, handle));
        let make_callback = || {
            let this = Rc::downgrade(self);
            let file = Rc::clone(&file);
            move |status| {
                if let Some(this) = this.upgrade() {
                    this.on_accept(index, file, status);
                }
            }
        };
        let on_listen = make_callback();
        let request = match file.listen(move |completion| on_listen(completion.status)) {
            Ok(request) => request,
            Err(completion) => {
                let on_listen_error = make_callback();
                Request::defer(&self.port, move || on_listen_error(completion.status))
            }
        };
        self.accept_requests[index].set(Some(request));
    }

    fn on_accept(self: Rc<Self>, index: usize, file: Rc<OverlappedFile>, status: NTSTATUS) {
        // `PIPE_CLOSING`: the client is gone, but the data it wrote is still readable.
        if !NT_ERROR(status) || matches!(status, NTSTATUS::PIPE_CONNECTED | NTSTATUS::PIPE_CLOSING)
        {
            self.replace_instance(index, PreviousInstance::Connected(file));
        } else {
            self.schedule_replace_instance(index, PreviousInstance::Broken { _file: file });
        }
    }
}

/// Dropping it cancels the attempt without running the callback.
pub struct PipeConnect {
    _deferred_result: Option<Request>,
    _waiter: Option<Rc<ConnectWaiter>>,
}

struct ConnectWaiter {
    on_connect: Cell<Option<Box<dyn FnOnce(Result<OwnedHandle, Win32Error>)>>>,
    deferred_result: Cell<Option<Request>>,
    enqueue_time: Instant,
    _queue: Rc<ConnectQueue>,
}

/// Clients of a pipe whose instances are all busy. They share one wait, because each free instance wakes every waiter.
struct ConnectQueue {
    path: Vec<u16>,
    npfs_root: OverlappedFile,
    waiters: RefCell<VecDeque<Weak<ConnectWaiter>>>,
    inflight_wait: Cell<Option<Request>>,
    last_progress: Cell<Instant>,
}

thread_local! {
    static CONNECT_QUEUES: RefCell<Vec<Weak<ConnectQueue>>> = const { RefCell::new(Vec::new()) };
}

impl PipeConnect {
    pub fn start(
        port: &Rc<Port>,
        name: &[u8],
        on_connect: impl FnOnce(sys::Result<Pipe>) + 'static,
    ) -> sys::Result<PipeConnect> {
        let path = resolve_pipe_path(name, Tag::connect2)?;
        let pipe_port = Rc::clone(port);
        let on_connect = move |result: Result<OwnedHandle, Win32Error>| {
            let pipe = result.map(|handle| Pipe::new_client(&pipe_port, handle));
            on_connect(pipe.map_err(|err| sys::Error::from_win32(err, Tag::connect)));
        };
        let queue = match ConnectQueue::find(port, &path) {
            Some(queue) => Ok(queue),
            None => match named_pipe::connect(WStr::from_slice_with_nul(&path)) {
                Err(Win32Error::PIPE_BUSY) => ConnectQueue::new(port, path).map_err(Err),
                result => Err(result),
            },
        };
        Ok(match queue {
            Ok(queue) => PipeConnect {
                _deferred_result: None,
                _waiter: Some(queue.enqueue(Box::new(on_connect))),
            },
            Err(result) => PipeConnect {
                _deferred_result: Some(Request::defer(port, move || on_connect(result))),
                _waiter: None,
            },
        })
    }
}

fn connect_timeout() -> Duration {
    Duration::from_millis(BUN_DEBUG_TEST_PIPE_CONNECT_TIMEOUT_MS.get().unwrap())
}

impl ConnectQueue {
    fn find(port: &Rc<Port>, path: &[u16]) -> Option<Rc<ConnectQueue>> {
        CONNECT_QUEUES.with_borrow_mut(|queues| {
            queues.retain(|queue| queue.strong_count() > 0);
            queues.iter().filter_map(Weak::upgrade).find(|queue| {
                queue.inflight_wait.is_some()
                    && queue.path == path
                    && Rc::ptr_eq(queue.npfs_root.port(), port)
            })
        })
    }

    fn new(port: &Rc<Port>, path: Vec<u16>) -> Result<Rc<ConnectQueue>, Win32Error> {
        let npfs_root = w::open_pipe_file_system(w::PipeMode::Overlapped)?;
        let queue = Rc::new(ConnectQueue {
            path,
            npfs_root: OverlappedFile::new_exclusive(port, Handle::from_owned(npfs_root)),
            waiters: RefCell::default(),
            inflight_wait: Cell::new(None),
            last_progress: Cell::new(Instant::now()),
        });
        CONNECT_QUEUES.with_borrow_mut(|queues| queues.push(Rc::downgrade(&queue)));
        queue.wait_for_instance();
        Ok(queue)
    }

    fn enqueue(
        self: Rc<Self>,
        on_connect: Box<dyn FnOnce(Result<OwnedHandle, Win32Error>)>,
    ) -> Rc<ConnectWaiter> {
        let waiter = Rc::new(ConnectWaiter {
            on_connect: Cell::new(Some(on_connect)),
            deferred_result: Cell::new(None),
            enqueue_time: Instant::now(),
            _queue: Rc::clone(&self),
        });
        self.waiters.borrow_mut().push_back(Rc::downgrade(&waiter));
        waiter
    }

    fn make_wait_callback(self: &Rc<Self>) -> impl FnOnce(NTSTATUS) + 'static {
        let this = Rc::downgrade(self);
        move |status| {
            if let Some(this) = this.upgrade() {
                this.on_wait_complete(status);
            }
        }
    }

    /// Progress restarts the timeout of every waiter.
    fn remaining_timeout(&self, waiter: &ConnectWaiter) -> Duration {
        let start = waiter.enqueue_time.max(self.last_progress.get());
        connect_timeout().saturating_sub(start.elapsed())
    }

    fn wait_for_instance(self: &Rc<Self>) {
        let name = &self.path[PIPE_PREFIX.len()..self.path.len() - 1];
        let oldest_waiter = self.waiters.borrow().iter().find_map(Weak::upgrade);
        let timeout =
            oldest_waiter.map_or_else(connect_timeout, |waiter| self.remaining_timeout(&waiter));
        let wait_buffer = named_pipe::build_wait_request(name, timeout);
        let callback = self.make_wait_callback();
        match self
            .npfs_root
            .wait_for_instance(wait_buffer, |completion| callback(completion.status))
        {
            Ok(request) => self.inflight_wait.set(Some(request)),
            Err(_) => self.schedule_retry(),
        }
    }

    /// Paces the attempts after a failed wait: some names can only be resolved by `CreateFileW`.
    fn schedule_retry(self: &Rc<Self>) {
        const RETRY_INTERVAL: Duration = Duration::from_millis(10);
        let callback = self.make_wait_callback();
        let on_timer = move || callback(NTSTATUS::PENDING);
        let request = Request::delay(self.npfs_root.port(), RETRY_INTERVAL, on_timer);
        self.inflight_wait.set(Some(request));
    }

    fn on_wait_complete(self: Rc<Self>, status: NTSTATUS) {
        if status == NTSTATUS::SUCCESS {
            self.last_progress.set(Instant::now());
        }
        let mut waiters = self.waiters.borrow_mut();
        while let Some(waiter) = waiters.front() {
            if let Some(waiter) = waiter.upgrade() {
                let result = self.connect(&waiter);
                if matches!(result, Err(Win32Error::PIPE_BUSY)) {
                    break;
                }
                // Deferred, so that the next wait has started when the callback runs.
                waiter
                    .deferred_result
                    .set(waiter.on_connect.take().map(|on_connect| {
                        Request::defer(self.npfs_root.port(), move || on_connect(result))
                    }));
            }
            waiters.pop_front();
        }
        drop(waiters);
        if self.waiters.borrow().is_empty() {
            self.inflight_wait.set(None);
        } else if matches!(
            status,
            NTSTATUS::SUCCESS | NTSTATUS::IO_TIMEOUT | NTSTATUS::PENDING
        ) {
            self.wait_for_instance();
        } else {
            self.schedule_retry();
        }
    }

    fn connect(&self, waiter: &ConnectWaiter) -> Result<OwnedHandle, Win32Error> {
        match named_pipe::connect(WStr::from_slice_with_nul(&self.path)) {
            Err(Win32Error::PIPE_BUSY) if self.remaining_timeout(waiter).is_zero() => {
                Err(Win32Error::SEM_TIMEOUT)
            }
            Ok(handle) => {
                self.last_progress.set(Instant::now());
                Ok(handle)
            }
            result => result,
        }
    }
}
