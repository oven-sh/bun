//
// this file is a copy of Wyhash from the zig standard library, version v0.11.0-dev.2609+5e19250a1
//

const PRIMES: [u64; 5] = [
    0xa0761d6478bd642f,
    0xe7037ed1a0b428db,
    0x8ebc6af09c88c6e3,
    0x589965cc75374cc3,
    0x1d8e4e27c47d124f,
];

#[inline]
fn read_bytes<const BYTES: u8>(data: &[u8]) -> u64 {
    // Zig: const T = std.meta.Int(.unsigned, 8 * bytes); mem.readInt(T, data[0..bytes], .little)
    // Rust cannot mint an integer type from a const generic; dispatch on the only values used.
    match BYTES {
        1 => u64::from(data[0]),
        2 => u64::from(u16::from_le_bytes([data[0], data[1]])),
        4 => u64::from(u32::from_le_bytes([data[0], data[1], data[2], data[3]])),
        8 => u64::from_le_bytes([
            data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7],
        ]),
        _ => unreachable!(),
    }
}

#[inline]
fn read_8bytes_swapped(data: &[u8]) -> u64 {
    (read_bytes::<4>(data) << 32) | read_bytes::<4>(&data[4..])
}

#[inline]
fn mum(a: u64, b: u64) -> u64 {
    let mut r = (a as u128) * (b as u128);
    r = (r >> 64) ^ r;
    r as u64
}

#[inline]
fn mix0(a: u64, b: u64, seed: u64) -> u64 {
    mum(a ^ seed ^ PRIMES[0], b ^ seed ^ PRIMES[1])
}

#[inline]
fn mix1(a: u64, b: u64, seed: u64) -> u64 {
    mum(a ^ seed ^ PRIMES[2], b ^ seed ^ PRIMES[3])
}

// Wyhash version which does not store internal state for handling partial buffers.
// This is needed so that we can maximize the speed for the short key case, which will
// use the non-iterative api which the public Wyhash exposes.
struct WyhashStateless {
    seed: u64,
    msg_len: usize,
}

impl WyhashStateless {
    pub fn init(seed: u64) -> WyhashStateless {
        WyhashStateless {
            seed,
            msg_len: 0,
        }
    }

    #[inline]
    fn round(&mut self, b: &[u8]) {
        debug_assert!(b.len() == 32);

        self.seed = mix0(
            read_bytes::<8>(&b[0..]),
            read_bytes::<8>(&b[8..]),
            self.seed,
        ) ^ mix1(
            read_bytes::<8>(&b[16..]),
            read_bytes::<8>(&b[24..]),
            self.seed,
        );
    }

    #[inline]
    pub fn update(&mut self, b: &[u8]) {
        debug_assert!(b.len() % 32 == 0);

        let mut off: usize = 0;
        while off < b.len() {
            self.round(&b[off..off + 32]);
            // @call(bun.callmod_inline, self.round, .{b[off .. off + 32]});
            off += 32;
        }

        self.msg_len += b.len();
    }

    #[inline]
    pub fn final_(&mut self, b: &[u8]) -> u64 {
        debug_assert!(b.len() < 32);

        let seed = self.seed;
        // Zig: @as(u5, @intCast(b.len)) — Rust has no u5; b.len() < 32 is asserted above.
        let rem_len = b.len();
        let rem_key = &b[0..rem_len];

        self.seed = match rem_len {
            0 => seed,
            1 => mix0(read_bytes::<1>(rem_key), PRIMES[4], seed),
            2 => mix0(read_bytes::<2>(rem_key), PRIMES[4], seed),
            3 => mix0((read_bytes::<2>(rem_key) << 8) | read_bytes::<1>(&rem_key[2..]), PRIMES[4], seed),
            4 => mix0(read_bytes::<4>(rem_key), PRIMES[4], seed),
            5 => mix0((read_bytes::<4>(rem_key) << 8) | read_bytes::<1>(&rem_key[4..]), PRIMES[4], seed),
            6 => mix0((read_bytes::<4>(rem_key) << 16) | read_bytes::<2>(&rem_key[4..]), PRIMES[4], seed),
            7 => mix0((read_bytes::<4>(rem_key) << 24) | (read_bytes::<2>(&rem_key[4..]) << 8) | read_bytes::<1>(&rem_key[6..]), PRIMES[4], seed),
            8 => mix0(read_8bytes_swapped(rem_key), PRIMES[4], seed),
            9 => mix0(read_8bytes_swapped(rem_key), read_bytes::<1>(&rem_key[8..]), seed),
            10 => mix0(read_8bytes_swapped(rem_key), read_bytes::<2>(&rem_key[8..]), seed),
            11 => mix0(read_8bytes_swapped(rem_key), (read_bytes::<2>(&rem_key[8..]) << 8) | read_bytes::<1>(&rem_key[10..]), seed),
            12 => mix0(read_8bytes_swapped(rem_key), read_bytes::<4>(&rem_key[8..]), seed),
            13 => mix0(read_8bytes_swapped(rem_key), (read_bytes::<4>(&rem_key[8..]) << 8) | read_bytes::<1>(&rem_key[12..]), seed),
            14 => mix0(read_8bytes_swapped(rem_key), (read_bytes::<4>(&rem_key[8..]) << 16) | read_bytes::<2>(&rem_key[12..]), seed),
            15 => mix0(read_8bytes_swapped(rem_key), (read_bytes::<4>(&rem_key[8..]) << 24) | (read_bytes::<2>(&rem_key[12..]) << 8) | read_bytes::<1>(&rem_key[14..]), seed),
            16 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed),
            17 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1(read_bytes::<1>(&rem_key[16..]), PRIMES[4], seed),
            18 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1(read_bytes::<2>(&rem_key[16..]), PRIMES[4], seed),
            19 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1((read_bytes::<2>(&rem_key[16..]) << 8) | read_bytes::<1>(&rem_key[18..]), PRIMES[4], seed),
            20 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1(read_bytes::<4>(&rem_key[16..]), PRIMES[4], seed),
            21 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1((read_bytes::<4>(&rem_key[16..]) << 8) | read_bytes::<1>(&rem_key[20..]), PRIMES[4], seed),
            22 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1((read_bytes::<4>(&rem_key[16..]) << 16) | read_bytes::<2>(&rem_key[20..]), PRIMES[4], seed),
            23 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1((read_bytes::<4>(&rem_key[16..]) << 24) | (read_bytes::<2>(&rem_key[20..]) << 8) | read_bytes::<1>(&rem_key[22..]), PRIMES[4], seed),
            24 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(&rem_key[16..]), PRIMES[4], seed),
            25 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(&rem_key[16..]), read_bytes::<1>(&rem_key[24..]), seed),
            26 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(&rem_key[16..]), read_bytes::<2>(&rem_key[24..]), seed),
            27 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(&rem_key[16..]), (read_bytes::<2>(&rem_key[24..]) << 8) | read_bytes::<1>(&rem_key[26..]), seed),
            28 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(&rem_key[16..]), read_bytes::<4>(&rem_key[24..]), seed),
            29 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(&rem_key[16..]), (read_bytes::<4>(&rem_key[24..]) << 8) | read_bytes::<1>(&rem_key[28..]), seed),
            30 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(&rem_key[16..]), (read_bytes::<4>(&rem_key[24..]) << 16) | read_bytes::<2>(&rem_key[28..]), seed),
            31 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(&rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(&rem_key[16..]), (read_bytes::<4>(&rem_key[24..]) << 24) | (read_bytes::<2>(&rem_key[28..]) << 8) | read_bytes::<1>(&rem_key[30..]), seed),
            _ => unreachable!(),
        };

        self.msg_len += b.len();
        mum(self.seed ^ (self.msg_len as u64), PRIMES[4])
    }

    pub fn hash(seed: u64, input: &[u8]) -> u64 {
        let aligned_len = input.len() - (input.len() % 32);

        let mut c = WyhashStateless::init(seed);
        c.update(&input[0..aligned_len]);
        // @call(bun.callmod_inline, c.update, .{input[0..aligned_len]});
        c.final_(&input[aligned_len..])
        // return @call(bun.callmod_inline, c.final, .{input[aligned_len..]});
    }
}

/// Fast non-cryptographic 64bit hash function.
/// See https://github.com/wangyi-fudan/wyhash
pub struct Wyhash11 {
    state: WyhashStateless,

    buf: [u8; 32],
    buf_len: usize,
}

impl Wyhash11 {
    pub fn init(seed: u64) -> Wyhash11 {
        Wyhash11 {
            state: WyhashStateless::init(seed),
            buf: [0; 32], // Zig: undefined
            buf_len: 0,
        }
    }

    pub fn update(&mut self, b: &[u8]) {
        let mut off: usize = 0;

        if self.buf_len != 0 && self.buf_len + b.len() >= 32 {
            off += 32 - self.buf_len;
            self.buf[self.buf_len..self.buf_len + off].copy_from_slice(&b[0..off]);
            self.state.update(&self.buf[0..]);
            self.buf_len = 0;
        }

        let remain_len = b.len() - off;
        let aligned_len = remain_len - (remain_len % 32);
        self.state.update(&b[off..off + aligned_len]);

        let tail = &b[off + aligned_len..];
        self.buf[self.buf_len..self.buf_len + tail.len()].copy_from_slice(tail);
        self.buf_len += usize::from(u8::try_from(tail.len()).unwrap());
    }

    pub fn final_(&mut self) -> u64 {
        let rem_key = &self.buf[0..self.buf_len];

        self.state.final_(rem_key)
    }

    pub fn hash(seed: u64, input: &[u8]) -> u64 {
        WyhashStateless::hash(seed, input)
    }
}

/// `bun.hash(bytes)` — std `Wyhash` with seed 0. PORTING.md: this is **not**
/// `Wyhash11` (different algorithm).
// TODO(b2): currently routes to Wyhash11 since std Wyhash isn't ported. Swap
// once `std.hash.Wyhash` lands here (or use `wyhash` crate for parity).
#[inline]
pub fn hash(bytes: &[u8]) -> u64 {
    Wyhash11::hash(0, bytes)
}

#[inline]
pub fn hash32(bytes: &[u8]) -> u32 {
    hash(bytes) as u32 // @truncate
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/wyhash/wyhash.zig (180 lines)
//   confidence: high
//   todos:      0
//   notes:      `final` renamed `final_` (Rust keyword); read_bytes uses const-generic match (only 1/2/4/8 used)
// ──────────────────────────────────────────────────────────────────────────
