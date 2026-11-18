//! How much of each pixel a shape covers, eight pixels at a time and only near its edges.
//!
//! Each quarter of a row has its edges in the order of their middles, and what is between those that the rule makes
//! boundaries is measured exactly. All else is a shortcut to the same result.

use std::array::from_fn;
use std::cmp::Ordering;
use std::marker::PhantomData;
use std::ops::Range;

use super::edges::{Chain, Edges, Line, PERIOD, Rule, Shape};
use super::gradient::Ramp;
use super::raster::{Coverage, IntRect, Pixel, fill_through, prefer_wide};

/// Eight of them.
pub trait Floats: Copy {
    type Order: Copy;

    /// In a function of its own, the only kind of place where these are fast. `f` is `#[inline(always)]`.
    fn apart<R>(f: impl FnOnce() -> R) -> R;
    fn new(all: [f32; 8]) -> Self;
    fn all(self) -> [f32; 8];
    /// Of numbers that are small and not negative.
    fn trunc(self) -> Self;
    /// Likewise.
    fn whole(self) -> [i32; 8];
    /// A bit for each that is greater.
    fn above(self, other: Self) -> u32;
    /// For `or`: a bit for each.
    fn choice(bits: u32) -> Self;
    /// These where `choice` has a bit.
    fn or(self, other: Self, choice: Self) -> Self;
    fn order(indices: [u8; 8]) -> Self::Order;
    fn reorder(self, order: Self::Order) -> Self;
    fn add(self, other: Self) -> Self;
    fn sub(self, other: Self) -> Self;
    fn mul(self, other: Self) -> Self;
    fn min(self, other: Self) -> Self;
    fn max(self, other: Self) -> Self;
    fn sqrt(self) -> Self;
    /// The last of `other`, and all but the last of these.
    fn after(self, other: Self) -> Self;
    /// Without the fractions, and from 0 to 255.
    fn bytes(self) -> [u8; 8];
}

const INDICES: [f32; 8] = [0., 1., 2., 3., 4., 5., 6., 7.];

impl Floats for [f32; 8] {
    type Order = [u8; 8];

    #[inline(never)]
    fn apart<R>(f: impl FnOnce() -> R) -> R {
        f()
    }

    #[inline(always)]
    fn new(all: [f32; 8]) -> Self {
        all
    }

    #[inline(always)]
    fn all(self) -> [f32; 8] {
        self
    }

    #[inline(always)]
    fn trunc(self) -> Self {
        from_fn(|it| whole(self[it], 1e9) as f32)
    }

    #[inline(always)]
    fn whole(self) -> [i32; 8] {
        from_fn(|it| whole(self[it], 1e9))
    }

    #[inline(always)]
    fn above(self, other: Self) -> u32 {
        (0..8).fold(0, |all, it| all | u32::from(self[it] > other[it]) << it)
    }

    #[inline(always)]
    fn choice(bits: u32) -> Self {
        from_fn(|it| (bits >> it & 1) as f32)
    }

    #[inline(always)]
    fn or(self, other: Self, choice: Self) -> Self {
        from_fn(|it| {
            if choice[it] != 0. {
                self[it]
            } else {
                other[it]
            }
        })
    }

    #[inline(always)]
    fn order(indices: [u8; 8]) -> [u8; 8] {
        indices
    }

    #[inline(always)]
    fn reorder(self, order: [u8; 8]) -> Self {
        from_fn(|it| self[usize::from(order[it]) % 8])
    }

    #[inline(always)]
    fn add(self, other: Self) -> Self {
        from_fn(|it| self[it] + other[it])
    }

    #[inline(always)]
    fn sub(self, other: Self) -> Self {
        from_fn(|it| self[it] - other[it])
    }

    #[inline(always)]
    fn mul(self, other: Self) -> Self {
        from_fn(|it| self[it] * other[it])
    }

    #[inline(always)]
    fn min(self, other: Self) -> Self {
        from_fn(|it| ordered(self[it], other[it]).0)
    }

    #[inline(always)]
    fn max(self, other: Self) -> Self {
        from_fn(|it| ordered(self[it], other[it]).1)
    }

    #[inline(always)]
    fn sqrt(self) -> Self {
        from_fn(|it| self[it].sqrt())
    }

    #[inline(always)]
    fn after(self, other: Self) -> Self {
        from_fn(|it| if it == 0 { other[7] } else { self[it - 1] })
    }

    #[inline(always)]
    fn bytes(self) -> [u8; 8] {
        from_fn(|it| whole(self[it], 255.) as u8)
    }
}

#[derive(Clone, Copy, Default)]
#[repr(align(32))]
pub struct Stored(pub [f32; 8]);

impl Stored {
    #[inline(always)]
    fn new(from: impl Floats) -> Stored {
        Stored(from.all())
    }

    #[inline(always)]
    pub fn get<F: Floats>(&self) -> F {
        F::new(self.0)
    }
}

/// Gets the indices of pixels, in any order. Those that it does not get are not covered, and only one of the alphas that
/// it gets for a pixel is not 0.
pub trait Sink<F> {
    /// See `Floats::bytes`.
    fn eights(&mut self, places: &[u32], alphas: &[Stored]);
    #[inline(always)]
    fn expect(&self, _place: u32) {}
    fn some(&mut self, place: usize, alphas: &[u8]);
    fn run(&mut self, places: Range<usize>, alpha: u8);
}

/// Onto what is clear.
impl<F: Floats> Sink<F> for &mut [u8] {
    #[inline(always)]
    fn eights(&mut self, places: &[u32], alphas: &[Stored]) {
        for (place, alphas) in places.iter().zip(alphas) {
            if let Some(eight) = self
                .get_mut(*place as usize..)
                .and_then(|it| it.first_chunk_mut())
            {
                *eight = (u64::from_ne_bytes(*eight)
                    | u64::from_ne_bytes(alphas.get::<F>().bytes()))
                .to_ne_bytes();
            }
        }
    }

    fn some(&mut self, place: usize, alphas: &[u8]) {
        self[place..]
            .iter_mut()
            .zip(alphas)
            .for_each(|(to, from)| *to |= from);
    }

    #[inline(always)]
    fn run(&mut self, places: Range<usize>, alpha: u8) {
        self[places].fill(alpha);
    }
}

/// Of a boundary, within a row.
#[derive(Clone, Copy, Default)]
struct Piece {
    low: f32,
    high: f32,
    /// Half of the steepness. Both are in alphas, and negative if the shape is on its left.
    growth: f32,
    height: f32,
}

const QUARTER: f32 = 255. / 4.;

#[inline(always)]
fn ordered(a: f32, b: f32) -> (f32, f32) {
    (if a < b { a } else { b }, if a > b { a } else { b })
}

/// The area that is right of a piece and left of each of `ends`.
#[inline(always)]
fn area_until<F: Floats>(ends: F, [low, width, growth, height]: [f32; 4]) -> F {
    let past = ends.sub(F::new([low; 8])).max(F::new([0.; 8]));
    let along = past.min(F::new([width; 8]));
    along
        .mul(along)
        .mul(F::new([growth; 8]))
        .add(past.sub(along).mul(F::new([height; 8])))
}

impl Piece {
    #[inline(always)]
    fn new(line: &Line, from: i32, to: i32, sign: f32) -> Piece {
        let (low, high) = ordered(line.at(from), line.at(to));
        Piece {
            low,
            high,
            growth: line.steepness * (QUARTER / 2. * sign),
            height: (to - from) as f32 * (QUARTER * sign),
        }
    }

    #[inline(always)]
    fn area_until<F: Floats>(&self, ends: F) -> F {
        area_until(
            ends,
            [self.low, self.high - self.low, self.growth, self.height],
        )
    }

    /// Leaves what is right of `x`, which `low` is not, and returns the height of the rest.
    #[cold]
    fn cut(&mut self, x: f32) -> f32 {
        let gone = match self.high > x {
            true => ((x - self.low) * self.growth.abs() * 2.)
                .min(self.height.abs())
                .copysign(self.height),
            false => self.height,
        };
        (self.low, self.high, self.height) = (x, self.high.max(x), self.height - gone);
        gone
    }
}

/// In one row.
#[derive(Clone, Copy)]
struct Member {
    line: Line,
    winding: i32,
    order: u32,
    low: f32,
    high: f32,
    /// The quarter where it leaves the row.
    until: i32,
}

struct Part {
    line: Line,
    from: i32,
    to: i32,
    winding: i32,
    signs: [i8; 4],
}

#[derive(Default)]
pub struct Scanner {
    /// What is left of them.
    active: Vec<Chain>,
    sides: Vec<Side>,
    /// Of the sides.
    sorted: Vec<(f32, u32)>,
    members: Vec<Member>,
    mask: Vec<u8>,
    queue: Option<Box<Queue>>,
    pieces: Vec<Piece>,
    parts: Vec<Part>,
    order: Vec<(f32, u32)>,
    /// They are zero between uses.
    turns: Vec<Turns>,
}

/// How the winding changes at a quarter of a column, in each quarter of eight rows.
#[derive(Clone, Copy, Default)]
#[repr(align(64))]
struct Turns([u16; 32]);

impl Rule {
    #[inline(always)]
    pub(super) fn has(self, winding: i32) -> bool {
        match self {
            Rule::NonZero => winding != 0,
            Rule::EvenOdd => winding & 1 != 0,
            Rule::Negative => winding < 0,
            Rule::Positive => winding > 0,
        }
    }
}

#[inline(always)]
fn clamp(value: f32, most: f32) -> f32 {
    let value = if value > 0. { value } else { 0. };
    if value < most { value } else { most }
}

#[inline(always)]
fn whole(value: f32, most: f32) -> i32 {
    // SAFETY: it is a number from 0 to `most`, which the callers keep small.
    unsafe { clamp(value, most).to_int_unchecked() }
}

#[inline(always)]
fn alpha(area: f32) -> u8 {
    whole(area + 0.5, 255.) as u8
}

#[inline(always)]
fn alphas<F: Floats>(areas: F) -> F {
    areas.add(F::new([0.5; 8]))
}

#[inline(always)]
fn ends_from<F: Floats>(x: i32) -> F {
    F::new([x as f32; 8]).add(F::new([1., 2., 3., 4., 5., 6., 7., 8.]))
}

const ROOM: usize = 64;

/// One column for eight pixels, which begin at 0, and two pieces.
struct Pending {
    /// The arguments of `area_until`.
    pieces: [[[f32; ROOM + 8]; 4]; 2],
    /// The area that is left of the pixels.
    before: [f32; ROOM + 8],
    count: usize,
}

impl Pending {
    #[inline(always)]
    fn areas<F: Floats>(&self, index: usize) -> F {
        let ([a, b], ends) = (&self.pieces, F::new(INDICES.map(|it| it + 1.)));
        let sums = area_until(ends, [a[0][index], a[1][index], a[2][index], a[3][index]]).add(
            area_until(ends, [b[0][index], b[1][index], b[2][index], b[3][index]]),
        );
        sums.sub(sums.after(F::new([self.before[index]; 8])))
    }
}

/// Much more can be in progress at a time if each step is a loop of its own, and branches are few.
struct Queue {
    first: Pending,
    places: [f32; ROOM + 8],
    /// Where there are more pieces.
    more: Pending,
    /// In `first`.
    owners: [u8; ROOM + 8],
    known_places: [u32; ROOM * 2],
    known: [Stored; ROOM * 2],
    known_count: usize,
}

impl Default for Queue {
    fn default() -> Queue {
        let blank = || Pending {
            pieces: [[[0.; _]; _]; _],
            before: [0.; _],
            count: 0,
        };
        Queue {
            first: blank(),
            places: [0.; _],
            more: blank(),
            owners: [0; _],
            known_places: [0; _],
            known: [Stored::default(); _],
            known_count: 0,
        }
    }
}

struct Output<'a, F, S> {
    sink: S,
    queue: &'a mut Queue,
    columns: Range<i32>,
    /// From one row to the next.
    stride: i32,
    /// The index of the pixel at 0, 0.
    zero: i64,
    lanes: PhantomData<F>,
}

#[inline(always)]
fn put(column: &mut [f32; ROOM + 8], index: usize, values: impl Floats) {
    column[index % ROOM..][..8].copy_from_slice(&values.all());
}

/// `area_until` for eight pieces.
#[inline(always)]
fn areas_until<F: Floats>(x: F, [low, width, growth, height]: [F; 4]) -> F {
    let past = x.sub(low).max(F::new([0.; 8]));
    let along = past.min(width);
    along
        .mul(along)
        .mul(growth)
        .add(past.sub(along).mul(height))
}

/// For each byte, the bits that it has, and how many of them are below each bit.
static BITS: [[[u8; 8]; 2]; 256] = {
    let (mut all, mut byte) = ([[[0; 8]; 2]; 256], 0);
    while byte < 256 {
        let (mut bit, mut count) = (0, 0);
        while bit < 8 {
            all[byte][1][bit] = count as u8;
            if byte >> bit & 1 != 0 {
                all[byte][0][count] = bit as u8;
                count += 1;
            }
            bit += 1;
        }
        byte += 1;
    }
    all
};

#[inline(always)]
fn count_of(rows: u32) -> usize {
    usize::from(BITS[rows as usize % 256][1][7]) + (rows as usize >> 7 & 1)
}

#[inline(always)]
fn each(mut bits: u32) -> impl Iterator<Item = usize> {
    std::iter::from_fn(move || {
        let bit = (bits != 0).then(|| bits.trailing_zeros() as usize % 8);
        bits &= bits.wrapping_sub(1);
        bit
    })
}

impl Pending {
    #[inline(always)]
    fn add<F: Floats>(&mut self, x: F, rows: u32, pieces: [[F; 4]; 2], is_first: bool) -> F::Order {
        let (order, index) = (F::order(BITS[rows as usize % 256][0]), self.count);
        for (to, [low, width, growth, height]) in self.pieces.iter_mut().zip(pieces) {
            put(&mut to[0], index, low.sub(x).reorder(order));
            put(&mut to[1], index, width.reorder(order));
            put(&mut to[2], index, growth.reorder(order));
            put(&mut to[3], index, height.reorder(order));
        }
        put(
            &mut self.before,
            index,
            if is_first {
                F::new([0.; 8])
            } else {
                areas_until(x, pieces[0])
                    .add(areas_until(x, pieces[1]))
                    .reorder(order)
            },
        );
        self.count += count_of(rows);
        order
    }
}

impl<F: Floats, S: Sink<F>> Output<'_, F, S> {
    #[inline(always)]
    fn place(&self, x: i32, y: i32) -> usize {
        (self.zero + i64::from(y) * i64::from(self.stride) + i64::from(x)) as usize
    }

    fn flush(&mut self) {
        F::apart(
            #[inline(always)]
            || {
                let Queue {
                    first,
                    places,
                    more,
                    owners,
                    known_places,
                    known,
                    known_count,
                } = &mut *self.queue;
                let (start, end) = (*known_count, *known_count + first.count);
                for (index, (to, place)) in known[start..end]
                    .iter_mut()
                    .zip(&mut known_places[start..end])
                    .enumerate()
                {
                    (*to, *place) = (
                        Stored::new(alphas(first.areas::<F>(index % ROOM))),
                        places[index % ROOM].to_bits(),
                    );
                    self.sink.expect(*place);
                }
                for (index, owner) in owners[..more.count].iter().enumerate() {
                    let to = &mut known[(start + usize::from(*owner)) % (ROOM * 2)];
                    *to = Stored::new(more.areas::<F>(index % ROOM).add(to.get()));
                }
                (first.count, more.count, *known_count) = (0, 0, 0);
                self.sink.eights(&known_places[..end], &known[..end]);
            },
        );
    }

    #[inline(always)]
    fn eight(&mut self, x: i32, y: i32, alphas: F) {
        let index = self.queue.known_count % ROOM;
        (
            self.queue.known_places[index],
            self.queue.known[index],
            self.queue.known_count,
        ) = (self.place(x, y) as u32, Stored::new(alphas), index + 1);
        if index + 1 == ROOM {
            self.flush();
        }
    }

    #[inline(always)]
    fn run(&mut self, columns: Range<i32>, y: i32, alpha: u8) {
        if alpha != 0 {
            let start = self.place(columns.start, y);
            self.sink.run(start..start + columns.len(), alpha);
        }
    }

    /// For eight pixels from `x` on in some of the rows from `top` on. `more` is for those that are `bent`.
    #[inline(always)]
    fn add(
        &mut self,
        x: F,
        top: i32,
        [rows, bent]: [u32; 2],
        pieces: [[F; 4]; 2],
        more: [[F; 4]; 2],
        is_first: bool,
    ) {
        if self.queue.first.count + 8 > ROOM {
            self.flush();
        }
        let (start, stride, columns) = (
            self.place(self.columns.start, top) as u32,
            self.stride as u32,
            x.sub(F::new([self.columns.start as f32; 8])).whole(),
        );
        let places = F::new(from_fn(|row| {
            f32::from_bits(
                start
                    .wrapping_add(stride.wrapping_mul(row as u32))
                    .wrapping_add(columns[row] as u32),
            )
        }));
        let (index, queue) = (self.queue.first.count, &mut *self.queue);
        let order = queue.first.add(x, rows, pieces, is_first);
        put(&mut queue.places, index, places.reorder(order));
        if bent & rows != 0 {
            let (ranks, chosen) = (
                BITS[rows as usize % 256][1],
                BITS[(bent & rows) as usize % 256][0],
            );
            queue.owners[queue.more.count % ROOM..][..8].copy_from_slice(&from_fn::<_, 8, _>(
                |it| index as u8 + ranks[usize::from(chosen[it]) % 8],
            ));
            queue.more.add(x, bent & rows, more, false);
        }
    }

    /// What is between two sides in some of the rows from `top` on.
    #[inline(always)]
    fn fill(&mut self, left: &Side, right: &Side, top: i32, rows: u32) {
        let (first, last, eight, zero) = (
            F::new([self.columns.start as f32; 8]),
            F::new([self.columns.end as f32; 8]),
            F::new([8.; 8]),
            F::new([0.; 8]),
        );
        let (entered, leaving) = (left.high.get::<F>(), right.low.get::<F>());
        let (low, high) = (leaving.min(left.low.get()), entered.max(right.high.get()));
        let (pieces, more) = (
            [left.pieces::<F>(0, 1.), right.pieces(0, -1.)],
            [left.pieces::<F>(1, 1.), right.pieces(1, -1.)],
        );
        let (mut x, resumes) = (
            low.sub(first).trunc().add(first),
            leaving.sub(first).trunc().add(first),
        );
        let fit = rows & !(first.above(low) | high.add(eight).above(last));
        let (width, bent) = (high.sub(x), left.bent | right.bent);
        let mut narrow = fit & !width.above(F::new([24.; 8]));
        let apart = fit & !narrow & !(entered.sub(x).above(eight) | high.sub(resumes).above(eight));
        if apart != 0 {
            let height = pieces[0][3].add(more[0][3]);
            self.add(
                x,
                top,
                [apart, left.bent],
                [pieces[0], [zero; 4]],
                [more[0], [zero; 4]],
                true,
            );
            self.add(
                resumes,
                top,
                [apart, right.bent],
                [[resumes, zero, zero, height], pieces[1]],
                [[zero; 4], more[1]],
                true,
            );
            let (from, to, height, start) = (
                x.sub(first).whole(),
                resumes.sub(first).whole(),
                height.all(),
                self.columns.start,
            );
            for row in each(apart) {
                self.run(
                    start + from[row] + 8..start + to[row],
                    top + row as i32,
                    alpha(height[row]),
                );
            }
        }
        let (others, mut is_first) = (rows & !(narrow | apart), true);
        while narrow != 0 {
            self.add(x, top, [narrow, bent], pieces, more, is_first);
            (x, is_first) = (x.add(eight), false);
            narrow &= high.above(x);
        }
        if others != 0 {
            F::apart(
                #[inline(always)]
                || {
                    for row in each(others) {
                        let (entering, leaving) =
                            (left.pieces_in(row, 1.), right.pieces_in(row, -1.));
                        between(
                            &entering[..1 + (left.bent >> row & 1) as usize],
                            &leaving[..1 + (right.bent >> row & 1) as usize],
                            top + row as i32,
                            self,
                        );
                    }
                },
            );
        }
    }
}

/// Eight pixels of a row that are not done yet.
struct Window<'a, 'b, F, S> {
    out: &'a mut Output<'b, F, S>,
    columns: Range<i32>,
    y: i32,
    /// What is before it is done.
    x: i32,
    is_open: bool,
    /// Of `Piece::area_until` its pixels end.
    sums: F,
    /// The last one is that sum for where it starts.
    before: F,
    /// The height of the pieces that end before it starts.
    base: f32,
    /// And of those that do before it ends.
    carried: f32,
}

impl<'a, 'b, F: Floats, S: Sink<F>> Window<'a, 'b, F, S> {
    #[inline(always)]
    fn new(out: &'a mut Output<'b, F, S>, y: i32) -> Self {
        Window {
            columns: out.columns.clone(),
            x: out.columns.start,
            out,
            y,
            is_open: false,
            sums: F::new([0.; 8]),
            before: F::new([0.; 8]),
            base: 0.,
            carried: 0.,
        }
    }

    #[inline(always)]
    fn close(&mut self) {
        let alphas = alphas(
            self.sums
                .sub(self.sums.after(self.before))
                .add(F::new([self.base; 8])),
        );
        match self.columns.end - self.x {
            8.. => self.out.eight(self.x, self.y, alphas),
            left => self.out.sink.some(
                self.out.place(self.x, self.y),
                &alphas.bytes()[..left as usize],
            ),
        }
        (self.x, self.is_open) = (self.x + 8, false);
    }

    /// False if there is nothing from there on.
    #[inline(always)]
    fn reach(&mut self, low: f32) -> bool {
        let Range { start, end } = self.columns;
        let column = start + whole(low - start as f32, (end - start) as f32);
        if column >= end {
            return false;
        }
        if self.is_open {
            if column < self.x + 8 {
                return true;
            }
            self.close();
        }
        if self.carried == 0. {
            self.x = column;
        } else if column - self.x >= 8 {
            self.out.run(self.x..column, self.y, alpha(self.carried));
            self.x = column;
        }
        (self.sums, self.before, self.base, self.is_open) =
            (F::new([0.; 8]), F::new([0.; 8]), self.carried, true);
        true
    }

    /// `rest` is what of `sums` is from pieces that go on. False at the end of the row.
    #[inline(always)]
    fn move_on(&mut self, rest: F) -> bool {
        self.close();
        (self.sums, self.before, self.base, self.is_open) = (
            F::new([0.; 8]),
            rest,
            self.carried,
            self.x < self.columns.end,
        );
        self.is_open
    }

    #[inline(always)]
    fn begin(&mut self, piece: &mut Piece) {
        if piece.low < self.columns.start as f32 {
            let gone = piece.cut(self.columns.start as f32);
            (self.base, self.carried) = (self.base + gone, self.carried + gone);
        }
    }

    /// Nothing that comes later is left of its end. False if nothing else matters.
    #[inline(always)]
    fn alone(&mut self, mut piece: Piece) -> bool {
        if !self.reach(piece.low) {
            return false;
        }
        self.begin(&mut piece);
        loop {
            let area = piece.area_until(ends_from(self.x));
            self.sums = self.sums.add(area);
            if piece.high <= (self.x + 8) as f32 {
                self.carried += piece.height;
                return true;
            }
            if !self.move_on(area) {
                return false;
            }
        }
    }

    /// Likewise, for those that are in the order of `low`.
    #[inline(always)]
    fn together(&mut self, pieces: &mut [Piece]) -> bool {
        let (mut done, mut begun, mut rest) = (0, 0, F::new([0.; 8]));
        while done < pieces.len() {
            if !(if done == begun {
                self.reach(pieces[begun].low)
            } else {
                self.move_on(rest)
            }) {
                return false;
            }
            let (end, ends, first) = ((self.x + 8) as f32, ends_from(self.x), done);
            while let Some(piece) = pieces.get_mut(begun).filter(|it| it.low < end) {
                self.begin(piece);
                begun += 1;
            }
            rest = F::new([0.; 8]);
            for index in first..begun {
                let piece = pieces[index];
                let area = piece.area_until(ends);
                self.sums = self.sums.add(area);
                if piece.high <= end {
                    self.carried += piece.height;
                    pieces.swap(done, index);
                    done += 1;
                } else {
                    rest = rest.add(area);
                }
            }
        }
        true
    }

    #[inline(always)]
    fn finish(mut self) {
        if self.is_open {
            self.close();
        }
        if self.carried != 0. && self.x < self.columns.end {
            self.out
                .run(self.x..self.columns.end, self.y, alpha(self.carried));
        }
    }
}

/// Most are in order.
fn sort<T: Copy>(items: &mut [T], is_before: impl Fn(&T, &T) -> bool) {
    let mut swaps_left = items.len() * 4 + 64;
    for next in 1..items.len() {
        let (item, mut at) = (items[next], next);
        while at > 0 && is_before(&item, &items[at - 1]) {
            items[at] = items[at - 1];
            at -= 1;
        }
        items[at] = item;
        let Some(left) = swaps_left.checked_sub(next - at) else {
            return items.sort_unstable_by(|a, b| {
                if is_before(a, b) {
                    Ordering::Less
                } else {
                    is_before(b, a).cmp(&false)
                }
            });
        };
        swaps_left = left;
    }
}

/// The lines of a chain between two quarters, and what of each is between them.
#[inline(always)]
fn parts_of(
    first: Line,
    lines: &[Line],
    start: i32,
    end: i32,
) -> impl Iterator<Item = (Line, i32, i32)> {
    std::iter::successors(Some(first), move |it| {
        lines
            .get(it.below as usize)
            .filter(|_| it.bottom < end)
            .copied()
    })
    .map(move |it| (it, it.top.max(start), it.bottom.min(end)))
}

/// The one that goes on below the quarter.
#[inline(always)]
fn line_below(mut index: u32, lines: &[Line], quarter: i32) -> Option<(u32, &Line)> {
    loop {
        match lines.get(index as usize)? {
            line if line.bottom > quarter => return Some((index, line)),
            line => index = line.below,
        }
    }
}

impl Member {
    #[inline(always)]
    fn new(chain: &Chain, lines: &[Line], start: i32) -> Option<Member> {
        let (end, winding) = (start + 4, chain.winding);
        let (order, &line) = line_below(chain.first, lines, start).filter(|it| it.1.top < end)?;
        let ((mut low, mut high), mut until, mut below) = (
            ordered(line.at(line.top.max(start)), line.at(line.bottom.min(end))),
            line.bottom.min(end),
            line.below,
        );
        while until < end
            && let Some(line) = lines.get(below as usize)
        {
            (until, below) = (line.bottom.min(end), line.below);
            let (first, last) = ordered(line.x, line.at(until));
            (low, high) = (ordered(low, first).0, ordered(high, last).1);
        }
        Some(Member {
            line,
            winding,
            order,
            low,
            high,
            until,
        })
    }
}

/// A bit for each quarter of eight rows: a byte for their first quarters, and so on.
type Quarters = u32;

/// Those before each.
static BEFORE: [Quarters; 33] = {
    let (mut all, mut quarter) = ([0; 33], 0);
    while quarter < 32 {
        all[quarter + 1] = all[quarter] | 1 << (quarter % 4 * 8 + quarter / 4);
        quarter += 1;
    }
    all
};

#[inline(always)]
fn rows_of(quarters: Quarters) -> u32 {
    let half = quarters | quarters >> 16;
    (half | half >> 8) & 255
}

#[inline(always)]
fn quarters_of(rows: u32) -> Quarters {
    rows * 0x0101_0101
}

/// Of a line, one for each of eight rows.
#[derive(Clone, Copy)]
struct Pieces<F> {
    upper: F,
    lower: F,
    steepness: F,
    quarters: F,
}

impl<F: Floats> Pieces<F> {
    #[inline(always)]
    fn new(line: &Line, start: i32) -> Self {
        let (x, step, zero, length) = (
            F::new([line.x; 8]),
            F::new([line.step; 8]),
            F::new([0.; 8]),
            F::new([(line.bottom - line.top) as f32; 8]),
        );
        let down = F::new([(start - line.top) as f32; 8]).add(F::new(INDICES.map(|it| it * 4.)));
        let (from, to) = (
            down.max(zero).min(length),
            down.add(F::new([4.; 8])).max(zero).min(length),
        );
        Pieces {
            upper: x.add(step.mul(from)),
            lower: x.add(step.mul(to)),
            steepness: F::new([line.steepness; 8]),
            quarters: to.sub(from),
        }
    }

    #[inline(always)]
    fn until(self, row: i32, other: Self) -> Self {
        let (
            Pieces {
                upper,
                lower,
                steepness,
                quarters,
            },
            choice,
        ) = (self, F::choice((1 << row) - 1));
        Pieces {
            upper: upper.or(other.upper, choice),
            lower: lower.or(other.lower, choice),
            steepness: steepness.or(other.steepness, choice),
            quarters: quarters.or(other.quarters, choice),
        }
    }
}

/// What a chain has in eight rows. The numbers have a bit for each.
#[derive(Clone, Default)]
struct Side {
    /// The fields of `Pieces`, for the first and for the last one in the row. There is only something to the latter where it is `bent`.
    pieces: [[Stored; 4]; 2],
    low: Stored,
    high: Stored,
    /// The least `low` from this one on.
    least: Stored,
    there: Quarters,
    bent: u32,
    bent_again: u32,
    winding: i32,
    to_do: u32,
    enters: u32,
    leaves: u32,
    /// It has nothing to do with what is before it.
    is_apart: u32,
    is_hard: u32,
}

impl Side {
    #[inline(always)]
    fn set<F: Floats>(&mut self, it: &Chain, lines: &[Line], start: i32, end: i32, left: F) {
        let (mut line, far, near) = (
            &lines[it.first as usize],
            F::new([f32::MAX; 8]),
            F::new([f32::MIN; 8]),
        );
        let mut first = Pieces::<F>::new(line, start);
        let (mut last, mut bent, mut bent_again, mut low, mut high) = (first, 0, 0, far, near);
        while line.bottom < end
            && let Some(below) = lines.get(line.below as usize)
        {
            let (next, at) = (Pieces::new(below, start), below.top - start);
            let bend = u32::from(at & 3 != 0) << (at >> 2);
            if bent & bend != 0 {
                let ((least, most), choice) =
                    (ordered(line.x, line.at(line.bottom)), F::choice(bend));
                (bent_again, low, high) = (
                    bent_again | bend,
                    low.min(F::new([least; 8]).or(far, choice)),
                    high.max(F::new([most; 8]).or(near, choice)),
                );
            }
            (first, last, bent, line) = (
                first.until((at + 3) >> 2, next),
                last.until(at >> 2, next),
                bent | bend,
                below,
            );
        }
        self.there = BEFORE[(line.bottom.min(end) - start) as usize]
            & !BEFORE[(it.top - start).max(0) as usize];
        (self.bent, self.bent_again, self.winding, self.to_do) =
            (bent, bent_again, it.winding, rows_of(self.there));
        (low, high) = (
            low.min(first.upper.min(first.lower))
                .min(last.upper.min(last.lower)),
            high.max(first.upper.max(first.lower))
                .max(last.upper.max(last.lower)),
        );
        if left.above(low) != 0 {
            let shows = F::choice(high.above(left));
            (low, high, first.upper, first.lower) = (
                low.or(left, shows),
                high.or(left, shows),
                first.upper.or(left, shows),
                first.lower.or(left, shows),
            );
            (last.upper, last.lower) = (last.upper.or(left, shows), last.lower.or(left, shows));
        }
        (self.low, self.high) = (Stored::new(low), Stored::new(high));
        let (zero, choice) = (F::new([0.; 8]), F::choice(bent));
        self.pieces[0] = [
            Stored::new(first.upper),
            Stored::new(first.lower),
            Stored::new(first.steepness),
            Stored::new(first.quarters),
        ];
        self.pieces[1] = [
            Stored::new(last.upper),
            Stored::new(last.lower),
            Stored::new(last.steepness.or(zero, choice)),
            Stored::new(last.quarters.or(zero, choice)),
        ];
    }

    /// The arguments of `areas_until`.
    #[inline(always)]
    fn pieces<F: Floats>(&self, index: usize, sign: f32) -> [F; 4] {
        let [upper, lower, steepness, quarters] = &self.pieces[index];
        let low = upper.get::<F>().min(lower.get());
        [
            low,
            upper.get::<F>().max(lower.get()).sub(low),
            steepness.get::<F>().mul(F::new([QUARTER / 2. * sign; 8])),
            quarters.get::<F>().mul(F::new([QUARTER * sign; 8])),
        ]
    }

    #[inline(always)]
    fn pieces_in(&self, row: usize, sign: f32) -> [Piece; 2] {
        from_fn(|it| {
            let [upper, lower, steepness, quarters] = &self.pieces[it];
            let (low, high) = ordered(upper.0[row], lower.0[row]);
            Piece {
                low,
                high,
                growth: steepness.0[row] * (QUARTER / 2. * sign),
                height: quarters.0[row] * (QUARTER * sign),
            }
        })
    }

    #[inline(always)]
    fn middle(&self, row: usize) -> f32 {
        self.pieces[0][0].0[row] + self.pieces[1][1].0[row]
    }
}

/// For each quarter, from -7 to 7: one number for each binary digit.
#[derive(Default)]
struct Windings([Quarters; 4]);

impl Windings {
    #[inline(always)]
    fn turn(&mut self, mut carry: Quarters, by: i32) {
        for digit in &mut self.0 {
            (*digit, carry) = (*digit ^ carry, (*digit ^ (by >> 1) as u32) & carry);
        }
    }

    #[inline(always)]
    fn not_zero(&self) -> Quarters {
        self.0[0] | self.0[1] | self.0[2] | self.0[3]
    }

    #[inline(always)]
    fn too_much(&self) -> Quarters {
        self.0[3] & !(self.0[0] | self.0[1] | self.0[2])
    }

    #[inline(always)]
    fn inside(&self, rule: Rule) -> Quarters {
        match rule {
            Rule::NonZero => self.not_zero(),
            Rule::EvenOdd => self.0[0],
            Rule::Negative => self.0[3],
            Rule::Positive => self.not_zero() & !self.0[3],
        }
    }
}

const SLACK: f32 = 1. / 1024.;

/// Fills what is simple if the sides are in this order, and returns the rows that have more to do.
#[inline(always)]
fn fill_in_order<F: Floats>(
    sides: &mut [Side],
    sorted: &[(f32, u32)],
    rule: Rule,
    top: i32,
    out: &mut Output<F, impl Sink<F>>,
) -> u32 {
    let (far, near, slack, zero, first) = (
        F::new([f32::MAX; 8]),
        F::new([f32::MIN; 8]),
        F::new([SLACK; 8]),
        F::new([0.; 8]),
        F::new([out.columns.start as f32; 8]),
    );
    let mut least = far;
    for (_, index) in sorted.iter().rev() {
        let side = &mut sides[*index as usize];
        least = least.min(side.low.get::<F>().or(far, F::choice(side.to_do)));
        side.least = Stored::new(least);
    }
    let (mut most, mut filled, mut upper, mut lower) = (near, near, near, near);
    let (mut windings, mut inside, mut there_before, mut bent_before, mut lost, mut hard) =
        (Windings::default(), 0, 0, 0, 0, 0);
    for (_, index) in sorted {
        let side = &mut sides[*index as usize];
        let (rows, there, low) = (
            side.to_do,
            side.there & quarters_of(side.to_do),
            side.low.get::<F>(),
        );
        let column = |it: F| {
            it.sub(first)
                .max(zero)
                .min(F::new([1e9; 8]))
                .trunc()
                .add(first)
        };
        let open = if rule == Rule::EvenOdd {
            inside
        } else {
            windings.not_zero()
        };
        side.is_apart = !(rows_of(open) | lost | most.above(column(side.least.get())));
        let (above, below) = (side.pieces[0][0].get::<F>(), side.pieces[0][1].get::<F>());
        let unlike = rows_of(there ^ there_before)
            | side.bent
            | bent_before
            | upper.above(above.add(slack))
            | lower.above(below.add(slack));
        let was_inside = inside;
        windings.turn(
            there,
            if rule == Rule::EvenOdd {
                1
            } else {
                side.winding
            },
        );
        inside = windings.inside(rule);
        lost |= if side.winding.abs() != 1 {
            rows
        } else if rule == Rule::EvenOdd {
            0
        } else {
            rows_of(windings.too_much())
        };
        (side.enters, side.leaves) = (rows_of(inside & !was_inside), rows_of(was_inside & !inside));
        let uneven = side.enters & rows_of(was_inside | inside ^ there)
            | side.leaves & rows_of(inside | was_inside ^ there);
        let touches = side.enters & filled.above(column(low));
        hard = hard & !side.is_apart
            | rows
                & (most.above(low.add(slack)) & unlike
                    | uneven
                    | touches
                    | side.bent_again & (side.enters | side.leaves))
            | lost;
        side.is_hard = hard;
        let choice = F::choice(rows);
        most = most.max(side.high.get::<F>().or(near, choice));
        (filled, upper, lower) = (
            most.or(filled, F::choice(side.leaves)),
            above.or(upper, choice),
            below.or(lower, choice),
        );
        (there_before, bent_before) = (
            there_before & !quarters_of(rows) | there,
            bent_before & !rows | side.bent & rows,
        );
    }
    let mut hard = rows_of(inside);
    for (_, index) in sorted.iter().rev() {
        let side = &mut sides[*index as usize];
        side.is_hard |= hard;
        hard = side.is_hard & !side.is_apart;
    }
    let (mut left, mut openers) = (0, [0; 8]);
    for (_, index) in sorted {
        let side = &mut sides[*index as usize];
        let easy = side.to_do & !side.is_hard;
        (side.to_do, side.enters) = (side.to_do & side.is_hard, side.enters & easy);
        left |= side.to_do;
        let (enters, mut leaves) = (side.enters, side.leaves & easy);
        openers = from_fn(|row| {
            if enters >> row & 1 != 0 {
                *index
            } else {
                openers[row]
            }
        });
        while leaves != 0 {
            let opener = openers[leaves.trailing_zeros() as usize % 8] as usize;
            let both = leaves & sides[opener].enters;
            (leaves, sides[opener].enters) = (leaves & !both, sides[opener].enters & !both);
            out.fill(&sides[opener], &sides[*index as usize], top, both);
        }
    }
    left
}

impl Scanner {
    pub fn bytes(&self) -> usize {
        self.turns.capacity() * size_of::<Turns>()
            + self.sides.capacity() * size_of::<Side>()
            + self.mask.capacity()
            + self.members.capacity() * size_of::<Member>()
            + self.active.capacity() * size_of::<Chain>()
            + self.pieces.capacity() * size_of::<Piece>()
            + self.parts.capacity() * size_of::<Part>()
    }

    /// Finds the pieces for some of the members, given the windings that the quarters have before them.
    #[inline(never)]
    fn resolve(
        &mut self,
        group: Range<usize>,
        lines: &[Line],
        rule: Rule,
        start: i32,
        left: f32,
        windings: &mut [i32; 4],
    ) {
        let Scanner {
            members,
            pieces,
            parts,
            order,
            ..
        } = self;
        pieces.clear();
        parts.clear();
        for it in &members[group.clone()] {
            let all = parts_of(it.line, lines, start, start + 4);
            parts.extend(all.map(|(line, from, to)| Part {
                line,
                from,
                to,
                winding: it.winding,
                signs: [0; 4],
            }));
        }
        let cross = |part: &mut Part, index: usize, winding: &mut i32| {
            let was_inside = rule.has(*winding);
            *winding += part.winding;
            part.signs[index] = i8::from(rule.has(*winding)) - i8::from(was_inside);
        };
        if group.len() == 1 {
            for part in parts.iter_mut() {
                ((part.from - start) as usize..(part.to - start) as usize)
                    .for_each(|it| cross(part, it, &mut windings[it]));
            }
        } else {
            order.clear();
            order.extend((0..parts.len() as u32).map(|it| (0., it)));
            for ((index, quarter), winding) in (start..start + 4).enumerate().zip(windings) {
                for (place, part) in order.iter_mut() {
                    let part = &parts[*part as usize];
                    *place = rank(&part.line, quarter.clamp(part.from, part.to - 1), left);
                }
                sort(order, |a, b| a.0 < b.0);
                for (_, part) in order.iter() {
                    let part = &mut parts[*part as usize];
                    if (part.from..part.to).contains(&quarter) {
                        cross(part, index, winding);
                    }
                }
            }
        }
        for part in parts.iter() {
            let (mut from, sign) = (part.from, |quarter: i32| {
                part.signs[(quarter - start) as usize & 3]
            });
            while from < part.to {
                let to = (from + 1..part.to)
                    .find(|it| sign(*it) != sign(from))
                    .unwrap_or(part.to);
                if sign(from) != 0 {
                    pieces.push(Piece::new(&part.line, from, to, sign(from).into()));
                }
                from = to;
            }
        }
        sort(pieces, |a, b| a.low < b.low);
    }

    #[inline(always)]
    fn row<F: Floats>(
        &mut self,
        lines: &[Line],
        rule: Rule,
        start: i32,
        window: &mut Window<F, impl Sink<F>>,
    ) {
        let (mut index, mut windings, mut is_even) = (0, [0; 4], true);
        while let Some(it) = self.members.get(index) {
            let first = index;
            let mut high = it.high;
            index += 1;
            while let Some(next) = self.members.get(index).filter(|it| it.low < high) {
                (index, high) = (index + 1, ordered(high, next.high).1);
            }
            if is_even && first + 1 == index && it.line.top <= start && it.until == start + 4 {
                let was_inside = rule.has(windings[0]);
                windings = windings.map(|winding| winding + it.winding);
                let sign = if was_inside { -1. } else { 1. };
                if was_inside == rule.has(windings[0]) {
                    continue;
                }
                if it.line.bottom >= start + 4 {
                    match window.alone(Piece {
                        low: it.low,
                        high,
                        growth: it.line.steepness * (QUARTER / 2. * sign),
                        height: 255. * sign,
                    }) {
                        true => continue,
                        false => return,
                    }
                }
                self.pieces.clear();
                self.pieces.extend(
                    parts_of(it.line, lines, start, start + 4)
                        .map(|(line, from, to)| Piece::new(&line, from, to, sign)),
                );
                sort(&mut self.pieces, |a, b| a.low < b.low);
            } else {
                self.resolve(
                    first..index,
                    lines,
                    rule,
                    start,
                    window.columns.start as f32,
                    &mut windings,
                );
                is_even = windings == [windings[0]; 4];
            }
            if !window.together(&mut self.pieces) {
                return;
            }
        }
    }

    /// At most eight.
    #[inline(always)]
    fn fill_rows<F: Floats>(
        &mut self,
        rows: Range<i32>,
        lines: &[Line],
        rule: Rule,
        out: &mut Output<F, impl Sink<F>>,
    ) {
        const MAX_SIDES: usize = 1 << 12;
        let Scanner {
            active,
            sides,
            sorted,
            ..
        } = self;
        if active.len() > MAX_SIDES {
            return self.fill_hard_rows(rows.start, (1 << rows.len()) - 1, false, lines, rule, out);
        }
        if sides.len() < active.len() {
            sides.resize(active.len(), Side::default());
        }
        sorted.clear();
        for (index, (side, it)) in (0..).zip(sides.iter_mut().zip(active.iter())) {
            side.set(
                it,
                lines,
                rows.start * 4,
                rows.end * 4,
                F::new([out.columns.start as f32; 8]),
            );
            sorted.push((side.middle(side.to_do.trailing_zeros() as usize % 8), index));
        }
        sort(sorted, |a, b| a.0 < b.0);
        let mut left = fill_in_order(sides, sorted, rule, rows.start, out);
        if left == 0 {
            return;
        }
        if left & (left - 1) != 0 {
            sorted.retain_mut(|(middle, index)| {
                let side = &sides[*index as usize];
                *middle = side.middle((31 - side.to_do.leading_zeros() as i32) as usize % 8);
                side.to_do != 0
            });
            if !sorted.is_sorted_by(|a, b| a.0 <= b.0) {
                sort(sorted, |a, b| a.0 < b.0);
                left = F::apart(
                    #[inline(always)]
                    || fill_in_order(sides, sorted, rule, rows.start, out),
                );
            }
        }
        self.fill_hard_rows(rows.start, left, true, lines, rule, out);
    }

    fn fill_hard_rows<F: Floats>(
        &mut self,
        top: i32,
        rows: u32,
        has_sides: bool,
        lines: &[Line],
        rule: Rule,
        out: &mut Output<F, impl Sink<F>>,
    ) {
        F::apart(
            #[inline(always)]
            || {
                for row in each(rows) {
                    let (
                        y,
                        Scanner {
                            active,
                            sides,
                            sorted,
                            members,
                            ..
                        },
                    ) = (top + row as i32, &mut *self);
                    members.clear();
                    if has_sides {
                        let here = sorted
                            .iter()
                            .filter(|it| sides[it.1 as usize].to_do >> row & 1 != 0);
                        members.extend(
                            here.filter_map(|it| Member::new(&active[it.1 as usize], lines, y * 4)),
                        );
                    } else {
                        members
                            .extend(active.iter().filter_map(|it| Member::new(it, lines, y * 4)));
                    }
                    sort(members, |a, b| (a.low, a.order) < (b.low, b.order));
                    let mut window = Window::new(out, y);
                    self.row(lines, rule, y * 4, &mut window);
                    window.finish();
                }
            },
        );
    }

    /// Onto the alphas of `rect`, which are 0.
    fn write(&mut self, edges: &Edges, shape: &Shape, rect: IntRect, alphas: &mut [u8]) {
        prefer_wide!(write_alphas(self, edges, shape, rect, alphas));
        self.scan::<[f32; 8]>(edges, shape, rect, alphas);
    }

    /// It is clear.
    pub fn cover(&mut self, edges: &Edges, shape: &Shape, coverage: &mut Coverage) {
        self.write(edges, shape, coverage.rect, &mut coverage.data);
    }

    /// `take` gets neighbors: the column and the row of the first, and their alphas.
    pub fn hand_over(
        &mut self,
        edges: &Edges,
        shape: &Shape,
        rows: Range<i32>,
        mut take: impl FnMut(i32, i32, &[u8]),
    ) {
        const GAP: usize = 16;
        let (mut mask, area, width) = (
            std::mem::take(&mut self.mask),
            shape.area,
            shape.area.width(),
        );
        let (mut top, end) = (rows.start.max(area.top), rows.end.min(area.bottom));
        while top < end {
            let part = IntRect {
                top,
                bottom: ((top + PERIOD) & -PERIOD).min(end),
                ..area
            };
            mask.clear();
            mask.resize(part.area() as usize, 0);
            self.write(edges, shape, part, &mut mask);
            for (y, row) in (top..).zip(mask.chunks_exact(width)) {
                let (mut at, is_blank) = (0, |it: &[u8]| {
                    it.first_chunk()
                        .map_or_else(|| it.iter().all(|it| *it == 0), |it| *it == [0; GAP])
                });
                while at < width {
                    let start =
                        at + row[at..].chunks(GAP).take_while(|it| is_blank(it)).count() * GAP;
                    at = (start
                        + row[start.min(width)..]
                            .chunks(GAP)
                            .take_while(|it| !is_blank(it))
                            .count()
                            * GAP)
                        .min(width);
                    if start < at {
                        take(area.left + start as i32, y, &row[start..at]);
                    }
                }
            }
            top = part.bottom;
        }
        self.mask = mask;
    }

    /// Like `fill`. False if there is no shortcut.
    pub fn shade(
        &mut self,
        edges: &Edges,
        shape: &Shape,
        rect: IntRect,
        pixels: &mut [Pixel],
        ramp: &Ramp,
    ) -> bool {
        prefer_wide!(shade_shape(self, edges, shape, rect, pixels, ramp));
        false
    }

    /// `hand_over` for dense shapes, as if they were one. `area` is in one period.
    pub fn hand_over_samples(
        &mut self,
        parts: &[(&Edges, &Shape)],
        is_even_odd: bool,
        area: IntRect,
        take: &mut dyn FnMut(i32, i32, &[u8]),
    ) {
        prefer_wide!(hand_over_samples(self, parts, is_even_odd, area, take));
        self.take_samples(parts, is_even_odd, area, take);
    }

    /// At 16 points of each pixel, which takes no sorting.
    #[inline(always)]
    pub(super) fn take_samples(
        &mut self,
        parts: &[(&Edges, &Shape)],
        is_even_odd: bool,
        area: IntRect,
        take: &mut dyn FnMut(i32, i32, &[u8]),
    ) {
        const ONE: f32 = 65536.;
        // No two are in one column.
        const SHIFTS: [i32; 4] = [1 << 13, 5 << 13, 7 << 13, 3 << 13];
        let (width, Scanner { turns, mask, .. }) = (area.width(), self);
        let (last, matters) = ((width * 4) as f32, if is_even_odd { 1 } else { u16::MAX });
        turns.resize(turns.len().max(width * 4 + 1), Turns::default());
        let turns = &mut turns[..width * 4 + 1];
        for y in (area.top..area.bottom).step_by(8) {
            let (start, end, mut low, mut high) = (y * 4, (y + 8).min(area.bottom) * 4, last, 0f32);
            for (edges, shape) in parts
                .iter()
                .filter(|it| it.1.area.top * 4 < end && it.1.area.bottom * 4 > start)
            {
                for chain in edges
                    .chains_from(shape, y.max(shape.area.top))
                    .0
                    .iter()
                    .filter(|it| it.top < end)
                {
                    let (mut index, by) = (chain.first, chain.winding as u16);
                    while let Some(line) = edges.lines.get(index as usize).filter(|it| it.top < end)
                    {
                        index = line.below;
                        let (from, to) = (line.top.max(start), line.bottom.min(end));
                        if from >= to {
                            continue;
                        }
                        let (first, step) = (
                            (middle_below(line, from) - area.left as f32) * 4.,
                            line.step * 4.,
                        );
                        let (least, most) = ordered(first, first + step * (to - from - 1) as f32);
                        (low, high) = (low.min(least), high.max(most));
                        if least >= 0. && most + 1. < last {
                            let (mut x, step) = ((first * ONE) as i32, (step * ONE) as i32);
                            for quarter in (from - start) as usize..(to - start) as usize {
                                let turn = &mut turns[((x + SHIFTS[quarter % 4]) >> 16) as usize].0
                                    [quarter % 32];
                                (*turn, x) = (turn.wrapping_add(by), x.wrapping_add(step));
                            }
                        } else {
                            for (steps, quarter) in
                                ((from - start) as usize..(to - start) as usize).enumerate()
                            {
                                let turn = &mut turns[whole(
                                    first + step * steps as f32 + SHIFTS[quarter % 4] as f32 / ONE,
                                    last,
                                ) as usize]
                                    .0[quarter % 32];
                                *turn = turn.wrapping_add(by);
                            }
                        }
                    }
                }
            }
            if low > high {
                continue;
            }
            let (left, right, mut winding) = (
                whole(low - 1., last) as usize / 4,
                whole(high + 2., last) as usize / 4 + 1,
                [0u16; 32],
            );
            mask.clear();
            mask.resize(width * 8, 0);
            let mut reached = left;
            for (x, four) in (left..).zip(turns[left * 4..].as_chunks_mut::<4>().0) {
                if x >= right && winding == [0; 32] {
                    break;
                }
                let mut counts = [0u16; 32];
                for turns in four {
                    winding = from_fn(|it| winding[it].wrapping_add(turns.0[it]));
                    counts = from_fn(|it| counts[it] + u16::from(winding[it] & matters != 0));
                    *turns = Turns::default();
                }
                for (row, counts) in counts.as_chunks::<4>().0.iter().enumerate() {
                    mask[row * width + x] =
                        ((counts[0] + counts[1] + counts[2] + counts[3]) * 16).min(255) as u8;
                }
                reached = x + 1;
            }
            turns[width * 4] = Turns::default();
            (y..end / 4)
                .zip(mask.chunks_exact(width))
                .for_each(|(y, row)| take(area.left + left as i32, y, &row[left..reached]));
        }
    }

    /// Source-over, on the pixels of `rect`.
    pub fn fill(
        &mut self,
        edges: &Edges,
        shape: &Shape,
        rect: IntRect,
        pixels: &mut [Pixel],
        color: Pixel,
    ) {
        prefer_wide!(fill_shape(self, edges, shape, rect, pixels, color));
        self.hand_over(edges, shape, rect.top..rect.bottom, |x, y, alphas| {
            fill_through(
                &mut pixels[(y - rect.top) as usize * rect.width() + (x - rect.left) as usize..]
                    [..alphas.len()],
                color,
                alphas,
            );
        });
    }

    /// The sink has the pixels of `rect`, between whose sides the shape is.
    #[inline(always)]
    pub(super) fn scan<F: Floats>(
        &mut self,
        edges: &Edges,
        shape: &Shape,
        rect: IntRect,
        sink: impl Sink<F>,
    ) {
        let (lines, mut y, bottom, columns) = (
            &edges.lines[..],
            rect.top.max(shape.area.top),
            rect.bottom.min(shape.area.bottom),
            shape.area.left..shape.area.right,
        );
        let (mut queue, stride) = (
            self.queue.take().unwrap_or_default(),
            rect.right - rect.left,
        );
        let zero = -i64::from(rect.top) * i64::from(stride) - i64::from(rect.left);
        let out = &mut Output {
            sink,
            queue: &mut queue,
            columns: columns.clone(),
            stride,
            zero,
            lanes: PhantomData,
        };
        while y < bottom {
            let (mut waiting, until) = edges.chains_from(shape, y);
            let bottom = bottom.min(until);
            if shape.is_intricate {
                sample(
                    lines,
                    waiting,
                    shape.rule,
                    y..bottom,
                    &columns,
                    &mut |y, row| out.sink.some(out.place(columns.start, y), row),
                );
                y = bottom;
            }
            self.active.clear();
            while y < bottom {
                let end = (y + 8).min((y + PERIOD) & -PERIOD).min(bottom);
                while let Some((it, rest)) = waiting.split_first().filter(|it| it.0.top < end * 4) {
                    self.active.push(*it);
                    waiting = rest;
                }
                self.active.retain_mut(|it| {
                    line_below(it.first, lines, y * 4)
                        .map(|line| it.first = line.0)
                        .is_some()
                });
                F::apart(
                    #[inline(always)]
                    || self.fill_rows(y..end, lines, shape.rule, out),
                );
                y = end;
            }
        }
        out.flush();
        self.queue = Some(queue);
    }
}

#[inline(always)]
fn middle_below(line: &Line, quarter: i32) -> f32 {
    line.at(quarter) + line.step * 0.5
}

/// What does not show cannot get between those that do, and those that meet in the middle are as they were above it.
#[inline(always)]
fn rank(line: &Line, quarter: i32, left: f32) -> f32 {
    let middle = middle_below(line, quarter);
    if middle + line.step.abs() * 0.5 > left {
        middle - line.step / 1024.
    } else {
        f32::MIN
    }
}

/// No closure, which need not be inlined.
#[inline(always)]
fn sum_until<F: Floats>(side: &[Piece], ends: F) -> F {
    let mut all = side[0].area_until(ends);
    for piece in &side[1..] {
        all = all.add(piece.area_until(ends));
    }
    all
}

/// Of the sides, which do not cross.
#[inline(always)]
fn between<F: Floats>(left: &[Piece], right: &[Piece], y: i32, out: &mut Output<F, impl Sink<F>>) {
    let (columns, first, last) = (
        out.columns.clone(),
        out.columns.start as f32,
        out.columns.end as f32,
    );
    let extent = |side: &[Piece]| {
        side[1..]
            .iter()
            .fold((side[0].low, side[0].high), |all, it| {
                (ordered(all.0, it.low).0, ordered(all.1, it.high).1)
            })
    };
    let ((low, entered), (leaving, high)) = (extent(left), extent(right));
    let (low, high) = (ordered(low, leaving).0, ordered(entered, high).1);
    if low < first || high + 8. > last {
        let mut all = [Piece::default(); 8];
        all.iter_mut()
            .zip(left.iter().chain(right))
            .for_each(|(to, from)| *to = *from);
        let all = &mut all[..left.len() + right.len()];
        sort(all, |a, b| a.low < b.low);
        let mut window = Window::new(out, y);
        window.together(all);
        return window.finish();
    }
    let (mut x, mut before) = (
        columns.start + whole(low - first, last - first),
        F::new([0.; 8]),
    );
    loop {
        let ends: F = ends_from(x);
        let sums = sum_until(left, ends).add(sum_until(right, ends));
        out.eight(x, y, alphas(sums.sub(sums.after(before))));
        (x, before) = (x + 8, sums);
        if high <= x as f32 {
            break;
        }
        if entered <= x as f32 && leaving >= (x + 8) as f32 {
            let resumes = columns.start + whole(leaving - first, last - first);
            out.run(x..resumes, y, alpha(left.iter().map(|it| it.height).sum()));
            (x, before) = (resumes, sum_until(left, F::new([resumes as f32; 8])));
        }
    }
}

/// At 16 points of each pixel, which takes no sorting.
#[cold]
fn sample(
    lines: &[Line],
    mut waiting: &[Chain],
    rule: Rule,
    rows: Range<i32>,
    columns: &Range<i32>,
    take: &mut dyn FnMut(i32, &[u8]),
) {
    let (mut active, mut row, mut turns) = (
        Vec::new(),
        vec![0u8; columns.len()],
        vec![0; columns.len() * 4 + 4],
    );
    for y in rows {
        row.fill(0);
        for quarter in y * 4..y * 4 + 4 {
            while let Some((chain, rest)) = waiting.split_first().filter(|it| it.0.top <= quarter) {
                active.push((0., 0., i32::MIN, chain.first, chain.winding));
                waiting = rest;
            }
            active.retain_mut(|(x, step, bottom, below, _)| {
                *bottom > quarter
                    || line_below(*below, lines, quarter).is_some_and(|(_, it)| {
                        (*x, *step, *bottom, *below) = (
                            (middle_below(it, quarter) - columns.start as f32) * 4. + 0.5,
                            it.step * 4.,
                            it.bottom,
                            it.below,
                        );
                        true
                    })
            });
            for (x, step, .., winding) in &mut active {
                turns[whole(*x, (row.len() * 4) as f32) as usize] += *winding;
                *x += *step;
            }
            let mut winding = 0;
            for (value, turns) in row.iter_mut().zip(turns.as_chunks_mut::<4>().0) {
                for turn in turns {
                    winding += std::mem::take(turn);
                    *value = value.saturating_add(if rule.has(winding) { 16 } else { 0 });
                }
            }
        }
        take(y, &row);
    }
}

#[cfg(test)]
mod tests {
    use super::super::raster::{Clip, Layer, Paint, over, scale, trace};
    use super::*;
    use crate::gfx::{Cap, Command, Fill, Join, Point, Stroke, Style, Transform};

    /// Without shortcuts. `None` if there are several answers.
    fn expected(edges: &Edges, shape: &Shape, area: IntRect) -> Option<Vec<u8>> {
        let mut sums = vec![0f64; area.area() as usize];
        for quarter in area.top * 4..area.bottom * 4 {
            let chains =
                edges.chains[shape.chains.start as usize..shape.chains.end as usize].iter();
            let mut here: Vec<_> = chains
                .flat_map(|it| {
                    parts_of(
                        edges.lines[it.first as usize],
                        &edges.lines,
                        quarter,
                        i32::MAX,
                    )
                    .map(|part| (part.0, it.winding))
                })
                .collect();
            here.retain(|it| (it.0.top..it.0.bottom).contains(&quarter));
            let rank = |it: &(Line, i32)| rank(&it.0, quarter, shape.area.left as f32);
            here.sort_by(|a, b| rank(a).total_cmp(&rank(b)));
            here.array_windows()
                .all(|[a, b]| {
                    rank(a) < rank(b) || rank(a) == f32::MIN || (a.0.step - b.0.step).abs() < 0.01
                })
                .then_some(())?;
            let mut winding = 0;
            for (line, by) in here {
                let sign =
                    f64::from(shape.rule.has(winding + by)) - f64::from(shape.rule.has(winding));
                winding += by;
                let (low, high) = ordered(line.at(quarter), line.at(quarter + 1));
                let (low, high) = (f64::from(low), f64::from(high));
                let until = |x: f64| {
                    (x - high).max(0.)
                        + if high > low {
                            (x.clamp(low, high) - low).powi(2) / (high - low) / 2.
                        } else {
                            0.
                        }
                };
                for (sum, x) in sums[((quarter >> 2) - area.top) as usize * area.width()..]
                    .iter_mut()
                    .zip(area.left..area.right)
                {
                    *sum += sign * (until(f64::from(x + 1)) - until(f64::from(x)));
                }
            }
        }
        Some(sums.iter().map(|it| (it * 63.75 + 0.5) as u8).collect())
    }

    #[test]
    fn many_edges_in_a_row() {
        let area = IntRect::new(0, 0, 40, 12);
        for (count, alpha) in [(3000, 128), (200_000, 128)] {
            let bar = |it: usize| {
                [(0., 0.), (0.5, 0.), (0.5, 12.), (0., 12.)]
                    .map(|(x, y)| Point::new((it % 40) as f32 + x, y))
            };
            let path: Vec<_> = (0..count)
                .map(bar)
                .flat_map(|[a, b, c, d]| {
                    [
                        Command::MoveTo(a),
                        Command::LineTo(b),
                        Command::LineTo(c),
                        Command::LineTo(d),
                    ]
                })
                .collect();
            assert!(
                Coverage::of_path(&path, Fill::NonZero, &Transform::identity(), area)
                    .data
                    .iter()
                    .all(|it| *it == alpha)
            );
        }
    }

    #[test]
    fn shortcuts_make_no_difference() {
        let mut state = 7u64;
        let mut random = move |below: u32| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            ((state >> 33) % u64::from(below)) as u32
        };
        let (mut edges, mut scanner) = (Edges::default(), Scanner::default());
        for round in 0..4000 {
            let (left, top) = (random(40) as i32 - 20, random(40) as i32 - 20);
            let area = IntRect::new(
                left,
                top,
                left + 1 + random(90) as i32,
                top + 1 + random(70) as i32,
            );
            let (grid, reach) = (
                [1., 4., 16., 1000.][random(4) as usize],
                [8, 30, 120, 400][random(4) as usize],
            );
            let mut path = Vec::new();
            for _ in 0..1 + random(3) * random(4) {
                let (x, y, verbs, count) = (
                    random(100) as f32 - 20.,
                    random(80) as f32 - 20.,
                    1 + random(3),
                    1 + random(6),
                );
                for index in 0..=count {
                    let verb = random(verbs);
                    let mut point = || {
                        Point::new(x, y)
                            + Point::new(
                                random(reach * grid as u32) as f32,
                                random(reach * grid as u32) as f32,
                            ) * (1. / grid)
                            - Point::new(1., 1.) * (reach / 2) as f32
                    };
                    path.push(match verb {
                        _ if index == 0 => Command::MoveTo(point()),
                        0 => Command::LineTo(point()),
                        1 => Command::QuadTo(point(), point()),
                        _ => Command::CurveTo(point(), point(), point()),
                    });
                }
                path.extend((random(3) == 0).then_some(Command::Close));
            }
            let (cap, join) = (
                [Cap::Butt, Cap::Round, Cap::Square][random(3) as usize],
                [Join::Miter, Join::Round, Join::Bevel][random(3) as usize],
            );
            let stroke = Stroke {
                cap,
                join,
                ..Stroke::new([0.3, 1., 2.5, 9., 30.][random(5) as usize])
            };
            let kind = random(6);
            let style = || {
                [Style::Fill(Fill::NonZero), Style::Fill(Fill::EvenOdd)]
                    .into_iter()
                    .nth(kind as usize)
                    .unwrap_or(Style::Stroke(stroke))
            };
            edges.clear();
            let mut shape = trace(
                &mut edges,
                &mut Default::default(),
                &path,
                style(),
                &Transform::identity(),
                area,
            );
            shape.rule = [Rule::Negative, Rule::Positive]
                .get(round % 16)
                .copied()
                .unwrap_or(shape.rule);
            let Some(expected) = expected(&edges, &shape, area) else {
                continue;
            };
            let check = |name: &str, found: &[u8]| {
                let wrong = found
                    .iter()
                    .zip(&expected)
                    .position(|(a, b)| a.abs_diff(*b) > 1);
                let at = wrong.map(|it| {
                    (
                        it % area.width(),
                        it / area.width(),
                        found[it],
                        expected[it],
                    )
                });
                assert_eq!(
                    at, None,
                    "{name} {round} {area:?} {kind} {} {path:?}",
                    stroke.width
                );
            };
            if round % 2 == 0 {
                edges.index(&mut shape);
            }
            let [mut fast, mut portable, mut handed] = [(); 3].map(|()| Coverage::filled(area, 0));
            scanner.cover(&edges, &shape, &mut fast);
            check("fast", &fast.data);
            scanner.scan::<[f32; 8]>(&edges, &shape, area, &mut portable.data[..]);
            check("portable", &portable.data);
            scanner.hand_over(&edges, &shape, area.top..area.bottom, |x, y, alphas| {
                handed.data[(y - top) as usize * area.width() + (x - left) as usize..]
                    [..alphas.len()]
                    .copy_from_slice(alphas);
            });
            assert!(handed.data == fast.data, "{round}");
            let (below, color) = (
                [20, 90, 7, 130],
                scale([255, 128, 9, 255], [255, 77][round % 2]),
            );
            let mut layer = Layer::new(area).unwrap();
            layer.pixels_mut().fill(below);
            layer.view().fill_shape(
                &edges,
                &shape,
                &mut scanner,
                &Clip::new(area),
                &Paint::Solid(color),
            );
            assert!(
                layer
                    .pixels()
                    .iter()
                    .zip(&fast.data)
                    .all(|(pixel, by)| *pixel == over(below, scale(color, *by))),
                "{round}"
            );
        }
    }
}
