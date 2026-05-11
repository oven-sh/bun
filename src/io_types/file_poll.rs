use crate::owner::OwnerToken;
use crate::reader::BufferedReaderHandle;
use crate::writer::PipeWriterHandle;
use bun_spawn_types::ProcessHandle;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Null = 0,
    FileSink,
    StaticPipeWriter,
    ShellStaticPipeWriter,
    SecurityScanStaticPipeWriter,
    BufferedReader,
    DnsResolver,
    GetAddrInfoRequest,
    Request,
    Process,
    ShellBufferedWriter,
    TerminalPoll,
    ParentDeathWatchdog,
    LifecycleScriptSubprocessOutputReader,
}

pub mod kind {
    use super::Kind;

    pub const NULL: Kind = Kind::Null;
    pub const FILE_SINK: Kind = Kind::FileSink;
    pub const STATIC_PIPE_WRITER: Kind = Kind::StaticPipeWriter;
    pub const SHELL_STATIC_PIPE_WRITER: Kind = Kind::ShellStaticPipeWriter;
    pub const SECURITY_SCAN_STATIC_PIPE_WRITER: Kind = Kind::SecurityScanStaticPipeWriter;
    pub const BUFFERED_READER: Kind = Kind::BufferedReader;
    pub const DNS_RESOLVER: Kind = Kind::DnsResolver;
    pub const GET_ADDR_INFO_REQUEST: Kind = Kind::GetAddrInfoRequest;
    pub const REQUEST: Kind = Kind::Request;
    pub const PROCESS: Kind = Kind::Process;
    pub const SHELL_BUFFERED_WRITER: Kind = Kind::ShellBufferedWriter;
    pub const TERMINAL_POLL: Kind = Kind::TerminalPoll;
    pub const PARENT_DEATH_WATCHDOG: Kind = Kind::ParentDeathWatchdog;
    pub const LIFECYCLE_SCRIPT_SUBPROCESS_OUTPUT_READER: Kind =
        Kind::LifecycleScriptSubprocessOutputReader;
}

pub enum Null {}
pub enum FileSink {}
pub enum StaticPipeWriter {}
pub enum ShellStaticPipeWriter {}
pub enum SecurityScanStaticPipeWriter {}
pub enum BufferedReader {}
pub enum DnsResolver {}
pub enum GetAddrInfoRequest {}
pub enum Request {}
pub enum Process {}
pub enum ShellBufferedWriter {}
pub enum TerminalPoll {}
pub enum ParentDeathWatchdog {}
pub enum LifecycleScriptSubprocessOutputReader {}

pub trait Variant: Sized {
    const KIND: Kind;

    fn owner(token: OwnerToken<Self>) -> Owner;
}

pub trait PipeWriterVariant: Sized {
    const KIND: Kind;

    fn writer_owner(handle: PipeWriterHandle) -> Owner;
}

macro_rules! variants {
    ($( $marker:ident => $kind:ident ),* $(,)?) => {
        $(
            impl Variant for $marker {
                const KIND: Kind = Kind::$kind;

                #[inline]
                fn owner(token: OwnerToken<Self>) -> Owner {
                    Owner::$kind(token)
                }
            }
        )*
    };
}

variants! {
    DnsResolver => DnsResolver,
    GetAddrInfoRequest => GetAddrInfoRequest,
    Request => Request,
    ParentDeathWatchdog => ParentDeathWatchdog,
}

macro_rules! writer_variants {
    ($( $marker:ident => $kind:ident ),* $(,)?) => {
        $(
            impl PipeWriterVariant for $marker {
                const KIND: Kind = Kind::$kind;

                #[inline]
                fn writer_owner(handle: PipeWriterHandle) -> Owner {
                    Owner::$kind(handle)
                }
            }
        )*
    };
}

writer_variants! {
    FileSink => FileSink,
    StaticPipeWriter => StaticPipeWriter,
    ShellStaticPipeWriter => ShellStaticPipeWriter,
    SecurityScanStaticPipeWriter => SecurityScanStaticPipeWriter,
    ShellBufferedWriter => ShellBufferedWriter,
    TerminalPoll => TerminalPoll,
}

impl Variant for Null {
    const KIND: Kind = Kind::Null;

    #[inline]
    fn owner(_: OwnerToken<Self>) -> Owner {
        Owner::Null
    }
}

impl PipeWriterVariant for Null {
    const KIND: Kind = Kind::Null;

    #[inline]
    fn writer_owner(_: PipeWriterHandle) -> Owner {
        Owner::Null
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Owner {
    Null,
    FileSink(PipeWriterHandle),
    StaticPipeWriter(PipeWriterHandle),
    ShellStaticPipeWriter(PipeWriterHandle),
    SecurityScanStaticPipeWriter(PipeWriterHandle),
    BufferedReader(BufferedReaderHandle),
    DnsResolver(OwnerToken<DnsResolver>),
    GetAddrInfoRequest(OwnerToken<GetAddrInfoRequest>),
    Request(OwnerToken<Request>),
    Process(ProcessHandle),
    ShellBufferedWriter(PipeWriterHandle),
    TerminalPoll(PipeWriterHandle),
    ParentDeathWatchdog(OwnerToken<ParentDeathWatchdog>),
    LifecycleScriptSubprocessOutputReader(BufferedReaderHandle),
}

impl Owner {
    pub const NULL: Self = Self::Null;

    #[inline]
    pub fn typed<T: Variant>(ptr: *mut ()) -> Self {
        let Some(token) = OwnerToken::<T>::from_usize(ptr as usize) else {
            return Self::NULL;
        };
        T::owner(token)
    }

    #[inline]
    pub fn pipe_writer<T: PipeWriterVariant>(ptr: *mut ()) -> Self {
        let Some(handle) = PipeWriterHandle::from_ptr(ptr) else {
            return Self::NULL;
        };
        T::writer_owner(handle)
    }

    /// # Safety
    /// If `ptr` is non-null, it must point to a live owner of the concrete
    /// type represented by `kind`.
    #[inline]
    pub unsafe fn from_raw_parts(kind: Kind, ptr: *mut ()) -> Self {
        match kind {
            Kind::Null => Self::NULL,
            Kind::FileSink => Self::pipe_writer::<FileSink>(ptr),
            Kind::StaticPipeWriter => Self::pipe_writer::<StaticPipeWriter>(ptr),
            Kind::ShellStaticPipeWriter => Self::pipe_writer::<ShellStaticPipeWriter>(ptr),
            Kind::SecurityScanStaticPipeWriter => Self::pipe_writer::<SecurityScanStaticPipeWriter>(ptr),
            Kind::BufferedReader => BufferedReaderHandle::from_usize(ptr as usize)
                .map(Self::BufferedReader)
                .unwrap_or(Self::NULL),
            Kind::DnsResolver => Self::typed::<DnsResolver>(ptr),
            Kind::GetAddrInfoRequest => Self::typed::<GetAddrInfoRequest>(ptr),
            Kind::Request => Self::typed::<Request>(ptr),
            Kind::Process => ProcessHandle::from_usize(ptr as usize)
                .map(Self::Process)
                .unwrap_or(Self::NULL),
            Kind::ShellBufferedWriter => Self::pipe_writer::<ShellBufferedWriter>(ptr),
            Kind::TerminalPoll => Self::pipe_writer::<TerminalPoll>(ptr),
            Kind::ParentDeathWatchdog => Self::typed::<ParentDeathWatchdog>(ptr),
            Kind::LifecycleScriptSubprocessOutputReader => {
                BufferedReaderHandle::from_usize(ptr as usize)
                    .map(Self::LifecycleScriptSubprocessOutputReader)
                    .unwrap_or(Self::NULL)
            }
        }
    }

    #[inline]
    pub const fn is_null(&self) -> bool {
        matches!(self, Self::Null)
    }

    #[inline]
    pub fn clear(&mut self) {
        *self = Self::NULL;
    }

    #[inline]
    pub const fn kind(&self) -> Kind {
        match self {
            Self::Null => Kind::Null,
            Self::FileSink(_) => Kind::FileSink,
            Self::StaticPipeWriter(_) => Kind::StaticPipeWriter,
            Self::ShellStaticPipeWriter(_) => Kind::ShellStaticPipeWriter,
            Self::SecurityScanStaticPipeWriter(_) => Kind::SecurityScanStaticPipeWriter,
            Self::BufferedReader(_) => Kind::BufferedReader,
            Self::DnsResolver(_) => Kind::DnsResolver,
            Self::GetAddrInfoRequest(_) => Kind::GetAddrInfoRequest,
            Self::Request(_) => Kind::Request,
            Self::Process(_) => Kind::Process,
            Self::ShellBufferedWriter(_) => Kind::ShellBufferedWriter,
            Self::TerminalPoll(_) => Kind::TerminalPoll,
            Self::ParentDeathWatchdog(_) => Kind::ParentDeathWatchdog,
            Self::LifecycleScriptSubprocessOutputReader(_) => {
                Kind::LifecycleScriptSubprocessOutputReader
            }
        }
    }

    #[inline]
    pub const fn addr(&self) -> usize {
        match self {
            Self::Null => 0,
            Self::FileSink(handle) => handle.get(),
            Self::StaticPipeWriter(handle) => handle.get(),
            Self::ShellStaticPipeWriter(handle) => handle.get(),
            Self::SecurityScanStaticPipeWriter(handle) => handle.get(),
            Self::BufferedReader(handle) => handle.get(),
            Self::DnsResolver(token) => token.get(),
            Self::GetAddrInfoRequest(token) => token.get(),
            Self::Request(token) => token.get(),
            Self::Process(handle) => handle.get(),
            Self::ShellBufferedWriter(handle) => handle.get(),
            Self::TerminalPoll(handle) => handle.get(),
            Self::ParentDeathWatchdog(token) => token.get(),
            Self::LifecycleScriptSubprocessOutputReader(handle) => handle.get(),
        }
    }

    #[inline]
    pub fn ptr(self) -> *mut () {
        self.addr() as *mut ()
    }

    #[inline]
    pub const fn process_handle(self) -> Option<ProcessHandle> {
        match self {
            Self::Process(handle) => Some(handle),
            _ => None,
        }
    }

    #[inline]
    pub const fn buffered_reader_handle(self) -> Option<BufferedReaderHandle> {
        match self {
            Self::BufferedReader(handle)
            | Self::LifecycleScriptSubprocessOutputReader(handle) => Some(handle),
            _ => None,
        }
    }

    #[inline]
    pub const fn pipe_writer_handle(self) -> Option<PipeWriterHandle> {
        match self {
            Self::FileSink(handle)
            | Self::StaticPipeWriter(handle)
            | Self::ShellStaticPipeWriter(handle)
            | Self::SecurityScanStaticPipeWriter(handle)
            | Self::ShellBufferedWriter(handle)
            | Self::TerminalPoll(handle) => Some(handle),
            _ => None,
        }
    }

    #[inline]
    pub const fn token<T>(self) -> Option<OwnerToken<T>> {
        OwnerToken::from_usize(self.addr())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_constructor_derives_kind_from_marker() {
        let ptr = 0x4000usize as *mut ();
        let owner = Owner::pipe_writer::<SecurityScanStaticPipeWriter>(ptr);
        let handle = PipeWriterHandle::from_usize(ptr as usize).unwrap();

        assert_eq!(owner.kind(), Kind::SecurityScanStaticPipeWriter);
        assert_eq!(owner.pipe_writer_handle(), Some(handle));
        assert_eq!(owner.ptr(), ptr);
    }

    #[test]
    fn null_pointer_clears_to_null_variant() {
        let owner = Owner::pipe_writer::<SecurityScanStaticPipeWriter>(core::ptr::null_mut());

        assert_eq!(owner.kind(), Kind::Null);
        assert!(owner.is_null());
        assert_eq!(owner.ptr(), core::ptr::null_mut());
    }

    #[test]
    fn raw_parts_reenter_the_closed_owner_shape() {
        let ptr = 0x5000usize as *mut ();
        let owner = unsafe { Owner::from_raw_parts(Kind::Process, ptr) };
        let handle = ProcessHandle::from_usize(ptr as usize).unwrap();

        assert_eq!(owner, Owner::Process(handle));
        assert_eq!(owner.process_handle(), Some(handle));
        assert_eq!(owner.kind(), Kind::Process);
        assert_eq!(owner.ptr(), ptr);
    }

    #[test]
    fn raw_parts_preserve_buffered_reader_handle() {
        let ptr = 0x6000usize as *mut ();
        let owner = unsafe { Owner::from_raw_parts(Kind::BufferedReader, ptr) };
        let handle = BufferedReaderHandle::from_usize(ptr as usize).unwrap();

        assert_eq!(owner, Owner::BufferedReader(handle));
        assert_eq!(owner.buffered_reader_handle(), Some(handle));
        assert_eq!(owner.kind(), Kind::BufferedReader);
        assert_eq!(owner.ptr(), ptr);
    }

    #[test]
    fn owner_stays_pointer_pair_sized() {
        assert_eq!(
            core::mem::size_of::<Owner>(),
            core::mem::size_of::<usize>() * 2
        );
    }
}
