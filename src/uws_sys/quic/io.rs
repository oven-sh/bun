//! For packages/bun-usockets/src/quic.cpp.

use core::ffi::c_int;
use core::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV6};

use bun_core::{Timespec, TimespecMockMode};
use bun_quic::{Addresses, Batch, Connection, Duration, Endpoint, Instant};

use crate::udp;

/// `LIBUS_UDP_RECV_COUNT`.
const DATAGRAMS_PER_READ: c_int = 8;
/// How many datagrams to read before answering, for each connection that has to.
const READ_LEN_PER_CONNECTION: usize = 176;
const MAX_READ_LEN: usize = 32 * READ_LEN_PER_CONNECTION;
/// Above this, a datagram counts for several.
const LARGE_DATAGRAM_LEN: usize = 2048;
/// Where a datagram of this length comes from, there is probably more.
const FULL_DATAGRAM_LEN: usize = 1200;
/// For how long the first answers wait for the application to come up with more, while the peer may have nothing to do.
const MIN_PATIENCE: Duration = Duration::from_micros(50);
const MAX_PATIENCE: Duration = Duration::from_millis(1);
/// Two messages that are as long as UDP allows.
const DATAGRAMS_PER_BATCH: usize = 88;
/// After which the rest of the loop gets its turn, and the acknowledgments are read.
const BATCHES_PER_PASS: usize = 4;
/// All connections share it. Some systems refuse what is above their limit.
const RECEIVE_BUFFER_SIZES: [c_int; 2] = [4 << 20, 1 << 20];

#[inline]
pub fn now() -> Instant {
    Instant::from_micros(Timespec::now(TimespecMockMode::ForceRealTime).ns() / 1000)
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
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

/// From where the answers come to what is sent to `ip`.
pub fn or_loopback(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V4(Ipv4Addr::UNSPECIFIED) => Ipv4Addr::LOCALHOST.into(),
        IpAddr::V6(Ipv6Addr::UNSPECIFIED) => Ipv6Addr::LOCALHOST.into(),
        ip => ip,
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
struct Envelope {
    local: Address,
    peer: Address,
    segment_len: c_int,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Message {
    local: Address,
    peer: Address,
    start: u32,
    len: u32,
    segment_len: u16,
}

bun_core::assert_ffi_layout!(Address, 24, 4; scope_id @ 16, port @ 20, is_ipv6 @ 22);
bun_core::assert_ffi_layout!(Envelope, 52, 4; peer @ 24, segment_len @ 48);
bun_core::assert_ffi_layout!(Message, 60, 4; peer @ 24, start @ 48, len @ 52, segment_len @ 56);

impl Message {
    fn segments(self) -> impl Iterator<Item = Self> {
        let (end, len) = (self.start + self.len, u32::from(self.segment_len));
        (self.start..end)
            .step_by(len as usize)
            .map(move |start| Self {
                start,
                len: len.min(end - start),
                segment_len: 0,
                ..self
            })
    }
}

unsafe extern "C" {
    fn us_quic_read_envelope(buffer: &udp::PacketBuffer, index: c_int, out: &mut Envelope);
    safe fn us_quic_local_address(socket: &mut udp::Socket, out: &mut Address);
    safe fn us_quic_set_dontfrag(socket: &mut udp::Socket);
    safe fn us_quic_ignore_receive_errors(socket: &mut udp::Socket);
    safe fn us_quic_stop_reading(socket: &mut udp::Socket);
    safe fn us_quic_enable_offload(socket: &mut udp::Socket) -> bool;
    fn us_quic_send(
        socket: &mut udp::Socket,
        names_source: bool,
        bytes: *const u8,
        messages: *const Message,
        count: usize,
    ) -> c_int;
}

/// An open socket.
#[derive(Clone, Copy)]
pub struct Binding {
    pub socket: *mut udp::Socket,
    pub address: SocketAddr,
    can_segment: bool,
}

impl Binding {
    pub fn new(socket: *mut udp::Socket) -> Self {
        let (udp, mut address) = (udp::Socket::opaque_mut(socket), Address::default());
        let mut size = 0;
        udp.buffer_size(true, 0, &mut size);
        let _ = (RECEIVE_BUFFER_SIZES.iter())
            .any(|&it| it <= size || udp.buffer_size(true, it, &mut size) == 0);
        us_quic_set_dontfrag(udp);
        us_quic_ignore_receive_errors(udp);
        us_quic_local_address(udp, &mut address);
        Self {
            socket,
            address: address.into(),
            can_segment: us_quic_enable_offload(udp),
        }
    }

    #[inline]
    pub fn has(&self, local: SocketAddr) -> bool {
        let Self { address, .. } = self;
        address.port() == local.port()
            && (address.ip() == local.ip()
                || address.ip().is_unspecified() && address.is_ipv6() == local.is_ipv6())
    }

    #[inline]
    pub fn for_each_datagram(
        &self,
        packets: udp::Packets<'_>,
        mut f: impl FnMut(&Addresses, &mut [u8]),
    ) -> Read {
        let local = self.address.into();
        let mut read = Read {
            socket: self.socket,
            len: 0,
            may_be_more: false,
        };
        packets.for_each_mut(|buffer, at, payload| {
            let mut envelope = Envelope {
                local,
                peer: Address::default(),
                segment_len: 0,
            };
            // SAFETY: there is a packet at this index.
            unsafe { us_quic_read_envelope(buffer, at, &mut envelope) };
            let from = Addresses {
                local: envelope.local.into(),
                peer: envelope.peer.into(),
            };
            let len = match envelope.segment_len {
                ..=0 => usize::MAX,
                len => len as usize,
            };
            read.len += payload.len().div_ceil(len.min(LARGE_DATAGRAM_LEN)).max(1);
            read.may_be_more =
                at + 1 == DATAGRAMS_PER_READ || (FULL_DATAGRAM_LEN..len).contains(&payload.len());
            payload.chunks_mut(len).for_each(|it| f(&from, it));
        });
        read
    }
}

/// For [`Outbox::reads_on`].
#[must_use]
pub struct Read {
    socket: *mut udp::Socket,
    len: usize,
    may_be_more: bool,
}

/// The datagrams between an endpoint and its sockets.
#[derive(Default)]
pub struct Outbox {
    batch: Batch,
    messages: Vec<Message>,
    /// How many of them are done with.
    sent: usize,
    is_blocked: bool,
    batches_left: usize,
    is_unlimited: bool,
    /// Since the last pass.
    read_len: usize,
    flushed_at: Instant,
    patience: Duration,
    /// Not every network device can do it.
    has_failed_to_segment: bool,
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
    pub fn start_pass(&mut self, now: Instant) {
        (self.batches_left, self.read_len, self.flushed_at) = (BATCHES_PER_PASS, 0, now);
    }

    #[inline]
    pub fn is_pass_over(&self) -> bool {
        self.batches_left == 0 && !self.is_unlimited
    }

    /// For when there may not be another pass.
    pub(super) fn lift_limit(&mut self) {
        self.is_unlimited = true;
    }

    /// Returns whether the loop goes on reading from the socket.
    #[inline]
    pub fn reads_on(&mut self, read: &Read, endpoint: &Endpoint) -> bool {
        self.read_len += read.len;
        self.patience = MIN_PATIENCE;
        let max_len = READ_LEN_PER_CONNECTION * endpoint.waiting_to_transmit().max(1);
        let reads_on = read.may_be_more && self.read_len < max_len.min(MAX_READ_LEN);
        if !reads_on {
            us_quic_stop_reading(udp::Socket::opaque_mut(read.socket));
        }
        reads_on
    }

    /// Whether to flush in the middle of a pass. `is_busy` is for when there are other peers to serve.
    #[inline]
    pub fn is_overdue(&mut self, is_busy: bool) -> bool {
        let patience = if is_busy { MAX_PATIENCE } else { self.patience };
        let is_overdue = now() - self.flushed_at >= patience;
        if is_overdue {
            self.patience = (patience * 2).clamp(MIN_PATIENCE, MAX_PATIENCE);
        }
        is_overdue
    }

    #[inline]
    pub(super) fn has_unsent(&self) -> bool {
        self.sent < self.messages.len()
    }

    /// `binding` finds the one that has this address. `visit` is for [`Endpoint::poll_transmit`]. `on_batch` is
    /// called before it is sent.
    pub fn flush(
        &mut self,
        endpoint: &mut Endpoint,
        binding: impl Fn(SocketAddr) -> Option<Binding>,
        mut visit: impl FnMut(&Connection),
        mut on_batch: impl FnMut(&Batch),
    ) {
        while !self.is_blocked
            && (self.has_unsent() || endpoint.wants_to_transmit() && !self.is_pass_over())
        {
            if !self.has_unsent() {
                self.batch.clear();
                let is_full =
                    endpoint.poll_transmit(now(), &mut self.batch, DATAGRAMS_PER_BATCH, &mut visit);
                self.batches_left = self.batches_left.saturating_sub(is_full.into());
                on_batch(&self.batch);
                self.address(&binding);
            }
            self.send(&binding);
        }
        endpoint.set_backed_up(self.is_blocked);
        self.flushed_at = now();
    }

    fn address(&mut self, binding: impl Fn(SocketAddr) -> Option<Binding>) {
        self.messages.clear();
        self.sent = 0;
        for (to, bytes, segment_len) in self.batch.runs() {
            let mut message = Message {
                local: to.local.into(),
                peer: to.peer.into(),
                start: bytes.start as u32,
                len: bytes.len() as u32,
                segment_len: segment_len as u16,
            };
            if bytes.len() <= segment_len {
                message.segment_len = 0;
            } else if self.has_failed_to_segment
                || !binding(to.local).is_some_and(|it| it.can_segment)
            {
                self.messages.extend(message.segments());
                continue;
            }
            self.messages.push(message);
        }
    }

    /// What the kernel refuses for good is as if it got lost on the way.
    fn send(&mut self, binding: impl Fn(SocketAddr) -> Option<Binding>) {
        let mut is_retry = false;
        while let unsent @ [first, ..] = &self.messages[self.sent..] {
            let Some(binding) = binding(first.local.into()) else {
                self.sent += 1;
                continue;
            };
            let count = (unsent.iter().take_while(|it| binding.has(it.local.into()))).count();
            // SAFETY: there are as many messages, and they are ranges of the bytes.
            let result = unsafe {
                us_quic_send(
                    udp::Socket::opaque_mut(binding.socket),
                    binding.address.ip().is_unspecified(),
                    self.batch.bytes().as_ptr(),
                    unsent.as_ptr(),
                    count,
                )
            };
            match result {
                0 => {
                    self.is_blocked = true;
                    return;
                }
                1.. => self.sent += result as usize,
                // udp(7): the error can be that of an earlier datagram to another peer.
                _ if !is_retry => {}
                _ if first.segment_len != 0 => {
                    let segments = first.segments();
                    self.messages.splice(self.sent..=self.sent, segments);
                    self.has_failed_to_segment |= result == -libc::EIO;
                }
                _ => self.sent += 1,
            }
            is_retry = result < 0 && !is_retry;
        }
    }
}
