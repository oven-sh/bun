//! Packet protection (RFC 9001 §5) over primitives that the embedder provides.

use crate::stream_id::Side;
use crate::version::Version;

pub const TAG_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;
pub const SAMPLE_LEN: usize = 16;

/// The cipher suites of TLS 1.3 (RFC 8446 §B.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cipher {
    Aes128GcmSha256,
    Aes256GcmSha384,
    ChaCha20Poly1305Sha256,
}

impl Cipher {
    const fn key_len(self) -> usize {
        match self {
            Self::Aes128GcmSha256 => 16,
            Self::Aes256GcmSha384 | Self::ChaCha20Poly1305Sha256 => 32,
        }
    }
}

pub trait Crypto {
    /// From a cryptographically secure generator.
    fn fill_random(&self, out: &mut [u8]);
    /// HKDF-Extract with SHA-256.
    fn extract(&self, salt: &[u8], key_material: &[u8]) -> [u8; 32];
    /// HKDF-Expand with the hash of `cipher`.
    fn expand(&self, cipher: Cipher, secret: &[u8], info: &[u8], out: &mut [u8]);
    fn packet_key(&self, cipher: Cipher, key: &[u8]) -> Box<dyn PacketKey>;
    fn header_key(&self, cipher: Cipher, key: &[u8]) -> Box<dyn HeaderKey>;
}

/// An AEAD that works in place.
pub trait PacketKey {
    fn seal(&self, nonce: &[u8; NONCE_LEN], header: &[u8], payload: &mut [u8]) -> [u8; TAG_LEN];
    /// `payload` is garbage if this returns false.
    fn open(
        &self,
        nonce: &[u8; NONCE_LEN],
        header: &[u8],
        payload: &mut [u8],
        tag: &[u8; TAG_LEN],
    ) -> bool;
    /// How many packets one key may protect (RFC 9001 §6.6).
    fn confidentiality_limit(&self) -> u64;
    /// How many forged packets a connection may be shown (RFC 9001 §6.6).
    fn integrity_limit(&self) -> u64;
}

pub trait HeaderKey {
    /// RFC 9001 §5.4.3 and §5.4.4.
    fn mask(&self, sample: &[u8; SAMPLE_LEN]) -> [u8; 5];
}

impl dyn Crypto + '_ {
    pub(crate) fn random<const N: usize>(&self) -> [u8; N] {
        let mut bytes = [0; N];
        self.fill_random(&mut bytes);
        bytes
    }

    /// In `0..bound`, or zero if there is no such number.
    pub(crate) fn random_below(&self, bound: u32) -> u32 {
        ((u64::from(u32::from_ne_bytes(self.random())) * u64::from(bound)) >> 32) as u32
    }
}

/// Up to 48 bytes that are wiped after use.
struct Key {
    bytes: [u8; 48],
    len: usize,
}

impl Key {
    fn zeros(len: usize) -> Self {
        Self {
            bytes: [0; 48],
            len,
        }
    }

    fn get(&self) -> &[u8] {
        self.bytes.get(..self.len).unwrap_or(&self.bytes)
    }

    fn get_mut(&mut self) -> &mut [u8] {
        self.bytes.get_mut(..self.len).unwrap_or_default()
    }
}

impl Drop for Key {
    fn drop(&mut self) {
        bun_core::secure_zero(&mut self.bytes);
    }
}

/// What the keys of one direction derive from.
pub(crate) struct Secret {
    crypto: &'static dyn Crypto,
    cipher: Cipher,
    key: Key,
}

impl Secret {
    pub(crate) fn new(crypto: &'static dyn Crypto, cipher: Cipher, secret: &[u8]) -> Self {
        let mut key = Key::zeros(secret.len());
        key.bytes
            .iter_mut()
            .zip(secret)
            .for_each(|(to, from)| *to = *from);
        Self {
            crypto,
            cipher,
            key,
        }
    }

    /// HKDF-Expand-Label with an empty context (RFC 8446 §7.1).
    fn expand(&self, label: &str, out: &mut [u8]) {
        const PREFIX: &[u8] = b"tls13 ";
        let lengths = [0, out.len() as u8, (PREFIX.len() + label.len()) as u8];
        let mut info = [0; 32];
        let parts = lengths.iter().chain(PREFIX).chain(label.as_bytes());
        info.iter_mut()
            .zip(parts)
            .for_each(|(to, from)| *to = *from);
        let info = info.get(..lengths.len() + PREFIX.len() + label.len() + 1);
        (self.crypto).expand(self.cipher, self.key.get(), info.unwrap_or_default(), out);
    }

    fn expand_key(&self, label: &str, len: usize) -> Key {
        let mut key = Key::zeros(len);
        self.expand(label, key.get_mut());
        key
    }

    fn derive(&self, label: &str) -> Self {
        Self {
            key: self.expand_key(label, self.key.len),
            ..*self
        }
    }

    /// RFC 9001 §6.1.
    pub(crate) fn next(&self, version: Version) -> Self {
        self.derive(version.labels().key_update)
    }

    pub(crate) fn payload_key(&self, version: Version) -> PayloadKey {
        let key = self.expand_key(version.labels().key, self.cipher.key_len());
        let mut iv = [0; NONCE_LEN];
        self.expand(version.labels().iv, &mut iv);
        PayloadKey {
            key: self.crypto.packet_key(self.cipher, key.get()),
            iv,
        }
    }

    pub(crate) fn keys(&self, version: Version) -> Keys {
        let key = self.expand_key(version.labels().header_protection, self.cipher.key_len());
        Keys {
            payload: self.payload_key(version),
            header: self.crypto.header_key(self.cipher, key.get()),
        }
    }
}

pub(crate) struct PayloadKey {
    pub(crate) key: Box<dyn PacketKey>,
    iv: [u8; NONCE_LEN],
}

impl PayloadKey {
    #[inline]
    fn nonce(&self, number: u64) -> [u8; NONCE_LEN] {
        let mut nonce = self.iv;
        let low = nonce.iter_mut().rev().zip(number.to_le_bytes());
        low.for_each(|(byte, number)| *byte ^= number);
        nonce
    }

    #[inline]
    pub(crate) fn seal(&self, number: u64, header: &[u8], payload: &mut [u8]) -> [u8; TAG_LEN] {
        self.key.seal(&self.nonce(number), header, payload)
    }

    /// Returns the plaintext, which is `sealed` without the tag.
    #[inline]
    pub(crate) fn open<'a>(
        &self,
        number: u64,
        header: &[u8],
        sealed: &'a mut [u8],
    ) -> Option<&'a [u8]> {
        sealed.split_last_chunk_mut().and_then(|(payload, tag)| {
            (self.key.open(&self.nonce(number), header, payload, tag)).then_some(&*payload)
        })
    }
}

/// For one direction.
pub(crate) struct Keys {
    pub(crate) payload: PayloadKey,
    pub(crate) header: Box<dyn HeaderKey>,
}

/// RFC 9001 §5.2.
pub(crate) struct InitialSecret(Secret, Version);

impl InitialSecret {
    pub(crate) fn new(crypto: &'static dyn Crypto, version: Version, destination: &[u8]) -> Self {
        let secret = crypto.extract(version.initial_salt(), destination);
        Self(
            Secret::new(crypto, Cipher::Aes128GcmSha256, &secret),
            version,
        )
    }

    /// For the packets that `sender` sends.
    pub(crate) fn keys(&self, sender: Side) -> Keys {
        let label = match sender {
            Side::Client => "client in",
            Side::Server => "server in",
        };
        self.0.derive(label).keys(self.1)
    }
}

/// RFC 9001 §5.8. `packet` ends before the tag.
pub(crate) fn retry_tag(
    crypto: &dyn Crypto,
    version: Version,
    original_destination: &[u8],
    packet: &[u8],
) -> [u8; TAG_LEN] {
    let len = [original_destination.len() as u8];
    let pseudo_packet = [&len, original_destination, packet].concat();
    (crypto.packet_key(Cipher::Aes128GcmSha256, version.retry_key())).seal(
        version.retry_nonce(),
        &pseudo_packet,
        &mut [],
    )
}
