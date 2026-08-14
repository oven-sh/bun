// This file contains code derived from the following source:
//   https://gist.github.com/kprotty/0d2dc3da4840341d6ff361b27bdac7dc#file-sync2-zig

use core::cell::{Cell, UnsafeCell};
use core::mem::MaybeUninit;

use bun_collections::LinearFifo;
use bun_collections::linear_fifo::{DynamicBuffer, LinearFifoBuffer, StaticBuffer};

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

// Channel is shared across threads through `&self`, so `buffer` is wrapped in
// `UnsafeCell` and `is_closed` in `Cell`, both accessed only while `mutex` is
// held. The buffer strategy is a `LinearFifoBuffer<T>` trait param
// (`Channel<T, B: LinearFifoBuffer<T>>`) with per-buffer inherent constructors
// below.
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

// Rust cannot dispatch a single `init` ident to different signatures based on
// a type-level discriminant. Callers pick the matching constructor directly.

impl<T: Copy, const N: usize> Channel<T, StaticBuffer<T, N>> {
    #[inline]
    pub fn init_static() -> Self {
        Self::with_buffer(LinearFifo::<T, StaticBuffer<T, N>>::init())
    }
}

// `T: Copy` because `read_items` assigns into slots that are still
// uninitialized (a destructor would run on garbage there). All in-tree
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

    /// Publishes `item`, blocking while the buffer is full. Only for a channel
    /// that something other than the matching [`read_item`](Self::read_item)
    /// keeps alive past this call: `&self` asserts the channel's storage until
    /// this returns, and the reader this call unblocks may return before then.
    /// When that read returning is what lets the owner free the channel, use
    /// [`write_item_raw`](Self::write_item_raw).
    pub fn write_item(&self, item: T) -> Result<(), ChannelError> {
        // SAFETY: the channel outlives this call (fn contract).
        unsafe { Self::write_item_raw(self, item) }
    }

    /// [`write_item`](Self::write_item) for a channel whose owner may free it
    /// as soon as the matching `read_item` returns (`RemoteImageDownload` in
    /// run_command.rs publishes into a channel on the reading thread's stack).
    /// The reader takes the item under the mutex, so it cannot return before
    /// this thread's unlock; the store inside that unlock which releases the
    /// mutex is this thread's last access to the channel, and no frame between
    /// here and that store holds a reference into the channel.
    ///
    /// # Safety
    /// `this` must point to a live channel, and the channel must stay live
    /// until this call's final unlock. No reader can take `item` before that
    /// unlock, so an owner that frees the channel only after the `read_item`
    /// that returned `item` has returned satisfies this.
    pub unsafe fn write_item_raw(this: *const Self, item: T) -> Result<(), ChannelError> {
        // SAFETY: `item` has not been published, so the channel is live (fn
        // contract).
        unsafe { (*this).mutex.lock() };
        // SAFETY: as above while it waits for space; once it has published
        // `item`, the reader still has to acquire the mutex, which this thread
        // holds until the unlock below. The `&Self` this forms is gone before
        // that unlock.
        let result = unsafe { (*this).write_item_locked(item) };
        // SAFETY: the mutex is still held, so the channel is still live. The
        // releasing store inside is the last access to it; `mutex.unlock()`
        // would keep a `&Mutex` alive past that store.
        unsafe { Mutex::unlock_raw(&raw const (*this).mutex) };
        result
    }

    /// The critical section of [`write_item_raw`](Self::write_item_raw). The
    /// caller holds `mutex` on entry and gets it back on return; `putters.wait`
    /// releases it only while parked.
    fn write_item_locked(&self, item: T) -> Result<(), ChannelError> {
        loop {
            // `is_closed` is a `Cell`, so this is a fresh load after every wait.
            if self.is_closed.get() {
                return Err(ChannelError::Closed);
            }
            // SAFETY: the mutex is held, and this `&mut` is dead before the
            // wait() below releases it.
            let buffer = unsafe { &mut *self.buffer.get() };
            match buffer.write_item(item) {
                Ok(()) => {
                    self.getters.signal();
                    return Ok(());
                }
                // A dynamic buffer only fails to grow on OOM; a static one only
                // fails while full.
                Err(err) if B::DYNAMIC => return Err(err.into()),
                Err(_) => self.putters.wait(&self.mutex),
            }
        }
    }

    /// Blocks until an item is available. Once this returns, the
    /// [`write_item_raw`](Self::write_item_raw) that published the item is done
    /// with the channel, so a caller waiting for the last item may free it.
    pub fn read_item(&self) -> Result<T, ChannelError> {
        let mut items: [MaybeUninit<T>; 1] = [MaybeUninit::uninit()];
        // SAFETY: see try_read_item.
        let slice = unsafe { &mut *items.as_mut_ptr().cast::<[T; 1]>() };
        self.read_all(slice)?;
        // SAFETY: read_all() filled all slots.
        Ok(unsafe { items[0].assume_init_read() })
    }

    pub(crate) fn read_all(&self, items: &mut [T]) -> Result<(), ChannelError> {
        let n = self.read_items(items, true)?;
        debug_assert!(n == items.len());
        Ok(())
    }

    fn read_items(&self, items: &mut [T], should_block: bool) -> Result<usize, ChannelError> {
        let _guard = self.mutex.lock_guard();

        let mut popped: usize = 0;
        while popped < items.len() {
            // Re-derive the UnsafeCell refs each iteration so no borrow lives
            // across `getters.wait()` (which releases the mutex).
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

#[cfg(test)]
mod tests {
    use super::*;

    type OneSlot = Channel<u32, StaticBuffer<u32, 1>>;

    struct SendPtr(*const OneSlot);
    // SAFETY: `Channel` is `Sync`; the writer only uses the pointer under
    // `write_item_raw`'s contract, which the reader below upholds.
    unsafe impl Send for SendPtr {}

    // The reader frees a channel as soon as `read_item` has handed it the last
    // item (`RemoteImageDownload` in run_command.rs: the channel is a local of
    // the function that reads it), so the writer must neither touch nor still
    // hold a reference into the channel once its final unlock has let that
    // read return. Under Miri (`bun run rust:miri`) the `Box` drop is rejected
    // whenever a frame of the writer still holds a reference into the channel;
    // natively this is a use-after-free race.
    //
    // Two items through a one-slot buffer make the writer wait for the reader
    // on every channel, so the reader is normally parked in `read_item` when
    // the publishing write happens and its free races that write's return on
    // every channel, not only on a writer thread's first one (with one item per
    // channel the writer runs ahead and the reader frees channels the writer
    // left long ago). One writer thread serves a batch of channels because
    // under Miri a spawn costs as much as a couple of channels. Miri's
    // scheduler lets the free win about once per 100 channels for the `&self`
    // shape; a run is 1024 channels.
    #[test]
    fn reader_may_free_a_channel_once_it_has_the_items() {
        const CHANNELS: usize = 32;
        #[cfg(miri)]
        const BATCHES: usize = 32;
        #[cfg(not(miri))]
        const BATCHES: usize = 1_000;

        for _ in 0..BATCHES {
            let channels: Vec<*const OneSlot> = (0..CHANNELS)
                .map(|_| Box::into_raw(Box::new(OneSlot::init_static())).cast_const())
                .collect();
            let writer = {
                let channels: Vec<SendPtr> = channels.iter().map(|&c| SendPtr(c)).collect();
                std::thread::Builder::new()
                    .spawn(move || {
                        for SendPtr(channel) in channels {
                            // SAFETY: the reader frees this channel only after
                            // `read_item` has returned the second item, so the
                            // channel is live until each call's final unlock.
                            unsafe {
                                OneSlot::write_item_raw(channel, 1).unwrap();
                                OneSlot::write_item_raw(channel, 2).unwrap();
                            }
                        }
                    })
                    .unwrap()
            };
            for channel in channels {
                // SAFETY: `channel` is a freshly boxed allocation this thread
                // alone owns; the second `read_item` returning means the writer
                // is done with it (the property under test).
                let items = unsafe {
                    let items = [(*channel).read_item(), (*channel).read_item()];
                    drop(Box::from_raw(channel.cast_mut()));
                    items
                };
                assert_eq!(items, [Ok(1), Ok(2)]);
            }
            writer.join().unwrap();
        }
    }

    // `write_item(&self)` is for a channel that outlives the call for some
    // reason other than the matching read; here the scope joins the writer
    // before the channel goes away.
    #[test]
    fn items_arrive_in_order_through_a_full_buffer() {
        let channel = OneSlot::init_static();
        let received = std::thread::scope(|scope| {
            scope.spawn(|| {
                for item in 1..=3 {
                    channel.write_item(item).unwrap();
                }
            });
            [(); 3].map(|()| channel.read_item().unwrap())
        });
        assert_eq!(received, [1, 2, 3]);
    }
}
