//! Sending queries, and what happens when a socket is ready or time runs out.

use core::cmp::Reverse;
use std::collections::VecDeque;

use super::connection::ConnectionId;
use super::server::ServerId;
use super::{Channel, Owner, Query, SERVER_RETRY_CHANCE, Serial};
use crate::io::{Socket, Time, Transport};
use crate::message::{Message, RData, flag, rcode};
use crate::{Error, Result};

const COOKIE_OPTION: u16 = 10;
/// RFC 7873 section 4: a client cookie of 8 bytes, then a server cookie of 8 to 32 if there is one.
const COOKIE_LEN: core::ops::RangeInclusive<usize> = 8..=40;

/// Work put off until the loop over a connection's messages, or over the deadlines, is done,
/// because it can close that connection.
pub(super) enum Deferred {
    /// To whichever server is best by then.
    Send,
    End(Result<Message>),
}

pub(super) type DeferredList = VecDeque<(Serial, Deferred)>;

impl Channel {
    /// To be called when a socket is ready for what [`crate::io::Io::watch`] named.
    pub fn socket_ready(&mut self, now: Time, socket: Socket, readable: bool, writable: bool) {
        if writable && let Some(id) = self.connection_of_socket(socket) {
            self.process_write(now, id);
        }
        if readable && let Some(id) = self.connection_of_socket(socket) {
            self.process_read(now, id);
        }
        self.check_timeouts(now);
    }

    /// To be called at [`Channel::next_deadline`].
    pub fn check_timeouts(&mut self, now: Time) {
        let mut deferred = DeferredList::new();
        while let Some(first @ (time, _, serial)) = self.deadlines.first().copied()
            && time <= now
        {
            if let Some((connection, server)) = self.queries.get(&serial).and_then(|it| it.sent_on)
            {
                if let Some(connection) = self.connections.get_mut(&connection) {
                    connection.retired = true;
                }
                self.count_server_failure(now, server);
            }
            self.requeue_query(now, serial, Some(Error::ETIMEOUT), Some(&mut deferred));
            // So that the loop ends even if the query is gone.
            self.deadlines.remove(&first);
        }
        self.run_deferred(now, deferred);
        self.close_idle_connections(now);
    }

    fn process_write(&mut self, now: Time, id: ConnectionId) {
        if let Some(connection) = self.connections.get_mut(&id)
            && !connection.fast_open_pending
        {
            connection.connected = true;
        }
        if let Err(error) = self.flush(id) {
            self.connection_failed(now, id, error);
        }
    }

    fn process_read(&mut self, now: Time, id: ConnectionId) {
        let failed = self.read_socket(id);
        // What the socket delivered before it failed still counts.
        self.read_responses(now, id);
        if failed {
            self.connection_failed(now, id, Error::ECONNREFUSED);
        }
    }

    fn read_responses(&mut self, now: Time, id: ConnectionId) {
        let mut deferred = DeferredList::new();
        let mut received = match self.connections.get_mut(&id) {
            Some(connection) => core::mem::take(&mut connection.received),
            None => return,
        };
        let mut rest = received.as_slice();
        while let [high, low, after @ ..] = rest
            && let Some((bytes, after)) =
                after.split_at_checked(usize::from(u16::from_be_bytes([*high, *low])))
        {
            rest = after;
            if let Err(error) = self.process_response(now, id, bytes, &mut deferred) {
                self.connection_failed(now, id, error);
                break;
            }
        }
        if let Some(connection) = self.connections.get_mut(&id) {
            let consumed = received.len() - rest.len();
            received.drain(..consumed);
            connection.received = received;
        }
        self.run_deferred(now, deferred);
    }

    /// An error closes the connection. That is the caller's to do.
    fn process_response(
        &mut self,
        now: Time,
        id: ConnectionId,
        bytes: &[u8],
        deferred: &mut DeferredList,
    ) -> Result<()> {
        // A datagram may be empty.
        if bytes.is_empty() {
            return Ok(());
        }
        let response = match Message::parse(bytes) {
            Ok(response) => response,
            Err(_) if self.is_stray_datagram(id, bytes) => return Ok(()),
            Err(_) => return Err(Error::EBADRESP),
        };

        let Some(connection) = self.connections.get(&id) else {
            return Ok(());
        };
        let Some(serial) = self.serial_of_id.get(&response.id).copied() else {
            return Ok(());
        };
        let Some(query) = self.queries.get_mut(&serial) else {
            return Ok(());
        };
        // RFC 5452 section 9.1: the same question, from the server that was asked.
        if !same_question(&query.message, &response)
            || query.sent_on.map(|(connection, _)| connection) != Some(id)
            || has_malformed_cookie(&response)
        {
            return Ok(());
        }
        let server = connection.server;

        if response.flags & flag::TC != 0 && connection.transport == Transport::Udp {
            query.transport = Transport::Tcp;
            self.defer(deferred, serial, Deferred::Send);
            return Ok(());
        }

        self.cache.insert(now, &query.cache_key, &response);
        self.clear_server_failures(server);
        self.end_query(now, Some(server), serial, Ok(response), Some(deferred));
        Ok(())
    }

    /// Whoever guesses the port can send a datagram. To end the connection with one takes the id
    /// of a query on it as well.
    fn is_stray_datagram(&self, id: ConnectionId, bytes: &[u8]) -> bool {
        let is_udp = (self.connections.get(&id)).is_some_and(|it| it.transport == Transport::Udp);
        let query = bytes
            .first_chunk()
            .and_then(|id| self.serial_of_id.get(&u16::from_be_bytes(*id)))
            .and_then(|serial| self.queries.get(serial));
        let sent_on = query.and_then(|query| query.sent_on);
        is_udp && sent_on.map(|(connection, _)| connection) != Some(id)
    }

    fn remove_from_connection(&mut self, serial: Serial) {
        let Some(query) = self.queries.get_mut(&serial) else {
            return;
        };
        if let Some(time) = query.deadline.take() {
            self.deadlines
                .remove(&(time, Reverse(query.send_order), serial));
        }
        if let Some((connection, _)) = query.sent_on.take()
            && let Some(connection) = self.connections.get_mut(&connection)
        {
            connection.queries.remove(&(query.send_order, serial));
        }
    }

    pub(super) fn detach_query(&mut self, serial: Serial) -> Option<Query> {
        self.remove_from_connection(serial);
        let query = self.queries.remove(&serial)?;
        self.serial_of_id.remove(&query.message.id);
        Some(query)
    }

    fn defer(&mut self, deferred: &mut DeferredList, serial: Serial, what: Deferred) {
        self.remove_from_connection(serial);
        deferred.push_back((serial, what));
    }

    /// A send that fails adds to the list rather than recursing.
    fn run_deferred(&mut self, now: Time, mut deferred: DeferredList) {
        while let Some((serial, what)) = deferred.pop_front() {
            match what {
                Deferred::Send => {
                    if self.queries.contains_key(&serial) {
                        self.send_query_deferring(now, None, serial, &mut deferred);
                    }
                }
                Deferred::End(result) => {
                    if let Some(query) = self.detach_query(serial) {
                        self.finish(now, query.owner, result);
                    }
                }
            }
        }
    }

    /// After a try failed, for `reason` if there is one to give: sends the query again if it has
    /// tries left, else ends it with the last reason.
    pub(super) fn requeue_query(
        &mut self,
        now: Time,
        serial: Serial,
        reason: Option<Error>,
        deferred: Option<&mut DeferredList>,
    ) {
        let max_tries = self.servers.len() * self.tries;
        let Some(query) = self.queries.get_mut(&serial) else {
            return;
        };
        let server = query.sent_on.map(|(_, server)| server);
        query.last_error = reason.or(query.last_error);
        query.try_count += 1;
        if query.try_count >= max_tries || query.no_retries {
            let error = query.last_error.unwrap_or(Error::ETIMEOUT);
            return self.end_query(now, server, serial, Err(error), deferred);
        }
        match deferred {
            Some(deferred) => self.defer(deferred, serial, Deferred::Send),
            None => {
                self.remove_from_connection(serial);
                self.send_query(now, None, serial);
            }
        }
    }

    fn end_query(
        &mut self,
        now: Time,
        server: Option<ServerId>,
        serial: Serial,
        result: Result<Message>,
        deferred: Option<&mut DeferredList>,
    ) {
        let sent_at = self.queries.get(&serial).map(|query| query.sent_at);
        if let Some(server) = server.and_then(|id| self.server_mut(id)) {
            server.probe_pending = false;
            if let Some(sent_at) = sent_at
                && let Ok(rcode::NOERROR | rcode::NXDOMAIN) = result.as_ref().map(|it| it.rcode)
            {
                server.record_latency(now, sent_at);
            }
        }
        match deferred {
            Some(deferred) => self.defer(deferred, serial, Deferred::End(result)),
            None => {
                if let Some(query) = self.detach_query(serial) {
                    self.finish(now, query.owner, result);
                }
            }
        }
    }

    /// To `server`, or to the best one. When this returns, the query waits for a response or is
    /// gone.
    pub(super) fn send_query(&mut self, now: Time, server: Option<ServerId>, serial: Serial) {
        let mut deferred = DeferredList::new();
        self.send_query_deferring(now, server, serial, &mut deferred);
        self.run_deferred(now, deferred);
    }

    fn pick_server(&mut self) -> Option<ServerId> {
        let first = self.servers.first()?;
        if !self.rotate {
            return Some(first.id);
        }
        let fewest_failures = first.consecutive_failures;
        let best = self
            .servers
            .iter()
            .take_while(|server| server.consecutive_failures == fewest_failures)
            .count();
        let mut byte = [0];
        self.io.random(&mut byte);
        let [byte] = byte;
        self.servers
            .get(usize::from(byte) % best)
            .map(|server| server.id)
    }

    fn connection_for(&self, server: ServerId, transport: Transport) -> Option<ConnectionId> {
        let server = self.server(server)?;
        if transport == Transport::Tcp {
            return server.tcp_connection;
        }
        let newest = *server.connections.front()?;
        let connection = self.connections.get(&newest)?;
        (connection.transport == Transport::Udp && !connection.retired).then_some(newest)
    }

    /// [`Channel::send_query`], but what a failure leads to is left on `deferred`.
    fn send_query_deferring(
        &mut self,
        now: Time,
        requested_server: Option<ServerId>,
        serial: Serial,
        deferred: &mut DeferredList,
    ) {
        let Some(server) = requested_server.or_else(|| self.pick_server()) else {
            return self.end_query(now, None, serial, Err(Error::ENOSERVER), Some(deferred));
        };
        let Some(query) = self.queries.get(&serial) else {
            return;
        };
        let transport = query.transport;
        // When every server has failed, a probe is the only way one that is back and sorts behind
        // the best gets noticed.
        let may_probe = requested_server.is_none() && query.try_count == 0;
        let bytes = query.message.write(0);

        let connection = match self.connection_for(server, transport) {
            Some(connection) => connection,
            None => match self.open_connection(server, transport) {
                Ok(connection) => connection,
                Err(error) => {
                    self.count_server_failure(now, server);
                    return self.requeue_query(now, serial, Some(error), Some(deferred));
                }
            },
        };

        match bytes.and_then(|bytes| self.write_query(connection, &bytes)) {
            Ok(()) => {}
            Err(Error::ECONNREFUSED) => {
                self.connection_failed(now, connection, Error::ECONNREFUSED);
                return self.requeue_query(now, serial, Some(Error::ECONNREFUSED), Some(deferred));
            }
            Err(error) => {
                self.count_server_failure(now, server);
                return self.requeue_query(now, serial, Some(error), Some(deferred));
            }
        }

        let deadline = now.plus_ms(self.query_timeout_ms(now, server, serial));
        if let Some(query) = self.queries.get_mut(&serial) {
            self.last_send_order += 1;
            query.sent_at = now;
            query.deadline = Some(deadline);
            query.sent_on = Some((connection, server));
            query.send_order = self.last_send_order;
            self.deadlines
                .insert((deadline, Reverse(query.send_order), serial));
            if let Some(connection) = self.connections.get_mut(&connection) {
                connection.queries.insert((query.send_order, serial));
            }
        }

        if may_probe {
            self.probe_failed_server(now, server, serial);
        }
    }

    /// Doubles with every round through the servers, less up to half at random so that clients do
    /// not retry in step.
    fn query_timeout_ms(&mut self, now: Time, server: ServerId, serial: Serial) -> u64 {
        let (Some(server), Some(query)) = (self.server(server), self.queries.get(&serial)) else {
            return 0;
        };
        let base = server.timeout_ms(now, self.timeout_ms);
        let rounds = query.try_count / self.servers.len().max(1);
        if rounds == 0 {
            return base;
        }
        let doubled = u32::try_from(rounds)
            .ok()
            .and_then(|rounds| base.checked_shl(rounds))
            .filter(|doubled| doubled >> rounds == base)
            .unwrap_or(u64::MAX);
        let jitter = f32::from(self.random_u16()) / f32::from(u16::MAX) * 0.5;
        (doubled - (doubled as f32 * jitter) as u64).max(base)
    }

    /// Now and then, sends a copy of the query just sent to `current` to a server that has failed.
    fn probe_failed_server(&mut self, now: Time, current: ServerId, serial: Serial) {
        if self
            .servers
            .last()
            .is_none_or(|worst| worst.consecutive_failures == 0)
            || !self.random_u16().is_multiple_of(SERVER_RETRY_CHANCE)
        {
            return;
        }
        let due = self.servers.iter_mut().find(|server| {
            server.id != current
                && server.consecutive_failures > 0
                && !server.probe_pending
                && server.next_retry_time <= now
        });
        let (Some(server), Some(query)) = (due, self.queries.get(&serial)) else {
            return;
        };
        server.probe_pending = true;
        let server = server.id;
        let message = query.message.clone();
        self.start_query(now, &message, Owner::Probe { server });
    }
}

fn same_question(query: &Message, response: &Message) -> bool {
    let (asked, echoed) = (&query.question, &response.question);
    (asked.qtype, asked.qclass) == (echoed.qtype, echoed.qclass)
        && asked.name.eq_ignore_ascii_case(&echoed.name)
}

/// RFC 7873 section 5.3: dropped, though no cookie was sent.
fn has_malformed_cookie(response: &Message) -> bool {
    let Some(RData::Opt { options, .. }) = response.opt().map(|rr| &rr.data) else {
        return false;
    };
    options
        .iter()
        .find(|option| option.id == COOKIE_OPTION)
        .is_some_and(|cookie| !cookie.value.is_empty() && !COOKIE_LEN.contains(&cookie.value.len()))
}
