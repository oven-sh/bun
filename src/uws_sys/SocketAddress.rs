//! The text of a socket address that the kernel returned: from `getsockname()`, `getpeername()` or `recvmsg()`.

use core::ffi::c_int;
use core::fmt;
use core::net::{Ipv4Addr, Ipv6Addr};

#[cfg(windows)]
pub use bun_windows_sys::ws2_32::sockaddr_storage;
#[cfg(windows)]
use bun_windows_sys::ws2_32::{AF_INET, AF_INET6, sockaddr_in, sockaddr_in6};
#[cfg(not(windows))]
pub use libc::sockaddr_storage;
#[cfg(not(windows))]
use libc::{AF_INET, AF_INET6, sockaddr_in, sockaddr_in6};

/// Node.js reserves `INET6_ADDRSTRLEN + UV_IF_NAMESIZE` (63) bytes for an address and its zone.
const TEXT_CAPACITY: usize = 64;

/// Whether `addr`, which is `AF_INET` or `AF_INET6`, is the latter.
pub fn sockaddr_is_ipv6(addr: &sockaddr_storage) -> bool {
    c_int::from(addr.ss_family) == AF_INET6
}

/// Whether `addr` is a loopback address: 127.0.0.0/8, also as an IPv4-mapped address, or ::1.
pub fn sockaddr_is_loopback(addr: &sockaddr_storage) -> bool {
    let (address, _) = SocketAddress::parse(addr);
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

    /// The address with no zone, and the scope id to print after it: 0 unless the address is link-local.
    fn parse(addr: &sockaddr_storage) -> (SocketAddress, u32) {
        let mut address = SocketAddress {
            text: [0; TEXT_CAPACITY],
            len: 0,
            port: 0,
            is_ipv6: false,
        };
        let mut scope_id = 0;
        match c_int::from(addr.ss_family) {
            AF_INET => {
                // SAFETY: the family says that `addr` holds a `sockaddr_in`.
                let v4 = unsafe { &*core::ptr::from_ref(addr).cast::<sockaddr_in>() };
                address.port = u16::from_be(v4.sin_port);
                // SAFETY: `sin_addr` is the four bytes of the address, in network order.
                let octets = unsafe { *(&raw const v4.sin_addr).cast::<[u8; 4]>() };
                address.write(format_args!("{}", Ipv4Addr::from(octets)));
            }
            AF_INET6 => {
                // SAFETY: the family says that `addr` holds a `sockaddr_in6`.
                let v6 = unsafe { &*core::ptr::from_ref(addr).cast::<sockaddr_in6>() };
                address.port = u16::from_be(v6.sin6_port);
                address.is_ipv6 = true;
                let octets = v6.sin6_addr.s6_addr;
                if octets[0] == 0xfe && octets[1] & 0xc0 == 0x80 {
                    scope_id = v6.sin6_scope_id;
                }
                address.write_ipv6(octets);
            }
            _ => {}
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
            // SAFETY: `if_indextoname()` writes at most `IF_NAMESIZE` bytes, the NUL included.
            if !unsafe { libc::if_indextoname(scope_id, interface.as_mut_ptr().cast()) }.is_null() {
                let name = bun_core::ffi::slice_to_nul(&interface);
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
