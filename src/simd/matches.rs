//! The matches of LZ77.

use crate::{Aligned, B16, B32, Isa, Lane, Output, Room};

/// For each period up to 16 bytes at the end of a block: where each of 32 bytes is, and how many are whole periods.
static PERIODS: (Aligned<[[[u8; 16]; 2]; 17]>, [u8; 17]) = {
    let (mut all, mut i) = (([[[0; 16]; 2]; 17], [0; 17]), 32);
    while i < 17 * 32 {
        let (period, at) = (i / 32, i % 32);
        all.0[period][at / 16][at % 16] = (16 - period + at % period) as u8;
        all.1[period] = (32 - 32 % period) as u8;
        i += 1;
    }
    (Aligned(all.0), all.1)
};

impl<T: Lane> Room<'_, '_, T> {
    /// As [that of `Output`](Output::extend_from_back). It counts `n` values and 32 bytes.
    #[op]
    #[must_use = "it can fail"]
    pub fn extend_from_back<S: Isa>(&mut self, distance: usize, n: usize) -> Option<()>
    where
        crate::Code: crate::At<S>,
    {
        if distance.wrapping_sub(1) >= self.len() {
            return None;
        }
        if let Some(mut room) = self.take_after(n.checked_add(32 / size_of::<T>())?) {
            room.with_room(S::here(), distance, n);
            return Some(());
        }
        Output::extend_from_back(self, distance, n)
    }
}

impl<T: Lane> Output<'_, T> {
    /// Adds `n` values, each a copy of the one `distance` before it: a match of LZ77, which can reach into itself. It adds nothing if
    /// `distance` is zero or too long, or if there is no room. It is fastest with room for 32 bytes more.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut all = b"xab".to_vec();
    /// Output::resume(&mut all, 2, 5).extend_from_back(2, 5).unwrap();
    /// assert_eq!(all, b"xabababa");
    /// # } example()
    /// ```
    #[doc(alias("copy_match", "extend_from_within", "repeat", "lz77"))]
    #[op]
    #[must_use = "it can fail"]
    pub fn extend_from_back<S: Isa>(&mut self, distance: usize, n: usize) -> Option<()>
    where
        crate::Code: crate::At<S>,
    {
        let lanes = 32 / size_of::<T>();
        if distance.wrapping_sub(1) >= self.len() {
            return None;
        }
        if self.fits(n, lanes) {
            self.with_room(S::here(), distance, n);
            return Some(());
        }
        if !self.fits(n, 0) {
            return None;
        }
        // By value, so that `self` can stay in registers.
        let mut all = self.again();
        *all = core::mem::replace(&mut *all, Output::new(&mut [])).near_the_end(distance, n);
        Some(())
    }
    #[cold]
    #[inline(never)]
    fn near_the_end(mut self, distance: usize, n: usize) -> Self {
        let most = self.room().saturating_sub(32 / size_of::<T>());
        if most > 0 {
            self.with_room(crate::baseline(), distance, most);
        }
        for _ in most..n {
            self.push_one(self.filled()[self.len() - distance]);
        }
        self
    }
    #[op]
    fn with_room<S: Isa>(&mut self, s: S, distance: usize, n: usize) {
        let (size, lanes) = (size_of::<T>(), 32 / size_of::<T>());
        if distance >= n.min(lanes) {
            // AArch64 has pairs of loads and stores.
            let halves = crate::X86 && S::REGISTER < 32;
            return match size {
                1 => self.copy_back::<32>(distance, n, halves),
                2 => self.copy_back::<16>(distance, n, halves),
                4 => self.copy_back::<8>(distance, n, halves),
                _ => self.copy_back::<4>(distance, n, halves),
            };
        }
        let (d, half, filled, bytes) = (s.fixed::<T, B32>(), s.fixed::<T, B16>(), self.filled(), distance * size);
        let indices = always!(|it: [u8; 16]| s.fixed::<u8, B16>().from_array(it));
        let (chunk, step) = if distance == 1 {
            // One value comes from one store, and so without delay.
            (d.set(filled[filled.len() - 1]), lanes)
        } else if let Some(&[lower, upper]) = PERIODS.0.get(bytes) {
            let last = if filled.len() >= lanes / 2 {
                half.load_last(filled)
            } else {
                core::hint::cold_path();
                half.load_n(filled).rotate_elements_left_dyn(filled.len())
            };
            (
                d.combine(last.move_lanes(indices(upper)), last.move_lanes(indices(lower))),
                PERIODS.1[bytes] as usize / size,
            )
        } else {
            let period = &filled[filled.len() - 1 - (distance - 1)..][..distance];
            (d.combine(half.load_last(period).rotate_elements_left_dyn(lanes - distance), half.load(period)), distance)
        };
        if n > 3 * lanes {
            crate::output::ahead(filled.as_ptr_range().end.cast());
        }
        let mut part = self.window(n + lanes);
        loop {
            part.push_first(chunk, step);
            if part.len() >= n {
                break;
            }
        }
        part.truncate(n);
    }
}
