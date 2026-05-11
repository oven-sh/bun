use crate::owner::OwnerToken;

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

pub trait Variant {
    const KIND: Kind;

    #[inline]
    fn owner(token: OwnerToken<Self>) -> Owner
    where
        Self: Sized,
    {
        Owner::new(Self::KIND, token.get())
    }
}

macro_rules! variants {
    ($( $marker:ident => $kind:ident ),* $(,)?) => {
        $(
            impl Variant for $marker {
                const KIND: Kind = Kind::$kind;
            }
        )*
    };
}

variants! {
    Null => Null,
    FileSink => FileSink,
    StaticPipeWriter => StaticPipeWriter,
    ShellStaticPipeWriter => ShellStaticPipeWriter,
    SecurityScanStaticPipeWriter => SecurityScanStaticPipeWriter,
    BufferedReader => BufferedReader,
    DnsResolver => DnsResolver,
    GetAddrInfoRequest => GetAddrInfoRequest,
    Request => Request,
    Process => Process,
    ShellBufferedWriter => ShellBufferedWriter,
    TerminalPoll => TerminalPoll,
    ParentDeathWatchdog => ParentDeathWatchdog,
    LifecycleScriptSubprocessOutputReader => LifecycleScriptSubprocessOutputReader,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Owner {
    kind: Kind,
    addr: usize,
}

impl Owner {
    pub const NULL: Self = Self {
        kind: Kind::Null,
        addr: 0,
    };

    #[inline]
    pub fn typed<T: Variant>(ptr: *mut ()) -> Self {
        let Some(token) = OwnerToken::<T>::from_usize(ptr as usize) else {
            return Self::NULL;
        };
        T::owner(token)
    }

    #[inline]
    pub fn from_raw_parts(kind: Kind, ptr: *mut ()) -> Self {
        Self {
            kind,
            addr: ptr as usize,
        }
    }

    #[inline]
    const fn new(kind: Kind, addr: usize) -> Self {
        Self { kind, addr }
    }

    #[inline]
    pub const fn is_null(&self) -> bool {
        self.addr == 0
    }

    #[inline]
    pub fn clear(&mut self) {
        *self = Self::NULL;
    }

    #[inline]
    pub const fn kind(&self) -> Kind {
        self.kind
    }

    #[inline]
    pub const fn addr(&self) -> usize {
        self.addr
    }

    #[inline]
    pub fn ptr(self) -> *mut () {
        self.addr as *mut ()
    }

    #[inline]
    pub const fn token<T>(self) -> Option<OwnerToken<T>> {
        OwnerToken::from_usize(self.addr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_constructor_derives_kind_from_marker() {
        let ptr = 0x4000usize as *mut ();
        let owner = Owner::typed::<SecurityScanStaticPipeWriter>(ptr);

        assert_eq!(owner.kind(), Kind::SecurityScanStaticPipeWriter);
        assert_eq!(owner.ptr(), ptr);
    }
}
