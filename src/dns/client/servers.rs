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
    fn contains(self, server: &Server) -> bool {
        self.0 >> (server.position % 64) & 1 == 1
    }

    pub(crate) fn insert(&mut self, server: &Server) {
        self.0 |= 1 << (server.position % 64);
    }
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

/// Where the servers come from.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Origin {
    /// The user or the system named them.
    Named,
    /// The system named none, and the one on this machine stands in.
    StandIn,
}

/// Best first.
#[derive(Default)]
pub(crate) struct Servers {
    list: VecDeque<Server>,
    is_stand_in: bool,
    /// The failure up to which the configuration was read again.
    read_after: u64,
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

    /// One that stays keeps its history.
    pub(crate) fn replace(&mut self, addresses: impl Iterator<Item = SocketAddr>, origin: Origin) {
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
        self.is_stand_in = origin == Origin::StandIn;
    }

    /// Whether the system may name a server by now. Node.js asks so of any one loopback server that setServers() did not name: https://github.com/nodejs/node/blob/bc2e01dcf6acd5cf7d169b5f26cf89abaaeb41f1/src/cares_wrap.cc#L992-L1040
    pub(crate) fn is_in_doubt(&self) -> bool {
        let refuses = |server: &Server| {
            server.last_error == Some(Error::ECONNREFUSED) && server.last_failure > self.read_after
        };
        self.is_stand_in && self.list.back().is_some_and(refuses)
    }

    /// The list is in doubt again once it refuses again.
    pub(crate) fn forget_refusal(&mut self) {
        self.read_after = self.last_failure;
    }

    /// The best, or with `random` one of the best. One that is `avoided` gives way to one that works
    /// or has timed out as often or, `out_of_turn`, not for much longer. Otherwise all are forgiven.
    pub(crate) fn choose(
        &mut self,
        random: Option<u16>,
        avoided: &mut ServerSet,
        out_of_turn: bool,
    ) -> Option<&mut Server> {
        let fewest = self.list.front()?.failures;
        let mut index = random.map_or(0, |random| {
            usize::from(random) % self.list.partition_point(|it| it.failures == fewest)
        });
        if let Some(best) = self.list.get(index).filter(|it| avoided.contains(it)) {
            let longest = best.outage + RETRY_DELAY;
            let will_do = |it: &Server| match it.last_error {
                Some(Error::ETIMEOUT) => {
                    it.failures == fewest || (out_of_turn && it.outage <= longest)
                }
                error => error.is_none(),
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
