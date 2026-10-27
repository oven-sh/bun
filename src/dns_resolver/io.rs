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

/// What the system says of its resolver, as the system says it.
#[derive(Debug)]
pub enum Settings {
    /// Read resolv.conf(5) and nsswitch.conf(5).
    Files,
    Windows(WindowsSettings),
    /// `dns_configuration_copy()`'s `resolver` list. `None`: it gave nothing.
    Mac(Option<Vec<MacResolver>>),
    /// The properties `net.dns1` to `net.dns8`, up to the first that is not set.
    Android(Vec<Vec<u8>>),
}

#[derive(Debug, Default)]
pub struct WindowsSettings {
    /// `FirstDnsServerAddress` of each adapter that is up, as `GetAdaptersAddresses` orders them.
    pub servers: Vec<WindowsServer>,
    /// From the registry, in this order, those that are set:
    /// `SearchList` and `Domain` of `Tcpip\Parameters`, `SearchList` of `Windows NT\DNSClient`, `PrimaryDNSSuffix` of
    /// `System\DNSClient`, then `SearchList`, `Domain` and `DhcpDomain` of each key in `Tcpip\Parameters\Interfaces`.
    pub suffixes: Vec<Vec<u8>>,
}

#[derive(Debug)]
pub struct WindowsServer {
    pub address: SocketAddr,
    /// `Ipv4Metric` or `Ipv6Metric` of the adapter, by the family of the address.
    pub interface_metric: u32,
    /// `GetBestRoute2`'s metric for the address through the adapter.
    pub route_metric: Option<u32>,
    /// `Ipv6IfIndex` of the adapter.
    pub ipv6_interface: u32,
}

/// A `dns_resolver_t`.
#[derive(Debug, Default)]
pub struct MacResolver {
    /// It has a `domain`: it answers for that domain only.
    pub for_one_domain: bool,
    pub reach_flags: u32,
    pub port: u16,
    pub search: Vec<Vec<u8>>,
    pub options: Option<Vec<u8>>,
    pub nameservers: Vec<SocketAddr>,
    pub interface: u32,
}

/// An environment variable.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Variable {
    /// `LOCALDOMAIN`, in place of the search list.
    LocalDomain,
    /// `RES_OPTIONS`, on top of the `options` of resolv.conf(5).
    ResOptions,
    /// `HOSTALIASES`, the path of a file of aliases: hostname(7).
    HostAliases,
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
    /// One datagram and who sent it.
    fn recv_from(
        &mut self,
        socket: Self::Socket,
        buffer: &mut [u8],
    ) -> Result<(usize, SocketAddr), IoError>;
    /// Bytes of a TCP stream, whose end is `Failed`.
    fn recv(&mut self, socket: Self::Socket, buffer: &mut [u8]) -> Result<usize, IoError>;
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
    fn env(&mut self, variable: Variable) -> Option<Vec<u8>>;
    fn hostname(&mut self) -> Option<Vec<u8>>;
    fn settings(&mut self) -> Settings;
    /// Where the system keeps `hosts`, `services` and the like: `/etc/{name}`, except on Windows.
    fn etc_path(&mut self, name: &str) -> Option<Vec<u8>>;

    /// if_nametoindex(3).
    fn interface_index(&mut self, name: &[u8]) -> Option<u32>;
    fn has_interface(&mut self, index: u32) -> bool;
    /// The address a datagram to `destination` would leave from, without sending one. `Ok(None)`: there is no route.
    fn source_address(&mut self, destination: SocketAddr) -> Result<Option<IpAddr>, IoError>;
    /// The loopback addresses of this machine, if the system keeps a list of them.
    fn loopback_addresses(&mut self) -> Option<Vec<IpAddr>>;
}
