//! The name servers, and what is known about each.

use core::net::SocketAddr;
use core::time::Duration;
use std::collections::VecDeque;

use bun_collections::index_sort;

use crate::system::{SocketId, Transport};

const MAX_FAILURES: u8 = 16;
const RETRY_DELAY: Duration = Duration::from_secs(5);

/// Stays with a server for as long as it is in the list.
pub(crate) type ServerId = u64;

pub(crate) struct Server {
    pub(crate) id: ServerId,
    pub(crate) address: SocketAddr,
    /// In the configuration.
    position: usize,
    /// In a row.
    failures: u8,
    retry_at: Duration,
    /// The last probe is over by then.
    probe_at: Duration,
    udp: Option<SocketId>,
    tcp: Option<SocketId>,
    pub(crate) latency: Latency,
}

impl Server {
    /// Lower is better.
    fn rank(&self) -> (u8, Duration, usize) {
        (self.failures, self.retry_at, self.position)
    }

    /// The one that took the last query. It may have been closed since.
    pub(crate) fn socket(&mut self, transport: Transport) -> &mut Option<SocketId> {
        match transport {
            Transport::Udp => &mut self.udp,
            Transport::Tcp => &mut self.tcp,
        }
    }
}

/// Best first.
#[derive(Default)]
pub(crate) struct Servers {
    list: VecDeque<Server>,
    last_id: ServerId,
}

impl Servers {
    pub(crate) fn len(&self) -> usize {
        self.list.len()
    }

    pub(crate) fn iter(&self) -> impl ExactSizeIterator<Item = &Server> {
        self.list.iter()
    }

    pub(crate) fn get(&mut self, id: ServerId) -> Option<&mut Server> {
        self.list.iter_mut().find(|server| server.id == id)
    }

    /// One that stays keeps its history.
    pub(crate) fn replace(&mut self, addresses: impl Iterator<Item = SocketAddr>) {
        let mut old = Vec::from(core::mem::take(&mut self.list));
        for address in addresses {
            let is_at_address = |server: &Server| {
                (server.address.ip(), server.address.port()) == (address.ip(), address.port())
            };
            if self.list.iter().any(is_at_address) {
                continue;
            }
            let position = self.list.len();
            let server = old.extract_if(.., |server| is_at_address(server)).next();
            let server = server.unwrap_or_else(|| {
                self.last_id += 1;
                Server {
                    id: self.last_id,
                    address,
                    position,
                    failures: 0,
                    retry_at: Duration::ZERO,
                    probe_at: Duration::ZERO,
                    udp: None,
                    tcp: None,
                    latency: Latency::default(),
                }
            });
            self.list.push_back(Server { position, ..server });
        }
        index_sort::sort_slice_unstable_by_key(self.list.make_contiguous(), Server::rank);
    }

    pub(crate) fn best(&mut self) -> Option<&mut Server> {
        self.list.front_mut()
    }

    pub(crate) fn one_of_the_best(&mut self, random: u16) -> Option<&mut Server> {
        let fewest = self.list.front().map(|server| server.failures);
        let count = self.list.partition_point(|it| Some(it.failures) == fewest);
        self.list.get_mut(usize::from(random).checked_rem(count)?)
    }

    pub(crate) fn any_failed(&self) -> bool {
        self.list.back().is_some_and(|server| server.failures > 0)
    }

    pub(crate) fn all_failed(&self) -> bool {
        self.list.front().is_some_and(|server| server.failures > 0)
    }

    /// One that may have come back, other than the best.
    pub(crate) fn next_to_probe(&mut self, now: Duration) -> Option<ServerId> {
        let mut others = self.list.iter_mut().skip(1);
        let server = others.find(|it| it.failures > 0 && it.retry_at.max(it.probe_at) <= now)?;
        server.probe_at = now.saturating_add(RETRY_DELAY);
        Some(server.id)
    }

    pub(crate) fn failed(&mut self, id: ServerId, now: Duration) {
        self.change(id, |server| {
            server.failures = MAX_FAILURES.min(server.failures + 1);
            server.retry_at = now.saturating_add(RETRY_DELAY);
        });
    }

    /// `took` is `None` if it tells nothing about the next query.
    pub(crate) fn answered(&mut self, id: ServerId, took: Option<Duration>, now: Duration) {
        self.change(id, |server| {
            server.failures = 0;
            server.retry_at = Duration::ZERO;
            if let Some(took) = took {
                server.latency.record(took, now);
            }
        });
    }

    fn change(&mut self, id: ServerId, change: impl FnOnce(&mut Server)) {
        let found = self.list.iter_mut().enumerate().find(|(_, it)| it.id == id);
        let misplaced = found.and_then(|(index, server)| {
            let rank = server.rank();
            change(server);
            (server.rank() != rank).then_some(index)
        });
        if let Some(server) = misplaced.and_then(|index| self.list.remove(index)) {
            let index = self.list.partition_point(|it| it.rank() < server.rank());
            self.list.insert(index, server);
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Samples {
    period: u64,
    total_ms: u64,
    count: u64,
}

impl Samples {
    fn average_ms(self, period: u64) -> Option<u64> {
        (self.period == period && self.count >= 3).then(|| self.total_ms / self.count)
    }
}

/// In seconds. The last does not end.
const PERIODS: [u64; 5] = [60, 15 * 60, 60 * 60, 24 * 60 * 60, u64::MAX];

/// How long a server took, in the current and the previous period of each length.
#[derive(Default)]
pub(crate) struct Latency([(Samples, Samples); PERIODS.len()]);

impl Latency {
    fn record(&mut self, took: Duration, now: Duration) {
        let took_ms = (took.as_millis() as u64).max(1);
        for ((current, previous), len) in self.0.iter_mut().zip(PERIODS) {
            let period = now.as_secs() / len;
            if current.period != period {
                *previous = core::mem::take(current);
                current.period = period;
            }
            current.total_ms += took_ms;
            current.count += 1;
        }
    }

    /// Over the shortest period that has enough samples.
    pub(crate) fn average_ms(&self, now: Duration) -> Option<u64> {
        let mut periods = self.0.iter().zip(PERIODS);
        periods.find_map(|((current, previous), len)| {
            let period = now.as_secs() / len;
            let average = current.average_ms(period);
            average.or_else(|| previous.average_ms(period.saturating_sub(1)))
        })
    }
}
