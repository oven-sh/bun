//! What a MySQL connection does with each packet. No socket and no JS: bytes go to `out`, the rest is an event.

#![forbid(unsafe_code)]

use core::cell::Cell;
use std::borrow::Cow;

use super::auth_method::{AuthMethod, AuthResponse, Transport};
use super::capabilities::{Capabilities, MariaDBCapabilities};
use super::mysql_query_result::MySQLQueryResult;
use super::mysql_request;
use super::mysql_types::FieldType;
use super::protocol::any_mysql_error::Error;
use super::protocol::auth::{self, Nonce, caching_sha2_password};
use super::protocol::auth_switch_request::AuthSwitchRequest;
use super::protocol::column_definition41::{Changed, ColumnDefinition41};
use super::protocol::eof_packet::EOFPacket;
use super::protocol::error_packet::ErrorPacket;
use super::protocol::handshake_response41::{HandshakeResponse41, write_ssl_request};
use super::protocol::handshake_v10::HandshakeV10;
use super::protocol::ok_packet::OKPacket;
use super::protocol::packet_header::PacketHeader;
use super::protocol::packet_reader::PacketReader;
use super::protocol::packet_type::PacketType;
use super::protocol::packet_writer::PacketWriter;
use super::protocol::stmt_prepare_ok_packet::StmtPrepareOKPacket;
use super::status_flags::{StatusFlag, StatusFlags};
use crate::shared::SSLMode;

bun_core::define_scoped_log!(debug, MySQLConnection, visible);

pub struct Login {
    pub user: Box<[u8]>,
    pub password: Box<[u8]>,
    pub database: Box<[u8]>,
    pub ssl_mode: SSLMode,
    pub allow_public_key_retrieval: bool,
    pub found_rows: bool,
}

pub struct Session {
    state: State,
    login: Login,
    transport: Transport,
    /// The one behind the last packet that was read.
    sequence_id: u8,
    capabilities: Capabilities,
    mariadb_capabilities: MariaDBCapabilities,
    status_flags: StatusFlags,
}

/// Named for what the session waits for.
#[derive(Clone, Copy, Debug)]
pub enum State {
    Dial,
    Greeting,
    /// The SSLRequest is written, or being written.
    TlsHandshake(Auth),
    IdentityCheck(Auth),
    Verdict(Auth),
    PublicKey(Auth),
    SessionSetup,
    Ready(Reply),
    Failed,
}

#[derive(Clone, Copy, Debug)]
pub struct Auth {
    plugin: Option<AuthMethod>,
    nonce: Nonce,
    switches: u8,
    full_authentication_requested: bool,
}

/// How far the reply to the oldest command has come.
#[derive(Clone, Copy, Debug)]
pub enum Reply {
    /// Any sequence id: a server can refuse a command before it has read all of its packets.
    First,
    /// Of a prepared statement. How many are still to come.
    Definitions {
        params: u16,
        columns: u16,
    },
    NextResult,
    Columns {
        received: usize,
    },
    Rows {
        count: u64,
        columns_eof_due: bool,
    },
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Prepare,
    /// COM_STMT_EXECUTE or COM_QUERY.
    Execute,
}

/// What the server said about a statement.
#[derive(Default)]
pub struct Statement {
    pub id: u32,
    pub params: Vec<FieldType>,
    pub columns: Vec<ColumnDefinition41>,
}

/// One whole payload, so nothing reads into the next one.
pub struct Packet<'a> {
    payload: Cow<'a, [u8]>,
    sequence_id: u8,
    /// The one behind its last part.
    next_sequence_id: u8,
    cursor: Cell<usize>,
}

/// The connection cannot go on.
pub enum Failure<'p> {
    Protocol(Error),
    Server(ErrorPacket<'p>),
    UnsupportedPlugin(&'p [u8]),
}

impl From<Error> for Failure<'_> {
    fn from(err: Error) -> Self {
        Failure::Protocol(err)
    }
}

pub enum Event {
    None,
    /// Something was written to `out`.
    Flush,
    Connected,
}

pub enum ReplyEvent<'p> {
    None,
    Prepared,
    /// Ends the reply.
    Refused(ErrorPacket<'p>),
    ColumnsReplaced,
    ColumnRedescribed,
    ColumnRenamed(usize),
    Row(PacketReader<'p>),
    Result(MySQLQueryResult),
}

impl Packet<'_> {
    fn reader(&self) -> PacketReader<'_> {
        PacketReader::new(&self.payload, &self.cursor)
    }

    fn kind(&self) -> Option<PacketType> {
        self.payload.first().copied().map(PacketType)
    }

    /// A row starts with 0xFE only for a value of 16 MB or more.
    fn is_terminator(&self) -> bool {
        self.kind() == Some(PacketType::EOF)
            && self.payload.len() < PacketHeader::MAX_PAYLOAD_LENGTH
    }

    fn ok(&self) -> Result<OKPacket, Error> {
        let mut ok = OKPacket::default();
        ok.decode_internal(self.reader())?;
        Ok(ok)
    }

    fn eof(&self) -> Result<StatusFlags, Error> {
        let mut eof = EOFPacket::default();
        eof.decode_internal(self.reader())?;
        Ok(eof.status_flags)
    }

    fn error(&self) -> Result<ErrorPacket<'_>, Error> {
        let mut err = ErrorPacket::default();
        err.decode_internal(self.reader())?;
        Ok(err)
    }

    /// An ERR says why the server drops the connection (KILL, wait_timeout, a host it does not take).
    fn unasked(&self) -> Failure<'_> {
        if self.kind() != Some(PacketType::ERROR) {
            return Error::UnexpectedPacket.into();
        }
        self.error().map_or_else(Failure::Protocol, Failure::Server)
    }
}

fn plugin_named(name: &[u8]) -> Result<AuthMethod, Failure<'_>> {
    AuthMethod::from_string(name).ok_or(Failure::UnsupportedPlugin(name))
}

impl Session {
    pub fn new(login: Login, transport: Transport) -> Self {
        Self {
            state: State::Dial,
            capabilities: Capabilities::get_default_capabilities(
                login.ssl_mode != SSLMode::Disable,
                !login.database.is_empty(),
                login.found_rows,
            ),
            login,
            transport,
            sequence_id: 0,
            mariadb_capabilities: MariaDBCapabilities::get_default_capabilities(),
            status_flags: StatusFlags::default(),
        }
    }

    #[inline]
    pub fn state(&self) -> &State {
        &self.state
    }

    pub fn transport(&self) -> Transport {
        self.transport
    }

    pub fn ssl_mode(&self) -> SSLMode {
        self.login.ssl_mode
    }

    /// As of the last reply that said so: an ERR packet has no status.
    pub fn is_in_transaction(&self) -> bool {
        self.status_flags.has(StatusFlag::SERVER_STATUS_IN_TRANS)
    }

    pub fn on_open(&mut self) {
        if let State::Dial = self.state {
            self.state = State::Greeting;
        }
    }

    pub fn on_tls_handshake(&mut self) {
        if let State::TlsHandshake(auth) = self.state {
            // The SSLRequest took one.
            self.sequence_id = self.sequence_id.wrapping_add(1);
            self.transport = Transport::Tls;
            self.state = State::IdentityCheck(auth);
        }
    }

    pub fn on_identity_accepted(&mut self, out: &mut Vec<u8>) -> Result<(), Error> {
        match self.state {
            State::IdentityCheck(auth) => self.send_handshake_response(auth, out),
            // The check closed the connection.
            _ => Ok(()),
        }
    }

    pub fn fail(&mut self) {
        self.state = State::Failed;
    }

    /// Takes a packet off the front of `buffer`. `None`: it has not all arrived.
    #[inline]
    pub fn next_packet<'a>(&self, buffer: &mut &'a [u8]) -> Result<Option<Packet<'a>>, Error> {
        // Plaintext behind the SSLRequest can be a man-in-the-middle's (CVE-2021-23222 class).
        if matches!(self.state, State::TlsHandshake(_)) && !buffer.is_empty() {
            return Err(Error::UnexpectedPacket);
        }
        let Some((header, rest)) = PacketHeader::decode(buffer) else {
            return Ok(None);
        };
        let Some((payload, rest)) = rest.split_at_checked(header.length as usize) else {
            return Ok(None);
        };
        if payload.len() == PacketHeader::MAX_PAYLOAD_LENGTH {
            return self.join_packets(buffer, header.sequence_id);
        }
        *buffer = rest;
        Ok(Some(Packet {
            payload: Cow::Borrowed(payload),
            sequence_id: header.sequence_id,
            next_sequence_id: header.sequence_id.wrapping_add(1),
            cursor: Cell::new(0),
        }))
    }

    #[cold]
    fn join_packets<'a>(
        &self,
        buffer: &mut &'a [u8],
        sequence_id: u8,
    ) -> Result<Option<Packet<'a>>, Error> {
        if !matches!(self.state, State::Ready(_)) {
            return Err(Error::UnexpectedPacket);
        }
        let mut next_sequence_id = sequence_id;
        let mut wire_length: usize = 0;
        let mut payload_length: usize = 0;
        let mut rest = *buffer;
        loop {
            let Some((header, body)) = PacketHeader::decode(rest) else {
                return Ok(None);
            };
            if header.sequence_id != next_sequence_id {
                return Err(Error::UnexpectedPacket);
            }
            next_sequence_id = next_sequence_id.wrapping_add(1);
            wire_length += PacketHeader::SIZE + header.length as usize;
            payload_length += header.length as usize;
            u32::try_from(wire_length).map_err(|_| Error::Overflow)?;
            let Some((part, behind)) = body.split_at_checked(header.length as usize) else {
                return Ok(None);
            };
            rest = behind;
            if part.len() < PacketHeader::MAX_PAYLOAD_LENGTH {
                break;
            }
        }

        let mut payload: Vec<u8> = Vec::new();
        payload
            .try_reserve_exact(payload_length)
            .map_err(|_| Error::OutOfMemory)?;
        let mut parts = core::mem::replace(buffer, rest);
        while payload.len() < payload_length
            && let Some((header, body)) = PacketHeader::decode(parts)
            && let Some((part, behind)) = body.split_at_checked(header.length as usize)
        {
            payload.extend_from_slice(part);
            parts = behind;
        }
        Ok(Some(Packet {
            payload: Cow::Owned(payload),
            sequence_id,
            next_sequence_id,
            cursor: Cell::new(0),
        }))
    }

    /// For a packet that no command waits for.
    pub fn on_packet<'p>(
        &mut self,
        packet: &'p Packet<'_>,
        out: &mut Vec<u8>,
    ) -> Result<Event, Failure<'p>> {
        debug!("{:?}: {:02x?}", self.state, packet.payload.first());
        self.sequence_id = packet.next_sequence_id;
        let reader = packet.reader();
        match (self.state, packet.kind()) {
            (State::Dial | State::TlsHandshake(_) | State::Failed, _) => {
                Err(Error::UnexpectedPacket.into())
            }
            (State::IdentityCheck(_) | State::Ready(_), _) | (_, Some(PacketType::ERROR)) => {
                Err(packet.unasked())
            }
            (_, None) => Err(Error::MalformedPacket.into()),
            (State::Greeting, _) => self.on_greeting(reader, out),
            (State::Verdict(_) | State::PublicKey(_), Some(PacketType::OK)) => {
                self.status_flags = packet.ok()?.status_flags;
                self.state = State::SessionSetup;
                // The Date codec is UTC, and the server converts TIMESTAMP through the session's zone (#40435).
                mysql_request::execute_query(b"SET time_zone = '+00:00'", out);
                Ok(Event::Flush)
            }
            (State::Verdict(auth), Some(PacketType::MORE_DATA)) => {
                self.on_fast_auth_status(auth, reader, out)
            }
            (State::PublicKey(auth), Some(PacketType::MORE_DATA)) => {
                self.state = State::Verdict(auth);
                reader.skip(1);
                caching_sha2_password::EncryptedPassword {
                    password: &self.login.password,
                    public_key: reader.peek(),
                    nonce: auth.nonce,
                    sequence_id: self.sequence_id,
                }
                .write(out)?;
                Ok(Event::Flush)
            }
            (State::Verdict(auth) | State::PublicKey(auth), Some(PacketType::AUTH_SWITCH)) => {
                self.on_auth_switch(auth, reader, out)
            }
            (State::SessionSetup, Some(PacketType::OK)) => {
                self.status_flags = packet.ok()?.status_flags;
                self.state = State::Ready(Reply::First);
                Ok(Event::Connected)
            }
            (State::Verdict(_) | State::PublicKey(_) | State::SessionSetup, _) => {
                Err(Error::UnexpectedPacket.into())
            }
        }
    }

    fn on_greeting<'p>(
        &mut self,
        reader: PacketReader<'p>,
        out: &mut Vec<u8>,
    ) -> Result<Event, Failure<'p>> {
        let mut handshake = HandshakeV10::default();
        handshake.decode_internal(reader)?;
        self.capabilities = self.capabilities.intersect(handshake.capability_flags);
        // Always sent, offered or not.
        self.capabilities.CLIENT_CONNECT_ATTRS = true;
        self.mariadb_capabilities = self
            .mariadb_capabilities
            .intersect(handshake.mariadb_capability_flags);
        self.status_flags = handshake.status_flags;
        debug!(
            "Handshake\n   Server Version: {}\n   Connection ID:  {}\n   Server Capabilities:   [ {} ]\n   Negotiated Capabilities: [ {} ]\n",
            bstr::BStr::new(handshake.server_version),
            handshake.connection_id,
            handshake.capability_flags,
            self.capabilities,
        );

        let auth = Auth {
            plugin: match handshake.auth_plugin_name {
                b"" => None,
                name => Some(plugin_named(name)?),
            },
            nonce: handshake.auth_plugin_data,
            switches: 0,
            full_authentication_requested: false,
        };
        if self.capabilities.CLIENT_SSL {
            write_ssl_request(self.capabilities, self.mariadb_capabilities, out);
            self.state = State::TlsHandshake(auth);
            return Ok(Event::Flush);
        }
        match self.login.ssl_mode {
            SSLMode::Require | SSLMode::VerifyCa | SSLMode::VerifyFull => {
                Err(Error::AuthenticationFailed.into())
            }
            SSLMode::Prefer | SSLMode::Disable => {
                self.send_handshake_response(auth, out)?;
                Ok(Event::Flush)
            }
        }
    }

    fn on_fast_auth_status<'p>(
        &mut self,
        mut auth: Auth,
        reader: PacketReader<'p>,
        out: &mut Vec<u8>,
    ) -> Result<Event, Failure<'p>> {
        let Some(plugin @ (AuthMethod::Sha256Password | AuthMethod::CachingSha2Password)) =
            auth.plugin
        else {
            return Err(Error::UnexpectedPacket.into());
        };
        reader.skip(1);
        match reader.byte()? {
            // The OK or ERR follows.
            caching_sha2_password::FAST_AUTH_SUCCESS => Ok(Event::None),
            caching_sha2_password::PERFORM_FULL_AUTHENTICATION => {
                if core::mem::replace(&mut auth.full_authentication_requested, true) {
                    return Err(Error::UnexpectedPacket.into());
                }
                let response = plugin.full_authentication(&self.login.password, self.transport);
                self.state = self.send_auth_response(auth, &response, out)?;
                Ok(Event::Flush)
            }
            _ => Err(Error::AuthenticationFailed.into()),
        }
    }

    fn on_auth_switch<'p>(
        &mut self,
        mut auth: Auth,
        reader: PacketReader<'p>,
        out: &mut Vec<u8>,
    ) -> Result<Event, Failure<'p>> {
        let mut request = AuthSwitchRequest::default();
        request.decode_internal(reader)?;
        let plugin = plugin_named(request.plugin_name)?;
        // Bound a hostile server's auth ping-pong.
        if auth.switches >= 2 || (auth.switches > 0 && auth.plugin == Some(plugin)) {
            return Err(Error::UnexpectedPacket.into());
        }
        auth.switches += 1;
        auth.plugin = Some(plugin);
        auth.nonce = auth::nonce(request.plugin_data)?;

        let mut scramble = [0u8; 32];
        let response = plugin.first_response(
            &self.login.password,
            &auth.nonce,
            self.transport,
            &mut scramble,
        );
        self.state = self.send_auth_response(auth, &response, out)?;
        Ok(Event::Flush)
    }

    fn send_handshake_response(&mut self, auth: Auth, out: &mut Vec<u8>) -> Result<(), Error> {
        let mut scramble = [0u8; 32];
        let auth_response = match auth.plugin {
            Some(plugin) => plugin.first_response(
                &self.login.password,
                &auth.nonce,
                self.transport,
                &mut scramble,
            ),
            None => AuthResponse::Scramble(&[]),
        };
        self.state = self.state_after(auth, &auth_response)?;
        HandshakeResponse41 {
            capability_flags: self.capabilities,
            mariadb_capability_flags: self.mariadb_capabilities,
            username: &self.login.user,
            database: &self.login.database,
            auth_plugin_name: auth.plugin.map_or(&b""[..], AuthMethod::name),
            auth_response,
            sequence_id: self.sequence_id,
        }
        .write(out)
    }

    fn send_auth_response(
        &self,
        auth: Auth,
        response: &AuthResponse<'_>,
        out: &mut Vec<u8>,
    ) -> Result<State, Error> {
        let state = self.state_after(auth, response)?;
        let mut packet = PacketWriter::start(out, self.sequence_id);
        response.write(&mut packet);
        packet.end();
        Ok(state)
    }

    fn state_after(&self, auth: Auth, response: &AuthResponse<'_>) -> Result<State, Error> {
        match response {
            AuthResponse::Scramble(_) | AuthResponse::Password(_) => Ok(State::Verdict(auth)),
            AuthResponse::PublicKeyRequest(_) if self.login.allow_public_key_retrieval => {
                Ok(State::PublicKey(auth))
            }
            // An on-path attacker can answer with a key of their own and recover the password.
            AuthResponse::PublicKeyRequest(_) => Err(Error::PublicKeyRetrievalNotAllowed),
        }
    }

    /// For a packet of the reply to `command`, the oldest one that is written and not answered.
    #[inline]
    pub fn on_reply<'p>(
        &mut self,
        packet: &'p Packet<'_>,
        command: Command,
        statement: &mut Statement,
    ) -> Result<ReplyEvent<'p>, Failure<'p>> {
        debug!("{:?}: {:02x?}", self.state, packet.payload.first());
        let expected = core::mem::replace(&mut self.sequence_id, packet.next_sequence_id);
        let State::Ready(reply) = &mut self.state else {
            return Err(Error::UnexpectedPacket.into());
        };
        if !matches!(reply, Reply::First) && packet.sequence_id != expected {
            return Err(packet.unasked());
        }
        let kind = packet.kind().ok_or(Error::MalformedPacket)?;
        // A prepare is refused by its first packet only.
        if kind == PacketType::ERROR && !matches!(reply, Reply::Definitions { .. }) {
            *reply = Reply::First;
            return Ok(ReplyEvent::Refused(packet.error()?));
        }

        let mut reader = packet.reader();
        let has_eof_packets = !self.capabilities.CLIENT_DEPRECATE_EOF;
        let extended_type_info = self.mariadb_capabilities.MARIADB_CLIENT_EXTENDED_TYPE_INFO;
        let (ok, rows) = match reply {
            Reply::Rows { count, .. } if !packet.is_terminator() => {
                *count += 1;
                return Ok(ReplyEvent::Row(reader));
            }
            Reply::Rows {
                columns_eof_due: due @ true,
                ..
            } => {
                packet.eof()?;
                *due = false;
                return Ok(ReplyEvent::None);
            }
            Reply::Rows { count, .. } if has_eof_packets => {
                let ok = OKPacket {
                    status_flags: packet.eof()?,
                    ..Default::default()
                };
                (ok, Some(*count))
            }
            Reply::Rows { count, .. } => (packet.ok()?, Some(*count)),
            Reply::Columns { received } => {
                let index = *received;
                let column = statement.columns.get_mut(index);
                let changed = column
                    .ok_or(Error::UnexpectedPacket)?
                    .decode(&mut reader, extended_type_info)?;
                *received += 1;
                if *received == statement.columns.len() {
                    *reply = Reply::Rows {
                        count: 0,
                        columns_eof_due: has_eof_packets,
                    };
                }
                return Ok(match changed {
                    Changed::Nothing => ReplyEvent::None,
                    Changed::Description => ReplyEvent::ColumnRedescribed,
                    Changed::Name => ReplyEvent::ColumnRenamed(index),
                });
            }
            Reply::Definitions { params, columns } => {
                let is_eof = has_eof_packets && packet.is_terminator();
                let mut definition = ColumnDefinition41::default();
                if is_eof {
                    packet.eof()?;
                } else if *params > 0 {
                    definition.decode(&mut reader, extended_type_info)?;
                    statement.params.push(definition.column_type);
                    *params -= 1;
                } else if *columns > 0 {
                    // Only counted: every execution brings them again.
                    definition.decode(&mut reader, extended_type_info)?;
                    *columns -= 1;
                }
                if *params > 0 || *columns > 0 || (has_eof_packets && !is_eof) {
                    return Ok(ReplyEvent::None);
                }
                *reply = Reply::First;
                return Ok(ReplyEvent::Prepared);
            }
            Reply::First if command == Command::Prepare => {
                if kind != PacketType::OK {
                    return Err(Error::UnexpectedPacket.into());
                }
                let mut ok = StmtPrepareOKPacket::default();
                ok.decode(reader)?;
                *statement = Statement {
                    id: ok.statement_id,
                    params: Vec::with_capacity(ok.num_params.into()),
                    columns: (0..ok.num_columns).map(|_| Default::default()).collect(),
                };
                if (ok.num_params, ok.num_columns) == (0, 0) {
                    return Ok(ReplyEvent::Prepared);
                }
                *reply = Reply::Definitions {
                    params: ok.num_params,
                    columns: ok.num_columns,
                };
                return Ok(ReplyEvent::None);
            }
            Reply::First | Reply::NextResult if kind == PacketType::OK => (packet.ok()?, None),
            Reply::First | Reply::NextResult => {
                // The client never offers CLIENT_LOCAL_FILES.
                if kind == PacketType::LOCAL_INFILE {
                    return Err(Error::UnexpectedPacket.into());
                }
                // MySQL's MAX_FIELDS. The count sizes an allocation.
                let column_count @ 1..=4096 = reader.encoded_len_int()? else {
                    return Err(Error::UnexpectedPacket.into());
                };
                let column_count = column_count as usize;
                *reply = Reply::Columns { received: 0 };
                if statement.columns.len() == column_count {
                    return Ok(ReplyEvent::None);
                }
                statement.columns = Vec::new();
                statement
                    .columns
                    .try_reserve_exact(column_count)
                    .map_err(|_| Error::OutOfMemory)?;
                statement
                    .columns
                    .resize_with(column_count, Default::default);
                return Ok(ReplyEvent::ColumnsReplaced);
            }
        };

        self.status_flags = ok.status_flags;
        let is_last_result = !ok.status_flags.has(StatusFlag::SERVER_MORE_RESULTS_EXISTS);
        *reply = if is_last_result {
            Reply::First
        } else {
            Reply::NextResult
        };
        Ok(ReplyEvent::Result(MySQLQueryResult {
            result_count: rows.unwrap_or(0),
            has_columns: rows.is_some(),
            last_insert_id: ok.last_insert_id,
            affected_rows: ok.affected_rows,
            is_last_result,
        }))
    }
}
