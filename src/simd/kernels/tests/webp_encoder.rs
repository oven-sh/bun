//! The kernels of the WebP encoder on every target, against the formulas of RFC 6386 and libwebp.
#![forbid(unsafe_code)]
#![cfg(not(miri))] // slow, and nothing but arrays
#[expect(dead_code)]
mod common;
use bun_simd_kernels::webp::{
    self, Block, Candidates, Edges, LinearColors, Macroblock, Quantizer, Scratch,
};
use common::{check, random};
use core::array::from_fn;
use core::iter::repeat_with;

/// By row and column.
type Square = [[i32; 4]; 4];

const ZIGZAG: [usize; 16] = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15];
const SHARPENING: [[u8; 4]; 4] = [[0, 30, 60, 90], [30, 60, 90, 90], [60, 90, 90, 90], [90; 4]];

fn square(block: &Block) -> Square {
    from_fn(|y| from_fn(|x| block[x][y].into()))
}

fn transposed(it: Square) -> Square {
    from_fn(|y| from_fn(|x| it[x][y]))
}

fn each(a: Square, b: Square, f: impl Fn(i32, i32) -> i32) -> Square {
    from_fn(|y| from_fn(|x| f(a[y][x], b[y][x])))
}

fn sum(it: Square) -> i32 {
    it.as_flattened().iter().sum()
}

fn forward_dct(samples: Square, prediction: Square) -> Square {
    nudged_dct(samples, prediction, [0; 2])
}

/// With `more` added to the odd results of each pass before they are rounded.
fn nudged_dct(samples: Square, prediction: Square, more: [i32; 2]) -> Square {
    let parts = |[d0, d1, d2, d3]: [i32; 4]| [d0 + d3, d1 + d2, d1 - d2, d0 - d3];
    let rows = each(samples, prediction, |a, b| a - b).map(parts);
    let rows = rows.map(|[a0, a1, a2, a3]| {
        let (odd1, odd3) = (a2 * 2217 + a3 * 5352 + 1812, a3 * 2217 - a2 * 5352 + 937);
        let [odd1, odd3] = [odd1, odd3].map(|it| (it + more[0]) >> 9);
        [(a0 + a1) * 8, odd1, (a0 - a1) * 8, odd3]
    });
    transposed(transposed(rows).map(parts).map(|[a0, a1, a2, a3]| {
        let (odd1, odd3) = (a2 * 2217 + a3 * 5352 + 12000, a3 * 2217 - a2 * 5352 + 51000);
        let [odd1, odd3] = [odd1, odd3].map(|it| (it + more[1]) >> 16);
        let odd1 = odd1 + i32::from(a3 != 0);
        [(a0 + a1 + 7) >> 4, odd1, (a0 - a1 + 7) >> 4, odd3]
    }))
}

fn decode(coefficients: Square, prediction: Square) -> Square {
    let pass = |[i0, i1, i2, i3]: [i32; 4]| {
        let (cos, sin) = (|it| it + ((it * 20091) >> 16), |it| (it * 35468) >> 16);
        let [a, b, c, d] = [i0 + i2, i0 - i2, sin(i1) - cos(i3), cos(i1) + sin(i3)];
        [a + d, b + c, b - c, a - d]
    };
    let residual = transposed(transposed(coefficients).map(pass)).map(pass);
    each(residual, prediction, |a, b| {
        (((a + 4) >> 3) + b).clamp(0, 255)
    })
}

fn hadamard(it: Square) -> Square {
    let pass =
        |[a, b, c, d]: [i32; 4]| [a + b + c + d, a + b - c - d, a - b - c + d, a - b + c - d];
    transposed(transposed(it.map(pass)).map(pass))
}

fn squared_error(a: Square, b: Square) -> i32 {
    sum(each(a, b, |a, b| (a - b) * (a - b)))
}

fn texture_difference(a: Square, b: Square) -> i32 {
    let weights = [
        [38, 32, 20, 9],
        [32, 28, 17, 7],
        [20, 17, 10, 4],
        [9, 7, 4, 2],
    ];
    let texture = |it| sum(each(hadamard(it), weights, |it, weight| it.abs() * weight));
    (texture(a) - texture(b)).abs() >> 5
}

#[derive(Clone, Copy)]
struct Steps([u16; 2], [u8; 2], [[u8; 4]; 4]);

impl Steps {
    fn quantizer(self) -> Quantizer {
        Quantizer::new(self.0, self.1, self.2)
    }

    fn step(self, y: usize, x: usize) -> i32 {
        self.0[(y + x).min(1)].into()
    }

    fn level(self, it: i32, y: usize, x: usize) -> i32 {
        let sharpening = (i32::from(self.2[y][x]) * self.step(1, 1)) >> 11;
        let bias = i32::from(self.1[(y + x).min(1)]) << 9;
        it.signum() * (((it.abs() + sharpening) * ((1 << 17) / self.step(y, x)) + bias) >> 17)
    }

    fn levels(self, it: Square) -> Square {
        from_fn(|y| from_fn(|x| self.level(it[y][x], y, x)))
    }

    fn dequantized(self, levels: Square) -> Square {
        from_fn(|y| from_fn(|x| levels[y][x] * self.step(y, x)))
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Coded {
    levels: Square,
    symbols: [i32; 16],
    end: i32,
    edges: [i32; 7],
}

impl Coded {
    fn new(levels: Square, first: usize, context: i32, it: Square) -> Self {
        let magnitudes = ZIGZAG.map(|at| levels[at / 4][at % 4].abs());
        let context_at = |i: usize| match i.checked_sub(first) {
            None => 0,
            Some(0) => context,
            Some(_) => magnitudes[i - 1].min(2),
        };
        let last = magnitudes.iter().rposition(|&it| it != 0);
        Self {
            levels,
            symbols: from_fn(|i| magnitudes[i].min(67) + 68 * context_at(i)),
            end: last.map_or(context, |i| 4 * (i as i32 + 1) + magnitudes[i].min(2)),
            edges: from_fn(|i| if i < 4 { it[3][i] } else { it[6 - i][3] }),
        }
    }

    fn of<const PAIRS: usize>(it: &Candidates<PAIRS>, mode: usize, end: u8) -> Self {
        let (pair, half) = (mode / 2, mode % 2);
        Self {
            levels: it
                .levels
                .map(|row| row[pair].map(|it| ((it >> (16 * half)) as i16).into())),
            symbols: from_fn(|i| it.symbols[i / 8][pair][i % 8].to_le_bytes()[half].into()),
            end: end.into(),
            edges: from_fn(|i| it.edges[pair][half][i].into()),
        }
    }

    fn is_saturated(&self) -> bool {
        self.levels.as_flattened().iter().any(|it| it.abs() >= 67)
    }

    fn ac_count(&self) -> usize {
        self.levels.as_flattened()[1..]
            .iter()
            .filter(|&&it| it != 0)
            .count()
    }
}

/// Of a block of a macroblock, whose planes have `width` blocks in a row.
fn predict(edges: &Edges, mode: usize, block: usize, width: usize) -> Square {
    let (plane, size) = (block / (width * width), 4 * width);
    let (column, row) = (4 * (block % width), 4 * (block / width % width));
    let at = |y: usize, x: usize| {
        let above = i32::from(edges.above[plane * size + column + x]);
        let left = i32::from(edges.left[plane * size + size - 1 - row - y]);
        let true_motion = left + above - i32::from(edges.above_left[plane]);
        [
            edges.dc[plane].into(),
            true_motion.clamp(0, 255),
            above,
            left,
        ][mode]
    };
    from_fn(|y| from_fn(|x| at(y, x)))
}

/// How many of the blocks above and to the left of the next one have levels other than zero.
fn context(before: &[Coded], around: [[bool; 4]; 2], width: usize) -> i32 {
    let (block, start) = (before.len(), before.len() / (width * width) * width);
    let (x, y) = (block % width, block / width % width);
    let is_set = |i: usize| before[i].levels != Square::default();
    let above = if y == 0 {
        around[0][start + x]
    } else {
        is_set(block - width)
    };
    let left = if x == 0 {
        around[1][start + y]
    } else {
        is_set(block - 1)
    };
    i32::from(above) + i32::from(left)
}

fn predict_subblock(edge: [u8; 13], mode: usize) -> Square {
    let e = |i: i32| i32::from(edge[i.clamp(0, 12) as usize]);
    let two = |i| (e(i) + e(i + 1) + 1) >> 1;
    let three = |i| (e(i - 1) + 2 * e(i) + e(i + 1) + 2) >> 2;
    let at = |y: i32, x: i32| match mode {
        0 => ((0..9).map(e).sum::<i32>() - e(4) + 4) >> 3,
        1 => (e(3 - y) + e(5 + x) - e(4)).clamp(0, 255),
        2 => three(5 + x),
        3 => three(3 - y),
        4 => three(4 - y + x),
        5 if 2 * x - y < -1 => three(5 - y),
        5 if y % 2 == 0 => two(4 + x - y / 2),
        5 => three(4 + x - y / 2),
        6 => three(6 + x + y),
        7 if x == 3 && y > 1 => three(8 + y),
        7 if y % 2 == 0 => two(5 + x + y / 2),
        7 => three(6 + x + y / 2),
        8 if 2 * y - x < -1 => three(3 + x),
        8 if x % 2 == 0 => two(3 - y + x / 2),
        8 => three(4 - y + x / 2),
        _ if x % 2 == 0 => two(2 - y - x / 2),
        _ => three(2 - y - x / 2),
    };
    from_fn(|y| from_fn(|x| at(y as i32, x as i32)))
}

struct Case {
    samples: Macroblock,
    edges: Edges,
    around: [[bool; 4]; 2],
    context: u8,
    /// For DC and AC.
    steps: [u16; 2],
}

/// From flat to black and white, some just as TrueMotion predicts, with a source of more samples.
fn cases() -> impl Iterator<Item = (Case, impl FnMut() -> u8)> {
    let mut below = random();
    (0..240).map(move |round| {
        let (noise, base) = ([1, 2, 5, 20, 80, 256, 0][round % 7], below(256));
        let mut more = random();
        (0..round).for_each(|_| _ = more(2));
        let mut next = move || match noise {
            0 => 255 * (more(8) / (1 + round % 5)).min(1) as u8,
            _ => (base + more(noise)).min(255) as u8,
        };
        let mut block = |_| from_fn(|_| from_fn(|_| next()));
        let (luma, chroma) = (from_fn(&mut block), from_fn(&mut block));
        let any = [4 + below(154) as u16, 4 + below(281) as u16];
        let mut case = Case {
            samples: Macroblock { luma, chroma },
            edges: Edges {
                above: from_fn(|_| next()),
                left: from_fn(|_| next()),
                above_left: from_fn(|_| next()),
                dc: from_fn(|_| next()),
            },
            around: from_fn(|_| from_fn(|_| below(2) == 0)),
            context: below(3) as u8,
            steps: [[4, 4], [8, 16], [157, 284], any, any][below(5)],
        };
        if round % 4 == 3 {
            let of = |i, width| transposed(predict(&case.edges, 1, i, width));
            let of = |i, width| of(i, width).map(|it| it.map(|it| it as u8));
            let (luma, chroma) = (from_fn(|i| of(i, 4)), from_fn(|i| of(i, 2)));
            case.samples = Macroblock { luma, chroma };
        }
        (case, next)
    })
}

/// Before the shift by 16.
fn luma_of([r, g, b, _]: [u8; 4]) -> i32 {
    16839 * i32::from(r) + 33059 * i32::from(g) + 6420 * i32::from(b) + (16 << 16) + (1 << 15)
}

/// Before the shift by 18.
fn chroma_of([r, g, b]: [i32; 3]) -> [i32; 2] {
    let u = -9719 * r - 19081 * g + 28800 * b;
    let v = 28800 * r - 24116 * g - 4684 * b;
    [u, v].map(|it| it + (128 << 18) + (1 << 17))
}

fn check_convert(pixels: &[[[u8; 4]; 16]; 16], colors: &LinearColors, table: &[i32; 33]) {
    let luma = |y: usize, x: usize| (luma_of(pixels[y][x]) >> 16) as u8;
    let chroma = |block: usize, y: usize, x: usize| {
        let rgb = colors.sums.map(|it| {
            let sum = i32::from(it[y][block / 2 % 2][block % 2 * 4 + x]);
            let [from, to] = [0, 1].map(|i| table[sum as usize / 512 + i]);
            (to * (sum % 512) + from * (512 - sum % 512) + 64) >> 7
        });
        (chroma_of(rgb)[block / 4] >> 18) as u8
    };
    let want = (
        from_fn(|n| from_fn(|x| from_fn(|y| luma(n / 4 * 4 + y, n % 4 * 4 + x)))),
        from_fn(|n| from_fn(|x| from_fn(|y| chroma(n, y, x)))),
    );
    let values = from_fn(|i| table[i] as u8);
    let slopes = from_fn(|i| (table[i + 1] - table[i]) as u8);
    check(want, || {
        let (mut out, gamma) = (Macroblock::default(), webp::GammaTable { values, slopes });
        webp::convert(&pixels.each_ref(), colors, &gamma, &mut out);
        (out.luma, out.chroma)
    });
}

#[test]
fn convert() {
    let mut below = random();
    for round in 0..100 {
        let mut byte = |_| [below(256) as u8, 255 * below(2) as u8][round % 2];
        let pixels = from_fn(|_| from_fn(|_| from_fn(&mut byte)));
        let mut table = from_fn(|_| below(256) as i32);
        table.sort_unstable();
        let mut sum = |_| [below(1 << 14) as u16, 16383 * below(2) as u16][round % 2];
        let sums = from_fn(|_| from_fn(|_| from_fn(|_| from_fn(&mut sum))));
        check_convert(&pixels, &LinearColors { sums }, &table);
    }
}

#[test]
fn samples_change_at_the_right_sums() {
    let (mut below, is_close) = (random(), |sum, shift| (sum + 1) % (1 << shift) < 2);
    let pixels = (0..1 << 24).step_by(3).map(u32::to_le_bytes);
    let mut pixels = pixels.filter(|&it| is_close(luma_of(it), 16));
    let colors = repeat_with(|| from_fn(|_| below(1021) as i32));
    let mut colors = colors.filter(|&it| chroma_of(it).iter().any(|&it| is_close(it, 18)));
    let colors: [[[_; 8]; 2]; 4] = from_fn(|_| from_fn(|_| from_fn(|_| colors.next().unwrap())));
    // With this table, a color is a 16th of its sum.
    let sums = from_fn(|i| colors.map(|it| it.map(|it| it.map(|it| 16 * it[i] as u16))));
    let pixels = from_fn(|_| from_fn(|_| pixels.next().unwrap_or_default()));
    check_convert(&pixels, &LinearColors { sums }, &from_fn(|i| 8 * i as i32));
}

#[test]
fn analyze() {
    for ((Case { samples, edges, .. }, _), (other, _)) in cases().zip(cases().skip(7)) {
        let histogram = |blocks: &[Block], edges, width, mode| {
            let mut bins = [0; 32];
            for (i, block) in blocks.iter().enumerate() {
                let coefficients = forward_dct(square(block), predict(edges, mode, i, width));
                for it in coefficients.as_flattened() {
                    bins[(it.unsigned_abs() as usize >> 3).min(31)] += 1;
                }
            }
            let last = bins.iter().rposition(|&it| it != 0).unwrap();
            [bins.into_iter().max().unwrap(), last as u32]
        };
        for chroma_edges in [&edges, &other.edges] {
            let luma = [0, 1].map(|mode| histogram(&samples.luma, &edges, 4, mode));
            let chroma = [0, 1].map(|mode| histogram(&samples.chroma, chroma_edges, 2, mode));
            check([luma, chroma], || {
                let got = webp::analyze(&samples, &edges, chroma_edges);
                got.map(|it| from_fn(|mode| [it.highest_count[mode], it.last_bin[mode]]))
            });
        }
    }
}

#[test]
fn luma_modes() {
    for (case, _) in cases() {
        let ([dc, ac], originals) = (case.steps, case.samples.luma.each_ref().map(square));
        let luma = Steps([dc, ac], [96, 110], SHARPENING);
        let y2 = Steps([2 * dc, (ac * 155 / 100).max(8)], [96, 108], [[0; 4]; 4]);
        let modes: [_; 4] = from_fn(|mode| {
            let predictions: [_; 16] = from_fn(|i| predict(&case.edges, mode, i, 4));
            let coefficients: [_; 16] = from_fn(|i| forward_dct(originals[i], predictions[i]));
            let dcs = from_fn(|y| from_fn(|x| coefficients[4 * y + x][0][0]));
            let y2_levels = y2.levels(hadamard(dcs).map(|row| row.map(|it| it >> 1)));
            let dcs = hadamard(y2.dequantized(y2_levels)).map(|row| row.map(|it| (it + 3) >> 3));
            let (mut blocks, mut error, mut texture) = (vec![], 0, 0);
            for i in 0..16 {
                let mut levels = luma.levels(coefficients[i]);
                levels[0][0] = 0;
                let mut dequantized = luma.dequantized(levels);
                dequantized[0][0] = dcs[i / 4][i % 4];
                let decoded = decode(dequantized, predictions[i]);
                error += squared_error(decoded, originals[i]);
                texture += texture_difference(decoded, originals[i]);
                blocks.push(Coded::new(
                    levels,
                    1,
                    context(&blocks, case.around, 4),
                    decoded,
                ));
            }
            let y2 = Coded::new(y2_levels, 0, case.context.into(), Square::default());
            (blocks, y2, error, texture)
        });
        let in_blocks = modes.iter().any(|it| it.0.iter().any(Coded::is_saturated));
        let in_y2 = modes.iter().any(|it| it.1.is_saturated());
        let (ac, y2) = (&luma.quantizer(), &y2.quantizer());
        check((modes, in_blocks, in_y2), || {
            let Scratch { source, luma, .. } = &mut Scratch::default();
            let (samples, edges, around) = (&case.samples, &case.edges, case.around);
            let it =
                webp::try_luma_modes(samples, edges, around, case.context, ac, y2, source, luma);
            let modes = from_fn(|mode| {
                let end = |i: usize| luma.ends[i / 8][mode / 2][i % 8][mode % 2];
                (
                    (0..16)
                        .map(|i| Coded::of(&luma.blocks[i], mode, end(i)))
                        .collect(),
                    Coded::of(&luma.y2, mode, luma.y2_ends[mode / 2][0][mode % 2]),
                    luma.squared_errors[mode],
                    luma.texture_differences[mode],
                )
            });
            (modes, it.blocks, it.y2)
        });
    }
}

#[test]
fn subblock_modes() {
    for (case, mut next) in cases() {
        let sharpening = [SHARPENING, [SHARPENING[0]; 4]][usize::from(case.around[0][0])];
        let (steps, context) = (Steps(case.steps, [96, 110], sharpening), case.context);
        let (block, lambda) = (usize::from(next()), (50 * steps.step(1, 1)) >> 5);
        let (original, edge) = (square(&case.samples.luma[block % 16]), from_fn(|_| next()));
        let modes: [_; 10] = from_fn(|mode| {
            let prediction = predict_subblock(edge, mode);
            let levels = steps.levels(forward_dct(original, prediction));
            let decoded = decode(steps.dequantized(levels), prediction);
            let texture = (lambda * texture_difference(decoded, original) + 128) >> 8;
            let coded = Coded::new(levels, 0, context.into(), decoded);
            let is_flat = mode != 0 && coded.ac_count() <= 3;
            (
                coded,
                is_flat,
                256 * (squared_error(decoded, original) + texture),
            )
        });
        let last = |of: &[(Coded, _, _)]| {
            let end = |it: Coded| if it.is_saturated() { 255 } else { it.end as u8 };
            of.iter().map(|it| end(it.0)).max().unwrap()
        };
        let edge = (edge.iter()).rfold(next().into(), |all, &it| all << 8 | u128::from(it));
        let by = &steps.quantizer();
        check((modes, last(&modes[..4]), last(&modes[4..])), || {
            let it = &mut Scratch::default();
            let (source, luma, out) = (&mut it.source, &mut it.luma, &mut it.subblock);
            webp::try_luma_modes(
                &case.samples,
                &case.edges,
                case.around,
                0,
                by,
                by,
                source,
                luma,
            );
            let first = webp::try_straight_modes(edge, context, block, source, by, lambda, out);
            let second = webp::try_diagonal_modes(edge, context, block, source, by, lambda, out);
            let modes = from_fn(|mode| {
                let (end, is_flat) = (out.ends[mode] % 128, out.ends[mode] & webp::IS_FLAT != 0);
                (
                    Coded::of(&out.block, mode, end),
                    is_flat,
                    out.distortions[mode],
                )
            });
            (modes, first, second)
        });
    }
}

fn check_chroma_modes(case: &Case, steps: Steps, errors: Option<&[[i16; 8]; 2]>) {
    let originals = case.samples.chroma.each_ref().map(square);
    let modes: [_; 4] = from_fn(|mode| {
        let predictions: [_; 8] = from_fn(|i| predict(&case.edges, mode, i, 2));
        let mut coefficients: [_; 8] = from_fn(|i| forward_dct(originals[i], predictions[i]));
        let passed_on = errors.map(|errors| {
            [0, 1].map(|plane| {
                let mut diffuse = |block: usize, above: i32, left: i32| {
                    let dc = &mut coefficients[4 * plane + block][0][0];
                    let corrected = *dc + ((7 * above + 8 * left) >> 3);
                    *dc = steps.level(corrected, 0, 0) * steps.step(0, 0);
                    (corrected - *dc) >> 1
                };
                let [above, left] = errors.map(|it| [0, 4].map(|at| it[at + 2 * plane].into()));
                let e0 = diffuse(0, above[0], left[0]);
                let [e1, e2] = [diffuse(1, above[1], e0), diffuse(2, e0, left[1])];
                [e1, e2, diffuse(3, e1, e2)]
            })
        });
        let (mut blocks, mut error) = (vec![], 0);
        for i in 0..8 {
            let levels = steps.levels(coefficients[i]);
            let decoded = decode(steps.dequantized(levels), predictions[i]);
            error += squared_error(decoded, originals[i]);
            blocks.push(Coded::new(
                levels,
                0,
                context(&blocks, case.around, 2),
                decoded,
            ));
        }
        let ac_count: usize = blocks.iter().map(Coded::ac_count).sum();
        (blocks, ac_count, error, passed_on)
    });
    let is_saturated = modes.iter().any(|it| it.0.iter().any(Coded::is_saturated));
    let (samples, edges, by) = (&case.samples, &case.edges, &steps.quantizer());
    check((modes, is_saturated), || {
        let out = &mut Scratch::default().chroma;
        let is_saturated = webp::try_chroma_modes(samples, edges, case.around, by, errors, out);
        let modes = from_fn(|mode| {
            let (pair, half) = (mode / 2, mode % 2);
            let [[e1, e2], [e3, _]] = out.dc_errors.map(|it| it[pair]);
            let of_plane = |plane: usize| [e1, e2, e3].map(|it| it[plane][half].into());
            (
                (0..8)
                    .map(|i| Coded::of(&out.blocks[i], mode, out.ends[pair][i][half]))
                    .collect(),
                out.ac_counts[pair][0][half].into(),
                out.squared_errors[mode],
                errors.map(|_| [0, 1].map(of_plane)),
            )
        });
        (modes, is_saturated)
    });
}

#[test]
fn chroma_modes() {
    for (case, mut next) in cases() {
        let steps = Steps(
            [case.steps[0].min(132), case.steps[1]],
            [110, 115],
            [[0; 4]; 4],
        );
        let mut error = |_| [i16::from(next() as i8) * steps.0[0] as i16 / 256; 2];
        let errors: [[[i16; 2]; 4]; 2] = from_fn(|_| from_fn(&mut error));
        let errors = errors.map(|it| from_fn(|i| it[i / 2][i % 2]));
        check_chroma_modes(&case, steps, Some(&errors));
        check_chroma_modes(&case, steps, None);
    }
}

#[test]
fn levels_change_at_the_right_magnitudes() {
    let (flat, _) = cases().next().unwrap();
    for (step, bias) in (4..=440).flat_map(|step| [5, 96, 108, 110, 115].map(|bias| (step, bias))) {
        let steps = Steps([step; 2], [bias; 2], [[0; 4]; 4]);
        for level in [1, 2040 / i32::from(step)] {
            let at = (0..).find(|&it| steps.level(it, 0, 0) == level).unwrap() as i16;
            let left = [at, at, 1 - at, 1 - at, -at, -at, at - 1, at - 1];
            check_chroma_modes(&flat, steps, Some(&[[0; 8], left]));
        }
    }
}

#[test]
fn coefficients_change_at_the_right_sums() {
    let ((mut flat, _), mut below) = (cases().next().unwrap(), random());
    let prediction = predict(&flat.edges, 0, 0, 2);
    let with = |block: &_, more| nudged_dct(square(block), prediction, more);
    for more in [[1, 0], [0, 1]] {
        let blocks = repeat_with(|| from_fn(|_| from_fn(|_| below(256) as u8)));
        let is_close = |it: &_| with(it, more) != with(it, more.map(|it| -it));
        for block in blocks.filter(is_close).take(32) {
            flat.samples.chroma[0] = block;
            // With one of them, the level changes between any two magnitudes.
            for bias in [32, 96, 160, 224] {
                check_chroma_modes(&flat, Steps([4; 2], [bias; 2], [[0; 4]; 4]), None);
            }
        }
    }
}
