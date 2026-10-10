//! The order in which a hash table of oxlint is iterated.

use rustc_hash::FxHasher;
use std::hash::Hasher;

/// What `FxHasher` makes of a string.
pub(crate) fn hash_of_str(text: &[u8]) -> u64 {
    let mut hasher = FxHasher::default();
    hasher.write(text);
    hasher.write_u8(0xFF);
    hasher.finish()
}

/// `capacity_to_buckets`
fn buckets_for(capacity: usize) -> usize {
    match capacity {
        0..=3 => 4,
        4..=7 => 8,
        wanted => (wanted * 8 / 7).next_power_of_two(),
    }
}

/// A table of the crate `hashbrown`, as far as it takes to know in which order it is iterated. Some rules of oxlint report the first
/// of what they find in such a table, or print the names in it. The order follows from the hashes and from the order in which
/// they are inserted. The groups are of 16, as on x86-64.
pub struct HashOrder<T> {
    /// Each with its hash.
    buckets: Vec<Option<(u64, T)>>,
    len: usize,
}

impl<T: Copy> HashOrder<T> {
    pub fn new() -> Self {
        HashOrder {
            buckets: Vec::new(),
            len: 0,
        }
    }

    /// `with_capacity`, which is also what `collect` makes.
    pub(crate) fn with_capacity(capacity: usize) -> Self {
        HashOrder {
            buckets: vec![None; buckets_for(capacity)],
            len: 0,
        }
    }

    /// `RawTableInner::find_insert_slot`
    fn find_insert_slot(buckets: &[Option<(u64, T)>], hash: u64) -> Option<usize> {
        const WIDTH: usize = 16;
        let mask = buckets.len().checked_sub(1)?;
        let is_empty = |i: usize| buckets.get(i).is_some_and(Option::is_none);
        let (mut pos, mut stride) = ((hash & (mask as u64)) as usize, 0);
        while stride <= buckets.len() {
            // After the control bytes of a table that is smaller than a group there are empty ones, up to the width of a group. Then
            // the first are repeated, as after those of every table.
            let found = (pos..pos + WIDTH).find(|&i| match buckets.len() < WIDTH {
                true => (buckets.len()..WIDTH).contains(&i) || is_empty(i % WIDTH),
                false => is_empty(i & mask),
            });
            if let Some(found) = found.map(|i| i & mask) {
                return if is_empty(found) {
                    Some(found)
                } else {
                    (0..buckets.len()).find(|&i| is_empty(i))
                };
            }
            stride += WIDTH;
            pos = (pos + stride) & mask;
        }
        None
    }

    fn place(buckets: &mut [Option<(u64, T)>], hash: u64, item: T) {
        if let Some(bucket) =
            HashOrder::find_insert_slot(buckets, hash).and_then(|at| buckets.get_mut(at))
        {
            *bucket = Some((hash, item));
        }
    }

    /// `item` has to be new.
    pub fn insert(&mut self, hash: u64, item: T) {
        let capacity = match self.buckets.len() {
            0 => 0,
            buckets @ 1..=8 => buckets - 1,
            buckets => buckets / 8 * 7,
        };
        if self.len >= capacity {
            let mut grown = vec![None; buckets_for(capacity + 1)];
            self.buckets
                .iter()
                .flatten()
                .for_each(|it| HashOrder::place(&mut grown, it.0, it.1));
            self.buckets = grown;
        }
        HashOrder::place(&mut self.buckets, hash, item);
        self.len += 1;
    }

    pub fn iter(&self) -> impl Iterator<Item = T> {
        self.buckets.iter().flatten().map(|it| it.1)
    }
}
