use std::cell::Cell;

use bun_quic::crypto::{Cipher, Crypto, HeaderKey, NONCE_LEN, PacketKey, SAMPLE_LEN, TAG_LEN};

pub(crate) struct Random(Cell<u64>);

impl Random {
    pub(crate) fn new(seed: u64) -> Self {
        Self(Cell::new(seed))
    }

    pub(crate) fn next(&self) -> u64 {
        self.0.set(self.0.get().wrapping_add(0x9e37_79b9_7f4a_7c15));
        mix(self.0.get())
    }

    pub(crate) fn below(&self, bound: u64) -> u64 {
        self.next() % bound
    }
}

fn mix(mut z: u64) -> u64 {
    z = (z ^ z >> 30).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ z >> 27).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ z >> 31
}

fn digest(parts: &[&[u8]]) -> u64 {
    parts.iter().fold(0, |state, part| {
        let (words, rest) = part.as_chunks();
        let state = (words.iter()).fold(state, |state, &it| mix(state ^ u64::from_le_bytes(it)));
        let state = rest
            .iter()
            .fold(state, |state, &it| mix(state ^ u64::from(it)));
        mix(state ^ part.len() as u64)
    })
}

fn stream(seed: u64) -> impl Iterator<Item = u8> {
    (1..).flat_map(move |at| mix(seed.wrapping_add(at)).to_le_bytes())
}

/// Depends on all of its inputs like the real thing, and is no more than that.
pub(crate) struct Toy(pub(crate) Random);

impl Crypto for Toy {
    fn fill_random(&self, out: &mut [u8]) {
        out.iter_mut().for_each(|it| *it = self.0.next() as u8);
    }

    fn extract(&self, salt: &[u8], key_material: &[u8]) -> [u8; 32] {
        let mut bytes = stream(digest(&[salt, key_material]));
        std::array::from_fn(|_| bytes.next().unwrap())
    }

    fn expand(&self, cipher: Cipher, secret: &[u8], info: &[u8], out: &mut [u8]) {
        let bytes = stream(digest(&[&[cipher as u8], secret, info]));
        out.iter_mut().zip(bytes).for_each(|(to, from)| *to = from);
    }

    fn packet_key(&self, _: Cipher, key: &[u8]) -> Box<dyn PacketKey> {
        Box::new(Key(key.to_vec()))
    }

    fn header_key(&self, _: Cipher, key: &[u8]) -> Box<dyn HeaderKey> {
        Box::new(Key(key.to_vec()))
    }
}

struct Key(Vec<u8>);

impl Key {
    fn tag(&self, nonce: &[u8], header: &[u8], payload: &[u8]) -> [u8; TAG_LEN] {
        let mut bytes = stream(digest(&[&self.0, nonce, header, payload]));
        std::array::from_fn(|_| bytes.next().unwrap())
    }

    fn scramble(&self, nonce: &[u8], payload: &mut [u8]) {
        let mask = digest(&[&self.0, nonce]) as u8 | 1;
        payload.iter_mut().for_each(|it| *it ^= mask);
    }
}

impl PacketKey for Key {
    fn seal(&self, nonce: &[u8; NONCE_LEN], header: &[u8], payload: &mut [u8]) -> [u8; TAG_LEN] {
        self.scramble(nonce, payload);
        self.tag(nonce, header, payload)
    }

    fn open(
        &self,
        nonce: &[u8; NONCE_LEN],
        header: &[u8],
        payload: &mut [u8],
        tag: &[u8; TAG_LEN],
    ) -> bool {
        let is_authentic = self.tag(nonce, header, payload) == *tag;
        self.scramble(nonce, payload);
        is_authentic
    }
}

impl HeaderKey for Key {
    fn mask(&self, sample: &[u8; SAMPLE_LEN]) -> [u8; 5] {
        let [a, b, c, d, e, ..] = digest(&[&self.0, sample]).to_le_bytes();
        [a, b, c, d, e]
    }
}
