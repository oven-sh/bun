//! The TLS handshake (RFC 9001 §4), which the embedder provides.

use core::any::Any;

pub use crate::connection::handshake::Handshake;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Initial,
    EarlyData,
    Handshake,
    Application,
}

/// RFC 8446 §6.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Alert(pub u8);

impl Alert {
    pub(crate) const UNEXPECTED_MESSAGE: Self = Self(10);
    pub const ILLEGAL_PARAMETER: Self = Self(47);
    pub const INTERNAL_ERROR: Self = Self(80);
    pub const NO_APPLICATION_PROTOCOL: Self = Self(120);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    InProgress,
    Complete,
}

pub trait Session: Any {
    /// For a client, to offer a session from [`Handshake::ticket`]. Returns false if it cannot be used.
    fn resume(&mut self, ticket: &[u8]) -> bool;
    /// A client starts with no `input`.
    fn advance(
        &mut self,
        input: Option<(Level, &[u8])>,
        handshake: &mut Handshake<'_>,
    ) -> Result<Status, Alert>;
}
