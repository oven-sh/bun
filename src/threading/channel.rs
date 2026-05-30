// This file contains code derived from the following source:
//   https://gist.github.com/kprotty/0d2dc3da4840341d6ff361b27bdac7dc#file-sync2-zig

use core::cell::{Cell, UnsafeCell};
use core::mem::MaybeUninit;

use bun_collections::LinearFifo;
use bun_collections::linear_fifo::{DynamicBuffer, LinearFifoBuffer, SliceBuffer, StaticBuffer};

use crate::Condition;
use crate::Mutex;

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelError {
    #[error("Closed")]
    Closed,
    #[error("OutOfMemory")]
    OutOfMemory,
}

bun_core::oom_from_alloc!(ChannelError);

bun_core::named_error_set!(ChannelError);

// PORT NOTE: reshaped for borrowck / thread-safety. In Zig all methods take
// `*Self` and the mutex guards `buffer`/`is_closed`. In Rust we need `&self`
// (Channel is shared across threads), so `buffer` is wrapped in `UnsafeCell`
// and `is_closed` in `Cell`, both accessed only while `mutex` is held.
//
// PORT NOTE: Zig's `comptime buffer_type: LinearFifoBufferType` const-enum
// param is unstable in Rust (`adt_const_params`). `bun_collections::LinearFifo`
// already lowers it to a `LinearFifoBuffer<T>` trait param, so `Channel`
// follows the same shape: `Channel<T, B: LinearFifoBuffer<T>>`. The original
// `init` switch becomes per-buffer inherent constructors below.
pub struct Channel<T, B: LinearFifoBuffer<T> = DynamicBuffer<T>> {
    mutex: Mutex,
    putters: Condition,
    getters: Condition,
    buffer: UnsafeCell<LinearFifo<T, B>>,
    // `Cell` (not `UnsafeCell`): `bool` is `Copy`, so safe `.get()/.set()` are
    // exactly the non-atomic load/store the mutex already serializes. The
    // `unsafe impl Sync` below is where the cross-thread safety burden lives.
    is_closed: Cell<bool>,
}

// SAFETY: all interior-mutable state is guarded by `mutex`.
unsafe impl<T: Send, B: LinearFifoBuffer<T>> Send for Channel<T, B> {}
// SAFETY: all interior-mutable state is guarded by `mutex`.
unsafe impl<T: Send, B: LinearFifoBuffer<T>> Sync for Channel<T, B> {}

// Zig: `pub const init = switch (buffer_type) { .Static => initStatic, ... }`
// Rust cannot dispatch a single `init` ident to different signatures based on
// a type-level discriminant. Callers pick the matching constructor directly.

impl<T: Copy, const N: usize> Channel<T, StaticBuffer<T, N>> {
    #[inline]
    pub fn init_static() -> Self {
        Self::with_buffer(LinearFifo::<T, StaticBuffer<T, N>>::init())
    }
}

impl<'a, T: Copy> Channel<T, SliceBuffer<'a, T>> {
    #[inline]
    pub fn init_slice(buf: &'a mut [T]) -> Self {
        Self::with_buffer(LinearFifo::<T, SliceBuffer<'a, T>>::init(buf))
    }
}

impl<T: Copy> Channel<T, DynamicBuffer<T>> {
    #[inline]
    pub fn init_dynamic() -> Self {
        // PORT NOTE: Zig took `std.mem.Allocator param`; dropped per
        // §Allocators (non-AST crate uses global mimalloc).
        Self::with_buffer(LinearFifo::<T, DynamicBuffer<T>>::init())
    }
}

// PORT NOTE: `T: Copy` because `LinearFifo::write`/`read` are slice-copy
// based (mirrors Zig's `[]const T` semantics for POD payloads). All in-tree
// channel payloads are POD; revisit if a non-`Copy` T appears.
impl<T: Copy, B: LinearFifoBuffer<T>> Channel<T, B> {
    fn with_buffer(buffer: LinearFifo<T, B>) -> Self {
        Self {
            mutex: Mutex::default(),
            putters: Condition::default(),
            getters: Condition::default(),
            buffer: UnsafeCell::new(buffer),
            is_closed: Cell::new(false),
        }
    }

    // Zig `deinit` only freed `self.buffer` and poisoned `self.*`. Rust drops
    // fields automatically, so no explicit `Drop` impl is needed.

    pub fn close(&self) {
        let _guard = self.mutex.lock_guard();
        if self.is_closed.get() {
            return;
        }
        self.is_closed.set(true);
        self.putters.broadcast();
        self.getters.broadcast();
    }

    // TODO(port): narrow error set
    pub fn try_write_item(&self, item: T) -> Result<bool, ChannelError> {
        let wrote = self.write(core::slice::from_ref(&item))?;
        Ok(wrote == 1)
    }

    // TODO(port): narrow error set
    pub fn write_item(&self, item: T) -> Result<(), ChannelError> {
        self.write_all(core::slice::from_ref(&item))
    }

    // TODO(port): narrow error set
    pub fn write(&self, items: &[T]) -> Result<usize, ChannelError> {
        self.write_items(items, false)
    }

    // TODO(port): narrow error set
    pub fn try_read_item(&self) -> Result<Option<T>, ChannelError> {
        let mut items: [MaybeUninit<T>; 1] = [MaybeUninit::uninit()];
        // SAFETY: `read` only writes initialized `T` into the first `n` slots
        // and returns `n`; we never read an uninitialized slot.
        let slice = unsafe { &mut *items.as_mut_ptr().cast::<[T; 1]>() };
        if self.read(slice)? != 1 {
            return Ok(None);
        }
        // SAFETY: read() returned 1, so items[0] is initialized.
        Ok(Some(unsafe { items[0].assume_init_read() }))
    }

    // TODO(port): narrow error set
    pub fn read_item(&self) -> Result<T, ChannelError> {
        let mut items: [MaybeUninit<T>; 1] = [MaybeUninit::uninit()];
        // SAFETY: see try_read_item.
        let slice = unsafe { &mut *items.as_mut_ptr().cast::<[T; 1]>() };
        self.read_all(slice)?;
        // SAFETY: read_all() filled all slots.
        Ok(unsafe { items[0].assume_init_read() })
    }

    // TODO(port): narrow error set
    pub fn read(&self, items: &mut [T]) -> Result<usize, ChannelError> {
        self.read_items(items, false)
    }

    // TODO(port): narrow error set
    pub fn write_all(&self, items: &[T]) -> Result<(), ChannelError> {
        let n = self.write_items(items, true)?;
        debug_assert!(n == items.len());
        Ok(())
    }

    // TODO(port): narrow error set
    pub fn read_all(&self, items: &mut [T]) -> Result<(), ChannelError> {
        let n = self.read_items(items, true)?;
        debug_assert!(n == items.len());
        Ok(())
    }

    // TODO(port): narrow error set
    fn write_items(&self, items: &[T], should_block: bool) -> Result<usize, ChannelError> {
        let _guard = self.mutex.lock_guard();

        let mut pushed: usize = 0;
        while pushed < items.len() {
            // Re-derive the `&mut buffer` each iteration: `Condition::wait`
            // below releases the mutex, so a long-lived `&mut buffer` held
            // across wait() would alias another thread's `&mut` (UB).
            // `is_closed` is a `Cell` so `.get()` is already a fresh load each
            // iteration (cannot be hoisted past the interior-mutable wait).
            let did_push = 'blk: {
                if self.is_closed.get() {
                    return Err(ChannelError::Closed);
                }
                // SAFETY: mutex is held; this &mut does not live across wait().
                let buffer = unsafe { &mut *self.buffer.get() };
                match buffer.write(items) {
                    Ok(()) => {}
                    Err(err) => {
                        if B::DYNAMIC {
                            return Err(err.into());
                        }
                        break 'blk false;
                    }
                }
                self.getters.signal();
                break 'blk true;
            };

            if did_push {
                pushed += 1;
            } else if should_block {
                // wait() releases the mutex while parked, reacquires before
                // returning. No long-lived UnsafeCell borrows are live here.
                self.putters.wait(&self.mutex);
            } else {
                break;
            }
        }

        Ok(pushed)
    }

    // TODO(port): narrow error set
    fn read_items(&self, items: &mut [T], should_block: bool) -> Result<usize, ChannelError> {
        let _guard = self.mutex.lock_guard();

        let mut popped: usize = 0;
        while popped < items.len() {
            // See write_items: re-derive UnsafeCell refs each iteration so no
            // borrow lives across `getters.wait()` (which releases the mutex).
            let new_item: Option<T> = 'blk: {
                // SAFETY: mutex is held; this &mut does not live across wait().
                let buffer = unsafe { &mut *self.buffer.get() };
                // Buffer can contain null items but readItem will return null if the buffer is empty.
                // we need to check if the buffer is empty before trying to read an item.
                if buffer.readable_length() == 0 {
                    if self.is_closed.get() {
                        return Err(ChannelError::Closed);
                    }
                    break 'blk None;
                }
                let item = buffer.read_item();
                self.putters.signal();
                break 'blk item;
            };

            if let Some(item) = new_item {
                items[popped] = item;
                popped += 1;
            } else if should_block {
                self.getters.wait(&self.mutex);
            } else {
                break;
            }
        }

        Ok(popped)
    }
}

// ported from: src/threading/channel.zig
