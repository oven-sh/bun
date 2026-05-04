// This file contains code derived from the following source:
//   https://gist.github.com/kprotty/0d2dc3da4840341d6ff361b27bdac7dc#file-sync2-zig

use core::cell::UnsafeCell;
use core::mem::MaybeUninit;

use bun_collections::{LinearFifo, LinearFifoBufferType};

use crate::Condition;
use crate::Mutex;

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelError {
    #[error("Closed")]
    Closed,
    #[error("OutOfMemory")]
    OutOfMemory,
}

impl From<bun_alloc::AllocError> for ChannelError {
    fn from(_: bun_alloc::AllocError) -> Self {
        ChannelError::OutOfMemory
    }
}

impl From<ChannelError> for bun_core::Error {
    fn from(e: ChannelError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

// PORT NOTE: reshaped for borrowck / thread-safety. In Zig all methods take
// `*Self` and the mutex guards `buffer`/`is_closed`. In Rust we need `&self`
// (Channel is shared across threads), so the mutex-protected fields are
// wrapped in `UnsafeCell` and accessed only while `mutex` is held.
pub struct Channel<T, const BUFFER_TYPE: LinearFifoBufferType> {
    mutex: Mutex,
    putters: Condition,
    getters: Condition,
    buffer: UnsafeCell<LinearFifo<T, BUFFER_TYPE>>,
    is_closed: UnsafeCell<bool>,
}

// SAFETY: all interior-mutable state is guarded by `mutex`.
unsafe impl<T: Send, const B: LinearFifoBufferType> Send for Channel<T, B> {}
// SAFETY: all interior-mutable state is guarded by `mutex`.
unsafe impl<T: Send, const B: LinearFifoBufferType> Sync for Channel<T, B> {}

type Buffer<T, const B: LinearFifoBufferType> = LinearFifo<T, B>;

impl<T, const BUFFER_TYPE: LinearFifoBufferType> Channel<T, BUFFER_TYPE> {
    // Zig: `pub const init = switch (buffer_type) { .Static => initStatic, ... }`
    // TODO(port): Rust cannot dispatch a single `init` ident to different
    // signatures based on a const-generic. Callers must pick the matching
    // `init_static` / `init_slice` / `init_dynamic` directly.

    #[inline]
    pub fn init_static() -> Self
    where
        [(); 0]:, // TODO(port): const-generic where-bound for BUFFER_TYPE == Static
    {
        Self::with_buffer(Buffer::<T, BUFFER_TYPE>::init())
    }

    #[inline]
    pub fn init_slice(buf: &mut [T]) -> Self {
        // TODO(port): Slice variant borrows `buf` for the lifetime of the
        // channel; LinearFifo<_, Slice> will need a lifetime param in Phase B.
        Self::with_buffer(Buffer::<T, BUFFER_TYPE>::init_slice(buf))
    }

    #[inline]
    pub fn init_dynamic() -> Self {
        // PORT NOTE: Zig took `allocator: std.mem.Allocator`; dropped per
        // §Allocators (non-AST crate uses global mimalloc).
        Self::with_buffer(Buffer::<T, BUFFER_TYPE>::init_dynamic())
    }

    fn with_buffer(buffer: Buffer<T, BUFFER_TYPE>) -> Self {
        Self {
            mutex: Mutex::default(),
            putters: Condition::default(),
            getters: Condition::default(),
            buffer: UnsafeCell::new(buffer),
            is_closed: UnsafeCell::new(false),
        }
    }

    // Zig `deinit` only freed `self.buffer` and poisoned `self.*`. Rust drops
    // fields automatically, so no explicit `Drop` impl is needed.

    pub fn close(&self) {
        let _guard = self.mutex.lock();
        // SAFETY: mutex is held; we are the only accessor of `is_closed`.
        let is_closed = unsafe { &mut *self.is_closed.get() };

        if *is_closed {
            return;
        }

        *is_closed = true;
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
        let slice = unsafe { &mut *(items.as_mut_ptr() as *mut [T; 1]) };
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
        let slice = unsafe { &mut *(items.as_mut_ptr() as *mut [T; 1]) };
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
        let _guard = self.mutex.lock();
        // SAFETY: mutex is held for the duration of this fn.
        let buffer = unsafe { &mut *self.buffer.get() };
        // SAFETY: mutex is held.
        let is_closed = unsafe { &*self.is_closed.get() };

        let mut pushed: usize = 0;
        while pushed < items.len() {
            let did_push = 'blk: {
                if *is_closed {
                    return Err(ChannelError::Closed);
                }

                match buffer.write(items) {
                    Ok(()) => {}
                    Err(err) => {
                        if BUFFER_TYPE == LinearFifoBufferType::Dynamic {
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
                // TODO(port): verify bun_threading::Condition::wait signature
                // (guard vs &Mutex). Mirroring Zig: `putters.wait(&self.mutex)`.
                self.putters.wait(&self.mutex);
            } else {
                break;
            }
        }

        Ok(pushed)
    }

    // TODO(port): narrow error set
    fn read_items(&self, items: &mut [T], should_block: bool) -> Result<usize, ChannelError> {
        let _guard = self.mutex.lock();
        // SAFETY: mutex is held for the duration of this fn.
        let buffer = unsafe { &mut *self.buffer.get() };
        // SAFETY: mutex is held.
        let is_closed = unsafe { &*self.is_closed.get() };

        let mut popped: usize = 0;
        while popped < items.len() {
            let new_item: Option<T> = 'blk: {
                // Buffer can contain null items but readItem will return null if the buffer is empty.
                // we need to check if the buffer is empty before trying to read an item.
                if buffer.count() == 0 {
                    if *is_closed {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/threading/channel.zig (172 lines)
//   confidence: medium
//   todos:      14
//   notes:      const-generic enum BUFFER_TYPE + UnsafeCell interior mutability; Mutex/Condition guard API and LinearFifo crate path need Phase B verification; ChannelError pre-narrowed from Zig `!T` (verify against inferred set)
// ──────────────────────────────────────────────────────────────────────────
