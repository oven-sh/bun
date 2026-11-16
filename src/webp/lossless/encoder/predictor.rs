//! The predictor transform, which leaves of each pixel what its neighbors do not tell.

use super::entropy::{ONE_BIT, set_bits};
use super::residuals::{Bias, Counts, Totals};
use super::sub;
use super::tiles::{self, Tiles};
use crate::array::At;
use crate::error::Result;
use crate::lossless::{Argb, BLACK};
use crate::slice::{InBounds, known};
use crate::vec;

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L39
const MAX_TILES: usize = 1 << 14;
const MODES: usize = 14;
const ALPHA: Argb = 0xff00_0000;

/// What happens to the color of pixels that are fully transparent.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum HiddenColors {
    Kept,
    /// By what is predicted for them, so that nothing is left of them.
    Replaced,
}

/// Blue, green, red and alpha.
type Pixel = [u8; 4];

#[inline(always)]
fn to_argb(bytes: &Lanes, index: usize) -> Argb {
    Argb::from_le_bytes(core::array::from_fn(|channel| {
        *bytes.at(4 * index + channel)
    }))
}

/// `predict()` for the channels of four pixels.
#[inline(always)]
fn predict_four<const MODE: usize>(left: Lanes, above: [Lanes; 3]) -> Lanes {
    let [top_left, top, _] = above;
    let to_left = lanewise(left, top_left, u8::abs_diff);
    let to_top = lanewise(top, top_left, u8::abs_diff);
    let sum = |channels: Argb| {
        let pairs = (channels & 0x00ff_00ff) + (channels >> 8 & 0x00ff_00ff);
        ((pairs & 0xffff) + (pairs >> 16)) as i32
    };
    let prefers_left = core::array::from_fn(|i| {
        ((sum(to_argb(&to_top, i / 4)) - sum(to_argb(&to_left, i / 4))) >> 31) as u8
    });
    let black = core::array::from_fn(|i| *BLACK.to_le_bytes().at(i % 4));
    *predict(black, left, above, prefers_left).at(MODE)
}

/// The same for one pixel, whose channels are too few for the compiler to put them into a vector.
#[inline(always)]
fn predict_pixel<const MODE: usize>(left: Pixel, above: [Pixel; 3]) -> Argb {
    const ONES: u64 = 0x0001_0001_0001_0001;
    let left = Argb::from_le_bytes(left);
    let [top_left, top, top_right] = above.map(Argb::from_le_bytes);
    let average = |a: Argb, b: Argb| (((a ^ b) & 0xfefe_fefe) >> 1) + (a & b);
    // 16 bits for each channel.
    let wide = |it: Argb| u64::from(it & 0x00ff_00ff) | u64::from(it & 0xff00_ff00) << 24;
    let clamped_less_256 = |sums: u64| {
        let channels = sums & ((sums >> 8 & ONES) * 255) | ((sums >> 9 & ONES) * 255);
        channels as Argb | (channels >> 24) as Argb
    };
    let to_top_left = |from: Argb| {
        let differences = wide(from) + 256 * ONES - wide(top_left);
        let are_negative = !differences >> 8 & ONES;
        let magnitudes = ((differences ^ (are_negative * 255)) & (255 * ONES)) + are_negative;
        magnitudes.wrapping_mul(ONES) >> 48
    };
    match MODE {
        0 => BLACK,
        1 => left,
        2 => top,
        3 => top_right,
        4 => top_left,
        5 => average(average(left, top_right), top),
        6 => average(left, top_left),
        7 => average(left, top),
        8 => average(top_left, top),
        9 => average(top, top_right),
        10 => average(average(left, top_left), average(top, top_right)),
        11 if to_top_left(top) < to_top_left(left) => left,
        11 => top,
        12 => clamped_less_256(wide(left) + wide(top) + 256 * ONES - wide(top_left)),
        _ => {
            let from = wide(average(left, top));
            let differences = from + 512 * ONES - wide(top_left);
            let are_negative = !differences >> 9 & ONES;
            clamped_less_256(from + ((differences + are_negative) >> 1 & (511 * ONES)))
        }
    }
}

// In a loop, the compiler would put the same byte of different iterations into a vector.
#[inline(never)]
fn subtract_four<const MODE: usize>(above: &[Pixel; 6], row: &[Pixel; 5], to: &mut [Argb; 4]) {
    let four = |pixels: &[Pixel], x: usize| pixels.as_flattened().chunk(4 * x);
    let above = [four(above, 0), four(above, 1), four(above, 2)];
    let predicted = predict_four::<MODE>(four(row, 0), above);
    let bytes = lanewise(four(row, 1), predicted, u8::wrapping_sub);
    *to = core::array::from_fn(|i| to_argb(&bytes, i));
}

/// `row` starts one pixel to the left of those to predict and so does `above`, which also has one more to the right.
fn subtract<const MODE: usize>(
    above: &[Pixel],
    row: &mut [Pixel],
    hidden: HiddenColors,
    residuals: &mut [Argb],
) {
    let pixels = row.iter().skip(1).take(residuals.len());
    let is_hidden = |&pixel| Argb::from_le_bytes(pixel) & ALPHA == 0;
    let has_hidden = || pixels.fold(false, |any, pixel| any | is_hidden(pixel));
    let mut done = 0;
    if hidden == HiddenColors::Kept || !has_hidden() {
        let around = above.array_windows().step_by(4);
        let around = around.zip(row.array_windows().step_by(4));
        for ((above, row), residuals) in around.zip(residuals.as_chunks_mut().0) {
            subtract_four::<MODE>(above, row, residuals);
            done += 4;
        }
    }
    let mut left = row.value(done);
    let others = above.array_windows().zip(residuals).skip(done);
    for (pixel, (&above, residual)) in row.part_mut(done + 1..).iter_mut().zip(others) {
        *residual = hidden.residual(pixel, predict_pixel::<MODE>(left, above));
        left = *pixel;
    }
}

impl HiddenColors {
    #[inline(always)]
    fn residual(self, pixel: &mut Pixel, predicted: Argb) -> Argb {
        let residual = sub(Argb::from_le_bytes(*pixel), predicted);
        if self == Self::Replaced && matches!(pixel, [.., 0]) {
            *pixel = (predicted & !ALPHA).to_le_bytes();
            return residual & ALPHA;
        }
        residual
    }
}

/// Two rows of the image to work on. Behind each is the first pixel of the next one.
struct Rows {
    above: Vec<Pixel>,
    current: Vec<Pixel>,
    hidden: HiddenColors,
}

impl Rows {
    fn new(width: usize, hidden: HiddenColors) -> Result<Self> {
        Ok(Self {
            above: vec::filled([0; 4], width + 1)?,
            current: vec::filled([0; 4], width + 1)?,
            hidden,
        })
    }

    /// Goes on to row `y`, of which what it takes to predict `start..end` is read.
    fn advance(&mut self, pixels: &[Argb], y: usize, start: usize, end: usize) {
        core::mem::swap(&mut self.above, &mut self.current);
        let width = self.current.len() - 1;
        let start = start.saturating_sub(1);
        let to = self.current.part_mut(start..=end);
        for (to, from) in to.iter_mut().zip(pixels.part(y * width + start..)) {
            *to = from.to_le_bytes();
        }
    }

    /// For the pixels from `x` on of the current row, which is row `y`.
    fn subtract(&mut self, mode: u8, mut x: usize, y: usize, mut to: &mut [Argb]) {
        if x == 0 {
            let predicted = match y {
                0 => BLACK,
                _ => Argb::from_le_bytes(self.above.value(0)),
            };
            let mut first = self.current.value(0);
            to.set(0, self.hidden.residual(&mut first, predicted));
            self.current.set(0, first);
            self.above.set(self.current.len() - 1, first);
            (x, to) = (1, to.part_mut(1..));
        }
        if to.is_empty() {
            return;
        }
        let (above, row) = (self.above.part(x - 1..), self.current.part_mut(x - 1..));
        let subtract = match if y == 0 { 1 } else { mode } {
            0 => subtract::<0>,
            1 => subtract::<1>,
            2 => subtract::<2>,
            3 => subtract::<3>,
            4 => subtract::<4>,
            5 => subtract::<5>,
            6 => subtract::<6>,
            7 => subtract::<7>,
            8 => subtract::<8>,
            9 => subtract::<9>,
            10 => subtract::<10>,
            11 => subtract::<11>,
            12 => subtract::<12>,
            _ => subtract::<13>,
        };
        subtract(above, row, self.hidden, to);
    }
}

const fn mode_of(tile: Argb) -> u8 {
    (tile >> 8) as u8
}

const LANES: usize = 16;
type Lanes = [u8; LANES];

#[inline(always)]
fn lanewise(a: Lanes, b: Lanes, f: impl Fn(u8, u8) -> u8) -> Lanes {
    core::array::from_fn(|i| f(*a.at(i), *b.at(i)))
}

#[inline(always)]
fn average(a: Lanes, b: Lanes) -> Lanes {
    lanewise(a, b, |a, b| {
        ((u16::from(a) + u16::from(b) + 1) >> 1) as u8 - ((a ^ b) & 1)
    })
}

/// What each mode predicts, for any channels of any pixels. `prefers_left` is all ones where mode 11 does.
#[inline(always)]
fn predict(
    black: Lanes,
    left: Lanes,
    [top_left, top, top_right]: [Lanes; 3],
    prefers_left: Lanes,
) -> [Lanes; MODES] {
    let (left_top_left, left_top) = (average(left, top_left), average(left, top));
    let top_top_right = average(top, top_right);
    // Either what is added or what is subtracted is zero.
    let moved = |from, up, down| {
        let up = lanewise(from, up, u8::saturating_add);
        lanewise(up, down, u8::saturating_sub)
    };
    let above = |a, b| lanewise(a, b, u8::saturating_sub);
    let half_above = |a, b| above(a, b).map(|difference| difference / 2);
    [
        black,
        left,
        top,
        top_right,
        top_left,
        average(average(left, top_right), top),
        left_top_left,
        left_top,
        average(top_left, top),
        top_top_right,
        average(left_top_left, top_top_right),
        lanewise(
            lanewise(left, prefers_left, |left, mask| left & mask),
            lanewise(top, prefers_left, |top, mask| top & !mask),
            |a, b| a | b,
        ),
        moved(left, above(top, top_left), above(top_left, top)),
        moved(
            left_top,
            half_above(left_top, top_left),
            half_above(top_left, left_top),
        ),
    ]
}

/// A byte for each pixel of a row of tiles and of the row of pixels above it. Each row has one more byte in front, and
/// behind it the first one of the next row and some padding.
struct Plane {
    bytes: Vec<u8>,
    stride: usize,
}

impl Plane {
    fn new(width: usize, rows: usize) -> Result<Self> {
        let stride = 1 + width + 1 + LANES;
        Ok(Self {
            bytes: vec::filled(0, (rows + 1) * stride)?,
            stride,
        })
    }

    fn rows(&self) -> impl Iterator<Item = &[u8]> {
        self.bytes.chunks_exact(self.stride.max(1))
    }

    fn rows_mut(&mut self) -> impl Iterator<Item = &mut [u8]> {
        self.bytes.chunks_exact_mut(self.stride.max(1))
    }

    /// The columns of `tile` and as many on either side as `margin` says, in all rows from `first_row` on.
    fn around(&self, tile: Tile, first_row: usize, margin: usize) -> impl Iterator<Item = &[u8]> {
        let rows = self.rows().take(1 + tile.height).skip(first_row);
        let columns = 1 + tile.x - margin..1 + tile.x + tile.width + margin;
        rows.map(move |row| row.part(columns.start..columns.end))
    }
}

#[derive(Clone, Copy)]
struct Tile {
    x: usize,
    y: usize,
    width: usize,
    height: usize,
}

/// What is known about blue, green, red or alpha.
struct Channel {
    shift: u32,
    /// Unless all pixels have the same value.
    plane: Option<Plane>,
    totals: Totals,
    /// For the current tile.
    residuals: [Counts; MODES],
}

impl Default for Channel {
    fn default() -> Self {
        Self {
            shift: 0,
            plane: None,
            totals: Totals::EMPTY,
            residuals: [[0; _]; _],
        }
    }
}

impl Channel {
    const fn of(&self, pixel: Argb) -> u8 {
        (pixel >> self.shift) as u8
    }

    /// The value that all pixels in and around `tile` have.
    fn flat_value(&self, tile: Tile, first_pixel: Argb) -> Option<u8> {
        let Some(plane) = &self.plane else {
            return Some(self.of(first_pixel));
        };
        let value = plane.bytes.value(tile.x);
        let differ = |row: &[u8]| row.iter().fold(0, |bits, &other| bits | (other ^ value));
        let mut rows = plane.around(tile, 0, 1);
        rows.all(|row| differ(row) == 0).then_some(value)
    }

    /// Returns the costs for a tile that has a `flat_value()`.
    fn count_flat(&mut self, tile: Tile, value: u8) -> [i64; MODES] {
        let from_black = usize::from(value.wrapping_sub(self.of(BLACK)));
        let all = (tile.width * tile.height) as u16;
        let first = u16::from(tile.x == 0 && tile.y == 0);
        let inner_width = tile.width - usize::from(tile.x == 0);
        let inner = (inner_width * (tile.height - usize::from(tile.y == 0))) as u16;
        let [black, others, ..] = &mut self.residuals;
        for (counts, predicted_as_black) in [(black, first + inner), (others, first)] {
            *counts.at_mut(0) += all - predicted_as_black;
            *counts.at_mut(from_black) += predicted_as_black;
        }
        let mut costs = [0; MODES];
        if from_black != 0 {
            let ([black, others, ..], [cost, ..]) = (&self.residuals, &mut costs);
            *cost = self.cost(black) - self.cost(others);
        }
        costs
    }

    fn cost(&self, residuals: &Counts) -> i64 {
        const BIAS: Bias = Bias::new(1, 94);
        BIAS.cost(residuals) + self.totals.entropy_with(residuals)
    }

    fn costs(&self) -> [i64; MODES] {
        self.residuals.each_ref().map(|it| self.cost(it))
    }
}

/// What each mode leaves of a channel.
fn count(counts: &mut [Counts; MODES], tile: Tile, black: u8, plane: &Plane, prefers_left: &Plane) {
    let rows = plane.rows().zip(plane.rows().skip(1));
    let rows = rows.zip(prefers_left.rows().skip(1)).take(tile.height);
    let mut flat = 0;
    for (y, ((above, row), prefers_left)) in (tile.y..).zip(rows) {
        for x in (tile.x..tile.x + tile.width).step_by(LANES) {
            let (left, here) = (row.chunk(x), row.chunk(x + 1));
            let top = [x, x + 1, x + 2].map(|x| above.chunk(x));
            let predicted = predict([black; LANES], left, top, prefers_left.chunk(x + 1));
            let mut residuals = predicted.map(|it| lanewise(here, it, u8::wrapping_sub));
            if y == 0 {
                let [from_black, from_left, ..] = residuals;
                residuals = [from_left; MODES];
                if x == 0 {
                    residuals = residuals.map(|it| with_first_of(from_black, it));
                }
            } else if x == 0 {
                let [_, _, from_top, ..] = residuals;
                residuals = residuals.map(|it| with_first_of(from_top, it));
            }

            let [from_black, a, b, c, d, ..] = residuals;
            let differ = lanewise(
                lanewise(a, b, |a, b| a | b),
                lanewise(c, d, |c, d| c | d),
                |a, b| a | b,
            );
            let mut busy = 0u16;
            for (i, differ) in differ.into_iter().enumerate() {
                busy |= u16::from(differ != 0) << i;
            }
            let lanes = (tile.x + tile.width - x).min(LANES);
            let in_tile = !(!0u64 << lanes);
            let busy = u64::from(busy) & in_tile;
            let [black_counts, ..] = counts;
            for i in set_bits(in_tile & !busy) {
                *black_counts.at_mut(usize::from(*from_black.at(i))) += 1;
            }
            flat += (in_tile & !busy).count_ones() as u16;
            for i in set_bits(busy) {
                for (counts, residuals) in counts.iter_mut().zip(&residuals) {
                    *counts.at_mut(usize::from(*residuals.at(i))) += 1;
                }
            }
        }
    }
    for [zeros, ..] in counts.iter_mut().skip(1) {
        *zeros += flat;
    }
}

#[inline(always)]
fn with_first_of([first, ..]: Lanes, mut lanes: Lanes) -> Lanes {
    *lanes.at_mut(0) = first;
    lanes
}

struct Search<'a> {
    pixels: &'a [Argb],
    width: usize,
    channels: Box<[Channel; 4]>,
    /// All ones where mode 11 goes by the pixel to the left.
    prefers_left: Plane,
    rows: &'a mut Rows,
    residuals: Vec<Argb>,
}

impl<'a> Search<'a> {
    fn new(pixels: &'a [Argb], width: usize, bits: u32, rows: &'a mut Rows) -> Result<Self> {
        let first = pixels.value(0);
        let differ = pixels.iter().fold(0, |bits, &pixel| bits | (pixel ^ first));
        let mut channels = vec::default_array::<Channel, _>()?;
        for (channel, shift) in channels.iter_mut().zip([0, 8, 16, 24]) {
            let varies = (differ >> shift) as u8 != 0;
            channel.shift = shift;
            channel.plane = varies.then(|| Plane::new(width, 1 << bits)).transpose()?;
        }
        Ok(Self {
            pixels,
            width,
            channels,
            prefers_left: Plane::new(width, 1 << bits)?,
            rows,
            residuals: vec::filled(0, 1 << bits)?,
        })
    }

    /// Reads the row of tiles that starts at `y`. What is not in the image repeats what is next to it.
    fn read_rows(&mut self, y: usize, height: usize) {
        for channel in self.channels.iter_mut() {
            let (Some(plane), shift) = (&mut channel.plane, channel.shift) else {
                continue;
            };
            let ys = [y.saturating_sub(1)].into_iter().chain(y..y + height);
            for (y, row) in ys.zip(plane.rows_mut()) {
                let from = self.pixels.part(y * self.width..);
                let from = from.get(..=self.width).unwrap_or(from);
                for (to, &pixel) in row.part_mut(1..).iter_mut().zip(from) {
                    *to = (pixel >> shift) as u8;
                }
                row.set(0, row.value(1));
            }
        }

        let planes = || self.channels.iter().filter_map(|it| it.plane.as_ref());
        for (y, masks) in self
            .prefers_left
            .rows_mut()
            .enumerate()
            .skip(1)
            .take(height)
        {
            let masks = masks.part_mut(1..).as_chunks_mut::<LANES>().0;
            for (index, masks) in masks.iter_mut().enumerate() {
                let mut nearer_by = [0i16; LANES];
                for plane in planes() {
                    let start = y * plane.stride + index * LANES;
                    let above = start - plane.stride;
                    let [left, top_left, top] =
                        [start, above, above + 1].map(|at| plane.bytes.chunk::<LANES>(at));
                    let [top, left] = [top, left].map(|it| lanewise(it, top_left, u8::abs_diff));
                    for ((sum, top), left) in nearer_by.iter_mut().zip(top).zip(left) {
                        *sum += i16::from(top) - i16::from(left);
                    }
                }
                *masks = nearer_by.map(|it| (it >> 15) as u8);
            }
        }
    }

    fn replaces_colors_in(&self, tile: Tile) -> bool {
        let has_zero = |row: &[u8]| row.iter().fold(u8::MAX, |min, &alpha| min.min(alpha)) == 0;
        let [.., alpha] = &*self.channels;
        let alpha = alpha.plane.as_ref();
        self.rows.hidden == HiddenColors::Replaced
            && alpha.is_some_and(|alpha| alpha.around(tile, 1, 0).any(has_zero))
    }

    /// One pixel at a time, as each may change what the next is predicted from.
    fn count_replacing_colors(&mut self, tile: Tile) {
        let residuals = self.residuals.part_mut(..tile.width);
        for mode in 0..MODES {
            let mut counts = self.channels.each_mut().map(|it| it.residuals.at_mut(mode));
            let end = tile.x + tile.width;
            if let Some(above) = tile.y.checked_sub(1) {
                self.rows.advance(self.pixels, above, tile.x, end);
            }
            for y in tile.y..tile.y + tile.height {
                self.rows.advance(self.pixels, y, tile.x, end);
                self.rows.subtract(mode as u8, tile.x, y, residuals);
                for residual in &*residuals {
                    for (counts, value) in counts.iter_mut().zip(residual.to_le_bytes()) {
                        *counts.at_mut(value.into()) += 1;
                    }
                }
            }
        }
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/predictor_enc.c#L334
    fn best_mode(&mut self, tile: Tile, neighbors: [Option<u8>; 2]) -> u8 {
        const SAME_AS_NEIGHBOR: i64 = 15 * ONE_BIT as i64;
        let flat_value = |channel: &Channel| channel.flat_value(tile, self.pixels.value(0));
        let mut flat_values = self.channels.each_ref().map(flat_value);
        let is_replacing = flat_values.contains(&None) && self.replaces_colors_in(tile);
        if is_replacing {
            flat_values = [None; 4];
            self.count_replacing_colors(tile);
        }
        let mut costs = [0; MODES];
        for neighbor in neighbors.into_iter().flatten() {
            *costs.at_mut(neighbor.into()) -= SAME_AS_NEIGHBOR;
        }
        for (channel, flat_value) in self.channels.iter_mut().zip(flat_values) {
            let channel_costs = match (flat_value, &channel.plane) {
                (Some(value), _) => channel.count_flat(tile, value),
                (None, Some(plane)) if !is_replacing => {
                    let black = channel.of(BLACK);
                    count(
                        &mut channel.residuals,
                        tile,
                        black,
                        plane,
                        &self.prefers_left,
                    );
                    channel.costs()
                }
                (None, _) => channel.costs(),
            };
            for (cost, more) in costs.iter_mut().zip(channel_costs) {
                *cost += more;
            }
        }
        let best = (0..).zip(costs).min_by_key(|&(_, cost)| cost);
        let (mode, _): (u8, _) = known(best).unwrap_or_default();
        for (channel, flat_value) in self.channels.iter_mut().zip(flat_values) {
            let used = if flat_value.is_some() { 2 } else { MODES };
            let chosen = usize::from(mode).min(used - 1);
            channel.totals.add(channel.residuals.at(chosen));
            let used = channel.residuals.part_mut(..used);
            used.as_flattened_mut().fill(0);
        }
        mode
    }
}

fn choose_modes(
    pixels: &[Argb],
    width: usize,
    height: usize,
    bits: u32,
    rows: &mut Rows,
) -> Result<Tiles> {
    let mut modes = Tiles::new(width, height, bits)?;
    let mut search = Search::new(pixels, width, bits, rows)?;
    for y in (0..height).step_by(1 << bits) {
        let height = (height - y).min(1 << bits);
        search.read_rows(y, height);
        let mut left = None;
        for x in (0..width).step_by(1 << bits) {
            let tile = Tile {
                x,
                y,
                width: (width - x).min(1 << bits),
                height,
            };
            let mode = search.best_mode(tile, [left, modes.above_next().map(mode_of)]);
            modes.pixels.push(BLACK | Argb::from(mode) << 8);
            left = Some(mode);
        }
    }
    modes.merge();
    Ok(modes)
}

/// Returns which predictor is for which tile.
pub(super) fn apply(
    pixels: &mut [Argb],
    width: usize,
    height: usize,
    bits: u32,
    hidden: HiddenColors,
) -> Result<Tiles> {
    let bits = tiles::fitted(bits, width, height, MAX_TILES);
    let mut rows = Rows::new(width, hidden)?;
    let modes = choose_modes(pixels, width, height, bits, &mut rows)?;
    for y in 0..height {
        rows.advance(pixels, y, 0, width);
        let row = pixels.part_mut(y * width..(y + 1) * width);
        let tiles = row.chunks_mut(1 << modes.bits);
        for ((tile_x, residuals), &tile) in tiles.enumerate().zip(modes.row(y)) {
            rows.subtract(mode_of(tile), tile_x << modes.bits, y, residuals);
        }
    }
    Ok(modes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_pixel_is_predicted_like_four() -> Result<()> {
        const WIDTH: usize = 1 + 4 * 500;
        // Few values, for ties, and from both ends of the range.
        let pixel = |i: usize| (i as u32).wrapping_pow(3).wrapping_mul(0x9e37_79b1) & 0xc3c3_c3c3;
        let pixels: [Argb; 2 * WIDTH] = core::array::from_fn(pixel);
        let mut rows = Rows::new(WIDTH, HiddenColors::Kept)?;
        rows.advance(&pixels, 0, 0, WIDTH);
        rows.advance(&pixels, 1, 0, WIDTH);
        for mode in 0..MODES as u8 {
            let [mut by_four, mut by_one] = [[0; WIDTH]; 2];
            rows.subtract(mode, 0, 1, &mut by_four);
            for (x, residual) in by_one.chunks_mut(1).enumerate() {
                rows.subtract(mode, x, 1, residual);
            }
            assert_eq!(by_four, by_one);
        }
        Ok(())
    }

    #[test]
    fn a_flat_tile_costs_what_any_other_does() -> Result<()> {
        let (mut plane, prefers_left) = (Plane::new(64, 16)?, Plane::new(64, 16)?);
        plane.bytes.fill(7);
        for shift in [0, 24] {
            for (x, y) in [(0, 0), (32, 0), (0, 16), (32, 16)] {
                let tile = Tile {
                    x,
                    y,
                    width: 32,
                    height: 16,
                };
                let [flat, any] = &mut *vec::default_array::<Channel, 2>()?;
                (flat.shift, any.shift) = (shift, shift);
                let costs = flat.count_flat(tile, 7);
                let black = any.of(BLACK);
                count(&mut any.residuals, tile, black, &plane, &prefers_left);
                assert_eq!(flat.residuals.part(..2), any.residuals.part(..2));
                let [_, others, ..] = any.costs();
                assert_eq!(costs, any.costs().map(|it| it - others));
            }
        }
        Ok(())
    }
}
