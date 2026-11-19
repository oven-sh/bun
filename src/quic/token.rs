//! Address validation tokens (RFC 9000 §8.1) and stateless reset tokens (§10.3.2).

use core::net::{IpAddr, SocketAddr};

use crate::cid::{ConnectionId, ResetToken};
use crate::coding::Read;
use crate::crypto::{Cipher, Crypto, NONCE_LEN, PacketKey};
use crate::time::{Duration, Instant};
use crate::version::Version;

const RETRY: u8 = 0;
const NEW_TOKEN: u8 = 1;
const RETRY_LIFETIME: Duration = Duration::from_secs(10);
const NEW_TOKEN_LIFETIME: Duration = Duration::from_secs(24 * 3600);

pub(crate) enum Validation {
    /// With the ID that the packet had which was answered with a Retry packet.
    Retry(ConnectionId),
    NewToken,
    /// As if there were no token.
    Unknown,
}

pub(crate) struct Tokens {
    crypto: &'static dyn Crypto,
    key: Box<dyn PacketKey>,
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
    fn encode(&self, kind: u8) -> Vec<u8> {
        let ip = match self.peer.ip() {
            IpAddr::V4(ip) => ip.to_ipv6_mapped(),
            IpAddr::V6(ip) => ip,
        };
        let mut out = vec![kind];
        out.extend_from_slice(&self.version.number().to_be_bytes());
        out.extend_from_slice(&ip.octets());
        if kind == RETRY {
            out.extend_from_slice(&self.peer.port().to_be_bytes());
            out.extend_from_slice(self.destination);
        }
        out
    }
}

impl Tokens {
    pub(crate) fn new(crypto: &'static dyn Crypto) -> Self {
        Self {
            crypto,
            key: crypto.packet_key(Cipher::Aes128GcmSha256, &crypto.random::<16>()),
            reset_secret: crypto.random(),
        }
    }

    pub(crate) fn reset_token(&self, id: &[u8]) -> ResetToken {
        let mut token = [0; ResetToken::LEN];
        (self.crypto).expand(Cipher::Aes128GcmSha256, &self.reset_secret, id, &mut token);
        ResetToken(token)
    }

    pub(crate) fn retry(&self, now: Instant, scope: &Scope, original: &ConnectionId) -> Vec<u8> {
        self.seal(RETRY, now, scope, original)
    }

    pub(crate) fn new_token(&self, now: Instant, scope: &Scope) -> Vec<u8> {
        self.seal(NEW_TOKEN, now, scope, &[])
    }

    fn seal(&self, kind: u8, now: Instant, scope: &Scope, id: &[u8]) -> Vec<u8> {
        let nonce: [u8; NONCE_LEN] = self.crypto.random();
        let mut secret = [&now.as_micros().to_be_bytes(), id].concat();
        let tag = self.key.seal(&nonce, &scope.encode(kind), &mut secret);
        [&[kind][..], &nonce, &tag, &secret].concat()
    }

    pub(crate) fn validate(&self, now: Instant, scope: &Scope, token: &[u8]) -> Validation {
        match token {
            [RETRY, sealed @ ..] => self
                .open(RETRY, now, scope, sealed, RETRY_LIFETIME)
                .map_or(Validation::Unknown, Validation::Retry),
            [NEW_TOKEN, sealed @ ..] => self
                .open(NEW_TOKEN, now, scope, sealed, NEW_TOKEN_LIFETIME)
                .map_or(Validation::Unknown, |_| Validation::NewToken),
            _ => Validation::Unknown,
        }
    }

    fn open(
        &self,
        kind: u8,
        now: Instant,
        scope: &Scope,
        mut sealed: &[u8],
        lifetime: Duration,
    ) -> Option<ConnectionId> {
        let (nonce, tag) = (sealed.array()?, sealed.array()?);
        let mut buffer = [0; 8 + ConnectionId::MAX_LEN];
        let secret = buffer.get_mut(..sealed.len())?;
        secret.copy_from_slice(sealed);
        if !self.key.open(&nonce, &scope.encode(kind), secret, &tag) {
            return None;
        }
        let (&issued, id) = secret.split_first_chunk()?;
        let issued = Instant::from_micros(u64::from_be_bytes(issued));
        ConnectionId::new(id).filter(|_| (issued..=issued + lifetime).contains(&now))
    }
}
