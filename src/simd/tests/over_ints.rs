#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![allow(unused_variables, unused_imports)]
#![allow(clippy::unnecessary_mut_passed)]
include!("framework/over.rs");

macro_rules! ints { ($($name:ident |$s:ident, $x:ident, $y:ident, $one:ident, $odd:ident, $over:ident, $len:ident, $kept:ident| $body:block)*) => {
    $(#[kernel(targets = bun_simd::target::Targets::ALL)]
    fn $name<T: Int, W: Width>($x: &[T], $y: &[T], _width: W) {
        let $s: S = bun_simd::prelude::isa();
        let ($one, $odd, $over, $len) = (T::of::<1>(), |it: &T| it.to_u64() & 1 == 1, $s.over($x).by::<W>(), $x.len());
        let $kept: Vec<T> = $x.iter().copied().filter($odd).collect();
        $body
    })*
    fn ints<T: Int, W: Width>(x: &[T], y: &[T], width: W) { $($name(x, y, width);)* }
}; }
ints! {
zips |s, x, y, one, odd, over, len, kept| {
    // Two slices.
    assert_eq!(over.zip(&y[..len / 2]).position(|(a, b)| a.simd_eq(b)), x.iter().zip(&y[..len / 2]).position(|(a, b)| a == b));
    assert_eq!(over.zip(y).position(|(a, b)| a.simd_ne(b)), x.iter().zip(y).position(|(a, b)| a != b));
    assert_eq!(over.zip(x).position(|(a, b)| a.simd_ne(b)), None);
    assert_eq!(over.zip_scaled::<T, _>(y).position(|(a, b)| a.simd_lt(b.resize::<W>())), x.iter().zip(y).position(|(a, b)| a < b));
    let mut to = vec![T::Unsigned::default(); len];
    over.zip(y).map_into(&mut to, |(a, b)| (a ^ b).cast_unsigned());
    assert!((0..len).all(|i| to[i] == Lane::from_u64((x[i] ^ y[i]).to_u64())));
    let mut changed = x.to_vec();
    s.over_mut(&mut changed).by::<W>().zip(y).map(|(a, b)| a & b);
    assert!((0..len).all(|i| changed[i] == x[i] & y[i]));
}
folds |s, x, y, one, odd, over, len, kept| {
    let xor = |all: &mut dyn Iterator<Item = T>| all.fold(T::default(), |a, b| a ^ b);
    let zero = s.zero::<T, W>();
    assert_eq!(xor(&mut over.fold(zero, |a, v| a ^ v, |a, b| a ^ b).to_array().into_iter()), xor(&mut x.iter().copied()));
    // All four start as `init`, and there is no vector of padding alone.
    let vectors = T::from_u64(len.div_ceil(zero.to_array().as_ref().len()) as u64 + 4);
    assert!(over.fold(zero + one, |a, _| a + one, |a, b| a + b) == vectors && over.zip(x).fold(zero + one, |a, (_, _)| a + one, |a, b| a + b) == vectors);
    assert_eq!(over.pad(T::MAX).fold(s.splat::<T, W>(T::MAX), |a, v| a.simd_min(v), |a, b| a.simd_min(b)).reduce_min(), over.min().unwrap_or(T::MAX));
    let both = over.zip(y).fold(zero, |s, (a, b)| s ^ a & b, |a, b| a ^ b);
    assert_eq!(xor(&mut both.to_array().into_iter()), xor(&mut x.iter().zip(y).map(|(&a, &b)| a & b)));
}
filters |s, x, y, one, odd, over, len, kept| {
    // An output with no more room than what is kept.
    for room in [kept.len(), len + 64] {
        let mut memory = vec![MaybeUninit::uninit(); room + 1];
        let mut out = Output::new(&mut memory);
        out.push_one(one);
        assert_eq!(over.filter_into(&mut out, |v| v.all_bits(one)), kept.len());
        assert_eq!(out.filled()[1..], kept);
    }
}
fickle |s, x, y, one, odd, over, len, kept| {
    // The values change between two loads, as if another thread wrote them.
    let mut copy = vec![T::default(); len];
    let cells = Cell::from_mut(&mut copy[..]).as_slice_of_cells();
    let (over, looks, fill) = (s.over(cells).by::<W>(), Cell::new(0), |to: T| cells.iter().for_each(|it| it.set(to)));
    for look in 0..12 {
        let now = |v: Simd<T, W, S>| { if looks.replace(looks.get() + 1) == look { fill(one) } v.simd_eq(one) };
        let inside = |at: Option<usize>| { looks.set(0); fill(T::default()); assert!(at.is_none_or(|it| it < len), "{at:?} of {len} at look {look}") };
        inside(over.position(now));
        inside(over.rposition(now));
        inside(over.zip(y).position(|(a, _)| now(a)));
        inside(over.positions(now).last());
    }
}
cells |s, x, y, one, odd, over, len, kept| {
    // Cells.
    let mut copy = x.to_vec();
    let cells = s.over(Cell::from_mut(&mut copy[..]).as_slice_of_cells()).by::<W>();
    assert_eq!((cells.any(|v| v.simd_eq(one)), cells.all(|v| v.simd_ne(one))), (x.contains(&one), !x.contains(&one)));
    // In place, and toward the start, at each alignment.
    for (start, back) in (0..len.min(33)).flat_map(|start| [(start, 0), (start, start.min(3))]) {
        let mut copy = x.to_vec();
        let cells = Cell::from_mut(&mut copy[..]).as_slice_of_cells();
        s.over(&cells[start..]).by::<W>().map_into(&mut &cells[start - back..], |v| v + one);
        assert!((start..len).all(|i| copy[i - back] == x[i] + one) && copy[..start - back] == x[..start - back] && copy[len - back..] == x[len - back..]);
    }
    let mut all = vec![one];
    over.map_into(&mut Output::append(&mut all, len), |v| v + one);
    assert!(all[1..].iter().copied().eq(x.iter().map(|&it| it + one)));
}
vectors |s, x, y, one, odd, over, len, kept| {
    let mut copy = x.to_vec();
    let cells = s.over(Cell::from_mut(&mut copy[..]).as_slice_of_cells()).by::<W>();
    let (vectors, rest) = cells.exact();
    assert!(vectors.flat_map(|v| v.to_array()).chain(rest.iter().map(Cell::get)).eq(x.iter().copied()));
    assert!(cells.padded().flat_map(|(v, valid)| v.to_array().into_iter().take(valid.count_ones() as usize)).eq(x.iter().copied()));
}
sorts |s, x, y, one, odd, over, len, kept| {
    if T::BITS > 8 {
        let (mut got, mut want) = (x.to_vec(), x.to_vec());
        s.over_mut(&mut got).sort();
        want.sort();
        assert_eq!(got, want);
    }
}
}

#[test]
fn integers() {
    fn of<T: Int, W: Width>(width: W) {
        for len in (0..150).chain([300, 1000, 1100]) {
            let make = |seed| -> Vec<T> { random(len, seed).map(|it| T::from_u64(it % 97)).collect() };
            let (x, y) = (make(len as u64), make(!(len as u64)));
            on_each(|| ints(&x, &y, width));
        }
    }
    of::<u8, _>(B32);
    of::<i32, _>(B16);
}
