//! What the resolver asks of the operating system. It makes no system call itself.

use core::net::{IpAddr, SocketAddr};

/// A reading of a clock that never goes back.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub struct Time {
    pub sec: i64,
    pub usec: u32,
}

impl Time {
    pub const ZERO: Time = Time { sec: 0, usec: 0 };

    #[must_use]
    pub fn plus_ms(self, ms: u64) -> Time {
        let usec = u64::from(self.usec) + ms % 1000 * 1000;
        Time {
            sec: self
                .sec
                .saturating_add_unsigned(ms / 1000 + usec / 1_000_000),
            usec: (usec % 1_000_000) as u32,
        }
    }

    /// Whole milliseconds from `earlier` to `self`; zero if `earlier` is later.
    pub fn ms_since(self, earlier: Time) -> u64 {
        let usec = (self.sec.saturating_sub(earlier.sec))
            .saturating_mul(1_000_000)
            .saturating_add(i64::from(self.usec) - i64::from(earlier.usec));
        u64::try_from(usec / 1000).unwrap_or(0)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Transport {
    Udp,
    Tcp,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum IoError {
    /// Try again when the socket is ready.
    WouldBlock,
    Failed,
}

pub struct Opened<Socket> {
    pub socket: Socket,
    /// TCP Fast Open: what is sent before the connection is made goes out with the SYN.
    pub fast_open: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FileError {
    NotFound,
    Other,
}

pub trait Io {
    type Socket: Copy + Eq;

    /// A non-blocking socket, bound to `local` if there is one and connected (or connecting) to `server`.
    fn open(
        &mut self,
        transport: Transport,
        server: SocketAddr,
        local: Option<IpAddr>,
    ) -> Result<Opened<Self::Socket>, IoError>;
    fn send(&mut self, socket: Self::Socket, data: &[u8]) -> Result<usize, IoError>;
    /// The sender is `None` for TCP. The end of a TCP stream is `Failed`.
    fn recv(
        &mut self,
        socket: Self::Socket,
        buffer: &mut [u8],
    ) -> Result<(usize, Option<SocketAddr>), IoError>;
    /// Which events [`crate::Channel::process`] is to be called for from now on.
    fn watch(&mut self, socket: Self::Socket, readable: bool, writable: bool);
    /// Also ends the watch.
    fn close(&mut self, socket: Self::Socket);

    fn random(&mut self, bytes: &mut [u8]);
    /// Seconds since the epoch.
    fn unix_time(&mut self) -> i64;

    fn read_file(&mut self, path: &[u8]) -> Result<Vec<u8>, FileError>;
    /// Seconds since the epoch.
    fn modified_time(&mut self, path: &[u8]) -> Option<i64>;
    fn env(&mut self, name: &str) -> Option<Vec<u8>>;
    fn hostname(&mut self) -> Option<Vec<u8>>;
    /// Where hosts(5) is.
    fn hosts_path(&mut self) -> Option<Vec<u8>>;

    /// if_nametoindex(3).
    fn interface_index(&mut self, name: &[u8]) -> Option<u32>;
    fn has_interface(&mut self, index: u32) -> bool;
    /// The address a datagram to `destination` would leave from, without sending one. `Ok(None)`: there is no route.
    fn source_address(&mut self, destination: SocketAddr) -> Result<Option<IpAddr>, IoError>;
    /// getservbyport(3) for a port in host order.
    fn service_name(&mut self, port: u16, protocol: &str) -> Option<Vec<u8>>;
    /// The loopback addresses of this machine, if the system keeps a list of them.
    fn loopback_addresses(&mut self) -> Option<Vec<IpAddr>>;
}
