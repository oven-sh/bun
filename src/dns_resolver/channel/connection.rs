//! The sockets of a channel: one TCP connection to a server at most, and as many UDP ones as timeouts have retired.

use std::collections::BTreeSet;

use super::server::ServerId;
use super::{Channel, Serial};
use crate::io::{IoError, Socket, Time, Transport};
use crate::{Error, Result};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(super) struct ConnectionId(u64);

pub(super) struct Connection {
    socket: Socket,
    pub(super) server: ServerId,
    pub(super) transport: Transport,
    /// Nothing has been written yet to a TCP Fast Open socket, so the first write is what connects it.
    pub(super) fast_open_pending: bool,
    pub(super) connected: bool,
    /// A query timed out here. Packets may be getting dropped, so new queries leave from another port.
    pub(super) retired: bool,
    /// `writable` as [`crate::io::Io::watch`] last heard it. `None`: it has not been called yet.
    watching_writable: Option<bool>,
    /// Messages, each after its length in 16 bits, whatever the transport.
    pub(super) received: Vec<u8>,
    /// In the same form.
    unsent: Vec<u8>,
    /// Sent and not answered, each after its `Query::send_order`: oldest first.
    pub(super) queries: BTreeSet<(u64, Serial)>,
}

const LARGEST_MESSAGE: usize = 65535;

impl Channel {
    pub(super) fn connection_of_socket(&self, socket: Socket) -> Option<ConnectionId> {
        let mut connections = self.connections.iter();
        let (id, _) = connections.find(|(_, connection)| connection.socket == socket)?;
        Some(*id)
    }

    fn watch(&mut self, id: ConnectionId, writable: bool) {
        let Some(connection) = self.connections.get_mut(&id) else {
            return;
        };
        if connection.watching_writable != Some(writable) {
            connection.watching_writable = Some(writable);
            self.io.watch(connection.socket, writable);
        }
    }

    pub(super) fn open_connection(
        &mut self,
        server_id: ServerId,
        transport: Transport,
    ) -> Result<ConnectionId> {
        let server = self.server(server_id).ok_or(Error::ECONNREFUSED)?;
        let address = server.socket_address(transport);
        let local = if address.is_ipv4() {
            self.local_v4.map(Into::into)
        } else {
            // A link-local server is reached from the link-local address of its interface.
            let local_v6 = self.local_v6.filter(|_| server.config.scope_id == 0);
            local_v6.map(Into::into)
        };
        let opened = self
            .io
            .open(transport, address, local)
            .map_err(|_| Error::ECONNREFUSED)?;

        self.last_connection_id += 1;
        let id = ConnectionId(self.last_connection_id);
        self.connections.insert(
            id,
            Connection {
                socket: opened.socket,
                server: server_id,
                transport,
                fast_open_pending: opened.fast_open,
                connected: false,
                retired: false,
                watching_writable: None,
                received: Vec::new(),
                unsent: Vec::new(),
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
            self.watch(id, transport == Transport::Tcp);
        }
        Ok(id)
    }

    /// Queues `message` on the connection and sends what can be sent now.
    pub(super) fn write_query(&mut self, id: ConnectionId, message: &[u8]) -> Result<()> {
        let connection = (self.connections.get_mut(&id)).ok_or(Error::ECONNREFUSED)?;
        let length = u16::try_from(message.len()).map_err(|_| Error::EBADQUERY)?;
        connection.unsent.extend_from_slice(&length.to_be_bytes());
        connection.unsent.extend_from_slice(message);
        self.flush(id)
    }

    pub(super) fn flush(&mut self, id: ConnectionId) -> Result<()> {
        let connection = (self.connections.get_mut(&id)).ok_or(Error::ECONNREFUSED)?;
        let is_tcp = connection.transport == Transport::Tcp;
        let fast_open = connection.fast_open_pending;
        while !connection.unsent.is_empty() {
            if is_tcp && !connection.connected && !connection.fast_open_pending {
                break;
            }
            connection.fast_open_pending = false;
            let (prefix, data) = match connection.unsent.as_slice() {
                all if is_tcp => (0, all),
                [high, low, rest @ ..] => {
                    let length = usize::from(u16::from_be_bytes([*high, *low]));
                    (2, rest.get(..length).ok_or(Error::EFORMERR)?)
                }
                _ => return Err(Error::EFORMERR),
            };
            let written = match self.io.send(connection.socket, data) {
                Ok(written) => written,
                Err(IoError::WouldBlock) => break,
                Err(IoError::Failed) => return Err(Error::ECONNREFUSED),
            };
            let consumed = (prefix + written).min(connection.unsent.len());
            connection.unsent.drain(..consumed);
            // One datagram a message. A stream took all it could in one call.
            if is_tcp {
                break;
            }
        }
        // Only a writable event says that a Fast Open socket has connected. A datagram that would block is left to time out.
        let writable = fast_open || (is_tcp && !connection.unsent.is_empty());
        self.watch(id, writable);
        Ok(())
    }

    /// Moves what the socket has into `received`. True if the socket then failed.
    pub(super) fn read_socket(&mut self, id: ConnectionId) -> bool {
        let server = (self.connections.get(&id)).and_then(|it| self.server(it.server));
        let expected = server.map(|server| (server.config.address, server.config.udp_port));
        let mut failed = false;
        let mut buffer = core::mem::take(&mut self.read_buffer);
        buffer.resize(LARGEST_MESSAGE, 0);
        while let Some(connection) = self.connections.get_mut(&id) {
            let received = match connection.transport {
                Transport::Tcp => self.io.recv(connection.socket, &mut buffer),
                // The socket is connected, so the system has normally dropped what others send already.
                Transport::Udp => match self.io.recv_from(connection.socket, &mut buffer) {
                    // A port of 0: the system did not say. As in c-ares, what is queued behind
                    // a stranger's datagram waits for the next event.
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
            connection.connected = true;
            let data = buffer.get(..count).unwrap_or_default();
            if connection.transport == Transport::Udp {
                let length = data.len() as u16;
                connection.received.extend_from_slice(&length.to_be_bytes());
            }
            connection.received.extend_from_slice(data);
            if connection.transport == Transport::Tcp && count < buffer.len() {
                break;
            }
        }
        self.read_buffer = buffer;
        failed
    }

    /// Closes a connection whose server is to blame.
    pub(super) fn connection_failed(&mut self, now: Time, id: ConnectionId, error: Error) {
        let Some(connection) = self.connections.get(&id) else {
            return;
        };
        // Counted first, so that the queries are unlikely to go back to this server.
        let server = connection.server;
        self.count_server_failure(now, server);
        self.close_connection(now, id, Some(error));
    }

    /// Its queries go out again on another connection, or end if they are out of tries: with
    /// `reason`, if it is closed for a fault.
    pub(super) fn close_connection(&mut self, now: Time, id: ConnectionId, reason: Option<Error>) {
        let Some(connection) = self.connections.remove(&id) else {
            return;
        };
        if let Some(server) = self.server_mut(connection.server) {
            server.connections.retain(|other| *other != id);
            if server.tcp_connection == Some(id) {
                server.tcp_connection = None;
            }
        }
        for (_, serial) in connection.queries {
            self.requeue_query(now, serial, reason, None);
        }
        self.io.close(connection.socket);
    }

    pub(super) fn close_idle_connections(&mut self, now: Time) {
        let is_idle = |id: &&ConnectionId| {
            let connection = self.connections.get(id);
            connection.is_some_and(|it| it.queries.is_empty())
        };
        let idle: Vec<ConnectionId> = self
            .servers
            .iter()
            .flat_map(|server| &server.connections)
            .filter(is_idle)
            .copied()
            .collect();
        for id in idle {
            self.close_connection(now, id, None);
        }
    }
}
