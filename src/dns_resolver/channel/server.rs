//! The name servers of a channel, and how long each one takes to answer.

use core::cmp::Reverse;
use core::net::{IpAddr, SocketAddr, SocketAddrV6};
use std::collections::VecDeque;

use super::ConnectionId;
use crate::io::{Time, Transport};

const DNS_PORT: u16 = 53;
/// Only the order of the counts matters. A cap bounds how long a server that was down for long
/// sorts behind the others.
const CONSECUTIVE_FAILURES_CAP: usize = 16;
/// How long a server that failed is left alone before a query may be copied to it to see whether
/// it is back.
const RETRY_DELAY_MS: u64 = 5000;

/// About the round trip half-way around the world.
const MIN_TIMEOUT_MS: u64 = 250;
/// RFC 1123's recommendation.
const MAX_TIMEOUT_MS: u64 = 5000;
/// An answer the server has to recurse for takes longer than one it has cached.
const AVERAGE_TIMEOUT_MULTIPLIER: u64 = 5;
const MIN_COUNT_FOR_AVERAGE: u64 = 3;

/// A server as configuration names it. A port of zero is the default one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ServerConfig {
    pub address: IpAddr,
    pub udp_port: u16,
    pub tcp_port: u16,
    /// The interface of a link-local IPv6 address.
    pub scope_id: u32,
}

impl ServerConfig {
    pub(super) fn at(address: IpAddr) -> ServerConfig {
        ServerConfig {
            address,
            udp_port: 0,
            tcp_port: 0,
            scope_id: 0,
        }
    }

    fn ports(&self) -> (u16, u16) {
        let or_default = |port: u16| if port == 0 { DNS_PORT } else { port };
        (or_default(self.udp_port), or_default(self.tcp_port))
    }

    /// The scope is not part of it: a server keeps its state when its scope changes.
    pub(super) fn is_same_server(&self, other: &ServerConfig) -> bool {
        self.address == other.address && self.ports() == other.ports()
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct ServerId(pub(super) u64);

/// The latencies of one span of time.
#[derive(Clone, Copy, Default)]
struct Tally {
    span: i64,
    total_ms: u64,
    count: u64,
}

impl Tally {
    fn average_of(&self, span: i64) -> Option<u64> {
        (self.span == span && self.count >= MIN_COUNT_FOR_AVERAGE)
            .then(|| self.total_ms / self.count)
    }
}

#[derive(Clone, Copy, Default)]
struct Bucket {
    current: Tally,
    previous: Tally,
}

/// Seconds: a minute, 15 minutes, an hour, a day. `None` is since the channel was made.
const BUCKET_SPANS: [Option<i64>; 5] = [
    Some(60),
    Some(15 * 60),
    Some(60 * 60),
    Some(24 * 60 * 60),
    None,
];

fn span_at(length: Option<i64>, now: Time) -> i64 {
    length.map_or(1, |length| now.sec / length)
}

fn previous_span_at(length: Option<i64>, now: Time) -> i64 {
    match length {
        Some(length) if length < now.sec => (now.sec - length) / length,
        _ => 0,
    }
}

pub(super) struct Server {
    pub(super) id: ServerId,
    /// Place in the configuration.
    pub(super) index: usize,
    /// `Channel::placements` when it last got a place among the servers.
    pub(super) placed: u64,
    /// With the ports it means.
    pub(super) config: ServerConfig,
    pub(super) consecutive_failures: usize,
    pub(super) next_retry_time: Time,
    pub(super) probe_pending: bool,
    /// The newest UDP connection first, the TCP connection last.
    pub(super) connections: VecDeque<ConnectionId>,
    pub(super) tcp_connection: Option<ConnectionId>,
    buckets: [Bucket; BUCKET_SPANS.len()],
}

impl Server {
    pub(super) fn new(id: ServerId, index: usize, config: &ServerConfig) -> Server {
        let (udp_port, tcp_port) = config.ports();
        Server {
            id,
            index,
            placed: 0,
            config: ServerConfig {
                udp_port,
                tcp_port,
                ..*config
            },
            consecutive_failures: 0,
            next_retry_time: Time::ZERO,
            probe_pending: false,
            connections: VecDeque::new(),
            tcp_connection: None,
            buckets: Default::default(),
        }
    }

    /// Fewest failures first, then the one that failed longest ago, then configuration order.
    /// While servers are replaced, one that goes may have the place of one that comes. As in
    /// c-ares's skip list, the last to be put there is first.
    pub(super) fn sort_key(&self) -> (usize, Time, usize, Reverse<u64>) {
        (
            self.consecutive_failures,
            self.next_retry_time,
            self.index,
            Reverse(self.placed),
        )
    }

    pub(super) fn socket_address(&self, transport: Transport) -> SocketAddr {
        let port = match transport {
            Transport::Udp => self.config.udp_port,
            Transport::Tcp => self.config.tcp_port,
        };
        match self.config.address {
            IpAddr::V4(address) => SocketAddr::new(address.into(), port),
            IpAddr::V6(address) => SocketAddrV6::new(address, port, 0, self.config.scope_id).into(),
        }
    }

    pub(super) fn count_failure(&mut self, now: Time) {
        if self.consecutive_failures < CONSECUTIVE_FAILURES_CAP {
            self.consecutive_failures += 1;
        }
        self.next_retry_time = now.plus_ms(RETRY_DELAY_MS);
    }

    pub(super) fn record_latency(&mut self, now: Time, sent_at: Time) {
        let ms = now.ms_since(sent_at).max(1);
        for (bucket, length) in self.buckets.iter_mut().zip(BUCKET_SPANS) {
            let span = span_at(length, now);
            if span != bucket.current.span {
                let fresh = Tally {
                    span,
                    ..Tally::default()
                };
                bucket.previous = core::mem::replace(&mut bucket.current, fresh);
            }
            bucket.current.count += 1;
            bucket.current.total_ms += ms;
        }
    }

    /// How long to wait for the first answer: five times the average of the most recent span with
    /// enough answers, else `configured_ms`.
    pub(super) fn timeout_ms(&self, now: Time, configured_ms: u64) -> u64 {
        let mut buckets = self.buckets.iter().zip(BUCKET_SPANS);
        let average = buckets.find_map(|(bucket, length)| {
            let current = bucket.current.average_of(span_at(length, now));
            current.or_else(|| bucket.previous.average_of(previous_span_at(length, now)))
        });
        average
            .map_or(configured_ms, |ms| ms * AVERAGE_TIMEOUT_MULTIPLIER)
            .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
    }
}
