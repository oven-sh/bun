use bun_simd::*;
use framework::*;

/// Some of the operands, without NaN and negative zero.
/// Not vectorized: NEON in 32 bits would take subnormal numbers as zero.
fn values<T: Test>(io: &Io) -> Vec<T> {
    io.slice::<T>()
        .into_iter()
        .take(io.up_to(100))
        .map(std::hint::black_box)
        .map(|it| if it != it || it == T::default() { T::default() } else { it })
        .collect()
}
fn model_values(m: &Model) -> Lanes {
    m.slice().into_iter().take(m.io.up_to(100)).map(|it| if m.t.is_nan(it) || m.t.eq(it, 0) { 0 } else { it }).collect()
}
macro_rules! like_16_bytes { ($d:ident, $a:ident, $b:ident: $($f:ident)*; $($g:ident)*) => {{
    let wide = $d.isa().of::<T, B16>();
    let (x, y, mut all) = ($a.resize::<B16>(), $b.resize::<B16>(), $d.mask_splat(true));
    $(let (got, want) = ($a.$f(), x.$f().resize::<W>()); all &= got.cast_unsigned().simd_eq(want.cast_unsigned()) | got.is_nan() & want.is_nan();)*
    $(let (got, want) = ($a.$g($b), x.$g(y).resize::<W>()); all &= got.cast_unsigned().simd_eq(want.cast_unsigned()) | got.is_nan() & want.is_nan();)*
    all
}}; }

cases! {
    extremes [u8 i64 f32] 0..=64, |d, _, _, _, io| {
        let x = values::<T>(io);
        let or = |it: Option<T>| it.unwrap_or_default();
        let (both, last) = (d.over(&x).min_max(), or(x.last().copied()));
        (vec![or(d.over(&x).min()), or(d.over(&x).max()), or(both.map(|it| it.0)), or(both.map(|it| it.1))],
            ([d.over(&x).position_min(), d.over(&x).position_max(), d.over(&x).position(#[inline(always)] |v| v.simd_eq(last))], d.over(&x).count(#[inline(always)] |v| v.simd_eq(last))))
    } => |m| {
        let x = model_values(m);
        let (min, max) = (x.iter().copied().reduce(|a, b| if m.t.lt(b, a) { b } else { a }), x.iter().copied().reduce(|a, b| if m.t.lt(a, b) { b } else { a }));
        let at = |value| x.iter().position(|&it| Some(it) == value).map_or(-1, |it| it as i128);
        let (low, high) = (min.unwrap_or(0), max.unwrap_or(0));
        vec![low, high, low, high, at(min), at(max), at(x.last().copied()), x.iter().filter(|&it| Some(it) == x.last()).count() as _]
    };
    filters [u8 f64] 0..=64, |d, _, _, _, io| {
        let x = values::<T>(io);
        let (mut copied, mut kept, mut replaced, mut both, mut made) = (x.clone(), x.clone(), x.clone(), x.clone(), x.clone());
        let n = d.over(&x).filter_into(&mut copied[..], #[inline(always)] |v| v.cast_signed().is_negative());
        copied.truncate(n);
        let n = d.over_mut(&mut kept).retain(#[inline(always)] |v| v.cast_signed().is_negative());
        kept.truncate(n);
        d.over_mut(&mut replaced).map(#[inline(always)] |v| v.cast_signed().is_negative().select(T::default(), v));
        d.over(&x).zip(&replaced).map_into(&mut both, #[inline(always)] |(a, b)| a ^ b);
        d.over_mut(&mut both).zip(&x).map(#[inline(always)] |(a, b)| a ^ b);
        d.over_mut(&mut made).fill_with(#[inline(always)] |i| i.bitcast());
        [copied, kept, replaced, both, made].concat()
    } => |m| {
        let (x, top) = (model_values(m), |it: i128| it >> (m.t.bits() - 1) & 1 == 1);
        let (kept, replaced): (Lanes, Lanes) = (x.iter().copied().filter(|&it| top(it)).collect(), x.iter().map(|&it| if top(it) { 0 } else { it }).collect());
        [kept.repeat(2), replaced.repeat(2), (0..x.len() as i128).collect()].concat()
    };
    sum [i16] 0..=64, |d, _, _, _, io| d.over(&values::<T>(io)).sum() => |m| vec![model_values(m).iter().sum()];
    small_floats float 0..=64, |d, _, _, _, io| {
        let (x, mut to) = (io.bytes.map(|it| it as i8 as T), vec![0.0; 5]);
        let n = io.up_to(40);
        d.over(&x[..5 * n]).mat_vec_relaxed(&x[200..][..n], &mut to);
        let v = d.load(&x);
        ((vec![d.over(&x[..n]).zip(&x[100..][..n]).dot_relaxed(), d.over(&x[..n]).sum()], to), [v.prefix_sum(), v.splat_sum(), v.splat_min(), v.splat_max()])
    } => |m| {
        let (x, n) = (m.io.bytes.map(|it| it as i8 as i32), m.io.up_to(40));
        let dot = |a: usize, b: usize| (0..n).map(|i| x[a + i] * x[b + i]).sum::<i32>();
        let v = &x[..m.n];
        [dot(0, 100), x[..n].iter().sum()].into_iter().chain((0..5).map(|row| dot(row * n, 200))).chain((0..m.n).map(|i| v[..=i].iter().sum()))
            .chain([v.iter().sum(), *v.iter().min().unwrap(), *v.iter().max().unwrap()].into_iter().flat_map(|it| vec![it; m.n]))
            .map(|it| m.t.of(it as f64)).collect()
    };
    narrow_math float 0..=8 * (WIDE == 0) as usize, |d, a, b, _, _| like_16_bytes!(d, a, b: exp exp2 exp_m1 ln log2 log10 ln_1p cbrt sin cos tan asin acos atan sinh cosh tanh
        asinh acosh atanh; powf atan2 hypot) => |m| m.mask(|_| true);
    cast_and_store [i16 u32 i64] 4..=64, |d, a, _, _, _| { let mut to = vec![0; d.lanes()]; a.cast::<<T as Int>::Narrow>().store(&mut to); to } => |m| m.a.clone();
}
