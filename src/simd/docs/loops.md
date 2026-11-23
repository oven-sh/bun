# Three larger loops

Shapes that pay once [the rules on speed][speed] are kept.

## One step ahead

A CPU looks only a few hundred instructions ahead, and a long chain of steps that wait for each other fills that window. Cut the chain in two, and begin the next round before this one ends.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
type V = Simd<f32, Twice<Native<S>>, S>;

fn length(x: V<S>, y: V<S>, z: V<S>) -> V<S> {
    x.mul_add_relaxed(x, y.mul_add_relaxed(y, z * z)).sqrt()
}

fn begin(points: &[f32]) -> [V<S>; 4] {
    let [x, y, z] = V::load_interleaved(points);
    [x, y, z, length(x, y, z)]
}

fn end([x, y, z, length]: [V<S>; 4], to: &mut [f32]) {
    let r = length.recip();
    V::store_interleaved([x * r, y * r, z * r], to);
}

#[kernel]
pub fn normalize(from: &[f32], to: &mut [f32]) {
    let from = &from[..to.len()];
    let step = 3 * V::LANES;
    let whole = to.len() / step * step;
    let ((from, from_rest), (to, to_rest)) = (from.split_at(whole), to.split_at_mut(whole));
    if whole > 0 {
        let ((first, from), (to, last)) = (from.split_at(step), to.split_at_mut(whole - step));
        let mut ahead = begin(first);
        for (from, to) in from.chunks_exact(step).zip(to.chunks_exact_mut(step)) {
            let now = ahead;
            ahead = begin(from);
            end(now, to);
        }
        end(ahead, last);
    }
    V::over(from_rest).interleaved().map_into(to_rest, |[x, y, z]| array::map([x, y, z], |v| v * length(x, y, z).recip()));
}
# } fn main() {
let mut to = [0.0; 300];
simd::normalize(&[0.0, 2.0, 0.0].repeat(100), &mut to);
assert_eq!(to[..], [0.0, 1.0, 0.0].repeat(100));
# }
```

It took 0.78 to 0.95 of the time of `map_into` on Ice Lake, Zen 3 to 5, and Neoverse V2 and N3, and as long on Sapphire Rapids and Neoverse V1.

- It pays for long chains, if all fits the registers. With a cheap step it took up to 1.1 times as long on x86, and 1.6 on NEON.
- For records of 5 to 12 floats, `interleaved().map_into` does it by itself where it pays.
- It also works for the bits that `compress_store` takes, the places of a gather, and the end of the next record in a parser.
- With an array of vectors, do each step for all vectors, then the next.

## Strips

For neighbors in the rows above and below, walk down a strip of columns, and keep what rows share in registers. [`Rows`][memory] checks the bounds once.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
/// The sum of each value and those around it, from column `x` on. `L` and `R` are 0 at the borders, and else 1.
fn strip<const L: usize, const R: usize>(from: Rows<'_, u8>, to: &mut RowsMut<'_, u8>, x: usize) {
    let h = to.height();
    let (from, mut to) = (from.at(x - L, 0, L + u8xN::LANES + R, h), to.at(x, 0, u8xN::LANES, h));
    let across = |y| {
        let (row, v) = (from.row(y), u8xN::load_at(from.row(y), L));
        let left = if L == 1 { u8xN::load(row) } else { v.shift_elements_right::<1>(0) };
        let right = if R == 1 { u8xN::load_last(row) } else { v.shift_elements_left::<1>(0) };
        left + v + right
    };
    let (mut above, mut here) = (u8xN::zero(), across(0));
    for y in 1..h {
        let below = across(y);
        (above + here + below).store(to.row(y - 1));
        (above, here) = (here, below);
    }
    (above + here).store(to.row(h - 1));
}

/// For rows that are longer than a vector.
#[kernel]
pub fn sums(from: Rows<'_, u8>, mut to: RowsMut<'_, u8>) {
    let last = to.width() - u8xN::LANES;
    strip::<0, 1, S>(from, &mut to, 0);
    for x in (u8xN::LANES..last).step_by(u8xN::LANES) {
        strip::<1, 1, S>(from, &mut to, x);
    }
    strip::<1, 0, S>(from, &mut to, last);
}
# } use {bun_simd::prelude::*, simd::*}; fn main() {
let mut to = [0; 300];
sums(Rows::new(&[1; 300], 100, 100, 3), RowsMut::new(&mut to, 100, 100, 3));
assert_eq!([to[0], to[50], to[100], to[150], to[299]], [4, 6, 6, 9, 4]);
# }
```

That took 0.2 to 0.55 of the time of one loop over all rows with nine loads and masks for the borders, and two vectors in a strip up to 10% less on x86, and 20% on Arm. The one loop catches up if rows have little more than a vector, and wins if they share nothing
and have no padding: mend the borders after it. A loop for each row took up to 2.4 times as long there, and 4 times with rows of a vector and a half.

## Tiles

A product of matrices, a convolution and a transform use each value many times. The inner loop keeps a tile of sums in registers, and loads only a few values for many multiplications.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
// 12 or 24 sums, a row of `b` and a number of `a` fit into the 16 or 32 registers of the target.
const ROWS: usize = 6;

#[inline(never)]
fn tile<const WIDE: usize>(a: &[[f32; ROWS]], b: &[[f32xN<S>; WIDE]]) -> [[f32xN<S>; WIDE]; ROWS] {
    let mut sums = [[f32xN::zero(); WIDE]; ROWS];
    for (a, b) in a.iter().zip(b) {
        for i in 0..ROWS {
            for j in 0..WIDE {
                sums[i][j] = b[j].mul_add_relaxed(a[i], sums[i][j]);
            }
        }
    }
    sums
}

/// `c = a * b`. The rows of `a` have `k` numbers, and those of `b` and `c` have `n`.
#[kernel]
pub fn product(a: &[f32], b: &[f32], c: &mut [f32], k: usize, n: usize) {
    if S::REGISTERS == 32 { by_tiles::<4, S>(a, b, c, k, n) } else { by_tiles::<2, S>(a, b, c, k, n) }
}

fn by_tiles<const WIDE: usize>(a: &[f32], b: &[f32], c: &mut [f32], k: usize, n: usize) {
    // Both are copied into the order in which the tile reads them, and filled up with zeros.
    let mut panels = vec![[0.0; ROWS]; (a.len() / k).div_ceil(ROWS) * k];
    for (i, row) in a.chunks_exact(k).enumerate() {
        for (to, &x) in panels[i / ROWS * k..].iter_mut().zip(row) {
            to[i % ROWS] = x;
        }
    }
    let mut strip = vec![[f32xN::zero(); WIDE]; k];
    for x in (0..n).step_by(WIDE * f32xN::LANES) {
        for (to, row) in strip.iter_mut().zip(b.chunks_exact(n)) {
            *to = array::from_fn(|j| f32xN::load_or_default(row.get(x + j * f32xN::LANES..).unwrap_or_default()));
        }
        for (panel, rows) in panels.chunks_exact(k).zip(c.chunks_mut(ROWS * n)) {
            for (sums, row) in tile(panel, &strip).iter().zip(rows.chunks_exact_mut(n)) {
                for (sum, to) in sums.iter().zip(row[x..].chunks_mut(f32xN::LANES)) {
                    sum.store_partial(to);
                }
            }
        }
    }
}
# } fn main() {
let mut c = [0.0; 6];
simd::product(&[1.0, 2.0, 3.0, 4.0], &[1.0, 0.0, 2.0, 0.0, 1.0, 2.0], &mut c, 2, 3);
assert_eq!(c, [1.0, 2.0, 6.0, 3.0, 4.0, 14.0]);
# }
```

For 240 × 256 × 192 numbers this was 2.5 to 6.7 times as fast as a loop of `over_mut` for each row of `b`, from AVX2 on and on Neoverse.

- Leave a register free. With 4 rows of 3 vectors on AVX2, which makes 16, one sum went through the stack, and it took up to 2.2 times as long. If `rsp` or `sp` is in the loop, change the shape or the order of the two loops.
- If the small loops stay loops, write `unroll!`. On NEON, `splat_lane` saves loads of `a`.
- For `k` beyond a few hundred, go through `a` and `b` in blocks that fit the caches.

[speed]: speed.md
[memory]: guide.md#memory
