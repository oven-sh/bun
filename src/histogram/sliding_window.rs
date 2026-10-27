//! The values of the last while, or the last so many values.
//! - https://github.com/nodejs/node/blob/v26.12.1/src/histogram.cc#L2345

use crate::Histogram;

/// When the values start to go to the next part of the window. Neither number is 0.
#[derive(Clone, Copy)]
pub enum Rotation {
    EveryNanoseconds(u64),
    EveryRecords(u64),
}

/// A ring of histograms, each with the values of one part of the window. A part is dropped as a whole, when the ring has
/// come around to it. Nothing happens in between: the time is only looked at when a value is recorded or read.
pub struct SlidingWindow {
    empty: Histogram,
    /// Each with which part it has the values of, counting from the start. That is checked before it is read, so a part
    /// that is out of date needs no reset.
    parts: Vec<Option<(u64, Histogram)>>,
    rotation: Rotation,
    /// When the first part started.
    origin_ns: u64,
    /// The part that the last value went to, and how many did. Only if the parts are counted in records.
    current_part: u64,
    records_in_current_part: u64,
}

impl SlidingWindow {
    /// `empty` has the range and the precision of the window, and `parts` is not 0.
    pub fn new(empty: Histogram, parts: usize, rotation: Rotation, now_ns: u64) -> Self {
        Self {
            empty,
            parts: vec![None; parts],
            rotation,
            origin_ns: now_ns,
            current_part: 0,
            records_in_current_part: 0,
        }
    }

    fn part_at(&self, now_ns: u64) -> u64 {
        match self.rotation {
            Rotation::EveryNanoseconds(duration) => {
                now_ns.saturating_sub(self.origin_ns) / duration
            }
            Rotation::EveryRecords(_) => self.current_part,
        }
    }

    pub fn record(&mut self, value: u64, now_ns: u64) {
        if let Rotation::EveryRecords(records) = self.rotation {
            if self.records_in_current_part == records {
                self.current_part += 1;
                self.records_in_current_part = 0;
            }
            self.records_in_current_part += 1;
        }
        let part = self.part_at(now_ns);
        let index = (part % self.parts.len() as u64) as usize;
        let Some(slot) = self.parts.get_mut(index) else {
            return;
        };
        match slot {
            Some((of, histogram)) if *of == part => _ = histogram.record(value),
            _ => {
                let mut histogram = self.empty.clone();
                histogram.record(value);
                *slot = Some((part, histogram));
            }
        }
    }

    /// Everything in the window.
    pub fn snapshot(&self, now_ns: u64) -> Histogram {
        let current = self.part_at(now_ns);
        let mut snapshot = self.empty.clone();
        for (part, histogram) in self.parts.iter().flatten() {
            if current
                .checked_sub(*part)
                .is_some_and(|age| age < self.parts.len() as u64)
            {
                snapshot.add(histogram);
            }
        }
        snapshot
    }

    pub fn reset(&mut self, now_ns: u64) {
        self.parts.fill(None);
        self.origin_ns = now_ns;
        self.current_part = 0;
        self.records_in_current_part = 0;
    }

    /// The bytes this window occupies. Recording a value can change it.
    pub fn memory_size(&self) -> usize {
        let parts = self
            .parts
            .iter()
            .flatten()
            .map(|(_, histogram)| histogram.memory_size());
        size_of::<Self>()
            + self.parts.capacity() * size_of::<Option<(u64, Histogram)>>()
            + parts.sum::<usize>()
    }
}
