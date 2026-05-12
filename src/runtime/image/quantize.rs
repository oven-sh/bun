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

// PORT NOTE: Zig named this `Result`; renamed to avoid shadowing `core::result::Result`.
pub struct QuantizeResult {
    /// `[colors][4]u8` RGBA palette.
    pub palette: Box<[u8]>,
    /// One palette index per input pixel.
    pub indices: Box<[u8]>,
    /// Actual palette length (≤ requested `colors`).
    pub colors: u16,
    /// True if any palette entry has alpha < 255 — caller writes a tRNS chunk.
    pub has_alpha: bool,
}

// Zig `deinit` only freed `palette`/`indices`; both are now `Box<[u8]>`, so
// `Drop` is automatic — no explicit impl needed.

// PORT NOTE: Zig named this `Box`; renamed to avoid shadowing `std::boxed::Box`.
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
        // PORT NOTE: Zig `u2` → `u8` (Rust has no sub-byte integer types).
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

// TODO(port): move to runtime_sys
unsafe extern "C" {
    fn bun_image_nearest_palette(palette: *const u8, k: u32, r: i32, g: i32, b: i32, a: i32)
    -> u32;
}

pub struct Options {
    pub max_colors: u16,
    /// Floyd–Steinberg error diffusion. Hides banding on gradients at the
    /// cost of grain on flat areas; off by default to match Sharp's
    /// `palette:true` default.
    // PORT NOTE: Zig field default `= false`; Rust has no per-field defaults,
    // callers must pass explicitly.
    pub dither: bool,
}

pub fn quantize(rgba: &[u8], w: u32, h: u32, opts: Options) -> Result<QuantizeResult, AllocError> {
    let max_colors = opts.max_colors;
    let n: u32 = u32::try_from(rgba.len() / 4).expect("int cast");
    let want: u16 = 1.max(max_colors.min(256));

    // `order` is a permutation of pixel indices that we partition in-place;
    // each Box owns a contiguous [lo,hi) slice of it.
    let mut order: Vec<u32> = vec![0u32; n as usize];
    for (i, o) in order.iter_mut().enumerate() {
        *o = u32::try_from(i).expect("int cast");
    }

    let mut boxes: Vec<ColorBox> = Vec::with_capacity(want as usize);
    // PERF(port): was appendAssumeCapacity
    boxes.push(shrink(rgba, &order, 0, n));

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
        // PORT NOTE: std.sort.pdq + SortCtx.less → slice::sort_unstable_by_key
        // (also pdqsort). Zig's SortCtx struct is captured by the closure.
        // u32 ×4 overflows past ~1.07B pixels (allowed when the user raises
        // `maxPixels`); the other order-index sites already widen first.
        slice.sort_unstable_by_key(|&p| rgba[p as usize * 4 + ch as usize]);
        let mid = b.lo + (b.hi - b.lo) / 2;
        boxes[pick] = shrink(rgba, &order, b.lo, mid);
        // PERF(port): was appendAssumeCapacity
        boxes.push(shrink(rgba, &order, mid, b.hi));
    }

    let k: u16 = u16::try_from(boxes.len()).expect("int cast");
    let mut palette = vec![0u8; k as usize * 4];
    let mut has_alpha = false;
    for (i, b) in boxes.iter().enumerate() {
        let mut sum: [u64; 4] = [0, 0, 0, 0];
        for &px in &order[b.lo as usize..b.hi as usize] {
            for c in 0..4usize {
                sum[c] += u64::from(rgba[px as usize * 4 + c]);
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

    let mut indices = vec![0u8; n as usize];
    if opts.dither {
        map_floyd_steinberg(rgba, w, h, &palette, k, &mut indices)?;
    } else {
        // Direct nearest-entry mapping. k ≤ 256; the inner search is the
        // highway-dispatched kernel so it runs under the best -march.
        for px in 0..n as usize {
            let p = &rgba[px * 4..][..4];
            // SAFETY: palette is a valid `[k*4]u8` buffer; FFI fn is pure.
            indices[px] = u8::try_from(unsafe {
                bun_image_nearest_palette(
                    palette.as_ptr(),
                    u32::from(k),
                    i32::from(p[0]),
                    i32::from(p[1]),
                    i32::from(p[2]),
                    i32::from(p[3]),
                )
            })
            .unwrap();
        }
    }

    Ok(QuantizeResult {
        palette: palette.into_boxed_slice(),
        indices: indices.into_boxed_slice(),
        colors: k,
        has_alpha,
    })
}

/// Floyd–Steinberg error diffusion. Serial in raster order — each pixel's
/// quantisation error is pushed to its yet-unvisited neighbours with the
/// classic 7/3/5/1 ÷16 kernel:
///
///         ·   X   7
///         3   5   1
///
/// Serpentine scan (alternate L→R / R→L per row) so the diffusion direction
/// flips each row, avoiding the directional artefacts a fixed scan produces.
/// The diffusion itself can't be vectorised (data dependence on the previous
/// pixel), but the per-pixel palette search goes through the highway kernel.
fn map_floyd_steinberg(
    rgba: &[u8],
    w: u32,
    h: u32,
    palette: &[u8],
    k: u16,
    indices: &mut [u8],
) -> Result<(), AllocError> {
    // Two rows of accumulated error, ×4 channels. i32 not i16: when the
    // palette doesn't span the source range (e.g. colors:2, both entries near
    // 0, source has 255s) the residual grows without bound across the row —
    // each pixel's error is `cand − nearest`, and `cand = src + carried` keeps
    // climbing. i16 overflows there; two w×4 i32 rows are still negligible.
    // `cur` carries error pushed *into* the current row from the row above;
    // `nxt` collects error for the row below.
    let stride: usize = w as usize * 4;
    let mut cur: Vec<i32> = vec![0i32; stride];
    let mut nxt: Vec<i32> = vec![0i32; stride];
    // (Zig @memset to 0 is folded into vec! init above.)

    let mut y: u32 = 0;
    while y < h {
        let ltr = (y & 1) == 0;
        let step: i64 = if ltr { 1 } else { -1 };
        let mut x: i64 = if ltr { 0 } else { i64::from(w) - 1 };
        while x >= 0 && x < i64::from(w) {
            let px: usize = y as usize * w as usize + usize::try_from(x).expect("int cast");
            let off: usize = usize::try_from(x).expect("int cast") * 4;

            // Candidate colour = source + accumulated error (clamped for the
            // search; the *unclamped* error is what propagates so rounding
            // doesn't accumulate bias).
            let mut cand: [i32; 4] = [0; 4];
            for c in 0..4usize {
                cand[c] = i32::from(rgba[px * 4 + c]) + cur[off + c];
            }

            // SAFETY: palette is a valid `[k*4]u8` buffer; FFI fn is pure.
            let idx: u8 = u8::try_from(unsafe {
                bun_image_nearest_palette(
                    palette.as_ptr(),
                    u32::from(k),
                    clamp255(cand[0]),
                    clamp255(cand[1]),
                    clamp255(cand[2]),
                    clamp255(cand[3]),
                )
            })
            .unwrap();
            indices[px] = idx;

            for c in 0..4usize {
                let err: i32 = cand[c] - i32::from(palette[idx as usize * 4 + c]);
                // Push to the four neighbours. `dir` is +1 for L→R, −1 for R→L.
                let dir = step;
                let xr = x + dir;
                let xl = x - dir;
                if xr >= 0 && xr < i64::from(w) {
                    cur[usize::try_from(xr).expect("int cast") * 4 + c] += (err * 7) >> 4;
                }
                if xl >= 0 && xl < i64::from(w) {
                    nxt[usize::try_from(xl).expect("int cast") * 4 + c] += (err * 3) >> 4;
                }
                nxt[off + c] += (err * 5) >> 4;
                if xr >= 0 && xr < i64::from(w) {
                    nxt[usize::try_from(xr).expect("int cast") * 4 + c] += err >> 4;
                }
            }

            x += step;
        }
        // Slide: next row's error becomes current; clear next.
        core::mem::swap(&mut cur, &mut nxt);
        nxt.fill(0);

        y += 1;
    }

    Ok(())
}

#[inline]
fn clamp255(v: i32) -> i32 {
    v.max(0).min(255)
}

/// Recompute a box's tight min/max over its pixel slice.
fn shrink(rgba: &[u8], order: &[u32], lo: u32, hi: u32) -> ColorBox {
    let mut min: [u8; 4] = [255, 255, 255, 255];
    let mut max: [u8; 4] = [0, 0, 0, 0];
    for &px in &order[lo as usize..hi as usize] {
        for c in 0..4usize {
            let v = rgba[px as usize * 4 + c];
            if v < min[c] {
                min[c] = v;
            }
            if v > max[c] {
                max[c] = v;
            }
        }
    }
    ColorBox { lo, hi, min, max }
}

// ported from: src/runtime/image/quantize.zig
