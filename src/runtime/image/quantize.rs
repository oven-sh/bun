//! Colour quantizer for `.png({ palette: true, colors: N })`.
//!
//! Goal is "good enough to match Sharp's palette PNG path for screenshot
//! compression", not perceptual perfection — Sharp uses libimagequant which
//! is GPL, so we roll a small permissive one: boxes cut by squared error, each box one palette
//! entry. Mapping is nearest-entry by squared distance of what pixels show (`Shown`), optionally with
//! Floyd–Steinberg error diffusion (`dither: true`).

use bun_alloc::AllocError;

use shown::{CLEAR, Shown};

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
    // The sums and products below are exact for fewer than 2^32 pixels.
    let n: usize = u32::try_from(pixels.len()).map_err(|_| AllocError)? as usize;
    let want: usize = usize::from(opts.max_colors.clamp(1, 256));

    let mut indices: Vec<u8> = try_filled(n)?;
    let palette: Vec<u8> = match exact_palette(pixels, want, &mut indices) {
        // Every pixel has its own entry, so there is no error to diffuse.
        Some(palette) => palette,
        None => {
            // At most `want` entries: fewer when the pixels show fewer colours than that.
            let palette = split_boxes(pixels, want)?;
            let k: u16 = u16::try_from(palette.len()).expect("int cast");
            if opts.dither {
                map_floyd_steinberg(pixels, w, h, &palette, k, &mut indices)?;
            } else {
                map_runs(pixels, &mut indices, &palette, k);
            }
            shown::straight_all(palette)
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

/// The space an image that does not fit is measured in. Only `compact` and `row` read stored bytes.
mod shown {
    use bun_alloc::AllocError;

    unsafe extern "C" {
        fn bun_image_shown_row(dst: *mut u8, src: *const u8, n: usize);
        fn bun_image_shown_compact(dst: *mut u8, src: *const u8, n: usize) -> usize;
    }

    /// A pixel over mid-grey, and its alpha: distance² = mean of error² over black and over white + alpha error² / 4.
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(super) struct Shown([u8; 4]);

    /// What mid-grey adds to a colour channel behind alpha `a`: half of what the alpha lets through.
    pub(super) const fn grey(a: u8) -> u8 {
        127 - (a >> 1)
    }

    /// What every fully transparent pixel shows.
    pub(super) const CLEAR: Shown = Shown([grey(0), grey(0), grey(0), 0]);

    impl Shown {
        /// By reference: a copy on the stack costs a loop over a box a store and a load per pixel.
        pub(super) fn get(&self) -> &[u8; 4] {
            &self.0
        }
    }

    /// What the kernels compute, one pixel at a time. An opaque pixel shows itself.
    #[cfg(debug_assertions)]
    fn shown(pixel: [u8; 4]) -> Shown {
        let a = u16::from(pixel[3]);
        let scaled = |c: u8| {
            let x = u16::from(c) * a + 128;
            ((x + (x >> 8)) >> 8) as u8 + grey(pixel[3])
        };
        Shown([
            scaled(pixel[0]),
            scaled(pixel[1]),
            scaled(pixel[2]),
            pixel[3],
        ])
    }

    /// What each pixel shows, without the fully transparent ones, and how many of those there are.
    pub(super) fn compact(pixels: &[[u8; 4]]) -> Result<(Vec<Shown>, u64), AllocError> {
        let mut out: Vec<Shown> = Vec::new();
        out.try_reserve_exact(pixels.len())
            .map_err(|_| AllocError)?;
        // SAFETY: `out` has room for `pixels.len()` pixels, and the kernel writes inside that.
        let kept = unsafe {
            bun_image_shown_compact(
                out.as_mut_ptr().cast(),
                pixels.as_ptr().cast(),
                pixels.len(),
            )
        };
        // SAFETY: the kernel wrote the first `kept` pixels.
        unsafe { out.set_len(kept) };
        #[cfg(debug_assertions)]
        debug_assert!(
            pixels
                .iter()
                .filter(|pixel| pixel[3] != 0)
                .map(|&pixel| shown(pixel))
                .eq(out.iter().copied())
        );
        Ok((out, (pixels.len() - kept) as u64))
    }

    /// What each of at most 256 pixels shows, in `out`.
    pub(super) fn row<'a>(pixels: &[[u8; 4]], out: &'a mut [Shown; 256]) -> &'a [Shown] {
        let out = &mut out[..pixels.len()];
        // SAFETY: `out` and `pixels` are `pixels.len()` pixels each.
        unsafe {
            bun_image_shown_row(
                out.as_mut_ptr().cast(),
                pixels.as_ptr().cast(),
                pixels.len(),
            )
        };
        #[cfg(debug_assertions)]
        debug_assert!(
            pixels
                .iter()
                .map(|&pixel| shown(pixel))
                .eq(out.iter().copied())
        );
        out
    }

    /// The mean of `n` pixels, from their `sum` and the sum of `alpha >> 1`. The greys come off first: a black shadow stays black.
    pub(super) fn mean(n: u64, sum: &[u64; 4], halves: u64) -> Shown {
        let rounded = |sum: u64| u8::try_from((sum + n / 2) / n).expect("int cast");
        let alpha = rounded(sum[3]);
        let greys = 127 * n - halves;
        let over = |c: usize| rounded(sum[c] - greys) + grey(alpha);
        Shown([over(0), over(1), over(2), alpha])
    }

    /// The middle one of the colours that show `seen`. Black and white come back as black and white.
    pub(super) fn straight(seen: Shown) -> [u8; 4] {
        let a = u32::from(seen.0[3]);
        match a {
            0 => [0; 4],
            255 => seen.0,
            _ => {
                let grey = u32::from(grey(seen.0[3]));
                // The colour times alpha is at most alpha, so the quotient is at most 255.
                let whole = |c: u8| {
                    u8::try_from(((u32::from(c) - grey) * 255 + a / 2) / a).expect("int cast")
                };
                [
                    whole(seen.0[0]),
                    whole(seen.0[1]),
                    whole(seen.0[2]),
                    seen.0[3],
                ]
            }
        }
    }

    /// The entries as the bytes to write.
    pub(super) fn straight_all(entries: Vec<Shown>) -> Vec<u8> {
        entries
            .into_iter()
            .map(straight)
            .collect::<Vec<[u8; 4]>>()
            .into_flattened()
    }
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
    /// `count` pixels that show one colour.
    fn of(pixel: Shown, count: u64) -> Moments {
        let pixel = pixel.get();
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

    fn add(&mut self, pixel: Shown) {
        let pixel = pixel.get();
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

/// Split what the pixels show into `want` boxes (fewer if each is one colour). Each box gives one entry.
fn split_boxes(pixels: &[[u8; 4]], want: usize) -> Result<Vec<Shown>, AllocError> {
    // The boxes are ranges of a copy. A cut is a value of a channel: equal colours stay together.
    // Fully transparent pixels are not copied: the box `owner` has `clear` more.
    let (mut pixels, clear) = shown::compact(pixels)?;
    let mut owner: usize = 0;
    // Sums per value of the split channel. `cut` leaves it zero.
    let mut at_value: Vec<Sums> = try_filled(256)?;
    let mut all = Moments::of(CLEAR, clear);
    for &pixel in &pixels {
        all.add(pixel);
    }
    let mut boxes: Vec<ColorBox> = Vec::with_capacity(want);
    boxes.push(ColorBox::new(0, pixels.len(), &all));
    while boxes.len() < want {
        if want >= CLEAR_ENTRY_FROM && boxes.len() + 1 == want && clear != 0 {
            let b = boxes[owner];
            // When they are over half of their box its entry is theirs already.
            if clear * 2 <= b.moments.n {
                let alone = Moments::of(CLEAR, clear);
                boxes[owner] = ColorBox::new(b.lo, b.hi, &b.moments.minus(&alone));
                owner = boxes.len();
                boxes.push(ColorBox::new(b.hi, b.hi, &alone));
                break;
            }
        }
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
        let clear_here = if pick == owner { clear } else { 0 };
        // A box of one colour has no cut, and then no other box has error.
        let Some((value, below)) = cut(slice, ch, &b.moments, &mut at_value, clear_here) else {
            break;
        };
        // Part two starts `below` pixels in: only a pixel on the wrong side of that changes places.
        let clear_first = CLEAR.get()[ch] < value;
        let clear_below = if clear_first { clear_here } else { 0 };
        let at = usize::try_from(below - clear_below).expect("int cast");
        let (first, second) = slice.split_at_mut(at);
        let mut from: usize = 0;
        for pixel in first.iter_mut() {
            if pixel.get()[ch] >= value {
                while second[from].get()[ch] >= value {
                    from += 1;
                }
                core::mem::swap(pixel, &mut second[from]);
                from += 1;
            }
        }
        debug_assert!(first.iter().all(|pixel| pixel.get()[ch] < value));
        debug_assert!(second.iter().all(|pixel| pixel.get()[ch] >= value));
        // Only the shorter part is summed. The other part is the rest of the box.
        let sum_first = first.len() <= second.len();
        let (summed, clear_summed) = if sum_first {
            (&*first, clear_below)
        } else {
            (&*second, clear_here - clear_below)
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
        if pick == owner && !clear_first {
            owner = boxes.len();
        }
        boxes[pick] = ColorBox::new(b.lo, b.lo + at, &left);
        boxes.push(ColorBox::new(b.lo + at, b.hi, &right));
    }
    let mut palette: Vec<Shown> = Vec::with_capacity(boxes.len());
    for (i, b) in boxes.iter().enumerate() {
        let clear_here = if i == owner { clear } else { 0 };
        palette.push(entry(&pixels[b.lo..b.hi], clear_here, &b.moments));
    }
    // The fully transparent entry goes first: index 0 packs best in the file.
    if palette[owner] == CLEAR {
        palette[..=owner].rotate_right(1);
    }
    Ok(palette)
}

/// From this palette size the fully transparent pixels have their own entry. A smaller palette cannot spare one.
const CLEAR_ENTRY_FROM: usize = 16;

/// The entry of a box (`pixels` and `clear` fully transparent ones): the colour on over half of it, else its mean.
fn entry(pixels: &[Shown], clear: u64, moments: &Moments) -> Shown {
    if clear * 2 > moments.n {
        return CLEAR;
    }
    // One vote per pixel finds the only colour that can have more than half. A count confirms it.
    let (mut colour, mut votes) = (CLEAR, 0usize);
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
    // The mean needs the sum of `alpha >> 1`: it rides the pass of the count.
    let (mut count, mut halves) = (0u64, 0u64);
    for &pixel in pixels {
        count += u64::from(pixel == colour);
        halves += u64::from(pixel.get()[3] >> 1);
    }
    if count * 2 > moments.n {
        colour
    } else {
        shown::mean(moments.n, &moments.sum, halves)
    }
}

/// Pixel count and channel sums of the pixels that have one value of a channel.
#[derive(Clone, Copy, Default)]
struct Sums {
    n: u64,
    sum: [u64; 4],
}

/// The least-error cut of a box (`pixels` and `clear` fully transparent ones): the value that starts part two, and the count below it.
fn cut(
    pixels: &[Shown],
    ch: usize,
    total: &Moments,
    at_value: &mut [Sums],
    clear: u64,
) -> Option<(u8, u64)> {
    // One bit per value of `ch` that the box has: a box of a few pixels has few of the 256.
    let mut has = [0u64; 4];
    if clear != 0 {
        let value = usize::from(CLEAR.get()[ch]);
        has[value >> 6] |= 1 << (value & 63);
        at_value[value].n = clear;
        at_value[value].sum = CLEAR.get().map(|v| clear * u64::from(v));
    }
    // One step per run of equal pixels: a flat area would write the same sums once per pixel.
    for run in pixels.chunk_by(|a, b| a == b) {
        let pixel = run[0].get();
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

/// Index of the palette entry nearest to `colour`, the first one on a tie.
#[inline]
fn nearest(palette: &[Shown], k: u16, colour: [i32; 4]) -> u8 {
    let [r, g, b, a] = colour;
    // SAFETY: palette is a valid `[k*4]u8` buffer; FFI fn is pure.
    u8::try_from(unsafe {
        bun_image_nearest_palette(palette.as_ptr().cast(), u32::from(k), r, g, b, a)
    })
    .expect("int cast")
}

/// Write every pixel's palette index, asking the search once per run of pixels that show the same.
fn map_runs(pixels: &[[u8; 4]], indices: &mut [u8], palette: &[Shown], k: u16) {
    let mut last: Option<(Shown, u8)> = None;
    let mut scratch = [CLEAR; 256];
    // The stored pixel before a chunk, and 256 of it: a chunk of only that pixel takes its entry unseen.
    let mut before = [0u8; 4];
    let mut flat = [[0u8; 4]; 256];
    for (chunk, out) in pixels.chunks(256).zip(indices.chunks_mut(256)) {
        if let Some((_, idx)) = last
            && chunk[0] == before
            && chunk[chunk.len() - 1] == before
        {
            if flat[0] != before {
                flat = [before; 256];
            }
            if *chunk == flat[..chunk.len()] {
                out.fill(idx);
                continue;
            }
        }
        for (&seen, out) in shown::row(chunk, &mut scratch).iter().zip(out) {
            *out = match last {
                Some((last_seen, idx)) if last_seen == seen => idx,
                _ => {
                    let idx = nearest(palette, k, seen.get().map(i32::from));
                    last = Some((seen, idx));
                    idx
                }
            };
        }
        before = chunk[chunk.len() - 1];
    }
}

/// Carried alpha must not write a faint pixel as a far more opaque entry of another colour: true when `entry` is that for `pixel`.
fn barred(entry: [u8; 4], pixel: [u8; 4]) -> bool {
    if u16::from(entry[3]) <= u16::from(pixel[3]) + 127 {
        return false;
    }
    let apart: i32 = (0..3usize)
        .map(|c| (i32::from(entry[c]) - i32::from(pixel[c])).pow(2))
        .sum();
    apart > 3 * 64 * 64
}

/// `idx` when `pixel` may take that entry, else the nearest entry to `colour` that it may take. `stored`: the entries as written.
#[cold]
#[inline(never)]
fn nearest_allowed(
    palette: &[Shown],
    stored: &[[u8; 4]; 256],
    colour: &[i32; 4],
    pixel: [u8; 4],
    idx: u8,
) -> u8 {
    if pixel[3] == 0 || !barred(stored[usize::from(idx)], pixel) {
        return idx;
    }
    let mut best: Option<(i32, usize)> = None;
    for (i, entry) in palette.iter().enumerate() {
        if barred(stored[i], pixel) {
            continue;
        }
        let apart: i32 = (0..4usize)
            .map(|c| (colour[c] - i32::from(entry.get()[c])).pow(2))
            .sum();
        if best.is_none_or(|(least, _)| apart < least) {
            best = Some((apart, i));
        }
    }
    best.map_or(idx, |(_, i)| u8::try_from(i).expect("int cast"))
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
    pixels: &[[u8; 4]],
    w: u32,
    h: u32,
    palette: &[Shown],
    k: u16,
    indices: &mut [u8],
) -> Result<(), AllocError> {
    // Two rows of accumulated error in sixteenths of a level, ×4 channels.
    // `cur` carries error pushed *into* the current row from the row above;
    // `nxt` collects error for the row below.
    let stride: usize = w as usize * 4;
    let mut cur: Vec<i32> = vec![0i32; stride];
    let mut nxt: Vec<i32> = vec![0i32; stride];
    let mut scratch = [CLEAR; 256];
    // The entries as they are written: `barred` compares colours that the measure hides.
    let mut stored = [[0u8; 4]; 256];
    for (bytes, &entry) in stored.iter_mut().zip(palette) {
        *bytes = shown::straight(entry);
    }

    let mut y: u32 = 0;
    while y < h {
        // What the row shows goes on top of the error carried into it.
        let row = &pixels[y as usize * w as usize..][..w as usize];
        for (chunk, carried) in row.chunks(256).zip(cur.chunks_mut(256 * 4)) {
            let shown = shown::row(chunk, &mut scratch);
            for (seen, carried) in shown.iter().zip(carried.as_chunks_mut::<4>().0) {
                for c in 0..4usize {
                    carried[c] += 16 * i32::from(seen.get()[c]);
                }
            }
        }
        let ltr = (y & 1) == 0;
        let step: i64 = if ltr { 1 } else { -1 };
        let mut x: i64 = if ltr { 0 } else { i64::from(w) - 1 };
        while x >= 0 && x < i64::from(w) {
            let px: usize = y as usize * w as usize + usize::try_from(x).expect("int cast");
            let off: usize = usize::try_from(x).expect("int cast") * 4;

            // Source + carried error, in sixteenths, kept inside what a pixel of this alpha can show. `cand`: nearest level.
            let alpha = pixels[px][3];
            let sum = &cur[off..off + 4];
            let wanted: [i32; 4] = if alpha == 0 {
                // A fully transparent pixel takes no error: a soft edge beside it would tint it.
                CLEAR.get().map(|v| 16 * i32::from(v))
            } else {
                let low = 16 * i32::from(shown::grey(alpha));
                let high = low + 16 * i32::from(alpha);
                [
                    sum[0].clamp(low, high),
                    sum[1].clamp(low, high),
                    sum[2].clamp(low, high),
                    sum[3].clamp(0, 16 * 255),
                ]
            };
            let cand = wanted.map(|v| (v + 8) >> 4);

            let mut idx = nearest(palette, k, cand);
            // Only a pixel of alpha 1 to 127 has an entry that far above it.
            if alpha < 128 && palette[usize::from(idx)].get()[3] > alpha + 127 {
                idx = nearest_allowed(palette, &stored, &cand, pixels[px], idx);
            }
            indices[px] = idx;

            for c in 0..4usize {
                let err: i32 = wanted[c] - 16 * i32::from(palette[usize::from(idx)].get()[c]);
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
