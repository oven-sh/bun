mod ack_frequency;
mod application;
mod close;
mod datagrams;
pub(crate) mod handshake;
mod http3;
mod ids;
mod key_update;
mod mtu;
mod paths;
mod receive;
mod received;
mod recovery;
mod runs;
mod sent;
mod space;
pub(crate) mod streams;
mod timers;
mod transmit;

use core::net::SocketAddr;
use std::rc::Rc;

pub use application::StreamInfo;

use close::CloseFrame;
use datagrams::Datagrams;
use handshake::{Setup, Ticket};
use ids::{LocalIds, RemoteId, RemoteIds};
use key_update::KeyUpdate;
use paths::Path;
use runs::Runs;
use sent::Control;
use space::{Space, Spaces};
use streams::Streams;
use timers::{Timer, Timers};

use crate::cid::{ConnectionId, LocalId};
use crate::config::{Config, KeepAlive};
use crate::congestion::{Controller, Rtt};
use crate::crypto::{Crypto, Keys};
use crate::endpoint::Shared;
use crate::error::{Error, transport_code};
use crate::event::{CloseReason, Context, Event};
use crate::http3::Http3;
use crate::packet::MIN_INITIAL_ID_LEN;
use crate::path::Addresses;
use crate::stream_id::Side;
use crate::time::{Duration, Instant};
use crate::tls;
use crate::token_bucket::TokenBucket;
use crate::transport_parameters::TransportParameters;
use crate::version::Version;

const EXPECTED_PAUSE: Duration = Duration::from_secs(1);
const MIN_IDLE_TIMEOUT_TO_KEEP_ALIVE: Duration = Duration::from_secs(2);
const NEW_PATHS: TokenBucket = TokenBucket::new(1.0, 16.0);
const TOLERATED_LOAD: TokenBucket = TokenBucket::new(330.0, 10_000.0);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Handshake,
    /// RFC 9001 §4.1.1.
    Established,
    /// RFC 9001 §4.1.2.
    Confirmed,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Ending {
    No,
    /// What has been written is being delivered.
    Graceful,
    /// CONNECTION_CLOSE is yet to be sent.
    Closing,
    Over,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct Stats {
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub packets_sent: u64,
    pub packets_received: u64,
    pub packets_lost: u64,
    pub packets_retransmitted: u64,
    pub pings_received: u64,
    pub datagrams_sent: u64,
    pub congestion_window: u64,
    pub smoothed_rtt: Duration,
    pub rtt_variation: Duration,
    pub min_rtt: Duration,
}

pub struct Connection {
    pub context: Context,
    crypto: &'static dyn Crypto,
    config: Rc<Config>,
    /// In the endpoint.
    slot: u32,
    side: Side,
    version: Version,
    phase: Phase,
    ending: Ending,
    timers: Timers,
    stats: Stats,

    tls: Option<Box<dyn tls::Session>>,
    setup: Option<Box<Setup>>,
    local: Box<TransportParameters>,
    peer: Box<TransportParameters>,
    is_ready: bool,
    can_open_streams: bool,
    tickets_received: u8,
    tokens_received: u8,
    origin_frames_received: u8,

    spaces: Spaces,
    /// For 0-RTT packets.
    early_keys: Option<Keys>,
    key_update: KeyUpdate,
    /// How many more packets can fail authentication.
    integrity_limit: u64,
    /// The packet number that is going to be left out (RFC 9000 §21.4).
    next_skip: u64,
    /// The last one that was.
    skipped: Option<u64>,
    uses_spin_bit: bool,
    spin_bit: bool,

    path: Path,
    candidates: Vec<Path>,
    new_paths: TokenBucket,
    first_peer: SocketAddr,
    previous_peer: Option<SocketAddr>,
    /// The ID that the client chose for us.
    initial_route: Option<ConnectionId>,
    local_ids: LocalIds,
    remote_ids: RemoteIds,

    rtt: Rtt,
    first_sample_at: Instant,
    congestion: Controller,
    runs: Runs,
    pto_count: u32,
    /// How many times in a row the peer was quick to acknowledge all that was in flight, without a probe.
    prompt_acks: u8,
    /// Once between two timeouts.
    may_probe_early: bool,
    delivery: recovery::Delivery,
    packet_threshold: u64,
    /// How many times packets were lost since one was overtaken.
    losses_in_order: u8,
    ack_policy: ack_frequency::Policy,
    ack_controller: Option<ack_frequency::Controller>,
    ack_only_packets: u32,

    tolerated_load: TokenBucket,
    earned_load: u64,
    idle_timeout: Duration,
    has_sent_since_receiving: bool,
    progress_timeout: Duration,
    keep_alive: KeepAlive,
    keep_alive_period: Duration,
    /// In its place after an ack-eliciting packet, as more may be on the way to an address that is gone.
    expected_pause: Duration,

    streams: Streams,
    datagrams: Datagrams,
    http3: Option<Box<Http3>>,

    close_reason: CloseReason,
    close_frame: CloseFrame,
    /// The datagram that had the CONNECTION_CLOSE frame.
    farewell: Vec<u8>,
    /// Whether packets are to be expected after the end.
    lingers: bool,
}

/// What a server knows from the first packet.
pub(crate) struct Introduction {
    pub(crate) version: Version,
    pub(crate) source: ConnectionId,
    pub(crate) destination: ConnectionId,
    /// Of the packet that was answered with a Retry packet.
    pub(crate) original_destination: Option<ConnectionId>,
    pub(crate) read_keys: Keys,
    pub(crate) write_keys: Keys,
}

/// What is left of a connection for a while (RFC 9000 §10.2).
pub(crate) struct Remains {
    pub(crate) ids: Vec<LocalId>,
    pub(crate) initial_route: Option<ConnectionId>,
    pub(crate) addresses: Addresses,
    pub(crate) farewell: Vec<u8>,
    pub(crate) lingers_for: Duration,
    pub(crate) datagrams_received: u32,
}

impl Connection {
    fn new(
        now: Instant,
        slot: u32,
        side: Side,
        config: Rc<Config>,
        mut path: Path,
        setup: Setup,
        tls: Box<dyn tls::Session>,
        shared: &mut Shared,
    ) -> Box<Self> {
        let crypto = shared.crypto;
        let [spin, a, b, c, d, seed @ ..] = crypto.random::<13>();
        let mut local_ids = LocalIds::default();
        let id = local_ids.issue(slot, shared);
        let local = Box::new(TransportParameters {
            initial_source_connection_id: Some(id.into()),
            active_connection_id_limit: ids::ACTIVE_LIMIT as u64,
            ack_delay_exponent: received::ACK_DELAY_EXPONENT,
            max_ack_delay_millis: ack_frequency::MAX_ACK_DELAY.as_millis(),
            min_ack_delay_micros: (config.adapts_ack_frequency)
                .then_some(ack_frequency::MIN_ACK_DELAY.as_micros()),
            ..config.parameters.clone()
        });
        let random = u32::from_ne_bytes([a, b, c, d]);
        path.local_id = Some(id);
        let mut this = Box::new(Self {
            context: core::ptr::null_mut(),
            crypto,
            slot,
            side,
            version: setup.original_version,
            phase: Phase::Handshake,
            ending: Ending::No,
            timers: Timers::default(),
            stats: Stats::default(),
            tls: Some(tls),
            setup: Some(Box::new(setup)),
            peer: Box::default(),
            is_ready: false,
            can_open_streams: false,
            tickets_received: 0,
            tokens_received: 0,
            origin_frames_received: 0,
            spaces: Spaces::default(),
            early_keys: None,
            key_update: KeyUpdate::default(),
            integrity_limit: u64::MAX,
            next_skip: u64::MAX,
            skipped: None,
            // RFC 9000 §17.4.
            uses_spin_bit: spin >= 16,
            spin_bit: spin < 8,
            congestion: Controller::new(config.congestion, path.mtu.current, random),
            first_peer: path.addresses.peer,
            path,
            candidates: Vec::new(),
            new_paths: NEW_PATHS,
            previous_peer: None,
            initial_route: None,
            local_ids,
            remote_ids: RemoteIds::default(),
            rtt: Rtt::default(),
            first_sample_at: Instant::NEVER,
            runs: Runs::default(),
            pto_count: 0,
            prompt_acks: 0,
            may_probe_early: true,
            delivery: Default::default(),
            packet_threshold: recovery::INITIAL_PACKET_THRESHOLD,
            losses_in_order: 0,
            ack_policy: Default::default(),
            ack_controller: None,
            ack_only_packets: 0,
            tolerated_load: TOLERATED_LOAD,
            earned_load: 0,
            idle_timeout: Duration::from_millis(local.max_idle_timeout_millis),
            has_sent_since_receiving: false,
            progress_timeout: config.progress_timeout,
            keep_alive: config.keep_alive,
            keep_alive_period: Duration::MAX,
            expected_pause: Duration::MAX,
            streams: Streams::new(side, &local, &config, u64::from_ne_bytes(seed)),
            datagrams: Datagrams::default(),
            http3: None,
            close_reason: CloseReason::Local,
            close_frame: CloseFrame::no_error(config.http3.is_some()),
            farewell: Vec::new(),
            lingers: true,
            local,
            config,
        });
        if !this.config.handshake_timeout.is_zero() {
            (this.timers).set(Timer::Handshake, now + this.config.handshake_timeout);
        }
        this.restart_idle_timer(now);
        this.update_unsent_target();
        this
    }

    pub(crate) fn connect(
        now: Instant,
        slot: u32,
        config: Rc<Config>,
        addresses: Addresses,
        tls: Box<dyn tls::Session>,
        ticket: &[u8],
        shared: &mut Shared,
    ) -> Box<Self> {
        let ticket = Ticket::read(ticket).filter(|it| config.versions.contains(&it.version));
        let first = config.versions.first().copied().unwrap_or(Version::V1);
        let version = ticket.as_ref().map_or(first, |it| it.version);
        let [len, bytes @ ..] = shared.crypto.random::<{ 1 + ConnectionId::MAX_LEN }>();
        let lens = ConnectionId::MAX_LEN + 1 - MIN_INITIAL_ID_LEN;
        let len = MIN_INITIAL_ID_LEN + usize::from(len) % lens;
        let id = (bytes.get(..len).and_then(ConnectionId::new)).unwrap_or_default();
        let path = Path::new(addresses, RemoteId::first(id), true);
        let setup = Setup::new(now, version, id);
        let mut this = Self::new(now, slot, Side::Client, config, path, setup, tls, shared);
        this.spaces.initial = Some(Box::default());
        this.set_initial_keys();
        if let Err(error) = this.start_handshake(now, ticket) {
            this.fail(now, error);
            this.abort_silently();
        }
        this
    }

    pub(crate) fn accept(
        now: Instant,
        slot: u32,
        config: Rc<Config>,
        addresses: Addresses,
        tls: Box<dyn tls::Session>,
        client: Introduction,
        shared: &mut Shared,
    ) -> Box<Self> {
        let remote = RemoteId::first(client.source);
        let path = Path::new(addresses, remote, client.original_destination.is_some());
        let mut setup = Setup::new(now, client.version, client.destination);
        setup.initial_source = Some(client.source);
        let mut this = Self::new(now, slot, Side::Server, config, path, setup, tls, shared);
        this.initial_route = Some(client.destination);
        this.spaces.initial = Some(Box::new(Space {
            read_keys: Some(client.read_keys),
            write_keys: Some(client.write_keys),
            ..Space::default()
        }));
        let (local, original) = (&mut this.local, client.original_destination);
        local.original_destination_connection_id = original.or(Some(client.destination));
        local.retry_source_connection_id = original.map(|_| client.destination);
        local.stateless_reset_token =
            (local.initial_source_connection_id).map(|it| shared.tokens.reset_token(&it));
        if let Some(preferred) = &mut local.preferred_address {
            let id = this.local_ids.issue(slot, shared);
            preferred.id = id.into();
            preferred.reset_token = shared.tokens.reset_token(&id.0);
        }
        this
    }

    fn new_streams(&self) -> Streams {
        let seed = u64::from_ne_bytes(self.crypto.random());
        Streams::new(self.side, &self.local, &self.config, seed)
    }

    #[inline]
    fn emit(&mut self, event: Event) {
        self.streams.state.events.push_back(event);
    }

    /// For a connection that is over.
    pub(crate) fn remains(&mut self, shared: &mut Shared) -> Remains {
        (self.paths()).for_each(|path| self.untrack_reset_token(path, shared));
        Remains {
            ids: self.local_ids.iter().collect(),
            initial_route: self.initial_route,
            addresses: self.path.addresses,
            farewell: core::mem::take(&mut self.farewell),
            lingers_for: match self.lingers {
                true => self.settling_period(),
                false => Duration::ZERO,
            },
            datagrams_received: 0,
        }
    }

    #[inline]
    pub(crate) fn timeout(&self) -> Instant {
        self.timers.earliest()
    }

    pub(crate) fn handle_timeouts(&mut self, now: Instant, shared: &mut Shared) {
        for timer in Timer::ALL {
            if self.timers.get(timer) <= now {
                self.timers.stop(timer);
                self.on_timeout(now, timer, shared);
            }
        }
    }

    fn on_timeout(&mut self, now: Instant, timer: Timer, shared: &mut Shared) {
        match timer {
            Timer::Handshake => self.time_out(now, CloseReason::HandshakeTimeout),
            Timer::Idle if self.phase == Phase::Handshake => {
                self.time_out(now, CloseReason::HandshakeTimeout);
            }
            Timer::Idle => self.time_out(now, CloseReason::IdleTimeout),
            Timer::Progress if core::mem::take(&mut self.streams.state.made_progress) => {
                self.restart_progress_timer(now);
            }
            Timer::Progress => {
                let reason = "connection timed out due to lack of progress";
                let error = Error::transport(transport_code::APPLICATION_ERROR, reason);
                self.fail(now, error);
            }
            Timer::Close if self.ending == Ending::Closing => self.end(),
            Timer::Close => self.send_close(now),
            Timer::Loss => self.on_loss_timeout(now),
            Timer::Ack => self.spaces.data.received.is_ack_due = true,
            Timer::Qpack => {
                if let Err(error) = self.send_qpack_instructions() {
                    self.fail(now, error);
                }
            }
            Timer::Pacing => {}
            Timer::KeepAlive => {
                if self.keep_alive != KeepAlive::WhileStreamsAreOpen
                    || self.streams.table.has_application_streams()
                {
                    self.streams.state.owed |= Control::PING;
                }
                (self.timers).set(Timer::KeepAlive, now + self.keep_alive_period);
            }
            Timer::Blocked => self.streams.repeat_blocked(),
            Timer::Path => match self.on_path_timeout(now, shared) {
                Ok(()) => self.set_path_timer(),
                Err(error) => self.fail(now, error),
            },
            Timer::KeyDiscard => {
                self.key_update.discard_previous();
                self.early_keys = None;
            }
        }
    }

    fn start_keep_alive(&mut self, now: Instant) {
        (self.keep_alive_period, self.expected_pause) = match self.keep_alive {
            KeepAlive::Every(period) if !period.is_zero() => (period, period),
            KeepAlive::WhileStreamsAreOpen
                if self.idle_timeout >= MIN_IDLE_TIMEOUT_TO_KEEP_ALIVE =>
            {
                let period = self.idle_timeout / 2;
                match self.side {
                    Side::Client => (period, EXPECTED_PAUSE),
                    Side::Server => (period, period),
                }
            }
            _ => (Duration::MAX, Duration::MAX),
        };
        (self.timers).set(Timer::KeepAlive, now + self.keep_alive_period);
    }

    pub fn addresses(&self) -> &Addresses {
        &self.path.addresses
    }

    pub(crate) fn is_validated(&self) -> bool {
        self.path.is_validated
    }

    /// See [`Event::Ready`].
    pub fn is_ready(&self) -> bool {
        self.is_ready
    }

    #[inline]
    fn is_confirmed(&self) -> bool {
        self.phase == Phase::Confirmed
    }

    /// It is there until [`Event::Ready`] and [`Event::HandshakeConfirmed`] have been handled.
    pub fn tls(&self) -> Option<&dyn tls::Session> {
        self.tls.as_deref()
    }

    /// `None` until they have arrived.
    pub fn peer_parameters(&self) -> Option<&TransportParameters> {
        (self.can_open_streams || self.peer.initial_source_connection_id.is_some())
            .then_some(&self.peer)
    }

    pub fn local_parameters(&self) -> &TransportParameters {
        &self.local
    }

    pub fn stats(&self) -> Stats {
        Stats {
            congestion_window: self.congestion.window(),
            smoothed_rtt: self.rtt.smoothed,
            rtt_variation: self.rtt.variation,
            min_rtt: self.rtt.min,
            ..self.stats
        }
    }
}
