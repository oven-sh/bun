//! The text of a socket address that the kernel returned: from `getsockname()`, `getpeername()` or `recvmsg()`.

use core::net::SocketAddr;

use bun_core::ip_address::IpText;
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
        let Some(addr) = Address::from_ref(addr).to_socket_addr() else {
            return (address, 0);
        };
        address.port = addr.port();
        address.is_ipv6 = addr.is_ipv6();
        address.push(&IpText::new(addr.ip()));
        let scope_id = match addr {
            SocketAddr::V6(v6) if v6.ip().is_unicast_link_local() => v6.scope_id(),
            _ => 0,
        };
        (address, scope_id)
    }

    /// Appends `%` and the name of the interface, or its index on Windows and for an interface with no name.
    fn append_zone(&mut self, scope_id: u32) {
        self.push(b"%");
        #[cfg(not(windows))]
        {
            let mut interface = [0u8; libc::IF_NAMESIZE];
            if let Some(name) = bun_sys::net::if_indextoname(scope_id, &mut interface) {
                return self.push(name);
            }
        }
        // Node.js throws here. A getter must not: `net.Server` reads the address of a peer on its own.
        use std::io::Write as _;
        let mut unwritten = &mut self.text[usize::from(self.len)..];
        let capacity = unwritten.len();
        let _ = write!(unwritten, "{scope_id}");
        self.len += (capacity - unwritten.len()) as u8;
    }

    /// An address has at most 39 bytes. Only a link-local one gets a zone: `%`, and at most 15 bytes more.
    fn push(&mut self, bytes: &[u8]) {
        let len = usize::from(self.len);
        self.text[len..len + bytes.len()].copy_from_slice(bytes);
        self.len += bytes.len() as u8;
    }

    pub fn ip(&self) -> &[u8] {
        &self.text[..usize::from(self.len)]
    }
}
