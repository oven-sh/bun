use core::cell::Cell;
use core::ffi::c_int;

use bun_core::ZStr;
use bun_sys::windows::libuv as uv;
// `to_error` on `ReturnCode`/`ReturnCodeI64` lives in `bun_sys` (layering).
use bun_sys::Fd;
use bun_sys::ReturnCodeExt as _;
use bun_threading::Guarded;

use crate::posix_event_loop::__bun_run_io;
use crate::{IoEvent, Owner};

bun_core::declare_scope!(PipeSource, hidden);

pub enum Source {
    Pipe(OwnedPipe),
    Tty(OpenTty),
    File(OpenFile),
    SyncFile(OpenFile),
}

/// Who hears of what libuv completes on a stream.
pub struct StreamOwner(Cell<Owner>);

impl StreamOwner {
    fn null() -> Self {
        Self(Cell::new(Owner::NULL))
    }

    fn dispatch(&self, event: IoEvent) {
        let owner = self.0.get();
        if !owner.ptr().is_null() {
            // SAFETY: `set_owner`'s contract. Only the callbacks of the stream get here.
            unsafe { __bun_run_io(owner, event) };
        }
    }
}

type Stream<H> = uv::Handle<H, StreamOwner>;

fn dispatch_on_vm_teardown<H: uv::UvStream>(stream: &Stream<H>) {
    stream.on_vm_teardown(|stream| stream.data.dispatch(IoEvent::VmTeardown));
}

fn read_start<H: uv::UvStream>(stream: &Stream<H>) -> uv::ReturnCode {
    stream.read_start(|stream, nread| {
        bun_sys::syslog!("onStreamRead({:p}) = {}", stream, nread.int());
        stream.data.dispatch(IoEvent::StreamRead(nread));
    })
}

fn write<H: uv::UvStream>(
    stream: &Stream<H>,
    bytes: Vec<u8>,
    start: usize,
) -> uv::StartResult<Vec<u8>> {
    stream.write(bytes, start, |stream, bytes, status| {
        stream.data.dispatch(IoEvent::StreamWrite(bytes, status));
    })
}

pub struct OwnedPipe(uv::Owned<uv::Pipe, StreamOwner>);

impl OwnedPipe {
    fn from_result(
        pipe: Result<uv::Owned<uv::Pipe, StreamOwner>, uv::ReturnCode>,
        tag: bun_sys::Tag,
    ) -> bun_sys::Result<Self> {
        let pipe = pipe.map_err(|rc| bun_sys::Error::from_uv(rc, tag))?;
        dispatch_on_vm_teardown(&pipe);
        Ok(Self(pipe))
    }

    pub fn init(loop_: &uv::Loop, ipc: bool) -> bun_sys::Result<Self> {
        let pipe = uv::Pipe::init(loop_, ipc, StreamOwner::null());
        Self::from_result(pipe, bun_sys::Tag::uv_pipe)
    }

    /// The pipe owns `fd` on `Ok`.
    pub fn open(loop_: &uv::Loop, ipc: bool, fd: Fd) -> bun_sys::Result<Self> {
        let pipe = uv::Pipe::open(loop_, ipc, fd.uv(), StreamOwner::null());
        Self::from_result(pipe, bun_sys::Tag::open)
    }

    pub fn connect(loop_: &uv::Loop, name: &ZStr) -> bun_sys::Result<Self> {
        let pipe = uv::Pipe::connect(loop_, name, StreamOwner::null(), |pipe, status| {
            pipe.data.dispatch(IoEvent::Connect(status));
        });
        Self::from_result(pipe, bun_sys::Tag::connect2)
    }

    pub fn accept<D>(server: &uv::Handle<uv::ListeningPipe, D>) -> bun_sys::Result<Self> {
        Self::from_result(server.accept(StreamOwner::null()), bun_sys::Tag::accept)
    }

    /// # Safety
    /// `owner.ptr` points to a live value of the type `__bun_run_io` casts `owner.tag` to, until `self`
    /// is dropped or has another owner.
    pub unsafe fn set_owner(&self, owner: Owner) {
        self.data.0.set(owner);
    }

    pub fn read_start(&self) -> uv::ReturnCode {
        read_start(self)
    }

    pub fn write(&self, bytes: Vec<u8>, start: usize) -> uv::StartResult<Vec<u8>> {
        write(self, bytes, start)
    }

    /// The event has no bytes.
    pub fn queue_write<T: 'static>(
        &self,
        req: Box<uv::WriteRequest<T>>,
        bytes: impl FnOnce(&T) -> &[u8],
    ) -> uv::ReturnCode {
        self.0.queue_write(req, bytes, |pipe, status| {
            pipe.data.dispatch(IoEvent::StreamWrite(Vec::new(), status));
        })
    }
}

impl core::ops::Deref for OwnedPipe {
    type Target = Stream<uv::Pipe>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

pub enum OpenTty {
    Owned(uv::Owned<uv::uv_tty_t, StreamOwner>),
    /// Stays open until the loop of its first user closes.
    Stdin(&'static Stream<uv::uv_tty_t>),
}

impl OpenTty {
    fn init(loop_: &uv::Loop, fd: Fd) -> bun_sys::Result<uv::Owned<uv::uv_tty_t, StreamOwner>> {
        bun_core::scoped_log!(PipeSource, "openTTY (fd = {})", fd);
        uv::uv_tty_t::init(loop_, fd.uv(), StreamOwner::null())
            .map_err(|rc| bun_sys::Error::from_uv(rc, bun_sys::Tag::open))
    }

    fn open(loop_: &uv::Loop, fd: Fd) -> bun_sys::Result<OpenTty> {
        let tty = Self::init(loop_, fd)?;
        dispatch_on_vm_teardown(&tty);
        Ok(OpenTty::Owned(tty))
    }

    /// One for the process, because libuv keeps the state of a line read in globals.
    ///
    /// # Safety
    /// While the result lives, no other thread uses the tty or runs the loop that it is on.
    unsafe fn stdin(loop_: &uv::Loop) -> bun_sys::Result<OpenTty> {
        struct StdinTty(&'static Stream<uv::uv_tty_t>);
        // SAFETY: fn contract.
        unsafe impl Send for StdinTty {}
        static STDIN: Guarded<Option<StdinTty>> = Guarded::new(None);
        let mut stdin = STDIN.lock();
        let tty = match &*stdin {
            Some(tty) => tty,
            None => stdin.insert(StdinTty(Self::init(loop_, Fd::stdin())?.leak())),
        };
        Ok(OpenTty::Stdin(tty.0))
    }

    /// Does nothing if another reader has taken over the one for stdin.
    pub(crate) fn stop_reading_for(&self, owner: Owner) {
        if self.data.0.get() == owner {
            self.read_stop();
            self.data.0.set(Owner::NULL);
        }
    }
}

impl core::ops::Deref for OpenTty {
    type Target = Stream<uv::uv_tty_t>;
    fn deref(&self) -> &Self::Target {
        match self {
            OpenTty::Owned(tty) => tty,
            OpenTty::Stdin(tty) => tty,
        }
    }
}

pub struct OpenFile(uv::OwnedFile<Owner>);

impl OpenFile {
    fn dispatch(owner: Owner, event: IoEvent) {
        assert!(!owner.ptr().is_null(), "the file has no owner");
        // SAFETY: `Source::set_owner`'s contract. Only the callbacks of the file get here.
        unsafe { __bun_run_io(owner, event) };
    }

    pub(crate) fn dispatch_on_vm_teardown(&self) {
        self.0
            .on_vm_teardown(|owner| Self::dispatch(owner, IoEvent::VmTeardown));
    }

    pub(crate) fn is_busy(&self) -> bool {
        self.0.is_busy()
    }

    pub(crate) fn set_close_on_drop(&self, value: bool) {
        self.0.set_close_on_drop(value);
    }

    pub(crate) fn stop(&self) {
        self.0.cancel();
    }

    /// Reads at most `max_len` bytes into the spare capacity of `buffer`.
    pub(crate) fn read(
        &self,
        buffer: Vec<u8>,
        max_len: usize,
        offset: Option<usize>,
    ) -> uv::StartResult<Vec<u8>> {
        self.0
            .read(buffer, max_len, offset, |owner, buffer, result| {
                bun_sys::syslog!("onFileRead() = {}", result.int());
                Self::dispatch(owner, IoEvent::FileRead(buffer, result));
            })
    }
}

impl Source {
    pub(crate) fn file(&self) -> Option<&OpenFile> {
        match self {
            Source::SyncFile(file) | Source::File(file) => Some(file),
            Source::Pipe(_) | Source::Tty(_) => None,
        }
    }

    pub fn is_closed(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.is_closed(),
            Source::Tty(tty) => tty.is_closed(),
            Source::SyncFile(file) | Source::File(file) => file.0.file() == -1,
        }
    }

    pub(crate) fn get_fd(&self) -> Fd {
        match self {
            // `Handle::fd()` returns the raw `uv_os_fd_t` (a HANDLE on
            // Windows); tag kind=system so callers can round-trip through
            // `Fd::native()`.
            Source::Pipe(pipe) => Fd::from_system(pipe.fd()),
            Source::Tty(tty) => Fd::from_system(tty.fd()),
            Source::SyncFile(file) | Source::File(file) => Fd::from_uv(file.0.file()),
        }
    }

    /// # Safety
    /// `owner.ptr` points to a live value of the type `__bun_run_io` casts `owner.tag` to, until `self`
    /// is dropped or has another owner. The tty for stdin needs `stop_reading_for(owner)` first.
    pub(crate) unsafe fn set_owner(&self, owner: Owner) {
        match self {
            Source::Pipe(pipe) => pipe.data.0.set(owner),
            Source::Tty(tty) => tty.data.0.set(owner),
            Source::SyncFile(file) | Source::File(file) => file.0.data().set(owner),
        }
    }

    pub(crate) fn set_max_read_len(&self, len: usize) {
        match self {
            Source::Pipe(pipe) => pipe.set_max_read_len(len),
            Source::Tty(tty) => tty.set_max_read_len(len),
            Source::SyncFile(_) | Source::File(_) => {}
        }
    }

    pub(crate) fn read_start(&self) -> uv::ReturnCode {
        match self {
            Source::Pipe(pipe) => read_start(pipe),
            Source::Tty(tty) => read_start(tty),
            Source::SyncFile(_) | Source::File(_) => unreachable!(),
        }
    }

    pub(crate) fn read_stop(&self) {
        match self {
            Source::Pipe(pipe) => pipe.read_stop(),
            Source::Tty(tty) => tty.read_stop(),
            Source::SyncFile(file) | Source::File(file) => file.stop(),
        }
    }

    pub(crate) fn write(&self, bytes: Vec<u8>, start: usize) -> uv::StartResult<Vec<u8>> {
        match self {
            Source::Pipe(pipe) => write(pipe, bytes, start),
            Source::Tty(tty) => write(tty, bytes, start),
            Source::File(file) => file.0.write(bytes, start, |owner, bytes, result| {
                OpenFile::dispatch(owner, IoEvent::FileWrite(bytes, result));
            }),
            Source::SyncFile(_) => panic!("sync_file pipe write should not be reachable"),
        }
    }

    /// `false` if it is not a stream that can block.
    pub(crate) fn set_blocking(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.set_blocking() == uv::ReturnCode::ZERO,
            Source::Tty(tty) => tty.set_blocking() == uv::ReturnCode::ZERO,
            Source::SyncFile(_) | Source::File(_) => false,
        }
    }

    pub(crate) fn ref_(&self) {
        match self {
            Source::Pipe(pipe) => pipe.ref_(),
            Source::Tty(tty) => tty.ref_(),
            Source::SyncFile(_) | Source::File(_) => {}
        }
    }

    pub(crate) fn unref(&self) {
        match self {
            Source::Pipe(pipe) => pipe.unref(),
            Source::Tty(tty) => tty.unref(),
            Source::SyncFile(_) | Source::File(_) => {}
        }
    }

    /// The pipe owns `fd` on `Ok`.
    pub fn open_pipe(loop_: &uv::Loop, fd: Fd) -> bun_sys::Result<OwnedPipe> {
        bun_core::scoped_log!(PipeSource, "openPipe (fd = {})", fd);
        // we should never init using IPC here
        OwnedPipe::open(loop_, false, fd)
    }

    pub fn open_file(loop_: &'static bun_uws_sys::Loop, fd: Fd) -> OpenFile {
        debug_assert!(fd.is_valid() && fd.uv() != -1);
        bun_core::scoped_log!(PipeSource, "openFile (fd = {})", fd);
        OpenFile(uv::OwnedFile::new(loop_.uv_loop(), fd.uv(), Owner::NULL))
    }

    pub(crate) fn open(loop_: &'static bun_uws_sys::Loop, fd: Fd) -> bun_sys::Result<Source> {
        Self::open_as(loop_, fd, uv::uv_guess_handle(fd.uv()))
    }

    /// libuv keeps the mode in the handle, so the readers of stdin share a tty.
    pub(crate) fn open_for_reading(
        loop_: &'static bun_uws_sys::Loop,
        fd: Fd,
    ) -> bun_sys::Result<Source> {
        match uv::uv_guess_handle(fd.uv()) {
            uv::HandleType::Tty if fd.uv() == 0 => {
                // SAFETY: not enforced. It holds unless a `Worker` and another thread both use stdin.
                unsafe { OpenTty::stdin(loop_.uv_loop()) }.map(Source::Tty)
            }
            rc => Self::open_as(loop_, fd, rc),
        }
    }

    fn open_as(
        loop_: &'static bun_uws_sys::Loop,
        fd: Fd,
        rc: uv::HandleType,
    ) -> bun_sys::Result<Source> {
        bun_core::scoped_log!(
            PipeSource,
            "open(fd: {}, type: {})",
            fd,
            <&'static str>::from(rc)
        );

        match rc {
            uv::HandleType::NamedPipe => match Self::open_pipe(loop_.uv_loop(), fd) {
                bun_sys::Result::Ok(pipe) => bun_sys::Result::Ok(Source::Pipe(pipe)),
                bun_sys::Result::Err(err) => bun_sys::Result::Err(err),
            },
            uv::HandleType::Tty => OpenTty::open(loop_.uv_loop(), fd).map(Source::Tty),
            uv::HandleType::File => bun_sys::Result::Ok(Source::File(Self::open_file(loop_, fd))),
            _ => {
                let err = bun_sys::windows::Win32Error::get();
                if err == bun_sys::windows::Win32Error::SUCCESS {
                    return bun_sys::Result::Ok(Source::File(Self::open_file(loop_, fd)));
                }
                bun_sys::Result::Err(bun_sys::Error::from_win32(err, bun_sys::Tag::open))
            }
        }
    }

    pub(crate) fn set_raw_mode(&self, value: bool) -> bun_sys::Result<()> {
        match self {
            Source::Tty(tty) => tty
                .set_mode(if value {
                    uv::TtyMode::Raw
                } else {
                    uv::TtyMode::Normal
                })
                .to_result(bun_sys::Tag::uv_tty_set_mode),
            _ => bun_sys::Result::Err(bun_sys::Error {
                errno: bun_sys::E::NOTSUP as _,
                syscall: bun_sys::Tag::uv_tty_set_mode,
                fd: self.get_fd(),
                ..Default::default()
            }),
        }
    }
}

/// The uv loop is taken as a parameter (reading it from the VM directly would
/// be a T6 dependency); the C++ caller
/// (`ProcessBindingTTYWrap.cpp`) supplies `defaultGlobalObject()->uvLoop()`.
#[unsafe(no_mangle)]
extern "C" fn Source__setRawModeStdin(uv_loop: &uv::Loop, raw: bool) -> c_int {
    // SAFETY: as in `Source::open_for_reading`.
    let tty = match unsafe { OpenTty::stdin(uv_loop) } {
        bun_sys::Result::Ok(tty) => tty,
        bun_sys::Result::Err(e) => return e.errno as c_int,
    };
    // UV_TTY_MODE_RAW_VT is a variant of UV_TTY_MODE_RAW that enables control
    // sequence processing on the TTY implementer side, rather than having libuv
    // translate keypress events into control sequences, aligning behavior more
    // closely with POSIX platforms. This is also required to support some
    // control sequences at all on Windows, such as bracketed paste mode. The
    // Node.js readline implementation handles differences between these modes.
    let mode = if raw {
        uv::TtyMode::Vt
    } else {
        uv::TtyMode::Normal
    };
    tty.set_mode(mode).errno().map_or(0, |err| err as c_int)
}
