//! The sockets of a channel: one TCP connection to a server at most, and as many UDP ones as timeouts have retired.

use std::collections::BTreeSet;

use super::server::ServerId;
use super::{Channel, Serial, Status};
use crate::Error;
use crate::io::{Io, IoError, Time, Transport};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct ConnId(pub(super) u64);

pub(crate) struct Conn<Socket> {
    pub(crate) socket: Socket,
    pub(crate) server: ServerId,
    pub(crate) transport: Transport,
    /// Nothing has been written yet to a TCP Fast Open socket, so the first write is what connects it.
    fast_open_pending: bool,
    pub(crate) connected: bool,
    /// A query timed out here. Packets may be getting dropped, so new queries leave from another port.
    pub(crate) retired: bool,
    /// (readable, writable) as [`Io::watch`] last heard it.
    watching: (bool, bool),
    /// Messages, each after its length in 16 bits, whatever the transport.
    pub(crate) in_buf: Vec<u8>,
    out_buf: Vec<u8>,
    /// Sent and not answered, each after its `Query::send_order`: oldest first.
    pub(crate) queries: BTreeSet<(u64, Serial)>,
}

const LARGEST_MESSAGE: usize = 65535;

pub(super) enum Read {
    All,
    /// To be acted on after what the socket delivered first.
    ThenFailed,
    /// It failed and had delivered nothing, so the connection is gone.
    Closed,
}

impl<Socket> Conn<Socket> {
    pub(super) fn became_writable(&mut self) {
        if !self.fast_open_pending {
            self.connected = true;
        }
    }
}

impl<I: Io, T> Channel<I, T> {
    pub(super) fn conn_of_socket(&self, socket: I::Socket) -> Option<ConnId> {
        let (id, _) = self.conns.iter().find(|(_, conn)| conn.socket == socket)?;
        Some(*id)
    }

    fn watch(&mut self, id: ConnId, readable: bool, writable: bool) {
        let Some(conn) = self.conns.get_mut(&id) else {
            return;
        };
        if conn.watching != (readable, writable) {
            conn.watching = (readable, writable);
            self.io.watch(conn.socket, readable, writable);
        }
    }

    pub(super) fn open_connection(
        &mut self,
        server_id: ServerId,
        transport: Transport,
    ) -> Result<ConnId, Error> {
        let server = self.server(server_id).ok_or(Error::ECONNREFUSED)?;
        let address = server.socket_address(transport);
        let local = match address.is_ipv4() {
            true => self.local_v4.map(Into::into),
            false => self.local_v6.map(Into::into),
        };
        let opened = self
            .io
            .open(transport, address, local)
            .map_err(|_| Error::ECONNREFUSED)?;

        self.next_conn_id += 1;
        let id = ConnId(self.next_conn_id);
        self.conns.insert(
            id,
            Conn {
                socket: opened.socket,
                server: server_id,
                transport,
                fast_open_pending: opened.fast_open,
                connected: false,
                retired: false,
                watching: (false, false),
                in_buf: Vec::new(),
                out_buf: Vec::new(),
                queries: BTreeSet::new(),
            },
        );
        if let Some(server) = self.server_mut(server_id) {
            match transport {
                Transport::Udp => server.connections.push_front(id),
                Transport::Tcp => {
                    server.connections.push_back(id);
                    server.tcp_connection = Some(id);
                }
            }
        }
        // A readable event before the first Fast Open write would read a socket that has no peer yet.
        if !opened.fast_open {
            self.watch(id, true, transport == Transport::Tcp);
        }
        Ok(id)
    }

    /// Queues `message` on the connection and sends what can be sent now.
    pub(super) fn write_query(&mut self, id: ConnId, message: &[u8]) -> Status {
        let conn = self.conns.get_mut(&id).ok_or(Error::ECONNREFUSED)?;
        let length = u16::try_from(message.len()).map_err(|_| Error::EBADQUERY)?;
        conn.out_buf.extend_from_slice(&length.to_be_bytes());
        conn.out_buf.extend_from_slice(message);
        self.flush(id)
    }

    pub(super) fn flush(&mut self, id: ConnId) -> Status {
        let conn = self.conns.get_mut(&id).ok_or(Error::ECONNREFUSED)?;
        let is_tcp = conn.transport == Transport::Tcp;
        let fast_open = conn.fast_open_pending;
        while !conn.out_buf.is_empty() {
            if is_tcp && !conn.connected && !conn.fast_open_pending {
                break;
            }
            conn.fast_open_pending = false;
            let (prefix, data) = match conn.out_buf.as_slice() {
                all if is_tcp => (0, all),
                [high, low, rest @ ..] => {
                    let length = usize::from(u16::from_be_bytes([*high, *low]));
                    (2, rest.get(..length).ok_or(Error::EFORMERR)?)
                }
                _ => return Err(Error::EFORMERR),
            };
            let written = match self.io.send(conn.socket, data) {
                Ok(written) => written,
                Err(IoError::WouldBlock) => break,
                Err(IoError::Failed) => return Err(Error::ECONNREFUSED),
            };
            let consumed = (prefix + written).min(conn.out_buf.len());
            conn.out_buf.drain(..consumed);
            // One datagram a message. A stream took all it could in one call.
            if is_tcp {
                break;
            }
        }
        // Only a writable event says that a Fast Open socket has connected. A datagram that would block is left to time out.
        let writable = fast_open || (is_tcp && !conn.out_buf.is_empty());
        self.watch(id, true, writable);
        Ok(())
    }

    /// Moves what the socket has into `in_buf`.
    pub(super) fn read_packets(&mut self, now: Time, id: ConnId) -> Read {
        let mut failed = false;
        let mut buffer = core::mem::take(&mut self.read_buffer);
        buffer.resize(LARGEST_MESSAGE, 0);
        while let Some(conn) = self.conns.get_mut(&id) {
            let expected = self
                .servers
                .iter()
                .find(|server| server.id == conn.server)
                .map(|server| (server.address, server.udp_port));
            let received = match conn.transport {
                Transport::Tcp => self.io.recv(conn.socket, &mut buffer),
                // The socket is connected, so the system has normally dropped what others send already.
                Transport::Udp => match self.io.recv_from(conn.socket, &mut buffer) {
                    // A port of 0: the system did not say.
                    Ok((_, from))
                        if expected.is_some_and(|(address, port)| {
                            address != from.ip() || (from.port() != 0 && from.port() != port)
                        }) =>
                    {
                        Err(IoError::WouldBlock)
                    }
                    Ok((count, _)) => Ok(count),
                    Err(error) => Err(error),
                },
            };
            let count = match received {
                Ok(count) => count,
                Err(IoError::WouldBlock) => break,
                Err(IoError::Failed) => {
                    failed = true;
                    break;
                }
            };
            conn.connected = true;
            let data = buffer.get(..count).unwrap_or_default();
            if conn.transport == Transport::Udp {
                conn.in_buf
                    .extend_from_slice(&(data.len() as u16).to_be_bytes());
            }
            conn.in_buf.extend_from_slice(data);
            if conn.transport == Transport::Tcp && count < buffer.len() {
                break;
            }
        }
        self.read_buffer = buffer;

        if failed
            && self
                .conns
                .get(&id)
                .is_some_and(|conn| conn.in_buf.is_empty())
        {
            self.connection_failed(now, id, true, Err(Error::ECONNREFUSED));
            return Read::Closed;
        }
        match failed {
            true => Read::ThenFailed,
            false => Read::All,
        }
    }

    /// `critical`: the server is to blame.
    pub(super) fn connection_failed(
        &mut self,
        now: Time,
        id: ConnId,
        critical: bool,
        status: Status,
    ) {
        let Some(conn) = self.conns.get(&id) else {
            return;
        };
        // Counted first, so that the queries are unlikely to go back to this server.
        if critical {
            let server = conn.server;
            self.count_server_failure(now, server);
        }
        self.close_connection(now, id, status);
    }

    /// Its queries go out again on another connection, or end with `status` if they are out of tries.
    pub(super) fn close_connection(&mut self, now: Time, id: ConnId, status: Status) {
        let Some(conn) = self.conns.remove(&id) else {
            return;
        };
        if let Some(server) = self.server_mut(conn.server) {
            server.connections.retain(|other| *other != id);
            if server.tcp_connection == Some(id) {
                server.tcp_connection = None;
            }
        }
        for (_, serial) in conn.queries {
            let _ = self.requeue_query(now, serial, status, true, None, None);
        }
        self.io.close(conn.socket);
    }

    pub(super) fn close_idle_connections(&mut self, now: Time) {
        let idle: Vec<ConnId> = self
            .servers
            .iter()
            .flat_map(|server| &server.connections)
            .filter(|id| self.conns.get(id).is_some_and(|it| it.queries.is_empty()))
            .copied()
            .collect();
        for id in idle {
            self.close_connection(now, id, Ok(()));
        }
    }
}
