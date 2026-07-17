use alloc::borrow::Cow;

use crate::JSValue;
use crate::virtual_machine::VirtualMachine;
use bun_core::collections::IntegerBitSet;

/// This is an advanced iterator struct which is used by various APIs. In
/// Node.fs, `will_be_async` is set to true which allows string/path APIs to
/// know if they have to do threadsafe clones.
///
/// Prefer `Iterator` for a simpler iterator.
pub struct ArgumentsSlice<'a> {
    /// Backing storage for the remaining-args view. Both [`Self::init`] and
    /// [`Self::init_async`] borrow — `all: &'a [JSValue]` already ties this
    /// struct's lifetime to the source slice, so a heap-owned dupe
    /// buys nothing here (it could not outlive `'a`). Kept as
    /// `Cow` so a future caller that does own its args can pass `Owned`
    /// without changing the type.
    remaining_buf: Cow<'a, [JSValue]>,
    /// Cursor into `remaining_buf`; advances on `eat()`.
    remaining_start: usize,
    pub vm: &'a VirtualMachine,
    /// `bun_core::alloc_impl::Arena` is a `MimallocArena`
    /// whose `new()` calls `mi_heap_new()` eagerly, so we keep it `None` until a
    /// caller actually needs scratch storage (currently none do).
    pub arena: Option<bun_core::alloc_impl::Arena>,
    pub all: &'a [JSValue],
    pub threw: bool,
    pub protected: IntegerBitSet<32>,
    pub will_be_async: bool,
}

impl<'a> ArgumentsSlice<'a> {
    /// View of arguments not yet consumed by `eat()`.
    #[inline]
    pub fn remaining(&self) -> &[JSValue] {
        &self.remaining_buf[self.remaining_start..]
    }

    /// Lazily create the scratch arena.
    #[inline]
    pub fn arena(&mut self) -> &bun_core::alloc_impl::Arena {
        self.arena.get_or_insert_with(bun_core::alloc_impl::Arena::new)
    }

    pub fn unprotect(&mut self) {
        let mut iter = self.protected.iterator::<true, true>();
        while let Some(i) = iter.next() {
            self.all[i].unprotect();
        }
        self.protected = IntegerBitSet::<32>::init_empty();
    }

    pub fn protect_eat(&mut self) {
        if self.remaining().is_empty() {
            return;
        }
        // `remaining_buf.len() == all.len()` for both init variants, so
        // `all.len() - remaining().len()` reduces to `remaining_start`.
        let index = self.all.len() - self.remaining().len();
        self.protected.set(index);
        self.all[index].protect();
        self.eat();
    }

    pub fn protect_eat_next(&mut self) -> Option<JSValue> {
        if self.remaining().is_empty() {
            return None;
        }
        self.next_eat()
    }

    pub fn init(vm: &'a VirtualMachine, slice: &'a [JSValue]) -> ArgumentsSlice<'a> {
        ArgumentsSlice {
            remaining_buf: Cow::Borrowed(slice),
            remaining_start: 0,
            vm,
            all: slice,
            arena: None,
            threw: false,
            protected: IntegerBitSet::<32>::init_empty(),
            will_be_async: false,
        }
    }

    pub fn init_async(vm: &'a VirtualMachine, slice: &'a [JSValue]) -> ArgumentsSlice<'a> {
        // `all: &'a [JSValue]` already pins the struct lifetime to `slice`, so a
        // heap-owned dupe of `remaining` cannot outlive `slice` anyway — borrow instead of copying.
        // `all` stays borrowed so `protect_eat` index math holds.
        ArgumentsSlice {
            remaining_buf: Cow::Borrowed(slice),
            remaining_start: 0,
            vm,
            all: slice,
            arena: None,
            threw: false,
            protected: IntegerBitSet::<32>::init_empty(),
            will_be_async: false,
        }
    }

    #[inline]
    pub fn len(&self) -> u16 {
        self.remaining().len() as u16
    }

    pub fn eat(&mut self) {
        if self.remaining().is_empty() {
            return;
        }
        self.remaining_start += 1;
    }

    /// Peek the next argument without eating it
    pub fn next(&mut self) -> Option<JSValue> {
        self.remaining().first().copied()
    }

    pub fn next_eat(&mut self) -> Option<JSValue> {
        let v = self.remaining().first().copied()?;
        self.eat();
        Some(v)
    }
}

impl<'a> Drop for ArgumentsSlice<'a> {
    fn drop(&mut self) {
        self.unprotect();
        // arena dropped automatically
    }
}
