//! What items were flattened to, for as long as they stay the same.

use std::ops::Range;

use super::flatten::Primitive;
use super::raster::IntRect;
use crate::gfx::Transform;

struct Entry {
    items: Range<usize>,
    matrix: Transform,
    clip: IntRect,
    is_inside: bool,
    last_used: u64,
    recorded: Option<Recorded>,
}

#[derive(Clone)]
struct Recorded {
    first_run: u32,
    primitives: Range<usize>,
    rasters: Range<usize>,
}

#[derive(Default)]
pub struct Memo {
    /// The cache that has the rasters, and its last draw.
    owner: (u64, u64),
    /// For each item, 1 more than the index of its entry.
    slots: Vec<u32>,
    entries: Vec<Entry>,
    primitives: Vec<Primitive>,
    rasters: Vec<u128>,
    /// From where on `rasters` are those of what is being recorded.
    recording: Option<usize>,
    is_provisional: bool,
}

pub enum Recall {
    Done,
    /// What is in it is remembered instead.
    Moves,
    Unknown,
}

impl Memo {
    pub fn clear(&mut self) {
        self.slots.clear();
        self.entries.clear();
        self.primitives.clear();
        self.rasters.clear();
    }

    fn find_slots(&mut self, items: usize) {
        self.slots.clear();
        self.slots.resize(items, 0);
        (1..)
            .zip(&self.entries)
            .for_each(|(slot, it)| self.slots[it.items.start] = slot);
    }

    /// The items in `changed` were replaced by `count` others. There are `items` now.
    pub fn splice(
        &mut self,
        same: Range<usize>,
        changed: Range<usize>,
        count: usize,
        items: usize,
    ) {
        self.entries.retain_mut(|it| {
            let (is_before, is_after) =
                (it.items.end <= changed.start, it.items.start >= changed.end);
            let is_kept =
                (is_before || is_after) && same.start <= it.items.start && it.items.end <= same.end;
            if is_kept && !is_before {
                it.items =
                    it.items.start + count - changed.len()..it.items.end + count - changed.len();
            }
            is_kept
        });
        self.find_slots(items);
    }

    pub fn begin(&mut self, (cache, draw): (u64, u64), items: usize) {
        if std::mem::replace(&mut self.owner, (cache, draw)) != (cache, draw - 1)
            || self.slots.len() != items
        {
            self.clear();
            self.slots.resize(items, 0);
        }
    }

    /// Calls `keep` with the rasters that were needed since `since`, and forgets about the rest.
    pub fn tidy(&mut self, since: u64, mut keep: impl FnMut(u128, u64)) {
        self.entries.retain(|it| it.last_used >= since);
        let recorded = || {
            self.entries
                .iter()
                .filter_map(|it| Some((it.recorded.as_ref()?, it.last_used)))
        };
        recorded().for_each(|(it, last_used)| {
            self.rasters[it.rasters.clone()]
                .iter()
                .for_each(|key| keep(*key, last_used))
        });
        let [primitives, rasters] = recorded().fold([0; 2], |[a, b], (it, _)| {
            [a + it.primitives.len(), b + it.rasters.len()]
        });
        if self.primitives.len() + self.rasters.len() > (primitives + rasters) * 2 + 256 {
            let (mut primitives, mut rasters) = (
                Vec::with_capacity(primitives * 2),
                Vec::with_capacity(rasters * 2),
            );
            for it in self
                .entries
                .iter_mut()
                .filter_map(|it| it.recorded.as_mut())
            {
                let starts = (primitives.len(), rasters.len());
                primitives.extend_from_slice(&self.primitives[it.primitives.clone()]);
                rasters.extend_from_slice(&self.rasters[it.rasters.clone()]);
                (it.primitives, it.rasters) = (starts.0..primitives.len(), starts.1..rasters.len());
            }
            (self.primitives, self.rasters) = (primitives, rasters);
        }
        self.find_slots(self.slots.len());
    }

    pub fn recall(
        &mut self,
        item: usize,
        matrix: &Transform,
        clip: IntRect,
        is_inside: bool,
        to: &mut Vec<Primitive>,
    ) -> Recall {
        let Some(entry) = self
            .entries
            .get_mut((self.slots[item] as usize).wrapping_sub(1))
        else {
            return Recall::Unknown;
        };
        entry.last_used = self.owner.1;
        let (known, by) = (
            entry.matrix,
            [matrix.tx - entry.matrix.tx, matrix.ty - entry.matrix.ty],
        );
        let (stays, [x, y]) = (by == [0.; 2] && clip == entry.clip, by.map(|it| it as i32));
        let is_whole = by == [x as f32, y as f32] && (matrix.sx, matrix.sy) == (known.sx, known.sy);
        if !is_whole || !(stays || is_inside && entry.is_inside) {
            (entry.matrix, entry.clip, entry.is_inside, entry.recorded) =
                (*matrix, clip, is_inside, None);
            return if is_inside {
                Recall::Unknown
            } else {
                Recall::Moves
            };
        }
        let Some(Recorded {
            first_run,
            primitives,
            rasters,
        }) = entry.recorded.clone()
        else {
            return Recall::Unknown;
        };
        let (first, later) = (to.len(), (to.len() as u32 + 1).wrapping_sub(first_run));
        to.extend_from_slice(&self.primitives[primitives]);
        for it in &mut to[first..] {
            it.run = if it.run == 0 {
                0
            } else {
                it.run.wrapping_add(later)
            };
            if !stays {
                let edge =
                    |own: i32, was: i32, is: i32, by: i32| if own == was { is } else { own + by };
                let (own, was) = (it.clip, entry.clip);
                let (left, right) = (
                    edge(own.left, was.left, clip.left, x),
                    edge(own.right, was.right, clip.right, x),
                );
                let (top, bottom) = (
                    edge(own.top, was.top, clip.top, y),
                    edge(own.bottom, was.bottom, clip.bottom, y),
                );
                it.clip = IntRect::new(left, top, right, bottom).intersect(clip);
                (it.bounds.x, it.bounds.y) = (it.bounds.x + by[0], it.bounds.y + by[1]);
            }
        }
        if self.recording.is_some() {
            self.rasters.extend_from_within(rasters);
        }
        Recall::Done
    }

    /// Unless something around it is recorded.
    pub fn start_recording(&mut self) -> bool {
        let starts = self.recording.is_none();
        if starts {
            (self.recording, self.is_provisional) = (Some(self.rasters.len()), false);
        }
        starts
    }

    pub fn needs(&mut self, raster: u128) {
        if self.recording.is_some() {
            self.rasters.push(raster);
        }
    }

    /// It will be flattened to something else.
    pub fn is_provisional(&mut self) {
        self.is_provisional = true;
    }

    pub fn finish_recording(
        &mut self,
        items: Range<usize>,
        matrix: &Transform,
        clip: IntRect,
        is_inside: bool,
        all: &[Primitive],
        first: usize,
    ) {
        let Some(first_raster) = self.recording.take().filter(|_| !self.is_provisional) else {
            return;
        };
        let start = self.primitives.len();
        self.primitives.extend_from_slice(&all[first..]);
        let recorded = Recorded {
            first_run: first as u32 + 1,
            primitives: start..self.primitives.len(),
            rasters: first_raster..self.rasters.len(),
        };
        let slot = &mut self.slots[items.start];
        let entry = Entry {
            items,
            matrix: *matrix,
            clip,
            is_inside,
            last_used: self.owner.1,
            recorded: Some(recorded),
        };
        match self.entries.get_mut((*slot as usize).wrapping_sub(1)) {
            Some(known) => *known = entry,
            None => {
                self.entries.push(entry);
                *slot = self.entries.len() as u32;
            }
        }
    }
}
