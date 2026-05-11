use crate::dns::{DnsRequestHandle, DnsResolverHandle, GetAddrInfoRequestHandle};
use crate::reader::BufferedReaderHandle;
use crate::watchdog::ParentDeathWatchdogHandle;
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
pub enum ShellBufferedWriter {}
pub enum TerminalPoll {}

pub trait PipeWriterVariant: Sized {
    const KIND: Kind;

    fn writer_owner(handle: PipeWriterHandle) -> Owner;
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
    DnsResolver(DnsResolverHandle),
    GetAddrInfoRequest(GetAddrInfoRequestHandle),
    Request(DnsRequestHandle),
    Process(ProcessHandle),
    ShellBufferedWriter(PipeWriterHandle),
    TerminalPoll(PipeWriterHandle),
    ParentDeathWatchdog(ParentDeathWatchdogHandle),
    LifecycleScriptSubprocessOutputReader(BufferedReaderHandle),
}

impl Owner {
    pub const NULL: Self = Self::Null;

    #[inline]
    pub fn pipe_writer<T: PipeWriterVariant>(ptr: *mut ()) -> Self {
        let Some(handle) = PipeWriterHandle::from_ptr(ptr) else {
            return Self::NULL;
        };
        T::writer_owner(handle)
    }

    #[inline]
    pub fn dns_resolver(ptr: *mut ()) -> Self {
        DnsResolverHandle::from_ptr(ptr)
            .map(Self::DnsResolver)
            .unwrap_or(Self::NULL)
    }

    #[inline]
    pub fn get_addr_info_request(ptr: *mut ()) -> Self {
        GetAddrInfoRequestHandle::from_ptr(ptr)
            .map(Self::GetAddrInfoRequest)
            .unwrap_or(Self::NULL)
    }

    #[inline]
    pub fn dns_request(ptr: *mut ()) -> Self {
        DnsRequestHandle::from_ptr(ptr)
            .map(Self::Request)
            .unwrap_or(Self::NULL)
    }

    #[inline]
    pub fn parent_death_watchdog(ptr: *mut ()) -> Self {
        ParentDeathWatchdogHandle::from_ptr(ptr)
            .map(Self::ParentDeathWatchdog)
            .unwrap_or(Self::NULL)
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
            Self::DnsResolver(handle) => handle.get(),
            Self::GetAddrInfoRequest(handle) => handle.get(),
            Self::Request(handle) => handle.get(),
            Self::Process(handle) => handle.get(),
            Self::ShellBufferedWriter(handle) => handle.get(),
            Self::TerminalPoll(handle) => handle.get(),
            Self::ParentDeathWatchdog(handle) => handle.get(),
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
    pub const fn dns_resolver_handle(self) -> Option<DnsResolverHandle> {
        match self {
            Self::DnsResolver(handle) => Some(handle),
            _ => None,
        }
    }

    #[inline]
    pub const fn get_addr_info_request_handle(self) -> Option<GetAddrInfoRequestHandle> {
        match self {
            Self::GetAddrInfoRequest(handle) => Some(handle),
            _ => None,
        }
    }

    #[inline]
    pub const fn dns_request_handle(self) -> Option<DnsRequestHandle> {
        match self {
            Self::Request(handle) => Some(handle),
            _ => None,
        }
    }

    #[inline]
    pub const fn parent_death_watchdog_handle(self) -> Option<ParentDeathWatchdogHandle> {
        match self {
            Self::ParentDeathWatchdog(handle) => Some(handle),
            _ => None,
        }
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
    fn process_variant_preserves_typed_handle() {
        let ptr = 0x5000usize as *mut ();
        let handle = ProcessHandle::from_usize(ptr as usize).unwrap();
        let owner = Owner::Process(handle);

        assert_eq!(owner, Owner::Process(handle));
        assert_eq!(owner.process_handle(), Some(handle));
        assert_eq!(owner.kind(), Kind::Process);
        assert_eq!(owner.ptr(), ptr);
    }

    #[test]
    fn buffered_reader_variant_preserves_typed_handle() {
        let ptr = 0x6000usize as *mut ();
        let handle = BufferedReaderHandle::from_usize(ptr as usize).unwrap();
        let owner = Owner::BufferedReader(handle);

        assert_eq!(owner, Owner::BufferedReader(handle));
        assert_eq!(owner.buffered_reader_handle(), Some(handle));
        assert_eq!(owner.kind(), Kind::BufferedReader);
        assert_eq!(owner.ptr(), ptr);
    }

    #[test]
    fn dns_constructors_preserve_typed_handles() {
        let resolver_ptr = 0x7000usize as *mut ();
        let get_addr_info_ptr = 0x8000usize as *mut ();
        let request_ptr = 0x9000usize as *mut ();

        let resolver = Owner::dns_resolver(resolver_ptr);
        let get_addr_info = Owner::get_addr_info_request(get_addr_info_ptr);
        let request = Owner::dns_request(request_ptr);

        assert_eq!(
            resolver.dns_resolver_handle(),
            DnsResolverHandle::from_usize(resolver_ptr as usize)
        );
        assert_eq!(
            get_addr_info.get_addr_info_request_handle(),
            GetAddrInfoRequestHandle::from_usize(get_addr_info_ptr as usize)
        );
        assert_eq!(
            request.dns_request_handle(),
            DnsRequestHandle::from_usize(request_ptr as usize)
        );
        assert_eq!(resolver.ptr(), resolver_ptr);
        assert_eq!(get_addr_info.ptr(), get_addr_info_ptr);
        assert_eq!(request.ptr(), request_ptr);
    }

    #[test]
    fn parent_death_watchdog_constructor_preserves_typed_handle() {
        let ptr = 0xa000usize as *mut ();
        let owner = Owner::parent_death_watchdog(ptr);
        let handle = ParentDeathWatchdogHandle::from_usize(ptr as usize).unwrap();

        assert_eq!(owner.parent_death_watchdog_handle(), Some(handle));
        assert_eq!(owner.kind(), Kind::ParentDeathWatchdog);
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
