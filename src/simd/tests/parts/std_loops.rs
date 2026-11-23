use bun_simd::*;
use framework::*;

fn range(io: &Io, len: usize) -> core::ops::Range<usize> {
    let end = io.up_to(len);
    (io.n >> 20) as usize % 9 % (end + 1)..end
}
fn few(m: &Model) -> Lanes {
    let all = m.slice();
    all[range(m.io, all.len())].to_vec()
}

cases! {
    is_sorted sizes 0..=64, |d, _, _, _, io| {
        let all = io.slice::<T>();
        let mut x = all[range(io, all.len())].to_vec();
        let any = d.over(&x).is_sorted();
        x.sort_by(|a, b| (T::TY.is_nan(a.to_bits() as _)).cmp(&T::TY.is_nan(b.to_bits() as _)).then(a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal)));
        let sorted = (d.over(&x).is_sorted(), x.is_sorted());
        if x.len() > 1 { let at = (io.n >> 30) as usize % (x.len() - 1); x.swap(at, at + 1); }
        [any == all[range(io, all.len())].is_sorted(), sorted.0 == sorted.1, d.over(&x).is_sorted() == x.is_sorted()]
    } => |_m| vec![1; 3];
    cmp [u8 i16 u32 i64] 0..=64, |d, _, _, _, io| {
        let all = io.slice::<T>();
        let (x, mut y) = (&all[range(io, all.len())], all[range(io, all.len())].to_vec());
        let equal = d.over(x).cmp(&y).is_eq();
        let shorter = &x[..x.len() / 2];
        if let Some(it) = y.get_mut((io.n >> 30) as usize % x.len().max(1)) { *it = all[0]; }
        [equal, d.over(x).cmp(&y) == x.cmp(&y), d.over(&y).cmp(x) == y[..].cmp(x), d.over(x).cmp(shorter) == x.cmp(shorter), d.over(shorter).cmp(&y) == shorter.cmp(&y)]
    } => |_m| vec![1; 5];
    reverse sizes 0..=64, |d, _, _, _, io| { let mut all = io.slice::<T>(); let r = range(io, all.len()); d.over_mut(&mut all[r]).reverse(); all }
        => |m| { let mut all = m.slice(); let r = range(m.io, all.len()); all[r].reverse(); all };
    dedup sizes 0..=64, |d, _, _, _, io| {
        let all = io.slice::<T>();
        let mut x: Vec<T> = all[range(io, all.len())].iter().enumerate().map(|(i, _)| all[i & !(io.n >> (i / 8 % 60) & 3) as usize]).collect();
        let (mut y, n) = (x.clone(), d.over_mut(&mut x).dedup());
        y = { let mut kept = vec![]; let mut i = 0; while i < all[range(io, all.len())].len() { let it = all[i & !(io.n >> (i / 8 % 60) & 3) as usize]; if kept.last() != Some(&it) { kept.push(it) } i += 1; } let _ = y; kept };
        n == y.len() && x[..n].iter().zip(&y).all(|(a, b)| a.to_bits() == b.to_bits())
    } => |_m| vec![1];
    prefix_sum int 0..=64, |d, _, _, _, io| { let all = io.slice::<T>(); let mut x = all[range(io, all.len())].to_vec(); let sum = d.over_mut(&mut x).prefix_sum(); (x, sum) }
        => |m| { let mut sum = 0; let mut all: Lanes = few(m).into_iter().map(|x| { sum += x; sum }).collect(); all.push(sum); all };
}
