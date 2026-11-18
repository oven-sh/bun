//! Paints many things a band of rows at a time, whose pixels stay in the cache, and on several threads if that pays.

use std::cell::Cell;
use std::ops::Range;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::edges::{Edges, PERIOD, Role, STRIP, Shape};
use super::raster::{IntRect, Layer, Path, View};
use super::scan::Scanner;
use crate::gfx::{Command, StrokeRoom};
use crate::parallel;
use crate::sync::Mutex;

const BAND_HEIGHT: usize = PERIOD as usize;
const JOBS_PER_CHUNK: usize = 128;
const WEIGHT_PER_CHUNK: usize = 1024;
/// Of edges that wait for the bands, roughly.
const MAX_BYTES: usize = if cfg!(test) { 1 << 20 } else { 32 << 20 };

#[derive(Default)]
pub struct Room {
    pub path: Path,
    pub stroke: StrokeRoom,
}

pub trait Jobs: Sync {
    fn len(&self) -> usize;
    /// Only what is in `area` matters.
    fn trace(&self, job: usize, area: IntRect, edges: &mut Edges, room: &mut Room) -> Shape;
    fn paint(&self, job: usize, edges: &Edges, shape: &Shape, scanner: &mut Scanner, on: &mut View);
    /// If the last one is dense, which is that of the job.
    fn paint_parts(
        &self,
        job: usize,
        parts: &[(&Edges, &Shape)],
        scanner: &mut Scanner,
        on: &mut View,
    );
    /// One that is not the last.
    fn is_part(&self, job: usize) -> bool;
    /// How much there is to trace, roughly.
    fn weight(&self, job: usize) -> usize;
    /// In nanoseconds, roughly.
    fn cost(&self, job: usize, shape: &Shape) -> u64;
    fn hides(&self, job: usize, shape: &Shape) -> Hides;
}

/// Where it does not matter what was there before.
pub enum Hides {
    Nothing,
    Inside,
    Rect(IntRect),
    Disc([f32; 2], f32),
}

/// Of a band: for each strip, a bit for each column.
#[derive(Default)]
struct Hidden {
    rect: IntRect,
    bits: Vec<u64>,
    words: usize,
    /// How many bits are not set.
    left: usize,
    spans: Vec<(usize, Range<i32>)>,
}

impl Hidden {
    fn reset(&mut self, rect: IntRect) {
        let strips = rect.height().div_ceil(STRIP as usize);
        (self.rect, self.words, self.left) =
            (rect, rect.width().div_ceil(64), rect.width() * strips);
        self.bits.clear();
        self.bits.resize(self.words * strips, 0);
    }

    /// Where the words are, and which of their bits.
    #[inline]
    fn places(
        &self,
        strip: usize,
        columns: Range<i32>,
    ) -> impl Iterator<Item = (usize, u64)> + use<> {
        let (row, first, last) = (
            strip * self.words,
            (columns.start - self.rect.left) as usize,
            (columns.end - 1 - self.rect.left) as usize,
        );
        (first / 64..=last / 64).map(move |it| {
            (
                row + it,
                (if it == first / 64 {
                    u64::MAX << (first % 64)
                } else {
                    u64::MAX
                }) & if it == last / 64 {
                    u64::MAX >> (63 - last % 64)
                } else {
                    u64::MAX
                },
            )
        })
    }

    #[inline]
    fn has(&self, strip: usize, columns: Range<i32>) -> bool {
        self.places(strip, columns)
            .all(|(place, bits)| self.bits[place] & bits == bits)
    }

    fn add(&mut self, strip: usize, columns: Range<i32>) {
        for (place, bits) in self.places(strip, columns) {
            self.left -= (bits & !self.bits[place]).count_ones() as usize;
            self.bits[place] |= bits;
        }
    }

    /// Whether anything shows of what is behind all that came so far.
    fn shows(&mut self, edges: &Edges, shape: &Shape, hides: impl FnOnce() -> Hides) -> bool {
        let (area, strip) = (shape.area.intersect(self.rect), |y: i32| {
            (y - self.rect.top) as usize / STRIP as usize
        });
        if (strip(area.top)..=strip(area.bottom - 1)).all(|it| self.has(it, area.left..area.right))
        {
            return false;
        }
        match hides() {
            Hides::Nothing => {}
            Hides::Rect(rect) => {
                let rect = rect.intersect(area);
                let strips = strip(rect.top + STRIP - 1)..if rect.bottom == self.rect.bottom {
                    strip(rect.bottom - 1) + 1
                } else {
                    strip(rect.bottom.max(area.top))
                };
                strips
                    .filter(|_| !rect.is_empty())
                    .for_each(|it| self.add(it, rect.left..rect.right));
            }
            Hides::Disc([x, y], radius) => {
                for it in strip(area.top + STRIP - 1)..strip(area.bottom) {
                    let top = (self.rect.top + it as i32 * STRIP) as f32 - y;
                    let reach =
                        (radius * radius - (top * top).max((top + STRIP as f32).powi(2))).sqrt();
                    let columns = ((x - reach).ceil() as i32).max(area.left)
                        ..((x + reach).floor() as i32).min(area.right);
                    if reach > 0. && !columns.is_empty() {
                        self.add(it, columns);
                    }
                }
            }
            Hides::Inside => {
                let (mut spans, mut shows) = (std::mem::take(&mut self.spans), false);
                let is_known = edges.strips(
                    shape,
                    self.rect.top,
                    self.rect.bottom,
                    |strip, columns, is_inside| match is_inside {
                        true => spans.push((strip, columns)),
                        false => shows |= !columns.is_empty() && !self.has(strip, columns),
                    },
                );
                spans
                    .drain(..)
                    .for_each(|(strip, columns)| self.add(strip, columns));
                self.spans = spans;
                return shows || !is_known;
            }
        }
        true
    }
}

#[derive(Default)]
struct Chunk {
    edges: Edges,
    /// One for each job, but for the last ones if there was no room.
    shapes: Vec<Shape>,
    /// The indices of the shapes in each band, and where those of a band end.
    order: Vec<u8>,
    ends: Vec<u32>,
    /// Of all shapes.
    area: IntRect,
}

#[derive(Default)]
struct Tools {
    room: Room,
    scanner: Scanner,
    hidden: Hidden,
    /// From the front, the chunk and the shape in it.
    shown: Vec<u32>,
}

impl Tools {
    fn bytes(&self) -> usize {
        self.scanner.bytes()
            + self.room.stroke.bytes()
            + self.room.path.capacity() * size_of::<Command>()
    }
}

#[derive(Default)]
struct Spare {
    chunks: Vec<Chunk>,
    tools: Vec<Tools>,
}

thread_local! {
    static SPARE: Cell<Spare> = Cell::default();
}

pub fn release_memory() {
    SPARE.take();
}

struct Work<'a> {
    jobs: &'a dyn Jobs,
    /// The first job of each chunk, and the end.
    starts: Vec<usize>,
    max_bytes: usize,
    area: IntRect,
    spare: Mutex<Spare>,
    chunks: Vec<OnceLock<Chunk>>,
    /// With `CLOSED` once no more are begun.
    next_chunk: AtomicUsize,
    bytes: AtomicUsize,
    bands: Vec<Mutex<Option<View<'a>>>>,
    leaves_out: bool,
    /// Parts of jobs in bands: all, and those that show.
    counts: [AtomicUsize; 2],
}

const CLOSED: usize = 1 << (usize::BITS - 1);

/// Others wait for it, even if tracing panics.
struct Promise<'a>(&'a OnceLock<Chunk>, Chunk);

impl Drop for Promise<'_> {
    fn drop(&mut self) {
        _ = self.0.set(std::mem::take(&mut self.1));
    }
}

impl Work<'_> {
    fn jobs_of(&self, chunk: usize) -> Range<usize> {
        self.starts[chunk]..self.starts[chunk + 1]
    }

    #[inline]
    fn paint_one<'a>(
        &self,
        job: usize,
        edges: &'a Edges,
        shape: &'a Shape,
        parts: &mut Vec<(&'a Edges, &'a Shape)>,
        scanner: &mut Scanner,
        view: &mut View,
    ) {
        if !shape.is_dense {
            return self.jobs.paint(job, edges, shape, scanner, view);
        }
        parts.push((edges, shape));
        if shape.role != Role::Part {
            self.jobs.paint_parts(job, parts, scanner, view);
            parts.clear();
        }
    }

    fn trace(&self, index: usize, room: &mut Room) -> Chunk {
        let mut chunk = self.spare.lock().chunks.pop().unwrap_or_default();
        let Chunk {
            edges,
            shapes,
            area,
            ..
        } = &mut chunk;
        edges.clear();
        shapes.clear();
        *area = IntRect::default();
        for job in self.jobs_of(index) {
            let mut shape = self.jobs.trace(job, self.area, edges, room);
            edges.index(&mut shape);
            *area = area.union(shape.area);
            shapes.push(shape);
            if edges.bytes_used() > self.max_bytes / 8 {
                break;
            }
        }
        if self.bytes.fetch_add(edges.bytes_used(), Ordering::Relaxed) > self.max_bytes
            || shapes.len() < self.jobs_of(index).len()
        {
            self.next_chunk.fetch_or(CLOSED, Ordering::Relaxed);
        }
        chunk
    }

    fn sort(
        &self,
        Chunk {
            shapes,
            order,
            ends,
            ..
        }: &mut Chunk,
    ) {
        ends.clear();
        ends.resize(self.bands.len() + 1, 0);
        let band = |y: i32| (y - self.area.top) as u32 as usize / BAND_HEIGHT;
        let bands = |it: &Shape| {
            if it.area.is_empty() {
                0..0
            } else {
                band(it.area.top)..band(it.area.bottom - 1) + 1
            }
        };
        shapes.iter().for_each(|it| {
            ends[1..][bands(it)]
                .iter_mut()
                .for_each(|count| *count += 1)
        });
        let total = ends[1..]
            .iter_mut()
            .fold(0, |before, it| before + std::mem::replace(it, before));
        order.resize(total as usize, 0);
        for (index, shape) in shapes.iter().enumerate() {
            for end in &mut ends[1..][bands(shape)] {
                order[*end as usize] = index as u8;
                *end += 1;
            }
        }
    }

    /// Those that are painted.
    fn chunks(&self) -> impl Iterator<Item = (usize, &Chunk)> {
        let (count, mut goes_on) = (
            self.next_chunk.fetch_or(CLOSED, Ordering::Relaxed) & !CLOSED,
            true,
        );
        let all = self
            .chunks
            .iter()
            .take(count)
            .enumerate()
            .map(|(index, it)| (self.jobs_of(index), it.wait()));
        all.map_while(move |(jobs, it)| {
            std::mem::replace(&mut goes_on, it.shapes.len() == jobs.len())
                .then_some((jobs.start, it))
        })
    }

    fn paint_what_shows(
        &self,
        band: usize,
        mut view: View,
        Tools {
            scanner,
            hidden,
            shown,
            ..
        }: &mut Tools,
    ) {
        let (chunks, mut all) = (self.chunks().collect::<Vec<_>>(), 0);
        hidden.reset(view.rect);
        shown.clear();
        for (
            index,
            (
                first,
                Chunk {
                    edges,
                    shapes,
                    order,
                    ends,
                    ..
                },
            ),
        ) in chunks.iter().enumerate().rev()
        {
            let Some(&[start, end]) = ends.get(band..band + 2) else {
                continue;
            };
            all += (end - start) as usize;
            if hidden.left > 0 {
                let shows = |it: &usize| {
                    hidden.shows(edges, &shapes[*it], || {
                        self.jobs.hides(first + it, &shapes[*it])
                    })
                };
                shown.extend(
                    order[start as usize..end as usize]
                        .iter()
                        .rev()
                        .map(|it| usize::from(*it))
                        .filter(shows)
                        .map(|it| (index << 8 | it) as u32),
                );
            }
        }
        let mut parts = Vec::new();
        for (chunk, shape) in shown
            .iter()
            .rev()
            .map(|it| (chunks[*it as usize >> 8], *it as usize & 255))
        {
            self.paint_one(
                chunk.0 + shape,
                &chunk.1.edges,
                &chunk.1.shapes[shape],
                &mut parts,
                scanner,
                &mut view,
            );
        }
        self.counts
            .iter()
            .zip([all, shown.len()])
            .for_each(|(count, more)| _ = count.fetch_add(more, Ordering::Relaxed));
    }

    fn paint(&self, band: usize, mut view: View, tools: &mut Tools) {
        if self.leaves_out {
            return self.paint_what_shows(band, view, tools);
        }
        let (scanner, mut parts) = (&mut tools.scanner, Vec::new());
        for (
            first,
            Chunk {
                edges,
                shapes,
                order,
                ends,
                ..
            },
        ) in self.chunks()
        {
            let Some(&[start, end]) = ends.get(band..band + 2) else {
                continue;
            };
            for shape in order[start as usize..end as usize]
                .iter()
                .map(|it| usize::from(*it))
            {
                self.paint_one(
                    first + shape,
                    edges,
                    &shapes[shape],
                    &mut parts,
                    scanner,
                    &mut view,
                );
            }
        }
    }

    fn trace_all(&self, room: &mut Room) {
        while let Ok(index) =
            self.next_chunk
                .try_update(Ordering::Relaxed, Ordering::Relaxed, |it| {
                    (it < self.chunks.len()).then_some(it + 1)
                })
        {
            let mut promise = Promise(&self.chunks[index], Chunk::default());
            let mut chunk = self.trace(index, room);
            self.sort(&mut chunk);
            promise.1 = chunk;
        }
    }

    fn take_part(&self, threads: usize) {
        let mut tools = self.spare.lock().tools.pop().unwrap_or_default();
        self.trace_all(&mut tools.room);
        for band in parallel::own_first(self.bands.len(), threads) {
            let view = self.bands[band].lock().take();
            view.into_iter()
                .for_each(|it| self.paint(band, it, &mut tools));
        }
        self.spare.lock().tools.push(tools);
    }
}

/// What is known from the last time.
#[derive(Default)]
pub struct Experience {
    /// So often it is not tried to leave out what is hidden.
    skips: u32,
    pub much_was_hidden: bool,
}

/// In their order. Returns what may have changed.
pub fn paint(layer: &mut Layer, jobs: &dyn Jobs, experience: &mut Experience) -> IntRect {
    let (mut done, mut jobs_per_chunk, mut changed) = (0, JOBS_PER_CHUNK, IntRect::default());
    while done < jobs.len() {
        let (mut count, mut area) = paint_some(
            layer,
            jobs,
            done..jobs.len(),
            [jobs_per_chunk, MAX_BYTES],
            experience,
        );
        if count == 0 {
            // Parts need room for all others. If that is not enough, they are left out.
            count = (done..jobs.len())
                .take_while(|it| jobs.is_part(*it))
                .count()
                + 1;
            area = paint_some(
                layer,
                jobs,
                done..done + count,
                [JOBS_PER_CHUNK, MAX_BYTES * 8],
                experience,
            )
            .1;
        }
        (done, jobs_per_chunk, changed) =
            (done + count, count.min(JOBS_PER_CHUNK), changed.union(area));
    }
    changed
}

/// Returns how many, and where.
fn paint_some(
    layer: &mut Layer,
    jobs: &dyn Jobs,
    Range {
        start: first_job,
        end,
    }: Range<usize>,
    [jobs_per_chunk, max_bytes]: [usize; 2],
    experience: &mut Experience,
) -> (usize, IntRect) {
    const WORTH_SORTING: u64 = 20_000;
    const WORTH_A_THREAD: u64 = 150_000;
    const MAX_KEPT: usize = 8 << 20;
    let (spare, next_chunk, bytes) = (
        Mutex::new(SPARE.take()),
        AtomicUsize::new(1),
        AtomicUsize::new(0),
    );
    let (left, mut starts, mut weight) = (end - first_job, vec![first_job], 0);
    for job in first_job..end {
        let (more, start) = (jobs.weight(job), starts[starts.len() - 1]);
        if job - start == jobs_per_chunk || weight + more > WEIGHT_PER_CHUNK && job > start {
            starts.push(job);
            weight = 0;
        }
        weight += more;
    }
    let chunk_count = starts.len();
    starts.push(end);
    let mut work = Work {
        jobs,
        starts,
        max_bytes,
        area: layer.rect,
        spare,
        chunks: Vec::new(),
        next_chunk,
        bytes,
        bands: Vec::new(),
        leaves_out: false,
        counts: Default::default(),
    };
    let mut tools = work.spare.get_mut().tools.pop().unwrap_or_default();
    let mut first = work.trace(0, &mut tools.room);
    let mut cost = (first_job..)
        .zip(&first.shapes)
        .map(|(job, it)| jobs.cost(job, it))
        .sum::<u64>()
        .max(WORTH_SORTING)
        * chunk_count as u64;
    if cost == WORTH_SORTING
        && first.shapes.len() == left
        && !first.shapes.iter().any(|it| it.is_dense)
    {
        let mut view = layer.view();
        (first_job..)
            .zip(&first.shapes)
            .for_each(|(job, it)| jobs.paint(job, &first.edges, it, &mut tools.scanner, &mut view));
        let (mut spare, area) = (std::mem::take(work.spare.get_mut()), first.area);
        if tools.bytes() + first.edges.bytes() <= MAX_KEPT {
            spare.tools.push(tools);
            spare.chunks.push(first);
        }
        SPARE.set(spare);
        experience.much_was_hidden = false;
        return (left, area);
    }
    let hides = |(job, it): (usize, &Shape)| match jobs.hides(job, it) {
        Hides::Nothing => 0,
        Hides::Inside | Hides::Disc(..) => it.area.area() / 2,
        Hides::Rect(rect) => rect.intersect(it.area).area(),
    };
    let may_pay = (first_job..)
        .zip(&first.shapes)
        .skip(1)
        .map(hides)
        .sum::<i64>()
        * chunk_count as i64
        > layer.rect.area() * 2;
    experience.skips = experience.skips.saturating_sub(may_pay.into());
    work.leaves_out = may_pay && experience.skips == 0;
    work.bands.extend(
        layer
            .view()
            .split(BAND_HEIGHT)
            .map(|it| Mutex::new(Some(it))),
    );
    work.sort(&mut first);
    work.chunks
        .extend(std::iter::once(first.into()).chain((1..chunk_count).map(|_| OnceLock::new())));
    if cost < WORTH_A_THREAD * 2 {
        work.trace_all(&mut tools.room);
        cost = work
            .chunks()
            .flat_map(|(first, it)| (first..).zip(&it.shapes))
            .map(|(job, it)| jobs.cost(job, it))
            .sum();
    }
    work.spare.get_mut().tools.push(tools);
    let threads =
        ((cost / WORTH_A_THREAD) as usize).clamp(1, parallel::threads().min(work.bands.len()));
    parallel::on_threads(threads, || work.take_part(threads));
    let (count, area) = work
        .chunks()
        .fold((0, IntRect::default()), |(count, area), it| {
            (count + it.1.shapes.len(), area.union(it.1.area))
        });
    let count = count
        - work
            .chunks()
            .flat_map(|it| &it.1.shapes)
            .fold(
                0,
                |parts, it| if it.role == Role::Part { parts + 1 } else { 0 },
            );
    let [all, shown] = work.counts.each_mut().map(|it| *it.get_mut());
    experience.much_was_hidden = shown * 5 < all * 4;
    if work.leaves_out && !experience.much_was_hidden {
        experience.skips = 32;
    }
    let (mut spare, mut kept) = (std::mem::take(work.spare.get_mut()), 0);
    spare
        .chunks
        .extend(work.chunks.into_iter().filter_map(OnceLock::into_inner));
    let mut fits = |bytes: usize| {
        let fits = kept + bytes <= MAX_KEPT;
        kept += if fits { bytes } else { 0 };
        fits
    };
    spare.tools.retain(|it| fits(it.bytes()));
    spare
        .chunks
        .retain(|it| fits(it.edges.bytes() + it.order.capacity()));
    SPARE.set(spare);
    (count, area)
}

#[cfg(test)]
mod tests {
    use super::super::raster::{Clip, Paint, scale, trace};
    use super::*;
    use crate::gfx::{Fill, Point, Transform};

    struct Stars(usize, usize);

    impl Stars {
        fn path(&self, job: usize) -> Path {
            let (center, reach) = (
                Point::new((job * 37 % 300) as f32, (job * 91 % 200) as f32),
                (5 + job % 7 * 20) as f32,
            );
            let tip = |it: usize| {
                center + Point::new((it as f32 * 2.4).cos(), (it as f32 * 2.4).sin()) * reach
            };
            std::iter::once(Command::MoveTo(center))
                .chain((0..self.1).map(tip).map(Command::LineTo))
                .collect()
        }

        fn paint(job: usize) -> Paint<'static> {
            Paint::Solid(scale(
                [job as u8, (job * 7) as u8, 200, 255],
                if job % 3 > 0 {
                    255
                } else {
                    (job * 13) as u8 | 64
                },
            ))
        }
    }

    impl Jobs for Stars {
        fn len(&self) -> usize {
            self.0
        }

        fn trace(&self, job: usize, area: IntRect, edges: &mut Edges, room: &mut Room) -> Shape {
            trace(
                edges,
                &mut room.stroke,
                &self.path(job),
                Fill::EvenOdd.into(),
                &Transform::identity(),
                area,
            )
        }

        fn paint(
            &self,
            job: usize,
            edges: &Edges,
            shape: &Shape,
            scanner: &mut Scanner,
            on: &mut View,
        ) {
            on.fill_shape(
                edges,
                shape,
                scanner,
                &Clip::new(shape.area),
                &Stars::paint(job),
            );
        }

        fn paint_parts(&self, _: usize, _: &[(&Edges, &Shape)], _: &mut Scanner, _: &mut View) {}

        fn is_part(&self, _: usize) -> bool {
            false
        }

        fn weight(&self, _: usize) -> usize {
            self.1
        }

        fn cost(&self, _: usize, shape: &Shape) -> u64 {
            shape.length.into()
        }

        fn hides(&self, job: usize, _: &Shape) -> Hides {
            if let Paint::Solid([.., 255]) = Stars::paint(job) {
                Hides::Inside
            } else {
                Hides::Nothing
            }
        }
    }

    #[test]
    fn it_is_like_one_after_the_other() {
        for stars in [
            Stars(1, 5),
            Stars(3, 400),
            Stars(129, 5),
            Stars(3000, 9),
            Stars(300, 300),
            Stars(3001, 2),
            Stars(3002, 3),
            Stars(3003, 4),
        ] {
            let area = IntRect::new(0, 0, 301, 203);
            let [mut together, mut apart] = [(); 2].map(|()| Layer::new(area).unwrap());
            let mut experience = Experience::default();
            paint(&mut together, &stars, &mut experience);
            assert_eq!(experience.much_was_hidden, stars.0 >= 3000);
            (0..stars.0).for_each(|it| {
                apart.fill_path(
                    &stars.path(it),
                    Fill::EvenOdd,
                    &Transform::identity(),
                    &Clip::new(area),
                    &Stars::paint(it),
                )
            });
            assert!(together.pixels() == apart.pixels(), "{}", stars.0);
        }
    }
}
