// SHA-256 per FIPS 180-4. Direct port of self-sign.c — no external dependencies.

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
    0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
    0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
    0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
];

struct Ctx {
    state: [u32; 8],
    bitlen: u64,
    buf: [u8; 64],
    buflen: usize,
}

impl Ctx {
    fn new() -> Self {
        Ctx {
            state: [
                0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
                0x1f83d9ab, 0x5be0cd19,
            ],
            bitlen: 0,
            buf: [0u8; 64],
            buflen: 0,
        }
    }

    fn block(&mut self) {
        let p = &self.buf;
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([p[i * 4], p[i * 4 + 1], p[i * 4 + 2], p[i * 4 + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut a = self.state[0];
        let mut b = self.state[1];
        let mut c = self.state[2];
        let mut d = self.state[3];
        let mut e = self.state[4];
        let mut f = self.state[5];
        let mut g = self.state[6];
        let mut h = self.state[7];
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = h.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            h = g; g = f; f = e; e = d.wrapping_add(t1);
            d = c; c = b; b = a; a = t1.wrapping_add(t2);
        }
        self.state[0] = self.state[0].wrapping_add(a);
        self.state[1] = self.state[1].wrapping_add(b);
        self.state[2] = self.state[2].wrapping_add(c);
        self.state[3] = self.state[3].wrapping_add(d);
        self.state[4] = self.state[4].wrapping_add(e);
        self.state[5] = self.state[5].wrapping_add(f);
        self.state[6] = self.state[6].wrapping_add(g);
        self.state[7] = self.state[7].wrapping_add(h);
    }

    fn update(&mut self, data: &[u8]) {
        self.bitlen = self.bitlen.wrapping_add(data.len() as u64 * 8);
        for &byte in data {
            self.buf[self.buflen] = byte;
            self.buflen += 1;
            if self.buflen == 64 {
                self.block();
                self.buflen = 0;
            }
        }
    }

    fn finalize(mut self) -> [u8; 32] {
        let bits = self.bitlen;
        let mut i = self.buflen;
        self.buf[i] = 0x80;
        i += 1;
        if i > 56 {
            while i < 64 {
                self.buf[i] = 0;
                i += 1;
            }
            self.block();
            i = 0;
        }
        while i < 56 {
            self.buf[i] = 0;
            i += 1;
        }
        // write bit length big-endian at bytes 56-63
        for j in 0..8usize {
            self.buf[56 + j] = (bits >> (56 - 8 * j)) as u8;
        }
        self.block();
        let mut out = [0u8; 32];
        for (k, &s) in self.state.iter().enumerate() {
            out[k * 4..k * 4 + 4].copy_from_slice(&s.to_be_bytes());
        }
        out
    }
}

pub fn hash(data: &[u8]) -> [u8; 32] {
    let mut ctx = Ctx::new();
    ctx.update(data);
    ctx.finalize()
}
