//! RFC 9000 §7 and RFC 9001 §4.

use super::ack_frequency::{self, MIN_ACK_DELAY};
use super::sent::Control;
use super::space::SpaceId;
use super::streams::{Load, Streams};
use super::timers::Timer;
use super::{Connection, Phase};
use crate::cid::ConnectionId;
use crate::coding::Read;
use crate::congestion::Algorithm;
use crate::crypto::{Cipher, InitialSecret, Keys, Secret, retry_tag};
use crate::endpoint::Shared;
use crate::error::{Error, Result, http3_code, transport_code};
use crate::event::{CloseReason, Event};
use crate::http3::write_settings;
use crate::packet::{Invariants, LongHeader};
use crate::stream_id::Side;
use crate::time::{Duration, Instant};
use crate::tls::{Alert, Level, Status};
use crate::transport_parameters::{TransportParameters, VersionInformation};
use crate::version::Version;
use crate::with;

/// How far ahead of what TLS has got CRYPTO frames can be (RFC 9000 §7.5).
const CRYPTO_WINDOW: u64 = 64 * 1024;
const UNVALIDATED_CRYPTO_WINDOW: u64 = 16 * 1024;
/// More than RFC 9000 §7.5 asks for.
const MAX_SCATTERED_CRYPTO_LEN: u64 = 5 * 1024;
const MAX_HELLO_LEN: usize = 16 * 1024;
/// TLS has room for one ticket and not much more.
const MAX_TICKET_INPUT_LEN: usize = 256;
const CRYPTO_BUFFER_EXCEEDED: Error = Error::transport(
    transport_code::CRYPTO_BUFFER_EXCEEDED,
    "crypto buffer exceeded",
);
/// It leaves room for frames in an Initial packet.
const MAX_TOKEN_LEN: usize = 512;
pub(super) const MAX_TICKETS: u8 = 16;
const PATIENCE_FOR_TICKET: Duration = Duration::from_secs(1);
const MAX_TOKENS: u8 = 16;
const TICKET_FORMAT: u32 = 1;
/// What a peer has to accept on a request stream for HTTP/3 to be practical.
const MIN_HTTP3_WINDOW: u64 = 4096;
/// RFC 8446 §4.
const NEW_SESSION_TICKET: u8 = 4;
const CERTIFICATE_REQUEST: u8 = 13;
const UNEXPECTED_MESSAGE: Alert = Alert(10);
const NO_APPLICATION_PROTOCOL: Alert = Alert(120);

/// What is needed until the handshake is confirmed.
pub(super) struct Setup {
    pub(super) started_at: Instant,
    pub(super) original_version: Version,
    /// What the client sent its first packet to.
    pub(super) original_destination: ConnectionId,
    /// What the keys for Initial packets derive from. It differs after a Retry packet.
    pub(super) initial_destination: ConnectionId,
    /// That of the peer.
    pub(super) initial_source: Option<ConnectionId>,
    pub(super) token: Vec<u8>,
    /// To read Initial packets of the version that a server left, or that a client may move to.
    pub(super) other_keys: Option<(Version, Keys)>,
    pub(super) is_version_settled: bool,
    /// The server has validated the address of the client (RFC 9002 §6.2.2.1).
    pub(super) is_validated_by_peer: bool,
    /// The parameters that early data is sent with.
    remembered: Option<TransportParameters>,
    /// What a server has of the ClientHello message.
    hello: Vec<u8>,
    /// Packets for which there are no keys yet.
    pub(super) undecryptable: Vec<Vec<u8>>,
    /// How many of them a server has seen with a short header since the last Handshake packet.
    pub(super) premature_packets: Option<u32>,
    /// They are worth another try.
    pub(super) can_read_more: bool,
    /// With them. They have been waiting, so they tell nothing about the round trip.
    pub(super) is_catching_up: bool,
}

impl Setup {
    pub(super) fn new(now: Instant, version: Version, destination: ConnectionId) -> Self {
        Self {
            started_at: now,
            original_version: version,
            original_destination: destination,
            initial_destination: destination,
            initial_source: None,
            token: Vec::new(),
            other_keys: None,
            is_version_settled: false,
            is_validated_by_peer: false,
            remembered: None,
            hello: Vec::new(),
            undecryptable: Vec::new(),
            premature_packets: None,
            can_read_more: false,
            is_catching_up: false,
        }
    }

    /// RFC 8446 §4.
    fn has_hello(&self) -> bool {
        matches!(*self.hello, [_, a, b, c, ref body @ ..]
            if body.len() >= u32::from_be_bytes([0, a, b, c]) as usize)
    }
}

/// What a server has yet to get.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Awaited {
    Hello,
    /// For [`Connection::answer_hello`].
    Turn,
    Finished,
}

/// What [`Event::Ticket`] has.
pub(super) struct Ticket<'a> {
    pub(super) version: Version,
    session: &'a [u8],
    parameters: TransportParameters,
}

impl<'a> Ticket<'a> {
    pub(super) fn read(mut input: &'a [u8]) -> Option<Self> {
        let number = |input: &mut &[u8]| input.array().map(u32::from_be_bytes);
        let bytes = |input: &mut &'a [u8]| number(input).and_then(|len| input.bytes(len.into()));
        let version = Version::from_number(number(&mut input)?)?;
        number(&mut input).filter(|&format| format == TICKET_FORMAT)?;
        Some(Self {
            version,
            session: bytes(&mut input)?,
            parameters: TransportParameters::decode(bytes(&mut input)?, Side::Server)?.remembered(),
        })
    }

    fn encode(&self) -> Vec<u8> {
        let parameters = self.parameters.encode();
        let len = |bytes: &[u8]| (bytes.len() as u32).to_be_bytes();
        [
            &self.version.number().to_be_bytes(),
            &TICKET_FORMAT.to_be_bytes(),
            &len(self.session),
            self.session,
            &len(&parameters),
            &parameters,
        ]
        .concat()
    }
}

/// What TLS tells the connection.
pub struct Handshake<'a> {
    connection: &'a mut Connection,
    now: Instant,
    error: Option<Error>,
}

impl Handshake<'_> {
    pub fn version(&self) -> Version {
        self.connection.version
    }

    pub fn local_parameters(&self) -> Vec<u8> {
        self.connection.local.encode()
    }

    /// For a server, what has to be as it was when a ticket was issued for early data to be accepted
    /// (RFC 9001 §4.6.3 and RFC 9114 §7.2.4.2).
    pub fn early_data_context(&self) -> Vec<u8> {
        let mut context = self.connection.local.remembered().encode();
        if let Some(config) = &self.connection.config.http3 {
            write_settings(config, &mut context);
        }
        context
    }

    /// A server has to get these before anything else. Returns false if the handshake must not go on.
    pub fn peer_parameters(&mut self, encoded: &[u8], accepts_early_data: bool) -> bool {
        let result = (self.connection).on_peer_parameters(encoded, accepts_early_data);
        self.error = result.err();
        result.is_ok()
    }

    pub fn read_secret(&mut self, level: Level, cipher: Cipher, secret: &[u8]) {
        let connection = &mut *self.connection;
        let secret = Secret::new(connection.crypto, cipher, secret);
        let keys = secret.keys(connection.version);
        with(connection.setup.as_mut(), |it| it.can_read_more = true);
        let limit = keys.payload.key.integrity_limit();
        connection.integrity_limit = connection.integrity_limit.min(limit);
        match level {
            Level::Initial => {}
            Level::EarlyData => connection.early_keys = Some(keys),
            Level::Handshake => connection.spaces.open(SpaceId::Handshake).read_keys = Some(keys),
            Level::Application => {
                connection.spaces.data.read_keys = Some(keys);
                (connection.key_update).set_read_secret(&secret, connection.version);
            }
        }
    }

    pub fn write_secret(&mut self, level: Level, cipher: Cipher, secret: &[u8]) {
        let connection = &mut *self.connection;
        let secret = Secret::new(connection.crypto, cipher, secret);
        let keys = secret.keys(connection.version);
        match level {
            Level::Initial => {}
            Level::EarlyData => connection.early_keys = Some(keys),
            Level::Handshake => connection.spaces.open(SpaceId::Handshake).write_keys = Some(keys),
            Level::Application => {
                let limit = keys.payload.key.confidentiality_limit();
                connection.spaces.data.write_keys = Some(keys);
                (connection.key_update).set_write_secret(secret, limit, &connection.spaces.data);
                if connection.side.is_client() {
                    connection.early_keys = None;
                }
            }
        }
    }

    pub fn send(&mut self, level: Level, data: &[u8]) {
        let space = match level {
            Level::Initial => SpaceId::Initial,
            Level::Handshake => SpaceId::Handshake,
            Level::EarlyData | Level::Application => SpaceId::Data,
        };
        if let Some(space) = self.connection.spaces.get_mut(space) {
            space.crypto_send.write(data);
        }
    }

    pub fn early_data_rejected(&mut self) {
        self.connection.on_early_data_rejected(self.now);
    }

    pub fn ticket(&mut self, session: &[u8]) {
        let connection = &mut *self.connection;
        if let Some(left) = connection.tickets_wanted.checked_sub(1) {
            connection.tickets_wanted = left;
            let ticket = Ticket {
                version: connection.version,
                session,
                parameters: connection.peer.remembered(),
            };
            connection.emit(Event::Ticket(ticket.encode()));
        }
    }

    pub fn key_log(&mut self, line: &[u8]) {
        self.connection.emit(Event::KeyLog(line.to_vec()));
    }
}

fn alert_error(alert: Alert) -> Error {
    let reason = match alert {
        NO_APPLICATION_PROTOCOL => "no application protocol",
        _ => "TLS alert",
    };
    Error::transport(transport_code::CRYPTO_ERROR + u64::from(alert.0), reason)
}

impl Connection {
    pub(crate) fn awaited(&self) -> Option<Awaited> {
        if self.side.is_client() || self.phase != Phase::Handshake || !self.is_receiving() {
            return None;
        }
        Some(match (&self.spaces.handshake, &self.setup) {
            (Some(_), _) => Awaited::Finished,
            (None, Some(setup)) if setup.has_hello() => Awaited::Turn,
            (None, _) => Awaited::Hello,
        })
    }

    pub(super) fn read_hello(&mut self, now: Instant, shared: &mut Shared) -> Result {
        let hello = (self.setup.as_mut()).map(|it| {
            // What still cannot be read has less room from now on.
            it.can_read_more = true;
            core::mem::take(&mut it.hello)
        });
        self.continue_handshake(now, Level::Initial, &hello.unwrap_or_default(), shared)
    }

    pub(super) fn set_initial_keys(&mut self) {
        let both = self.spaces.initial.as_mut().zip(self.setup.as_ref());
        with(both, |(space, setup)| {
            let secret = InitialSecret::new(self.crypto, self.version, &setup.initial_destination);
            space.read_keys = Some(secret.keys(!self.side));
            space.write_keys = Some(secret.keys(self.side));
        });
    }

    /// The versions that the connection can end up with, in the order of the server's preference.
    pub(super) fn compatible_versions(&self) -> impl Iterator<Item = Version> {
        let version = self.version;
        (self.config.versions.iter().rev().copied())
            .filter(move |it| it.is_compatible_with(version))
    }

    fn set_version_information(&mut self) {
        self.local.version_information = (self.version != Version::Draft29).then(|| {
            let is_settled = self.side.is_client() && self.is_version_settled();
            VersionInformation {
                chosen: self.version.number(),
                available: (self.compatible_versions())
                    .filter(|&it| it == self.version || !is_settled)
                    .map(Version::number)
                    .collect(),
            }
        });
    }

    pub(super) fn is_version_settled(&self) -> bool {
        self.setup.as_ref().is_none_or(|it| it.is_version_settled)
    }

    /// For a client.
    pub(super) fn start_handshake(&mut self, now: Instant, ticket: Option<Ticket>) -> Result {
        if let (Some(ticket), Some(tls), Some(setup)) = (ticket, &mut self.tls, &mut self.setup)
            && tls.resume(ticket.session)
        {
            setup.is_version_settled = true;
            setup.remembered = Some(ticket.parameters);
        }
        self.set_version_information();
        self.advance_tls(now, None)?;
        let remembered = self.setup.as_mut().and_then(|setup| {
            setup.remembered.take_if(|_| self.early_keys.is_none());
            setup.remembered.clone()
        });
        if let Some(remembered) = remembered {
            *self.peer = remembered;
            self.apply_peer_parameters();
            self.start_application(now)?;
            self.can_open_streams = true;
        }
        Ok(())
    }

    /// For when there are no events left that it is needed for.
    #[inline]
    pub(super) fn release_tls(&mut self) {
        if self.tls.is_some() && self.is_confirmed() && self.tickets_wanted == 0 {
            self.tls = None;
            self.spaces.data.crypto_kept = Default::default();
        }
    }

    fn wait_for_tickets(&mut self, now: Instant) {
        if self.tickets_wanted > 0 && self.is_confirmed() {
            let patience = match self.tickets_wanted {
                MAX_TICKETS => PATIENCE_FOR_TICKET * 2,
                _ => PATIENCE_FOR_TICKET,
            };
            (self.timers).set(Timer::Handshake, now + patience.max(self.settling_period()));
        }
    }

    fn advance_tls(&mut self, now: Instant, input: Option<(Level, &[u8])>) -> Result<Status> {
        let mut tls = self.tls.take();
        let mut handshake = Handshake {
            connection: self,
            now,
            error: None,
        };
        let result =
            (tls.as_mut()).map_or(Ok(Status::Complete), |it| it.advance(input, &mut handshake));
        let error = handshake.error;
        self.tls = tls;
        result.map_err(|alert| error.unwrap_or_else(|| alert_error(alert)))
    }

    pub(super) fn on_crypto(
        &mut self,
        now: Instant,
        id: SpaceId,
        offset: u64,
        data: &[u8],
        shared: &mut Shared,
    ) -> Result {
        let window = match self.path.is_validated {
            true => CRYPTO_WINDOW,
            false => UNVALIDATED_CRYPTO_WINDOW,
        };
        let Some(space) = self.spaces.get_mut(id) else {
            return Ok(());
        };
        let end = offset + data.len() as u64;
        if end <= space.crypto_read {
            return Ok(());
        }
        if id == SpaceId::Data {
            if self.side.is_server() {
                return Err(alert_error(UNEXPECTED_MESSAGE));
            }
            // Messages are told apart for as long as they arrive in order (RFC 9000 §7.5).
            while let Some(at) = self.next_message_at.checked_sub(offset)
                && let Some(&[kind, a, b, c]) = data.get(at as usize..).and_then(<[_]>::first_chunk)
            {
                match kind {
                    NEW_SESSION_TICKET => {}
                    // RFC 9001 §4.4.
                    CERTIFICATE_REQUEST => return Err(Error::violation("late authentication")),
                    _ => return Err(alert_error(UNEXPECTED_MESSAGE)),
                }
                self.next_message_at += 4 + u64::from(u32::from_be_bytes([0, a, b, c]));
            }
            if self.tickets_wanted == 0 {
                return Ok(());
            }
            self.streams.state.add_load(Load::Heavy);
        }
        if end > space.crypto_read + window {
            return Err(CRYPTO_BUFFER_EXCEEDED);
        }
        let Some(known) = space.crypto_read.checked_sub(offset) else {
            space.crypto_kept.insert(offset, data);
            return match space.crypto_kept.scattered_len() {
                ..=MAX_SCATTERED_CRYPTO_LEN => Ok(()),
                _ => Err(CRYPTO_BUFFER_EXCEEDED),
            };
        };
        self.read_crypto(
            now,
            id,
            data.get(known as usize..).unwrap_or_default(),
            shared,
        )?;
        while let Some(space) = self.spaces.get_mut(id)
            && let Some((offset, chunk)) = space.crypto_kept.pop(space.crypto_read)
        {
            let new = chunk.get((space.crypto_read - offset) as usize..);
            self.read_crypto(now, id, new.unwrap_or_default(), shared)?;
        }
        Ok(())
    }

    fn read_crypto(
        &mut self,
        now: Instant,
        id: SpaceId,
        data: &[u8],
        shared: &mut Shared,
    ) -> Result {
        let (level, next) = match id {
            SpaceId::Initial => (Level::Initial, self.spaces.handshake.as_deref()),
            SpaceId::Handshake => (Level::Handshake, Some(&self.spaces.data)),
            SpaceId::Data => (Level::Application, None),
        };
        if data.is_empty() {
            return Ok(());
        }
        // RFC 9001 §4.1.3.
        if next.is_some_and(|space| space.read_keys.is_some()) {
            return Err(Error::violation("CRYPTO frame at a level that is over"));
        }
        self.spaces.open(id).crypto_read += data.len() as u64;
        if let Some(setup) = &mut self.setup {
            setup.is_version_settled = true;
            setup.other_keys.take_if(|_| self.side.is_client());
            if id == SpaceId::Initial && self.side.is_server() {
                setup.hello.extend_from_slice(data);
                return match setup.hello.len() {
                    ..=MAX_HELLO_LEN => Ok(()),
                    _ => Err(CRYPTO_BUFFER_EXCEEDED),
                };
            }
        }
        if id != SpaceId::Data {
            return self.continue_handshake(now, level, data, shared);
        }
        for piece in data.chunks(MAX_TICKET_INPUT_LEN) {
            self.continue_handshake(now, level, piece, shared)?;
        }
        self.wait_for_tickets(now);
        Ok(())
    }

    fn continue_handshake(
        &mut self,
        now: Instant,
        level: Level,
        data: &[u8],
        shared: &mut Shared,
    ) -> Result {
        let status = self.advance_tls(now, Some((level, data)))?;
        match (status, self.phase) {
            (Status::Complete, Phase::Handshake) => self.on_handshake_complete(now, shared),
            (Status::InProgress, _) if self.side.is_server() && self.early_keys.is_some() => {
                self.become_ready(now)
            }
            _ => Ok(()),
        }
    }

    fn on_peer_parameters(&mut self, encoded: &[u8], accepts_early_data: bool) -> Result {
        let invalid = Error::transport(
            transport_code::TRANSPORT_PARAMETER_ERROR,
            "invalid transport parameters",
        );
        let peer = TransportParameters::decode(encoded, !self.side).ok_or(invalid)?;
        let setup = self.setup.as_mut().ok_or(invalid)?;
        let retry_source = Some(setup.initial_destination)
            .filter(|&it| self.side.is_client() && it != setup.original_destination);
        let original = self.side.is_client().then_some(setup.original_destination);
        // RFC 9000 §7.3.
        if peer.initial_source_connection_id != setup.initial_source
            || peer.original_destination_connection_id != original
            || peer.retry_source_connection_id != retry_source
        {
            return Err(invalid);
        }
        let versions = peer.version_information.as_ref();
        // RFC 9368 §4.
        if self.side.is_server() && versions.is_some_and(|it| !it.available.contains(&it.chosen)) {
            return Err(invalid);
        }
        if (setup.remembered.take()).is_some_and(|it| peer.reduces(&it)) {
            return Err(Error::violation(
                "limits are less than those for early data",
            ));
        }
        let request_window = match self.side {
            Side::Client => peer.initial_max_stream_data_bidi_remote,
            Side::Server => peer.initial_max_stream_data_bidi_local,
        };
        if self.config.http3.is_some()
            && request_window.min(peer.initial_max_data) < MIN_HTTP3_WINDOW
        {
            return Err(invalid);
        }
        self.negotiate_version(versions, accepts_early_data)?;
        *self.peer = peer;
        self.apply_peer_parameters();
        Ok(())
    }

    /// RFC 9368 §4.
    fn negotiate_version(
        &mut self,
        peer: Option<&VersionInformation>,
        accepts_early_data: bool,
    ) -> Result {
        let has_changed =
            (self.setup.as_ref()).is_some_and(|it| it.original_version != self.version);
        if peer.map_or(has_changed, |it| it.chosen != self.version.number()) {
            return Err(Error::transport(
                transport_code::VERSION_NEGOTIATION_ERROR,
                "chosen version mismatch",
            ));
        }
        if self.side.is_client() {
            return Ok(());
        }
        let is_available =
            |it: &Version| peer.is_some_and(|peer| peer.available.contains(&it.number()));
        let preferred = self.compatible_versions().find(is_available);
        // Some clients go by the first packet that they get.
        let has_answered = self.local.retry_source_connection_id.is_some()
            || (self.spaces.initial.as_ref()).is_none_or(|it| it.next_number > 0);
        let may_switch = !accepts_early_data && !has_answered;
        if let Some(version) = preferred.filter(|&it| it != self.version && may_switch) {
            self.switch_version(version);
        }
        self.set_version_information();
        Ok(())
    }

    pub(super) fn switch_version(&mut self, version: Version) {
        let old = core::mem::replace(&mut self.version, version);
        let keys = (self.spaces.initial.as_mut()).and_then(|it| it.read_keys.take());
        with(self.setup.as_mut(), |setup| {
            setup.other_keys = (keys.map(|keys| (old, keys))).filter(|_| self.side.is_server());
            setup.is_version_settled = true;
        });
        self.set_initial_keys();
    }

    fn apply_peer_parameters(&mut self) {
        self.streams.set_peer_parameters(&self.peer);
        (self.path.mtu).set_peer_limit(self.peer.max_udp_payload_size);
        self.congestion.set_datagram_len(self.path.mtu.current);
        let timeouts = [&self.local, &self.peer].map(|it| it.max_idle_timeout_millis);
        let shortest = timeouts.into_iter().filter(|&it| it > 0).min();
        self.idle_timeout = Duration::from_millis(shortest.unwrap_or(0));
        if shortest.is_none() {
            self.timers.stop(Timer::Idle);
        }
    }

    /// RFC 9001 §4.6.2.
    fn on_early_data_rejected(&mut self, now: Instant) {
        self.early_keys = None;
        self.resend_all(SpaceId::Data);
        with(self.setup.as_mut(), |it| it.remembered = None);
        for (id, _) in core::mem::take(&mut self.datagrams.unsent) {
            self.emit(Event::DatagramLost(id));
        }
        self.emit(Event::EarlyDataRejected);
        self.streams.close_all();
        let new = self.new_streams();
        let Streams { table, state, .. } = core::mem::replace(&mut self.streams, new);
        (self.streams.state.events, self.streams.state.removed) = (state.events, state.removed);
        self.streams.table.is_going_away = table.is_going_away;
        self.update_unsent_target();
        (self.http3, self.can_open_streams) = (None, false);
        self.set_loss_timer(now);
    }

    fn start_application(&mut self, now: Instant) -> Result {
        if let Some(config) = &self.config.http3
            && self.http3.is_none()
        {
            let http3 = (self.streams).start_http3(config, &self.config.parameters, self.side);
            self.http3 = Some(http3.ok_or(Error::http3(
                http3_code::GENERAL_PROTOCOL_ERROR,
                "peer allows too few unidirectional streams",
            ))?);
        }
        self.restart_progress_timer(now);
        Ok(())
    }

    fn become_ready(&mut self, now: Instant) -> Result {
        if !core::mem::replace(&mut self.is_ready, true) {
            self.start_application(now)?;
            self.emit(Event::Ready);
        }
        Ok(())
    }

    fn on_handshake_complete(&mut self, now: Instant, shared: &mut Shared) -> Result {
        self.phase = Phase::Established;
        if self.timers.is_set(Timer::Handshake) {
            (self.timers).set(Timer::Handshake, now + self.config.handshake_timeout);
        }
        with(self.setup.as_mut(), |it| it.can_read_more = true);
        if self.side.is_client() {
            self.path.remote.reset_token = self.peer.stateless_reset_token;
            self.track_reset_token(&self.path, shared);
        }
        (self.local_ids).set_peer_limit(self.peer.active_connection_id_limit);
        if self.config.adapts_ack_frequency
            && self.config.congestion == Algorithm::Bbr
            && (self.peer.min_ack_delay_micros).is_some_and(|it| it <= MIN_ACK_DELAY.as_micros())
        {
            self.ack_controller = Some(ack_frequency::Controller::new(now, self.rtt.smoothed));
        }
        self.plan_skip();
        self.start_keep_alive(now);
        self.become_ready(now)?;
        if self.side.is_server() {
            self.streams.state.owed |= Control::HANDSHAKE_DONE | Control::NEW_TOKEN;
            return self.confirm_handshake(now, shared);
        }
        Ok(())
    }

    /// RFC 9001 §4.1.2.
    pub(super) fn confirm_handshake(&mut self, now: Instant, shared: &mut Shared) -> Result {
        if self.phase != Phase::Established {
            return Ok(());
        }
        self.phase = Phase::Confirmed;
        self.timers.stop(Timer::Handshake);
        self.wait_for_tickets(now);
        self.discard_space(now, |it| it.initial.take());
        self.discard_space(now, |it| it.handshake.take());
        self.emit(Event::HandshakeConfirmed);
        match self.side {
            Side::Client => self.try_preferred_address(now, shared),
            Side::Server => {
                (self.timers).set(Timer::KeyDiscard, now + self.settling_period());
                Ok(())
            }
        }
    }

    pub(super) fn on_new_token(&mut self, token: &[u8]) -> Result {
        if self.side.is_server() {
            return Err(Error::violation("NEW_TOKEN frame from a client"));
        }
        self.tokens_received = self.tokens_received.saturating_add(1);
        if self.tokens_received <= MAX_TOKENS && token.len() <= MAX_TOKEN_LEN {
            self.emit(Event::Token(token.to_vec()));
        }
        Ok(())
    }

    /// RFC 9000 §17.2.5.2.
    pub(super) fn on_retry(&mut self, now: Instant, header: &LongHeader, packet: &[u8]) {
        let is_for = |original: &ConnectionId| {
            (packet.split_at_checked(header.number_offset)).is_some_and(|(packet, tag)| {
                retry_tag(self.crypto, self.version, original, packet) == tag
            })
        };
        let Some(setup) = self.setup.as_mut().filter(|setup| {
            self.side.is_client()
                && setup.initial_source.is_none()
                && setup.token.is_empty()
                && header.version == self.version
                && header.source != setup.original_destination
                && (1..=MAX_TOKEN_LEN).contains(&header.token.len())
                && is_for(&setup.original_destination)
        }) else {
            return;
        };
        setup.token = header.token.to_vec();
        setup.initial_destination = header.source;
        setup.other_keys = None;
        self.path.remote.id = header.source;
        self.set_initial_keys();
        self.spaces.open(SpaceId::Initial).crypto_ends.clear();
        self.resend_all(SpaceId::Initial);
        self.resend_all(SpaceId::Data);
        self.pto_count = 0;
        self.set_loss_timer(now);
    }

    /// RFC 9000 §6.2.
    pub(super) fn on_version_negotiation(&mut self, packet: &Invariants) {
        let (versions, rest) = packet.rest.as_chunks();
        let is_acceptable = self.setup.as_ref().is_some_and(|setup| {
            self.side.is_client()
                && setup.initial_source.is_none()
                && setup.token.is_empty()
                && packet.source == &*setup.original_destination
                && rest.is_empty()
                && !versions.is_empty()
                && !versions.contains(&self.version.number().to_be_bytes())
        });
        if is_acceptable {
            self.drain(CloseReason::NoCommonVersion);
        }
    }
}
