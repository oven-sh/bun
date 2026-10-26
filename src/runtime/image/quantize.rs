//! Colour quantizer for `.png({ palette: true, colors: N })`.
//!
//! Goal is "good enough to match Sharp's palette PNG path for screenshot
//! compression", not perceptual perfection — Sharp uses libimagequant which
//! is GPL, so we roll a small permissive one: boxes cut by squared error, each box one palette
//! entry. Mapping is nearest-entry by squared RGBA distance, optionally with
//! Floyd–Steinberg error diffusion (`dither: true`).

use bun_alloc::AllocError;

pub(crate) struct QuantizeResult {
    /// `[colors][4]u8` RGBA palette.
    pub palette: Box<[u8]>,
    /// One palette index per input pixel.
    pub indices: Box<[u8]>,
    /// Actual palette length (≤ requested `colors`).
    pub colors: u16,
    /// True if any palette entry has alpha < 255 — caller writes a tRNS chunk.
    pub has_alpha: bool,
}

// `palette`/`indices` are `Box<[u8]>`, so
// `Drop` is automatic — no explicit impl needed.

unsafe extern "C" {
    fn bun_image_nearest_palette(palette: *const u8, k: u32, r: i32, g: i32, b: i32, a: i32)
    -> u32;
    /// Copies the pixels that are not fully transparent to `dst`. Returns how many that is.
    fn bun_image_shown_compact(dst: *mut u8, src: *const u8, n: usize) -> usize;
}

#[derive(Clone, Copy)]
pub(crate) struct Options {
    pub(crate) max_colors: u16,
    /// Floyd–Steinberg error diffusion. Hides banding on gradients at the
    /// cost of grain on flat areas; off by default.
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
    let (pixels, _) = rgba.as_chunks::<4>();
    // The sums and products below are exact for fewer than 2^32 pixels.
    let n: usize = u32::try_from(pixels.len()).map_err(|_| AllocError)? as usize;
    let want: usize = usize::from(opts.max_colors.clamp(1, 256));

    let mut indices: Vec<u8> = try_filled(n)?;
    let palette: Vec<u8> = match exact_palette(pixels, want, &mut indices) {
        // Every pixel has its own entry, so there is no error to diffuse.
        Some(palette) => palette,
        None => {
            // At most `want` entries: fewer when transparent pixels hid the colours over the limit.
            let palette = split_boxes(pixels, want)?;
            let k: u16 = u16::try_from(palette.len() / 4).expect("int cast");
            if opts.dither {
                map_floyd_steinberg(rgba, w, h, &palette, k, &mut indices)?;
            } else {
                // Alpha is the top byte of a key: a transparent pixel is searched as `[0; 4]`.
                map_runs(pixels, &mut indices, |key| {
                    nearest(&palette, k, if key >> 24 == 0 { 0 } else { key })
                });
            }
            palette
        }
    };

    Ok(QuantizeResult {
        colors: u16::try_from(palette.len() / 4).expect("int cast"),
        has_alpha: palette
            .as_chunks::<4>()
            .0
            .iter()
            .any(|entry| entry[3] < 255),
        palette: palette.into_boxed_slice(),
        indices: indices.into_boxed_slice(),
    })
}

/// `len` default values, or `AllocError` when there is no memory for them.
fn try_filled<T: Clone + Default>(len: usize) -> Result<Vec<T>, AllocError> {
    let mut v: Vec<T> = Vec::new();
    v.try_reserve_exact(len).map_err(|_| AllocError)?;
    v.resize(len, T::default());
    Ok(v)
}

/// What every fully transparent pixel shows: no colour.
const CLEAR: [u8; 4] = [0; 4];

/// A fully transparent pixel shows no colour: in an image that does not fit, it is `CLEAR`.
fn shown(pixel: [u8; 4]) -> [u8; 4] {
    if pixel[3] == 0 { CLEAR } else { pixel }
}

/// One slot of an open-addressing table from a colour to its palette index plus 1.
#[derive(Clone, Copy, Default)]
struct Slot {
    /// The pixel's four bytes, little-endian on every target.
    key: u32,
    /// 0 marks an empty slot.
    val: u32,
}

/// The palette when the image has at most `want` colours, in first-seen order. Fills `indices`.
fn exact_palette(pixels: &[[u8; 4]], want: usize, indices: &mut [u8]) -> Option<Vec<u8>> {
    // `want` ≤ 256 keys in 512 slots: the table is never full and a probe passes at most 256.
    let mut slots = [Slot::default(); 512];
    let mut seen: Vec<u8> = Vec::with_capacity(want * 4);
    // Flat images are runs of one colour: the previous pixel's answer.
    let mut last: Option<(u32, u8)> = None;
    for (p, out) in pixels.iter().zip(indices.iter_mut()) {
        let key = u32::from_le_bytes(*p);
        *out = match last {
            Some((last_key, idx)) if last_key == key => idx,
            _ => {
                // Multiplicative hash: the top 9 bits depend on every byte of the key.
                let mut i = (key.wrapping_mul(0x9E37_79B1) >> 23) as usize;
                while slots[i].val != 0 && slots[i].key != key {
                    i = (i + 1) & 511;
                }
                let slot = &mut slots[i];
                if slot.val == 0 {
                    if seen.len() == want * 4 {
                        return None;
                    }
                    seen.extend_from_slice(p);
                    *slot = Slot {
                        key,
                        val: u32::try_from(seen.len() / 4).expect("int cast"),
                    };
                }
                let idx = u8::try_from(slot.val - 1).expect("int cast");
                last = Some((key, idx));
                idx
            }
        };
    }
    Some(seen)
}

/// Count, sums and sums of squares of a set of pixels: enough for its mean and squared error.
#[derive(Clone, Copy, Default)]
struct Moments {
    n: u64,
    sum: [u64; 4],
    sq: [u64; 4],
}

impl Moments {
    /// `count` pixels of one colour.
    fn of(pixel: [u8; 4], count: u64) -> Moments {
        let mut out = Moments {
            n: count,
            ..Moments::default()
        };
        for c in 0..4usize {
            let v = u64::from(pixel[c]);
            out.sum[c] = count * v;
            out.sq[c] = count * v * v;
        }
        out
    }

    fn add(&mut self, pixel: [u8; 4]) {
        self.n += 1;
        for c in 0..4usize {
            let v = u64::from(pixel[c]);
            self.sum[c] += v;
            self.sq[c] += v * v;
        }
    }

    fn minus(&self, other: &Moments) -> Moments {
        let mut out = *self;
        out.n -= other.n;
        for c in 0..4usize {
            out.sum[c] -= other.sum[c];
            out.sq[c] -= other.sq[c];
        }
        out
    }

    /// `n` × squared error of channel `c` about its mean. Exact: n < 2^32, sum < 2^40, sq < 2^48.
    fn error_times_n(&self, c: usize) -> u128 {
        u128::from(self.n) * u128::from(self.sq[c])
            - u128::from(self.sum[c]) * u128::from(self.sum[c])
    }

    /// `n` times the squared error over all four channels.
    fn total_error_times_n(&self) -> u128 {
        (0..4usize).map(|c| self.error_times_n(c)).sum()
    }

    /// The channel with the largest squared error.
    fn channel_to_split(&self) -> usize {
        let mut best: usize = 0;
        for c in 1..4usize {
            if self.error_times_n(c) > self.error_times_n(best) {
                best = c;
            }
        }
        best
    }

    fn mean(&self) -> [u8; 4] {
        let mut out = [0u8; 4];
        for c in 0..4usize {
            out[c] = u8::try_from((self.sum[c] + self.n / 2) / self.n).expect("int cast");
        }
        out
    }
}

#[derive(Clone, Copy)]
struct ColorBox {
    /// Slice into the copy of the pixels.
    lo: usize,
    hi: usize,
    moments: Moments,
    /// `moments.total_error_times_n()`, kept for the choice of the next box.
    error_times_n: u128,
}

impl ColorBox {
    fn new(lo: usize, hi: usize, moments: &Moments) -> ColorBox {
        ColorBox {
            lo,
            hi,
            moments: *moments,
            error_times_n: moments.total_error_times_n(),
        }
    }
}

/// Split the pixels into `want` boxes (fewer if each is one colour). Each box gives one entry.
fn split_boxes(pixels: &[[u8; 4]], want: usize) -> Result<Vec<u8>, AllocError> {
    // The boxes are ranges of a copy. A cut is a value of a channel: equal colours stay together.
    // Fully transparent pixels are not copied: box 0 has `clear` more, below every cut of it.
    let (mut pixels, clear) = {
        let mut copy: Vec<[u8; 4]> = Vec::new();
        copy.try_reserve_exact(pixels.len())
            .map_err(|_| AllocError)?;
        // SAFETY: `copy` has room for `pixels.len()` pixels, and the kernel writes inside that.
        let kept = unsafe {
            bun_image_shown_compact(
                copy.as_mut_ptr().cast(),
                pixels.as_ptr().cast(),
                pixels.len(),
            )
        };
        // SAFETY: the kernel wrote the first `kept` pixels.
        unsafe { copy.set_len(kept) };
        (copy, (pixels.len() - kept) as u64)
    };
    // Sums per value of the split channel. `cut` leaves it zero.
    let mut at_value: Vec<Sums> = try_filled(256)?;
    let mut all = Moments::of(CLEAR, clear);
    for &pixel in &pixels {
        all.add(pixel);
    }
    let mut boxes: Vec<ColorBox> = Vec::with_capacity(want);
    boxes.push(ColorBox::new(0, pixels.len(), &all));
    while boxes.len() < want {
        // The box with the most squared error: its index, `error_times_n` and `n`.
        let mut pick: Option<(usize, u128, u64)> = None;
        for (i, b) in boxes.iter().enumerate() {
            if b.moments.n < 2 {
                continue;
            }
            // error_b / n_b > error_p / n_p, cross-multiplied (< 2^114).
            if pick.is_none_or(|(_, error, n)| {
                b.error_times_n * u128::from(n) > error * u128::from(b.moments.n)
            }) {
                pick = Some((i, b.error_times_n, b.moments.n));
            }
        }
        let Some((pick, _, _)) = pick else { break };
        let b = boxes[pick];
        let ch = b.moments.channel_to_split();
        let slice = &mut pixels[b.lo..b.hi];
        let clear_here = if pick == 0 { clear } else { 0 };
        // A box of one colour has no cut, and then no other box has error.
        let Some((value, below)) = cut(slice, ch, &b.moments, &mut at_value, clear_here) else {
            break;
        };
        // Part two starts `below` pixels in: only a pixel on the wrong side of that changes places.
        let at = usize::try_from(below - clear_here).expect("int cast");
        let (first, second) = slice.split_at_mut(at);
        let mut from: usize = 0;
        for pixel in first.iter_mut() {
            if pixel[ch] >= value {
                while second[from][ch] >= value {
                    from += 1;
                }
                core::mem::swap(pixel, &mut second[from]);
                from += 1;
            }
        }
        debug_assert!(first.iter().all(|pixel| pixel[ch] < value));
        debug_assert!(second.iter().all(|pixel| pixel[ch] >= value));
        // Only the shorter part is summed. The other part is the rest of the box.
        let sum_first = first.len() <= second.len();
        let (summed, clear_summed) = if sum_first {
            (&*first, clear_here)
        } else {
            (&*second, 0)
        };
        let mut part = Moments::of(CLEAR, clear_summed);
        for &pixel in summed {
            part.add(pixel);
        }
        let rest = b.moments.minus(&part);
        let (left, right) = if sum_first {
            (part, rest)
        } else {
            (rest, part)
        };
        boxes[pick] = ColorBox::new(b.lo, b.lo + at, &left);
        boxes.push(ColorBox::new(b.lo + at, b.hi, &right));
    }
    let mut palette: Vec<u8> = Vec::with_capacity(boxes.len() * 4);
    for (i, b) in boxes.iter().enumerate() {
        let clear_here = if i == 0 { clear } else { 0 };
        let entry = majority(&pixels[b.lo..b.hi], clear_here).unwrap_or_else(|| b.moments.mean());
        palette.extend_from_slice(&entry);
    }
    Ok(palette)
}

/// The colour on over half of a box (`pixels` and `clear` fully transparent ones): a flat background stays exact.
fn majority(pixels: &[[u8; 4]], clear: u64) -> Option<[u8; 4]> {
    let n = pixels.len() as u64 + clear;
    if clear * 2 > n {
        return Some(CLEAR);
    }
    // One vote per pixel finds the only colour that can have more than half. A count confirms it.
    let (mut colour, mut votes) = ([0u8; 4], 0usize);
    for &pixel in pixels {
        if votes == 0 {
            colour = pixel;
        }
        if pixel == colour {
            votes += 1;
        } else {
            votes -= 1;
        }
    }
    let count = pixels.iter().filter(|&&pixel| pixel == colour).count() as u64;
    (count * 2 > n).then_some(colour)
}

/// Pixel count and channel sums of the pixels that have one value of a channel.
#[derive(Clone, Copy, Default)]
struct Sums {
    n: u64,
    sum: [u64; 4],
}

/// The least-error cut of a box (`pixels` and `clear` fully transparent ones): the value that starts part two, and the count below it.
fn cut(
    pixels: &[[u8; 4]],
    ch: usize,
    total: &Moments,
    at_value: &mut [Sums],
    clear: u64,
) -> Option<(u8, u64)> {
    // One bit per value of `ch` that the box has: a box of a few pixels has few of the 256.
    let mut has = [0u64; 4];
    if clear != 0 {
        let value = usize::from(CLEAR[ch]);
        has[value >> 6] |= 1 << (value & 63);
        at_value[value].n = clear;
        at_value[value].sum = CLEAR.map(|v| clear * u64::from(v));
    }
    // One step per run of equal pixels: a flat area would write the same sums once per pixel.
    for run in pixels.chunk_by(|a, b| a == b) {
        let pixel = run[0];
        let count = run.len() as u64;
        let value = usize::from(pixel[ch]);
        has[value >> 6] |= 1 << (value & 63);
        let sums = &mut at_value[value];
        sums.n += count;
        for c in 0..4usize {
            sums.sum[c] += count * u64::from(pixel[c]);
        }
    }
    // The sum of squares is fixed: least error is the largest L²/nL + R²/nR over the parts' sums.
    let mut left = Sums::default();
    let mut best: Option<(u128, u8, u64)> = None;
    for (word, mut bits) in has.into_iter().enumerate() {
        while bits != 0 {
            let value = word * 64 + bits.trailing_zeros() as usize;
            bits &= bits - 1;
            let sums = core::mem::take(&mut at_value[value]);
            left.n += sums.n;
            // Nothing is past the last value, so no cut is there.
            if left.n == total.n {
                break;
            }
            let mut left_sq: u128 = 0;
            let mut right_sq: u128 = 0;
            for c in 0..4usize {
                left.sum[c] += sums.sum[c];
                let l = u128::from(left.sum[c]);
                let r = u128::from(total.sum[c] - left.sum[c]);
                left_sq += l * l;
                right_sq += r * r;
            }
            // 32 fraction bits (< 2^115 in all): whole units tie in a box of a few pixels.
            let score = (left_sq << 32) / u128::from(left.n)
                + (right_sq << 32) / u128::from(total.n - left.n);
            if best.is_none_or(|(s, _, _)| score > s) {
                best = Some((score, u8::try_from(value + 1).expect("int cast"), left.n));
            }
        }
    }
    best.map(|(_, value, below)| (value, below))
}

/// Index of the palette entry nearest to the colour `key`, the first one on a tie.
#[inline]
fn nearest(palette: &[u8], k: u16, key: u32) -> u8 {
    let [r, g, b, a] = key.to_le_bytes().map(i32::from);
    // SAFETY: palette is a valid `[k*4]u8` buffer; FFI fn is pure.
    u8::try_from(unsafe { bun_image_nearest_palette(palette.as_ptr(), u32::from(k), r, g, b, a) })
        .expect("int cast")
}

/// Write every pixel's palette index, asking `index_of` once per run of equal pixels.
fn map_runs(pixels: &[[u8; 4]], indices: &mut [u8], mut index_of: impl FnMut(u32) -> u8) {
    let mut last: Option<(u32, u8)> = None;
    for (p, out) in pixels.iter().zip(indices.iter_mut()) {
        let key = u32::from_le_bytes(*p);
        *out = match last {
            Some((last_key, idx)) if last_key == key => idx,
            _ => {
                let idx = index_of(key);
                last = Some((key, idx));
                idx
            }
        };
    }
}

/// Floyd–Steinberg error diffusion. Serial in raster order — each pixel's
/// quantisation error is pushed to its yet-unvisited neighbours with the
/// classic 7/3/5/1 ÷16 kernel:
///
/// ```text
/// ·   X   7
/// 3   5   1
/// ```
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
    // Two rows of accumulated error in sixteenths of a level, ×4 channels.
    // `cur` carries error pushed *into* the current row from the row above;
    // `nxt` collects error for the row below.
    let (pixels, _) = rgba.as_chunks::<4>();
    let stride: usize = w as usize * 4;
    let mut cur: Vec<i32> = vec![0i32; stride];
    let mut nxt: Vec<i32> = vec![0i32; stride];

    let mut y: u32 = 0;
    while y < h {
        let ltr = (y & 1) == 0;
        let step: i64 = if ltr { 1 } else { -1 };
        let mut x: i64 = if ltr { 0 } else { i64::from(w) - 1 };
        while x >= 0 && x < i64::from(w) {
            let px: usize = y as usize * w as usize + usize::try_from(x).expect("int cast");
            let off: usize = usize::try_from(x).expect("int cast") * 4;

            // Source + carried error, in sixteenths, kept inside 0..255. `cand`: nearest level.
            let source = shown(pixels[px]);
            let mut wanted: [i32; 4] = [0; 4];
            let mut cand: [i32; 4] = [0; 4];
            for c in 0..4usize {
                wanted[c] = (16 * i32::from(source[c]) + cur[off + c]).clamp(0, 16 * 255);
                cand[c] = (wanted[c] + 8) >> 4;
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
                let err: i32 = wanted[c] - 16 * i32::from(palette[idx as usize * 4 + c]);
                // Three shares round toward zero; `below` takes the rest, so they sum to `err`.
                let ahead = err * 7 / 16;
                let below_behind = err * 3 / 16;
                let below_ahead = err / 16;
                let below = err - ahead - below_behind - below_ahead;
                // Push to the four neighbours. `dir` is +1 for L→R, −1 for R→L.
                let dir = step;
                let xr = x + dir;
                let xl = x - dir;
                if xr >= 0 && xr < i64::from(w) {
                    cur[usize::try_from(xr).expect("int cast") * 4 + c] += ahead;
                }
                if xl >= 0 && xl < i64::from(w) {
                    nxt[usize::try_from(xl).expect("int cast") * 4 + c] += below_behind;
                }
                nxt[off + c] += below;
                if xr >= 0 && xr < i64::from(w) {
                    nxt[usize::try_from(xr).expect("int cast") * 4 + c] += below_ahead;
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
    v.clamp(0, 255)
}
