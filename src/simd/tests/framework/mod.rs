//! Compares operations with a scalar model, for each type of lane, width and target.
//!
//! ```text
//! name [types] bytes, |d, a, b, c, io| vector code => |m| the lanes of the result;
//! ```
//! `bytes` is the range of widths, where `T` is the type of lane. `a`, `b` and `c` are vectors of `d`. The model sees
//! them as `m.a`, `m.b` and `m.c`. It computes in `i128`, of which as many bits count as the lane of the result has.
//! A floating-point lane is its bits. `ANY` stands for a lane that is unspecified. A quiet NaN stands for any NaN, and a signaling one for itself:
//! what only moves lanes keeps it. `Ty::of` and `Ty::quiet` give quiet ones.
//!
//! `ROUNDS` is the number of random inputs. `EXHAUSTIVE` replaces them: see `sweeps`. `TARGETS=avx2+aes,neon` leaves out the others.
//! `WIDE=128`, 256 or 512, when the tests are compiled, runs each case only at its largest width times `WIDE / 64`, and on few targets. It needs `--cfg bun_simd_misfits_panic`, to skip what doesn't fit.
//! `ALL_TARGETS=1`, when the tests are compiled, adds the other targets.
//! `FLOATS=1`, when the tests are compiled, leaves out the cases without floats.
//! `LISTED=1` and `ZEN=members` do for all files what the names `*_listed` and `members*` do: see `LISTED` and `tuned`.
//! `PART` of `PARTS` runs some of the inputs, and `THREADS` share those of each case.
#![allow(dead_code, unused_macros)]

use bun_simd::{target::*, *};
#[path = "on.rs"]
mod on;
pub use on::*;

pub const WIDE: usize = match option_env!("WIDE") {
    Some(it) => match usize::from_str_radix(it, 10) {
        Ok(it) => it,
        _ => panic!(),
    },
    None => 0,
};
const _: () = assert!(WIDE == 0 || cfg!(any(miri, bun_simd_misfits_panic)), "WIDE needs --cfg bun_simd_misfits_panic");
/// From one operand to the next.
pub const STEP: usize = if WIDE != 0 { WIDE } else { 64 };
pub const OF_CASES: Targets =
    if WIDE == 0 && !LISTED && option_env!("ALL_TARGETS").is_some() { Targets::ALL } else { FEW };
/// The kernels list words for tuning, by which some operations choose their form.
pub const LISTED: bool = option_env!("LISTED").is_some()
    || matches!(env!("CARGO_CRATE_NAME").as_bytes(), [.., b'_', b'l', b'i', b's', b't', b'e', b'd']);
pub const FEW: Targets = Targets(if LISTED {
    &[
        target!(icelake + fast_gather),
        target!(avx512 + fast_gather),
        target!(avx512 + narrow + fast_gather),
        target!(avx2 + fast_pdep + fast_gather),
        target!(sve2 + aes + fast_pdep),
        target!(neon + fast_pdep),
        target!(portable + fast_pdep),
    ]
} else if WIDE / 256 != 0 {
    &[target!(icelake), target!(avx2 + aes), target!(neon + aes + crc), target!(wasm)]
} else {
    &[
        target!(icelake + fp16),
        target!(icelake),
        target!(avx512 + aes),
        target!(avx2 + aes),
        target!(sse4 + aes),
        target!(sve2 + aes + sha3),
        target!(neon82 + aes + sha3 + fcma),
        target!(neon + aes + crc),
        target!(wasm + relaxed),
        target!(wasm),
    ]
});
pub static CPU: std::sync::Mutex<()> = std::sync::Mutex::new(());
pub const ANY: i128 = i128::MIN;
/// It makes all NaNs quiet that it loads.
const X87: bool =
    cfg!(target_arch = "x86") && (cfg!(not(target_feature = "sse2")) || option_env!("COVERAGE_FLAGS").is_some());
pub type Lanes = Vec<i128>;

#[derive(Copy, Clone, PartialEq, Debug)]
pub enum Ty {
    U(u32),
    I(u32),
    F(u32),
}
pub use Ty::*;
/// `bf16`.
pub const BF: Ty = F(15);

pub trait LaneOf {
    type T;
}
impl<T: Lane, W: Width, S: Isa> LaneOf for Simd<T, W, S> {
    type T = T;
}
/// Without the feature in each test.
#[allow(non_camel_case_types)]
pub type half = <bun_simd::prelude::f16x1<bun_simd::target::Portable> as LaneOf>::T;
macro_rules! test_halves { ($($t:ident $ty:expr;)*) => {$(
    impl Test for $t {
        const TY: Ty = $ty;
        fn from_bits(bits: u64) -> Self { mem::bitcast_slice::<$t>(&[bits as u16])[0] }
        fn to_bits(self) -> u64 { mem::bitcast_slice::<u16>(&[self])[0] as u64 }
    }
    impl Put for $t { fn put(self, out: &mut Out) { out.lanes($ty, &Test::to_bits(self).to_le_bytes()[..2]) } }
    impl Put for Vec<$t> { fn put(self, out: &mut Out) { for it in self { it.put(out) } } }
)*}; }
test_halves! { half F(16); bf16 BF; }

fn two_to(n: i32) -> f64 {
    f64::from_bits(((1023 + n) as u64) << 52)
}
/// The value of 16 bits, of which so many are below the exponent.
fn from_16(bits: u16, fraction: i32) -> f64 {
    let (e, m, all) = ((bits & 0x7fff) as i32 >> fraction, (bits & !(!0 << fraction)) as f64, 0x7fff >> fraction);
    let abs = match e {
        0 => m * two_to(1 - all / 2 - fraction),
        _ if e == all => {
            if m == 0.0 {
                f64::INFINITY
            } else {
                f64::NAN
            }
        }
        _ => (m + (1 << fraction) as f64) * two_to(e - all / 2 - fraction),
    };
    if bits >> 15 == 1 { -abs } else { abs }
}
fn to_16(x: f64, fraction: i32) -> u16 {
    let (all, sign) = (0x7fff >> fraction, (x.is_sign_negative() as u16) << 15);
    if x.is_nan() {
        return sign | 0x7fff;
    }
    let e = ((x.to_bits() >> 52 & 0x7ff) as i32 - 1023).clamp(1 - all / 2, all / 2 + 1);
    let steps = (x.abs() * two_to(fraction - e)).round_ties_even().min(1e6) as i32;
    sign | (((e + all / 2 - 1) << fraction) + steps).min(all << fraction) as u16
}

pub trait Test: Lane {
    const TY: Ty;
    fn from_bits(bits: u64) -> Self;
    fn to_bits(self) -> u64;
}
macro_rules! test_lanes { ($($t:ident $ty:expr, $u:ident;)*) => {$(
    impl Test for $t {
        const TY: Ty = $ty;
        fn from_bits(bits: u64) -> Self { Self::from_ne_bytes((bits as $u).to_ne_bytes()) }
        fn to_bits(self) -> u64 { $u::from_ne_bytes(self.to_ne_bytes()) as u64 }
    }
    impl Put for $t { fn put(self, out: &mut Out) { out.lanes($ty, &self.to_le_bytes()) } }
    impl Put for Vec<$t> { fn put(self, out: &mut Out) { for it in mem::bitcast_slice::<$u>(&self) { out.lanes($ty, &it.to_le_bytes()) } } }
)*}; }
test_lanes! {
    u8 U(8), u8; u16 U(16), u16; u32 U(32), u32; u64 U(64), u64;
    i8 I(8), u8; i16 I(16), u16; i32 I(32), u32; i64 I(64), u64; f32 F(32), u32; f64 F(64), u64;
}

impl Ty {
    pub fn bits(self) -> u32 {
        let (U(bits) | I(bits) | F(bits)) = self;
        bits.next_multiple_of(8)
    }
    pub fn size(self) -> usize {
        self.bits() as usize / 8
    }
    pub fn min(self) -> i128 {
        if let I(bits) = self { -1 << (bits - 1) } else { 0 }
    }
    pub fn max(self) -> i128 {
        if let I(bits) = self { (1 << (bits - 1)) - 1 } else { (1 << self.bits()) - 1 }
    }
    pub fn clamp(self, x: i128) -> i128 {
        x.clamp(self.min(), self.max())
    }
    pub fn unsigned(self, x: i128) -> i128 {
        x & U(self.bits()).max()
    }
    pub fn wrap(self, x: i128) -> i128 {
        if let I(bits) = self { x << (128 - bits) >> (128 - bits) } else { self.unsigned(x) }
    }
    pub fn wide(self) -> Ty {
        match self {
            U(b) => U(2 * b),
            I(b) => I(2 * b),
            F(_) => F(2 * self.bits()),
        }
    }
    pub fn narrow(self) -> Ty {
        match self {
            U(b) => U(b / 2),
            I(b) => I(b / 2),
            F(b) => F(b / 2),
        }
    }
    /// The value of a lane.
    pub fn float(self, x: i128) -> f64 {
        match self {
            F(16) => from_16(x as u16, 10),
            BF => from_16(x as u16, 7),
            F(32) => f32::from_bits(x as u32) as f64,
            F(_) => f64::from_bits(x as u64),
            _ => x as f64,
        }
    }
    /// The bits of a floating-point lane.
    pub fn of(self, x: f64) -> i128 {
        self.quiet(match self {
            F(16) => to_16(x, 10) as i128,
            BF => to_16(x, 7) as i128,
            F(32) => (x as f32).to_bits() as i128,
            _ => x.to_bits() as i128,
        })
    }
    /// The highest bit below the exponent.
    fn quiet_bit(self) -> i128 {
        match self {
            F(16) => 1 << 9,
            BF => 1 << 6,
            F(32) => 1 << 22,
            _ => 1 << 51,
        }
    }
    fn infinity(self) -> i128 {
        (self.max() >> 1) - (2 * self.quiet_bit() - 1)
    }
    /// For results that can be any NaN.
    pub fn quiet(self, x: i128) -> i128 {
        if x != ANY && self.is_nan(x) { x | self.quiet_bit() } else { x }
    }
    pub fn is_signaling(self, x: i128) -> bool {
        self.is_nan(x) && x & self.quiet_bit() == 0
    }
    pub fn lanes(self, bytes: &[u8]) -> Lanes {
        let lane = |it: &[u8]| self.wrap(it.iter().rev().fold(0, |all, &byte| all << 8 | byte as i128));
        bytes.chunks_exact(self.size()).map(lane).collect()
    }
    pub fn is_nan(self, x: i128) -> bool {
        matches!(self, F(_)) && x & self.max() >> 1 > self.infinity()
    }
    pub fn lt(self, x: i128, y: i128) -> bool {
        if let F(_) = self { self.float(x) < self.float(y) } else { x < y }
    }
    pub fn eq(self, x: i128, y: i128) -> bool {
        if let F(_) = self { self.float(x) == self.float(y) } else { x == y }
    }
    pub fn add(self, x: i128, y: i128) -> i128 {
        if let F(_) = self { self.of(self.float(x) + self.float(y)) } else { x + y }
    }
}

/// The operands. `a`, `b` and `c` are the first three times `STEP` bytes.
pub struct Io {
    pub bytes: [u8; 4 * STEP],
    pub n: u64,
}

impl Io {
    /// Operand 0, 1 or 2 as any vector.
    #[inline(always)]
    pub fn load<S: Isa, T: Lane, W: Width>(&self, d: Tagged<T, W, S>, i: usize) -> Simd<T, W, S> {
        d.repartition::<u8>().load(&self.bytes[STEP * i..]).bitcast()
    }
    #[inline(never)]
    pub fn slice<T: Test>(&self) -> Vec<T> {
        let mut all = vec![T::default(); self.bytes.len() / size_of::<T>()];
        mem::as_bytes_mut(&mut all).copy_from_slice(&self.bytes);
        if cfg!(target_endian = "big") {
            mem::as_bytes_mut(&mut all).chunks_mut(size_of::<T>()).for_each(<[u8]>::reverse)
        }
        all
    }
    /// From 0 to `max`.
    pub fn up_to(&self, max: usize) -> usize {
        (self.n % (max as u64 + 1)) as usize
    }
}

#[derive(Default)]
pub struct Out(Vec<(Ty, i128)>);
impl Out {
    #[inline(never)]
    fn lanes(&mut self, ty: Ty, bytes: &[u8]) {
        self.0.extend(ty.lanes(bytes).into_iter().map(|it| (ty, it)))
    }
}

pub trait Put {
    fn put(self, out: &mut Out);
}
impl<S: Isa, T: Test, W: Width> Put for Simd<T, W, S> {
    #[inline(always)]
    fn put(self, out: &mut Out) {
        let mut bytes = [0; if WIDE != 0 { 512 } else { 64 }];
        self.bitcast::<u8>().store(&mut bytes);
        out.lanes(T::TY, &bytes[..W::BYTES])
    }
}
/// Each lane is -1 or 0.
impl<S: Isa, T: Signed + Test, W: Width> Put for Mask<T, W, S> {
    #[inline(always)]
    fn put(self, out: &mut Out) {
        self.to_simd::<T>().put(out)
    }
}
impl Put for usize {
    fn put(self, out: &mut Out) {
        (self as u64).put(out)
    }
}
impl Put for bool {
    fn put(self, out: &mut Out) {
        (self as u64).put(out)
    }
}
/// `None` is -1.
impl Put for Option<usize> {
    fn put(self, out: &mut Out) {
        self.map_or(u64::MAX, |it| it as u64).put(out)
    }
}
impl<A: Put, B: Put> Put for (A, B) {
    #[inline(always)]
    fn put(self, out: &mut Out) {
        self.0.put(out);
        self.1.put(out)
    }
}
impl<A: Put + Copy, const N: usize> Put for [A; N] {
    #[inline(always)]
    fn put(self, out: &mut Out) {
        let mut i = 0;
        while i < N {
            self[i].put(out);
            i += 1;
        }
    }
}

pub struct Model<'a> {
    pub t: Ty,
    /// Lanes in a vector.
    pub n: usize,
    /// Lanes in a block.
    pub block: usize,
    pub bytes: usize,
    pub a: Lanes,
    pub b: Lanes,
    pub c: Lanes,
    /// The highest bits of `a`, `b` and `c`.
    pub ma: Vec<bool>,
    pub mb: Vec<bool>,
    pub mc: Vec<bool>,
    pub io: &'a Io,
    pub target: Target,
    asked_for_target: core::cell::Cell<bool>,
}

impl Model<'_> {
    pub fn each(&self, f: impl FnMut(usize) -> i128) -> Lanes {
        (0..self.n).map(f).collect()
    }
    pub fn mask(&self, mut f: impl FnMut(usize) -> bool) -> Lanes {
        self.each(|i| -(f(i) as i128))
    }
    pub fn map1(&self, f: impl Fn(i128) -> i128) -> Lanes {
        self.each(|i| f(self.a[i]))
    }
    pub fn map2(&self, f: impl Fn(i128, i128) -> i128) -> Lanes {
        self.each(|i| f(self.a[i], self.b[i]))
    }
    pub fn map3(&self, f: impl Fn(i128, i128, i128) -> i128) -> Lanes {
        self.each(|i| f(self.a[i], self.b[i], self.c[i]))
    }
    pub fn float1(&self, f: impl Fn(f64) -> f64) -> Lanes {
        self.map1(|x| self.t.of(f(self.t.float(x))))
    }
    pub fn num2(&self, int: impl Fn(i128, i128) -> i128, float: impl Fn(f64, f64) -> f64) -> Lanes {
        let t = self.t;
        if let F(_) = t { self.map2(|x, y| t.of(float(t.float(x), t.float(y)))) } else { self.map2(int) }
    }
    /// All bytes of operand `i` as another type.
    pub fn view(&self, i: usize, ty: Ty) -> Lanes {
        ty.lanes(&self.io.bytes[STEP * i..][..STEP])
    }
    /// `io.slice()`.
    pub fn slice(&self) -> Lanes {
        self.t.lanes(&self.io.bytes)
    }
    /// The lanes of each block, one after the other. `f` gets the lanes of `a` and `b` in the block, and an index.
    pub fn blocks(&self, f: impl Fn(&[i128], &[i128], usize) -> i128) -> Lanes {
        let k = self.block;
        self.each(|i| f(&self.a[i / k * k..][..k], &self.b[i / k * k..][..k], i % k))
    }
    /// The lanes of `t` in these bytes.
    pub fn from_bytes(&self, bytes: impl Iterator<Item = i128>) -> Lanes {
        self.t.lanes(&bytes.map(|it| it as u8).collect::<Vec<_>>())
    }
    pub fn has_word(&self, word: &str) -> bool {
        self.asked_for_target.set(true);
        self.target.has_word(word)
    }
    pub fn has(&self, feature: &str) -> bool {
        self.asked_for_target.set(true);
        self.target.features().contains(&feature)
    }
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let z = (self.0 ^ self.0 >> 30).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        let z = (z ^ z >> 27).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ z >> 31
    }
    fn lane(&mut self, t: Ty, mode: u64) -> u64 {
        let (r, top) = (self.next(), 1u64 << (t.bits() - 1));
        let edges = [
            0,
            1,
            2,
            !0,
            !1,
            top,
            top - 1,
            top + 1,
            top >> 1,
            0x7f,
            0x80,
            0xff,
            0x100,
            0x7fff,
            0x8000,
            0xffff,
            !0x7f,
            !0x80,
        ];
        let floats = [
            0.0,
            -0.0,
            0.5,
            1.5,
            2.5,
            -0.5,
            -1.5,
            1e10,
            -1e10,
            2147483520.0,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NAN,
            1e-40,
        ];
        match (t, mode) {
            (_, 0) => r,
            // Signaling NaNs.
            (F(32 | 64), 1) if !X87 && r >> 60 < 3 => {
                (t.infinity() | [1, t.quiet_bit() >> 1, t.quiet_bit() - 1][r as usize % 3]) as u64
                    | r << 8 >> (64 - t.bits()) & top
            }
            (F(_), 6) if !X87 && r >> 63 == 1 => {
                (t.infinity() | (r as i128 & (t.quiet_bit() - 1)).max(1)) as u64 | r << 1 >> (64 - t.bits()) & top
            }
            (F(15 | 16), 1) if r >> 60 < 8 => {
                [1, 0x7f, 0x80, 0x3ff, 0x400, 0x7bff, 0x7f7f, 0x3c00, 0x3f80, 0x7c01, 0x7f81][r as usize % 11]
                    | r >> 40 & top
            }
            (F(15 | 16), 3..) => r & 0x8fff | (0x3000 + ((self.next() % 2) << 12)),
            (F(_), 1) => t.of(floats[r as usize % floats.len()]) as u64,
            (F(_), 2) => t.of((r as i16) as f64 / 4.0) as u64,
            (F(_), _) => t.of((r as i32) as f64 / 3.0) as u64,
            (_, 1) => edges[r as usize % edges.len()],
            (_, 2) => ((r as i8) >> 4) as u64,
            (_, 3) => r >> (64 - t.bits()) >> (self.next() % t.bits() as u64),
            // The highest bits are all clear, all set, or rarely set.
            (_, 4) => r & !top,
            (_, 5) => r | top,
            _ => {
                if r % 23 == 0 {
                    r | top
                } else {
                    r & !top
                }
            }
        }
    }
    fn io(&mut self, t: Ty) -> Io {
        let (mut bytes, mode, copy) = ([0; 4 * STEP], self.next() % 8, self.next() % 4);
        for at in (0..4 * STEP).step_by(t.size()) {
            let mode = if mode == 7 { self.next() % 4 } else { mode };
            let lane = self.lane(t, mode).to_le_bytes();
            bytes[at..][..t.size()].copy_from_slice(&lane[..t.size()]);
            if (STEP..2 * STEP).contains(&at) && (copy == 0 || copy == 1 && self.next() % 2 == 0) {
                bytes.copy_within(at - STEP..at - STEP + t.size(), at);
            }
        }
        Io { bytes, n: self.next() >> (self.next() % 64) }
    }
}

pub type Run = fn(Target, &Io, &mut Out) -> Option<()>;

/// The text of a case: the names of `a`, `b`, `c` and `io`, the vector code, and the model.
pub struct Text(pub [&'static str; 4], pub &'static str, pub &'static str);

/// Changes a random input into number `r` of so many.
pub type Sweep = (u64, Box<dyn Fn(u64, &mut Io) + Sync>);

/// All combinations of the values of lanes with `size` bytes in `operands`, each one in some lane or in every lane.
pub fn values(operands: &[usize], size: usize, bytes: usize, every_lane: bool) -> Sweep {
    let (operands, lanes) = (operands.to_vec(), (bytes / size) as u64);
    let count = 1u64 << (8 * size * operands.len());
    (
        if every_lane { count } else { count / lanes },
        Box::new(move |r, io| {
            for i in 0..64 / size as u64 {
                // Multiplying by an odd number is a permutation.
                let all =
                    if every_lane { r.wrapping_add(i * 0x9e_3779) } else { (r * lanes + i).wrapping_mul(0x2545_f491) };
                for (k, operand) in operands.iter().enumerate() {
                    io.bytes[64 * operand + size * i as usize..][..size]
                        .copy_from_slice(&all.to_le_bytes()[size * k..][..size]);
                }
            }
        }),
    )
}

/// All values of `width` bits from `at` on. The other bits are clear, set or random.
fn window(r: u64, random: u64, at: usize, width: usize) -> u64 {
    let inside = ((1u64 << width) - 1) << at;
    let rest = [0, !0, random][(r.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 40) as usize % 3];
    r << at & inside | rest & !inside
}

/// `EXHAUSTIVE` is a list of:
/// - `values`: all values of each operand of 8 and 16 bits, all pairs of 8 bits, and all pairs of adjacent bytes
/// - `lanes`: the same in every lane, not in some lane
/// - `triples`: all triples of 8 bits, in vectors of 16 and 64 bytes
/// - `masks`: all masks of up to 16 lanes, and in wider ones all those of each 16 lanes
/// - `counts`: `io.n` from 0 to 4095, the same as for masks, and all values with all counts of shifts
fn sweeps(which: &str, t: Ty, bytes: usize, Text(names, code, _): &Text) -> Vec<Sweep> {
    let (n, io) = (bytes / t.size(), names[3] != "_");
    let used: Vec<usize> = (0..3)
        .filter(|&i| names[i] != "_" || i < 2 && io && !code.contains("io.n") && !code.contains("up_to"))
        .collect();
    // The operands of some cases are half of a vector with narrower lanes.
    let (size, bytes) =
        if code.contains("Narrow") && code.contains("io.load") { (t.size() / 2, bytes / 2) } else { (t.size(), bytes) };
    let mut all = vec![];
    for every_lane in [false, true] {
        if !which.contains(if every_lane { "lanes" } else { "values" }) || size > 2 {
            continue;
        }
        all.extend(used.iter().map(|&i| values(&[i], 2, bytes, every_lane && size == 2)));
        if size == 1 {
            all.extend(used.iter().map(|&i| values(&[i], 1, bytes, true)));
            all.extend(
                [[0, 1], [0, 2], [1, 2]]
                    .iter()
                    .filter(|it| it.iter().all(|i| used.contains(i)))
                    .map(|it| values(it, 1, bytes, every_lane)),
            );
        }
    }
    if which.contains("triples") && size == 1 && used.len() == 3 && (bytes == 16 || bytes == 64) {
        all.push(values(&used, 1, bytes, false));
    }
    let windows = || (0..n).step_by(16).map(|at| (at, n.min(16)));
    if which.contains("masks") && ["mask", "negative", "sign"].iter().any(|it| code.contains(it)) {
        for (&operand, (at, width)) in used.iter().flat_map(|it| windows().map(move |w| (it, w))) {
            all.push((
                1 << width,
                Box::new(move |r, io| {
                    let bits = window(r, io.n.wrapping_mul(0xd6e8_feb8_6659_fd93), at, width);
                    for i in 0..n {
                        let top = &mut io.bytes[64 * operand + size * i + size - 1];
                        *top = *top & 0x7f | ((bits >> i) as u8) << 7;
                    }
                }),
            ));
        }
    }
    if which.contains("counts") && io {
        all.push((4096, Box::new(|r, io| io.n = r)));
        if size <= 2 && names[0] != "_" && code.contains("io.n as u32") {
            let (count, change) = values(&[0], size, bytes, false);
            all.push((
                64 * count,
                Box::new(move |r, io| {
                    change(r / 64, io);
                    io.n = r % 64
                }),
            ));
        }
        for (at, width) in windows().filter(|_| code.contains("bit") && code.contains("io.n")) {
            all.push((
                1 << width,
                Box::new(move |r, io| io.n = window(r, io.n.wrapping_mul(0xd6e8_feb8_6659_fd93), at, width)),
            ));
        }
    }
    all
}

/// The files in tests/parts take too long to compile in one piece.
pub const fn in_part(bytes: usize) -> bool {
    match env!("CARGO_CRATE_NAME").as_bytes() {
        [.., b'_', b'n', b'a', b'r', b'r', b'o', b'w'] => bytes <= 8,
        [.., b'_', b'1', b'6', b'_', b'm', b'i', b'd', b'd', b'l', b'e'] => bytes == 16,
        [.., b'_', b'3', b'2', b'_', b'm', b'i', b'd', b'd', b'l', b'e'] => bytes == 32,
        [.., b'_', b'm', b'i', b'd', b'd', b'l', b'e'] => bytes == 16 || bytes == 32,
        [.., b'_', b'w', b'i', b'd', b'e'] => bytes >= 64,
        b"tables" | b"rounding" => bytes >= 64 || WIDE != 0,
        _ => true,
    }
}

pub const fn has_floats(t: Ty, code: &str) -> bool {
    if option_env!("FLOATS").is_none() || matches!(t, F(_)) {
        return true;
    }
    let mut rest = code.as_bytes();
    while let [_, next @ ..] = rest {
        if let [b'f', b'1', b'6', ..]
        | [b'f', b'3', b'2', ..]
        | [b'f', b'6', b'4', ..]
        | [b'l', b'o', b'a', b't', ..]
        | [b'<', b'h', b'a', b'l', b'f', ..]
        | [b' ', b'h', b'a', b'l', b'f', ..] = rest
        {
            return true;
        }
        rest = next;
    }
    false
}

/// Those that the CPU has and `TARGETS` names.
pub fn targets() -> Vec<Target> {
    use std::io::Write;
    let names = std::env::var("TARGETS").unwrap_or_default();
    let named = |it: &Target| names.is_empty() || names.split(',').any(|name| Target::parse(name) == Some(*it));
    let all: Vec<Target> = if WIDE != 0 || LISTED || option_env!("ALL_TARGETS").is_none() {
        [&[FEW.choose(Target::Portable)], FEW.0].concat()
    } else {
        Target::ALL.to_vec()
    };
    // Not `eprintln!`, which a test that passes doesn't show.
    static TOLD: std::sync::Once = std::sync::Once::new();
    let skipped = all.iter().filter(|&&it| it.includes(it) && !it.is_supported() && named(&it));
    TOLD.call_once(|| drop(writeln!(std::io::stderr(), "not on this CPU: {:?}", skipped.collect::<Vec<_>>())));
    all.into_iter().filter(|it| it.is_supported() && named(it)).collect()
}

/// With all words for tuning or with none, as some operations choose their form by those of the CPU.
pub fn tuned(target: Target, on: bool) -> Target {
    let words: &[&str] = if cfg!(target_arch = "x86_64") {
        &["fast_pdep", "fast_gather", "fast_zmm", "fast_compress_store", "full_zmm"]
    } else if cfg!(target_arch = "aarch64") {
        &["fast_pdep"]
    } else {
        &[]
    };
    // And with the features that operations ask for.
    let asked = cpu_features().filter(|it| it.1 && ["avx512vp2intersect", "sve2-bitperm"].contains(&it.0));
    let asked = asked.map(|it| it.0).filter(|it| it.starts_with("sve") || target.has("avx512f"));
    let all =
        words.iter().copied().chain(asked).fold(target, |all, it| if on { all.with(it) } else { all.without(it) });
    // As Zen 5, or Zen 4.
    if on && option_env!("ZEN").unwrap_or(env!("CARGO_CRATE_NAME")).starts_with("members") {
        all.without("fast_gather")
    } else {
        all
    }
}

pub fn compare(name: &str, t: Ty, bytes: usize, run: Run, model: fn(&Model) -> Lanes, text: Text) {
    let rounds = std::env::var("ROUNDS").map_or(if cfg!(miri) { 1 } else { 200 }, |it| it.parse().unwrap());
    let sweeps = match std::env::var("EXHAUSTIVE") {
        Ok(which) if !which.is_empty() => sweeps(&which, t, bytes, &text),
        _ => vec![(rounds, Box::new(|_, _: &mut Io| {}) as _)],
    };
    let number = |name, or: u64| std::env::var(name).map_or(or, |it| it.parse().unwrap());
    let (part, parts, threads) = (number("PART", 0), number("PARTS", 1), number("THREADS", 1));
    let on =
        |thread| compare_part(name, t, bytes, run, model, &text, &sweeps, part * threads + thread, parts * threads);
    std::thread::scope(|scope| {
        for thread in 1..threads {
            scope.spawn(move || on(thread));
        }
        on(0)
    })
}

#[allow(clippy::too_many_arguments)]
fn compare_part(
    name: &str,
    t: Ty,
    bytes: usize,
    run: Run,
    model: fn(&Model) -> Lanes,
    text: &Text,
    sweeps: &[Sweep],
    part: u64,
    parts: u64,
) {
    let (mut rng, targets, mut out) =
        (Rng(bytes as u64 * 977 + t.bits() as u64 + (part << 32)), targets(), Out::default());
    for (r, change) in
        sweeps.iter().flat_map(|(count, change)| (part..*count).step_by(parts as usize).map(move |r| (r, change)))
    {
        // Other tests in these files look at the CPU.
        if WIDE == 0
            && cfg!(any(target_arch = "x86_64", target_arch = "aarch64"))
            && !matches!(env!("CARGO_CRATE_NAME"), "gaps" | "gaps_more")
        {
            static BOTH: std::sync::LazyLock<[Target; 2]> = std::sync::LazyLock::new(|| {
                let it = cpu();
                [tuned(it, false), tuned(it, true)]
            });
            assert!(set_cpu(BOTH[(r / parts % 2) as usize]));
        }
        let mut io = rng.io(t);
        change(r, &mut io);
        let lanes = |i: usize| t.lanes(&io.bytes[STEP * i..][..bytes]);
        let top = |lanes: &Lanes| lanes.iter().map(|it| it >> (t.bits() - 1) & 1 == 1).collect();
        let (n, a, b, c) = (bytes / t.size(), lanes(0), lanes(1), lanes(2));
        let mut m = Model {
            t,
            n,
            block: n.min(16 / t.size()),
            bytes,
            ma: top(&a),
            mb: top(&b),
            mc: top(&c),
            a,
            b,
            c,
            io: &io,
            target: Target::Portable,
            asked_for_target: true.into(),
        };
        let mut want = vec![];
        for &target in &targets {
            out.0.clear();
            run(target, &io, &mut out).unwrap();
            if m.asked_for_target.replace(text.2.contains("target")) {
                m.target = target;
                want = model(&m);
            }
            let same = |(&(ty, got), &want): (&(Ty, i128), &i128)| {
                want == ANY
                    || got == ty.wrap(want)
                    || ty.is_nan(got) && ty.is_nan(want) && (X87 || !ty.is_signaling(want))
            };
            if out.0.len() != want.len() || !out.0.iter().zip(&want).all(same) {
                let got: Lanes = out.0.iter().map(|it| it.1).collect();
                let want: Lanes =
                    want.iter().zip(&out.0).map(|(&it, got)| if it == ANY { 0 } else { got.0.wrap(it) }).collect();
                panic!(
                    "{name} {t:?} x {n} on {target:?}\n   a {:?}\n   b {:?}\n   c {:?}\n   n {}\n got {got:?}\nwant {want:?}",
                    m.a, m.b, m.c, io.n
                );
            }
        }
    }
}

macro_rules! cases {
    ($($name:ident $types:tt $bytes:expr, |$d:ident, $a:tt, $b:tt, $c:tt, $io:tt| $simd:expr => |$m:ident| $model:expr;)*) => {$(
        #[test]
        fn $name() {
            fn model($m: &Model) -> Lanes { $model }
            const TEXT: Text = Text([stringify!($a), stringify!($b), stringify!($c), stringify!($io)], stringify!($simd), stringify!($model));
            cases!(@types $types $name ($bytes) ($d $a, $b, $c, $io) ($simd));
        }
    )*};
    (@types halves $($r:tt)*) => { cases!(@these [half bf16] $($r)*) };
    (@types $types:tt $($r:tt)*) => { #[cfg(halves)] cases!(@halves $types $($r)*); #[cfg(not(halves))] cases!(@named $types $($r)*); };
    // With `--cfg halves`, what is for all floats runs on those of 16 bits, and the rest doesn't run.
    // Their models know f32 and f64 only. See parts/half.rs.
    (@halves $types:tt mul_add $($r:tt)*) => {};
    (@halves $types:tt fused_all $($r:tt)*) => {};
    (@halves $types:tt alternating $($r:tt)*) => {};
    (@halves $types:tt approximate $($r:tt)*) => {};
    (@halves $types:tt exponent $($r:tt)*) => {};
    (@halves $types:tt mul_by_floor_pow2 $($r:tt)*) => {};
    (@halves $types:tt mul_by_pow2 $($r:tt)*) => {};
    (@halves $types:tt mul_complex $($r:tt)*) => {};
    (@halves $types:tt polynomial_short $($r:tt)*) => {};
    (@halves $types:tt polynomial_long $($r:tt)*) => {};
    (@halves $types:tt polynomial_of_constants $($r:tt)*) => {};
    (@halves $types:tt polynomial_error $($r:tt)*) => {};
    (@halves all $($r:tt)*) => { cases!(@these [half bf16] $($r)*) };
    (@halves sizes $($r:tt)*) => { cases!(@these [bf16] $($r)*) };
    (@halves signed $($r:tt)*) => { cases!(@these [half bf16] $($r)*) };
    (@halves float $($r:tt)*) => { cases!(@these [half bf16] $($r)*) };
    (@halves $($r:tt)*) => {};
    (@named all $($r:tt)*) => { cases!(@these [u8 u16 u32 u64 i8 i16 i32 i64 f32 f64] $($r)*) };
    // One type of each size and kind of register, for operations that only move lanes.
    (@named sizes $($r:tt)*) => { cases!(@these [u8 i16 u32 i64 f32 f64] $($r)*) };
    (@named int $($r:tt)*) => { cases!(@these [u8 u16 u32 u64 i8 i16 i32 i64] $($r)*) };
    (@named uint $($r:tt)*) => { cases!(@these [u8 u16 u32 u64] $($r)*) };
    (@named sint $($r:tt)*) => { cases!(@these [i8 i16 i32 i64] $($r)*) };
    (@named signed $($r:tt)*) => { cases!(@these [i8 i16 i32 i64 f32 f64] $($r)*) };
    (@named float $($r:tt)*) => { cases!(@these [f32 f64] $($r)*) };
    (@named $types:tt $($r:tt)*) => { cases!(@these $types $($r)*) };
    (@these [$($t:ident)*] $name:ident $bytes:tt $args:tt $simd:tt) => { $(cases!(@type $t $name $bytes $args $simd);)* };
    (@type $t:ident $name:ident ($bytes:expr) ($d:ident $a:tt, $b:tt, $c:tt, $io:tt) ($simd:expr)) => {{
        type T = $t;
        const LANE: usize = size_of::<T>();
        const BYTES: core::ops::RangeInclusive<usize> = $bytes;
        #[bun_simd::kernel(targets = OF_CASES)]
        fn case<W: Width>((io, out): (&Io, &mut Out)) {
            let s: S = bun_simd::prelude::isa();
            let $d = s.of::<T, W>();
            #[allow(unused_variables)]
            let ($a, $b, $c, $io) = (io.load($d, 0), io.load($d, 1), io.load($d, 2), io);
            $simd.put(out)
        }
        // rustc goes through all that a dead branch calls, so the types choose.
        struct If<const WANTED: bool>;
        impl If<false> { fn at<W: Width>() {} }
        impl If<true> {
            fn at<W: Width>() {
                let run = const { if WIDE != 0 { (|target, io, out| {
                    let _only = CPU.lock();
                    bun_simd::target::set_cpu(if io.n >> 9 & 1 == 1 { framework::tuned(target, true) } else { target }).then(|| case::<W>((io, out)))
                }) as Run } else { (|target, io, out| case::to::<W>(target, (io, out))) as Run } };
                let result = std::panic::catch_unwind(|| framework::compare(stringify!($name), T::TY, W::BYTES, run, model, TEXT));
                let excused = |why: &String| WIDE != 0 && (why.contains("more_than_64_lanes") || why.contains("512_bytes") || why.contains("too_few_bits") || WIDE == 512 && why.contains("as_many_lanes"));
                if let Err(why) = result && !why.downcast_ref().is_some_and(excused) {
                    std::panic::resume_unwind(why);
                }
            }
        }
        const fn wanted(bytes: usize) -> bool {
            if !framework::has_floats(T::TY, TEXT.1) { return false; }
            if WIDE != 0 { return bytes == *BYTES.end() * WIDE / 64 && *BYTES.start() < *BYTES.end() && framework::in_part(bytes); }
            bytes >= LANE && framework::in_part(bytes) && bytes >= *BYTES.start() && bytes <= *BYTES.end()
        }
        If::<{ wanted(2) }>::at::<B2>(); If::<{ wanted(4) }>::at::<B4>(); If::<{ wanted(8) }>::at::<B8>();
        If::<{ wanted(16) }>::at::<B16>(); If::<{ wanted(32) }>::at::<B32>(); If::<{ wanted(64) }>::at::<B64>();
        If::<{ wanted(128) }>::at::<B128>(); If::<{ wanted(256) }>::at::<B256>(); If::<{ wanted(512) }>::at::<B512>();
    }};
}
