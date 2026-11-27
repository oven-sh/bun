//! The name servers, and what is known about each.

use core::net::SocketAddr;
use core::time::Duration;
use std::collections::VecDeque;

use bun_collections::index_sort;

use crate::Error;
use crate::system::{SocketId, Transport};

const MAX_FAILURES: u8 = 16;
const RETRY_DELAY: Duration = Duration::from_secs(5);

/// Stays with a server for as long as it is in the list.
pub(crate) type ServerId = u64;

/// By position. Those that are 64 apart count as one.
#[derive(Clone, Copy, Default)]
pub(crate) struct ServerSet(u64);

impl ServerSet {
    pub(crate) fn contains(self, server: &Server) -> bool {
        self.0 >> (server.position % 64) & 1 == 1
    }

    pub(crate) fn insert(&mut self, server: &Server) {
        self.0 |= 1 << (server.position % 64);
    }
}

/// Which server can be chosen in place of one that is avoided.
#[derive(Clone, Copy)]
pub(crate) enum Alternate {
    /// One that works or has timed out as often.
    Equal,
    /// Also one whose `outage` is at most `RETRY_DELAY` longer.
    Similar,
    Any,
}

pub(crate) struct Server {
    pub(crate) id: ServerId,
    pub(crate) address: SocketAddr,
    /// In the configuration.
    position: usize,
    /// In a row.
    failures: u8,
    /// Numbered across the servers, as many happen at the same time.
    last_failure: u64,
    /// Of that one.
    pub(crate) last_error: Option<Error>,
    /// From the first failure to the last, without most of the time in which it was not asked.
    outage: Duration,
    retry_at: Duration,
    /// The last probe is over by then.
    probe_at: Duration,
    udp: Option<SocketId>,
    tcp: Option<SocketId>,
    /// The last one that is kept for late replies.
    pub(crate) retired_tcp: Option<SocketId>,
    pub(crate) retired_tcp_at: Duration,
    /// Until then, a refusal says nothing about its load.
    pub(crate) refuses_until: Duration,
    pub(crate) latency: Latency,
}

impl Server {
    /// Lower is better.
    fn rank(&self) -> (u8, u64, usize) {
        (self.failures, self.last_failure, self.position)
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
    last_failure: u64,
    /// There is none to probe until then.
    probe_at: Duration,
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

    /// One that stays keeps its history. Returns whether any was added or removed.
    pub(crate) fn replace(&mut self, addresses: impl Iterator<Item = SocketAddr>) -> bool {
        let mut old = Vec::from(core::mem::take(&mut self.list));
        let last_id = self.last_id;
        for address in addresses {
            let is_at_address = |server: &Server| {
                (server.address.ip(), server.address.port()) == (address.ip(), address.port())
            };
            if self.list.iter().any(is_at_address) {
                continue;
            }
            let position = self.list.len();
            // An address without a scope id keeps the one it had.
            let has_scope_id = matches!(address, SocketAddr::V6(it) if it.scope_id() != 0);
            let stays = |server: &mut Server| {
                is_at_address(server) && (!has_scope_id || server.address == address)
            };
            let server = old.extract_if(.., stays).next();
            let server = server.unwrap_or_else(|| {
                self.last_id += 1;
                Server {
                    id: self.last_id,
                    address,
                    position,
                    failures: 0,
                    last_failure: 0,
                    last_error: None,
                    outage: Duration::ZERO,
                    retry_at: Duration::ZERO,
                    probe_at: Duration::ZERO,
                    udp: None,
                    tcp: None,
                    retired_tcp: None,
                    retired_tcp_at: Duration::ZERO,
                    refuses_until: Duration::ZERO,
                    latency: Latency::default(),
                }
            });
            self.list.push_back(Server { position, ..server });
        }
        index_sort::sort_slice_unstable_by_key(self.list.make_contiguous(), Server::rank);
        self.last_id != last_id || !old.is_empty()
    }

    /// The best, or with `random` one of the best. If it is `avoided` and has no `alternate`, `avoided` is cleared.
    pub(crate) fn choose(
        &mut self,
        random: Option<u16>,
        avoided: &mut ServerSet,
        alternate: Alternate,
    ) -> Option<&mut Server> {
        let fewest = self.list.front()?.failures;
        let mut index = random.map_or(0, |random| {
            usize::from(random) % self.list.partition_point(|it| it.failures == fewest)
        });
        if let Some(best) = self.list.get(index).filter(|it| avoided.contains(it)) {
            let longest = best.outage + RETRY_DELAY;
            let will_do = |it: &Server| match (alternate, it.last_error) {
                (Alternate::Any, _) | (_, None) => true,
                (_, Some(Error::ETIMEOUT)) if it.failures == fewest => true,
                (Alternate::Similar, Some(Error::ETIMEOUT)) => it.outage <= longest,
                _ => false,
            };
            let mut others = self.list.iter();
            match others.position(|it| !avoided.contains(it) && will_do(it)) {
                Some(other) => index = other,
                None => *avoided = ServerSet::default(),
            }
        }
        self.list.get_mut(index)
    }

    pub(crate) fn any_failed(&self) -> bool {
        self.list.back().is_some_and(|server| server.failures > 0)
    }

    pub(crate) fn all_failed(&self) -> bool {
        self.list.front().is_some_and(|server| server.failures > 0)
    }

    /// One that may have come back, other than the best.
    pub(crate) fn next_to_probe(&mut self, now: Duration) -> Option<ServerId> {
        if now < self.probe_at {
            return None;
        }
        let due = |it: &Server| (it.failures > 0).then(|| it.retry_at.max(it.probe_at));
        self.probe_at = self.list.iter().filter_map(due).min().unwrap_or_default();
        let mut others = self.list.iter_mut().skip(1);
        let server = others.find(|it| due(it).is_some_and(|due| due <= now))?;
        server.probe_at = now.saturating_add(RETRY_DELAY);
        Some(server.id)
    }

    pub(crate) fn failed(&mut self, id: ServerId, error: Error, now: Duration) {
        self.last_failure += 1;
        let number = self.last_failure;
        let retry_at = now.saturating_add(RETRY_DELAY);
        self.change(id, |server| {
            if server.failures > 0 {
                server.outage += RETRY_DELAY.min(retry_at.saturating_sub(server.retry_at));
            }
            server.failures = MAX_FAILURES.min(server.failures + 1);
            server.last_failure = number;
            server.last_error = Some(error);
            server.retry_at = retry_at;
        });
    }

    /// `took` is `None` if it tells nothing about the next query.
    pub(crate) fn answered(&mut self, id: ServerId, took: Option<Duration>, now: Duration) {
        self.change(id, |server| {
            server.failures = 0;
            server.last_failure = 0;
            server.last_error = None;
            server.outage = Duration::ZERO;
            if let Some(took) = took {
                server.latency.record(took, now);
            }
        });
    }

    pub(crate) fn change(&mut self, id: ServerId, change: impl FnOnce(&mut Server)) {
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
    pub(crate) fn average(&self, now: Duration) -> Option<Duration> {
        let mut periods = self.0.iter().zip(PERIODS);
        let average_ms = periods.find_map(|((current, previous), len)| {
            let period = now.as_secs() / len;
            let average = current.average_ms(period);
            average.or_else(|| previous.average_ms(period.saturating_sub(1)))
        });
        average_ms.map(Duration::from_millis)
    }
}
