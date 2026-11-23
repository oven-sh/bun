//! Median-cut colour quantizer for `.png({ palette: true, colors: N })`.
//!
//! Goal is "good enough to match Sharp's palette PNG path for screenshot
//! compression", not perceptual perfection — Sharp uses libimagequant which
//! is GPL, so we roll a small permissive one. Median-cut is the classic
//! Heckbert '82 algorithm: treat the RGBA pixels as points in a 4-D box,
//! repeatedly split the box with the largest channel range at that channel's
//! median until you have N boxes, then each box's mean becomes a palette
//! entry. Mapping is nearest-entry by squared RGBA distance, optionally with
//! Floyd–Steinberg error diffusion (`dither: true`).

use bun_alloc::AllocError;

pub(crate) struct QuantizeResult {
    /// `[colors][4]u8` RGBA palette, of at most the requested `colors`.
    pub palette: Box<[u8]>,
    /// One palette index per input pixel.
    pub indices: Box<[u8]>,
    /// True if any palette entry has alpha < 255 — caller writes a tRNS chunk.
    pub has_alpha: bool,
}

// `palette`/`indices` are `Box<[u8]>`, so
// `Drop` is automatic — no explicit impl needed.

#[derive(Clone, Copy)]
struct ColorBox {
    /// Slice into the shared `order` index buffer.
    lo: u32,
    hi: u32,
    min: [u8; 4],
    max: [u8; 4],
}

impl ColorBox {
    fn widest_channel(self) -> u8 {
        let mut best: u8 = 0;
        let mut span: i32 = -1;
        for c in 0..4usize {
            let s: i32 = i32::from(self.max[c]) - i32::from(self.min[c]);
            if s > span {
                span = s;
                best = u8::try_from(c).expect("int cast");
            }
        }
        best
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Options {
    pub(crate) max_colors: u16,
    /// Floyd–Steinberg error diffusion. Hides banding on gradients at the
    /// cost of grain on flat areas; off by default to match Sharp's
    /// `palette:true` default.
    // No `Default` impl — callers must
    // pass this explicitly.
    pub(crate) dither: bool,
}

pub(crate) fn quantize(
    rgba: &[u8],
    w: u32,
    h: u32,
    opts: Options,
) -> Result<QuantizeResult, AllocError> {
    let max_colors = opts.max_colors;
    let n: u32 = u32::try_from(rgba.len() / 4).expect("int cast");
    let want: u16 = 1.max(max_colors.min(256));

    // A copy of the pixels that we partition in-place; each Box owns a
    // contiguous [lo,hi) slice of it.
    let pixels = rgba.as_chunks().0.iter();
    let mut order: Vec<u32> = pixels.map(|&px| u32::from_le_bytes(px)).collect();

    let mut boxes: Vec<ColorBox> = Vec::with_capacity(want as usize);
    boxes.push(shrink(&order, 0, n));

    while boxes.len() < want as usize {
        // Pick the box with the largest single-channel range — the one that
        // most wants splitting.
        let mut pick: usize = 0;
        let mut best: i32 = -1;
        for (i, b) in boxes.iter().enumerate() {
            let c = b.widest_channel();
            let s: i32 = i32::from(b.max[c as usize]) - i32::from(b.min[c as usize]);
            if s > best {
                best = s;
                pick = i;
            }
        }
        if best <= 0 {
            break; // every remaining box is a single colour
        }
        let b = boxes[pick];
        if b.hi - b.lo < 2 {
            break;
        }

        let ch = b.widest_channel();
        // Partial sort by the chosen channel, then cut at the midpoint.
        let slice = &mut order[b.lo as usize..b.hi as usize];
        slice.sort_unstable_by_key(|&px| (px >> (8 * ch)) as u8);
        let mid = b.lo + (b.hi - b.lo) / 2;
        boxes[pick] = shrink(&order, b.lo, mid);
        boxes.push(shrink(&order, mid, b.hi));
    }

    let k: u16 = u16::try_from(boxes.len()).expect("int cast");
    let mut palette = vec![0u8; k as usize * 4];
    let mut has_alpha = false;
    for (i, b) in boxes.iter().enumerate() {
        let mut sum: [u64; 4] = [0, 0, 0, 0];
        for &px in &order[b.lo as usize..b.hi as usize] {
            for c in 0..4usize {
                sum[c] += u64::from(px.to_le_bytes()[c]);
            }
        }
        let cnt: u64 = u64::from(b.hi - b.lo);
        for c in 0..4usize {
            palette[i * 4 + c] = u8::try_from((sum[c] + cnt / 2) / cnt).expect("int cast");
        }
        if palette[i * 4 + 3] < 255 {
            has_alpha = true;
        }
    }

    let indices = bun_image_ops::Image::new(rgba, w, h)
        .and_then(|image| image.to_indices(palette.as_chunks().0, opts.dither))
        .map_err(|_| AllocError)?;

    Ok(QuantizeResult {
        palette: palette.into_boxed_slice(),
        indices: indices.into_boxed_slice(),
        has_alpha,
    })
}

/// Recompute a box's tight min/max over its pixel slice.
fn shrink(order: &[u32], lo: u32, hi: u32) -> ColorBox {
    let [min, max] = bun_image_ops::extremes(&order[lo as usize..hi as usize]);
    ColorBox { lo, hi, min, max }
}
