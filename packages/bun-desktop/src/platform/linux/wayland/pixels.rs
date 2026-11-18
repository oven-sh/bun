//! Memory that the compositor reads. Some copy it at once, and others use it until they have the next.

use std::cell::Cell;

use super::super::socket::Memory;
use super::wire::{Connection, Kind};
use crate::paint::raster::IntRect;
use crate::paint::software::{TILE_HEIGHT, TILE_WIDTH};
use crate::platform::{Painted, Painter, Pixels};

const ARGB: u32 = 0;
const XRGB: u32 = 1;
const MAX_BUFFERS: usize = 3;

thread_local! {
    static LAST_ID: Cell<u64> = const { Cell::new(0) };
}

/// Premultiplied BGRA that does not change.
pub fn picture(
    wire: &Connection,
    shm: u32,
    (width, height): (u32, u32),
    pixels: impl Iterator<Item = [u8; 4]>,
) -> Option<u32> {
    let (mut memory, file) = Memory::new((width * height).max(1) as usize).ok()?;
    memory
        .pixels()
        .iter_mut()
        .zip(pixels)
        .for_each(|(to, from)| *to = from);
    wire.attach(file);
    let pool = wire.create(Kind::Silent, 0, shm, 0, &[width * height * 4]);
    let buffer = wire.create(
        Kind::Silent,
        0,
        pool,
        0,
        &[0, width, height, width * 4, ARGB],
    );
    wire.destroy(pool, 1);
    Some(buffer)
}

struct Buffer {
    memory: Memory,
    pool: u32,
    object: u32,
    shape: ((i32, i32), u32),
    is_busy: bool,
    /// The tiles that have changed since it was painted.
    stale: Vec<bool>,
}

impl Buffer {
    fn destroy(self, wire: &Connection) {
        wire.destroy(self.object, 0);
        wire.destroy(self.pool, 1);
    }
}

/// To the painter, they are one.
#[derive(Default)]
pub struct Buffers {
    /// The one that was painted last comes first.
    all: Vec<Buffer>,
    id: u64,
    capacity: (i32, i32),
}

impl Buffers {
    pub fn has_free_one(&self) -> bool {
        self.all.len() < MAX_BUFFERS || self.all.iter().any(|it| !it.is_busy)
    }

    pub fn has_spares(&self) -> bool {
        self.all.iter().skip(1).any(|it| !it.is_busy)
    }

    pub fn release_spares(&mut self, wire: &Connection) {
        let after_first = self.all.len().min(1)..;
        self.all
            .extract_if(after_first, |it| !it.is_busy)
            .for_each(|it| it.destroy(wire));
    }

    pub fn clear(&mut self, wire: &Connection) {
        self.all.drain(..).for_each(|it| it.destroy(wire));
        self.capacity = (0, 0);
    }

    pub fn was_released(&mut self, object: u32) {
        self.all
            .iter_mut()
            .filter(|it| it.object == object)
            .for_each(|it| it.is_busy = false);
    }

    /// Of what was painted last.
    pub fn size(&self) -> Option<(i32, i32)> {
        self.all.first().map(|it| it.shape.0)
    }

    /// What was painted last, which the compositor is about to get.
    pub fn hand_over(&mut self) -> u32 {
        self.all.first_mut().map_or(0, |it| {
            it.is_busy = true;
            it.object
        })
    }

    /// Returns what has changed.
    pub fn draw(
        &mut self,
        wire: &Connection,
        shm: u32,
        owner: u32,
        size: (i32, i32),
        is_opaque: bool,
        paint: Painter,
    ) -> Option<Vec<IntRect>> {
        let room = |length: i32, step: i32| (length + step - 1) / step * step;
        let needed = (room(size.0, 256), room(size.1, 128));
        if needed.0 > self.capacity.0
            || needed.1 > self.capacity.1
            || needed.0 * needed.1 < self.capacity.0 * self.capacity.1 / 2
        {
            self.clear(wire);
            self.capacity = needed;
            LAST_ID.set(LAST_ID.get() + 1);
            self.id = LAST_ID.get();
        }
        let (width, columns) = (
            self.capacity.0 as usize,
            (self.capacity.0 / TILE_WIDTH) as usize,
        );
        let free = self.all.iter().position(|it| !it.is_busy);
        let mut buffer = match free {
            Some(index) => self.all.remove(index),
            None if self.all.len() == MAX_BUFFERS => return None,
            None => {
                let (memory, file) = Memory::new(width * self.capacity.1 as usize).ok()?;
                wire.attach(file);
                let pool = wire.create(
                    Kind::Silent,
                    0,
                    shm,
                    0,
                    &[(self.capacity.0 * self.capacity.1 * 4) as u32],
                );
                let stale = vec![true; columns * (self.capacity.1 / TILE_HEIGHT) as usize];
                Buffer {
                    memory,
                    pool,
                    object: 0,
                    shape: ((0, 0), 0),
                    is_busy: false,
                    stale,
                }
            }
        };
        let shape = (size, if is_opaque { XRGB } else { ARGB });
        let is_reshaped = (free == Some(0))
            .then_some(&buffer)
            .or(self.all.first())
            .is_none_or(|last| last.shape != shape);
        if std::mem::replace(&mut buffer.shape, shape) != shape {
            wire.destroy(buffer.object, 0);
            buffer.object = wire.create(
                Kind::Buffer,
                owner,
                buffer.pool,
                0,
                &[0, size.0 as u32, size.1 as u32, width as u32 * 4, shape.1],
            );
        }
        let last = self.all.first_mut().filter(|_| free != Some(0));
        let data = buffer.memory.pixels();
        let Painted {
            moved,
            moved_by,
            mut areas,
        } = paint(Pixels {
            id: self.id,
            data: &mut *data,
            width,
            shown: size,
            platform_moves: last.is_some(),
        });
        let tiles = |area: IntRect| {
            let rows = area.top / TILE_HEIGHT..(area.bottom + TILE_HEIGHT - 1) / TILE_HEIGHT;
            rows.map(move |row| row as usize * columns)
                .map(move |first| {
                    first + (area.left / TILE_WIDTH) as usize
                        ..first + ((area.right + TILE_WIDTH - 1) / TILE_WIDTH) as usize
                })
        };
        areas.extend(&moved);
        areas
            .iter()
            .flat_map(|it| tiles(*it))
            .for_each(|it| buffer.stale[it].fill(false));
        if let Some(from) = last.map(|it| it.memory.pixels()) {
            let mut copy = |area: IntRect, down: i32| {
                for y in area.top..area.bottom {
                    let [to, at] = [y, y - down].map(|y| y as usize * width + area.left as usize);
                    data[to..to + area.width()].copy_from_slice(&from[at..at + area.width()]);
                }
            };
            moved.iter().for_each(|it| copy(*it, moved_by));
            for (top, row) in (0..)
                .step_by(TILE_HEIGHT as usize)
                .zip(tiles(IntRect::new(0, 0, size.0, size.1)))
            {
                let mut left = 0;
                for run in buffer.stale[row].chunk_by_mut(|a, b| a == b) {
                    let right = left + run.len() as i32 * TILE_WIDTH;
                    if run[0] {
                        copy(IntRect::new(left, top, right, top + TILE_HEIGHT), 0);
                        run.fill(false);
                    }
                    left = right;
                }
            }
        }
        for other in &mut self.all {
            areas
                .iter()
                .flat_map(|it| tiles(*it))
                .for_each(|it| other.stale[it].fill(true));
        }
        self.all.insert(0, buffer);
        Some(if is_reshaped {
            vec![IntRect::new(0, 0, size.0, size.1)]
        } else {
            areas
        })
    }
}
