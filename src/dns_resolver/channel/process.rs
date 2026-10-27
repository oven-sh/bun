//! Sending queries, and what happens when a socket is ready or time runs out.

use core::cmp::Reverse;

use super::conn::{ConnId, Read};
use super::server::ServerId;
use super::{Channel, Owner, Query, SERVER_RETRY_CHANCE, SendFlags, Serial, Status};
use crate::Error;
use crate::io::{Socket, Time, Transport};
use crate::record::{RData, Record, flag, rcode};

const COOKIE_OPTION: u16 = 10;

/// What is left to do for a query once the code that found it out has let go of the connection.
pub(super) enum Deferred {
    /// `None`: whichever server is best by then.
    Send(Option<ServerId>),
    End(Status, Option<Record>),
}

pub(super) type DeferredList = Vec<(Serial, Deferred)>;

impl Channel {
    /// To be called when a socket [`Io::watch`] named is ready, and at [`Channel::next_timeout`] with no socket.
    pub fn process(&mut self, now: Time, readable: Option<Socket>, writable: Option<Socket>) {
        if let Some(id) = writable.and_then(|socket| self.conn_of_socket(socket)) {
            self.process_write(now, id);
        }
        if let Some(id) = readable.and_then(|socket| self.conn_of_socket(socket)) {
            self.process_read(now, id);
        }
        self.process_timeouts(now);
        self.close_idle_connections(now);
    }

    fn process_write(&mut self, now: Time, id: ConnId) {
        if let Some(conn) = self.conns.get_mut(&id) {
            conn.became_writable();
        }
        if let Err(error) = self.flush(id) {
            self.connection_failed(now, id, true, Err(error));
        }
    }

    fn process_read(&mut self, now: Time, id: ConnId) {
        let failed = match self.read_packets(now, id) {
            Read::All => false,
            Read::ThenFailed => true,
            Read::Closed => return,
        };
        if self.read_answers(now, id).is_ok() && failed {
            self.connection_failed(now, id, true, Err(Error::ECONNREFUSED));
        }
    }

    fn read_answers(&mut self, now: Time, id: ConnId) -> Status {
        let mut deferred = DeferredList::new();
        let mut status = Ok(());
        let mut in_buf = match self.conns.get_mut(&id) {
            Some(conn) => core::mem::take(&mut conn.in_buf),
            None => return Ok(()),
        };
        let mut rest = in_buf.as_slice();
        while let [high, low, after @ ..] = rest
            && let Some((message, after)) =
                after.split_at_checked(usize::from(u16::from_be_bytes([*high, *low])))
        {
            rest = after;
            status = self.process_answer(now, id, message, &mut deferred);
            if status.is_err() {
                self.connection_failed(now, id, true, status);
                break;
            }
        }
        if let Some(conn) = self.conns.get_mut(&id) {
            let consumed = in_buf.len() - rest.len();
            in_buf.drain(..consumed);
            conn.in_buf = in_buf;
        }
        self.run_deferred(now, deferred);
        status
    }

    /// An error closes the connection. That is the caller's to do.
    fn process_answer(
        &mut self,
        now: Time,
        id: ConnId,
        message: &[u8],
        deferred: &mut DeferredList,
    ) -> Status {
        // A datagram may be empty.
        if message.is_empty() {
            return Ok(());
        }
        let answer = Record::parse(message).map_err(|_| Error::EBADRESP)?;

        let Some(conn) = self.conns.get_mut(&id) else {
            return Ok(());
        };
        let Some(serial) = self.serial_of_qid.get(&answer.id).copied() else {
            return Ok(());
        };
        let Some(query) = self.queries.get_mut(&serial) else {
            return Ok(());
        };
        // RFC 5452 section 9.1: the same question, from the server that was asked.
        if !same_questions(&query.record, &answer)
            || query.sent_on.map(|(conn, _)| conn) != Some(id)
            || has_malformed_cookie(&answer)
        {
            return Ok(());
        }
        let server = conn.server;
        conn.queries.remove(&(query.send_order, serial));

        if answer.flags & flag::TC != 0 && conn.transport == Transport::Udp {
            query.using_tcp = true;
            self.defer(deferred, serial, Deferred::Send(None));
            return Ok(());
        }

        let _ = self.cache.insert(now, &query.cache_key, &answer);
        self.server_is_good(server);
        self.end_query(
            now,
            Some(server),
            serial,
            Ok(()),
            Some(answer),
            Some(deferred),
        );
        Ok(())
    }

    fn process_timeouts(&mut self, now: Time) {
        let mut deferred = DeferredList::new();
        while let Some(first @ (time, _, serial)) = self.timeouts.first().copied()
            && time <= now
        {
            if let Some((conn, server)) = self.queries.get(&serial).and_then(|it| it.sent_on) {
                if let Some(conn) = self.conns.get_mut(&conn) {
                    conn.retired = true;
                }
                self.count_server_failure(now, server);
            }
            let timed_out = Err(Error::ETIMEOUT);
            let _ = self.requeue_query(now, serial, timed_out, true, None, Some(&mut deferred));
            self.timeouts.remove(&first);
        }
        self.run_deferred(now, deferred);
    }

    fn remove_from_connection(&mut self, serial: Serial) {
        let Some(query) = self.queries.get_mut(&serial) else {
            return;
        };
        if let Some(time) = query.timeout.take() {
            self.timeouts
                .remove(&(time, Reverse(query.send_order), serial));
        }
        if let Some((conn, _)) = query.sent_on.take()
            && let Some(conn) = self.conns.get_mut(&conn)
        {
            conn.queries.remove(&(query.send_order, serial));
        }
    }

    pub(super) fn detach_query(&mut self, serial: Serial) -> Option<Query> {
        self.remove_from_connection(serial);
        let query = self.queries.remove(&serial)?;
        self.serial_of_qid.remove(&query.qid);
        Some(query)
    }

    fn defer(&mut self, deferred: &mut DeferredList, serial: Serial, what: Deferred) {
        self.remove_from_connection(serial);
        deferred.push((serial, what));
    }

    /// A send that fails adds to the list rather than recursing.
    fn run_deferred(&mut self, now: Time, mut deferred: DeferredList) {
        let mut next = 0;
        while let Some((serial, what)) = deferred.get_mut(next) {
            let serial = *serial;
            let what = core::mem::replace(what, Deferred::Send(None));
            next += 1;
            match what {
                Deferred::Send(server) => {
                    let server = server.filter(|id| self.server(*id).is_some());
                    if self.queries.contains_key(&serial) {
                        let _ = self.send_query_deferring(now, server, serial, &mut deferred);
                    }
                }
                Deferred::End(status, answer) => {
                    if let Some(query) = self.detach_query(serial) {
                        self.finish(now, query.owner, status, answer);
                    }
                }
            }
        }
    }

    /// Sends the query again if it has tries left, else ends it with the last error. `Err(ETIMEOUT)` says it ended.
    pub(super) fn requeue_query(
        &mut self,
        now: Time,
        serial: Serial,
        status: Status,
        count_try: bool,
        answer: Option<Record>,
        deferred: Option<&mut DeferredList>,
    ) -> Status {
        let max_tries = self.servers.len() * self.tries;
        let Some(query) = self.queries.get_mut(&serial) else {
            return Ok(());
        };
        let server = query.sent_on.map(|(_, server)| server);
        if status.is_err() {
            query.error_status = status;
        }
        if count_try {
            query.try_count += 1;
        }
        let retry = query.try_count < max_tries && !query.no_retries;
        let error = query.error_status.err().unwrap_or(Error::ETIMEOUT);
        self.remove_from_connection(serial);

        if retry {
            return match deferred {
                Some(deferred) => {
                    self.defer(deferred, serial, Deferred::Send(None));
                    Ok(())
                }
                None => self.send_query(now, None, serial),
            };
        }
        self.end_query(now, server, serial, Err(error), answer, deferred);
        Err(Error::ETIMEOUT)
    }

    fn end_query(
        &mut self,
        now: Time,
        server: Option<ServerId>,
        serial: Serial,
        status: Status,
        answer: Option<Record>,
        deferred: Option<&mut DeferredList>,
    ) {
        let sent_at = self.queries.get(&serial).map(|query| query.sent_at);
        if let Some(server) = server.and_then(|id| self.server_mut(id)) {
            server.probe_pending = false;
            if status.is_ok()
                && let Some(sent_at) = sent_at
                && let Some(rcode::NOERROR | rcode::NXDOMAIN) = answer.as_ref().map(|it| it.rcode)
            {
                server.record_latency(now, sent_at);
            }
        }
        match deferred {
            Some(deferred) => self.defer(deferred, serial, Deferred::End(status, answer)),
            None => {
                if let Some(query) = self.detach_query(serial) {
                    self.finish(now, query.owner, status, answer);
                }
            }
        }
    }

    /// `Ok` only if the query is waiting for an answer when this returns.
    pub(super) fn send_query(
        &mut self,
        now: Time,
        server: Option<ServerId>,
        serial: Serial,
    ) -> Status {
        let mut deferred = DeferredList::new();
        let status = self.send_query_deferring(now, server, serial, &mut deferred);
        self.run_deferred(now, deferred);
        if status.is_ok() && !self.queries.contains_key(&serial) {
            return Err(Error::ETIMEOUT);
        }
        status
    }

    fn pick_server(&mut self) -> Option<ServerId> {
        let fewest_failures = self.servers.first()?.consecutive_failures;
        if !self.rotate {
            return self.servers.first().map(|server| server.id);
        }
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

    fn connection_for(&self, server: ServerId, using_tcp: bool) -> Option<ConnId> {
        let server = self.server(server)?;
        if using_tcp {
            return server.tcp_connection;
        }
        let newest = *server.connections.front()?;
        let conn = self.conns.get(&newest)?;
        (conn.transport == Transport::Udp && !conn.retired).then_some(newest)
    }

    fn send_query_deferring(
        &mut self,
        now: Time,
        requested_server: Option<ServerId>,
        serial: Serial,
        deferred: &mut DeferredList,
    ) -> Status {
        let Some(server) = requested_server.or_else(|| self.pick_server()) else {
            let status = Err(Error::ENOSERVER);
            self.end_query(now, None, serial, status, None, Some(deferred));
            return status;
        };
        let Some(query) = self.queries.get(&serial) else {
            return Err(Error::ECANCELLED);
        };
        let using_tcp = query.using_tcp;
        // When every server has failed, a probe is the only way one that is back and sorts behind the best gets noticed.
        let may_probe = requested_server.is_none() && query.try_count == 0;
        let message = query.record.write(0);

        let conn = match self.connection_for(server, using_tcp) {
            Some(conn) => conn,
            None => {
                let transport = match using_tcp {
                    true => Transport::Tcp,
                    false => Transport::Udp,
                };
                match self.open_connection(server, transport) {
                    Ok(conn) => conn,
                    Err(error) => {
                        self.count_server_failure(now, server);
                        let status = Err(error);
                        return self.requeue_query(now, serial, status, true, None, Some(deferred));
                    }
                }
            }
        };

        match message.and_then(|message| self.write_query(conn, &message)) {
            Ok(()) => {}
            Err(Error::ECONNREFUSED) => {
                let status = Err(Error::ECONNREFUSED);
                self.connection_failed(now, conn, true, status);
                return self
                    .requeue_query(now, serial, status, true, None, Some(deferred))
                    .or(status);
            }
            Err(error) => {
                self.count_server_failure(now, server);
                return self.requeue_query(now, serial, Err(error), true, None, Some(deferred));
            }
        }

        let timeout = now.plus_ms(self.query_timeout_ms(now, server, serial));
        self.remove_from_connection(serial);
        if let Some(query) = self.queries.get_mut(&serial) {
            self.sends += 1;
            query.sent_at = now;
            query.timeout = Some(timeout);
            query.sent_on = Some((conn, server));
            query.send_order = self.sends;
            self.timeouts
                .insert((timeout, Reverse(query.send_order), serial));
            if let Some(conn) = self.conns.get_mut(&conn) {
                conn.queries.insert((query.send_order, serial));
            }
        }

        if may_probe {
            self.probe_failed_server(now, server, serial);
        }
        Ok(())
    }

    /// Doubles with every round through the servers, less up to half at random so that clients do not retry in step.
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
        let request = query.record.clone();
        let flags = SendFlags {
            no_cache: true,
            no_retry: true,
        };
        self.send(now, Some(server), flags, &request, Owner::Probe { server });
    }
}

fn same_questions(query: &Record, answer: &Record) -> bool {
    query.question.len() == answer.question.len()
        && query.question.iter().zip(&answer.question).all(|(q, a)| {
            (q.qtype, q.qclass) == (a.qtype, a.qclass) && q.name.eq_ignore_ascii_case(&a.name)
        })
}

/// RFC 7873 section 5.3: dropped, though no cookie was sent.
fn has_malformed_cookie(answer: &Record) -> bool {
    let Some(RData::Opt { options, .. }) = answer.opt().map(|rr| &rr.data) else {
        return false;
    };
    options
        .iter()
        .find(|option| option.id == COOKIE_OPTION)
        .is_some_and(|cookie| !cookie.value.is_empty() && !(8..=40).contains(&cookie.value.len()))
}
