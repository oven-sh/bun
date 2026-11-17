//! Arguments for the kernels of the WebP encoder.
use crate::Random;
use bun_simd_kernels::webp::*;
use core::array::from_fn;

pub(crate) struct Case {
    pub(crate) pixels: [[[u8; 4]; 16]; 16],
    pub(crate) colors: LinearColors,
    pub(crate) gamma: GammaTable,
    pub(crate) samples: Macroblock,
    /// Of luma and chroma.
    pub(crate) edges: [Edges; 2],
    pub(crate) luma: Quantizer,
    pub(crate) y2: Quantizer,
    pub(crate) chroma: Quantizer,
    pub(crate) errors: [[i16; 8]; 2],
    pub(crate) around: [[bool; 4]; 2],
    pub(crate) context: u8,
}

impl Case {
    /// The samples are up to `noise` above a slope, and in the `ranges` for the macroblock and its edges.
    #[optimize(size)]
    pub(crate) fn new(random: &mut Random, noise: usize, ac: u16, ranges: [(u8, u8); 2]) -> Self {
        let (start, [dx, dy]) = (random.below(256), [(); 2].map(|()| random.below(9)));
        let mut at = |x: usize, y: usize| match noise {
            256.. => random.one_of(&[0, 255]),
            _ => ((start + x * dx + y * dy) / 2 + random.below(noise)).min(255) as u8,
        };
        let pixels = from_fn(|y| from_fn(|x| from_fn(|_| at(x, y))));
        let mut sums = |y| from_fn(|x| u16::from(at(x, y)) * 64 + u16::from(at(x, y)) % 64);
        let sums = from_fn(|_| from_fn(|y| [sums(y), sums(4 + y)]));
        let mut at = |x, y, range: usize| at(x, y) & ranges[range].1 | ranges[range].0;
        let mut block = |n| from_fn(|x| from_fn(|y| at(n % 4 * 4 + x, n / 4 * 4 + y, 0)));
        let (luma, chroma) = (from_fn(&mut block), from_fn(&mut block));
        let edges = from_fn(|_| Edges {
            above: from_fn(|i| at(i, 0, 1)),
            left: from_fn(|i| at(0, 15 - i, 1)),
            above_left: from_fn(|_| at(0, 0, 1)),
            dc: from_fn(|_| at(4, 4, 1)),
        });
        let mut gamma: [_; 33] = from_fn(|_| random.below(256) as u8);
        gamma.sort_unstable();
        let more = random.below(4 + usize::from(ac) / 16) as u16;
        let (dc, none) = ((ac / 2 + more).clamp(4, 157), [[0; 4]; 4]);
        let sharpening = from_fn(|y| from_fn(|x| 30 * (x + y).min(3) as u8));
        let mut error = |_| random.below(dc.into()) as i16 / 2 - dc as i16 / 4;
        Self {
            errors: from_fn(|_| from_fn::<_, 4, _>(&mut error)).map(|it| from_fn(|i| it[i / 2])),
            pixels,
            colors: LinearColors { sums },
            gamma: GammaTable {
                values: from_fn(|i| gamma[i]),
                slopes: from_fn(|i| gamma[i + 1] - gamma[i]),
            },
            samples: Macroblock { luma, chroma },
            edges,
            luma: Quantizer::new([dc, ac], [96, 110], sharpening),
            y2: Quantizer::new([2 * dc, (ac * 155 / 100).max(8)], [96, 108], none),
            chroma: Quantizer::new([dc.min(132), ac], [110, 115], none),
            around: from_fn(|_| from_fn(|_| random.below(2) == 0)),
            context: random.below(3) as u8,
        }
    }

    #[inline(always)]
    pub(crate) fn try_luma_modes(&self, to: &mut Scratch) -> LumaSaturation {
        let (samples, edges, Scratch { source, luma, .. }) = (&self.samples, &self.edges[0], to);
        let (around, context) = (self.around, self.context);
        try_luma_modes(
            samples, edges, around, context, &self.luma, &self.y2, source, luma,
        )
    }

    #[inline(always)]
    pub(crate) fn try_chroma_modes(&self, diffuses: bool, to: &mut Scratch) -> bool {
        let (samples, edges, errors) = (&self.samples, &self.edges[1], &self.errors);
        let errors = diffuses.then_some(errors);
        try_chroma_modes(
            samples,
            edges,
            self.around,
            &self.chroma,
            errors,
            &mut to.chroma,
        )
    }
}
