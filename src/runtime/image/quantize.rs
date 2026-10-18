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
    let palette: Vec<u8> = match route(pixels, want, &mut indices)? {
        // Every pixel has its own entry, so there is no error to diffuse.
        Route::Exact(palette) => palette,
        Route::Counted(table) => {
            let counted = table.counted();
            // At most `want` entries: fewer when transparent pixels hid the colours over the limit.
            let palette = split_boxes(&mut table.elements(&pixels[counted..])?, want)?;
            let k: u16 = u16::try_from(palette.len() / 4).expect("int cast");
            // The table moves no byte: the boxes of pixels give the same palette.
            #[cfg(debug_assertions)]
            assert!(
                counted == 0 || palette == split_boxes(&mut Elements::of_pixels(pixels)?, want)?
            );
            if opts.dither {
                drop(table);
                map_floyd_steinberg(rgba, w, h, &palette, k, &mut indices)?;
            } else {
                let (head, tail) = indices.split_at_mut(counted);
                table.map(&pixels[..counted], &palette, k, head);
                map_runs(&pixels[counted..], tail, |key| {
                    nearest(&palette, k, shown_key(key))
                });
                // And a search per run gives the same indices.
                #[cfg(debug_assertions)]
                {
                    let mut searched: Vec<u8> = try_filled(n)?;
                    map_runs(pixels, &mut searched, |key| {
                        nearest(&palette, k, shown_key(key))
                    });
                    assert!(indices == searched);
                }
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

/// A fully transparent pixel shows no colour: in an image that does not fit, it is `[0; 4]`.
fn shown(pixel: [u8; 4]) -> [u8; 4] {
    if pixel[3] == 0 { [0; 4] } else { pixel }
}

/// `shown` for a pixel as a key: alpha is the top byte.
fn shown_key(key: u32) -> u32 {
    if key >> 24 == 0 { 0 } else { key }
}

/// How the palette is built. The passes that count the colours decide it.
pub(crate) enum Route {
    /// At most `want` colours: the palette, in order of first appearance. `indices` is complete.
    Exact(Vec<u8>),
    /// More colours. A table counted the first pixels: all of them, some, or none.
    Counted(Counts),
}

/// Count the colours of `pixels` as far as it pays. `want` is the palette size, 1 to 256.
pub(crate) fn route(
    pixels: &[[u8; 4]],
    want: usize,
    indices: &mut [u8],
) -> Result<Route, AllocError> {
    if let Some(palette) = exact_palette(pixels, want, indices) {
        return Ok(Route::Exact(palette));
    }
    Ok(Route::Counted(count_colors(pixels, want)?))
}

/// One slot of an open-addressing table from a colour to a non-zero number.
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

/// Slots that the probes of the count may pass, per pixel. Colours built to share a slot pass more.
const PROBE_BUDGET: usize = 4;
/// Pixels per counted colour, at least: a colour is 48 bytes while the table grows, a pixel 4.
const PIXELS_PER_COLOR: usize = 12;
/// Or this over the square of the palette size, for 3 and 4 entries: their boxes are cut few times.
const PIXELS_PER_COLOR_FEW_ENTRIES: usize = 256;
/// Colours per palette entry, at most: a larger table leaves the cache, and a probe costs a cut.
const COLORS_PER_ENTRY: usize = 32768;
/// One colour in this many pixels is free at the start: the first colours of an image are all new.
const PIXELS_PER_FREE_COLOR: usize = 512;
/// From this many palette entries on, a dense start costs little against the boxes of pixels.
const MANY_ENTRIES: usize = 64;
/// So there one colour in this many pixels is free.
const PIXELS_PER_FREE_COLOR_MANY_ENTRIES: usize = 96;
/// An image of at most this many pixels is not counted: its boxes of pixels cost less than a table.
const UNCOUNTED_PIXELS: usize = 4096;
/// Nor is an image for fewer palette entries than this: one cut of the pixels costs less too.
const COUNTED_ENTRIES: usize = 3;
/// Slots of the table at the start, 1 KB: a count that stops at once costs a small image little.
const FIRST_SLOTS: usize = 128;

/// The slot of `key` or the empty one for it, and the slots the probe passed. `slots.len()` is 2^n.
#[inline]
fn probe(slots: &[Slot], key: u32) -> (usize, usize) {
    let mask = slots.len() - 1;
    // Folded before the multiply: a multiply alone is linear, and near colours share runs of slots.
    let hash = (key ^ (key >> 16)).wrapping_mul(0x9E37_79B1);
    // As many top bits as the table has slots.
    let mut i = (hash >> (32 - slots.len().trailing_zeros())) as usize;
    let mut passed: usize = 0;
    // A table is never full, so the walk ends.
    while slots[i].val != 0 && slots[i].key != key {
        i = (i + 1) & mask;
        passed += 1;
    }
    (i, passed)
}

/// Pixel counts by colour, for the first pixels of an image: it stops where a table stops paying.
pub(crate) struct Counts {
    /// Each `val` is the pixel count of `key`. At most half full.
    slots: Vec<Slot>,
    distinct: usize,
    /// The pixels it counted: the first ones of the image.
    counted: usize,
    /// Slots that the probes of `add` passed so far.
    probed: usize,
    /// Slots that the moves of `grow` passed so far.
    moved: usize,
    /// Pixels that each colour has to stand for.
    per_color: usize,
    /// Colours it takes at most.
    most: usize,
    /// Pixels that count from the start.
    head_start: usize,
    /// Pixels of the image.
    image: usize,
}

impl Counts {
    /// The pixels it counted: the first ones of the image.
    pub(crate) fn counted(&self) -> usize {
        self.counted
    }

    /// Count `count` more pixels, of one colour. False when the table takes no more.
    fn add(&mut self, key: u32, count: u32) -> Result<bool, AllocError> {
        let pixels = self.counted + count as usize;
        let (i, passed) = probe(&self.slots, key);
        self.probed += passed;
        if self.probed + self.moved > PROBE_BUDGET * pixels {
            return Ok(false);
        }
        let slot = &mut self.slots[i];
        if slot.val != 0 {
            slot.val += count;
            self.counted = pixels;
            return Ok(true);
        }
        // A new colour: the colours so far have to repeat, after a head start.
        let credit = self.image.min(pixels + self.head_start);
        if self.distinct >= self.most || self.distinct * self.per_color > credit {
            return Ok(false);
        }
        *slot = Slot { key, val: count };
        self.counted = pixels;
        self.distinct += 1;
        if self.distinct * 2 > self.slots.len() {
            self.grow()?;
        }
        Ok(true)
    }

    /// Twice the slots. No colour ends further from its first slot than it was.
    fn grow(&mut self) -> Result<(), AllocError> {
        let mut grown: Vec<Slot> = try_filled(self.slots.len() * 2)?;
        // From an empty slot, going round: a chain that wraps the end is moved from its start.
        let gap = self
            .slots
            .iter()
            .position(|slot| slot.val == 0)
            .unwrap_or(0);
        // The counted slots after it move up to it first: a branch per slot misses half the time.
        let mut end = gap;
        for i in gap..self.slots.len() {
            let slot = self.slots[i];
            self.slots[end] = slot;
            end += usize::from(slot.val != 0);
        }
        let (wrapped, rest) = self.slots[..end].split_at(gap);
        for slot in rest.iter().chain(wrapped) {
            let (i, passed) = probe(&grown, slot.key);
            grown[i] = *slot;
            self.moved += passed;
        }
        self.slots = grown;
        Ok(())
    }

    /// What the boxes divide: every counted colour once, and a copy of `rest`, the other pixels.
    fn elements(&self, rest: &[[u8; 4]]) -> Result<Elements, AllocError> {
        // A bin more than the colours: every slot is written, and only a counted one moves on.
        let spare = usize::from(!self.slots.is_empty());
        let mut bins: Vec<Bin> = try_filled(self.distinct + spare)?;
        let mut len: usize = 0;
        for slot in &self.slots {
            bins[len] = Bin {
                rgba: slot.key.to_le_bytes(),
                count: slot.val,
            };
            len += usize::from(slot.val != 0);
        }
        bins.truncate(self.distinct);
        let mut pixels = Vec::new();
        pixels
            .try_reserve_exact(rest.len())
            .map_err(|_| AllocError)?;
        pixels.extend(rest.iter().map(|&pixel| shown(pixel)));
        Ok(Elements { bins, pixels })
    }

    /// Write every pixel's palette index: one search per colour, then one lookup per run.
    fn map(mut self, pixels: &[[u8; 4]], palette: &[u8], k: u16, indices: &mut [u8]) {
        // Each count becomes the index of the nearest entry, plus 1.
        for slot in self.slots.iter_mut().filter(|slot| slot.val != 0) {
            slot.val = u32::from(nearest(palette, k, slot.key)) + 1;
        }
        let mut passed: usize = 0;
        map_runs(pixels, indices, |key| {
            let (i, steps) = probe(&self.slots, shown_key(key));
            passed += steps;
            u8::try_from(self.slots[i].val - 1).expect("int cast")
        });
        // No lookup passes more slots than the count's probe for its run: the budget holds here.
        debug_assert!(passed <= self.probed);
    }
}

/// Count the colours of the first pixels in a table, for as long as a table pays.
fn count_colors(pixels: &[[u8; 4]], want: usize) -> Result<Counts, AllocError> {
    let per_color = PIXELS_PER_COLOR.max(PIXELS_PER_COLOR_FEW_ENTRIES / (want * want));
    let per_free = if want >= MANY_ENTRIES {
        PIXELS_PER_FREE_COLOR_MANY_ENTRIES
    } else {
        PIXELS_PER_FREE_COLOR
    };
    let mut table = Counts {
        slots: Vec::new(),
        distinct: 0,
        counted: 0,
        probed: 0,
        moved: 0,
        per_color,
        most: COLORS_PER_ENTRY * want,
        head_start: pixels.len() / per_free * per_color,
        image: pixels.len(),
    };
    if pixels.len() <= UNCOUNTED_PIXELS || want < COUNTED_ENTRIES {
        return Ok(table);
    }
    table.slots = try_filled(FIRST_SLOTS)?;
    for run in pixels.chunk_by(|a, b| a == b) {
        let count = u32::try_from(run.len()).expect("int cast");
        if !table.add(u32::from_le_bytes(shown(run[0])), count)? {
            break;
        }
    }
    Ok(table)
}

/// Count, sums and sums of squares of a set of pixels: enough for its mean and squared error.
#[derive(Clone, Copy, Default)]
struct Moments {
    n: u64,
    sum: [u64; 4],
    sq: [u64; 4],
}

impl Moments {
    /// Add `count` pixels of one colour.
    #[inline]
    fn add(&mut self, pixel: [u8; 4], count: u64) {
        self.n += count;
        for c in 0..4usize {
            let v = u64::from(pixel[c]);
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

/// Pixel count and channel sums of the pixels that have one value of a channel.
#[derive(Clone, Copy, Default)]
struct Sums {
    n: u64,
    sum: [u64; 4],
}

/// A colour and the number of pixels that have it.
#[derive(Clone, Copy, Default)]
struct Bin {
    rgba: [u8; 4],
    count: u32,
}

/// What the boxes divide: every counted colour once with its count, and a copy of the other pixels.
struct Elements {
    bins: Vec<Bin>,
    pixels: Vec<[u8; 4]>,
}

#[derive(Clone, Copy)]
struct ColorBox {
    /// Ranges of the bins and of the pixels.
    bins: (usize, usize),
    pixels: (usize, usize),
    moments: Moments,
    /// `moments.total_error_times_n()`, kept for the choice of the next box.
    error_times_n: u128,
}

impl ColorBox {
    fn new(bins: (usize, usize), pixels: (usize, usize), moments: &Moments) -> ColorBox {
        ColorBox {
            bins,
            pixels,
            moments: *moments,
            error_times_n: moments.total_error_times_n(),
        }
    }

    /// Bins and pixels: a box of one has no cut.
    fn len(&self) -> usize {
        self.bins.1 - self.bins.0 + self.pixels.1 - self.pixels.0
    }
}

impl Elements {
    /// A copy of the pixels as they are shown, with no colour counted.
    #[cfg(debug_assertions)]
    fn of_pixels(pixels: &[[u8; 4]]) -> Result<Elements, AllocError> {
        let mut copy = Vec::new();
        copy.try_reserve_exact(pixels.len())
            .map_err(|_| AllocError)?;
        copy.extend(pixels.iter().map(|&pixel| shown(pixel)));
        Ok(Elements {
            bins: Vec::new(),
            pixels: copy,
        })
    }

    /// The moments of all of them.
    fn moments(&self) -> Moments {
        let mut all = Moments::default();
        for bin in &self.bins {
            all.add(bin.rgba, u64::from(bin.count));
        }
        for &pixel in &self.pixels {
            all.add(pixel, 1);
        }
        all
    }

    /// Add the pixels of a box to the sums of their value of `ch`. One bit per value the box has.
    fn add_by_value(&self, b: &ColorBox, ch: usize, at_value: &mut [Sums]) -> [u64; 4] {
        let mut has = [0u64; 4];
        let mut add = |pixel: [u8; 4], count: u64| {
            let value = usize::from(pixel[ch]);
            has[value >> 6] |= 1 << (value & 63);
            let sums = &mut at_value[value];
            sums.n += count;
            for c in 0..4usize {
                sums.sum[c] += count * u64::from(pixel[c]);
            }
        };
        for bin in &self.bins[b.bins.0..b.bins.1] {
            add(bin.rgba, u64::from(bin.count));
        }
        // One step per run of equal pixels: a flat area would write its sums once per pixel.
        for run in self.pixels[b.pixels.0..b.pixels.1].chunk_by(|a, b| a == b) {
            add(run[0], run.len() as u64);
        }
        has
    }

    /// Move what a box has below `value` in `ch` to the front: bins, pixels, and their moments.
    fn partition(&mut self, b: &ColorBox, ch: usize, value: u8) -> (usize, usize, Moments) {
        let mut left = Moments::default();
        let bins = &mut self.bins[b.bins.0..b.bins.1];
        let mut bins_below: usize = 0;
        for i in 0..bins.len() {
            if bins[i].rgba[ch] < value {
                left.add(bins[i].rgba, u64::from(bins[i].count));
                bins.swap(bins_below, i);
                bins_below += 1;
            }
        }
        let slice = &mut self.pixels[b.pixels.0..b.pixels.1];
        let mut at: usize = 0;
        for i in 0..slice.len() {
            if slice[i][ch] < value {
                left.add(slice[i], 1);
                slice.swap(at, i);
                at += 1;
            }
        }
        (bins_below, at, left)
    }

    /// The colour on more than half of the pixels of a box: a flat background stays exact.
    fn majority(&self, b: &ColorBox) -> Option<[u8; 4]> {
        let bins = &self.bins[b.bins.0..b.bins.1];
        let pixels = &self.pixels[b.pixels.0..b.pixels.1];
        // One vote per pixel finds the only colour that can have more than half.
        let (mut colour, mut votes) = ([0u8; 4], 0u64);
        for bin in bins {
            let count = u64::from(bin.count);
            if bin.rgba == colour {
                votes += count;
            } else if count > votes {
                (colour, votes) = (bin.rgba, count - votes);
            } else {
                votes -= count;
            }
        }
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
        // A count confirms it.
        let in_bins: u64 = bins
            .iter()
            .filter(|bin| bin.rgba == colour)
            .map(|bin| u64::from(bin.count))
            .sum();
        let in_pixels = pixels.iter().filter(|&&pixel| pixel == colour).count() as u64;
        ((in_bins + in_pixels) * 2 > b.moments.n).then_some(colour)
    }
}

/// Split the elements into `want` boxes (fewer if each is one colour). Each box gives one entry.
fn split_boxes(elements: &mut Elements, want: usize) -> Result<Vec<u8>, AllocError> {
    // Sums per value of the split channel. `cut` leaves it zero.
    let mut at_value: Vec<Sums> = try_filled(256)?;
    let mut boxes: Vec<ColorBox> = Vec::with_capacity(want);
    let all = ((0, elements.bins.len()), (0, elements.pixels.len()));
    boxes.push(ColorBox::new(all.0, all.1, &elements.moments()));
    while boxes.len() < want {
        // The box with the most squared error: its index, `error_times_n` and `n`.
        let mut pick: Option<(usize, u128, u64)> = None;
        for (i, b) in boxes.iter().enumerate() {
            if b.len() < 2 {
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
        // A box of one colour has no cut, and then no other box has error.
        let Some(value) = cut(elements, &b, ch, &mut at_value) else {
            break;
        };
        // What is below `value` goes first. A cut is a value: equal colours stay together.
        let (bins, pixels, left) = elements.partition(&b, ch, value);
        let (bins, pixels) = (b.bins.0 + bins, b.pixels.0 + pixels);
        boxes[pick] = ColorBox::new((b.bins.0, bins), (b.pixels.0, pixels), &left);
        boxes.push(ColorBox::new(
            (bins, b.bins.1),
            (pixels, b.pixels.1),
            &b.moments.minus(&left),
        ));
    }
    let mut palette: Vec<u8> = Vec::with_capacity(boxes.len() * 4);
    for b in &boxes {
        let entry = elements.majority(b).unwrap_or_else(|| b.moments.mean());
        palette.extend_from_slice(&entry);
    }
    Ok(palette)
}

/// The cut of a box along `ch` with the least squared error, as the value that starts part two.
fn cut(elements: &Elements, b: &ColorBox, ch: usize, at_value: &mut [Sums]) -> Option<u8> {
    let total = &b.moments;
    // A box of a few pixels has few of the 256 values: `has` names them.
    let has = elements.add_by_value(b, ch, at_value);
    // The sum of squares is fixed: least error is the largest L²/nL + R²/nR over the parts' sums.
    let mut left = Sums::default();
    let mut best: Option<(u128, u8)> = None;
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
            if best.is_none_or(|(s, _)| score > s) {
                best = Some((score, u8::try_from(value + 1).expect("int cast")));
            }
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
