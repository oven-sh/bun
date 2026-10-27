//! The name servers of a channel, and how long each one takes to answer.

use core::net::{IpAddr, SocketAddr, SocketAddrV6};
use std::collections::VecDeque;

use super::ConnId;
use crate::io::{Time, Transport};

pub(crate) const DNS_PORT: u16 = 53;
/// Only the order of the counts matters. A cap bounds how long a server that was down for long sorts behind the others.
const CONSECUTIVE_FAILURES_CAP: usize = 16;

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
    pub(crate) fn ports(&self) -> (u16, u16) {
        let or_default = |port: u16| if port == 0 { DNS_PORT } else { port };
        (or_default(self.udp_port), or_default(self.tcp_port))
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct ServerId(pub(super) u64);

/// Latency over one span of time and over the span before it.
#[derive(Clone, Copy, Default)]
struct Bucket {
    span: i64,
    total_ms: u64,
    count: u64,
    previous_span: i64,
    previous_total_ms: u64,
    previous_count: u64,
}

/// Seconds: a minute, 15 minutes, an hour, a day. `None` is since the channel was made.
const BUCKET_SPANS: [Option<i64>; 5] = [
    Some(60),
    Some(15 * 60),
    Some(60 * 60),
    Some(24 * 60 * 60),
    None,
];

fn span_at(length: Option<i64>, now: Time, previous: bool) -> i64 {
    match (length, previous) {
        (None, false) => 1,
        (None, true) => 0,
        (Some(length), false) => now.sec / length,
        (Some(length), true) if length >= now.sec => 0,
        (Some(length), true) => (now.sec - length) / length,
    }
}

pub(crate) struct Server {
    pub(crate) id: ServerId,
    /// Place in the configuration.
    pub(crate) index: usize,
    pub(crate) address: IpAddr,
    pub(crate) udp_port: u16,
    pub(crate) tcp_port: u16,
    pub(crate) scope_id: u32,
    pub(crate) consecutive_failures: usize,
    pub(crate) next_retry_time: Time,
    pub(crate) probe_pending: bool,
    /// The newest UDP connection first, the TCP connection last.
    pub(crate) connections: VecDeque<ConnId>,
    pub(crate) tcp_connection: Option<ConnId>,
    buckets: [Bucket; BUCKET_SPANS.len()],
}

impl Server {
    pub(crate) fn new(id: ServerId, index: usize, config: &ServerConfig) -> Server {
        let (udp_port, tcp_port) = config.ports();
        Server {
            id,
            index,
            address: config.address,
            udp_port,
            tcp_port,
            scope_id: config.scope_id,
            consecutive_failures: 0,
            next_retry_time: Time::ZERO,
            probe_pending: false,
            connections: VecDeque::new(),
            tcp_connection: None,
            buckets: Default::default(),
        }
    }

    pub(crate) fn is(&self, config: &ServerConfig) -> bool {
        self.address == config.address && (self.udp_port, self.tcp_port) == config.ports()
    }

    /// Fewest failures first, then the one that failed longest ago, then configuration order.
    pub(crate) fn sort_key(&self) -> (usize, Time, usize) {
        (self.consecutive_failures, self.next_retry_time, self.index)
    }

    pub(crate) fn socket_address(&self, transport: Transport) -> SocketAddr {
        let port = match transport {
            Transport::Udp => self.udp_port,
            Transport::Tcp => self.tcp_port,
        };
        match self.address {
            IpAddr::V4(_) => SocketAddr::new(self.address, port),
            IpAddr::V6(address) => SocketAddrV6::new(address, port, 0, self.scope_id).into(),
        }
    }

    pub(crate) fn count_failure(&mut self, now: Time, retry_delay_ms: u64) {
        if self.consecutive_failures < CONSECUTIVE_FAILURES_CAP {
            self.consecutive_failures += 1;
        }
        self.next_retry_time = now.plus_ms(retry_delay_ms);
    }

    pub(crate) fn record_latency(&mut self, now: Time, sent_at: Time) {
        let ms = now.ms_since(sent_at).max(1);
        for (bucket, length) in self.buckets.iter_mut().zip(BUCKET_SPANS) {
            let span = span_at(length, now, false);
            if span != bucket.span {
                *bucket = Bucket {
                    span,
                    total_ms: 0,
                    count: 0,
                    previous_span: bucket.span,
                    previous_total_ms: bucket.total_ms,
                    previous_count: bucket.count,
                };
            }
            bucket.count += 1;
            bucket.total_ms += ms;
        }
    }

    /// How long to wait for the first answer: five times the average of the most recent span with enough answers, else `configured_ms`.
    pub(crate) fn timeout_ms(&self, now: Time, configured_ms: u64) -> u64 {
        let mut timeout_ms = 0;
        for (bucket, length) in self.buckets.iter().zip(BUCKET_SPANS) {
            let average = if span_at(length, now, false) == bucket.span
                && bucket.count >= MIN_COUNT_FOR_AVERAGE
            {
                bucket.total_ms / bucket.count
            } else if span_at(length, now, true) == bucket.previous_span
                && bucket.previous_count >= MIN_COUNT_FOR_AVERAGE
            {
                bucket.previous_total_ms / bucket.previous_count
            } else {
                continue;
            };
            timeout_ms = average * AVERAGE_TIMEOUT_MULTIPLIER;
            break;
        }
        if timeout_ms == 0 {
            timeout_ms = configured_ms;
        }
        timeout_ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
    }
}
