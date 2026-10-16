//! Colour quantizer for `.png({ palette: true, colors: N })`.
//!
//! Goal is "good enough to match Sharp's palette PNG path for screenshot
//! compression", not perceptual perfection — Sharp uses libimagequant which
//! is GPL, so we roll a small permissive one: distinct colours in boxes, each box's mean a palette
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
    // Pixel counts are kept in u32 from here on.
    let n: usize = u32::try_from(pixels.len()).expect("int cast") as usize;
    let want: usize = usize::from(opts.max_colors.clamp(1, 256));

    let mut indices: Vec<u8> = try_filled(n)?;
    let palette: Vec<u8> = match scan(pixels, want, &mut indices) {
        // Every pixel has its own entry, so there is no error to diffuse.
        Scan::Fits(palette) => palette,
        Scan::Over { seen, at } => {
            let (mut bins, table) = count_colors(pixels, &seen, &indices[..at], want)?;
            // More than `want` colours, so this is `want` entries.
            let palette = split_boxes(&mut bins, want);
            drop(bins);
            let k: u16 = u16::try_from(palette.len() / 4).expect("int cast");
            if opts.dither {
                drop(table);
                map_floyd_steinberg(rgba, w, h, &palette, k, &mut indices)?;
            } else if let Some(mut slots) = table {
                // One search per colour: each count becomes the index of the nearest entry, plus 1.
                for slot in slots.iter_mut().filter(|slot| slot.val != 0) {
                    slot.val = u32::from(nearest(&palette, k, slot.key)) + 1;
                }
                // Past the probe budget a search gives the same answer.
                let mut budget = PROBE_BUDGET * pixels.len();
                map_runs(pixels, &mut indices, |key| {
                    if budget == 0 {
                        return nearest(&palette, k, key);
                    }
                    let (slot, passed) = slot_for(&mut slots, key);
                    budget = budget.saturating_sub(passed);
                    u8::try_from(slot.val - 1).expect("int cast")
                });
            } else {
                map_runs(pixels, &mut indices, |key| nearest(&palette, k, key));
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

/// One slot of an open-addressing table from a colour to a non-zero number.
#[derive(Clone, Copy, Default)]
struct Slot {
    /// The pixel's four bytes, little-endian on every target.
    key: u32,
    /// 0 marks an empty slot.
    val: u32,
}

/// Slots that probes may pass, per pixel. The hash is fixed: colours built to collide pass more.
const PROBE_BUDGET: usize = 4;

/// The slot of `key` or the empty one for it, and the slots the probe passed. `slots.len()` is 2^n.
#[inline]
fn slot_for(slots: &mut [Slot], key: u32) -> (&mut Slot, usize) {
    let mask = slots.len() - 1;
    // Multiplicative hash: the top bits depend on every byte of the key.
    let mut i = (key.wrapping_mul(0x9E37_79B1) >> (32 - slots.len().trailing_zeros())) as usize;
    let mut passed: usize = 0;
    // A table is never full, so the walk ends.
    while slots[i].val != 0 && slots[i].key != key {
        i = (i + 1) & mask;
        passed += 1;
    }
    (&mut slots[i], passed)
}

/// What the first pass over the pixels found.
enum Scan {
    /// At most `want` colours: the palette, in order of first appearance. `indices` is complete.
    Fits(Vec<u8>),
    /// Pixel `at` is the first with a colour not in `seen`. `indices[..at]` index `seen`.
    Over { seen: Vec<u8>, at: usize },
}

fn scan(pixels: &[[u8; 4]], want: usize, indices: &mut [u8]) -> Scan {
    // `want` ≤ 256 keys in 512 slots: a probe passes at most 256 of them.
    let mut slots = [Slot::default(); 512];
    let mut seen: Vec<u8> = Vec::with_capacity(want * 4);
    // Flat images are runs of one colour: the previous pixel's answer.
    let mut last: Option<(u32, u8)> = None;
    for ((at, p), out) in pixels.iter().enumerate().zip(indices.iter_mut()) {
        let key = u32::from_le_bytes(*p);
        *out = match last {
            Some((last_key, idx)) if last_key == key => idx,
            _ => {
                let (slot, _) = slot_for(&mut slots, key);
                if slot.val == 0 {
                    if seen.len() == want * 4 {
                        return Scan::Over { seen, at };
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
    Scan::Fits(seen)
}

/// One distinct colour and the number of pixels that have it.
#[derive(Clone, Copy)]
struct Bin {
    rgba: [u8; 4],
    count: u32,
}

/// Colours per palette entry the count table takes before it asks whether they repeat.
const TABLE_COLORS_PER_ENTRY: usize = 1024;
/// Past that, it takes a new colour while the colours so far cover this many pixels each.
const TABLE_PIXELS_PER_COLOR: usize = 8;

/// Colours the count table takes whatever they are.
fn table_room(want: usize) -> usize {
    TABLE_COLORS_PER_ENTRY * want.max(16)
}

/// Pixel counts by colour. A photo has too many colours for a table to pay: its pixels are sorted.
struct Counts {
    /// Each `val` is the pixel count of `key`. At most half full.
    slots: Vec<Slot>,
    distinct: usize,
    /// Pixels counted so far.
    pixels: usize,
    /// Slots that probes passed so far.
    passed: usize,
    /// `table_room` of the palette size.
    room: usize,
    /// Colours it takes at most.
    most: usize,
}

impl Counts {
    /// False when `key` is new and not taken, or the probes passed more slots than the budget.
    fn add(&mut self, key: u32, count: u32) -> Result<bool, AllocError> {
        self.pixels += count as usize;
        let (slot, passed) = slot_for(&mut self.slots, key);
        self.passed += passed;
        if self.passed > PROBE_BUDGET * self.pixels {
            return Ok(false);
        }
        if slot.val != 0 {
            slot.val += count;
            return Ok(true);
        }
        let repeat = self.pixels >= TABLE_PIXELS_PER_COLOR * self.distinct;
        if self.distinct >= self.most || (self.distinct >= self.room && !repeat) {
            return Ok(false);
        }
        *slot = Slot { key, val: count };
        self.distinct += 1;
        if self.distinct * 2 > self.slots.len() {
            let mut grown: Vec<Slot> = try_filled(self.slots.len() * 2)?;
            for slot in self.slots.iter().filter(|slot| slot.val != 0) {
                let (moved, passed) = slot_for(&mut grown, slot.key);
                *moved = *slot;
                self.passed += passed;
            }
            self.slots = grown;
        }
        Ok(true)
    }
}

/// Every distinct colour with its pixel count, and the table when they fit it (`val` = count).
fn count_colors(
    pixels: &[[u8; 4]],
    seen: &[u8],
    counted: &[u8],
    want: usize,
) -> Result<(Vec<Bin>, Option<Vec<Slot>>), AllocError> {
    // Never more than the room of a full palette, or one colour per two pixels.
    let most = table_room(256).min(pixels.len() / 2);
    let (seen, _) = seen.as_chunks::<4>();
    // There are more colours than `seen`: they cannot all fit.
    if seen.len() >= most {
        return Ok((count_sorted(pixels)?, None));
    }
    let mut table = Counts {
        slots: try_filled(1024)?,
        distinct: 0,
        pixels: 0,
        passed: 0,
        room: table_room(want),
        most,
    };

    // `counted` is `indices[..at]` of the scan: it counts the pixels before `at`.
    let mut counts = [0u32; 256];
    for &idx in counted {
        counts[usize::from(idx)] += 1;
    }
    let seeds = seen
        .iter()
        .zip(&counts)
        .map(|(color, &count)| (u32::from_le_bytes(*color), count));
    let runs = pixels[counted.len()..].chunk_by(|a, b| a == b).map(|run| {
        let count = u32::try_from(run.len()).expect("int cast");
        (u32::from_le_bytes(run[0]), count)
    });
    for (key, count) in seeds.chain(runs) {
        if !table.add(key, count)? {
            drop(table);
            return Ok((count_sorted(pixels)?, None));
        }
    }

    let mut bins: Vec<Bin> = Vec::new();
    bins.try_reserve_exact(table.distinct)
        .map_err(|_| AllocError)?;
    bins.extend(
        table
            .slots
            .iter()
            .filter(|slot| slot.val != 0)
            .map(|slot| Bin {
                rgba: slot.key.to_le_bytes(),
                count: slot.val,
            }),
    );
    Ok((bins, Some(table.slots)))
}

/// `count_colors` without the table: sort a copy of the pixels, count each run of equal ones.
fn count_sorted(pixels: &[[u8; 4]]) -> Result<Vec<Bin>, AllocError> {
    let mut keys: Vec<u32> = Vec::new();
    keys.try_reserve_exact(pixels.len())
        .map_err(|_| AllocError)?;
    keys.extend(pixels.iter().map(|p| u32::from_le_bytes(*p)));
    keys.sort_unstable();
    let mut bins: Vec<Bin> = Vec::new();
    bins.try_reserve_exact(keys.chunk_by(|a, b| a == b).count())
        .map_err(|_| AllocError)?;
    bins.extend(keys.chunk_by(|a, b| a == b).map(|run| Bin {
        rgba: run[0].to_le_bytes(),
        count: u32::try_from(run.len()).expect("int cast"),
    }));
    Ok(bins)
}

/// Count, sums and sums of squares of a set of pixels: enough for its mean and squared error.
#[derive(Clone, Copy, Default)]
struct Moments {
    n: u64,
    sum: [u64; 4],
    sq: [u64; 4],
}

impl Moments {
    fn add(&mut self, bin: Bin) {
        let count = u64::from(bin.count);
        self.n += count;
        for c in 0..4usize {
            let v = u64::from(bin.rgba[c]);
            self.sum[c] += count * v;
            self.sq[c] += count * v * v;
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
    /// Slice into the shared `bins` buffer.
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

/// Split `bins` into `want` boxes (fewer if every box is one colour). Each box's mean is an entry.
fn split_boxes(bins: &mut [Bin], want: usize) -> Vec<u8> {
    let mut all = Moments::default();
    for &bin in bins.iter() {
        all.add(bin);
    }
    let mut boxes: Vec<ColorBox> = Vec::with_capacity(want);
    boxes.push(ColorBox::new(0, bins.len(), &all));
    while boxes.len() < want {
        // The box with the most squared error. A box of one bin has none.
        let mut pick: Option<usize> = None;
        for (i, b) in boxes.iter().enumerate() {
            if b.hi - b.lo < 2 {
                continue;
            }
            // error_b / n_b > error_p / n_p, cross-multiplied (< 2^114).
            if pick.is_none_or(|p| {
                b.error_times_n * u128::from(boxes[p].moments.n)
                    > boxes[p].error_times_n * u128::from(b.moments.n)
            }) {
                pick = Some(i);
            }
        }
        let Some(pick) = pick else { break };
        let b = boxes[pick];
        let ch = b.moments.channel_to_split();
        let slice = &mut bins[b.lo..b.hi];
        // `ch` has error, so it has two different values and a cut exists.
        let Some(value) = cut(slice, ch, &b.moments) else {
            break;
        };
        // The bins below `value` go first. The order of `bins` does not change the two parts.
        let mut at: usize = 0;
        let mut left = Moments::default();
        for i in 0..slice.len() {
            if slice[i].rgba[ch] < value {
                left.add(slice[i]);
                slice.swap(at, i);
                at += 1;
            }
        }
        boxes[pick] = ColorBox::new(b.lo, b.lo + at, &left);
        boxes.push(ColorBox::new(b.lo + at, b.hi, &b.moments.minus(&left)));
    }
    let mut palette: Vec<u8> = Vec::with_capacity(boxes.len() * 4);
    for b in &boxes {
        palette.extend_from_slice(&b.moments.mean());
    }
    palette
}

/// Pixel count and channel sums of the bins that have one value of a channel.
#[derive(Clone, Copy, Default)]
struct Sums {
    n: u64,
    sum: [u64; 4],
}

/// The cut of `bins` along `ch` with the least squared error: the least value in the second part.
fn cut(bins: &[Bin], ch: usize, total: &Moments) -> Option<u8> {
    let mut at_value = [Sums::default(); 256];
    for bin in bins {
        let sums = &mut at_value[usize::from(bin.rgba[ch])];
        let count = u64::from(bin.count);
        sums.n += count;
        for c in 0..4usize {
            sums.sum[c] += count * u64::from(bin.rgba[c]);
        }
    }
    // The sum of squares is fixed: least error is the largest L²/nL + R²/nR over the parts' sums.
    let mut left = Sums::default();
    let mut best: Option<(u128, u8)> = None;
    for (value, sums) in at_value.iter().enumerate() {
        if sums.n == 0 {
            continue;
        }
        left.n += sums.n;
        // Nothing is past the last value.
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
        let score =
            (left_sq << 32) / u128::from(left.n) + (right_sq << 32) / u128::from(total.n - left.n);
        if best.is_none_or(|(s, _)| score > s) {
            best = Some((score, u8::try_from(value + 1).expect("int cast")));
        }
    }
    best.map(|(_, value)| value)
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
    v.clamp(0, 255)
}
