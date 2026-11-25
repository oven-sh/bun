//! What a [`Client`](crate::Client) asks of the machine it runs on.

use core::net::{IpAddr, SocketAddr};
use core::time::Duration;

use bun_core::ZStr;

use crate::Config;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Transport {
    Udp,
    Tcp,
}

/// Tells an open socket from the others. A closed one's can come back.
pub type SocketId = usize;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SocketError {
    WouldBlock,
    /// Also the end of a stream.
    Failed,
}

/// What the event loop says of a socket.
#[derive(Clone, Copy, Default)]
pub struct Events {
    pub readable: bool,
    pub writable: bool,
    pub failed: bool,
}

/// Does not block, and closes when dropped.
pub trait Socket {
    fn id(&self) -> SocketId;

    /// Whether a new one has to turn writable, as it also does if that fails, before it is used.
    fn is_connecting(&self) -> bool;

    fn send(&mut self, data: &[u8]) -> Result<usize, SocketError>;

    /// Appends to `buffer` within its capacity. Returns the sender of a datagram.
    fn receive(&mut self, buffer: &mut Vec<u8>) -> Result<Option<SocketAddr>, SocketError>;

    /// [`Client::process`](crate::Client::process) is due while the socket is readable, has failed or, if asked for, is writable.
    fn watch(&mut self, writable: bool);
}

/// How this machine would reach an address.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Route {
    From(IpAddr),
    Unreachable,
    Unknown,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct FileStamp {
    /// In the seconds of [`System::wall_clock`].
    pub modified: i64,
    pub size: u64,
    pub inode: u64,
    pub device: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Variable {
    HostAliases,
    LocalDomain,
    ResOptions,
}

pub trait System: Sized {
    type Socket: Socket;

    /// How many the receive buffer of a socket is sure to hold.
    const DATAGRAMS_HELD: usize = 64;

    /// Monotonic.
    fn now(&self) -> Duration;

    /// Seconds since the Unix epoch.
    fn wall_clock(&self) -> i64;

    /// Nobody else can predict it. `None` if the system has none to give.
    fn random(&mut self) -> Option<u16>;

    fn connect(
        &mut self,
        transport: Transport,
        server: SocketAddr,
        local: Option<IpAddr>,
    ) -> Option<Self::Socket>;

    fn route(&mut self, destination: IpAddr) -> Route;

    fn configure(&mut self, config: &mut Config) {
        config.read_files(self);
    }

    fn read_file(&self, path: &[u8]) -> Option<Vec<u8>>;

    fn stamp(&self, path: &ZStr) -> Option<FileStamp>;

    fn variable(&self, variable: Variable) -> Option<&[u8]>;

    fn hostname(&self) -> Option<Vec<u8>>;

    fn interface_index(&self, name: &[u8]) -> Option<u32>;

    /// Of the TCP service at `port`.
    fn service_name(&self, port: u16) -> Option<Box<[u8]>>;
}
