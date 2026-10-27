//! Eight numbers at a time, named after the x86 instructions that do the same, in a form that compilers turn back into
//! vector code.

pub(crate) type I16x8 = [i16; 8];
pub(crate) type I32x8 = [i32; 8];

#[inline(always)]
pub(crate) fn zip<A: Copy, B: Copy, C: Copy + Default, const N: usize>(
    a: [A; N],
    b: [B; N],
    f: impl Fn(A, B) -> C,
) -> [C; N] {
    let mut out = [C::default(); N];
    for ((out, a), b) in out.iter_mut().zip(a).zip(b) {
        *out = f(a, b);
    }
    out
}

/// pmullw
#[inline(always)]
pub(crate) fn mul16(a: I16x8, b: I16x8) -> I16x8 {
    zip(a, b, i16::wrapping_mul)
}

/// paddw
#[inline(always)]
pub(crate) fn add16(a: I16x8, b: I16x8) -> I16x8 {
    zip(a, b, i16::wrapping_add)
}

/// psubw
#[inline(always)]
pub(crate) fn sub16(a: I16x8, b: I16x8) -> I16x8 {
    zip(a, b, i16::wrapping_sub)
}

/// punpck[lh]wd and pmaddwd: `a * ca + b * cb`. With these constants the sum cannot overflow.
#[inline(always)]
pub(crate) fn madd(a: I16x8, ca: i32, b: I16x8, cb: i32) -> I32x8 {
    zip(a, b, |a, b| i32::from(a) * ca + i32::from(b) * cb)
}

/// paddd
#[inline(always)]
pub(crate) fn add32(a: I32x8, b: I32x8) -> I32x8 {
    zip(a, b, i32::wrapping_add)
}

/// psubd
#[inline(always)]
pub(crate) fn sub32(a: I32x8, b: I32x8) -> I32x8 {
    zip(a, b, i32::wrapping_sub)
}

/// Sign extension and pslld.
#[inline(always)]
pub(crate) fn widen_shl(a: I16x8, n: u32) -> I32x8 {
    a.map(|a| i32::from(a) << n)
}

/// paddd with the rounding constant, psrad and packssdw.
#[inline(always)]
pub(crate) fn descale(a: I32x8, n: u32) -> I16x8 {
    a.map(|a| (a.wrapping_add(1 << (n - 1)) >> n).clamp(-32768, 32767) as i16)
}

#[inline(always)]
pub(crate) fn transpose<T: Copy + Default, const R: usize, const C: usize>(
    m: &[[T; C]; R],
) -> [[T; R]; C] {
    let mut out = [[T::default(); R]; C];
    for (r, row) in m.iter().enumerate() {
        for (out, &v) in out.iter_mut().zip(row) {
            if let Some(out) = out.get_mut(r) {
                *out = v;
            }
        }
    }
    out
}
