//! Address validation tokens (RFC 9000 §8.1) and stateless reset tokens (§10.3.2).

use core::net::{IpAddr, SocketAddr};

use crate::cid::{ConnectionId, ResetToken};
use crate::coding::Read;
use crate::crypto::{Cipher, Crypto, NONCE_LEN, PacketKey};
use crate::time::{Duration, Instant};
use crate::version::Version;

const RETRY: u8 = 0;
const NEW_TOKEN: u8 = 1;
pub(crate) const RETRY_LIFETIME: Duration = Duration::from_secs(10);
const NEW_TOKEN_LIFETIME: Duration = Duration::from_secs(24 * 3600);

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Validation {
    /// With the ID that the packet had which was answered with a Retry packet.
    Retry(ConnectionId),
    InvalidRetry,
    NewToken,
    /// As if there were no token.
    Unknown,
}

pub(crate) struct Tokens {
    crypto: &'static dyn Crypto,
    key: Option<Box<dyn PacketKey>>,
    /// A key is good for 2^32 random nonces.
    issued: u32,
    reset_secret: [u8; 32],
}

/// What a token is good for.
pub(crate) struct Scope<'a> {
    pub(crate) version: Version,
    pub(crate) peer: SocketAddr,
    /// Of the Initial packet that has the token.
    pub(crate) destination: &'a [u8],
}

impl Scope<'_> {
    fn associated_data(&self, kind: u8) -> Vec<u8> {
        let destination = if kind == RETRY { self.destination } else { &[] };
        [
            &[kind][..],
            &self.version.number().to_be_bytes(),
            destination,
        ]
        .concat()
    }

    fn address(&self, kind: u8) -> ([u8; 16], [u8; 2]) {
        let ip = match self.peer.ip() {
            IpAddr::V4(ip) => ip.to_ipv6_mapped(),
            IpAddr::V6(ip) => ip,
        };
        let port = if kind == RETRY { self.peer.port() } else { 0 };
        (ip.octets(), port.to_be_bytes())
    }
}

impl Tokens {
    pub(crate) fn new(crypto: &'static dyn Crypto) -> Self {
        Self {
            crypto,
            key: None,
            issued: 0,
            reset_secret: crypto.random(),
        }
    }

    pub(crate) fn reset_token(&self, id: &[u8]) -> ResetToken {
        let mut token = [0; ResetToken::LEN];
        (self.crypto).expand(Cipher::Aes128GcmSha256, &self.reset_secret, id, &mut token);
        ResetToken(token)
    }

    pub(crate) fn retry(&mut self, now: Instant, scope: &Scope, original: &[u8]) -> Vec<u8> {
        self.seal(RETRY, now, scope, original)
    }

    pub(crate) fn new_token(&mut self, now: Instant, scope: &Scope) -> Vec<u8> {
        self.seal(NEW_TOKEN, now, scope, &[])
    }

    fn seal(&mut self, kind: u8, now: Instant, scope: &Scope, id: &[u8]) -> Vec<u8> {
        self.key.take_if(|_| self.issued == 0);
        self.issued = self.issued.wrapping_add(1);
        let key = self.key.get_or_insert_with(|| {
            (self.crypto).packet_key(Cipher::Aes128GcmSha256, &self.crypto.random::<16>())
        });
        let nonce: [u8; NONCE_LEN] = self.crypto.random();
        let (ip, port) = scope.address(kind);
        let mut secret = [&now.as_micros().to_be_bytes()[..], &ip, &port, id].concat();
        let tag = key.seal(&nonce, &scope.associated_data(kind), &mut secret);
        [&[kind][..], &nonce, &tag, &secret].concat()
    }

    pub(crate) fn validate(&self, now: Instant, scope: &Scope, token: &[u8]) -> Validation {
        self.open(now, scope, token).unwrap_or(Validation::Unknown)
    }

    fn open(&self, now: Instant, scope: &Scope, mut token: &[u8]) -> Option<Validation> {
        let (kind, nonce, tag) = (token.u8()?, token.array()?, token.array()?);
        let mut buffer = [0; 8 + 16 + 2 + ConnectionId::MAX_LEN];
        let secret = buffer.get_mut(..token.len())?;
        secret.copy_from_slice(token);
        if !(self.key.as_ref()?).open(&nonce, &scope.associated_data(kind), secret, &tag) {
            return None;
        }
        let mut secret = &*secret;
        let age = now - Instant::from_micros(u64::from_be_bytes(secret.array()?));
        let is_owner = (secret.array()?, secret.array()?) == scope.address(kind);
        match kind {
            RETRY if is_owner && age <= RETRY_LIFETIME => {
                ConnectionId::new(secret).map(Validation::Retry)
            }
            RETRY => Some(Validation::InvalidRetry),
            _ => (is_owner && age <= NEW_TOKEN_LIFETIME).then_some(Validation::NewToken),
        }
    }
}
