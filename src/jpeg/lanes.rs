//! For DCTs written as one lane of libjpeg-turbo's assembly, which the compiler turns into vectors, a lane per column.

/// psrad by `shift` of a sum that has the rounding in it already, and packssdw.
#[inline(always)]
pub(crate) fn descale(sum: i32, shift: u32) -> i16 {
    (sum >> shift).clamp(-32768, 32767) as i16
}

/// pmaddwd. With the constants of the DCTs the sum of the two products cannot overflow.
#[inline(always)]
pub(crate) fn madd(a: i16, ca: i32, b: i16, cb: i32) -> i32 {
    i32::from(a) * ca + i32::from(b) * cb
}

/// A matrix whose column `lane` is `column(lane)`. Vectorized only alone in a function: callers are `#[inline(never)]`.
#[inline(always)]
pub(crate) fn from_columns<T: Copy + Default, const R: usize, const C: usize>(
    column: impl Fn(usize) -> [T; R],
) -> [[T; C]; R] {
    let mut out = [[T::default(); C]; R];
    for lane in 0..C {
        for (row, v) in out.iter_mut().zip(column(lane)) {
            if let Some(out) = row.get_mut(lane) {
                *out = v;
            }
        }
    }
    out
}

/// `array::map`, which is not always inlined.
#[inline(always)]
pub(crate) fn map<A: Copy, B: Copy + Default, const N: usize>(
    array: [A; N],
    f: impl Fn(A) -> B,
) -> [B; N] {
    let mut out = [B::default(); N];
    for (out, v) in out.iter_mut().zip(array) {
        *out = f(v);
    }
    out
}

/// Column `lane`.
#[inline(always)]
pub(crate) fn column<T: Copy + Default, const R: usize, const C: usize>(
    m: &[[T; C]; R],
    lane: usize,
) -> [T; R] {
    let mut out = [T::default(); R];
    for (out, row) in out.iter_mut().zip(m) {
        *out = row.get(lane).copied().unwrap_or_default();
    }
    out
}

/// What does not fit in the result is left out, and what is not there is 0. Columns by fours make better vector code.
#[inline(never)]
pub(crate) fn transpose<
    T: Copy + Default,
    const R: usize,
    const C: usize,
    const R2: usize,
    const C2: usize,
>(
    m: &[[T; C]; R],
) -> [[T; C2]; R2] {
    let mut out = [[T::default(); C2]; R2];
    for (r, row) in m.iter().enumerate() {
        for (out, &v) in out.iter_mut().zip(row) {
            if let Some(out) = out.get_mut(r) {
                *out = v;
            }
        }
    }
    out
}
