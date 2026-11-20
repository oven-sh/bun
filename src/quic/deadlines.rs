use crate::time::Instant;
use crate::with;

const ABSENT: u32 = u32::MAX;

/// A binary heap with at most one deadline for each key.
#[derive(Default)]
pub(crate) struct Deadlines {
    heap: Vec<(Instant, u32)>,
    /// In `heap`, by key.
    positions: Vec<u32>,
}

impl Deadlines {
    #[inline]
    pub(crate) fn first(&self) -> Option<(Instant, u32)> {
        self.heap.first().copied()
    }

    #[inline]
    pub(crate) fn get(&self, key: u32) -> Instant {
        let position = self.positions.get(key as usize);
        let entry = position.and_then(|&at| self.heap.get(at as usize));
        entry.map_or(Instant::NEVER, |it| it.0)
    }

    pub(crate) fn set(&mut self, key: u32, deadline: Instant) {
        if self.positions.len() <= key as usize {
            self.positions.resize(key as usize + 1, ABSENT);
        }
        let at = self.positions.get(key as usize).copied().unwrap_or(ABSENT);
        if deadline != Instant::NEVER {
            if at == ABSENT {
                self.heap.push((deadline, key));
            }
            let at = (at as usize).min(self.heap.len() - 1);
            return self.place(at, (deadline, key));
        }
        if at != ABSENT {
            self.set_position(key, ABSENT);
            if let Some(last) = self.heap.pop().filter(|it| it.1 != key) {
                self.place(at as usize, last);
            }
        }
    }

    /// Fills the hole at `at`.
    fn place(&mut self, mut at: usize, entry: (Instant, u32)) {
        while at > 0
            && let Some(&parent) = self.heap.get((at - 1) / 2).filter(|it| it.0 > entry.0)
        {
            self.put(at, parent);
            at = (at - 1) / 2;
        }
        while let Some((offset, &child)) = (self.heap.iter().skip(2 * at + 1).take(2).enumerate())
            .min_by_key(|it| it.1.0)
            .filter(|it| it.1.0 < entry.0)
        {
            self.put(at, child);
            at = 2 * at + 1 + offset;
        }
        self.put(at, entry);
    }

    fn put(&mut self, at: usize, entry: (Instant, u32)) {
        with(self.heap.get_mut(at), |it| *it = entry);
        self.set_position(entry.1, at as u32);
    }

    fn set_position(&mut self, key: u32, at: u32) {
        with(self.positions.get_mut(key as usize), |it| *it = at);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::Duration;

    #[test]
    fn earliest_is_first() {
        let (mut deadlines, mut expected) = (Deadlines::default(), [Instant::NEVER; 20]);
        for step in 0..1000 {
            let (key, time) = (step * step % 101 % 20, step * step % 97);
            let deadline = match time % 4 {
                0 => Instant::NEVER,
                _ => Instant::default() + Duration::from_millis(time.into()),
            };
            with(expected.get_mut(key as usize), |it| *it = deadline);
            deadlines.set(key, deadline);
            let first = deadlines.first().map_or(Instant::NEVER, |it| it.0);
            assert_eq!(Some(&first), expected.iter().min());
            assert!((0..20).map(|it| deadlines.get(it)).eq(expected));
        }
    }
}
