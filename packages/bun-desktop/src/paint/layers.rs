//! A window as a grid of surfaces that the system composites. Only the cells that change have more than one.

#[cfg(target_os = "macos")]
pub mod core_animation;
#[cfg(target_os = "macos")]
mod metal;

use std::ops::Range;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::arena::Chunk;
use super::flatten::{Kind, Primitive};
use super::raster::{IntRect, Pixel};
use super::software::{
    Action, Band, Compositor, Grid, Plan, Summary, TILE_HEIGHT, TILE_WIDTH, Texture, Tile, alpha,
    bgra, is_shaped, last_to_hide, movement, survey,
};
use crate::diagnostics::{self, Incident};
use crate::hash::FastMap;
use crate::small_vec::SmallVec;

const CELL_WIDTH: i32 = 1024;
const CELL_HEIGHT: i32 = 512;
const MAX_SIDE: i32 = 4096;
const UNKNOWN: u64 = 0;
#[cfg(target_os = "macos")]
pub const SPARES_LAST: Duration = Duration::from_secs(2);
pub const SLOTS: usize = 8;

/// The left and the top edge.
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
    fn show(&mut self, position: Position, rect: IntRect, surface: &Self::Surface, is_opaque: bool);
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
    pub slots: SmallVec<Arc<Chunk>, SLOTS>,
}

#[cfg_attr(not(target_os = "macos"), expect(dead_code, reason = "Metal does it"))]
pub struct Pass<'a, S> {
    pub surface: &'a S,
    pub rect: IntRect,
    pub batches: SmallVec<Batch, 1>,
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
        Kind::Turned { .. } => return None,
        Kind::Mask(tile, color) => (tile, 2, bgra(color, primitive.opacity), 1),
        Kind::Image(tile) => (tile, 3 + u32::from(is_shaped(primitive)), [0; 4], 4),
    };
    let texture = Some(&textures[tile.texture as usize]).filter(|it| it.width > 0)?;
    let (block, part) = (texture.block.as_ref()?, tile.part);
    let instance = Instance {
        kind,
        color,
        part: [
            part.left,
            part.top,
            part.width() as i32,
            part.height() as i32,
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
) -> SmallVec<Batch, 1> {
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
        let mut compositor = Compositor::default();
        let texture = |is_color, bytes: Vec<u8>| compositor.atlas.insert(is_color, 16, 8, &bytes);
        let mask = texture(false, (0..128).map(|it| it * 2).collect());
        let image = texture(
            true,
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
            .push(at(140., 17., 16., 8., 0., Kind::Mask(mask, 0x8000_40FF)));
        compositor
            .primitives
            .push(at(160., 30., 16., 8., 0., Kind::Image(image)));
        compositor
            .primitives
            .push(at(100.5, 24.25, 40., 20., 6., Kind::Image(image)));
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
    hashes: Vec<u64>,
    last_shown: Instant,
}

impl<S> Buffer<S> {
    fn columns(&self) -> usize {
        (self.size.0 / TILE_WIDTH) as usize
    }

    fn row(&self, index: usize) -> &[u64] {
        self.hashes
            .chunks(self.columns())
            .nth(index)
            .unwrap_or_default()
    }

    /// The indices of the tiles in `part` of its cell that it does not have.
    fn lacks(&self, tiles: &[Tile], grid: &Grid, part: IntRect) -> impl Iterator<Item = usize> {
        let (left, top) = (self.position.0 / TILE_WIDTH, self.position.1 / TILE_HEIGHT);
        let columns = grid.columns_of(part);
        grid.rows_of(part).flat_map(move |row| {
            let (own, first) = (self.row((row - top) as usize), row as usize * grid.columns);
            let differs = move |column: &i32| {
                own.get((column - left) as usize) != Some(&tiles[first + *column as usize].hash)
            };
            columns
                .clone()
                .filter(differs)
                .map(move |column| first + column as usize)
        })
    }

    fn pixels(&self) -> i64 {
        i64::from(self.size.0) * i64::from(self.size.1)
    }
}

/// Those that suit a cell. At the edges of the window they can stick out.
struct Sizes {
    least: (i32, i32),
    most: (i32, i32),
}

impl Sizes {
    fn has(&self, (width, height): (i32, i32)) -> bool {
        (self.least.0..=self.most.0).contains(&width)
            && (self.least.1..=self.most.1).contains(&height)
    }
}

struct Change<S> {
    area: IntRect,
    buffer: Buffer<S>,
    work: usize,
    is_drawn: bool,
}

fn round_up(length: i32, step: i32) -> i32 {
    (length.max(1) + step - 1) / step * step
}

/// Where the contents of something that scrolls are seen.
struct Port {
    rect: IntRect,
    /// For each column of tiles, whether it has changed in a scroll.
    has_moved: Vec<bool>,
    /// Those columns, with what is too narrow to be left out.
    parts: SmallVec<IntRect, 2>,
    /// The window server keeps up best with few cells. Small changes cost less in small ones.
    has_large_cells: bool,
    scrolled_at: Instant,
}

impl Port {
    fn note(&mut self, tile: IntRect) {
        if self.rect.contains(tile) {
            self.has_moved[((tile.left - self.rect.left) / TILE_WIDTH) as usize] = true;
        }
    }

    fn find_parts(&self) -> SmallVec<IntRect, 2> {
        const GAP: i32 = 384;
        let mut parts: SmallVec<IntRect, 2> = SmallVec::new();
        for (left, _) in (self.rect.left..)
            .step_by(TILE_WIDTH as usize)
            .zip(&self.has_moved)
            .filter(|it| *it.1)
        {
            let right = left + TILE_WIDTH;
            match parts.last_mut() {
                Some(last) if left - last.right <= GAP => last.right = right,
                Some(_) => parts.push(IntRect {
                    left,
                    right,
                    ..self.rect
                }),
                None => parts.push(IntRect {
                    left: if left - self.rect.left <= GAP {
                        self.rect.left
                    } else {
                        left
                    },
                    right,
                    ..self.rect
                }),
            }
        }
        parts
            .last_mut()
            .filter(|it| self.rect.right - it.right <= GAP)
            .into_iter()
            .for_each(|it| it.right = self.rect.right);
        parts
    }
}

struct Cell {
    area: IntRect,
    sizes: Sizes,
}

impl Cell {
    fn position(&self) -> Position {
        (self.area.left, self.area.top)
    }
}

/// From `start` to `end`.
fn steps(start: i32, end: i32, step: i32) -> impl Iterator<Item = (i32, i32)> + Clone {
    (start..end)
        .step_by(step as usize)
        .map(move |at| (at, end.min(at + step)))
}

#[derive(Default)]
struct Division {
    window: IntRect,
    apart: Range<i32>,
    /// Side by side.
    ports: Vec<Port>,
    cells: Vec<Cell>,
    /// For each tile, the index of its cell.
    owners: Vec<u16>,
}

impl Division {
    fn divide(&mut self, grid: &Grid) {
        let window = self.window;
        let parts = || {
            self.ports
                .iter()
                .flat_map(|port| port.parts.iter().map(|part| (*part, port.has_large_cells)))
        };
        let edges = parts()
            .flat_map(|(part, _)| [part.left, part.right])
            .chain([0, self.apart.start, self.apart.end, window.right]);
        let mut edges: Vec<_> = edges.map(|it| it.min(window.right)).collect();
        edges.sort_unstable();
        edges.dedup();
        let mut cells = Vec::new();
        let mut add = |area: IntRect, [width, height]: [i32; 2], is_exact: bool| {
            for (top, bottom) in steps(area.top, area.bottom, height) {
                for (left, right) in steps(area.left, area.right, width) {
                    let fit = |length: i32, is_last: bool, usual: i32| match is_last && !is_exact {
                        true => (
                            round_up(length, usual / 4),
                            (round_up(length, usual / 4) + usual / 4).min(usual),
                        ),
                        false => (length, length),
                    };
                    let (x, y) = (
                        fit(right - left, right == window.right, width),
                        fit(bottom - top, bottom == window.bottom, height),
                    );
                    cells.push(Cell {
                        area: IntRect::new(left, top, right, bottom),
                        sizes: Sizes {
                            least: (x.0, y.0),
                            most: (x.1, y.1),
                        },
                    });
                }
            }
        };
        for &[left, right] in edges.array_windows() {
            let column = IntRect {
                left,
                right,
                ..window
            };
            let (part, is_large) = parts()
                .find(|(part, _)| part.overlaps(column))
                .unwrap_or_default();
            column
                .without(part)
                .for_each(|it| add(it, [CELL_WIDTH, CELL_HEIGHT], false));
            let part = part.intersect(column);
            let evenly = |length: usize, most: i32, tile: i32| {
                round_up(
                    length.div_ceil(length.div_ceil(most as usize).max(1)) as i32,
                    tile,
                )
            };
            let (widest, highest) = if is_large {
                (MAX_SIDE, MAX_SIDE)
            } else {
                (CELL_WIDTH, CELL_HEIGHT)
            };
            add(
                part,
                [
                    evenly(part.width(), widest, TILE_WIDTH),
                    evenly(part.height(), highest, TILE_HEIGHT),
                ],
                true,
            );
        }
        self.owners = vec![0; grid.columns * grid.rows_of(window).len()];
        for (index, cell) in (0..).zip(&cells) {
            tiles_in(grid, cell.area).for_each(|tile| self.owners[tile] = index);
        }
        crate::diagnostics::log!(
            "cells: {:?}",
            cells
                .iter()
                .map(|it| [it.area.left, it.area.top, it.area.right, it.area.bottom])
                .collect::<Vec<_>>()
        );
        self.cells = cells;
    }

    fn cells_in(&self, area: IntRect) -> impl Iterator<Item = &Cell> {
        self.cells.iter().filter(move |it| it.area.overlaps(area))
    }

    /// Returns whether that takes other cells. `changed` has the tiles that the scroll has changed so far.
    fn begin_scroll(&mut self, rect: IntRect, changed: &[IntRect]) -> bool {
        const WORTH_IT: i64 = CELL_WIDTH as i64 * CELL_HEIGHT as i64 / 2;
        if self.ports.iter().all(|it| it.rect != rect) {
            if rect.area() < WORTH_IT || self.cells_in(rect).nth(1).is_none() {
                return false;
            }
            self.ports
                .retain(|it| it.rect.right <= rect.left || it.rect.left >= rect.right);
            let has_moved = vec![false; rect.width() / TILE_WIDTH as usize];
            self.ports.push(Port {
                rect,
                has_moved,
                parts: SmallVec::new(),
                has_large_cells: false,
                scrolled_at: Instant::now(),
            });
        }
        let Some(port) = self.ports.iter_mut().find(|it| it.rect == rect) else {
            return false;
        };
        changed.iter().for_each(|it| port.note(*it));
        let parts = port.find_parts();
        let had_large_cells = std::mem::replace(&mut port.has_large_cells, true);
        std::mem::replace(&mut port.parts, parts)[..] != port.parts[..] || !had_large_cells
    }
}

/// Without leaving a sliver at the top or at the bottom.
fn within(window: IntRect, port: IntRect) -> IntRect {
    const SLIVER: i32 = 32;
    let IntRect { top, bottom, .. } = port;
    let (top, bottom) = (
        if top <= SLIVER { 0 } else { top },
        if window.bottom - bottom <= SLIVER {
            window.bottom
        } else {
            bottom
        },
    );
    IntRect {
        top,
        bottom,
        ..port
    }
    .intersect(window)
}

fn tiles_in(grid: &Grid, area: IntRect) -> impl Iterator<Item = usize> {
    let columns = grid.columns_of(area);
    grid.rows_of(area).flat_map(move |row| {
        columns
            .clone()
            .map(move |column| row as usize * grid.columns + column as usize)
    })
}

fn rect_of(grid: &Grid, tile: usize) -> IntRect {
    let column = (tile % grid.columns) as i32;
    grid.rect((tile / grid.columns) as i32, column..column + 1)
}

#[cfg(target_os = "macos")]
fn in_parallel(count: usize, work: &(dyn Fn(usize) + Sync)) {
    use std::ffi::c_void;
    unsafe extern "C" {
        fn dispatch_apply_f(
            count: usize,
            queue: *mut c_void,
            context: *mut c_void,
            work: unsafe extern "C" fn(*mut c_void, usize),
        );
    }
    unsafe extern "C" fn call(work: *mut c_void, index: usize) {
        // SAFETY: what is passed below.
        crate::guard("error", (), || unsafe {
            (*work.cast::<&(dyn Fn(usize) + Sync)>())(index)
        });
    }
    match count {
        1 => work(0),
        // SAFETY: it returns when all calls have, and no queue stands for the threads that suit this one.
        _ => unsafe {
            dispatch_apply_f(
                count,
                std::ptr::null_mut(),
                (&raw const work).cast_mut().cast(),
                call,
            )
        },
    }
}

#[cfg(not(target_os = "macos"))]
fn in_parallel(count: usize, work: &(dyn Fn(usize) + Sync)) {
    (0..count).for_each(work);
}

struct Shared(Locked);

// SAFETY: `Layers::paint` gives a row that is written to one thread, and only reads the others.
unsafe impl Send for Shared {}
// SAFETY: as above.
unsafe impl Sync for Shared {}

pub struct Layers<T: Target> {
    pub target: T,
    shown: FastMap<Position, Buffer<T::Surface>>,
    spare: Vec<Buffer<T::Surface>>,
    instances: Vec<Instance>,
    division: Division,
    apart: Range<i32>,
    /// The port of what is being scrolled, and whether the cells have been chosen for that.
    scrolled: Option<(IntRect, bool)>,
    frames_scrolled: u32,
    large_cells_last: Duration,
}

impl<T: Target> Layers<T> {
    /// No cell is both inside of it and outside.
    pub fn keep_apart(&mut self, part: Range<i32>) {
        self.apart = part.start.max(0) / TILE_WIDTH * TILE_WIDTH
            ..(part.end.max(0) + TILE_WIDTH - 1) / TILE_WIDTH * TILE_WIDTH;
    }

    /// `port` is where the contents of what is being scrolled are seen.
    pub fn set_scrolling(&mut self, port: Option<IntRect>) {
        self.frames_scrolled = if port.is_some() {
            self.frames_scrolled + 1
        } else {
            0
        };
        let down = |at: i32, tile: i32| at.max(0) / tile * tile;
        let port = port.filter(|it| !it.is_empty()).map(|it| {
            IntRect::new(
                down(it.left, TILE_WIDTH),
                down(it.top, TILE_HEIGHT),
                round_up(it.right, TILE_WIDTH),
                round_up(it.bottom, TILE_HEIGHT),
            )
        });
        self.scrolled = port.map(|port| (port, self.scrolled == Some((port, true))));
    }

    #[cfg(target_os = "macos")]
    pub fn frames_scrolled(&self) -> u32 {
        self.frames_scrolled
    }

    pub fn new(target: T) -> Self {
        Layers {
            target,
            shown: FastMap::default(),
            spare: Vec::new(),
            instances: Vec::new(),
            division: Division::default(),
            apart: 0..0,
            scrolled: None,
            frames_scrolled: 0,
            large_cells_last: Duration::from_secs(1),
        }
    }

    /// Returns whether the cells are others, and not just larger or smaller with the window.
    fn arrange(&mut self, grid: &Grid, tiles: &[Tile]) -> bool {
        const TO_KNOW: usize = 32;
        let Layers {
            division, shown, ..
        } = self;
        let is_resized = std::mem::replace(&mut division.window, grid.window) != grid.window;
        let mut are_others =
            std::mem::replace(&mut division.apart, self.apart.clone()) != self.apart;
        if is_resized {
            are_others |= !std::mem::take(&mut division.ports).is_empty();
            division.divide(grid);
            return are_others;
        }
        let changes_in = |division: &Division, part: IntRect| {
            let known = division
                .cells_in(part)
                .filter_map(|cell| Some((shown.get(&cell.position())?, cell.area.intersect(part))));
            known
                .flat_map(|(buffer, part)| buffer.lacks(tiles, grid, part))
                .map(|tile| rect_of(grid, tile))
                .collect::<Vec<_>>()
        };
        if let Some((port, is_chosen @ false)) = &mut self.scrolled {
            let port = within(grid.window, *port);
            let changed = changes_in(division, port);
            if changed.len() >= TO_KNOW {
                *is_chosen = true;
                are_others |= division.begin_scroll(port, &changed);
            }
        }
        let now = Instant::now();
        for index in 0..division.ports.len() {
            let port = &division.ports[index];
            if self.scrolled.is_some_and(|it| it.0.overlaps(port.rect)) {
                division.ports[index].scrolled_at = now;
            } else if port.has_large_cells
                && now - port.scrolled_at >= self.large_cells_last
                && port
                    .parts
                    .iter()
                    .any(|it| !changes_in(division, *it).is_empty())
            {
                division.ports[index].has_large_cells = false;
                are_others = true;
            }
        }
        if are_others {
            division.divide(grid);
        }
        are_others
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
    #[cfg(target_os = "macos")]
    pub fn forget_contents(&mut self) {
        self.release_spares(Duration::ZERO);
        self.shown
            .values_mut()
            .for_each(|buffer| buffer.hashes.fill(UNKNOWN));
    }

    fn back_buffer(
        &mut self,
        position: Position,
        sizes: &Sizes,
        grows: (bool, bool),
    ) -> Option<Buffer<T::Surface>> {
        let now = Instant::now();
        let mut fitting: SmallVec<usize, 32> = (0..self.spare.len())
            .filter(|it| sizes.has(self.spare[*it].size))
            .collect();
        fitting.sort_by_key(|it| match &self.spare[*it] {
            it if it.position == position => (false, now - it.last_shown),
            it => (true, Duration::MAX - (now - it.last_shown)),
        });
        let best = fitting
            .iter()
            .copied()
            .find(|it| !T::is_in_use(&self.spare[*it].surface));
        if best.is_none() {
            diagnostics::note(Incident::NewSurface);
        }
        let size = (
            if grows.0 { sizes.most.0 } else { sizes.least.0 },
            if grows.1 { sizes.most.1 } else { sizes.least.1 },
        );
        let mut buffer = match best {
            Some(index) => self.spare.swap_remove(index),
            None => Buffer {
                surface: self.target.create(size.0, size.1)?,
                size,
                position,
                hashes: vec![UNKNOWN; (size.0 / TILE_WIDTH * (size.1 / TILE_HEIGHT)) as usize],
                last_shown: now,
            },
        };
        if std::mem::replace(&mut buffer.position, position) != position {
            buffer.hashes.fill(UNKNOWN);
        }
        Some(buffer)
    }

    pub fn paint(&mut self, compositor: &mut Compositor, width: i32, height: i32) {
        const WORTH_DRAWING: usize = 480;
        const WORTH_MOVING: usize = 32;
        const TILES_PER_THREAD: usize = 400;
        const MAX_THREADS: usize = 4;
        const MAX_SPARE_WINDOWS: i64 = 8;
        let start = diagnostics::logs_frames().then(Instant::now);
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
        let summaries = compositor.summarize();
        let tiles = compositor.survey(&summaries, grid);
        let before = std::mem::replace(&mut compositor.window, window);

        let has_new_cells = self.arrange(grid, &tiles);
        let mut division = std::mem::take(&mut self.division);
        let grows = (
            !before.is_empty() && window.right > before.right,
            !before.is_empty() && window.bottom > before.bottom,
        );
        for (position, buffer) in self
            .shown
            .extract_if(|it, _| division.cells.iter().all(|cell| cell.position() != *it))
        {
            self.target.remove(position);
            self.spare.push(buffer);
        }
        let (mut actions, mut changes, mut is_complete) =
            (vec![Action::Keep; tiles.len()], Vec::new(), true);
        let mut scrolled = division.ports.iter_mut().find(|it| {
            !has_new_cells
                && self
                    .scrolled
                    .is_some_and(|(port, _)| within(window, port) == it.rect)
        });
        for cell @ Cell { area, sizes } in &division.cells {
            let (area, position) = (*area, cell.position());
            if self.shown.get(&position).is_some_and(|it| {
                sizes.has(it.size) && it.lacks(&tiles, grid, area).next().is_none()
            }) {
                continue;
            }
            let Some(mut buffer) = self.back_buffer(position, sizes, grows) else {
                is_complete = false;
                continue;
            };
            let (shown, mut work, columns, stride) = (
                self.shown.get(&position),
                0,
                grid.columns_of(area),
                buffer.columns(),
            );
            let mut beside = scrolled
                .as_mut()
                .filter(|it| it.parts.iter().all(|part| !part.overlaps(area)));
            let mut rows = buffer.hashes.chunks_mut(stride);
            for (index, (row, painted)) in grid.rows_of(area).zip(&mut rows).enumerate() {
                let (first, was) = (
                    row as usize * grid.columns + columns.start as usize,
                    shown.map_or(&[][..], |it| it.row(index)),
                );
                let (painted, outside) = painted.split_at_mut(columns.len());
                outside.fill(UNKNOWN);
                for (column, (painted, tile)) in painted.iter_mut().zip(&tiles[first..]).enumerate()
                {
                    let is_shown = was.get(column) == Some(&tile.hash);
                    if let (Some(port), false) = (&mut beside, is_shown) {
                        port.note(rect_of(grid, first + column));
                    }
                    if std::mem::replace(painted, tile.hash) != tile.hash {
                        actions[first + column] = if is_shown && !tile.is_flat {
                            Action::Copy
                        } else {
                            Action::Paint
                        };
                        work += 1;
                    }
                }
            }
            rows.for_each(|it| it.fill(UNKNOWN));
            changes.push(Change {
                area,
                buffer,
                work,
                is_drawn: false,
            });
        }

        let (atlas, primitives) = (compositor.atlas.0.borrow(), &compositor.primitives);
        let textures = &atlas.slots[..];
        let work = changes.iter().map(|change| change.work).sum::<usize>();
        if work >= WORTH_DRAWING && self.target.can_draw() {
            self.instances.clear();
            let passes = changes
                .iter()
                .filter(|change| change.work > 0)
                .map(|change| {
                    let ((left, top), (width, height)) =
                        (change.buffer.position, change.buffer.size);
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
                .filter(|change| is_drawn && change.work > 0)
            {
                change.is_drawn = true;
                tiles_in(grid, change.area).for_each(|tile| actions[tile] = Action::Keep);
            }
        }

        let count =
            |action: Action, actions: &[Action]| actions.iter().filter(|it| **it == action).count();
        let can_move = !has_new_cells && count(Action::Paint, &actions) >= WORTH_MOVING;
        let down = can_move
            .then(|| movement(&compositor.shown, &summaries))
            .flatten()
            .unwrap_or(0);
        if down != 0 {
            let changed = grid.around(|tile| actions[tile] == Action::Paint);
            let moved = survey(&compositor.shown, grid, down, changed);
            for (tile, action) in actions.iter_mut().enumerate() {
                let source = rect_of(grid, tile).offset(0, -down);
                let owner = |y: i32| {
                    division.owners[(y / TILE_HEIGHT) as usize * grid.columns + tile % grid.columns]
                };
                let is_there = |y: i32| {
                    self.shown
                        .contains_key(&division.cells[usize::from(owner(y))].position())
                };
                if *action == Action::Paint
                    && !tiles[tile].is_flat
                    && moved[tile].hash == tiles[tile].hash
                    && before.intersect(window).contains(source)
                    && is_there(source.top)
                    && is_there(source.bottom - 1)
                {
                    *action = Action::Move;
                }
            }
        }

        let copies = [(Action::Copy, 0), (Action::Move, down)]
            .map(|(action, down)| (grid.areas(|tile| actions[tile] == action), down));
        let is_source = |cell: &&Cell| {
            copies.iter().any(|(areas, down)| {
                areas
                    .iter()
                    .any(|it| it.offset(0, -down).overlaps(cell.area))
            })
        };
        let sources = division
            .cells
            .iter()
            .filter(is_source)
            .map(|cell| (cell.area, &self.shown[&cell.position()].surface));
        let sources: Vec<_> = sources
            .map(|(area, surface)| (area, surface, Shared(T::lock(surface, false))))
            .collect();
        let readable: Vec<_> = sources
            .iter()
            .map(|(area, _, pixels)| (*area, pixels))
            .collect();
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
        let paint_band = |(area, Shared(target)): &(IntRect, Shared)| {
            // SAFETY: the surface is locked and reaches to the end of `area`, whose rows are this thread's.
            let pixels = unsafe {
                std::slice::from_raw_parts_mut(target.start, target.stride * area.height())
            };
            for (part, down) in copies
                .iter()
                .flat_map(|(areas, down)| areas.iter().map(move |it| (it.intersect(*area), *down)))
            {
                for (cell, Shared(source)) in &readable {
                    let part = part.offset(0, -down).intersect(*cell);
                    for y in (part.top..part.bottom).filter(|_| !part.is_empty()) {
                        let from = (y - cell.top) as usize * source.stride
                            + (part.left - cell.left) as usize;
                        // SAFETY: the surface is locked, and these pixels were painted, so it has them.
                        let row = unsafe {
                            std::slice::from_raw_parts(source.start.add(from), part.width())
                        };
                        pixels[(y + down - area.top) as usize * target.stride
                            + (part.left - area.left) as usize..][..row.len()]
                            .copy_from_slice(row);
                    }
                }
            }
            plan.paint(
                &mut Band::new(pixels, target.stride, area.left, area.top, textures),
                *area,
            );
        };
        let is_painted = |change: &&Change<_>| !change.is_drawn && change.work > 0;
        let mut bands = Vec::new();
        for change in changes.iter().filter(is_painted) {
            diagnostics::note(Incident::PaintedByCpu);
            let (area, Locked { start, stride }) =
                (change.area, T::lock(&change.buffer.surface, true));
            let height = area
                .height()
                .div_ceil(change.work.div_ceil(TILES_PER_THREAD).min(MAX_THREADS));
            for (top, bottom) in steps(area.top, area.bottom, round_up(height as i32, TILE_HEIGHT))
            {
                let start = start.wrapping_add((top - area.top) as usize * stride);
                bands.push((
                    IntRect {
                        top,
                        bottom,
                        ..area
                    },
                    Shared(Locked { start, stride }),
                ));
            }
        }
        let left = tiles.len() - count(Action::Keep, &actions);
        let threads = left.div_ceil(TILES_PER_THREAD).clamp(1, MAX_THREADS);
        in_parallel(threads, &|first| {
            bands
                .iter()
                .skip(first)
                .step_by(threads)
                .for_each(paint_band)
        });
        changes
            .iter()
            .filter(is_painted)
            .for_each(|change| T::unlock(&change.buffer.surface, true));
        sources
            .iter()
            .for_each(|(_, surface, _)| T::unlock(surface, false));

        if let Some(start) = start {
            let (drawn, spare) = (
                changes.iter().filter(|change| change.is_drawn).count(),
                self.spare.len(),
            );
            let new = |it: &Change<_>| {
                self.shown
                    .get(&it.buffer.position)
                    .map_or(it.work, |shown| shown.lacks(&tiles, grid, it.area).count())
            };
            let lefts: Vec<_> = changes.iter().map(|it| (it.area.left, new(it))).collect();
            crate::diagnostics::log!(
                "{} cells at, with new tiles, {lefts:?} ({drawn} by the GPU, {left} tiles by the CPU, {spare} spare) in {:?}",
                changes.len(),
                start.elapsed()
            );
        }
        let now = Instant::now();
        for Change { buffer, area, .. } in changes {
            let (left, top) = buffer.position;
            let rect = IntRect::new(left, top, left + buffer.size.0, top + buffer.size.1);
            let is_opaque = tiles_in(grid, area).all(|tile| tiles[tile].is_opaque());
            self.target
                .show(buffer.position, rect, &buffer.surface, is_opaque);
            let old = self.shown.insert(buffer.position, buffer);
            self.spare.extend(old.map(|old| Buffer {
                last_shown: now,
                ..old
            }));
        }
        // One that the system still reads costs as much after it is released, and another has to be made for it.
        if has_new_cells || self.spare.len() > 2 * self.shown.len() {
            self.spare
                .retain(|buffer| division.cells.iter().any(|it| it.sizes.has(buffer.size)));
        }
        let mut allowed = MAX_SPARE_WINDOWS * self.shown.values().map(Buffer::pixels).sum::<i64>();
        if self.spare.iter().map(Buffer::pixels).sum::<i64>() > allowed {
            self.spare.sort_by_key(|buffer| buffer.last_shown);
            self.spare.retain(|buffer| {
                allowed -= buffer.pixels();
                allowed >= 0
            });
        }
        drop(atlas);
        self.division = division;
        compositor.show(if is_complete { summaries } else { Vec::new() });
        compositor.tiles = tiles;
    }
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, UnsafeCell};
    use std::rc::Rc;

    use super::*;
    use crate::abi::Rect;
    use crate::paint::software::Sprite;
    use crate::platform::Pixels;

    struct Memory {
        pixels: UnsafeCell<Vec<Pixel>>,
        width: usize,
        /// For how many more frames.
        in_use: Cell<u32>,
    }

    #[derive(Default)]
    struct Screen {
        all: Vec<Rc<Memory>>,
        shown: FastMap<Position, (IntRect, Rc<Memory>)>,
        draws: bool,
        pixels_created: i32,
        /// In the last frame.
        changed: Vec<IntRect>,
    }

    impl Target for Screen {
        type Surface = Rc<Memory>;

        fn create(&mut self, width: i32, height: i32) -> Option<Rc<Memory>> {
            let pixels = UnsafeCell::new(vec![[1, 2, 3, 4]; (width * height) as usize]);
            self.pixels_created += width * height;
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
            self.draws
        }

        fn draw(&mut self, _: &[Instance], _: &[Pass<Rc<Memory>>]) -> bool {
            true
        }

        fn show(&mut self, position: Position, rect: IntRect, surface: &Rc<Memory>, _: bool) {
            self.shown.insert(position, (rect, surface.clone()));
            self.changed.push(rect);
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

        fn row(&self, position: Position, y: i32) -> &[Pixel] {
            let surface = &self.shown[&position].1;
            // SAFETY: `paint` has returned.
            let pixels = unsafe { &*surface.pixels.get() };
            &pixels[(y - position.1) as usize * surface.width..][..surface.width]
        }

        fn pixels_alive(&self) -> usize {
            // SAFETY: as above.
            self.all
                .iter()
                .map(|it| unsafe { &*it.pixels.get() }.len())
                .sum()
        }
    }

    fn lines(compositor: &Compositor) -> Vec<Sprite> {
        let mask = |line: i32| {
            (0..900 * 30)
                .map(|it| ((it * (line + 3)) % 251) as u8)
                .collect::<Vec<_>>()
        };
        (0..200)
            .map(|line| compositor.atlas.insert(false, 900, 30, &mask(line)))
            .collect()
    }

    fn port(width: i32, height: i32) -> IntRect {
        IntRect::new(300, 70, width - 20, height - 130)
    }

    fn page(
        compositor: &mut Compositor,
        lines: &[Sprite],
        (width, height): (i32, i32),
        scrolled: i32,
        caret: bool,
    ) {
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
        let port = port(width, height);
        for line in 0..200 {
            let tile = lines[line as usize];
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
        all.push(Primitive {
            radii: [40., 6., 0., 90.],
            ..quad(
                30,
                50,
                width - 90,
                height - 75 - scrolled % 97,
                port.outset(280),
                0x2080_4020,
            )
        });
        all.extend(caret.then(|| quad(520, height - 200, 2, 36, window, 0x0000_00FF)));
        compositor.primitives = all;
    }

    #[test]
    fn reuses_surfaces_while_the_window_is_resized() {
        for lag in 1..5 {
            let (mut layers, mut compositor) = (
                Layers::new(Screen {
                    draws: true,
                    ..Screen::default()
                }),
                Compositor::default(),
            );
            let kept = lines(&compositor);
            for step in 0..140 {
                let size = (
                    1700 + (step - 70i32).abs() * 10,
                    1120 + (step - 70i32).abs() * 6,
                );
                page(&mut compositor, &kept, size, 1000, false);
                compositor.primitives[0].opacity = 1. - step as f32 / 200.;
                layers.paint(&mut compositor, size.0, size.1);
                layers.target.next_frame(lag);
            }
            assert!(
                layers.target.pixels_created < 2400 * 1540 * 2 * (lag as i32 + 2),
                "{lag}: {}",
                layers.target.pixels_created
            );
        }
    }

    #[test]
    fn keeps_cells_that_only_touch_what_is_resized() {
        let (mut layers, mut compositor) = (Layers::new(Screen::default()), Compositor::default());
        let mut shown = [(2000, 1200), (2030, 1222)].map(|(width, height)| {
            let quad = |x: f32, y: f32, left: i32, border: f32| {
                let bounds = Rect {
                    x,
                    y,
                    width: width as f32 - x,
                    height: height as f32 - y,
                };
                let kind = Kind::Quad {
                    color: 0xFAFA_F0C0,
                    border_color: 0x0000_0040,
                    border: [border; 4],
                };
                Primitive {
                    radii: [border * 8.; 4],
                    ..Primitive::new(bounds, IntRect::new(left, 0, width, height), kind)
                }
            };
            compositor.primitives = vec![
                quad(0., 0., 575, 0.),
                quad(300.5, 40.25, 0, 1.5),
                quad(20., 20., 0, 2.),
            ];
            layers.paint(&mut compositor, width, height);
            layers.target.next_frame(1);
            [(0, 0), (0, 512), (1024, 0), (0, 1024)]
                .map(|it| Rc::as_ptr(&layers.target.shown[&it].1))
        });
        let [before, after] = shown.each_mut().map(|it| it.iter());
        assert_eq!(
            before.zip(after).map(|(a, b)| a == b).collect::<Vec<_>>(),
            [true, true, false, false]
        );
    }

    /// A column of text in the middle of what is right of a sidebar, with a scrollbar.
    struct Chat {
        layers: Layers<Screen>,
        compositor: Compositor,
        line: Sprite,
        size: (i32, i32),
        scrolled: i32,
    }

    impl Chat {
        fn new(size: (i32, i32)) -> Chat {
            let (mut layers, compositor) = (
                Layers::new(Screen {
                    draws: true,
                    ..Screen::default()
                }),
                Compositor::default(),
            );
            layers.keep_apart(0..576);
            let line = compositor.atlas.insert(false, 1500, 30, &[99; 1500 * 30]);
            let mut chat = Chat {
                layers,
                compositor,
                line,
                size,
                scrolled: 0,
            };
            chat.frame(None, 0);
            chat
        }

        /// Returns the cells that have changed.
        fn frame(&mut self, scrolls_by: Option<i32>, typed: i32) -> Vec<IntRect> {
            let (width, height) = self.size;
            let (window, port) = (
                IntRect::new(0, 0, width, height),
                IntRect::new(576, 72, width, height - 24),
            );
            let quad = |rect: IntRect, color| {
                Primitive::new(
                    rect.to_rect(),
                    rect,
                    Kind::Quad {
                        color,
                        border_color: 0,
                        border: [0.; 4],
                    },
                )
            };
            self.scrolled += scrolls_by.unwrap_or(0);
            let x = (576 + width - 1500) / 2;
            let line = |index: i32| Rect {
                x: x as f32,
                y: (index * 48 - self.scrolled % 48) as f32,
                width: 1500.,
                height: 30.,
            };
            let mut all = vec![quad(
                IntRect {
                    left: 576,
                    ..window.outset(1)
                },
                0xFAFA_F0FF,
            )];
            all.extend(
                (0..height / 48 + 2)
                    .map(|it| Primitive::new(line(it), port, Kind::Mask(self.line, 0x1111_11FF))),
            );
            all.push(quad(
                IntRect::new(width - 20, 100, width - 8, 200).offset(0, self.scrolled / 9),
                0x0000_0040,
            ));
            all.push(quad(
                IntRect::new(x, height - 200, x + 20 + typed * 20, height - 160),
                0x0000_00FF,
            ));
            self.compositor.primitives = all;
            self.layers.set_scrolling(scrolls_by.map(|_| port));
            self.layers.paint(&mut self.compositor, width, height);
            self.layers.target.next_frame(2);
            std::mem::take(&mut self.layers.target.changed)
        }
    }

    #[test]
    fn what_scrolls_is_one_cell_until_little_changes() {
        let mut chat = Chat::new((2400, 1600));
        let large = IntRect::new(576, 64, 2432, 1600);
        assert!(chat.frame(Some(0), 0).is_empty());
        assert!(chat.frame(Some(5), 0).contains(&large));
        for _ in 0..60 {
            assert!(chat.frame(Some(11), 0) == [large]);
            assert!(
                chat.layers.target.pixels_alive()
                    < 2432 * 1600 + 3 * large.area() as usize + 1024 * 128
            );
        }
        let created = chat.layers.target.pixels_created;
        assert!(chat.frame(None, 1) == [large] && chat.frame(Some(11), 1) == [large]);
        assert_eq!(chat.layers.target.pixels_created, created);

        chat.layers.large_cells_last = Duration::ZERO;
        assert!(chat.frame(None, 1).is_empty());
        assert_eq!(chat.frame(None, 2).len(), 6);
        assert!(chat.layers.target.pixels_alive() < 2432 * 1600 + 1024 * 128);
        assert!(chat.frame(None, 3) == [IntRect::new(576, 1088, 1536, 1600)]);
        assert!(chat.frame(Some(11), 3) == [large]);
    }

    #[test]
    fn wide_margins_are_left_out() {
        let mut chat = Chat::new((5120, 2800));
        chat.frame(Some(40), 0);
        let mut changed = chat.frame(Some(40), 0);
        changed.sort_by_key(|it| it.left);
        assert!(
            changed
                == [
                    IntRect::new(2048, 64, 3648, 2800),
                    IntRect::new(5056, 64, 5120, 2800)
                ]
        );
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
        let (mut scrolled, kept) = (1000, lines(&compositor));
        for (frame, (size, step)) in sizes
            .iter()
            .flat_map(|size| steps.iter().map(move |step| (*size, *step)))
            .enumerate()
        {
            scrolled = (scrolled + step) % 6000;
            page(&mut compositor, &kept, size, scrolled, frame % 2 == 0);
            layers.keep_apart([0..0, 0..576, 0..700, 1500..4000][frame / 5 % 4].clone());
            let ports = [
                port(size.0, size.1),
                IntRect::new(0, 200, 700, 900),
                IntRect::new(600, 300, 900, 400),
                IntRect::new(-50, -50, 9000, 9000),
            ];
            layers
                .set_scrolling((frame % 13 > 1 && frame % 7 != 3).then_some(ports[frame / 3 % 4]));
            layers.large_cells_last = Duration::from_secs(frame as u64 % 2);
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
            let again = lines(&fresh);
            page(&mut fresh, &again, size, scrolled, frame % 2 == 0);
            fresh.paint(Pixels {
                id: 1,
                data: &mut data,
                width: size.0 as usize,
                shown: size,
                platform_moves: false,
            });
            let all = IntRect::new(0, 0, size.0, size.1);
            let shown: Vec<_> = layers
                .target
                .shown
                .values()
                .map(|it| it.0.intersect(all))
                .collect();
            assert_eq!(shown.iter().map(|it| it.area()).sum::<i64>(), all.area());
            for (rect, y) in shown
                .iter()
                .flat_map(|it| (it.top..it.bottom).map(move |y| (it, y)))
            {
                let expected = &data[(y * size.0 + rect.left) as usize..][..rect.width()];
                assert!(
                    &layers.target.row((rect.left, rect.top), y)[..rect.width()] == expected,
                    "frame {frame}, row {y}, from column {}",
                    rect.left
                );
            }
        }
    }
}
