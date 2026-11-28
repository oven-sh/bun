//! An empty `asm!` block. It changes no value, but the code that LLVM makes.

/// LLVM knows nothing about `$value` afterwards but `$holds`, which has to be true of it before.
#[allow(unused_macros)]
macro_rules! forget { ($class:ident, $value:ident, $holds:expr $(, after $other:ident $text:literal)?) => {
    // SAFETY: there is no instruction, so the value is what it was. `$holds` is `true` but in `below!`, where `0 < n <= len`
    // and no index is above `len - n`.
    #[allow(unsafe_code, asm_sub_register)]
    unsafe {
        core::arch::asm!("/* {0} */", $($text,)? inout($class) $value, $(in($class) $other,)? options(pure, nomem, nostack, preserves_flags));
        core::hint::assert_unchecked($holds);
    }
}; }

/// For speed: hides how many rounds a loop has.
#[inline(always)]
#[allow(unused_mut)]
pub(crate) fn count(all: usize) -> usize {
    let mut n = all;
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64", target_arch = "aarch64"), not(miri)))]
    forget!(reg, n, true);
    n.min(all)
}

/// For speed: hides where a number comes from.
#[inline(always)]
#[allow(unused_mut)]
pub(crate) fn number(mut bits: u64) -> u64 {
    #[cfg(all(target_arch = "x86_64", not(miri)))]
    if !is_known!(bits) {
        forget!(reg, bits, true);
    }
    bits
}

/// The same, also for constants.
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), not(miri)))]
#[inline(always)]
#[allow(unused_mut)]
pub(crate) fn bound(n: u64) -> u64 {
    let (mut low, mut high) = (n as usize, (n >> 32 >> (usize::BITS - 32)) as usize);
    #[cfg(not(miri))]
    forget!(reg, low, true);
    #[cfg(all(target_pointer_width = "32", not(miri)))]
    forget!(reg, high, true);
    low as u64 | (high as u64) << 32
}
/// The same, but for the constant that has all lanes.
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)))]
#[inline(always)]
pub(crate) fn lanes_within(bits: u64, lanes: usize) -> u64 {
    if is_known!(bits) && bits == !0 >> (64 - lanes) { bits } else { bound(bits) }
}

/// Whether `in_mask` is used.
pub(crate) const MASKS: bool =
    cfg!(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)));
/// The same bits.
#[inline(always)]
pub(crate) fn word(bits: u64) -> u64 {
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), not(miri)))]
    let bits = if is_known!(bits) { bits } else { bound(bits) };
    bits
}
#[inline(always)]
pub(crate) fn may_be_known(bits: u64) -> bool {
    !crate::OPTIMIZED || is_known!(bits)
}
/// The lower lanes.
#[inline(always)]
#[allow(unused_mut)]
pub(crate) fn some_lanes(mut bits: u64, lanes: usize) -> u64 {
    let all = !0 >> (64 - lanes);
    #[cfg(all(target_arch = "x86_64", not(miri)))]
    if may_be_known(bits & all) && bits & all != 0 && bits & all != all {
        forget!(reg, bits, true);
    }
    #[cfg(all(target_arch = "x86", target_feature = "sse2", not(miri)))]
    if may_be_known(bits & all) && bits & all != 0 && bits & all != all {
        bits = bound(bits);
    }
    bits & all
}
macro_rules! masks { ($($name:ident $t:ident)*) => {$(
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)))]
    #[inline]
    #[target_feature(enable = "avx512bw")]
    #[allow(unused_mut)]
    pub(crate) fn $name(mut bits: $t) -> $t {
        #[cfg(not(miri))]
        forget!(kreg, bits, true);
        bits
    }
)*}; }
masks! { mask8 u8 mask16 u16 mask32 u32 }
/// The bits of that many lanes are the same.
#[inline(always)]
#[allow(unused_variables)]
pub(crate) fn in_mask<S: crate::simd::Cpu>(bits: u64, lanes: usize) -> u64 {
    cfg_select! {
        all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)) => {
            if is_known!(bits) { bits } else { crate::simd::in_mask::<S>(bits, lanes) }
        }
        _ => bits,
    }
}

/// These hide where a vector comes from, or that it is a constant.
macro_rules! x86 { ($($name:ident $t:ident $class:ident $feature:literal)*) => {$(
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
    #[inline]
    #[target_feature(enable = $feature)]
    #[allow(unused_mut)]
    pub(crate) fn $name(v: crate::simd::$t) -> crate::simd::$t {
        let mut v = v.0;
        #[cfg(not(miri))]
        forget!($class, v, true);
        crate::simd::$t::of(v)
    }
)*}; }
x86! { xmm u8x16 xmm_reg "sse2" ymm u8x32 ymm_reg "avx" zmm u8x64 zmm_reg "avx512f" }

/// Whether `vector16` hides a vector in its register.
pub(crate) const VECTORS: bool =
    cfg!(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)));
#[inline(always)]
#[allow(unused_mut)]
pub(crate) fn vector16(mut v: crate::simd::u8x16) -> crate::simd::u8x16 {
    cfg_select! {
        miri => {}
        all(target_arch = "aarch64", target_feature = "neon", target_endian = "little") => {
            let mut reg = v.0;
            forget!(vreg, reg, true);
            v.0 = reg;
        }
        _ => {}
    }
    v
}

/// What uses the result comes after what makes `other`.
#[inline(always)]
#[allow(unused_mut, unused_variables)]
pub(crate) fn after(mut v: crate::simd::u8x16, other: crate::simd::u8x16) -> crate::simd::u8x16 {
    #[cfg(all(
        target_arch = "aarch64",
        target_feature = "neon",
        target_endian = "little",
        not(target_vendor = "apple"),
        not(miri)
    ))]
    {
        let (mut reg, other) = (v.0, other.0);
        forget!(vreg, reg, true, after other "/* {1} */");
        v.0 = reg;
    }
    v
}

/// The same value. `other` should be in a register anyway.
#[inline(always)]
#[allow(unused_mut, unused_variables)]
pub(crate) fn beside(mut x: u64, other: usize) -> u64 {
    #[cfg(all(any(target_arch = "x86_64", target_arch = "aarch64"), not(miri)))]
    forget!(reg, x, true, after other "/* {1} */");
    x
}

/// Whether the functions below pay.
pub(crate) const PAIRS: bool =
    cfg!(all(any(target_arch = "x86_64", target_arch = "aarch64"), target_endian = "little"));
/// In the form of the checks that it replaces.
#[inline(always)]
fn fits(at: u32, len: usize, n: usize) -> bool {
    ((at as usize) < len) & (len.wrapping_sub(at as usize) >= n)
}
macro_rules! below { ($($name:ident $bytes:ident $lanes:ident $pairs:ident)*) => {$(
    /// Each index of 32 bits, or `len - n` if that is less. LLVM doesn't see by itself that lanes are in bounds, and would
    /// undo that they leave the vector two at a time. It is for speed.
    #[inline(always)]
    pub(crate) fn $name<S: crate::simd::Cpu>(indices: crate::simd::$bytes, len: usize, n: usize) -> [usize; 16] where crate::simd::Here: crate::simd::In<S> {
        use crate::simd::{ToBytes, $lanes, $pairs};
        assert!(0 < n && n <= len);
        let last = (len - n).min(u32::MAX as usize) as u32;
        let pairs = $pairs::from_ne_bytes($lanes::from_ne_bytes(indices).simd_min($lanes::splat(last)).to_ne_bytes()).to_array();
        let (mut at, mut i) = ([0; 16], 0);
        while i < pairs.len() {
            #[allow(unused_mut)]
            let mut pair = pairs[i];
            #[cfg(all(any(target_arch = "x86_64", target_arch = "aarch64"), not(miri)))]
            forget!(reg, pair, fits(pair as u32, len, n) & fits((pair >> 32) as u32, len, n));
            (at[2 * i], at[2 * i + 1]) = (pair as u32 as usize, (pair >> 32) as u32 as usize);
            i += 1;
        }
        at
    }
)*}; }
below! { below16 u8x16 u32x4 u64x2 below32 u8x32 u32x8 u64x4 below64 u8x64 u32x16 u64x8 }

/// Keeps LLVM from joining operations on lanes in an instruction of NEON (rust-lang/rust#129880). Stable Rust doesn't tell whether there is NEON or VFP.
#[cfg(target_arch = "arm")]
#[inline(always)]
#[allow(unused_mut)]
pub(crate) fn single(mut x: f32) -> f32 {
    cfg_select! {
        any(miri, target_feature = "mclass", target_feature = "soft-float") => {}
        any(target_feature = "vfp2", all(target_abi = "eabihf", not(any(target_os = "none", target_os = "nuttx")))) => {
            if !is_known!(x) {
                forget!(sreg, x, true);
            }
        }
        _ => {
            let mut bits = x.to_bits();
            forget!(reg, bits, true);
            x = f32::from_bits(bits);
        }
    }
    x
}

/// The same number.
#[inline(always)]
#[allow(unused_mut)]
pub(crate) fn chosen(mut x: u64) -> u64 {
    #[cfg(all(any(target_arch = "s390x", target_arch = "loongarch64"), not(any(target_feature = "lsx", miri))))]
    forget!(reg, x, true);
    x
}

/// The same value.
#[inline(always)]
#[allow(unused_mut)]
pub(crate) fn scalar(mut x: u64) -> u64 {
    #[cfg(all(target_arch = "powerpc64", not(miri)))]
    if !is_known!(x) {
        forget!(reg, x, true);
    }
    x
}
