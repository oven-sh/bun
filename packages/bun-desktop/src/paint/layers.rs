//! A window as a grid of surfaces that the system composites. Only the cells that change have more than one.

#[cfg(target_os = "macos")]
pub mod core_animation;
#[cfg(target_os = "macos")]
mod metal;

use std::ops::Range;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::arena::Chunk;
use super::gpu::{Kind, Primitive};
use super::raster::{IntRect, Pixel};
use super::software::{
    Action, Band, Compositor, Grid, Plan, Summary, TILE_HEIGHT, TILE_WIDTH, Texture, alpha, bgra,
    is_shaped, last_to_hide, movement, survey,
};
use crate::diagnostics;

const CELL_WIDTH: i32 = 1024;
const CELL_HEIGHT: i32 = 512;
const COLUMNS: usize = (CELL_WIDTH / TILE_WIDTH) as usize;
const TILES: usize = COLUMNS * (CELL_HEIGHT / TILE_HEIGHT) as usize;
const UNKNOWN: u64 = 0;
pub const SPARES_LAST: Duration = Duration::from_secs(2);
pub const SLOTS: usize = 8;

/// The column and the row.
pub type Position = (i32, i32);

pub struct Locked {
    pub start: *mut Pixel,
    /// In pixels.
    pub stride: usize,
}

pub trait Target {
    type Surface;
    fn create(&mut self, width: i32, height: i32) -> Option<Self::Surface>;
    /// The system may still be reading it.
    fn is_in_use(surface: &Self::Surface) -> bool;
    /// Valid until `unlock`.
    fn lock(surface: &Self::Surface, writes: bool) -> Locked;
    fn unlock(surface: &Self::Surface, wrote: bool);
    fn can_draw(&mut self) -> bool;
    /// Replaces what is on the surfaces, and returns when that is done.
    fn draw(&mut self, instances: &[Instance], passes: &[Pass<Self::Surface>]) -> bool;
    fn show(&mut self, position: Position, rect: IntRect, surface: &Self::Surface);
    fn remove(&mut self, position: Position);
}

/// `layers/shader.metal` has the same.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Instance {
    bounds: [f32; 4],
    area: [f32; 4],
    radii: [f32; 4],
    border: [f32; 4],
    part: [i32; 4],
    color: Pixel,
    border_color: Pixel,
    kind: u32,
    slot: u32,
    offset: u32,
    width: u32,
    height: u32,
    opacity: f32,
}

pub struct Batch {
    pub instances: Range<usize>,
    pub slots: SmallVec<[Arc<Chunk>; SLOTS]>,
}

pub struct Pass<'a, S> {
    pub surface: &'a S,
    pub rect: IntRect,
    pub batches: SmallVec<[Batch; 1]>,
}

fn instance<'a>(
    primitive: &Primitive,
    area: IntRect,
    textures: &'a [Texture],
) -> Option<(Instance, Option<&'a Arc<Chunk>>)> {
    let bounds = primitive.bounds;
    let common = Instance {
        bounds: [bounds.x, bounds.y, bounds.width, bounds.height],
        area: [area.left, area.top, area.right, area.bottom].map(|it| it as f32),
        radii: primitive.radii,
        ..Instance::default()
    };
    let (tile, kind, color, bytes) = match primitive.kind {
        Kind::Quad {
            color,
            border_color,
            border,
        } => {
            let [color, border_color] = [color, border_color].map(|it| bgra(it, primitive.opacity));
            let kind = u32::from(is_shaped(primitive));
            return (kind == 1 || color[3] != 0).then_some((
                Instance {
                    kind,
                    color,
                    border_color,
                    border,
                    ..common
                },
                None,
            ));
        }
        Kind::Mask(tile, color) => (tile, 2, bgra(color, primitive.opacity), 1),
        Kind::Image(tile) => (tile, 3 + u32::from(is_shaped(primitive)), [0; 4], 4),
    };
    let texture = Some(&textures[tile.texture_id.index as usize]).filter(|it| it.width > 0)?;
    let (block, part) = (texture.block.as_ref()?, tile.bounds);
    let instance = Instance {
        kind,
        color,
        part: [
            part.origin.x.0,
            part.origin.y.0,
            part.size.width.0,
            part.size.height.0,
        ],
        offset: block.offset as u32,
        width: texture.width as u32,
        height: (block.bytes().len() / bytes / texture.width) as u32,
        opacity: f32::from(alpha(primitive.opacity)) / 255.,
        ..common
    };
    Some((instance, Some(&block.chunk)))
}

fn batches(
    primitives: &[Primitive],
    summaries: &[Summary],
    textures: &[Texture],
    area: IntRect,
    instances: &mut Vec<Instance>,
) -> SmallVec<[Batch; 1]> {
    let empty = |start: usize| Batch {
        instances: start..start,
        slots: SmallVec::new(),
    };
    let (mut done, mut batch) = (SmallVec::new(), empty(instances.len()));
    for (primitive, summary) in primitives
        .iter()
        .zip(summaries)
        .skip(last_to_hide(primitives, area))
    {
        let visible = summary.area.intersect(area);
        if visible.is_empty() {
            continue;
        }
        let Some((mut instance, chunk)) = instance(primitive, visible, textures) else {
            continue;
        };
        if let Some(chunk) = chunk {
            let slot = batch
                .slots
                .iter()
                .position(|it| it.id == chunk.id)
                .unwrap_or_else(|| {
                    if batch.slots.len() == SLOTS {
                        done.push(std::mem::replace(&mut batch, empty(instances.len())));
                    }
                    batch.slots.push(chunk.clone());
                    batch.slots.len() - 1
                });
            instance.slot = slot as u32;
        }
        instances.push(instance);
        batch.instances.end = instances.len();
    }
    done.push(batch);
    done
}

/// One of each kind, to find out whether a GPU draws them right.
#[cfg(target_os = "macos")]
struct Sample(Compositor, Vec<Summary>);

#[cfg(target_os = "macos")]
impl Sample {
    const WIDTH: i32 = 128;
    const HEIGHT: i32 = 32;
    const AREA: IntRect = IntRect {
        left: 64,
        top: 16,
        right: 64 + Self::WIDTH,
        bottom: 16 + Self::HEIGHT,
    };

    fn new() -> Sample {
        use gpui::{AtlasKey, AtlasTextureKind, DevicePixels, PlatformAtlas as _, size};
        let mut compositor = Compositor::default();
        let texture = |kind, bytes: Vec<u8>| {
            let mut build = || {
                Ok(Some((
                    size(DevicePixels(16), DevicePixels(8)),
                    bytes[..].into(),
                )))
            };
            compositor
                .atlas
                .get_or_insert_with(AtlasKey::Custom(kind, 0), &mut build)
                .ok()
                .flatten()
        };
        let mask = texture(
            AtlasTextureKind::Monochrome,
            (0..128).map(|it| it * 2).collect(),
        );
        let image = texture(
            AtlasTextureKind::Polychrome,
            (0..128)
                .flat_map(|it| [it, it / 2, 127 - it, 128 + it])
                .collect(),
        );
        let at = |x, y, width, height, radius, kind| Primitive {
            radii: [radius, radius / 2., 0., radius],
            ..Primitive::new(
                crate::abi::Rect {
                    x,
                    y,
                    width,
                    height,
                },
                Self::AREA,
                kind,
            )
        };
        let quad = |color, width| Kind::Quad {
            color,
            border_color: 0x00FF_00C0,
            border: [width, width, width * 2., 0.],
        };
        compositor.primitives = vec![
            at(60., 20., 100., 40., 0., quad(0xFF80_20FF, 0.)),
            at(70., 18., 60., 24., 8., quad(0x2040_FF80, 2.)),
        ];
        compositor
            .primitives
            .extend(mask.map(|it| at(140., 17., 16., 8., 0., Kind::Mask(it, 0x8000_40FF))));
        compositor
            .primitives
            .extend(image.map(|it| at(160., 30., 16., 8., 0., Kind::Image(it))));
        compositor
            .primitives
            .extend(image.map(|it| at(100.5, 24.25, 40., 20., 6., Kind::Image(it))));
        let summaries = compositor.primitives.iter().map(Summary::of).collect();
        Sample(compositor, summaries)
    }

    fn pass<'a, S>(&self, surface: &'a S) -> (Vec<Instance>, Pass<'a, S>) {
        let mut instances = Vec::new();
        let batches = batches(
            &self.0.primitives,
            &self.1,
            &self.0.atlas.0.borrow().slots,
            Self::AREA,
            &mut instances,
        );
        (
            instances,
            Pass {
                surface,
                rect: Self::AREA,
                batches,
            },
        )
    }

    fn difference(&self, drawn: &Locked) -> u8 {
        let Some(painted) = self.0.atlas.snapshot(&self.0.primitives, Self::AREA, 1) else {
            return u8::MAX;
        };
        let rows = (0..Self::HEIGHT).flat_map(|y| {
            // SAFETY: the surface is locked, and has this size.
            let row = unsafe {
                std::slice::from_raw_parts(
                    drawn.start.add(y as usize * drawn.stride),
                    Self::WIDTH as usize,
                )
            };
            row.iter().zip(painted.row(y, 0, Self::WIDTH))
        });
        let channels =
            rows.flat_map(|(&[b, g, r, a], expected)| [r, g, b, a].into_iter().zip(*expected));
        channels
            .map(|(drawn, expected)| drawn.abs_diff(expected))
            .max()
            .unwrap_or(0)
    }
}

struct Buffer<S> {
    surface: S,
    size: (i32, i32),
    /// The cell that it was painted for, and what is in each of the tiles.
    position: Position,
    hashes: Box<[u64; TILES]>,
    last_shown: Instant,
}

struct Change<S> {
    area: IntRect,
    buffer: Buffer<S>,
    work: usize,
    is_drawn: bool,
}

fn origin((column, row): Position) -> (i32, i32) {
    (column * CELL_WIDTH, row * CELL_HEIGHT)
}

/// For each tile in `area`, its index in the window and in the cell.
fn tiles_in(grid: &Grid, area: IntRect) -> impl Iterator<Item = (usize, usize)> {
    let (rows, columns) = (grid.rows_of(area), grid.columns_of(area));
    let (top, left) = (rows.start, columns.start);
    rows.flat_map(move |row| {
        let index = move |column| row as usize * grid.columns + column as usize;
        columns.clone().map(move |column| {
            (
                index(column),
                (row - top) as usize * COLUMNS + (column - left) as usize,
            )
        })
    })
}

struct Shared(Locked);

// SAFETY: `Layers::paint` gives a surface that is written to one thread, and only reads the others.
unsafe impl Send for Shared {}
// SAFETY: as above.
unsafe impl Sync for Shared {}

pub struct Layers<T: Target> {
    pub target: T,
    shown: FxHashMap<Position, Buffer<T::Surface>>,
    spare: Vec<Buffer<T::Surface>>,
    instances: Vec<Instance>,
}

impl<T: Target> Layers<T> {
    pub fn new(target: T) -> Self {
        Layers {
            target,
            shown: FxHashMap::default(),
            spare: Vec::new(),
            instances: Vec::new(),
        }
    }

    pub fn has_spares(&self) -> bool {
        !self.spare.is_empty()
    }

    pub fn release_spares(&mut self, older_than: Duration) {
        self.spare
            .retain(|buffer| buffer.last_shown.elapsed() < older_than);
        if self.spare.is_empty() {
            self.instances = Vec::new();
        }
    }

    /// For another `Compositor`, whose hashes mean something else.
    pub fn forget_contents(&mut self) {
        self.release_spares(Duration::ZERO);
        self.shown
            .values_mut()
            .for_each(|buffer| buffer.hashes.fill(UNKNOWN));
    }

    fn back_buffer(&mut self, position: Position, size: (i32, i32)) -> Option<Buffer<T::Surface>> {
        let free = self
            .spare
            .iter()
            .enumerate()
            .filter(|(_, it)| it.size == size && !T::is_in_use(&it.surface));
        let best = free
            .max_by_key(|(_, it)| (it.position == position).then_some(it.last_shown))
            .map(|(index, _)| index);
        let mut buffer = match best {
            Some(index) => self.spare.swap_remove(index),
            None => Buffer {
                surface: self.target.create(size.0, size.1)?,
                size,
                position,
                hashes: Box::new([UNKNOWN; TILES]),
                last_shown: Instant::now(),
            },
        };
        if std::mem::replace(&mut buffer.position, position) != position {
            buffer.hashes.fill(UNKNOWN);
        }
        Some(buffer)
    }

    pub fn paint(&mut self, compositor: &mut Compositor, width: i32, height: i32) {
        const WORTH_DRAWING: usize = 480;
        const WORTH_A_PASS: usize = 24;
        const WORTH_MOVING: usize = 32;
        const TILES_PER_THREAD: usize = 1200;
        const MAX_THREADS: usize = 4;
        let start = diagnostics::logs_frames().then(Instant::now);
        let round_up = |length: i32, step: i32| (length.max(1) + step - 1) / step * step;
        let window = IntRect::new(
            0,
            0,
            round_up(width, TILE_WIDTH),
            round_up(height, TILE_HEIGHT),
        );
        let grid = &Grid {
            window,
            columns: (window.right / TILE_WIDTH) as usize,
        };
        let summaries: Vec<_> = compositor.primitives.iter().map(Summary::of).collect();
        let tiles = survey(&summaries, grid, 0, window);
        let before = std::mem::replace(&mut compositor.window, window);

        let (columns, rows) = (
            round_up(width, CELL_WIDTH) / CELL_WIDTH,
            round_up(height, CELL_HEIGHT) / CELL_HEIGHT,
        );
        for (position, buffer) in self
            .shown
            .extract_if(|(column, row), _| *column >= columns || *row >= rows)
        {
            self.target.remove(position);
            self.spare.push(buffer);
        }
        let (mut actions, mut changes, mut is_complete) =
            (vec![Action::Keep; tiles.len()], Vec::new(), true);
        for position in (0..rows).flat_map(|row| (0..columns).map(move |column| (column, row))) {
            let (left, top) = origin(position);
            let area =
                IntRect::new(left, top, left + CELL_WIDTH, top + CELL_HEIGHT).intersect(window);
            let size = (
                round_up(area.right - left, CELL_WIDTH / 4),
                round_up(area.bottom - top, CELL_HEIGHT / 4),
            );
            let is_right = |it: &Buffer<_>| {
                tiles_in(grid, area).all(|(tile, own)| it.hashes[own] == tiles[tile].hash)
            };
            if self
                .shown
                .get(&position)
                .is_some_and(|it| it.size == size && is_right(it))
            {
                continue;
            }
            let Some(mut buffer) = self.back_buffer(position, size) else {
                is_complete = false;
                continue;
            };
            let (shown, mut work) = (self.shown.get(&position), 0);
            let painted = std::mem::replace(&mut *buffer.hashes, [UNKNOWN; TILES]);
            for (tile, own) in tiles_in(grid, area) {
                let hash = tiles[tile].hash;
                buffer.hashes[own] = hash;
                if painted[own] != hash {
                    let is_shown =
                        !tiles[tile].is_flat && shown.is_some_and(|it| it.hashes[own] == hash);
                    actions[tile] = if is_shown {
                        Action::Copy
                    } else {
                        Action::Paint
                    };
                    work += 1;
                }
            }
            changes.push(Change {
                area,
                buffer,
                work,
                is_drawn: false,
            });
        }

        let (textures, primitives) = (
            &compositor.atlas.0.borrow().slots[..],
            &compositor.primitives,
        );
        let work = changes.iter().map(|change| change.work).sum::<usize>();
        if work >= WORTH_DRAWING && self.target.can_draw() {
            self.instances.clear();
            let passes = changes
                .iter()
                .filter(|change| change.work >= WORTH_A_PASS)
                .map(|change| {
                    let (IntRect { left, top, .. }, (width, height)) =
                        (change.area, change.buffer.size);
                    let batches = batches(
                        primitives,
                        &summaries,
                        textures,
                        change.area,
                        &mut self.instances,
                    );
                    Pass {
                        surface: &change.buffer.surface,
                        rect: IntRect::new(left, top, left + width, top + height),
                        batches,
                    }
                });
            let passes: Vec<_> = passes.collect();
            let is_drawn = self.target.draw(&self.instances, &passes);
            drop(passes);
            for change in changes
                .iter_mut()
                .filter(|change| is_drawn && change.work >= WORTH_A_PASS)
            {
                change.is_drawn = true;
                tiles_in(grid, change.area).for_each(|(tile, _)| actions[tile] = Action::Keep);
            }
        }

        let count =
            |action: Action, actions: &[Action]| actions.iter().filter(|it| **it == action).count();
        let can_move = count(Action::Paint, &actions) >= WORTH_MOVING;
        let down = can_move
            .then(|| movement(&compositor.shown, &summaries))
            .flatten()
            .unwrap_or(0);
        if down != 0 {
            let changed = grid.areas(|tile| actions[tile] == Action::Paint);
            let changed = changed.into_iter().fold(IntRect::default(), IntRect::union);
            let moved = survey(&compositor.shown, grid, down, changed);
            for (tile, action) in actions.iter_mut().enumerate() {
                let (row, column) = ((tile / grid.columns) as i32, (tile % grid.columns) as i32);
                let source = grid.rect(row, column..column + 1).offset(0, -down);
                let is_there = |y: i32| {
                    self.shown
                        .contains_key(&(source.left / CELL_WIDTH, y / CELL_HEIGHT))
                };
                if *action == Action::Paint
                    && !tiles[tile].is_flat
                    && moved[tile].hash == tiles[tile].hash
                    && before.contains(source)
                    && is_there(source.top)
                    && is_there(source.bottom - 1)
                {
                    *action = Action::Move;
                }
            }
        }

        let copies = [(Action::Copy, 0), (Action::Move, down)]
            .map(|(action, down)| (grid.areas(|tile| actions[tile] == action), down));
        let mut sources: FxHashMap<Position, Shared> = FxHashMap::default();
        for source in copies
            .iter()
            .flat_map(|(areas, down)| areas.iter().map(move |area| area.offset(0, -down)))
        {
            for row in source.top / CELL_HEIGHT..=(source.bottom - 1) / CELL_HEIGHT {
                for column in source.left / CELL_WIDTH..=(source.right - 1) / CELL_WIDTH {
                    let lock = || Shared(T::lock(&self.shown[&(column, row)].surface, false));
                    sources.entry((column, row)).or_insert_with(lock);
                }
            }
        }
        let has_changes = actions
            .chunks(grid.columns)
            .map(|row| row.contains(&Action::Paint))
            .collect();
        let plan = Plan {
            grid,
            primitives,
            summaries: &summaries,
            tiles: &tiles,
            actions: &actions,
            has_changes,
        };
        let paint_cell = |(area, Shared(target)): &(IntRect, Shared)| {
            // SAFETY: the surface is locked, at least as large as `area`, and this thread's.
            let pixels = unsafe {
                std::slice::from_raw_parts_mut(target.start, target.stride * area.height())
            };
            for (part, down) in copies
                .iter()
                .flat_map(|(areas, down)| areas.iter().map(move |it| (it.intersect(*area), *down)))
            {
                for y in (part.top..part.bottom).filter(|_| !part.is_empty()) {
                    let (x, Shared(source)) = (
                        (part.left - area.left) as usize,
                        &sources[&(area.left / CELL_WIDTH, (y - down) / CELL_HEIGHT)],
                    );
                    let from = ((y - down) % CELL_HEIGHT) as usize * source.stride + x;
                    // SAFETY: the surface is locked, and these pixels were painted, so it has them.
                    let row =
                        unsafe { std::slice::from_raw_parts(source.start.add(from), part.width()) };
                    pixels[(y - area.top) as usize * target.stride + x..][..row.len()]
                        .copy_from_slice(row);
                }
            }
            plan.paint(
                &mut Band::new(pixels, target.stride, area.left, area.top, textures),
                *area,
            );
        };
        let is_painted = |change: &&Change<_>| !change.is_drawn && change.work > 0;
        let locked = changes
            .iter()
            .filter(is_painted)
            .map(|it| (it.area, Shared(T::lock(&it.buffer.surface, true))));
        let locked: Vec<_> = locked.collect();
        let left = tiles.len() - count(Action::Keep, &actions);
        let threads = left.div_ceil(TILES_PER_THREAD).clamp(1, MAX_THREADS);
        std::thread::scope(|scope| {
            let share = |first: usize| {
                locked
                    .iter()
                    .skip(first)
                    .step_by(threads)
                    .for_each(paint_cell)
            };
            for first in 1..threads {
                scope.spawn(move || share(first));
            }
            share(0);
        });
        changes
            .iter()
            .filter(is_painted)
            .for_each(|change| T::unlock(&change.buffer.surface, true));
        sources
            .keys()
            .for_each(|position| T::unlock(&self.shown[position].surface, false));

        if let Some(start) = start {
            let (drawn, spare) = (
                changes.iter().filter(|change| change.is_drawn).count(),
                self.spare.len(),
            );
            log::info!(
                "{} cells ({drawn} by the GPU, {left} tiles by the CPU, {spare} spare) in {:?}",
                changes.len(),
                start.elapsed()
            );
        }
        let now = Instant::now();
        for Change { area, buffer, .. } in changes {
            let rect = IntRect::new(
                area.left,
                area.top,
                area.left + buffer.size.0,
                area.top + buffer.size.1,
            );
            self.target.show(buffer.position, rect, &buffer.surface);
            let old = self.shown.insert(buffer.position, buffer);
            self.spare.extend(old.map(|old| Buffer {
                last_shown: now,
                ..old
            }));
        }
        if self.spare.len() > 4 * self.shown.len() {
            self.spare
                .sort_by_key(|buffer| std::cmp::Reverse(buffer.last_shown));
            self.spare.truncate(3 * self.shown.len());
        }
        compositor.shown = if is_complete { summaries } else { Vec::new() };
    }
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;
    use std::cell::{Cell, UnsafeCell};
    use std::rc::Rc;

    use gpui::embed::Pixels;
    use gpui::{AtlasKey, AtlasTextureKind, DevicePixels, PlatformAtlas as _, size};

    use super::*;
    use crate::abi::Rect;

    struct Memory {
        pixels: UnsafeCell<Vec<Pixel>>,
        width: usize,
        /// For how many more frames.
        in_use: Cell<u32>,
    }

    #[derive(Default)]
    struct Screen {
        all: Vec<Rc<Memory>>,
        shown: FxHashMap<Position, (IntRect, Rc<Memory>)>,
    }

    impl Target for Screen {
        type Surface = Rc<Memory>;

        fn create(&mut self, width: i32, height: i32) -> Option<Rc<Memory>> {
            let pixels = UnsafeCell::new(vec![[1, 2, 3, 4]; (width * height) as usize]);
            self.all.push(Rc::new(Memory {
                pixels,
                width: width as usize,
                in_use: Cell::new(0),
            }));
            self.all.last().cloned()
        }

        fn is_in_use(surface: &Rc<Memory>) -> bool {
            surface.in_use.get() > 0
        }

        fn lock(surface: &Rc<Memory>, writes: bool) -> Locked {
            assert!(!writes || surface.in_use.get() == 0);
            // SAFETY: nothing else looks at it while `paint` runs.
            Locked {
                start: unsafe { (*surface.pixels.get()).as_mut_ptr() },
                stride: surface.width,
            }
        }

        fn unlock(_: &Rc<Memory>, _: bool) {}

        fn can_draw(&mut self) -> bool {
            false
        }

        fn draw(&mut self, _: &[Instance], _: &[Pass<Rc<Memory>>]) -> bool {
            false
        }

        fn show(&mut self, position: Position, rect: IntRect, surface: &Rc<Memory>) {
            self.shown.insert(position, (rect, surface.clone()));
        }

        fn remove(&mut self, position: Position) {
            self.shown.remove(&position);
        }
    }

    impl Screen {
        fn next_frame(&mut self, lag: u32) {
            self.all.retain(|it| Rc::strong_count(it) > 1);
            self.all
                .iter()
                .for_each(|it| it.in_use.set(it.in_use.get().saturating_sub(1)));
            self.shown
                .values()
                .for_each(|(_, it)| it.in_use.set(1 + lag));
        }

        fn row(&self, y: i32, left: i32, right: i32) -> &[Pixel] {
            let (rect, surface) = &self.shown[&(left / CELL_WIDTH, y / CELL_HEIGHT)];
            // SAFETY: `paint` has returned.
            let pixels = unsafe { &*surface.pixels.get() };
            &pixels[(y - rect.top) as usize * surface.width + (left - rect.left) as usize..]
                [..(right - left) as usize]
        }
    }

    fn page(compositor: &mut Compositor, (width, height): (i32, i32), scrolled: i32, caret: bool) {
        let window = IntRect::new(0, 0, width, height);
        let quad = |x: i32, y: i32, width: i32, height: i32, clip: IntRect, color: u32| {
            let bounds = Rect {
                x: x as f32,
                y: y as f32,
                width: width as f32,
                height: height as f32,
            };
            Primitive::new(
                bounds,
                clip,
                Kind::Quad {
                    color,
                    border_color: 0x0000_0040,
                    border: [2.; 4],
                },
            )
        };
        let mut all = vec![quad(
            -9,
            -9,
            width + 99,
            height + 99,
            window.outset(99),
            0xFAFA_F0FF,
        )];
        let port = IntRect::new(300, 70, width - 20, height - 130);
        for line in 0..200 {
            let key = AtlasKey::Custom(AtlasTextureKind::Monochrome, line as u128);
            let mut build = || {
                let mask = (0..900 * 30)
                    .map(|it| ((it * (line + 3)) % 251) as u8)
                    .collect();
                Ok(Some((
                    size(DevicePixels(900), DevicePixels(30)),
                    Cow::Owned(mask),
                )))
            };
            let tile = compositor
                .atlas
                .get_or_insert_with(key, &mut build)
                .unwrap()
                .unwrap();
            let y = 80 + line * 47 - scrolled;
            if line % 7 == 0 {
                all.push(Primitive {
                    radii: [12.; 4],
                    ..quad(320, y - 5, 1100, 90, port, 0xE0E0_FF80)
                });
            }
            let bounds = Rect {
                x: 340.,
                y: y as f32,
                width: 900.,
                height: 30.,
            };
            all.push(Primitive::new(bounds, port, Kind::Mask(tile, 0x1111_11FF)));
        }
        all.push(quad(500, height - 220, 700, 160, window, 0xFFFF_FFC0));
        all.extend(caret.then(|| quad(520, height - 200, 2, 36, window, 0x0000_00FF)));
        compositor.primitives = all;
    }

    #[test]
    fn shows_what_a_single_buffer_does() {
        let (mut layers, mut compositor) = (Layers::new(Screen::default()), Compositor::default());
        let sizes = [
            (2100, 1100),
            (2049, 1033),
            (1023, 511),
            (1025, 1030),
            (2100, 700),
        ];
        let steps = [0, 7, 120, 0, -33, 600, -1, 512, 0, -512, 16, 3000, -64];
        let mut scrolled = 1000;
        for (frame, (size, step)) in sizes
            .iter()
            .flat_map(|size| steps.iter().map(move |step| (*size, *step)))
            .enumerate()
        {
            scrolled = (scrolled + step) % 6000;
            page(&mut compositor, size, scrolled, frame % 2 == 0);
            layers.paint(&mut compositor, size.0, size.1);
            layers.target.next_frame(frame as u32 % 3);
            if frame % 20 == 19 {
                layers.release_spares(Duration::ZERO);
                assert!(!layers.has_spares());
            }

            let (mut fresh, mut data) = (
                Compositor::default(),
                vec![[0; 4]; (size.0 * size.1) as usize],
            );
            page(&mut fresh, size, scrolled, frame % 2 == 0);
            let shown = gpui::size(DevicePixels(size.0), DevicePixels(size.1));
            fresh.paint(Pixels {
                id: 1,
                data: &mut data,
                width: size.0 as usize,
                shown,
                platform_moves: false,
            });
            for (y, expected) in (0..).zip(data.chunks(size.0 as usize)) {
                for (left, expected) in (0..)
                    .step_by(CELL_WIDTH as usize)
                    .zip(expected.chunks(CELL_WIDTH as usize))
                {
                    let row = layers.target.row(y, left, left + expected.len() as i32);
                    assert!(
                        row == expected,
                        "frame {frame}, row {y}, from column {left}"
                    );
                }
            }
        }
    }
}
