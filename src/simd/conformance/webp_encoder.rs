//! The kernels of the WebP encoder, whose arguments differ a little.
use crate::Random;
use crate::bench::{Apart, compare};
use core::array::from_fn;
use core::hint::black_box as opaque;

type Sharpening = [[u8; 4]; 4];
/// The edge, the context and the index.
type Place = (u128, u8, usize);

struct Arguments<Macroblock, Edges, Quantizer, LinearColors, GammaTable, Scratch> {
    samples: Macroblock,
    /// Of luma and chroma.
    edges: [Edges; 2],
    luma: Quantizer,
    ac: Quantizer,
    y2: Quantizer,
    chroma: Quantizer,
    colors: LinearColors,
    gamma: GammaTable,
    to: Box<Scratch>,
}

mod highway {
    use super::*;
    pub(super) use bun_highway::webp::*;

    type All = Arguments<Macroblock, Edges, Quantizer, LinearColors, GammaTable, Scratch>;

    pub(super) fn quantizer(steps: [u16; 2], biases: [u8; 2], by: Sharpening) -> Quantizer {
        let rows = |values: [u16; 2]| {
            let [dc, ac] = values.map(|it| [it as i16; 2]);
            [[dc, ac, ac, ac], [ac; 4]]
        };
        let reciprocals = steps.map(|it| ((1 << 17) / u32::from(it.max(4))).min(0x7FFF) as u16);
        Quantizer {
            steps: rows(steps),
            reciprocals: rows(reciprocals),
            doubled_reciprocals: rows(reciprocals.map(|it| 2 * it)),
            limits: rows(biases.map(|bias| ((128 - u16::from(bias)) << 10) - 1)),
            sharpening: by.map(|row| row.map(|it| [((u16::from(it) * steps[1]) >> 11) as i16; 2])),
        }
    }

    pub(super) fn without_dc(&(mut quantizer): &Quantizer) -> Quantizer {
        quantizer.reciprocals[0][0] = [0; 2];
        quantizer
    }

    #[inline(always)]
    pub(super) fn luma_modes(it: &mut All, case: &Case) -> LumaSaturation {
        let (samples, edges, around) = (&it.samples, &it.edges[0], case.around);
        let (Scratch { source, luma, .. }, by) = (&mut *it.to, [&it.ac, &it.y2]);
        try_luma_modes(samples, edges, around, case.context, by, source, luma)
    }

    #[inline(always)]
    pub(super) fn subblock_modes(it: &mut All, first: usize, block: Place, by: i32) -> u8 {
        let ((edge, context, index), source, out) = (block, &it.to.source, &mut it.to.subblock);
        #[rustfmt::skip]
        let block = Subblock { index, edge, context };
        match first {
            0 => try_straight_modes(block, source, &it.luma, by, out),
            _ => try_diagonal_modes(block, source, &it.luma, by, out),
        }
    }
}

mod rust {
    use super::*;
    pub(super) use bun_simd_kernels::webp::*;

    type All = Arguments<Macroblock, Edges, Quantizer, LinearColors, GammaTable, Scratch>;

    pub(super) fn quantizer(steps: [u16; 2], biases: [u8; 2], by: Sharpening) -> Quantizer {
        Quantizer::new(steps, biases, by)
    }

    /// The kernel does it.
    pub(super) fn without_dc(quantizer: &Quantizer) -> Quantizer {
        *quantizer
    }

    #[inline(always)]
    pub(super) fn luma_modes(it: &mut All, case: &Case) -> LumaSaturation {
        let (samples, edges, around) = (&it.samples, &it.edges[0], case.around);
        let (Scratch { source, luma, .. }, ac, y2) = (&mut *it.to, &it.ac, &it.y2);
        try_luma_modes(samples, edges, around, case.context, ac, y2, source, luma)
    }

    #[inline(always)]
    pub(super) fn subblock_modes(it: &mut All, first: usize, block: Place, by: i32) -> u8 {
        let ((edge, context, index), source, out) = (block, &it.to.source, &mut it.to.subblock);
        match first {
            0 => try_straight_modes(edge, context, index, source, &it.luma, by, out),
            _ => try_diagonal_modes(edge, context, index, source, &it.luma, by, out),
        }
    }
}

struct Case {
    pixels: [[[u8; 4]; 16]; 16],
    sums: [[[[u16; 8]; 2]; 4]; 3],
    gamma: [u8; 33],
    blocks: [[[u8; 4]; 4]; 24],
    /// For luma and chroma: above, left, and the corners and DCs.
    edges: [[[u8; 16]; 3]; 2],
    steps: [u16; 2],
    errors: [[i16; 8]; 2],
    around: [[bool; 4]; 2],
    context: u8,
}

impl Case {
    /// The samples are up to `noise` above a slope.
    #[optimize(size)]
    fn new(random: &mut Random, noise: usize, step: u16) -> Self {
        let (start, [dx, dy]) = (random.below(256), [(); 2].map(|()| random.below(9)));
        let mut at = |x: usize, y: usize| match noise {
            256.. => random.one_of(&[0, 255]),
            _ => ((start + x * dx + y * dy) / 2 + random.below(noise)).min(255) as u8,
        };
        let pixels = from_fn(|y| from_fn(|x| from_fn(|_| at(x, y))));
        let mut sums = |y| from_fn(|x| u16::from(at(x, y)) * 64 + u16::from(at(x, y)) % 64);
        let sums = from_fn(|_| from_fn(|y| [sums(y), sums(4 + y)]));
        let blocks = from_fn(|n| from_fn(|x| from_fn(|y| at(n % 4 * 4 + x, n / 4 * 4 + y))));
        let places: [fn(_) -> _; 3] = [|i| (i, 0), |i| (0, 15 - i), |_| (4, 4)];
        let edges = from_fn(|_| places.map(|it| from_fn(|i| at(it(i).0, it(i).1))));
        let mut gamma = from_fn(|_| random.below(256) as u8);
        gamma.sort_unstable();
        let dc = (step / 2 + random.below(4) as u16).clamp(4, 157);
        let mut error = |_| random.below(dc.into()) as i16 / 2 - dc as i16 / 4;
        Self {
            errors: from_fn(|_| from_fn::<_, 4, _>(&mut error)).map(|it| from_fn(|i| it[i / 2])),
            pixels,
            sums,
            gamma,
            blocks,
            edges,
            steps: [dc, step],
            around: from_fn(|_| from_fn(|_| random.below(2) == 0)),
            context: random.below(3) as u8,
        }
    }
}

/// For the module `$k`.
macro_rules! arguments {
    ($k:ident, $case:ident) => {{
        let ([dc, ac], none) = ($case.steps, [[0; 4]; 4]);
        let sharpening = from_fn(|y| from_fn(|x| 30 * (x + y).min(3) as u8));
        let luma = $k::quantizer([dc, ac], [96, 110], sharpening);
        Arguments {
            samples: $k::Macroblock {
                luma: from_fn(|i| $case.blocks[i]),
                chroma: from_fn(|i| $case.blocks[16 + i]),
            },
            edges: $case
                .edges
                .map(|[above, left, [a, b, c, d, ..]]| $k::Edges {
                    above,
                    left,
                    above_left: [a, b],
                    dc: [c, d],
                }),
            luma,
            ac: $k::without_dc(&luma),
            y2: $k::quantizer([2 * dc, (ac * 155 / 100).max(8)], [96, 108], none),
            chroma: $k::quantizer([dc.min(132), ac], [110, 115], none),
            colors: $k::LinearColors { sums: $case.sums },
            gamma: $k::GammaTable {
                values: from_fn(|i| $case.gamma[i]),
                slopes: from_fn(|i| $case.gamma[i + 1] - $case.gamma[i]),
            },
            to: Box::<$k::Scratch>::default(),
        }
    }};
}

macro_rules! pairs {
    ($block:expr, $count:literal) => {
        from_fn::<_, $count, _>(|pair| {
            let edges = $block.edges[pair].map(|it| u64::from_le_bytes(it) << 8);
            let symbols = $block.symbols.map(|it| it[pair]);
            ($block.levels.map(|it| it[pair]), symbols, edges)
        })
    };
}

/// For each kernel, all that its callers read.
macro_rules! outcome {
    ($k:ident, $case:ident, $edges:ident) => {{
        let (all, mut converted) = (&mut arguments!($k, $case), $k::Macroblock::default());
        let pixels = $case.pixels.each_ref();
        $k::convert(&pixels, &all.colors, &all.gamma, &mut converted);
        let histograms = $k::analyze(&all.samples, &all.edges[0], &all.edges[1]);

        let (flags, it) = ($k::luma_modes(all, $case), &all.to.luma);
        let blocks = Vec::from_iter(it.blocks.iter().map(|it| pairs!(it, 2)));
        let y2 = (pairs!(it.y2, 2), it.y2_ends.map(|it| it[0]), flags.y2);
        let sums = [it.squared_errors, it.texture_differences];
        let luma = (blocks, it.ends, flags.blocks, y2, sums);

        let lambda = (50 * i32::from($case.steps[1])) >> 5;
        let subblocks = Vec::from_iter((0..16).map(|i| {
            let block = ($edges[i], $case.context, i);
            let last = [0, 4].map(|first| $k::subblock_modes(all, first, block, lambda));
            let it = &all.to.subblock;
            let by_mode: [_; 10] = from_fn(|mode| (it.ends[mode], it.distortions[mode]));
            (last, by_mode, pairs!(it.block, 5))
        }));

        let chroma = [None, Some(&$case.errors)].map(|errors| {
            let (edges, by, it) = (&all.edges[1], &all.chroma, &mut all.to.chroma);
            let flag = $k::try_chroma_modes(&all.samples, edges, $case.around, by, errors, it);
            let blocks = Vec::from_iter(it.blocks.iter().map(|it| pairs!(it, 2)));
            let errors = (it.dc_errors[0], it.dc_errors[1].map(|it| it[0]));
            let sums = (it.ac_counts.map(|it| it[0]), it.squared_errors);
            (flag, blocks, it.ends, errors, sums)
        });
        let histograms = histograms.map(|it| [it.highest_count, it.last_bin]);
        let converted = (converted.luma, converted.chroma);
        (converted, histograms, luma, subblocks, chroma)
    }};
}

/// The names of the kernels that differ.
#[optimize(size)]
pub(crate) fn check(random: &mut Random) -> impl Iterator<Item = &'static str> + use<> {
    let (noise, any) = (random.one_of(&[1, 3, 12, 60, 255, 256]), random.below(281));
    let step = random.one_of(&[4, 5, 16, 4 + any as u16, 284]);
    let case = &Case::new(random, noise, step);
    let edges: [_; 16] = from_fn(|i| {
        let block = case.blocks[random.one_of(&[i, 16])];
        u128::from_le_bytes(from_fn(|i| block[i / 4][i % 4])) >> 24
    });
    let (want, got) = (outcome!(highway, case, edges), outcome!(rust, case, edges));
    let results = [
        ("webp::convert", want.0 == got.0),
        ("webp::analyze", want.1 == got.1),
        ("webp::try_luma_modes", want.2 == got.2),
        ("webp::try_straight_modes or diagonal", want.3 == got.3),
        ("webp::try_chroma_modes", want.4 == got.4),
    ];
    results.into_iter().filter(|it| !it.1).map(|it| it.0)
}

#[optimize(size)]
pub(crate) fn bench() {
    let random = &mut Random(13);
    for (name, noise) in [("smooth", 3), ("busy", 60)] {
        let case = &Case::new(random, noise, 30);
        let (theirs, ours) = (&mut arguments!(highway, case), &mut arguments!(rust, case));
        macro_rules! both {
            ($name:literal, |$k:ident, $all:ident| $code:expr) => {
                compare!(
                    $name,
                    {
                        use highway as $k;
                        let $all = opaque(&mut *theirs);
                        $code
                    },
                    {
                        use rust as $k;
                        let $all = opaque(&mut *ours);
                        $code
                    }
                )
            };
        }
        both!("webp::analyze {name}", |k, it| {
            let [luma, chroma] = &it.edges;
            k::analyze(&it.samples, luma, chroma)
        });
        both!("webp::try_luma_modes {name}", |k, it| k::luma_modes(
            it, case
        ));
        for (errors, kind) in [(None, "plain"), (Some(&case.errors), "diffused")] {
            both!("webp::try_chroma_modes {name} {kind}", |k, it| {
                let (edges, by, out) = (&it.edges[1], &it.chroma, &mut it.to.chroma);
                k::try_chroma_modes(&it.samples, edges, case.around, by, errors, out)
            });
        }
        for (first, end, kind) in [(0, 4, "straight"), (4, 10, "diagonal")] {
            // Each block is predicted from the best of the one before it.
            both!("webp::try_{kind}_modes {name} x16", |k, it| {
                (0..16).fold(u128::from_le_bytes(it.edges[0].above), |edge, i| {
                    k::subblock_modes(it, first, (edge, case.context, i), 46);
                    let out = &it.to.subblock;
                    let keys = (first..end).map(|mode| out.distortions[mode] << 4 | mode as i32);
                    let best = keys.fold(i32::MAX, i32::min) as usize % 16 % 12;
                    let edges = u64::from_le_bytes(out.block.edges.as_flattened()[best]);
                    edge >> 32 << 32 | u128::from((edges >> 24) as u32)
                })
            });
        }
        let pixels = &case.pixels.each_ref();
        both!("webp::convert {name}", |k, it| {
            k::convert(pixels, &it.colors, &it.gamma, &mut it.samples);
        });
    }
}
