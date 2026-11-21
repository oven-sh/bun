//! RFC 9001 §5 and RFC 9369 §3.3.

use bun_quic::Side;
use bun_quic::crypto::{Cipher, Crypto, HeaderKey, PacketKey};

use super::wire::hex;

pub(crate) const DRAFT_29: u32 = 0xff00_001d;
pub(crate) const V1: u32 = 1;
pub(crate) const V2: u32 = 0x6b33_43cf;

/// The salt for Initial packets, and the key and the nonce for Retry packets.
fn constants(version: u32) -> [Vec<u8>; 3] {
    match version {
        DRAFT_29 => [
            "afbfec289993d24c9e9786f19c6111e04390a899",
            "ccce187ed09a09d05728155a6cb96be1",
            "e54930f97f2136f0530a8c1c",
        ],
        V2 => [
            "0dede3def700a6db819381be6e269dcbf9bd2ed9",
            "8fb4b01b56ac48e260fbcbcead7ccc92",
            "d86969bc2d7c6d9990efb04a",
        ],
        _ => [
            "38762cf7f55934b34d179ae6a4c80cadccbb7f0a",
            "be0c690b9f66575a1d766b54e368c84e",
            "461599d35d632bf2239825bb",
        ],
    }
    .map(hex)
}

#[derive(Clone)]
pub(crate) struct Secret {
    pub(crate) crypto: &'static dyn Crypto,
    pub(crate) version: u32,
    pub(crate) cipher: Cipher,
    pub(crate) bytes: Vec<u8>,
}

impl Secret {
    pub(crate) fn initial(
        crypto: &'static dyn Crypto,
        version: u32,
        destination: &[u8],
        sender: Side,
    ) -> Self {
        let mut secret = Self {
            crypto,
            version,
            cipher: Cipher::Aes128GcmSha256,
            bytes: crypto.extract(&constants(version)[0], destination).into(),
        };
        let label = ["client in", "server in"][sender as usize];
        secret.bytes = secret.expand(label, 32);
        secret
    }

    fn expand(&self, label: &str, len: usize) -> Vec<u8> {
        let lengths = [0, len as u8, 6 + label.len() as u8];
        let info = [&lengths, &b"tls13 "[..], label.as_bytes(), &[0]].concat();
        let mut out = vec![0; len];
        (self.crypto).expand(self.cipher, &self.bytes, &info, &mut out);
        out
    }

    fn expand_for(&self, purpose: &str, len: usize) -> Vec<u8> {
        let prefix = if self.version == V2 { "quicv2" } else { "quic" };
        self.expand(&format!("{prefix} {purpose}"), len)
    }

    pub(crate) fn next(&self) -> Self {
        let bytes = self.expand_for("ku", self.bytes.len());
        Self { bytes, ..*self }
    }

    fn key_len(&self) -> usize {
        match self.cipher {
            Cipher::Aes128GcmSha256 => 16,
            _ => 32,
        }
    }

    pub(crate) fn header_key(&self) -> Box<dyn HeaderKey> {
        (self.crypto).header_key(self.cipher, &self.expand_for("hp", self.key_len()))
    }

    /// With the nonce for a packet.
    pub(crate) fn packet_key(&self, number: u64) -> (Box<dyn PacketKey>, [u8; 12]) {
        let mut nonce: [u8; 12] = self.expand_for("iv", 12).try_into().unwrap();
        (nonce[4..].iter_mut().zip(number.to_be_bytes())).for_each(|(to, from)| *to ^= from);
        let key = self.expand_for("key", self.key_len());
        (self.crypto.packet_key(self.cipher, &key), nonce)
    }
}

pub(crate) fn retry_tag(
    crypto: &dyn Crypto,
    version: u32,
    original: &[u8],
    packet: &[u8],
) -> [u8; 16] {
    let [_, key, nonce] = constants(version);
    let pseudo_packet = [&[original.len() as u8], original, packet].concat();
    let key = crypto.packet_key(Cipher::Aes128GcmSha256, &key);
    key.seal(&nonce.try_into().unwrap(), &pseudo_packet, &mut [])
}
