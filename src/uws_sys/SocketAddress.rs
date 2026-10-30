//! The text of a socket address that the kernel returned: from `getsockname()`, `getpeername()` or `recvmsg()`.

use core::fmt;
use core::net::{Ipv4Addr, Ipv6Addr};

use bun_sys::net::Address;
#[cfg(windows)]
pub use bun_windows_sys::ws2_32::sockaddr_storage;
#[cfg(not(windows))]
pub use libc::sockaddr_storage;

/// Node.js reserves `INET6_ADDRSTRLEN + UV_IF_NAMESIZE` (63) bytes for an address and its zone.
const TEXT_CAPACITY: usize = 64;

/// Whether `addr`, which is `AF_INET` or `AF_INET6`, is the latter.
pub fn sockaddr_is_ipv6(addr: &sockaddr_storage) -> bool {
    Address::from_ref(addr).as_in6().is_some()
}

/// Whether `addr` is a loopback address: 127.0.0.0/8, also as an IPv4-mapped address, or ::1.
pub fn sockaddr_is_loopback(addr: &sockaddr_storage) -> bool {
    let address = SocketAddress::from_sockaddr_without_zone(addr);
    let ip = address.ip();
    // IPv4 loopback addresses
    if ip.starts_with(b"127.") {
        return true;
    }
    // IPv6 loopback addresses
    if ip.starts_with(b"::ffff:127.") || ip == b"::1" || ip == b"0:0:0:0:0:0:0:1" {
        return true;
    }
    false
}

/// An IP address as text, and its port.
pub struct SocketAddress {
    text: [u8; TEXT_CAPACITY],
    len: u8,
    pub port: u16,
    pub is_ipv6: bool,
}

impl SocketAddress {
    /// `addr` as `AddressToJS` of Node.js (src/tcp_wrap.cc) prints it. Empty for an `addr` that is not IP.
    pub fn from_sockaddr(addr: &sockaddr_storage) -> SocketAddress {
        let (mut address, scope_id) = Self::parse(addr);
        if scope_id != 0 {
            address.append_zone(scope_id);
        }
        address
    }

    /// [`Self::from_sockaddr`] with no zone.
    pub fn from_sockaddr_without_zone(addr: &sockaddr_storage) -> SocketAddress {
        Self::parse(addr).0
    }

    /// The address with no zone, and the scope id to print after it: 0 unless the address is link-local.
    fn parse(addr: &sockaddr_storage) -> (SocketAddress, u32) {
        let mut address = SocketAddress {
            text: [0; TEXT_CAPACITY],
            len: 0,
            port: 0,
            is_ipv6: false,
        };
        let mut scope_id = 0;
        let addr = Address::from_ref(addr);
        if let Some(v4) = addr.as_in4() {
            address.port = u16::from_be(v4.port);
            address.write(format_args!("{}", Ipv4Addr::from(v4.addr.to_ne_bytes())));
        } else if let Some(v6) = addr.as_in6() {
            address.port = u16::from_be(v6.port);
            address.is_ipv6 = true;
            if v6.addr[0] == 0xfe && v6.addr[1] & 0xc0 == 0x80 {
                scope_id = v6.scope_id;
            }
            address.write_ipv6(v6.addr);
        }
        (address, scope_id)
    }

    /// The text of libuv's `inet_ntop()`. `Ipv6Addr` prints an IPv4-compatible address (`::1.2.3.4`) as `::102:304`.
    fn write_ipv6(&mut self, octets: [u8; 16]) {
        if octets[..12] == [0; 12] && (octets[12] != 0 || octets[13] != 0) {
            let ipv4 = Ipv4Addr::new(octets[12], octets[13], octets[14], octets[15]);
            self.write(format_args!("::{ipv4}"));
        } else {
            self.write(format_args!("{}", Ipv6Addr::from(octets)));
        }
    }

    /// Appends `%` and the name of the interface, or its index on Windows and for an interface with no name.
    fn append_zone(&mut self, scope_id: u32) {
        #[cfg(not(windows))]
        {
            let mut interface = [0u8; libc::IF_NAMESIZE];
            if let Some(name) = bun_sys::net::if_indextoname(scope_id, &mut interface) {
                let len = usize::from(self.len);
                self.text[len] = b'%';
                self.text[len + 1..len + 1 + name.len()].copy_from_slice(name);
                self.len += 1 + name.len() as u8;
                return;
            }
        }
        // Node.js throws here. A getter must not: `net.Server` reads the address of a peer on its own.
        self.write(format_args!("%{scope_id}"));
    }

    /// An address has at most 45 bytes. Only a link-local one gets a zone, and it has at most 39.
    fn write(&mut self, text: fmt::Arguments<'_>) {
        use std::io::Write as _;
        let mut unwritten = &mut self.text[usize::from(self.len)..];
        let capacity = unwritten.len();
        let _ = unwritten.write_fmt(text);
        self.len += (capacity - unwritten.len()) as u8;
    }

    pub fn ip(&self) -> &[u8] {
        &self.text[..usize::from(self.len)]
    }
}
