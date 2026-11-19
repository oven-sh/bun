/// RFC 9000 §20.1.
pub mod transport_code {
    pub const NO_ERROR: u64 = 0x0;
    pub const INTERNAL_ERROR: u64 = 0x1;
    pub const CONNECTION_REFUSED: u64 = 0x2;
    pub const FLOW_CONTROL_ERROR: u64 = 0x3;
    pub const STREAM_LIMIT_ERROR: u64 = 0x4;
    pub const STREAM_STATE_ERROR: u64 = 0x5;
    pub const FINAL_SIZE_ERROR: u64 = 0x6;
    pub const FRAME_ENCODING_ERROR: u64 = 0x7;
    pub const TRANSPORT_PARAMETER_ERROR: u64 = 0x8;
    pub const CONNECTION_ID_LIMIT_ERROR: u64 = 0x9;
    pub const PROTOCOL_VIOLATION: u64 = 0xa;
    pub const INVALID_TOKEN: u64 = 0xb;
    pub const APPLICATION_ERROR: u64 = 0xc;
    pub const CRYPTO_BUFFER_EXCEEDED: u64 = 0xd;
    pub const KEY_UPDATE_ERROR: u64 = 0xe;
    pub const AEAD_LIMIT_REACHED: u64 = 0xf;
    /// RFC 9368 §4.
    pub const VERSION_NEGOTIATION_ERROR: u64 = 0x11;
    /// The number of a TLS alert is added to this.
    pub const CRYPTO_ERROR: u64 = 0x100;
}

/// RFC 9114 §8.1.
pub mod http3_code {
    pub const NO_ERROR: u64 = 0x100;
    pub const GENERAL_PROTOCOL_ERROR: u64 = 0x101;
    pub const INTERNAL_ERROR: u64 = 0x102;
    pub const STREAM_CREATION_ERROR: u64 = 0x103;
    pub const CLOSED_CRITICAL_STREAM: u64 = 0x104;
    pub const FRAME_UNEXPECTED: u64 = 0x105;
    pub const FRAME_ERROR: u64 = 0x106;
    pub const EXCESSIVE_LOAD: u64 = 0x107;
    pub const ID_ERROR: u64 = 0x108;
    pub const SETTINGS_ERROR: u64 = 0x109;
    pub const MISSING_SETTINGS: u64 = 0x10a;
    pub const REQUEST_REJECTED: u64 = 0x10b;
    pub const REQUEST_CANCELLED: u64 = 0x10c;
    pub const REQUEST_INCOMPLETE: u64 = 0x10d;
    pub const MESSAGE_ERROR: u64 = 0x10e;
}

/// Which kind of CONNECTION_CLOSE frame a code belongs in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layer {
    Transport,
    Application,
}

/// What the peer did wrong. It ends the connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Error {
    pub(crate) layer: Layer,
    pub(crate) code: u64,
    pub(crate) reason: &'static str,
}

impl Error {
    pub(crate) const fn transport(code: u64, reason: &'static str) -> Self {
        Self {
            layer: Layer::Transport,
            code,
            reason,
        }
    }

    pub(crate) const fn http3(code: u64, reason: &'static str) -> Self {
        Self {
            layer: Layer::Application,
            code,
            reason,
        }
    }

    pub(crate) const fn violation(reason: &'static str) -> Self {
        Self::transport(transport_code::PROTOCOL_VIOLATION, reason)
    }
}

pub(crate) type Result<T = (), E = Error> = core::result::Result<T, E>;
