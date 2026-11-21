//! Who is told of I/O: a tag and a pointer, so that this crate does not name the types.

use crate::max_buf::Kind;

/// Closed set of [`Owner`] kinds, which `bun_runtime::dispatch::__bun_run_io` matches on.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum PollTag {
    Null = 0,
    FileSink,
    SubprocessStdinWriter,
    ShellStdinWriter,
    SecurityScanWriter,
    #[cfg(not(windows))]
    DnsResolver,
    #[cfg(target_os = "macos")]
    GetAddrInfoRequest,
    #[cfg(not(windows))]
    Process,
    ShellIoWriter,
    TerminalWriter,
    #[cfg(windows)]
    WindowsNamedPipe,
    #[cfg(windows)]
    IpcChannel,
    #[cfg(windows)]
    TestParallelChannel,
    #[cfg(windows)]
    ChromePipes,
    #[cfg(target_os = "macos")]
    ParentDeathWatchdog,
    #[cfg(not(windows))]
    MemoryPressure,
    SubprocessPipeReader,
    ShellPipeReader,
    ShellIoReader,
    FileReader,
    FileResponseStream,
    TerminalReader,
    Cron,
    FilterRunHandle,
    MultiRunPipeReader,
    TestParallelWorker,
    LifecycleScript,
    InstallGit,
    SecurityScanReader,
}

/// The receiver of an [`IoEvent`]. Safe to build: `set_owner` and `OwnedFilePoll::new` carry the contract.
#[derive(Copy, Clone)]
pub struct Owner {
    tag: PollTag,
    /// Tells the two readers of one owner apart.
    kind: Kind,
    ptr: *mut (),
}

impl Owner {
    pub(crate) const NULL: Owner = Owner::new(PollTag::Null, core::ptr::null_mut());
    #[inline]
    pub const fn new(tag: PollTag, ptr: *mut ()) -> Owner {
        Owner::with_kind(tag, Kind::Stdout, ptr)
    }
    #[inline]
    pub const fn with_kind(tag: PollTag, kind: Kind, ptr: *mut ()) -> Owner {
        Owner { tag, kind, ptr }
    }
    #[inline]
    pub fn tag(&self) -> PollTag {
        self.tag
    }
    #[inline]
    pub fn kind(&self) -> Kind {
        self.kind
    }
    #[inline]
    pub fn ptr(&self) -> *mut () {
        self.ptr
    }
}

#[cfg(windows)]
pub enum IoEvent {
    Read(crate::pipe_reader::ReadEvent),
    Write(crate::pipe_writer::WriteEvent),
}

/// What a poll that fired tells its owner.
#[cfg(not(windows))]
#[derive(Copy, Clone)]
pub struct IoEvent {
    pub fd: bun_sys::Fd,
    pub flags: crate::posix_event_loop::FlagsSet,
    pub size_or_offset: i64,
}

#[cfg(not(windows))]
impl IoEvent {
    pub fn is_hup(&self) -> bool {
        self.flags.contains(crate::PollFlag::Hup)
    }
}

unsafe extern "Rust" {
    /// # Safety
    /// `owner.ptr` points to a live value of the type `__bun_run_io` casts `owner.tag` to.
    pub(crate) fn __bun_run_io(owner: Owner, event: IoEvent);
}
