use crate::congestion::Algorithm;
use crate::time::Duration;
use crate::transport_parameters::TransportParameters;
use crate::version::Version;

/// For the connections that share it.
#[derive(Clone)]
pub struct Config {
    /// A client starts with the first one. A server moves to the last one that the client can move to.
    pub versions: &'static [Version],
    /// The connection fills in what is its own. The delay of acknowledgments and the number of IDs are fixed.
    pub parameters: TransportParameters,
    pub congestion: Algorithm,
    /// Zero turns it off, like the other durations.
    pub handshake_timeout: Duration,
    /// For how long the application may neither read nor write.
    pub progress_timeout: Duration,
    pub keep_alive: KeepAlive,
    /// Whether a timeout goes without CONNECTION_CLOSE.
    pub closes_silently: bool,
    /// Whether acknowledgments can be made less frequent (draft-iyengar-quic-delayed-ack-02).
    pub adapts_ack_frequency: bool,
    /// Whether a client goes on with TLS after the handshake.
    pub wants_tickets: bool,
    pub uses_preferred_address: bool,
    /// Whether to go by what the peer says about priorities (RFC 9218).
    pub has_priorities: bool,
    /// Whether streams that are not incremental go one after the other, as opposed to in turns (RFC 9218 §10). If not,
    /// priorities have no say in which stream may write.
    pub sends_in_order: bool,
    /// Whether what the application has got counts as unread until [`consume`](crate::Connection::consume).
    pub awaits_consumption: bool,
    /// Whether what is unread counts for the limit of the connection, so that it can hold up other streams.
    pub limits_unread_data: bool,
    pub http3: Option<Http3Config>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeepAlive {
    Never,
    /// After half of the idle timeout.
    WhileStreamsAreOpen,
    Every(Duration),
}

#[derive(Clone, Default)]
pub struct Http3Config {
    /// Fields beyond this are left out.
    pub kept_fields: FieldLimits,
    /// A message with more than this is malformed.
    pub tolerated_fields: FieldLimits,
    /// What a field counts for on top of its name and value in `kept_fields`.
    pub field_overhead: usize,
    pub advertises_max_field_section_size: bool,
    pub encodes_with_dynamic_table: bool,
    /// RFC 9297 §2.1.1.
    pub datagrams: bool,
    /// RFC 9220 §3.
    pub connect_protocol: bool,
    /// The payload of the ORIGIN frame of a server (RFC 9412 §2).
    pub origins: Vec<u8>,
}

/// For one field section.
#[derive(Clone, Copy, Default)]
pub struct FieldLimits {
    pub size: usize,
    pub count: usize,
}

impl Config {
    pub fn server() -> Self {
        Self {
            versions: &[Version::V1, Version::V2],
            parameters: TransportParameters {
                max_idle_timeout_millis: 30_000,
                initial_max_data: 1536 * 1024,
                initial_max_stream_data_bidi_remote: 1024 * 1024,
                initial_max_stream_data_uni: 12 * 1024,
                initial_max_streams_bidi: 100,
                initial_max_streams_uni: 3,
                ..Default::default()
            },
            congestion: Algorithm::Bbr,
            handshake_timeout: Duration::from_secs(10),
            progress_timeout: Duration::from_secs(60),
            keep_alive: KeepAlive::Never,
            closes_silently: true,
            adapts_ack_frequency: true,
            wants_tickets: false,
            uses_preferred_address: false,
            has_priorities: false,
            sends_in_order: false,
            awaits_consumption: false,
            limits_unread_data: false,
            http3: None,
        }
    }

    pub fn client() -> Self {
        Self {
            parameters: TransportParameters {
                max_idle_timeout_millis: 30_000,
                initial_max_data: 15 * 1024 * 1024,
                initial_max_stream_data_bidi_local: 6 * 1024 * 1024,
                initial_max_stream_data_uni: 32 * 1024,
                initial_max_streams_bidi: 100,
                initial_max_streams_uni: 3,
                ..Default::default()
            },
            progress_timeout: Duration::ZERO,
            keep_alive: KeepAlive::WhileStreamsAreOpen,
            ..Self::server()
        }
    }
}
