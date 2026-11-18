//! Paints many things a band of rows at a time, whose pixels stay in the cache, and on several threads if that pays.

use std::cell::Cell;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::edges::{Edges, PERIOD, Shape};
use super::raster::{IntRect, Layer, Path, View};
use super::scan::Scanner;
use crate::gfx::{Command, StrokeRoom};
use crate::parallel;
use crate::sync::Mutex;

const BAND_HEIGHT: usize = PERIOD as usize;
const JOBS_PER_CHUNK: usize = 128;
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
    /// In nanoseconds, roughly.
    fn cost(&self, job: usize, shape: &Shape) -> u64;
}

#[derive(Default)]
struct Chunk {
    edges: Edges,
    /// One for each job, but for the last ones if there was no room.
    shapes: Vec<Shape>,
    /// The indices of the shapes in each band, and where those of a band end.
    order: Vec<u8>,
    ends: Vec<u32>,
}

#[derive(Default)]
struct Tools {
    room: Room,
    scanner: Scanner,
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
    first_job: usize,
    jobs_per_chunk: usize,
    area: IntRect,
    spare: Mutex<Spare>,
    chunks: Vec<OnceLock<Chunk>>,
    /// With `CLOSED` once no more are begun.
    next_chunk: AtomicUsize,
    bytes: AtomicUsize,
    bands: Vec<Mutex<Option<View<'a>>>>,
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
    fn jobs_of(&self, chunk: usize) -> std::ops::Range<usize> {
        let start = self.first_job + chunk * self.jobs_per_chunk;
        start..(start + self.jobs_per_chunk).min(self.jobs.len())
    }

    fn trace(&self, index: usize, room: &mut Room) -> Chunk {
        let mut chunk = self.spare.lock().chunks.pop().unwrap_or_default();
        let Chunk { edges, shapes, .. } = &mut chunk;
        edges.clear();
        shapes.clear();
        for job in self.jobs_of(index) {
            let mut shape = self.jobs.trace(job, self.area, edges, room);
            edges.index(&mut shape);
            shapes.push(shape);
            if edges.bytes_used() > MAX_BYTES / 8 {
                break;
            }
        }
        if self.bytes.fetch_add(edges.bytes_used(), Ordering::Relaxed) > MAX_BYTES
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

    fn paint(&self, band: usize, mut view: View, scanner: &mut Scanner) {
        for (
            first,
            Chunk {
                edges,
                shapes,
                order,
                ends,
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
                self.jobs
                    .paint(first + shape, edges, &shapes[shape], scanner, &mut view);
            }
        }
    }

    fn take_part(&self, threads: usize) {
        let mut tools = self.spare.lock().tools.pop().unwrap_or_default();
        while let Ok(index) =
            self.next_chunk
                .try_update(Ordering::Relaxed, Ordering::Relaxed, |it| {
                    (it < self.chunks.len()).then_some(it + 1)
                })
        {
            let mut promise = Promise(&self.chunks[index], Chunk::default());
            let mut chunk = self.trace(index, &mut tools.room);
            self.sort(&mut chunk);
            promise.1 = chunk;
        }
        // A thread tends to get the rows that it had the last time.
        let (seat, count) = (parallel::seat(), self.bands.len());
        for band in (seat % threads..count)
            .step_by(threads)
            .chain((0..count).rev())
        {
            let view = self.bands[band].lock().take();
            view.into_iter()
                .for_each(|it| self.paint(band, it, &mut tools.scanner));
        }
        self.spare.lock().tools.push(tools);
    }
}

/// In their order.
pub fn paint(layer: &mut Layer, jobs: &dyn Jobs) {
    let (mut done, mut jobs_per_chunk) = (0, JOBS_PER_CHUNK);
    while done < jobs.len() {
        let count = paint_some(layer, jobs, done, jobs_per_chunk);
        (done, jobs_per_chunk) = (done + count, count.min(JOBS_PER_CHUNK));
    }
}

/// Returns how many.
fn paint_some(
    layer: &mut Layer,
    jobs: &dyn Jobs,
    first_job: usize,
    jobs_per_chunk: usize,
) -> usize {
    const WORTH_SORTING: u64 = 20_000;
    const WORTH_A_THREAD: u64 = 150_000;
    const MAX_KEPT: usize = 8 << 20;
    let (spare, next_chunk, bytes) = (
        Mutex::new(SPARE.take()),
        AtomicUsize::new(1),
        AtomicUsize::new(0),
    );
    let left = jobs.len() - first_job;
    let mut work = Work {
        jobs,
        first_job,
        jobs_per_chunk,
        area: layer.rect,
        spare,
        chunks: Vec::new(),
        next_chunk,
        bytes,
        bands: Vec::new(),
    };
    let mut tools = work.spare.get_mut().tools.pop().unwrap_or_default();
    let mut first = work.trace(0, &mut tools.room);
    let cost = (first_job..)
        .zip(&first.shapes)
        .map(|(job, it)| jobs.cost(job, it))
        .sum::<u64>()
        / first.shapes.len() as u64
        * left as u64;
    if cost < WORTH_SORTING && first.shapes.len() == left {
        let mut view = layer.view();
        (first_job..)
            .zip(&first.shapes)
            .for_each(|(job, it)| jobs.paint(job, &first.edges, it, &mut tools.scanner, &mut view));
        let mut spare = std::mem::take(work.spare.get_mut());
        if tools.bytes() + first.edges.bytes() <= MAX_KEPT {
            spare.tools.push(tools);
            spare.chunks.push(first);
        }
        SPARE.set(spare);
        return left;
    }
    work.spare.get_mut().tools.push(tools);
    work.bands.extend(
        layer
            .view()
            .split(BAND_HEIGHT)
            .map(|it| Mutex::new(Some(it))),
    );
    work.sort(&mut first);
    work.chunks.extend(
        std::iter::once(first.into()).chain(
            (jobs_per_chunk..left)
                .step_by(jobs_per_chunk)
                .map(|_| OnceLock::new()),
        ),
    );
    let threads =
        ((cost / WORTH_A_THREAD) as usize).clamp(1, parallel::threads().min(work.bands.len()));
    parallel::on_threads(threads, || work.take_part(threads));
    let count = work.chunks().map(|it| it.1.shapes.len()).sum();
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
    count
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
                (job * 13) as u8 | 64,
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

        fn cost(&self, _: usize, shape: &Shape) -> u64 {
            shape.length.into()
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
        ] {
            let area = IntRect::new(0, 0, 301, 203);
            let [mut together, mut apart] = [(); 2].map(|()| Layer::new(area).unwrap());
            paint(&mut together, &stars);
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
