//! SVE on the first 16 bytes of its registers, which are those of NEON.
//!
//! Stable Rust has no types for it, so each operation is one block: it takes and gives registers of NEON, and leaves no predicate.
#![deny(asm_sub_register)]

use crate::Lane;
use crate::simd::{ToBytes, prelude::*};
use core::arch::aarch64::{uint8x16_t, vandq_u8, vcgtq_u16, vcgtq_u32, vcgtq_u64, vdupq_n_u8, vorrq_u8};
use core::marker::PhantomData;
use core::mem::MaybeUninit;

macro_rules! sve { ($($(#[$m:meta])* $vis:vis fn $name:ident($($args:tt)*) $(-> $out:ty)? $body:block)*) => {$(
    $(#[$m])* #[inline] #[target_feature(enable = "neon,sve2")] $vis fn $name($($args)*) $(-> $out)? $body
)*}; }
/// `z{v:q}` is the register of SVE that starts with `v`.
macro_rules! block { ([$($text:expr),+ $(,)?] $($operands:tt)*) => {{
    // SAFETY: each use is in a function of `sve!`, which has SVE2, and the directives only give registers a second name.
    // `pure!`, `up`, `load!` and `store` say what their instructions read and write.
    #[allow(unsafe_code)]
    unsafe { core::arch::asm!(".irp r,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31", r"zq\r .req z\r", ".endr", $($text,)+ $($operands)*, out("p6") _, out("p7") _) }
}}; }
/// `[vectors] [numbers] [vectors that are changed] -> [vectors] [numbers]`
macro_rules! pure { ([$($text:expr),+] [$($a:ident)*] [$($x:ident)*] [$($v:ident)*] -> [$($new:ident)*] [$($n:ident)*]) => {{
    $(let mut $v = up($v);)*
    $(let $new: uint8x16_t;)*
    $(let $n: u64;)*
    // It writes the results, the predicates and the flags only, after it has read all operands. The results depend on the first 16 bytes of these, also for the indices that `look_up` makes.
    block!([$($text),+] $($a = in(vreg) up($a),)* $($x = in(reg) $x as u64,)* $($v = inout(vreg) $v,)* $($new = lateout(vreg) $new,)* $($n = lateout(reg) $n,)*
        options(pure, nomem, nostack));
    ($(u8x16::from($v),)* $(u8x16::from($new),)* $($n as usize,)*)
}}; }
macro_rules! none { ([$($text:expr),+] [$($a:ident)*]) => { pure!([$($text,)+ "cset {n}, eq"] [$($a)*] [] [] -> [] [n]).0 & 1 != 0 }; }
/// The suffix for lanes of `size` bytes, and the predicate for those in 16 bytes.
macro_rules! sized {
    ($size:expr, $of:ident) => {
        match $size {
            1 => $of!(".b", "ptrue p7.b, vl16"),
            2 => $of!(".h", "ptrue p7.h, vl8"),
            4 => $of!(".s", "ptrue p7.s, vl4"),
            _ => $of!(".d", "ptrue p7.d, vl2"),
        }
    };
}
macro_rules! widening {
    ($size:expr, $signed:expr, $of:ident) => {
        match ($size, $signed) {
            (1, false) => $of!("u", ".h", ".b"),
            (2, false) => $of!("u", ".s", ".h"),
            (_, false) => $of!("u", ".d", ".s"),
            (1, _) => $of!("s", ".h", ".b"),
            (2, _) => $of!("s", ".s", ".h"),
            _ => $of!("s", ".d", ".s"),
        }
    };
}
macro_rules! not_zero {
    ($t:literal) => {
        concat!("cmpne p6", $t, ", p7/z, z{mask:q}", $t, ", #0")
    };
}
macro_rules! negative {
    ($t:literal) => {
        concat!("cmplt p6", $t, ", p7/z, z{mask:q}", $t, ", #0")
    };
}
macro_rules! matches {
    ($t:literal) => {
        concat!("match p6", $t, ", p7/z, z{v:q}", $t, ", z{set:q}", $t)
    };
}
macro_rules! count {
    ($t:literal) => {
        concat!("cntp {n}, p7, p6", $t)
    };
}
/// `mov z, p/z, #-1` waits for the old value of the register on Neoverse V2.
macro_rules! select {
    ($t:literal) => {
        concat!("sel z{all:q}", $t, ", p6, z{yes:q}", $t, ", z{no:q}", $t)
    };
}

sve! {
    /// What is after 16 bytes is unspecified, and no result of this file depends on it.
    fn up(v: u8x16) -> uint8x16_t {
        cfg_select! {
            bun_simd_sve_fill => {
                let all;
                // It writes the result and p7.
                block!(["index z{all:q}.b, #-11, #7", "ptrue p7.b, vl16", "mov z{all:q}.b, p7/m, z{v:q}.b"] v = in(vreg) uint8x16_t::from(v), all = out(vreg) all, options(nomem, nostack));
                all
            }
            _ => v.into(),
        }
    }
    fn both() -> (u8x16, u8x16) { (vdupq_n_u8(!0).into(), vdupq_n_u8(0).into()) }
    pub fn first_lanes(n: usize, size: usize) -> u8x16 {
        let (yes, no) = both();
        macro_rules! of { ($t:literal, $p:literal) => { pure!([concat!("whilelo p6", $t, ", xzr, {n}"), select!($t)] [yes no] [n] [] -> [all] []).0 }; }
        sized!(size, of)
    }
    pub fn mask_none(mask: u8x16) -> bool { none!(["ptrue p7.b, vl16", not_zero!(".b")] [mask]) }
    pub fn mask_all(mask: u8x16) -> bool {
        none!(["ptrue p7.b, vl16", "cmpeq p6.b, p7/z, z{mask:q}.b, #0"] [mask])
    }
    pub fn mask_count(mask: u8x16, size: usize) -> usize {
        macro_rules! of { ($t:literal, $p:literal) => { pure!([$p, not_zero!($t), count!($t)] [mask] [] [] -> [] [n]).0 }; }
        sized!(size, of)
    }
    pub fn mask_leading(mask: u8x16, size: usize) -> usize {
        macro_rules! of { ($t:literal, $p:literal) => { pure!([$p, not_zero!($t), "brkb p6.b, p7/z, p6.b", count!($t)] [mask] [] [] -> [] [n]).0 }; }
        sized!(size, of)
    }
    pub fn compact_only(v: u8x16, mask: u8x16, size: usize) -> u8x16 { compacted(v, mask, size, false).0 }
    /// And how many are kept.
    pub fn compact(v: u8x16, mask: u8x16, size: usize, _again: bool) -> (u8x16, usize) { compacted(v, mask, size, true) }
    fn compacted(v: u8x16, mask: u8x16, size: usize, counted: bool) -> (u8x16, usize) {
        macro_rules! of { ($t:literal, $p:literal) => {
            if counted { pure!([$p, not_zero!($t), concat!("compact z{all:q}", $t, ", p6, z{v:q}", $t), count!($t)] [v mask] [] [] -> [all] [n]) }
            else { (pure!([$p, not_zero!($t), concat!("compact z{all:q}", $t, ", p6, z{v:q}", $t)] [v mask] [] [] -> [all] []).0, 0) }
        }; }
        if size == 4 { of!(".s", "ptrue p7.s, vl4") } else { of!(".d", "ptrue p7.d, vl2") }
    }
    /// The lanes before the first that is set, or with it.
    pub fn up_to_first(mask: u8x16, size: usize, with: bool) -> u8x16 {
        let (yes, no) = both();
        macro_rules! of { ($t:literal, $p:literal) => {
            if with { pure!([$p, not_zero!($t), "brka p6.b, p7/z, p6.b", select!($t)] [mask yes no] [] [] -> [all] []).0 }
            else { pure!([$p, not_zero!($t), "brkb p6.b, p7/z, p6.b", select!($t)] [mask yes no] [] [] -> [all] []).0 }
        }; }
        sized!(size, of)
    }
    pub fn mul_high(a: u8x16, b: u8x16, (size, signed): (usize, bool)) -> u8x16 {
        macro_rules! of { ($t:literal, $p:literal) => {
            if signed { pure!([concat!("smulh z{all:q}", $t, ", z{a:q}", $t, ", z{b:q}", $t)] [a b] [] [] -> [all] []).0 }
            else { pure!([concat!("umulh z{all:q}", $t, ", z{a:q}", $t, ", z{b:q}", $t)] [a b] [] [] -> [all] []).0 }
        }; }
        sized!(size, of)
    }
    pub fn mul_wide(a: u8x16, b: u8x16, (size, signed, odd): (usize, bool, bool)) -> u8x16 {
        macro_rules! of { ($s:literal, $wide:literal, $t:literal) => {
            if odd { pure!([concat!($s, "mullt z{all:q}", $wide, ", z{a:q}", $t, ", z{b:q}", $t)] [a b] [] [] -> [all] []).0 }
            else { pure!([concat!($s, "mullb z{all:q}", $wide, ", z{a:q}", $t, ", z{b:q}", $t)] [a b] [] [] -> [all] []).0 }
        }; }
        widening!(size, signed, of)
    }
    fn mul_add_wide(a: u8x16, b: u8x16, sum: u8x16, (size, signed, odd): (usize, bool, bool)) -> u8x16 {
        macro_rules! of { ($s:literal, $wide:literal, $t:literal) => {
            if odd { pure!([concat!($s, "mlalt z{sum:q}", $wide, ", z{a:q}", $t, ", z{b:q}", $t)] [a b] [] [sum] -> [] []).0 }
            else { pure!([concat!($s, "mlalb z{sum:q}", $wide, ", z{a:q}", $t, ", z{b:q}", $t)] [a b] [] [sum] -> [] []).0 }
        }; }
        widening!(size, signed, of)
    }
    /// Of two adjacent lanes.
    pub fn add_products(a: u8x16, b: u8x16, sum: u8x16, (size, signed, add): (usize, bool, bool)) -> u8x16 {
        let even = if add { mul_add_wide(a, b, sum, (size, signed, false)) } else { mul_wide(a, b, (size, signed, false)) };
        mul_add_wide(a, b, even, (size, signed, true))
    }
    /// Of four adjacent lanes of 16 bits.
    pub fn dot(a: u8x16, b: u8x16, sum: u8x16, signed: bool) -> u8x16 {
        if signed { pure!(["sdot z{sum:q}.d, z{a:q}.h, z{b:q}.h"] [a b] [] [sum] -> [] []).0 } else { pure!(["udot z{sum:q}.d, z{a:q}.h, z{b:q}.h"] [a b] [] [sum] -> [] []).0 }
    }
    pub fn divide(a: u8x16, b: u8x16, size: usize) -> u8x16 {
        if size == 4 { pure!(["ptrue p7.s, vl4", "udiv z{a:q}.s, p7/m, z{a:q}.s, z{b:q}.s"] [b] [] [a] -> [] []).0 }
        else { pure!(["ptrue p7.d, vl2", "udiv z{a:q}.d, p7/m, z{a:q}.d, z{b:q}.d"] [b] [] [a] -> [] []).0 }
    }
    /// Zero for a divisor of zero. The least number by -1 wraps.
    pub fn divide_signed(a: u8x16, b: u8x16, size: usize) -> u8x16 {
        if size == 4 { pure!(["ptrue p7.s, vl4", "sdiv z{a:q}.s, p7/m, z{a:q}.s, z{b:q}.s"] [b] [] [a] -> [] []).0 }
        else { pure!(["ptrue p7.d, vl2", "sdiv z{a:q}.d, p7/m, z{a:q}.d, z{b:q}.d"] [b] [] [a] -> [] []).0 }
    }
    /// An index out of range wraps, or gives zero: it becomes the greatest number, which is beyond registers of all lengths.
    pub fn look_up(v: u8x16, at: u8x16, (size, wraps): (usize, bool)) -> u8x16 {
        macro_rules! of { ($t:literal $lanes:ident $above:ident) => {{
            let (at, last) = ($lanes::from_ne_bytes(at), $lanes::repeated(($lanes::LEN - 1) as _));
            let (above, last) = ($lanes::from($above(at.into(), last.into())).to_ne_bytes().into(), last.to_ne_bytes().into());
            let at = u8x16::from(if wraps { vandq_u8(at.to_ne_bytes().into(), last) } else { vorrq_u8(at.to_ne_bytes().into(), above) });
            pure!([concat!("tbl z{all:q}", $t, ", {{z{v:q}", $t, "}}, z{at:q}", $t)] [v at] [] [] -> [all] []).0
        }}; }
        match size {
            2 => of!(".h" u16x8 vcgtq_u16),
            4 => of!(".s" u32x4 vcgtq_u32),
            _ => of!(".d" u64x2 vcgtq_u64),
        }
    }
    /// By all bits of the count.
    pub fn shift_64(v: u8x16, by: u8x16, left: bool) -> u8x16 {
        if left { pure!(["ptrue p7.d, vl2", "lsl z{v:q}.d, p7/m, z{v:q}.d, z{by:q}.d"] [by] [] [v] -> [] []).0 }
        else { pure!(["ptrue p7.d, vl2", "lsr z{v:q}.d, p7/m, z{v:q}.d, z{by:q}.d"] [by] [] [v] -> [] []).0 }
    }
    pub fn match_u8(v: u8x16, set: u8x16) -> u8x16 { let (yes, no) = both(); pure!(["ptrue p7.b, vl16", matches!(".b"), select!(".b")] [v set yes no] [] [] -> [all] []).0 }
    pub fn match_u16(v: u8x16, set: u8x16) -> u8x16 { let (yes, no) = both(); pure!(["ptrue p7.h, vl8", matches!(".h"), select!(".h")] [v set yes no] [] [] -> [all] []).0 }
    pub fn count_u8(v: u8x16, set: u8x16) -> u8x16 { pure!(["histseg z{all:q}.b, z{v:q}.b, z{set:q}.b"] [v set] [] [] -> [all] []).0 }
    pub fn first_match(v: u8x16, set: u8x16) -> Option<usize> {
        if none!(["ptrue p7.b, vl16", matches!(".b")] [v set]) { return None; }
        Some(pure!(["ptrue p7.b, vl16", matches!(".b"), "brkb p6.b, p7/z, p6.b", count!(".b")] [v set] [] [] -> [] [n]).0)
    }
    pub fn leading_zeros_64(v: u8x16) -> u8x16 { pure!(["ptrue p7.d, vl2", "clz z{v:q}.d, p7/m, z{v:q}.d"] [] [] [v] -> [] []).0 }
    /// The lowest 6 bits are 64ths, and those above the biased exponent.
    pub fn power_of_64ths(v: u8x16, bits: u32) -> u8x16 {
        if bits == 32 { pure!(["fexpa z{all:q}.s, z{v:q}.s"] [v] [] [] -> [all] []).0 } else { pure!(["fexpa z{all:q}.d, z{v:q}.d"] [v] [] [] -> [all] []).0 }
    }
    /// The greatest integer for infinity, and the least for zero and NaN.
    pub fn exponent(v: u8x16, bits: u32) -> u8x16 {
        if bits == 32 { pure!(["ptrue p7.s, vl4", "flogb z{v:q}.s, p7/m, z{v:q}.s"] [] [] [v] -> [] []).0 }
        else { pure!(["ptrue p7.d, vl2", "flogb z{v:q}.d, p7/m, z{v:q}.d"] [] [] [v] -> [] []).0 }
    }
    pub fn scale_f32(v: u8x16, by: u8x16) -> u8x16 { pure!(["ptrue p7.s, vl4", "fscale z{v:q}.s, p7/m, z{v:q}.s, z{by:q}.s"] [by] [] [v] -> [] []).0 }
    pub fn scale_f64(v: u8x16, by: u8x16) -> u8x16 { pure!(["ptrue p7.d, vl2", "fscale z{v:q}.d, p7/m, z{v:q}.d, z{by:q}.d"] [by] [] [v] -> [] []).0 }
}

/// A slice of lanes: its address, its length, and the size of a lane.
pub struct Lanes<'a, const WRITE: bool>(*mut u8, usize, usize, PhantomData<&'a mut u8>);

#[inline(always)]
fn size<T>() -> usize {
    const {
        assert!(core::matches!(size_of::<T>(), 1 | 2 | 4 | 8) && align_of::<T>() == size_of::<T>());
        size_of::<T>()
    }
}
macro_rules! memory {
    ($size:expr, $of:ident) => {
        match $size {
            1 => $of!(".b", "1b"),
            2 => $of!(".h", "1h"),
            4 => $of!(".s", "1w"),
            _ => $of!(".d", "1d"),
        }
    };
}
/// The address fills its register. Where it is a number for that, the block gets the pointer too.
macro_rules! at { ($p:ident [$($text:expr),+] $($operands:tt)*) => { cfg_select! {
    target_pointer_width = "64" => { block!([$($text),+] $p = in(reg) $p, $($operands)*) }
    _ => { block!([$($text,)+ "/* {q:w} */"] $p = in(reg) $p.addr() as u64, $($operands)*, q = in(reg) $p) }
} }; }
macro_rules! within {
    ($p:literal, $t:literal) => {
        concat!("whilelo ", $p, $t, ", xzr, {len}")
    };
}
macro_rules! load { ($from:expr, $p:literal [$($and:ident $mask:ident)?] [$($or:ident)?] $out:ident) => {{
    let Lanes(from, len, size, _) = $from;
    let v: uint8x16_t;
    macro_rules! of { ($t:literal, $ld:literal) => { at!(from
        [within!($p, $t), $($and!($t),)? concat!("ld", $ld, " z{v:q}", $t, ", p6/z, [{from}]") $(, concat!("sel z{v:q}", $t, ", p6, z{v:q}", $t, ", z{", stringify!($or), ":q}", $t))?]
        len = in(reg) len as u64, $($mask = in(vreg) up($mask),)? $($or = in(vreg) up($or),)? v = $out(vreg) v, options(pure, readonly, nostack)
    ) }; }
    // Lane `i` is value `i` of the slice, and is read only if `i < len`. The result depends on the first 16 bytes of the slice and of the operands.
    memory!(size, of);
    v.into()
}}; }

impl<'a> Lanes<'a, false> {
    #[inline(always)]
    pub fn of<T: Lane>(from: &'a [T]) -> Self {
        Self(from.as_ptr().cast_mut().cast(), from.len(), size::<T>(), PhantomData)
    }
    sve! {
        /// The rest is zero.
        pub fn load(self) -> u8x16 { load!(self, "p6" [] [] lateout) }
        /// The lanes whose highest bit is set in `mask`.
        pub fn load_masked(self, mask: u8x16) -> u8x16 { load!(self, "p7" [negative mask] [] lateout) }
        pub fn load_or(self, or: u8x16) -> u8x16 { load!(self, "p6" [] [or] out) }
    }
}

impl<'a> Lanes<'a, true> {
    #[inline(always)]
    pub fn of<T: Lane>(to: Result<&'a mut [T], &'a mut [MaybeUninit<T>]>) -> Self {
        let (start, len) = match to {
            Ok(to) => (to.as_mut_ptr().cast(), to.len()),
            Err(to) => (to.as_mut_ptr().cast(), to.len()),
        };
        Self(start, len.min(16 / size::<T>()), size::<T>(), PhantomData)
    }
    sve! {
        pub fn store(self, v: u8x16, mask: Option<u8x16>) {
            let Self(to, len, size, _) = self;
            macro_rules! all { ($t:literal, $st:literal) => { at!(to [within!("p6", $t), concat!("st", $st, " z{v:q}", $t, ", p6, [{to}]")]
                len = in(reg) len as u64, v = in(vreg) up(v), options(nostack)) }; }
            macro_rules! some { ($t:literal, $st:literal) => { at!(to [within!("p7", $t), negative!($t), concat!("st", $st, " z{v:q}", $t, ", p6, [{to}]")]
                len = in(reg) len as u64, mask = in(vreg) up(mask.unwrap_or(v)), v = in(vreg) up(v), options(nostack)) }; }
            // The same for writes, which are of the first 16 bytes. The slice is borrowed uniquely, and all bits are valid in a lane.
            if mask.is_some() { memory!(size, some) } else { memory!(size, all) }
        }
    }
}
