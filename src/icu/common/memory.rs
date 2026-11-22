//! Fallible allocation. A failure also sets a thread-local flag, which the exported function takes. README.md has the rules.

use crate::common::utypes::{U_ILLEGAL_ARGUMENT_ERROR, U_MEMORY_ALLOCATION_ERROR, UErrorCode};
use bun_collections::hashbrown::{HashMap, HashSet};
use std::collections::BinaryHeap;
use std::ffi::CString;
use std::hash::{BuildHasher, Hash};
use std::mem::MaybeUninit;
use std::ops::Range;
use std::sync::atomic::{AtomicU32, Ordering::Relaxed};
use std::sync::{Arc, OnceLock};

#[repr(align(128))]
struct CachePadded(AtomicU32);

/// The number of flags that are set. `Relaxed` suffices: a thread needs to see only its own increments.
static OOM_COUNT: CachePadded = CachePadded(AtomicU32::new(0));

thread_local! {
    static OOM_FLAG: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Sets the flag and returns `U_MEMORY_ALLOCATION_ERROR`.
#[cold]
pub(crate) fn set_oom<E>(_: E) -> UErrorCode {
    set_oom_flag();
    U_MEMORY_ALLOCATION_ERROR
}

#[cold]
#[inline(never)]
fn set_oom_flag() {
    let was_set = OOM_FLAG.replace(true);
    OOM_COUNT.0.fetch_add(u32::from(!was_set), Relaxed);
}

/// Returns false if no thread has a flag set.
#[inline(always)]
pub(crate) fn any_oom() -> bool {
    OOM_COUNT.0.load(Relaxed) != 0
}

#[cold]
#[inline(never)]
fn take_oom_flag() -> bool {
    let was_set = OOM_FLAG.replace(false);
    if was_set {
        OOM_COUNT.0.fetch_sub(1, Relaxed);
    }
    was_set
}

#[cold]
#[inline(never)]
fn oom_flag() -> bool {
    OOM_FLAG.get()
}

/// Clears the flag. Returns whether an allocation has failed.
#[inline(always)]
pub(crate) fn take_oom() -> bool {
    any_oom() && take_oom_flag()
}

/// Runs the work of a C entry point. Returns its result, and whether an allocation has failed in it.
#[inline(always)]
pub(crate) fn catch_oom_at_entry<T>(f: impl FnOnce() -> T) -> (T, bool) {
    debug_assert!(!is_oom());
    let result = f();
    (result, take_oom())
}

/// Returns whether an allocation of the current call has failed.
#[inline]
pub(crate) fn is_oom() -> bool {
    any_oom() && oom_flag()
}

/// Returns `U_MEMORY_ALLOCATION_ERROR` if the flag is set. Perf: a call of `oom_flag` would spill registers.
#[inline(always)]
pub(crate) fn check_oom() -> Result<(), UErrorCode> {
    if any_oom() && OOM_FLAG.get() {
        Err(U_MEMORY_ALLOCATION_ERROR)
    } else {
        Ok(())
    }
}

/// Runs `f`. Returns `U_MEMORY_ALLOCATION_ERROR` instead of the result if the flag is set afterwards.
pub(crate) fn fail_on_oom<T, E: From<UErrorCode>>(
    f: impl FnOnce() -> Result<T, E>,
) -> Result<T, E> {
    let result = f();
    if is_oom() {
        Err(U_MEMORY_ALLOCATION_ERROR.into())
    } else {
        result
    }
}

/// Returns `value`, or `U_MEMORY_ALLOCATION_ERROR` if the flag is set.
#[inline]
pub(crate) fn oom_checked<T>(value: T) -> Result<T, UErrorCode> {
    if is_oom() {
        Err(U_MEMORY_ALLOCATION_ERROR)
    } else {
        Ok(value)
    }
}

/// `cell.get_or_try_init(init)`. Stores nothing if the flag is set. Racing threads may each run `init`.
pub(crate) fn get_or_try_init<T>(
    cell: &OnceLock<T>,
    init: impl FnOnce() -> Result<T, UErrorCode>,
) -> Result<&T, UErrorCode> {
    match cell.get() {
        Some(value) => Ok(value),
        None => fail_on_oom(init).map(|value| cell.get_or_init(|| value)),
    }
}

/// Runs `f` unless the flag is set. Returns `None` on any failure, and leaves the flag unchanged.
#[must_use]
pub(crate) fn best_effort<T>(f: impl FnOnce() -> Result<T, UErrorCode>) -> Option<T> {
    check_oom().ok()?;
    let result = f();
    let was_oom = take_oom();
    result.ok().filter(|_| !was_oom)
}

/// Drops an allocation error. The C entry point still reports it, because the flag is set.
#[must_use]
pub(crate) fn defer_oom<T>(result: Result<T, UErrorCode>) -> Option<T> {
    debug_assert!(!matches!(result, Err(code) if code != U_MEMORY_ALLOCATION_ERROR));
    result.ok()
}

/// `Vec::with_capacity(count)`
pub(crate) fn try_with_capacity<T>(count: usize) -> Result<Vec<T>, UErrorCode> {
    let mut vec = Vec::new();
    check_oom()?;
    vec.try_reserve_exact(count).map_err(set_oom)?;
    Ok(vec)
}

#[cold]
#[inline(never)]
fn grow<T>(vec: &mut Vec<T>, additional: usize) -> Result<(), UErrorCode> {
    check_oom()?;
    vec.try_reserve(additional).map_err(set_oom)
}

/// Appends `slice` if it fits, and returns whether it does.
#[inline(always)]
fn extend_within_capacity<T: Copy>(vec: &mut Vec<T>, slice: &[T]) -> bool {
    let fits = slice.len() <= vec.capacity() - vec.len();
    if fits {
        vec.extend_from_slice(slice);
    }
    fits
}

/// `slice.to_vec()`
#[inline(never)]
pub(crate) fn try_to_vec<T: Copy>(slice: &[T]) -> Result<Vec<T>, UErrorCode> {
    let mut copy = try_with_capacity(slice.len())?;
    extend_within_capacity(&mut copy, slice);
    Ok(copy)
}

/// `parts.concat()`
pub(crate) fn try_concat<T: Copy>(parts: &[&[T]]) -> Result<Vec<T>, UErrorCode> {
    let mut vec = try_with_capacity(
        parts
            .iter()
            .fold(0, |sum: usize, part| sum.saturating_add(part.len())),
    )?;
    parts
        .iter()
        .for_each(|part| _ = extend_within_capacity(&mut vec, part));
    Ok(vec)
}

/// `vec![value; count]`
pub(crate) fn try_filled<T: Copy>(value: T, count: usize) -> Result<Vec<T>, UErrorCode> {
    let mut vec = try_with_capacity(count)?;
    vec.resize_with(count, || value);
    Ok(vec)
}

/// `slice.copy_within(source, to)`, or `None`. The ranges begin or end with `part`, so that the compiler removes std's checks.
#[inline]
pub(crate) fn checked_copy_within<T: Copy>(
    slice: &mut [T],
    source: Range<usize>,
    to: usize,
) -> Option<()> {
    let count = source.end.wrapping_sub(source.start);
    if to <= source.start {
        slice
            .get_mut(to..source.end)
            .map(|part| part.copy_within(part.len().saturating_sub(count).., 0))
    } else {
        slice
            .get_mut(source.start..to.wrapping_add(count))
            .map(|part| {
                let shift = part.len().saturating_sub(count);
                part.copy_within(..part.len() - shift, shift);
            })
    }
}

/// `vec.push(value)`
#[inline]
pub(crate) fn try_push<T>(vec: &mut Vec<T>, value: T) -> Result<(), UErrorCode> {
    vec.reserve_append(1)?;
    vec.push(value);
    Ok(())
}

/// `vec.insert(index, value)`. `index` is clamped to the length.
pub(crate) fn try_insert<T>(vec: &mut Vec<T>, index: usize, value: T) -> Result<(), UErrorCode> {
    vec.reserve_append(1)?;
    vec.insert(index.min(vec.len()), value);
    Ok(())
}

/// `vec.extend_from_slice(slice)`
#[inline(never)]
pub(crate) fn try_extend_from_slice<T: Copy>(
    vec: &mut Vec<T>,
    slice: &[T],
) -> Result<(), UErrorCode> {
    if extend_within_capacity(vec, slice) {
        Ok(())
    } else {
        grow_and_extend(vec, slice)
    }
}

#[cold]
#[inline(never)]
fn grow_and_extend<T: Copy>(vec: &mut Vec<T>, slice: &[T]) -> Result<(), UErrorCode> {
    grow(vec, slice.len()).map(|()| _ = extend_within_capacity(vec, slice))
}

/// `vec.resize(length, value)`
pub(crate) fn try_resize<T: Copy>(
    vec: &mut Vec<T>,
    length: usize,
    value: T,
) -> Result<(), UErrorCode> {
    vec.reserve_append(length.saturating_sub(vec.len()))?;
    vec.resize_with(length, || value);
    Ok(())
}

/// `vec.splice(start..limit, replacement.iter().copied())`. The range is clamped to the length.
pub(crate) fn try_splice<T: Copy>(
    vec: &mut Vec<T>,
    start: usize,
    limit: usize,
    replacement: &[T],
) -> Result<(), UErrorCode> {
    let length = vec.len();
    let start = start.min(length);
    let limit = limit.clamp(start, length);
    // Grows `vec` to the new length. The appended elements are overwritten.
    try_extend_from_slice(vec, replacement.get(limit - start..).unwrap_or_default())?;
    let moved = checked_copy_within(vec, limit..length, start + replacement.len());
    debug_assert!(moved.is_some());
    vec.truncate(start + replacement.len() + (length - limit));
    let gap = vec.get_mut(start..).unwrap_or_default();
    let fits = replacement.len().min(gap.len());
    gap.split_at_mut(fits)
        .0
        .copy_from_slice(replacement.split_at(fits).0);
    Ok(())
}

/// `vec.extend(items)`
pub(crate) fn try_extend<T>(
    vec: &mut Vec<T>,
    items: impl IntoIterator<Item = T>,
) -> Result<(), UErrorCode> {
    let items = items.into_iter();
    let (lower, upper) = items.size_hint();
    vec.reserve_append(lower)?;
    if upper == Some(lower) {
        // `take` guards against a wrong size hint. Perf: ten times as fast as pushing.
        vec.extend(items.take(lower));
        return Ok(());
    }
    for item in items {
        try_push(vec, item)?;
    }
    Ok(())
}

/// `vec.reserve_exact(additional)`
pub(crate) fn reserve_append_exact<T>(
    vec: &mut Vec<T>,
    additional: usize,
) -> Result<(), UErrorCode> {
    if additional > vec.capacity() - vec.len() {
        check_oom()?;
        vec.try_reserve_exact(additional).map_err(set_oom)?;
    }
    Ok(())
}

/// An append-only sink. If allocation fails the elements are dropped and the flag is set. ICU4C: appendable.h
pub(crate) trait Appendable<T> {
    /// `Vec::reserve`
    fn reserve_append(&mut self, _additional: usize) -> Result<(), UErrorCode> {
        Ok(())
    }

    fn add(&mut self, value: T);

    fn add_all(&mut self, slice: &[T])
    where
        T: Copy;

    fn add_each(&mut self, items: impl IntoIterator<Item = T>)
    where
        Self: Sized,
    {
        items.into_iter().for_each(|item| self.add(item));
    }
}

impl<T> Appendable<T> for Vec<T> {
    #[inline]
    fn reserve_append(&mut self, additional: usize) -> Result<(), UErrorCode> {
        // Runs at most once. The loop condition lets the optimizer remove std's growth path from the caller.
        while additional > self.capacity() - self.len() {
            grow(self, additional)?;
        }
        Ok(())
    }

    #[inline]
    fn add(&mut self, value: T) {
        if self.len() == self.capacity() {
            grow_and_push(self, value)
        } else {
            self.push(value)
        }
    }

    #[inline]
    fn add_all(&mut self, slice: &[T])
    where
        T: Copy,
    {
        _ = try_extend_from_slice(self, slice);
    }

    fn add_each(&mut self, items: impl IntoIterator<Item = T>) {
        _ = try_extend(self, items);
    }
}

#[cold]
#[inline(never)]
fn grow_and_push<T>(vec: &mut Vec<T>, value: T) {
    _ = try_push(vec, value);
}

/// `items.collect::<Vec<_>>()`
pub(crate) fn try_collect<T>(items: impl IntoIterator<Item = T>) -> Result<Vec<T>, UErrorCode> {
    let mut vec = Vec::new();
    try_extend(&mut vec, items)?;
    Ok(vec)
}

/// `items.collect::<Result<Vec<_>, _>>()`
pub(crate) fn try_collect_results<T>(
    items: impl IntoIterator<Item = Result<T, UErrorCode>>,
) -> Result<Vec<T>, UErrorCode> {
    let mut vec = Vec::new();
    for item in items {
        try_push(&mut vec, item?)?;
    }
    Ok(vec)
}

/// `CString::new(bytes)`. Returns `U_ILLEGAL_ARGUMENT_ERROR` if `bytes` contains a NUL.
pub(crate) fn try_cstring(bytes: &[u8]) -> Result<CString, UErrorCode> {
    // The capacity is exact, so std does not shrink.
    let mut exact = try_with_capacity(bytes.len() + 1)?;
    extend_within_capacity(&mut exact, bytes);
    exact.push(0);
    CString::from_vec_with_nul(exact).or(Err(U_ILLEGAL_ARGUMENT_ERROR))
}

/// `Box::new(value)`
pub(crate) fn try_box<T>(value: T) -> Result<Box<T>, UErrorCode> {
    Ok(Box::write(try_box_uninit()?, value))
}

/// `vec![0; count]`
pub(crate) fn try_zeroed(count: usize) -> Result<Vec<u16>, UErrorCode> {
    check_oom()?;
    bun_core::vec::try_zeroed(count).map_err(set_oom)
}

/// `Box::new_uninit()`. `Box::write(try_box_uninit()?, value)` saves a copy of the value on the stack.
pub(crate) fn try_box_uninit<T>() -> Result<Box<MaybeUninit<T>>, UErrorCode> {
    check_oom()?;
    Box::try_new_uninit().map_err(set_oom)
}

/// `try_box(result?)` for large values: one copy in the caller's frame, not three. On success `result` is an `Err`.
#[inline(never)]
pub(crate) fn try_box_result<T, H: From<T>>(
    result: &mut Result<T, UErrorCode>,
) -> Result<Box<H>, UErrorCode> {
    if let Err(code) = result {
        return Err(*code);
    }
    let uninit = try_box_uninit()?;
    std::mem::replace(result, Err(U_MEMORY_ALLOCATION_ERROR))
        .map(|value| Box::write(uninit, H::from(value)))
}

/// `try_shared(result?)` for large values.
#[inline(never)]
pub(crate) fn try_shared_result<T>(
    result: &mut Result<T, UErrorCode>,
) -> Result<Arc<T>, UErrorCode> {
    try_shared(std::mem::replace(result, Err(U_MEMORY_ALLOCATION_ERROR))?)
}

/// `Arc::new(value)`
pub(crate) fn try_shared<T>(value: T) -> Result<Arc<T>, UErrorCode> {
    check_oom()?;
    Arc::try_new(value).map_err(set_oom)
}

/// `Arc::make_mut(this)`
pub(crate) fn try_make_mut<T: TryClone>(this: &mut Arc<T>) -> Result<&mut T, UErrorCode> {
    if !Arc::is_unique(this) {
        *this = try_shared((**this).try_clone()?)?;
    }
    // Never fails: `this` is unique now.
    Arc::get_mut(this).ok_or(U_MEMORY_ALLOCATION_ERROR)
}

/// Fallible `Clone`.
pub(crate) trait TryClone: Sized {
    fn try_clone(&self) -> Result<Self, UErrorCode>;
}

impl TryClone for Vec<u16> {
    fn try_clone(&self) -> Result<Self, UErrorCode> {
        try_to_vec(self)
    }
}

/// `map.insert(key, value)`
pub(crate) fn try_map_insert<K: Eq + Hash, V, S: BuildHasher>(
    map: &mut HashMap<K, V, S>,
    key: K,
    value: V,
) -> Result<Option<V>, UErrorCode> {
    try_map_reserve(map, 1)?;
    Ok(insert_within_capacity(map, key, value))
}

/// `map.insert(key, value)` after `try_map_reserve`. Out of line, so that `insert` is inlined here and loses its growth path.
#[inline(never)]
pub(crate) fn insert_within_capacity<K: Eq + Hash, V, S: BuildHasher>(
    map: &mut HashMap<K, V, S>,
    key: K,
    value: V,
) -> Option<V> {
    let spare = map.capacity() - map.len();
    debug_assert!(spare != 0);
    (spare != 0).then(|| map.insert(key, value)).flatten()
}

/// `map.reserve(additional)`
pub(crate) fn try_map_reserve<K: Eq + Hash, V, S: BuildHasher>(
    map: &mut HashMap<K, V, S>,
    additional: usize,
) -> Result<(), UErrorCode> {
    check_oom()?;
    map.try_reserve(additional).map_err(set_oom)
}

/// `set.insert(value)`
pub(crate) fn try_set_insert<T: Eq + Hash, S: BuildHasher>(
    set: &mut HashSet<T, S>,
    value: T,
) -> Result<bool, UErrorCode> {
    check_oom()?;
    // Runs at most once, as in `reserve_append`.
    while set.capacity() - set.len() == 0 {
        set.try_reserve(1).map_err(set_oom)?;
    }
    Ok(set.insert(value))
}

/// `heap.push(value)`
pub(crate) fn try_heap_push<T: Ord>(heap: &mut BinaryHeap<T>, value: T) -> Result<(), UErrorCode> {
    // Runs at most once, as in `reserve_append`.
    while heap.len() == heap.capacity() {
        check_oom().and_then(|()| heap.try_reserve(1).map_err(set_oom))?;
    }
    heap.push(value);
    Ok(())
}
