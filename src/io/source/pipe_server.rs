use core::cell::{Cell, RefCell};
use core::time::Duration;
use std::collections::VecDeque;
use std::os::windows::io::OwnedHandle;
use std::rc::{Rc, Weak};
use std::time::Instant;

use bun_core::WStr;
use bun_iocp::{AsyncFile, Handle, Port, Request};
use bun_ptr::OptionCellExt as _;
use bun_sys::windows::{self as w, NT_ERROR, NTSTATUS, Win32Error, named_pipe};
use bun_sys::windows_format::wide;
use bun_sys::{self as sys, E, Tag};

use super::Pipe;

const PREFIX: &[u16] = bun_core::w!("\\\\.\\pipe\\");

/// As the system reads it, with a NUL at its end.
fn wide_name(name: &[u8], tag: Tag) -> sys::Result<Vec<u16>> {
    let mut wide = vec![0; name.len() + 1];
    let wide = wide::encode(name, &mut wide).map_err(|_| sys::Error::from_code(E::EINVAL, tag))?;
    match w::full_path(wide) {
        Ok(mut path) if path.starts_with(PREFIX) => {
            path.push(0);
            Ok(path)
        }
        _ => Err(sys::Error::from_code(E::EACCES, tag)),
    }
}

/// Accepts connections until it is dropped. It does not keep the loop running.
pub struct PipeServer {
    _server: Rc<Server>,
}

struct Server {
    port: Rc<Port>,
    name: Vec<u16>,
    on_connection: Rc<dyn Fn(Pipe)>,
    /// One for each instance that a client can connect to.
    accepts: [Cell<Option<Request>>; 4],
}

enum Previous {
    None,
    Connected(Rc<AsyncFile>),
    Broken { _file: Rc<AsyncFile> },
}

impl PipeServer {
    pub fn listen(
        port: &Rc<Port>,
        name: &[u8],
        on_connection: impl Fn(Pipe) + 'static,
    ) -> sys::Result<PipeServer> {
        let name = wide_name(name, Tag::listen)?;
        let first = named_pipe::create_instance(WStr::from_slice_with_nul(&name), true);
        let first = first.map_err(|err| match err {
            Win32Error::ACCESS_DENIED => sys::Error::from_code(E::EADDRINUSE, Tag::listen),
            Win32Error::PATH_NOT_FOUND | Win32Error::INVALID_NAME => {
                sys::Error::from_code(E::EACCES, Tag::listen)
            }
            err => sys::Error::from_win32(err, Tag::listen),
        })?;
        let server = Rc::new(Server {
            port: Rc::clone(port),
            name,
            on_connection: Rc::new(on_connection),
            accepts: Default::default(),
        });
        server.accept_with(0, first);
        for index in 1..server.accepts.len() {
            Rc::clone(&server).replace(index, Previous::None);
        }
        Ok(PipeServer { _server: server })
    }
}

impl Server {
    fn replace(self: Rc<Self>, index: usize, previous: Previous) {
        let name = WStr::from_slice_with_nul(&self.name);
        let Ok(instance) = named_pipe::create_instance(name, false) else {
            return self.replace_later(index, previous);
        };
        self.accept_with(index, instance);
        if let Previous::Connected(file) = previous {
            let on_connection = Rc::clone(&self.on_connection);
            drop(self);
            on_connection(Pipe::exclusive(file));
        }
    }

    fn replace_later(self: &Rc<Self>, index: usize, previous: Previous) {
        let this = Rc::downgrade(self);
        let retry = Request::delay(&self.port, Duration::from_millis(100), move || {
            if let Some(this) = this.upgrade() {
                this.replace(index, previous);
            }
        });
        self.accepts[index].set(Some(retry));
    }

    fn accept_with(self: &Rc<Self>, index: usize, instance: OwnedHandle) {
        let handle = Handle::from_owned(instance);
        let file = Rc::new(AsyncFile::exclusive(&self.port, handle));
        let done = || {
            let (this, file) = (Rc::downgrade(self), Rc::clone(&file));
            move |status| {
                if let Some(this) = this.upgrade() {
                    this.on_accept(index, file, status);
                }
            }
        };
        let on_listen = done();
        let request = match file.listen(move |completion| on_listen(completion.status)) {
            Ok(request) => request,
            Err(refused) => {
                let on_refused = done();
                Request::defer(&self.port, move || on_refused(refused.status))
            }
        };
        self.accepts[index].set(Some(request));
    }

    fn on_accept(self: Rc<Self>, index: usize, file: Rc<AsyncFile>, status: NTSTATUS) {
        // What a client has written before it left can still be read.
        if !NT_ERROR(status) || matches!(status, NTSTATUS::PIPE_CONNECTED | NTSTATUS::PIPE_CLOSING)
        {
            self.replace(index, Previous::Connected(file));
        } else {
            self.replace_later(index, Previous::Broken { _file: file });
        }
    }
}

type Connected = Result<OwnedHandle, Win32Error>;

/// Dropping it gives the attempt up, and the callback does not run.
pub struct PipeConnect {
    _result: Option<Request>,
    _place: Option<Rc<Place>>,
}

struct Place {
    done: Cell<Option<Box<dyn FnOnce(Connected)>>>,
    _line: Rc<Line>,
}

/// The clients of a pipe whose instances are all busy. The system would wake them all for each instance.
struct Line {
    name: Vec<u16>,
    root: AsyncFile,
    places: RefCell<VecDeque<Weak<Place>>>,
    wait: Cell<Option<Request>>,
    moved_at: Cell<Instant>,
}

thread_local! {
    static LINES: RefCell<Vec<Weak<Line>>> = const { RefCell::new(Vec::new()) };
}

impl PipeConnect {
    pub fn start(
        port: &Rc<Port>,
        name: &[u8],
        done: impl FnOnce(sys::Result<Pipe>) + 'static,
    ) -> sys::Result<PipeConnect> {
        let name = wide_name(name, Tag::connect2)?;
        let its_port = Rc::clone(port);
        let done = move |result: Connected| {
            let pipe = result.map(|handle| Pipe::from_exclusive(&its_port, handle));
            done(pipe.map_err(|err| sys::Error::from_win32(err, Tag::connect)));
        };
        let line = match Line::find(port, &name) {
            Some(line) => Ok(line),
            None => match named_pipe::connect(WStr::from_slice_with_nul(&name)) {
                Err(Win32Error::PIPE_BUSY) => Line::new(port, name).map_err(Err),
                result => Err(result),
            },
        };
        Ok(match line {
            Ok(line) => PipeConnect {
                _result: None,
                _place: Some(line.join(Box::new(done))),
            },
            Err(result) => PipeConnect {
                _result: Some(Request::defer(port, move || done(result))),
                _place: None,
            },
        })
    }
}

impl Line {
    const PATIENCE: Duration = Duration::from_secs(30);

    fn find(port: &Rc<Port>, name: &[u16]) -> Option<Rc<Line>> {
        LINES.with_borrow_mut(|lines| {
            lines.retain(|line| line.strong_count() > 0);
            (lines.iter().filter_map(Weak::upgrade)).find(|line| {
                line.wait.is_some() && line.name == name && Rc::ptr_eq(line.root.port(), port)
            })
        })
    }

    fn new(port: &Rc<Port>, name: Vec<u16>) -> Result<Rc<Line>, Win32Error> {
        let root = w::open_pipe_file_system(w::PipeMode::Overlapped)?;
        let line = Rc::new(Line {
            name,
            root: AsyncFile::exclusive(port, Handle::from_owned(root)),
            places: RefCell::default(),
            wait: Cell::new(None),
            moved_at: Cell::new(Instant::now()),
        });
        LINES.with_borrow_mut(|lines| lines.push(Rc::downgrade(&line)));
        line.wait_for_instance();
        Ok(line)
    }

    fn join(self: Rc<Self>, done: Box<dyn FnOnce(Connected)>) -> Rc<Place> {
        let place = Rc::new(Place {
            done: Cell::new(Some(done)),
            _line: Rc::clone(&self),
        });
        self.places.borrow_mut().push_back(Rc::downgrade(&place));
        place
    }

    /// The callback of the request in `wait`.
    fn then_serve(self: &Rc<Self>) -> impl FnOnce(NTSTATUS) + 'static {
        let this = Rc::downgrade(self);
        move |status| {
            if let Some(this) = this.upgrade() {
                this.serve(status);
            }
        }
    }

    fn wait_for_instance(self: &Rc<Self>) {
        let name = &self.name[PREFIX.len()..self.name.len() - 1];
        let request = named_pipe::wait_request(name, Self::PATIENCE.as_millis() as u32);
        let serve = self.then_serve();
        match (self.root).wait_for_instance(request, |ended| serve(ended.status)) {
            Ok(wait) => self.wait.set(Some(wait)),
            Err(_) => self.try_later(),
        }
    }

    /// For a name that only `CreateFileW` understands.
    fn try_later(self: &Rc<Self>) {
        let serve = self.then_serve();
        let serve = move || serve(NTSTATUS::PENDING);
        let retry = Request::delay(self.root.port(), Duration::from_millis(10), serve);
        self.wait.set(Some(retry));
    }

    /// Whoever comes meanwhile joins the line, because `wait` is still set, and is served in a later turn.
    fn serve(self: Rc<Self>, waited: NTSTATUS) {
        if waited == NTSTATUS::SUCCESS {
            self.moved_at.set(Instant::now());
        }
        let count = self.places.borrow().len();
        for _ in 0..count {
            let first = self.places.borrow().front().and_then(Weak::upgrade);
            let result = first.as_ref().map(|_| self.connect());
            if let Some(Err(Win32Error::PIPE_BUSY)) = result {
                break;
            }
            self.places.borrow_mut().pop_front();
            if let (Some(done), Some(result)) = (first.and_then(|it| it.done.take()), result) {
                done(result);
            }
        }
        match waited {
            _ if self.places.borrow().is_empty() => self.wait.set(None),
            NTSTATUS::SUCCESS | NTSTATUS::IO_TIMEOUT => self.wait_for_instance(),
            _ => self.try_later(),
        }
    }

    fn connect(&self) -> Connected {
        match named_pipe::connect(WStr::from_slice_with_nul(&self.name)) {
            Err(Win32Error::PIPE_BUSY) if self.moved_at.get().elapsed() >= Self::PATIENCE => {
                Err(Win32Error::SEM_TIMEOUT)
            }
            Ok(handle) => {
                self.moved_at.set(Instant::now());
                Ok(handle)
            }
            result => result,
        }
    }
}
