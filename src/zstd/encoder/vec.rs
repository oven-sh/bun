//! Allocations that may be refused.

use bun_pod::Zeroable;
use bun_zstd_decoder::{Error, Result};

use crate::bytes::put;

pub(crate) fn with_room<T>(capacity: usize) -> Result<Vec<T>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(capacity)?;
    Ok(vec)
}

pub(crate) fn zeroed<T: Zeroable>(len: usize) -> Result<Vec<T>> {
    bun_pod::try_zeroed_vec(len).ok_or(Error::MemoryAllocation)
}

/// Replaces what is at `position`, and appends the rest, for which there is room.
pub(crate) fn write_at(vec: &mut Vec<u8>, position: usize, mut bytes: &[u8]) {
    if let Some(used @ [_, ..]) = vec.get_mut(position..) {
        let replacing = bytes.split_off(..bytes.len().min(used.len()));
        put(used, replacing.unwrap_or_default());
    }
    if !bytes.is_empty() {
        vec.extend_from_slice(bytes);
    }
}

pub(crate) fn copied<T: Copy>(from: &[T]) -> Result<Vec<T>> {
    let mut vec = with_room(from.len())?;
    vec.extend_from_slice(from);
    Ok(vec)
}

pub(crate) fn make_room<T>(vec: &mut Vec<T>, capacity: usize) -> Result<()> {
    Ok(vec.try_reserve_exact(capacity.saturating_sub(vec.len()))?)
}

/// Empties `vec`, and makes room for `capacity` elements.
pub(crate) fn clear_for<T>(vec: &mut Vec<T>, capacity: usize) -> Result<()> {
    vec.clear();
    make_room(vec, capacity)
}

pub(crate) type Shared<T> = std::sync::Arc<T>;

pub(crate) fn shared<T>(value: T) -> Result<Shared<T>> {
    Shared::try_new(value).map_err(|_| Error::MemoryAllocation)
}
