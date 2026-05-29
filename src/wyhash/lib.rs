//
// `Wyhash11` is a copy of Wyhash from the zig standard library, version v0.11.0-dev.2609+5e19250a1
// (the older 32-byte-round, 5-prime variant kept in src/wyhash/wyhash.zig).
//
// `Wyhash` is the current `std.hash.Wyhash` (final4 variant, 48-byte rounds, 4 secrets) ported
// from vendor/zig/lib/std/hash/wyhash.zig — used by RuntimeTranspilerCache, `bun.hash()`, router.
//
// THESE ARE DIFFERENT ALGORITHMS. They produce different outputs for the same input.
//

// ════════════════════════════════════════════════════════════════════════════
// Wyhash11 (legacy, 32-byte rounds, 5 primes)
// ════════════════════════════════════════════════════════════════════════════

#![feature(hasher_prefixfree_extras)]
const PRIMES: [u64; 5] = [
    0xa0761d6478bd642f,
    0xe7037ed1a0b428db,
    0x8ebc6af09c88c6e3,
    0x589965cc75374cc3,
    0x1d8e4e27c47d124f,
];

#[inline(always)]
fn read_bytes<const BYTES: u8>(data: &[u8]) -> u64 {
    debug_assert!(data.len() >= usize::from(BYTES));
    // Zig: const T = std.meta.Int(.unsigned, 8 * bytes); mem.readInt(T, data[0..bytes], .little)
    // Rust cannot mint an integer type from a const generic; dispatch on the only values used.
    match BYTES {
        1 => u64::from(data[0]),
        2 => u64::from(u16::from_le_bytes([data[0], data[1]])),
        // SAFETY: `data.len() >= BYTES == 4` (asserted above; every caller
        // proves it). `read_unaligned` imposes no alignment requirement.
        4 => u64::from(u32::from_le(unsafe {
            core::ptr::read_unaligned(data.as_ptr().cast::<u32>())
        })),
        // SAFETY: `data.len() >= BYTES == 8` (asserted above; every caller
        // proves it). `read_unaligned` imposes no alignment requirement.
        8 => u64::from_le(unsafe { core::ptr::read_unaligned(data.as_ptr().cast::<u64>()) }),
        _ => unreachable!(),
    }
}

#[inline(always)]
fn read_8bytes_swapped(data: &[u8]) -> u64 {
    (read_bytes::<4>(data) << 32) | read_bytes::<4>(&data[4..])
}

#[inline(always)]
fn mum(a: u64, b: u64) -> u64 {
    let mut r = (a as u128) * (b as u128);
    r = (r >> 64) ^ r;
    r as u64
}

#[inline(always)]
fn mix0(a: u64, b: u64, seed: u64) -> u64 {
    mum(a ^ seed ^ PRIMES[0], b ^ seed ^ PRIMES[1])
}

#[inline(always)]
fn mix1(a: u64, b: u64, seed: u64) -> u64 {
    mum(a ^ seed ^ PRIMES[2], b ^ seed ^ PRIMES[3])
}

#[cold]
#[inline(never)]
fn final_long(seed: u64, key: &[u8]) -> u64 {
    debug_assert!((17..32).contains(&key.len()));

    let head = mix0(
        read_8bytes_swapped(key),
        read_8bytes_swapped(&key[8..]),
        seed,
    );
    let tail = match key.len() {
        17 => mix1(read_bytes::<1>(&key[16..]), PRIMES[4], seed),
        18 => mix1(read_bytes::<2>(&key[16..]), PRIMES[4], seed),
        19 => mix1(
            (read_bytes::<2>(&key[16..]) << 8) | read_bytes::<1>(&key[18..]),
            PRIMES[4],
            seed,
        ),
        20 => mix1(read_bytes::<4>(&key[16..]), PRIMES[4], seed),
        21 => mix1(
            (read_bytes::<4>(&key[16..]) << 8) | read_bytes::<1>(&key[20..]),
            PRIMES[4],
            seed,
        ),
        22 => mix1(
            (read_bytes::<4>(&key[16..]) << 16) | read_bytes::<2>(&key[20..]),
            PRIMES[4],
            seed,
        ),
        23 => mix1(
            (read_bytes::<4>(&key[16..]) << 24)
                | (read_bytes::<2>(&key[20..]) << 8)
                | read_bytes::<1>(&key[22..]),
            PRIMES[4],
            seed,
        ),
        24 => mix1(read_8bytes_swapped(&key[16..]), PRIMES[4], seed),
        25 => mix1(
            read_8bytes_swapped(&key[16..]),
            read_bytes::<1>(&key[24..]),
            seed,
        ),
        26 => mix1(
            read_8bytes_swapped(&key[16..]),
            read_bytes::<2>(&key[24..]),
            seed,
        ),
        27 => mix1(
            read_8bytes_swapped(&key[16..]),
            (read_bytes::<2>(&key[24..]) << 8) | read_bytes::<1>(&key[26..]),
            seed,
        ),
        28 => mix1(
            read_8bytes_swapped(&key[16..]),
            read_bytes::<4>(&key[24..]),
            seed,
        ),
        29 => mix1(
            read_8bytes_swapped(&key[16..]),
            (read_bytes::<4>(&key[24..]) << 8) | read_bytes::<1>(&key[28..]),
            seed,
        ),
        30 => mix1(
            read_8bytes_swapped(&key[16..]),
            (read_bytes::<4>(&key[24..]) << 16) | read_bytes::<2>(&key[28..]),
            seed,
        ),
        31 => mix1(
            read_8bytes_swapped(&key[16..]),
            (read_bytes::<4>(&key[24..]) << 24)
                | (read_bytes::<2>(&key[28..]) << 8)
                | read_bytes::<1>(&key[30..]),
            seed,
        ),
        _ => unreachable!(),
    };
    head ^ tail
}

// Wyhash version which does not store internal state for handling partial buffers.
// This is needed so that we can maximize the speed for the short key case, which will
// use the non-iterative api which the public Wyhash exposes.
#[derive(Clone, Copy)]
struct WyhashStateless {
    seed: u64,
    msg_len: usize,
}

impl WyhashStateless {
    #[inline(always)]
    pub(crate) fn init(seed: u64) -> WyhashStateless {
        WyhashStateless { seed, msg_len: 0 }
    }

    #[inline(always)] // Zig: `@call(bun.callmod_inline, self.round, ...)`
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

    #[inline(always)] // Zig: `@call(bun.callmod_inline, c.update, ...)`
    pub(crate) fn update(&mut self, b: &[u8]) {
        debug_assert!(b.len().is_multiple_of(32));

        let mut off: usize = 0;
        while off < b.len() {
            self.round(&b[off..off + 32]);
            // @call(bun.callmod_inline, self.round, .{b[off .. off + 32]});
            off += 32;
        }

        self.msg_len += b.len();
    }

    #[inline(always)]
    pub(crate) fn final_(&mut self, b: &[u8]) -> u64 {
        debug_assert!(b.len() < 32);

        let seed = self.seed;
        // Zig: @as(u5, @intCast(b.len)) — Rust has no u5; b.len() < 32 is asserted above.
        let rem_len = b.len();
        let rem_key = &b[0..rem_len];

        self.seed = match rem_len {
            0 => seed,
            1 => mix0(read_bytes::<1>(rem_key), PRIMES[4], seed),
            2 => mix0(read_bytes::<2>(rem_key), PRIMES[4], seed),
            3 => mix0(
                (read_bytes::<2>(rem_key) << 8) | read_bytes::<1>(&rem_key[2..]),
                PRIMES[4],
                seed,
            ),
            4 => mix0(read_bytes::<4>(rem_key), PRIMES[4], seed),
            5 => mix0(
                (read_bytes::<4>(rem_key) << 8) | read_bytes::<1>(&rem_key[4..]),
                PRIMES[4],
                seed,
            ),
            6 => mix0(
                (read_bytes::<4>(rem_key) << 16) | read_bytes::<2>(&rem_key[4..]),
                PRIMES[4],
                seed,
            ),
            7 => mix0(
                (read_bytes::<4>(rem_key) << 24)
                    | (read_bytes::<2>(&rem_key[4..]) << 8)
                    | read_bytes::<1>(&rem_key[6..]),
                PRIMES[4],
                seed,
            ),
            8 => mix0(read_8bytes_swapped(rem_key), PRIMES[4], seed),
            9 => mix0(
                read_8bytes_swapped(rem_key),
                read_bytes::<1>(&rem_key[8..]),
                seed,
            ),
            10 => mix0(
                read_8bytes_swapped(rem_key),
                read_bytes::<2>(&rem_key[8..]),
                seed,
            ),
            11 => mix0(
                read_8bytes_swapped(rem_key),
                (read_bytes::<2>(&rem_key[8..]) << 8) | read_bytes::<1>(&rem_key[10..]),
                seed,
            ),
            12 => mix0(
                read_8bytes_swapped(rem_key),
                read_bytes::<4>(&rem_key[8..]),
                seed,
            ),
            13 => mix0(
                read_8bytes_swapped(rem_key),
                (read_bytes::<4>(&rem_key[8..]) << 8) | read_bytes::<1>(&rem_key[12..]),
                seed,
            ),
            14 => mix0(
                read_8bytes_swapped(rem_key),
                (read_bytes::<4>(&rem_key[8..]) << 16) | read_bytes::<2>(&rem_key[12..]),
                seed,
            ),
            15 => mix0(
                read_8bytes_swapped(rem_key),
                (read_bytes::<4>(&rem_key[8..]) << 24)
                    | (read_bytes::<2>(&rem_key[12..]) << 8)
                    | read_bytes::<1>(&rem_key[14..]),
                seed,
            ),
            16 => mix0(
                read_8bytes_swapped(rem_key),
                read_8bytes_swapped(&rem_key[8..]),
                seed,
            ),
            // Keys ≥17B are rare among identifier/path keys; keep this tail out
            // of line so the `0..=16` arms above inline into every caller.
            _ => final_long(seed, rem_key),
        };

        self.msg_len += b.len();
        mum(self.seed ^ (self.msg_len as u64), PRIMES[4])
    }

    #[inline(always)]
    pub(crate) fn hash(seed: u64, input: &[u8]) -> u64 {
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
    #[inline]
    pub fn init(seed: u64) -> Wyhash11 {
        Wyhash11 {
            state: WyhashStateless::init(seed),
            buf: [0; 32], // Zig: undefined
            buf_len: 0,
        }
    }

    #[inline]
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
        self.buf_len += usize::from(u8::try_from(tail.len()).expect("int cast"));
    }

    // Force-inline so no out-of-line copy of `WyhashStateless::final_`'s
    // length-switch survives on the `Hasher`-driven streaming path.
    #[inline(always)]
    pub fn final_(&mut self) -> u64 {
        let rem_key = &self.buf[0..self.buf_len];

        self.state.final_(rem_key)
    }

    #[inline(always)]
    pub fn hash(seed: u64, input: &[u8]) -> u64 {
        WyhashStateless::hash(seed, input)
    }
}

// Allow `Wyhash11` to be used with `core::hash::Hash::hash` (e.g., as the
// state for std/HashMap-style hashing). Mirrors how Zig's `std.hash_map`
// AutoContext drives a Wyhash state.
impl core::hash::Hasher for Wyhash11 {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        self.update(bytes);
    }
    #[inline]
    fn finish(&self) -> u64 {
        // `final_` mutates `state`; clone so `Hasher::finish(&self)` stays
        // semantically pure (matches std contract).
        let mut s = self.state;
        s.final_(&self.buf[0..self.buf_len])
    }
}

#[derive(Clone, Copy)]
pub struct Wyhash {
    a: u64,
    b: u64,
    state: [u64; 3],
    total_len: usize,

    buf: [u8; 48],
    buf_len: usize,
}

impl Wyhash {
    const SECRET: [u64; 4] = [
        0xa0761d6478bd642f,
        0xe7037ed1a0b428db,
        0x8ebc6af09c88c6e3,
        0x589965cc75374cc3,
    ];

    #[inline]
    pub fn init(seed: u64) -> Wyhash {
        let s0 = seed ^ Self::mix(seed ^ Self::SECRET[0], Self::SECRET[1]);
        Wyhash {
            a: 0, // Zig: undefined
            b: 0, // Zig: undefined
            state: [s0, s0, s0],
            total_len: 0,
            buf: [0; 48], // Zig: undefined
            buf_len: 0,
        }
    }

    // This is subtly different from other hash function update calls. Wyhash requires the last
    // full 48-byte block to be run through final1 if is exactly aligned to 48-bytes.
    #[inline]
    pub fn update(&mut self, input: &[u8]) {
        self.total_len += input.len();

        if input.len() <= 48 - self.buf_len {
            self.buf[self.buf_len..self.buf_len + input.len()].copy_from_slice(input);
            self.buf_len += input.len();
            return;
        }

        let mut i: usize = 0;

        if self.buf_len > 0 {
            i = 48 - self.buf_len;
            self.buf[self.buf_len..48].copy_from_slice(&input[0..i]);
            let buf = self.buf;
            self.round(&buf);
            self.buf_len = 0;
        }

        while i + 48 < input.len() {
            self.round(
                input[i..i + 48]
                    .try_into()
                    .expect("infallible: size matches"),
            );
            i += 48;
        }

        let remaining_bytes = &input[i..];
        if remaining_bytes.len() < 16 && i >= 48 {
            let rem = 16 - remaining_bytes.len();
            // self.buf[self.buf.len - rem ..] = input[i - rem .. i]
            self.buf[48 - rem..48].copy_from_slice(&input[i - rem..i]);
        }
        self.buf[0..remaining_bytes.len()].copy_from_slice(remaining_bytes);
        self.buf_len = remaining_bytes.len();
    }

    #[inline(always)]
    pub fn final_(&self) -> u64 {
        let input: &[u8] = &self.buf[0..self.buf_len];
        let mut new_self = self.shallow_copy(); // ensure idempotency

        if self.total_len <= 16 {
            new_self.small_key(input);
        } else {
            let mut scratch: [u8; 16] = [0; 16];
            let (input, offset) = if self.buf_len < 16 {
                let rem = 16 - self.buf_len;
                scratch[0..rem].copy_from_slice(&self.buf[48 - rem..48]);
                scratch[rem..rem + self.buf_len].copy_from_slice(&self.buf[0..self.buf_len]);
                // Same as input but with additional bytes preceding start in case of a short buffer
                (&scratch[..], rem)
            } else {
                (input, 0usize)
            };

            new_self.final0();
            new_self.final1(input, offset);
        }

        new_self.final2()
    }

    // Copies the core wyhash state but not any internal buffers.
    #[inline]
    fn shallow_copy(&self) -> Wyhash {
        Wyhash {
            a: self.a,
            b: self.b,
            state: self.state,
            total_len: self.total_len,
            buf: [0; 48], // Zig: undefined
            buf_len: 0,   // Zig: undefined
        }
    }

    #[inline(always)] // Zig: `inline fn smallKey`
    fn small_key(&mut self, input: &[u8]) {
        debug_assert!(input.len() <= 16);

        if input.len() >= 4 {
            let end = input.len() - 4;
            let quarter = (input.len() >> 3) << 2;
            self.a = (Self::read4(&input[0..]) << 32) | Self::read4(&input[quarter..]);
            self.b = (Self::read4(&input[end..]) << 32) | Self::read4(&input[end - quarter..]);
        } else if !input.is_empty() {
            self.a = (u64::from(input[0]) << 16)
                | (u64::from(input[input.len() >> 1]) << 8)
                | u64::from(input[input.len() - 1]);
            self.b = 0;
        } else {
            self.a = 0;
            self.b = 0;
        }
    }

    #[inline]
    fn round(&mut self, input: &[u8; 48]) {
        // Zig: inline for (0..3) |i| — manually unrolled.
        let a0 = Self::read8(&input[0..]);
        let b0 = Self::read8(&input[8..]);
        self.state[0] = Self::mix(a0 ^ Self::SECRET[1], b0 ^ self.state[0]);

        let a1 = Self::read8(&input[16..]);
        let b1 = Self::read8(&input[24..]);
        self.state[1] = Self::mix(a1 ^ Self::SECRET[2], b1 ^ self.state[1]);

        let a2 = Self::read8(&input[32..]);
        let b2 = Self::read8(&input[40..]);
        self.state[2] = Self::mix(a2 ^ Self::SECRET[3], b2 ^ self.state[2]);
    }

    #[inline(always)]
    fn read4(data: &[u8]) -> u64 {
        debug_assert!(data.len() >= 4);
        // SAFETY: every caller passes a slice with ≥4 bytes (see comment above);
        // `read_unaligned` imposes no alignment requirement.
        u64::from(u32::from_le(unsafe {
            core::ptr::read_unaligned(data.as_ptr().cast::<u32>())
        }))
    }

    #[inline(always)]
    fn read8(data: &[u8]) -> u64 {
        debug_assert!(data.len() >= 8);
        // SAFETY: every caller passes a slice with ≥8 bytes (see comment above);
        // `read_unaligned` imposes no alignment requirement.
        u64::from_le(unsafe { core::ptr::read_unaligned(data.as_ptr().cast::<u64>()) })
    }

    #[inline]
    fn mum_(a: &mut u64, b: &mut u64) {
        let x = (*a as u128).wrapping_mul(*b as u128);
        *a = x as u64; // @truncate
        *b = (x >> 64) as u64; // @truncate
    }

    #[inline]
    fn mix(a_: u64, b_: u64) -> u64 {
        let mut a = a_;
        let mut b = b_;
        Self::mum_(&mut a, &mut b);
        a ^ b
    }

    #[inline]
    fn final0(&mut self) {
        self.state[0] ^= self.state[1] ^ self.state[2];
    }

    // input_lb must be at least 16-bytes long (in shorter key cases the small_key function will be
    // used instead). We use an index into a slice for comptime processing as opposed to if we
    // used pointers.
    #[inline]
    fn final1(&mut self, input_lb: &[u8], start_pos: usize) {
        debug_assert!(input_lb.len() >= 16);
        debug_assert!(input_lb.len() - start_pos <= 48);
        let input = &input_lb[start_pos..];

        let mut i: usize = 0;
        while i + 16 < input.len() {
            self.state[0] = Self::mix(
                Self::read8(&input[i..]) ^ Self::SECRET[1],
                Self::read8(&input[i + 8..]) ^ self.state[0],
            );
            i += 16;
        }

        self.a = Self::read8(&input_lb[input_lb.len() - 16..]);
        self.b = Self::read8(&input_lb[input_lb.len() - 8..]);
    }

    #[inline(always)] // Zig: `inline fn final2`
    fn final2(&mut self) -> u64 {
        self.a ^= Self::SECRET[1];
        self.b ^= self.state[0];
        Self::mum_(&mut self.a, &mut self.b);
        Self::mix(
            self.a ^ Self::SECRET[0] ^ (self.total_len as u64),
            self.b ^ Self::SECRET[1],
        )
    }

    #[inline(always)]
    pub fn hash(seed: u64, input: &[u8]) -> u64 {
        let mut this = Wyhash::init(seed);

        if input.len() <= 16 {
            this.small_key(input);
        } else {
            let mut i: usize = 0;
            if input.len() >= 48 {
                let [mut s0, mut s1, mut s2] = this.state;
                let (k1, k2, k3) = (Self::SECRET[1], Self::SECRET[2], Self::SECRET[3]);
                let bound = input.len() - 48;
                let p = input.as_ptr();
                while i < bound {
                    macro_rules! r8 {
                        ($o:literal) => {
                            // SAFETY: loop invariant `i < len - 48` ⇒ `i + 48 ≤ len`,
                            // so every `p.add(i + off)` for off ∈ {0,8,16,24,32,40}
                            // addresses an 8-byte window wholly inside `input`.
                            // `read_unaligned` imposes no alignment requirement.
                            u64::from_le(unsafe {
                                core::ptr::read_unaligned(p.add(i + $o).cast::<u64>())
                            })
                        };
                    }
                    // u64×u64 → u128 cannot overflow; `wrapping_mul` skips
                    // the debug-mode overflow check that plain `*` emits.
                    let m0 = ((r8!(0) ^ k1) as u128).wrapping_mul((r8!(8) ^ s0) as u128);
                    s0 = (m0 as u64) ^ ((m0 >> 64) as u64);
                    let m1 = ((r8!(16) ^ k2) as u128).wrapping_mul((r8!(24) ^ s1) as u128);
                    s1 = (m1 as u64) ^ ((m1 >> 64) as u64);
                    let m2 = ((r8!(32) ^ k3) as u128).wrapping_mul((r8!(40) ^ s2) as u128);
                    s2 = (m2 as u64) ^ ((m2 >> 64) as u64);
                    i += 48;
                }
                this.state = [s0, s1, s2];
                this.final0();
            }
            this.final1(input, i);
        }

        this.total_len = input.len();
        this.final2()
    }
}

// Allow `Wyhash` to be used with `core::hash::Hash::hash` (e.g., as the state
// for std/HashMap-style hashing). Mirrors Zig's `std.hash_map` AutoContext.
impl core::hash::Hasher for Wyhash {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        self.update(bytes);
    }
    #[inline]
    fn finish(&self) -> u64 {
        // `final_` already operates on a shallow copy → idempotent on `&self`.
        self.final_()
    }
}

impl Default for Wyhash {
    #[inline]
    fn default() -> Self {
        Wyhash::init(0)
    }
}

#[derive(Default, Clone, Copy)]
pub struct OneShotHasher {
    hash: u64,
}

impl core::hash::Hasher for OneShotHasher {
    #[inline(always)]
    fn write(&mut self, bytes: &[u8]) {
        self.hash = Wyhash11::hash(self.hash, bytes);
    }
    #[inline(always)]
    fn write_u8(&mut self, n: u8) {
        self.write_u64(u64::from(n));
    }
    #[inline(always)]
    fn write_u16(&mut self, n: u16) {
        self.write_u64(u64::from(n));
    }
    #[inline(always)]
    fn write_u32(&mut self, n: u32) {
        self.write_u64(u64::from(n));
    }
    #[inline(always)]
    fn write_u64(&mut self, n: u64) {
        // Cheap diffusion for integer keys — one 128-bit multiply, same
        // primitive wyhash uses internally (`mum`).
        self.hash = mum(self.hash ^ n, PRIMES[4]);
    }
    #[inline(always)]
    fn write_length_prefix(&mut self, _len: usize) {}
    #[inline(always)]
    fn write_usize(&mut self, n: usize) {
        self.write_u64(n as u64);
    }
    #[inline(always)]
    fn finish(&self) -> u64 {
        self.hash
    }
}

/// Hash any `K: Hash` through [`OneShotHasher`] — the `Hash` → wyhash thunk
/// shared by both auto-context map types. See the [`OneShotHasher`] doc-comment
/// for the length-prefix divergence from Zig's `Wyhash.hash(0, asBytes(&k))`.
#[inline]
pub fn auto_hash<K: core::hash::Hash + ?Sized>(key: &K) -> u64 {
    let mut h = OneShotHasher::default();
    key.hash(&mut h);
    core::hash::Hasher::finish(&h)
}

/// `BuildHasher` for `std::collections::HashMap` so containers can opt out of
/// SipHash. Deterministic across runs and ~3-5× faster than `RandomState` on
/// the short identifier keys the parser/printer/renamer churn.
pub type BuildHasher = core::hash::BuildHasherDefault<OneShotHasher>;

/// `bun.hash(bytes)` — `std.hash.Wyhash` with seed 0.
#[inline]
pub fn hash(bytes: &[u8]) -> u64 {
    Wyhash::hash(0, bytes)
}

#[inline]
pub fn hash32(bytes: &[u8]) -> u32 {
    hash(bytes) as u32 // @truncate
}

/// `bun.hashWithSeed(seed, bytes)` — `std.hash.Wyhash` with explicit seed.
#[inline]
pub fn hash_with_seed(seed: u64, bytes: &[u8]) -> u64 {
    Wyhash::hash(seed, bytes)
}

#[inline]
pub fn hash_ascii_lowercase(seed: u64, bytes: &[u8]) -> u64 {
    let mut buf = [0u8; 48];
    if bytes.len() <= buf.len() {
        // Fast path: one-shot hash on the lowered copy — skips the streaming
        // `Wyhash` state's 48-byte buf zero-fill + `final_` shallow-copy.
        let dst = &mut buf[..bytes.len()];
        for (d, &s) in dst.iter_mut().zip(bytes) {
            *d = s.to_ascii_lowercase();
        }
        return Wyhash::hash(seed, dst);
    }
    let mut h = Wyhash::init(seed);
    let mut remain = bytes;
    while !remain.is_empty() {
        let n = remain.len().min(buf.len());
        let dst = &mut buf[..n];
        for (d, &s) in dst.iter_mut().zip(&remain[..n]) {
            *d = s.to_ascii_lowercase();
        }
        h.update(dst);
        remain = &remain[n..];
    }
    h.final_()
}

pub const fn hash_const(seed: u64, input: &[u8]) -> u64 {
    // ── std.hash.Wyhash (final4 variant) — const-fn re-port. ──
    const SECRET: [u64; 4] = Wyhash::SECRET;

    #[inline]
    const fn mix(a: u64, b: u64) -> u64 {
        let x = (a as u128).wrapping_mul(b as u128);
        (x as u64) ^ ((x >> 64) as u64)
    }
    #[inline]
    const fn read4(d: &[u8], o: usize) -> u64 {
        u32::from_le_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]]) as u64
    }
    #[inline]
    const fn read8(d: &[u8], o: usize) -> u64 {
        u64::from_le_bytes([
            d[o],
            d[o + 1],
            d[o + 2],
            d[o + 3],
            d[o + 4],
            d[o + 5],
            d[o + 6],
            d[o + 7],
        ])
    }

    let s0 = seed ^ mix(seed ^ SECRET[0], SECRET[1]);
    let mut state = [s0, s0, s0];
    let len = input.len();
    let a: u64;
    let b: u64;

    if len <= 16 {
        // small_key
        if len >= 4 {
            let end = len - 4;
            let quarter = (len >> 3) << 2;
            a = (read4(input, 0) << 32) | read4(input, quarter);
            b = (read4(input, end) << 32) | read4(input, end - quarter);
        } else if len > 0 {
            a = ((input[0] as u64) << 16)
                | ((input[len >> 1] as u64) << 8)
                | (input[len - 1] as u64);
            b = 0;
        } else {
            a = 0;
            b = 0;
        }
    } else {
        let mut i: usize = 0;
        if len >= 48 {
            while i + 48 < len {
                // round
                state[0] = mix(read8(input, i) ^ SECRET[1], read8(input, i + 8) ^ state[0]);
                state[1] = mix(
                    read8(input, i + 16) ^ SECRET[2],
                    read8(input, i + 24) ^ state[1],
                );
                state[2] = mix(
                    read8(input, i + 32) ^ SECRET[3],
                    read8(input, i + 40) ^ state[2],
                );
                i += 48;
            }
            // final0
            state[0] ^= state[1] ^ state[2];
        }
        // final1
        let mut j = i;
        while j + 16 < len {
            state[0] = mix(read8(input, j) ^ SECRET[1], read8(input, j + 8) ^ state[0]);
            j += 16;
        }
        a = read8(input, len - 16);
        b = read8(input, len - 8);
    }

    // final2 (mum_ inlined)
    let x = ((a ^ SECRET[1]) as u128).wrapping_mul((b ^ state[0]) as u128);
    mix(
        (x as u64) ^ SECRET[0] ^ (len as u64),
        ((x >> 64) as u64) ^ SECRET[1],
    )
}

/// `std.hash.int` — integer-to-integer hashing (same width in, same width out).
/// Zig's version is `anytype`-generic; we cover the dedicated widths (16/32/64)
/// via a sealed trait. All current callers pass `u32`.
#[inline]
pub fn hash_int<T: HashInt>(input: T) -> T {
    T::hash_int(input)
}

pub trait HashInt: Copy {
    fn hash_int(self) -> Self;
}

// Source: https://github.com/skeeto/hash-prospector
impl HashInt for u16 {
    #[inline]
    fn hash_int(self) -> u16 {
        let mut x = self;
        x = (x ^ (x >> 7)).wrapping_mul(0x2993);
        x = (x ^ (x >> 5)).wrapping_mul(0xe877);
        x = (x ^ (x >> 9)).wrapping_mul(0x0235);
        x ^ (x >> 10)
    }
}

// Source: https://github.com/skeeto/hash-prospector
impl HashInt for u32 {
    #[inline]
    fn hash_int(self) -> u32 {
        let mut x = self;
        x = (x ^ (x >> 17)).wrapping_mul(0xed5a_d4bb);
        x = (x ^ (x >> 11)).wrapping_mul(0xac4c_1b51);
        x = (x ^ (x >> 15)).wrapping_mul(0x3184_8bab);
        x ^ (x >> 14)
    }
}

// Source: https://github.com/jonmaiga/mx3
impl HashInt for u64 {
    #[inline]
    fn hash_int(self) -> u64 {
        const C: u64 = 0xbea2_25f9_eb34_556d;
        let mut x = self;
        x = (x ^ (x >> 32)).wrapping_mul(C);
        x = (x ^ (x >> 29)).wrapping_mul(C);
        x = (x ^ (x >> 32)).wrapping_mul(C);
        x ^ (x >> 29)
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    // Run https://github.com/wangyi-fudan/wyhash/blob/77e50f267fbc7b8e2d09f2d455219adb70ad4749/test_vector.cpp directly.
    struct TestVector {
        seed: u64,
        expected: u64,
        input: &'static [u8],
    }

    const VECTORS: &[TestVector] = &[
        TestVector {
            seed: 0,
            expected: 0x0409638ee2bde459,
            input: b"",
        },
        TestVector {
            seed: 1,
            expected: 0xa8412d091b5fe0a9,
            input: b"a",
        },
        TestVector {
            seed: 2,
            expected: 0x32dd92e4b2915153,
            input: b"abc",
        },
        TestVector {
            seed: 3,
            expected: 0x8619124089a3a16b,
            input: b"message digest",
        },
        TestVector {
            seed: 4,
            expected: 0x7a43afb61d7f5f40,
            input: b"abcdefghijklmnopqrstuvwxyz",
        },
        TestVector {
            seed: 5,
            expected: 0xff42329b90e50d58,
            input: b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
        },
        TestVector {
            seed: 6,
            expected: 0xc39cab13b115aad3,
            input:
                b"12345678901234567890123456789012345678901234567890123456789012345678901234567890",
        },
    ];

    #[test]
    fn test_vectors() {
        for e in VECTORS {
            assert_eq!(
                e.expected,
                Wyhash::hash(e.seed, e.input),
                "input={:?}",
                bstr::BStr::new(e.input)
            );
        }
    }

    fn smhasher(hash_fn: impl Fn(u64, &[u8]) -> u64) -> u32 {
        const HASH_SIZE: usize = core::mem::size_of::<u64>();
        let mut buf = [0u8; 256];
        let mut buf_all = [0u8; 256 * HASH_SIZE];

        for i in 0..256usize {
            buf[i] = i as u8;
            let h = hash_fn((256 - i) as u64, &buf[0..i]);
            buf_all[i * HASH_SIZE..(i + 1) * HASH_SIZE].copy_from_slice(&h.to_le_bytes());
        }

        hash_fn(0, &buf_all[..]) as u32
    }

    #[test]
    fn test_smhasher() {
        assert_eq!(smhasher(Wyhash::hash), 0xBD5E840C);
    }

    #[test]
    fn hash_const_matches_runtime() {
        // `hash_const` is a parallel const-fn re-port of `Wyhash::hash`; it
        // produces compile-time symbol suffixes that must match Zig's
        // `comptime std.hash.Wyhash.hash(0, name)` byte-for-byte. Guard drift.
        for s in [
            &b""[..],
            b"a",
            b"abc",
            b"__require",
            b"0123456789abcdef0",
            b"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        ] {
            assert_eq!(hash_const(0, s), Wyhash::hash(0, s), "input: {s:?}");
        }
        // Also exercise the seeded init path + SMHasher's full range.
        assert_eq!(smhasher(hash_const), 0xBD5E840C);
    }

    #[test]
    fn test_iterative_api() {
        // Sum(1..32) = 528
        let buf = [0u8; 528];
        let mut len: usize = 0;
        let seed = 0;

        let mut hasher = Wyhash::init(seed);
        for i in 1..32usize {
            let r = Wyhash::hash(seed, &buf[0..len + i]);
            hasher.update(&buf[len..len + i]);
            let f1 = hasher.final_();
            let f2 = hasher.final_();
            assert_eq!(f1, f2, "iterative hash was not idempotent at i={i}");
            assert_eq!(f1, r, "iterative hash did not match direct at i={i}");
            len += i;
        }
    }

    #[test]
    fn test_iterative_maintains_last_sixteen() {
        // "Z" ** 48 ++ "01234567890abcdefg"
        let mut input = [0u8; 48 + 18];
        for b in &mut input[..48] {
            *b = b'Z';
        }
        input[48..].copy_from_slice(b"01234567890abcdefg");
        let seed = 0;

        for i in 0..17usize {
            let payload = &input[0..input.len() - i];
            let non_iterative_hash = Wyhash::hash(seed, payload);

            let mut wh = Wyhash::init(seed);
            wh.update(payload);
            let iterative_hash = wh.final_();

            assert_eq!(non_iterative_hash, iterative_hash, "i={i}");
        }
    }

    #[test]
    fn test_iterative_chunked_matches_oneshot() {
        // Exercise the buf-carryover paths in update() across many split points.
        let mut data = [0u8; 200];
        for (i, b) in data.iter_mut().enumerate() {
            *b = (i as u8).wrapping_mul(31).wrapping_add(7);
        }
        for total in [0usize, 1, 3, 15, 16, 17, 47, 48, 49, 95, 96, 97, 150, 200] {
            let direct = Wyhash::hash(42, &data[..total]);
            for first in 0..=total {
                let mut h = Wyhash::init(42);
                h.update(&data[..first]);
                h.update(&data[first..total]);
                assert_eq!(direct, h.final_(), "total={total} first={first}");
            }
        }
    }

    #[test]
    fn test_hash_ascii_lowercase() {
        // Chunked streaming path must equal one-shot over the fully-lowered
        // buffer (guards the "chunk-invariant" claim in the doc comment), and
        // mixed-case inputs must hash equal to their lowercase form.
        let mut data = [0u8; 200];
        for (i, b) in data.iter_mut().enumerate() {
            *b = b'A' + (i as u8 % 58); // mix of A..Z, punct, a..z
        }
        for total in [0usize, 1, 16, 47, 48, 49, 95, 96, 97, 200] {
            let lowered: Vec<u8> = data[..total].iter().map(u8::to_ascii_lowercase).collect();
            assert_eq!(
                hash_ascii_lowercase(0, &data[..total]),
                Wyhash::hash(0, &lowered),
                "total={total}"
            );
            assert_eq!(
                hash_ascii_lowercase(0, &data[..total]),
                hash_ascii_lowercase(0, &lowered),
                "case-fold total={total}"
            );
        }
    }

    #[test]
    fn test_wyhash_is_not_wyhash11() {
        // Guard against the historical mix-up: these are different algorithms.
        assert_ne!(Wyhash::hash(0, b"abc"), Wyhash11::hash(0, b"abc"));
    }
}

// ported from: src/wyhash/wyhash.zig
