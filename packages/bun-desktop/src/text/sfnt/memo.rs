//! The last answers of searches in tables, which never move.

use std::cell::Cell;

use super::Data;

const SLOTS: usize = 1 << 14;

thread_local! {
    // SAFETY: integers can be zero.
    static KNOWN: Box<[Cell<(usize, u32, u32)>; SLOTS]> = unsafe { Box::new_zeroed().assume_init() };
}

/// `kind` tells searches apart, as one table may be taken for another.
#[inline]
pub fn remembered(
    kind: u32,
    table: Data,
    key: u32,
    find: impl FnOnce() -> Option<u32>,
) -> Option<u32> {
    let (address, key) = (
        table.0.as_ptr().addr() ^ table.0.len() << 40,
        key ^ kind << 30,
    );
    KNOWN.with(|known| {
        let slot = &known[(address.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 40)
            .wrapping_add(key as usize)
            % SLOTS];
        let (for_address, for_key, mut value) = slot.get();
        if (for_address, for_key) != (address, key) {
            value = find().unwrap_or(u32::MAX);
            slot.set((address, key, value));
        }
        Some(value).filter(|it| *it != u32::MAX)
    })
}
