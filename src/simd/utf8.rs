//! The check of UTF-8 by Keiser and Lemire, "Validating UTF-8 in less than one instruction per byte". `checked.rs` trusts it.

use crate::{Isa, Over, Simd, Width, WithToken};

const TOO_SHORT: u8 = 1;
const TOO_LONG: u8 = 2;
const OVERLONG_3: u8 = 4;
const TOO_LARGE: u8 = 8;
const SURROGATE: u8 = 16;
const OVERLONG_2: u8 = 32;
const LARGE_OR_OVERLONG_4: u8 = 64;
const TWO_CONTS: u8 = 128;
const CARRY: u8 = TOO_SHORT | TOO_LONG | TWO_CONTS;
const LARGE: u8 = CARRY | TOO_LARGE | LARGE_OR_OVERLONG_4;
const CONT: u8 = TOO_LONG | OVERLONG_2 | TWO_CONTS;

const FIRST_HIGH: [u8; 16] = [
    TOO_LONG,
    TOO_LONG,
    TOO_LONG,
    TOO_LONG,
    TOO_LONG,
    TOO_LONG,
    TOO_LONG,
    TOO_LONG,
    TWO_CONTS,
    TWO_CONTS,
    TWO_CONTS,
    TWO_CONTS,
    TOO_SHORT | OVERLONG_2,
    TOO_SHORT,
    TOO_SHORT | OVERLONG_3 | SURROGATE,
    TOO_SHORT | TOO_LARGE | LARGE_OR_OVERLONG_4,
];
const FIRST_LOW: [u8; 16] = [
    CARRY | OVERLONG_3 | OVERLONG_2 | LARGE_OR_OVERLONG_4,
    CARRY | OVERLONG_2,
    CARRY,
    CARRY,
    CARRY | TOO_LARGE,
    LARGE,
    LARGE,
    LARGE,
    LARGE,
    LARGE,
    LARGE,
    LARGE,
    LARGE,
    LARGE | SURROGATE,
    LARGE,
    LARGE,
];
const SECOND_HIGH: [u8; 16] = [
    TOO_SHORT,
    TOO_SHORT,
    TOO_SHORT,
    TOO_SHORT,
    TOO_SHORT,
    TOO_SHORT,
    TOO_SHORT,
    TOO_SHORT,
    CONT | OVERLONG_3 | LARGE_OR_OVERLONG_4,
    CONT | OVERLONG_3 | TOO_LARGE,
    CONT | SURROGATE | TOO_LARGE,
    CONT | SURROGATE | TOO_LARGE,
    TOO_SHORT,
    TOO_SHORT,
    TOO_SHORT,
    TOO_SHORT,
];
const COMPLETE: [u8; 64] = {
    let mut max = [0xff; 64];
    (max[61], max[62], max[63]) = (0xef, 0xdf, 0xbf);
    max
};

/// Not zero where a byte doesn't fit the three before it.
#[op]
fn errors<S: Isa>(v: Simd<u8, S::Native, S>, [p1, p2, p3]: [Simd<u8, S::Native, S>; 3]) -> Simd<u8, S::Native, S> {
    let special = (p1 >> 4).lookup(&FIRST_HIGH) & p1.lookup(&FIRST_LOW) & (v >> 4).lookup(&SECOND_HIGH);
    (p2.saturating_sub(0xe0 - 0x80) | p3.saturating_sub(0xf0 - 0x80)) & 0x80 ^ special
}

/// What was seen so far, in registers.
#[derive(Copy, Clone)]
pub(crate) struct Check<S: Isa> {
    before: Simd<u8, S::Native, S>,
    errors: Simd<u8, S::Native, S>,
}

const ARRAYS: bool = crate::simd::ARRAYS && !cfg!(miri);

impl<S: Isa> Check<S> {
    /// Without an instruction for lookups, `core` is faster.
    const SLOW: bool = S::PORTABLE && !S::LOOKS_UP_IN_REGISTERS && !S::BY_HAND;

    #[op]
    pub(crate) fn new(s: S) -> Self {
        const { assert!(matches!(S::Native::BYTES, 16 | 32 | 64) && (Self::SLOW || !ARRAYS)) };
        Self { before: s.zero(), errors: s.zero() }
    }
    #[op]
    fn register(&mut self, v: Simd<u8, S::Native, S>) {
        let before = self.before;
        let found = errors(
            v,
            [
                v.shift_elements_right::<1>(before),
                v.shift_elements_right::<2>(before),
                v.shift_elements_right::<3>(before),
            ],
        );
        (self.before, self.errors) = (v, self.errors | found);
    }
    /// ASCII can follow all but a character that isn't complete.
    #[op]
    fn ascii(&mut self) {
        let s = self.before.isa();
        (self.errors, self.before) = (self.errors | self.before.saturating_sub(s.load_last(&COMPLETE)), s.zero());
    }
    #[op]
    pub(crate) fn block(&mut self, v: Simd<u8, crate::B64, S>) {
        if const { Self::SLOW } {
            return;
        }
        if v.cast_signed().is_negative().none() {
            return self.ascii();
        }
        let [lower, upper] = v.split();
        match S::Native::BYTES {
            64 => self.register(v.resize()),
            32 => {
                self.register(lower.resize());
                self.register(upper.resize())
            }
            _ => {
                let ([a, b], [c, d]) = (lower.split(), upper.split());
                self.register(a.resize());
                self.register(b.resize());
                self.register(c.resize());
                self.register(d.resize())
            }
        }
    }
    #[op]
    fn read(&self, both: &[u8], i: usize) -> Simd<u8, S::Native, S> {
        self.before.isa().load(&both[i..])
    }
    /// `register` for the bytes from `i` on. Those before them were seen last. Loads take less time than shifts.
    #[op]
    fn loaded(&mut self, both: &[u8], i: usize) {
        let v = self.read(both, i);
        let found = errors(v, [self.read(both, i - 1), self.read(both, i - 2), self.read(both, i - 3)]);
        (self.before, self.errors) = (v, self.errors | found);
    }
    /// `block` for the second 64 bytes. The first were seen last.
    #[op]
    fn second(&mut self, both: &[u8]) {
        // LLVM would take the other loads out of a vector of several registers, byte by byte.
        let all = match S::Native::BYTES {
            64 => self.read(both, 64),
            32 => self.read(both, 64) | self.read(both, 96),
            _ => self.read(both, 64) | self.read(both, 80) | (self.read(both, 96) | self.read(both, 112)),
        };
        if all.cast_signed().is_negative().none() {
            return self.ascii();
        }
        self.loaded(both, 64);
        match S::Native::BYTES {
            64 => {}
            32 => self.loaded(both, 96),
            _ => {
                self.loaded(both, 80);
                self.loaded(both, 96);
                self.loaded(both, 112)
            }
        }
    }
    /// Only if all that was seen, and then `rest`, is UTF-8.
    #[op]
    pub(crate) fn ends_with(mut self, rest: &[u8]) -> bool {
        if const { Self::SLOW } {
            return false;
        }
        let s = self.before.isa();
        if const { S::PARTIAL || S::AVX2 } && rest.len() < S::Native::BYTES {
            return self.last(rest);
        }
        let Some(first) = s.over(rest).position(
            #[inline(always)]
            |v| v.cast_signed().is_negative(),
        ) else {
            self.ascii();
            return self.errors == 0;
        };
        // By a branch, so that the loads don't wait for the index.
        let mut skip = 0;
        if first >= 64 {
            self.ascii();
            skip = first & !63;
        }
        let mut rest = &rest[skip..];
        while let Some(block) = rest.first_chunk::<64>() {
            self.block(s.from(block));
            // Only long texts make up for the start of another loop.
            let mut least = 256;
            if rest.len() >= 1280 {
                // In pieces of 1 KiB.
                if self.errors != 0 {
                    return false;
                }
                least = rest.len() - 1024;
            }
            while rest.len() >= least {
                self.second(rest);
                rest = &rest[64..];
            }
            rest = &rest[64..];
        }
        let (whole, rest) = s.over(rest).exact();
        for v in whole {
            self.register(v);
        }
        self.last(rest)
    }
    /// `rest` is shorter than a register, so at least one zero comes after it.
    #[op]
    fn last(mut self, rest: &[u8]) -> bool {
        let v = self.before.isa().load_or_default(rest);
        if v.cast_signed().is_negative().none() {
            self.ascii()
        } else {
            self.register(v)
        }
        self.errors == 0
    }
}

impl<'a, W: Width, S: Isa> Over<'a, u8, W, S> {
    /// `str::from_utf8`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(over("né".as_bytes()).to_str(), Ok("né"));
    /// assert_eq!(over(b"n\xe9").to_str().unwrap_err().valid_up_to(), 1);
    /// # } example()
    /// ```
    #[doc(alias("from_utf8", "validate_utf8", "is_utf8"))]
    #[inline(always)]
    pub fn to_str(self) -> Result<&'a str, core::str::Utf8Error> {
        self.utf8().finish()
    }
    /// The bytes, 64 at a time, which are checked on the way. It doesn't stop at an error: `finish` tells. It saves a pass over what doesn't fit the caches. Else take `to_str`.
    #[op]
    pub fn utf8(self) -> crate::text::Utf8<'a, S> {
        let (s, bytes) = self.parts();
        crate::text::Utf8::new(s, bytes)
    }
}

/// `EVERY_LANE=1` puts each window in each lane, and `EVERY_TARGET=1` takes all combinations.
#[cfg(test)]
mod proof {
    extern crate std;
    use super::*;
    use crate::{Named, Target, target::dispatch_to as to};
    use std::{collections::HashSet, vec, vec::Vec};

    /// What a lane says of the byte `v`, after the bytes `p3`, `p2` and `p1`.
    fn bad(p3: u8, p2: u8, p1: u8, v: u8) -> bool {
        let special = FIRST_HIGH[p1 as usize >> 4] & FIRST_LOW[p1 as usize & 15] & SECOND_HIGH[v as usize >> 4];
        ((p2 >= 0xe0 || p3 >= 0xf0) as u8) << 7 != special
    }

    /// Table 3-7 of the Unicode Standard.
    #[allow(clippy::manual_range_contains)]
    fn ill_formed(p3: u8, p2: u8, p1: u8, v: u8) -> bool {
        (p1 >= 0xc0 || p2 >= 0xe0 || p3 >= 0xf0) != (0x80 <= v && v <= 0xbf)
            || p1 == 0xc0
            || p1 == 0xc1
            || p1 >= 0xf5
            || p1 == 0xe0 && v < 0xa0
            || p1 == 0xed && v > 0x9f
            || p1 == 0xf0 && v < 0x90
            || p1 == 0xf4 && v > 0x8f
    }

    #[crate::simd]
    #[inline(never)]
    fn all_windows<S: Isa>(s: S, step: usize) -> bool {
        let n = S::Native::BYTES;
        // All four bytes differ from those of the lanes next to them.
        let rows = |f: &dyn Fn(u8, u8) -> u8, by: u8| -> Vec<Vec<u8>> {
            (0..=255u8)
                .map(|it| (0..512).map(|i| f(it.wrapping_add(by.wrapping_mul(i as u8)), i as u8)).collect())
                .collect()
        };
        let [b1, b2, b3] = [37, 91, 53].map(|by| rows(&|it, _| it, by));
        let (long2, long3) = (rows(&|it, _| (it >= 0xe0) as u8, 91), rows(&|it, _| (it >= 0xf0) as u8, 53));
        let (short, long) = (rows(&|p1, v| bad(0, 0, p1, v) as u8, 37), rows(&|p1, v| bad(0, 0xe0, p1, v) as u8, 37));
        let bytes: Vec<u8> = (0..512).map(|i| i as u8).collect();
        let mut wrong = s.zero::<u8, S::Native>();
        for [p1, p2, p3, _] in (0..1u32 << 24).map(u32::to_le_bytes) {
            for at in (0..256).step_by(step.min(n)) {
                let load = always!(|rows: &[Vec<u8>], row: u8| s.load::<u8, S::Native>(&rows[row as usize][at..]));
                let is_long = load(&long2, p2) | load(&long3, p3);
                let wanted = load(&long, p1) & is_long | load(&short, p1) & !is_long;
                wrong |=
                    errors(s.load(&bytes[at..]), [load(&b1, p1), load(&b2, p2), load(&b3, p3)]).simd_min(1) ^ wanted;
            }
            let mut last = [0x80; 64];
            last[61..].copy_from_slice(&[p3, p2, p1]);
            // The test that stands in for ASCII.
            let mut check = Check { before: s.load_last(&last), errors: s.zero() };
            check.ascii();
            assert!((check.errors == 0) == (p3 <= 0xef && p2 <= 0xdf && p1 <= 0xbf));
        }
        wrong == 0
    }

    /// A list has up to 16 targets.
    struct Part<const P: usize>;
    impl<const P: usize> crate::Kernel<(usize,)> for Part<P> {
        type Output = bool;
        const TARGETS: crate::Targets = crate::Targets(&{
            let (mut part, mut i) = ([Target::Portable; 15], 0);
            while i < 15 && 15 * P + i < Named::NATIVE.len() {
                (part[i], i) = (Target::of(Named::NATIVE[15 * P + i], &[]), i + 1);
            }
            part
        });
        fn run<S: Isa>(s: S, (step,): (usize,)) -> bool {
            all_windows(s, step)
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    #[cfg_attr(target_family = "wasm", ignore = "it takes threads")]
    fn lanes_are_right_for_all_windows() {
        let step = if std::env::var_os("EVERY_LANE").is_some() { 1 } else { 64 };
        let every = std::env::var_os("EVERY_TARGET").is_some();
        let parts = [to::<Part<0>, _>, to::<Part<1>, _>, to::<Part<2>, _>, to::<Part<3>, _>, to::<Part<4>, _>];
        std::thread::scope(|scope| {
            for target in Target::combinations().filter(|it| every || Target::ALL.contains(it)) {
                scope.spawn(move || {
                    assert_eq!(
                        parts.iter().find_map(|to| to(target, (step,))),
                        target.is_supported().then_some(true),
                        "{target:?}"
                    )
                });
            }
        });
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn what_is_ill_formed_is_bad() {
        assert!(
            (0..=u32::MAX)
                .map(u32::to_le_bytes)
                .all(|[v, p1, p2, p3]| bad(p3, p2, p1, v) || !ill_formed(p3, p2, p1, v))
        );
    }

    /// Follows all texts in which no window is bad. A state has the last three bytes, as far as `bad` tells them apart, and the
    /// bytes since the last whole character, or nothing if `core` has found an error.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn no_bad_window_means_utf8() {
        let start = ([0u8; 3], Some(Vec::new()));
        let (mut seen, mut todo) = (HashSet::from([start.clone()]), vec![start]);
        while let Some(([p3, p2, p1], open)) = todo.pop() {
            assert_eq!(!bad(p3, p2, p1, 0), open == Some(Vec::new()));
            for v in 0..=255 {
                let open =
                    open.clone().map(|it| [it, vec![v]].concat()).and_then(|it| match core::str::from_utf8(&it) {
                        Ok(_) => Some(Vec::new()),
                        Err(error) => error.error_len().is_none().then_some(it),
                    });
                if bad(p3, p2, p1, v) {
                    assert!(open.is_none());
                    continue;
                }
                let next = ([if p2 >= 0xf0 { 0xf0 } else { 0 }, if p1 >= 0xe0 { p1 & 0xf0 } else { 0 }, v], open);
                if seen.insert(next.clone()) {
                    todo.push(next);
                }
            }
        }
    }
}
