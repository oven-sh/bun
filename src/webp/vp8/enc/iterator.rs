//! `iterator_enc.c`: goes through the macroblocks, with the samples and the contexts around the current one.

use super::dsp::{Block, Chroma, Luma};
use super::picture::Picture;
use super::{DError, Encoder};
use crate::util::{Bug, Checked, SliceExt, try_vec};
use bun_alloc::AllocError;

pub(super) struct EncIterator {
    /// The current macroblock.
    pub(super) x: usize,
    pub(super) y: usize,
    mb_w: usize,
    mb_h: usize,
    /// The input samples.
    pub(super) y_in: Luma,
    pub(super) uv_in: Chroma,
    /// The reconstructed samples.
    pub(super) y_out: Luma,
    pub(super) uv_out: Chroma,
    /// The 32 + 5 samples around the 4x4 blocks.
    i4_boundary: [u8; 37],
    /// Where the top samples of the current 4x4 block are in `i4_boundary`.
    i4_top: usize,
    /// The current 4x4 block.
    pub(super) i4: usize,
    /// Whether the blocks above have coefficients: 4 for Y, 2 for U, 2 for V, and the DC of an i16x16 macroblock.
    pub(super) top_nz: [u8; 9],
    /// The same on the left. The last one is independent of `nz`.
    pub(super) left_nz: [u8; 9],
    /// The non-zero bits of the row above, or of this row up to the current macroblock, after a 0 for the left edge.
    nz: Vec<u32>,
    /// The diffusion errors from the left, and from the row above if diffusion is on.
    pub(super) left_derr: DError,
    pub(super) top_derr: Option<Vec<DError>>,
    /// The top left sample, then the left ones.
    pub(super) y_left: [u8; 17],
    pub(super) u_left: [u8; 9],
    pub(super) v_left: [u8; 9],
    /// The samples above the row: 16 a macroblock.
    y_top: Vec<u8>,
    /// 8 of U then 8 of V a macroblock.
    uv_top: Vec<u8>,
}

/// Where the top samples of each 4x4 block are in `i4_boundary`:
///
/// ```text
/// 16|17 18 19 20|21 22 23 24|25 26 27 28|29 30 31 32|33 34 35 36  <- Top-right
/// --+-----------+-----------+-----------+-----------+
/// 15|         19|         23|         27|         31|
/// 14|         18|         22|         26|         30|
/// 13|         17|         21|         25|         29|
/// 12|13 14 15 16|17 18 19 20|21 22 23 24|25 26 27 28|
/// --+-----------+-----------+-----------+-----------+
/// 11|         15|         19|         23|         27|
/// 10|         14|         18|         22|         26|
///  9|         13|         17|         21|         25|
///  8| 9 10 11 12|13 14 15 16|17 18 19 20|21 22 23 24|
/// --+-----------+-----------+-----------+-----------+
///  7|         11|         15|         19|         23|
///  6|         10|         14|         18|         22|
///  5|          9|         13|         17|         21|
///  4| 5  6  7  8| 9 10 11 12|13 14 15 16|17 18 19 20|
/// --+-----------+-----------+-----------+-----------+
///  3|          7|         11|         15|         19|
///  2|          6|         10|         14|         18|
///  1|          5|          9|         13|         17|
///  0| 1  2  3  4| 5  6  7  8| 9 10 11 12|13 14 15 16|
/// --+-----------+-----------+-----------+-----------+
/// ```
const TOP_LEFT_I4: [u8; 16] = [17, 21, 25, 29, 13, 17, 21, 25, 9, 13, 17, 21, 5, 9, 13, 17];

/// Fills the square `dst` with the `w` by `h` samples the picture has from `start` on, repeating the last ones.
fn import_block(
    src: &[u8],
    stride: usize,
    start: usize,
    (w, h): (usize, usize),
    dst: &mut [Block],
    blocks_per_row: usize,
) -> Checked {
    let src = src.sub(start..)?;
    for (by, blocks) in dst.chunks_exact_mut(blocks_per_row).enumerate() {
        for y in 0..4 {
            let src = src.sub((4 * by + y).min(h - 1) * stride..)?.sub(..w)?;
            let mut row = [src.at(w - 1)?; 16];
            row.write_at(0, src)?;
            for (block, samples) in blocks.iter_mut().zip(row.as_chunks::<4>().0) {
                block.put(y, *samples)?;
            }
        }
    }
    Ok(())
}

/// `len` samples of `src`, `step` apart, the last one repeated to fill `dst`.
fn import_line(src: &[u8], start: usize, step: usize, dst: &mut [u8], len: usize) -> Checked {
    let mut src = src.sub(start..)?.iter().step_by(step).take(len);
    let mut last = 0;
    for dst in dst {
        if let Some(&sample) = src.next() {
            last = sample;
        }
        *dst = last;
    }
    Ok(())
}

impl EncIterator {
    pub(super) fn new(enc: &Encoder<'_>) -> Result<Self, AllocError> {
        let mut it = Self {
            x: 0,
            y: 0,
            mb_w: enc.mb_w,
            mb_h: enc.mb_h,
            y_in: Luma::default(),
            uv_in: Chroma::default(),
            y_out: Luma::default(),
            uv_out: Chroma::default(),
            i4_boundary: [0; 37],
            i4_top: 0,
            i4: 0,
            top_nz: [0; 9],
            left_nz: [0; 9],
            nz: try_vec(0, enc.mb_w + 1)?,
            left_derr: DError::default(),
            top_derr: match enc.use_error_diffusion() {
                true => Some(try_vec(DError::default(), enc.mb_w)?),
                false => None,
            },
            y_left: [0; 17],
            u_left: [0; 9],
            v_left: [0; 9],
            y_top: try_vec(0, 16 * enc.mb_w)?,
            uv_top: try_vec(0, 16 * enc.mb_w)?,
        };
        it.reset();
        Ok(it)
    }

    fn init_left(&mut self) {
        let top_left = if self.y > 0 { 129 } else { 127 };
        for left in [
            self.y_left.as_mut_slice(),
            &mut self.u_left,
            &mut self.v_left,
        ] {
            left.fill(129);
            if let Some(first) = left.first_mut() {
                *first = top_left;
            }
        }
        self.left_nz[8] = 0;
        self.left_derr = DError::default();
    }

    fn set_row(&mut self, y: usize) {
        self.x = 0;
        self.y = y;
        self.init_left();
    }

    /// Restarts the scan.
    pub(super) fn reset(&mut self) {
        self.set_row(0);
        self.y_top.fill(127);
        self.uv_top.fill(127);
        self.nz.fill(0);
        if let Some(top_derr) = &mut self.top_derr {
            top_derr.fill(DError::default());
        }
    }

    /// The samples above the macroblock.
    pub(super) fn y_top(&self) -> Checked<&[u8; 16]> {
        self.y_top.array_at(16 * self.x)
    }

    /// The samples above the macroblock, for U and for V.
    pub(super) fn uv_top(&self) -> Checked<[&[u8; 8]; 2]> {
        Ok([
            self.uv_top.array_at(16 * self.x)?,
            self.uv_top.array_at(16 * self.x + 8)?,
        ])
    }

    /// Reads the samples of the macroblock from the picture.
    pub(super) fn import(&mut self, pic: &Picture) -> Checked {
        let (x, y) = (self.x, self.y);
        let size = ((pic.width - 16 * x).min(16), (pic.height - 16 * y).min(16));
        let uv_size = (size.0.div_ceil(2), size.1.div_ceil(2));
        let y_start = (y * pic.width + x) * 16;
        let uv_start = (y * pic.uv_width + x) * 8;
        let [u_in, v_in] = &mut self.uv_in;
        import_block(&pic.y, pic.width, y_start, size, &mut self.y_in, 4)?;
        import_block(&pic.u, pic.uv_width, uv_start, uv_size, u_in, 2)?;
        import_block(&pic.v, pic.uv_width, uv_start, uv_size, v_in, 2)
    }

    /// Reads the samples around the macroblock from the picture too, as if it were compressed without loss.
    pub(super) fn import_boundary(&mut self, pic: &Picture) -> Checked {
        let (x, y) = (self.x, self.y);
        let (w, h) = ((pic.width - 16 * x).min(16), (pic.height - 16 * y).min(16));
        let (uv_w, uv_h) = (w.div_ceil(2), h.div_ceil(2));
        let y_start = (y * pic.width + x) * 16;
        let uv_start = (y * pic.uv_width + x) * 8;
        let planes = [
            (&pic.y, pic.width, y_start, w, h),
            (&pic.u, pic.uv_width, uv_start, uv_w, uv_h),
            (&pic.v, pic.uv_width, uv_start, uv_w, uv_h),
        ];

        if x == 0 {
            self.init_left();
        } else {
            let lefts = [
                self.y_left.as_mut_slice(),
                &mut self.u_left,
                &mut self.v_left,
            ];
            for (left, (src, stride, start, _, h)) in lefts.into_iter().zip(planes) {
                let (top_left, left) = left.split_first_mut().ok_or(Bug)?;
                *top_left = if y == 0 {
                    127
                } else {
                    src.at(start - 1 - stride)?
                };
                import_line(src, start - 1, stride, left, h)?;
            }
        }

        let y_top = self.y_top.array_at_mut::<16>(16 * x)?;
        let uv_top = self.uv_top.array_at_mut::<16>(16 * x)?;
        if y == 0 {
            y_top.fill(127);
            uv_top.fill(127);
        } else {
            let (u_top, v_top) = uv_top.halves_mut(8)?;
            for (top, (src, stride, start, w, _)) in
                [y_top.as_mut_slice(), u_top, v_top].into_iter().zip(planes)
            {
                import_line(src, start - stride, 1, top, w)?;
            }
        }
        Ok(())
    }

    //------------------------------------------------------------------------------
    // Non-zero contexts.
    //
    //  0  1  2  3  Y
    //  4  5  6  7
    //  8  9 10 11
    // 12 13 14 15
    // 16 17        U
    // 18 19
    // 20 21        V
    // 22 23
    // 24           DC-intra16

    pub(super) fn nz_to_bytes(&mut self) -> Checked {
        let (tnz, lnz) = (self.nz.at(self.x + 1)?, self.nz.at(self.x)?);
        let bit = |nz: u32, n: u32| ((nz >> n) & 1) as u8;
        self.top_nz = [12, 13, 14, 15, 18, 19, 22, 23, 24].map(|n| bit(tnz, n));
        let left_dc = self.left_nz[8];
        self.left_nz = [3, 7, 11, 15, 17, 19, 21, 23, 0].map(|n| bit(lnz, n));
        self.left_nz[8] = left_dc;
        Ok(())
    }

    pub(super) fn bytes_to_nz(&mut self) -> Checked {
        let [t0, t1, t2, t3, t4, t5, t6, t7, t8] = self.top_nz.map(u32::from);
        let [l0, l1, l2, _, l4, _, l6, _, _] = self.left_nz.map(u32::from);
        let top = (t0 << 12) | (t1 << 13) | (t2 << 14) | (t3 << 15);
        let top_uv = (t4 << 18) | (t5 << 19) | (t6 << 22) | (t7 << 23);
        let left = (l0 << 3) | (l1 << 7) | (l2 << 11) | (l4 << 17) | (l6 << 21);
        self.nz.put(self.x + 1, top | top_uv | (t8 << 24) | left)
    }

    //------------------------------------------------------------------------------

    /// Keeps the edges of the reconstructed macroblock for the next ones.
    pub(super) fn save_boundary(&mut self) -> Checked {
        let [u_out, v_out] = &self.uv_out;
        if self.x + 1 < self.mb_w {
            // The top left sample first, before `y_top` changes.
            let [u_top, v_top] = self.uv_top()?;
            let top_left = [self.y_top()?[15], u_top[7], v_top[7]];
            let right_column = |blocks: &[Block], blocks_per_row: usize, left: &mut [u8]| {
                let right_blocks = blocks
                    .iter()
                    .skip(blocks_per_row - 1)
                    .step_by(blocks_per_row);
                let samples = right_blocks.flat_map(|block| block.map(|[.., sample]| sample));
                for (left, sample) in left.iter_mut().skip(1).zip(samples) {
                    *left = sample;
                }
            };
            right_column(&self.y_out, 4, &mut self.y_left);
            right_column(u_out, 2, &mut self.u_left);
            right_column(v_out, 2, &mut self.v_left);
            [self.y_left[0], self.u_left[0], self.v_left[0]] = top_left;
        }
        if self.y + 1 < self.mb_h {
            let bottom_row = |blocks: &[Block], top: &mut [u8]| {
                for (top, [.., bottom]) in top.as_chunks_mut().0.iter_mut().zip(blocks) {
                    *top = *bottom;
                }
            };
            let [.., y0, y1, y2, y3] = self.y_out;
            let ([.., u0, u1], [.., v0, v1]) = (*u_out, *v_out);
            bottom_row(
                &[y0, y1, y2, y3],
                self.y_top.array_at_mut::<16>(16 * self.x)?,
            );
            bottom_row(
                &[u0, u1, v0, v1],
                self.uv_top.array_at_mut::<16>(16 * self.x)?,
            );
        }
        Ok(())
    }

    /// Goes to the next macroblock. Returns false if there is none.
    pub(super) fn next(&mut self) -> bool {
        self.x += 1;
        if self.x == self.mb_w {
            self.set_row(self.y + 1);
        }
        self.y < self.mb_h
    }

    // Intra4x4 sub-blocks iteration

    pub(super) fn start_i4(&mut self) -> Checked {
        self.i4 = 0;
        self.i4_top = usize::from(TOP_LEFT_I4[0]);

        let y_top = *self.y_top()?;
        let top_right = if self.x + 1 < self.mb_w {
            *self.y_top.array_at::<4>(16 * self.x + 16)?
        } else {
            [y_top[15]; 4]
        };
        let left = self.y_left.iter().rev();
        let samples = left.chain(&y_top).chain(&top_right);
        for (dst, &sample) in self.i4_boundary.iter_mut().zip(samples) {
            *dst = sample;
        }
        self.nz_to_bytes()
    }

    /// The samples around the current 4x4 block, as `intra4_preds` takes them.
    pub(super) fn i4_edge(&self) -> Checked<&[u8; 13]> {
        self.i4_boundary.array_at(self.i4_top - 5)
    }

    /// Goes to the next 4x4 block, now that the current one is reconstructed as `block`. Returns false if there is none.
    pub(super) fn rotate_i4(&mut self, block: &Block) -> Checked<bool> {
        let [bottom @ .., top0, top1, top2, top3, r0, r1, r2, r3] =
            self.i4_boundary.array_at_mut::<12>(self.i4_top - 4)?;
        *bottom = block[3];
        if self.i4 & 3 != 3 {
            [*top0, *top1, *top2] = [block[2][3], block[1][3], block[0][3]];
        } else {
            // The blocks on the right all use the samples above the next macroblock.
            [*top0, *top1, *top2, *top3] = [*r0, *r1, *r2, *r3];
        }
        self.i4 += 1;
        let Some(&top) = TOP_LEFT_I4.get(self.i4) else {
            return Ok(false);
        };
        self.i4_top = usize::from(top);
        Ok(true)
    }
}
