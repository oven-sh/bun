use bun_engine_text::AllocError;

const BUCKETS: usize = 256;
const DIGITS: usize = size_of::<u64>();
/// Below this, comparing takes less time than counting.
const MIN_LENGTH: usize = 400;

/// From the least significant byte up, which keeps the order of items with equal keys.
#[inline(always)]
fn radix_sort<T: Copy>(items: &mut [T], key: impl Fn(T) -> u64) -> Result<(), AllocError> {
    let mut scratch = Vec::new();
    (scratch.try_reserve_exact(items.len())).map_err(|_| AllocError)?;
    scratch.extend_from_slice(items);
    let mut counts = [[0u32; BUCKETS]; DIGITS];
    for &item in &*items {
        for (counts, digit) in counts.iter_mut().zip(key(item).to_le_bytes()) {
            counts[usize::from(digit)] += 1;
        }
    }
    let (first, length) = (key(items[0]).to_le_bytes(), items.len());
    let (mut from, mut to, mut is_in_scratch) = (&mut *items, &mut *scratch, false);
    for (position, next) in counts.iter_mut().enumerate() {
        if next[usize::from(first[position])] as usize == length {
            continue;
        }
        let mut total = 0;
        for count in &mut *next {
            total += core::mem::replace(count, total);
        }
        for &item in &*from {
            let next = &mut next[usize::from((key(item) >> (position * 8)) as u8)];
            to[*next as usize] = item;
            *next += 1;
        }
        core::mem::swap(&mut from, &mut to);
        is_in_scratch = !is_in_scratch;
    }
    if is_in_scratch {
        to.copy_from_slice(from);
    }
    Ok(())
}

/// There are fewer than 2^32 items. Their order is that of their keys, and those with equal keys are in order already.
#[inline(always)]
pub(super) fn sort<T: Copy + Ord>(items: &mut [T], key: impl Fn(T) -> u64) {
    let has_long_run = || {
        let (start, is_descending) = (&items[..MIN_LENGTH / 8], items[1] < items[0]);
        start.is_sorted_by(|a, b| (b < a) == is_descending)
    };
    if items.len() < MIN_LENGTH || has_long_run() || radix_sort(items, key).is_err() {
        items.sort_unstable();
    }
}
