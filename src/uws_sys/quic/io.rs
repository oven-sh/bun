//! For packages/bun-usockets/src/quic.cpp.

use core::ffi::c_int;
use core::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV6};

use bun_core::{Timespec, TimespecMockMode};
use bun_quic::{Batch, Endpoint, Instant};

use crate::udp;

const DATAGRAMS_PER_BATCH: usize = 64;

#[inline]
pub fn now() -> Instant {
    Instant::from_micros(Timespec::now(TimespecMockMode::ForceRealTime).ns() / 1000)
}

#[repr(C)]
#[derive(Default)]
pub(super) struct Address {
    ip: [u8; 16],
    scope_id: u32,
    port: u16,
    is_ipv6: bool,
}

impl From<Address> for SocketAddr {
    #[inline]
    fn from(address: Address) -> Self {
        let [a, b, c, d, ..] = address.ip;
        match address.is_ipv6 {
            true => SocketAddrV6::new(address.ip.into(), address.port, 0, address.scope_id).into(),
            false => (Ipv4Addr::new(a, b, c, d), address.port).into(),
        }
    }
}

impl From<SocketAddr> for Address {
    #[inline]
    fn from(address: SocketAddr) -> Self {
        let mut ip = [0; 16];
        write_ip(address.ip(), &mut ip);
        Self {
            ip,
            scope_id: match address {
                SocketAddr::V4(_) => 0,
                SocketAddr::V6(address) => address.scope_id(),
            },
            port: address.port(),
            is_ipv6: address.is_ipv6(),
        }
    }
}

/// Returns its length.
#[inline]
pub(super) fn write_ip(ip: IpAddr, out: &mut [u8; 16]) -> c_int {
    match ip {
        IpAddr::V4(ip) => {
            out[..4].copy_from_slice(&ip.octets());
            4
        }
        IpAddr::V6(ip) => {
            *out = ip.octets();
            16
        }
    }
}

#[repr(C)]
struct Run {
    data: *const u8,
    len: usize,
    segment_len: usize,
    peer: Address,
}

unsafe extern "C" {
    safe fn us_quic_peer_address(buffer: &mut udp::PacketBuffer, index: c_int, out: &mut Address);
    safe fn us_quic_local_address(socket: &mut udp::Socket, out: &mut Address);
    safe fn us_quic_set_dontfrag(socket: &mut udp::Socket);
    fn us_quic_send(socket: &mut udp::Socket, runs: *const Run, count: usize) -> usize;
}

#[inline]
pub fn peer_address(buffer: &mut udp::PacketBuffer, index: c_int) -> SocketAddr {
    let mut address = Address::default();
    us_quic_peer_address(buffer, index, &mut address);
    address.into()
}

/// Returns the address that it is bound to.
pub fn prepare(socket: &mut udp::Socket) -> SocketAddr {
    let mut address = Address::default();
    us_quic_set_dontfrag(socket);
    us_quic_local_address(socket, &mut address);
    address.into()
}

/// The datagrams between an endpoint and its sockets.
#[derive(Default)]
pub struct Outbox {
    batch: Batch,
    /// How many of its bytes are done with.
    sent: usize,
    runs: Vec<Run>,
    is_blocked: bool,
}

impl Outbox {
    #[inline]
    pub fn is_blocked(&self) -> bool {
        self.is_blocked
    }

    /// For when a socket is writable, or closed.
    pub fn unblock(&mut self) {
        self.is_blocked = false;
    }

    #[inline]
    pub fn has_unsent(&self) -> bool {
        !self.batch.is_empty()
    }

    /// `socket` is the one with this local address, or null. `on_batch` is called before it is sent.
    pub fn flush(
        &mut self,
        endpoint: &mut Endpoint,
        socket: impl Fn(&SocketAddr) -> *mut udp::Socket,
        mut on_batch: impl FnMut(&Batch),
    ) {
        while !self.is_blocked && (self.has_unsent() || endpoint.wants_to_transmit()) {
            if self.batch.is_empty() {
                endpoint.poll_transmit(now(), &mut self.batch, DATAGRAMS_PER_BATCH);
                on_batch(&self.batch);
            }
            self.send(&socket);
        }
    }

    fn send(&mut self, socket: impl Fn(&SocketAddr) -> *mut udp::Socket) {
        let (mut runs, mut to_skip) = (self.batch.runs().peekable(), self.sent);
        while let Some(&(first, ..)) = runs.peek() {
            let mut len = 0;
            self.runs.clear();
            while let Some((to, mut bytes, segment_len)) =
                runs.next_if(|it| it.0.local == first.local)
            {
                let skipped = to_skip.min(bytes.len());
                to_skip -= skipped;
                bytes = &bytes[skipped..];
                len += bytes.len();
                if !bytes.is_empty() {
                    self.runs.push(Run {
                        data: bytes.as_ptr(),
                        len: bytes.len(),
                        segment_len,
                        peer: to.peer.into(),
                    });
                }
            }
            let socket = socket(&first.local);
            let sent = match socket.is_null() {
                true => len,
                // SAFETY: the runs are as many as it says, and point into the batch.
                false => unsafe {
                    let socket = udp::Socket::opaque_mut(socket);
                    us_quic_send(socket, self.runs.as_ptr(), self.runs.len())
                },
            };
            self.sent += sent;
            if sent < len {
                self.is_blocked = true;
                return;
            }
        }
        drop(runs);
        self.batch.clear();
        self.sent = 0;
    }
}
