#![forbid(unsafe_code)]
//! Managed `ArrayList` wrappers.

use core::mem;

use bun_alloc::AllocError;

use super::vec_ext::VecExt;

/// Managed `ArrayList` using the default allocator. No overhead compared to an unmanaged
/// `ArrayList`.
pub type ArrayListDefault<T> = ArrayListAlignedIn<T>;

/// Managed `ArrayList` wrapper around `Vec<T>`.
///
/// NOTE: dropping this type runs `Drop` on each of the items.
#[derive(Default)]
pub struct ArrayListAlignedIn<T> {
    unmanaged: Unmanaged<T>,
}

pub(crate) type Unmanaged<T> = Vec<T>;

type Slice<T> = Box<[T]>;

impl<T> ArrayListAlignedIn<T> {
    pub fn items(&self) -> &[T] {
        self.unmanaged.as_slice()
    }

    pub fn items_mut(&mut self) -> &mut [T] {
        self.unmanaged.as_mut_slice()
    }

    pub fn capacity(&self) -> usize {
        self.unmanaged.capacity()
    }

    pub fn init() -> Self {
        Self::init_in()
    }

    pub fn init_in(/* allocator dropped */) -> Self {
        Self {
            unmanaged: Vec::new(),
        }
    }

    pub fn init_capacity(num: usize) -> Result<Self, AllocError> {
        Self::init_capacity_in(num)
    }

    pub fn init_capacity_in(num: usize /* allocator dropped */) -> Result<Self, AllocError> {
        // Vec::with_capacity aborts on OOM rather than returning Err. Could swap to
        // `Vec::try_with_capacity` (nightly) or a fallible wrapper if OOM recovery matters.
        Ok(Self {
            unmanaged: Vec::with_capacity(num),
        })
    }

    pub fn from_owned_slice(slice: Slice<T>) -> Self {
        Self {
            unmanaged: Vec::from(slice),
        }
    }

    // Sentinel-terminated owned slices are not a Rust type, so this takes a `Box<[T]>` with
    // the sentinel already stripped.
    pub fn from_owned_slice_sentinel(/* sentinel: T, */ slice: Slice<T>) -> Self {
        Self {
            unmanaged: Vec::from(slice),
        }
    }

    /// This method empties `self`.
    pub fn move_to_unmanaged(&mut self) -> Unmanaged<T> {
        mem::take(&mut self.unmanaged)
    }

    /// Unlike `move_to_unmanaged`, this method *consumes* `self`.
    pub fn into_unmanaged_with_allocator(self) -> (Unmanaged<T>, ()) {
        (self.unmanaged, ())
    }

    /// The contents of `unmanaged` must have been allocated by the global allocator.
    /// This function takes ownership of `unmanaged`.
    pub fn from_unmanaged(unmanaged: Unmanaged<T>) -> Self {
        Self { unmanaged }
    }

    pub fn to_owned_slice(self) -> Result<Slice<T>, AllocError> {
        Ok(self.unmanaged.into_boxed_slice())
    }

    /// Creates a copy of this `ArrayList` with copies of its items.
    pub fn clone(&self) -> Result<Self, AllocError>
    where
        T: Clone,
    {
        self.clone_in()
    }

    /// Creates a copy of this `ArrayList` with copies of its items.
    pub fn clone_in(&self /* allocator dropped */) -> Result<Self, AllocError>
    where
        T: Clone,
    {
        Ok(Self {
            unmanaged: self.unmanaged.clone(),
        })
    }

    pub fn insert(&mut self, i: usize, item: T) -> Result<(), AllocError> {
        self.unmanaged.insert(i, item);
        Ok(())
    }

    pub fn insert_assume_capacity(&mut self, i: usize, item: T) {
        self.unmanaged.insert(i, item);
    }

    /// Note that this creates *shallow* copies of `value`.
    pub fn add_many_at(
        &mut self,
        index: usize,
        value: T,
        count: usize,
    ) -> Result<&mut [T], AllocError>
    where
        T: Clone,
    {
        self.unmanaged
            .splice(index..index, core::iter::repeat_n(value, count));
        Ok(&mut self.unmanaged[index..index + count])
    }

    /// Note that this creates *shallow* copies of `value`.
    pub fn add_many_at_assume_capacity(&mut self, index: usize, value: T, count: usize) -> &mut [T]
    where
        T: Clone,
    {
        self.unmanaged
            .splice(index..index, core::iter::repeat_n(value, count));
        &mut self.unmanaged[index..index + count]
    }

    /// Note that this `Clone`s each element of `new_items`.
    pub fn insert_slice(&mut self, index: usize, new_items: &[T]) -> Result<(), AllocError>
    where
        T: Clone,
    {
        self.unmanaged
            .splice(index..index, new_items.iter().cloned());
        Ok(())
    }

    /// This method `Drop`s the removed items.
    /// Note that this `Clone`s each element of `new_items` (see `insert_slice`).
    pub fn replace_range(
        &mut self,
        start: usize,
        len: usize,
        new_items: &[T],
    ) -> Result<(), AllocError>
    where
        T: Clone,
    {
        // `Vec::splice` drops the removed range.
        self.unmanaged
            .splice(start..start + len, new_items.iter().cloned());
        Ok(())
    }

    /// This method `Drop`s the removed items.
    /// Note that this `Clone`s each element of `new_items` (see `insert_slice`).
    pub fn replace_range_assume_capacity(&mut self, start: usize, len: usize, new_items: &[T])
    where
        T: Clone,
    {
        let _ = self.replace_range(start, len, new_items);
    }

    pub fn append(&mut self, item: T) -> Result<(), AllocError> {
        self.unmanaged.push(item);
        Ok(())
    }

    pub fn append_assume_capacity(&mut self, item: T) {
        self.unmanaged.push(item);
    }

    pub fn ordered_remove(&mut self, i: usize) -> T {
        self.unmanaged.remove(i)
    }

    pub fn swap_remove(&mut self, i: usize) -> T {
        self.unmanaged.swap_remove(i)
    }

    /// Note that this `Clone`s each element of `new_items` (see `insert_slice`).
    pub fn append_slice(&mut self, new_items: &[T]) -> Result<(), AllocError>
    where
        T: Clone,
    {
        self.unmanaged.extend_from_slice(new_items);
        Ok(())
    }

    /// Note that this `Clone`s each element of `new_items` (see `insert_slice`).
    pub fn append_slice_assume_capacity(&mut self, new_items: &[T])
    where
        T: Clone,
    {
        self.unmanaged.extend_from_slice(new_items);
    }

    /// Note that this `Clone`s each element of `new_items` (see `insert_slice`).
    pub fn append_unaligned_slice(&mut self, new_items: &[T]) -> Result<(), AllocError>
    where
        T: Clone,
    {
        // Rust `&[T]` is always naturally aligned, so this is identical to `append_slice`; a
        // caller that truly has unaligned bytes needs `ptr::read_unaligned` at the call site.
        self.unmanaged.extend_from_slice(new_items);
        Ok(())
    }

    /// Note that this `Clone`s each element of `new_items` (see `insert_slice`).
    pub fn append_unaligned_slice_assume_capacity(&mut self, new_items: &[T])
    where
        T: Clone,
    {
        self.unmanaged.extend_from_slice(new_items);
    }

    /// Note that this creates *shallow* copies of `value`.
    #[inline]
    pub fn append_n_times(&mut self, value: T, n: usize) -> Result<(), AllocError>
    where
        T: Clone,
    {
        self.unmanaged.extend(core::iter::repeat_n(value, n));
        Ok(())
    }

    /// Note that this creates *shallow* copies of `value`.
    #[inline]
    pub fn append_n_times_assume_capacity(&mut self, value: T, n: usize)
    where
        T: Clone,
    {
        self.unmanaged.extend(core::iter::repeat_n(value, n));
    }

    /// If `new_len` is less than the current length, this method will `Drop` the removed items.
    ///
    /// If `new_len` is greater than the current length, note that this creates copies of
    /// `init_value`.
    pub fn resize(&mut self, init_value: T, new_len: usize) -> Result<(), AllocError>
    where
        T: Clone,
    {
        self.unmanaged.resize(new_len, init_value);
        Ok(())
    }

    /// This method `Drop`s the removed items.
    pub fn shrink_and_free(&mut self, new_len: usize) {
        self.prepare_for_deep_shrink(new_len);
        // `prepare_for_deep_shrink` already truncated (dropping items); now free.
        self.unmanaged.shrink_to_fit();
    }

    /// This method `Drop`s the removed items.
    pub fn shrink_retaining_capacity(&mut self, new_len: usize) {
        self.prepare_for_deep_shrink(new_len);
        // `truncate` inside `prepare_for_deep_shrink` already retained capacity.
    }

    /// This method `Drop`s all items.
    pub fn clear_retaining_capacity(&mut self) {
        // `Vec::clear` drops all items and retains capacity.
        self.unmanaged.clear();
    }

    /// This method `Drop`s all items.
    pub fn clear_and_free(&mut self) {
        self.unmanaged = Vec::new();
    }

    pub fn ensure_total_capacity(&mut self, new_capacity: usize) -> Result<(), AllocError> {
        self.unmanaged.ensure_total_capacity(new_capacity);
        Ok(())
    }

    pub fn ensure_total_capacity_precise(&mut self, new_capacity: usize) -> Result<(), AllocError> {
        self.unmanaged.ensure_total_capacity_precise(new_capacity);
        Ok(())
    }

    pub fn ensure_unused_capacity(&mut self, additional_count: usize) -> Result<(), AllocError> {
        self.unmanaged.ensure_unused_capacity(additional_count);
        Ok(())
    }

    /// Note that this creates copies of `init_value`.
    pub fn expand_to_capacity(&mut self, init_value: T)
    where
        T: Clone,
    {
        let len = self.unmanaged.len();
        let cap = self.unmanaged.capacity();
        self.unmanaged
            .extend(core::iter::repeat_n(init_value, cap - len));
        debug_assert_eq!(self.unmanaged.len(), cap);
    }

    pub fn pop(&mut self) -> Option<T> {
        self.unmanaged.pop()
    }

    pub fn get_last(&self) -> &T {
        // Panics on empty.
        let items = self.items();
        &items[items.len() - 1]
    }

    pub fn get_last_mut(&mut self) -> &mut T {
        let len = self.unmanaged.len();
        &mut self.unmanaged[len - 1]
    }

    pub fn get_last_or_null(&self) -> Option<&T> {
        if self.is_empty() {
            None
        } else {
            Some(self.get_last())
        }
    }

    pub fn is_empty(&self) -> bool {
        self.items().is_empty()
    }

    fn prepare_for_deep_shrink(&mut self, new_len: usize) {
        let items_len = self.unmanaged.len();
        debug_assert!(
            new_len <= items_len,
            "new_len ({new_len}) cannot exceed current len ({items_len})",
        );
        // `Vec::truncate` drops the tail in place and keeps capacity.
        self.unmanaged.truncate(new_len);
    }
}

impl ArrayListAlignedIn<u8> {
    /// Hands out the backing `Vec<u8>`, which already implements `std::io::Write`.
    /// Only exposed for `T = u8` — there is no meaningful writer for other element types.
    pub fn writer(&mut self) -> &mut Vec<u8> {
        &mut self.unmanaged
    }
}
