// FIFO of fixed size items
// Usually used for e.g. byte buffers

use core::marker::PhantomData;
use core::mem::{self, MaybeUninit};
use core::ptr;

use bun_alloc::AllocError;

// 4096 is the conservative minimum page size on every platform Bun ships on.
const PAGE_SIZE_MIN: usize = 4096;

/// Backing-storage abstraction; `DYNAMIC` is true for the `.Dynamic` variant.
// Trait + assoc-consts encode the structurally different layouts per
// variant.
pub trait LinearFifoBuffer<T> {
    const POWERS_OF_TWO: bool;
    const DYNAMIC: bool;

    fn as_slice(&self) -> &[T];
    fn as_mut_slice(&mut self) -> &mut [T];
    #[inline]
    fn len(&self) -> usize {
        self.as_slice().len()
    }

    /// Allocate fresh storage of `new_size` and return the old buffer so the
    /// caller can copy out of it before drop.
    fn alloc_swap(&mut self, _new_size: usize) -> Result<Box<[MaybeUninit<T>]>, AllocError> {
        unreachable!("alloc_swap on non-Dynamic LinearFifo buffer")
    }
}

/// Reinterpret `&[MaybeUninit<T>]` as `&[T]`. `MaybeUninit<T>` has identical
/// layout to `T`; exposing uninitialized bytes as `T` is sound only when any
/// bit pattern is a valid `T`. NOT every in-tree element type satisfies this:
/// besides byte buffers and raw pointers, fifos today store `NonNull`-bearing
/// enums (`bun_test::RefDataValue`), `JSPromiseStrong`-bearing structs
/// (`ValkeyCommand::PromisePair`), and the `event_loop::Task` enum — see the
/// `StaticBuffer` note below for the pending MaybeUninit accessor rework.
/// Centralises the four per-buffer-kind casts behind one audited block.
#[inline(always)]
fn assume_init_slice<T>(s: &[MaybeUninit<T>]) -> &[T] {
    // SAFETY: see fn doc.
    unsafe { &*(ptr::from_ref::<[MaybeUninit<T>]>(s) as *const [T]) }
}

/// Mutable variant of [`assume_init_slice`]. The input borrow is consumed by
/// the cast, so the returned `&mut [T]` is the sole live reference into the
/// allocation for its lifetime.
#[inline(always)]
fn assume_init_slice_mut<T>(s: &mut [MaybeUninit<T>]) -> &mut [T] {
    // SAFETY: see `assume_init_slice`.
    unsafe { &mut *(ptr::from_mut::<[MaybeUninit<T>]>(s) as *mut [T]) }
}

/// Shift `slice[1..]` down to `slice[0..len-1]` (memmove). Used by
/// `ordered_remove_item` for the four wrap/non-wrap segment shifts. Not
/// `slice::copy_within` because that requires `T: Copy`; this fifo permits
/// move-only `T` (the duplicated tail slot is logically discarded by the
/// subsequent `count -= 1`).
#[inline(always)]
fn shift_down_one<T>(slice: &mut [T]) {
    let len = slice.len();
    if len <= 1 {
        return;
    }
    let p = slice.as_mut_ptr();
    // SAFETY: src `[1..len)` and dst `[0..len-1)` are both in-bounds of
    // `slice`; `ptr::copy` handles the overlap. Both pointers derive from one
    // `as_mut_ptr()` so the src tag is not invalidated by a later Unique retag.
    unsafe { ptr::copy(p.add(1), p, len - 1) };
}

#[cfg(debug_assertions)]
#[inline(always)]
fn poison<T>(slice: &mut [T], n: usize) {
    debug_assert!(n <= slice.len());
    // SAFETY: writing 0xAA into the byte representation of `n` slots that are
    // about to be logically discarded; never read as `T` again.
    unsafe {
        ptr::write_bytes(
            slice.as_mut_ptr().cast::<u8>(),
            0xAA,
            n * mem::size_of::<T>(),
        )
    };
}

// ── .Static ───────────────────────────────────────────────────────────────────

/// `buffer_type == .Static` — inline `[T; N]` storage.
// INVARIANT: storage is MaybeUninit and exposed as &[T] via pointer cast
// (`assume_init_slice`). The public API
// (`writable_slice` hands out `&mut [T]` over not-yet-written slots) bakes in
// the same exposure for every buffer kind. Sound only for `T` whose
// any-bit-pattern is valid — and in-tree element types ALREADY violate that:
// `RefDataValue` (NonNull<DescribeScope> payload), `PromisePair`
// (JSPromiseStrong), and the `Task` enum are stored in fifos today, so
// materialising `&[T]` over uninitialized slots for those types is latent UB.
// The fix is reworking the accessors to operate on `&[MaybeUninit<T>]` and
// only assume-init the logically-written subranges. That cannot be done by
// touching this file alone — `writable_slice`-family callers in other crates
// see the signature change — so it is deferred to a dedicated change with
// Miri coverage for a NonNull-bearing element type.
pub struct StaticBuffer<T, const N: usize>([MaybeUninit<T>; N]);

impl<T, const N: usize> LinearFifoBuffer<T> for StaticBuffer<T, N> {
    const POWERS_OF_TWO: bool = N.is_power_of_two();
    const DYNAMIC: bool = false;

    #[inline]
    fn as_slice(&self) -> &[T] {
        assume_init_slice(self.0.as_slice())
    }
    #[inline]
    fn as_mut_slice(&mut self) -> &mut [T] {
        assume_init_slice_mut(self.0.as_mut_slice())
    }
}

// ── .Dynamic ──────────────────────────────────────────────────────────────────

/// `buffer_type == .Dynamic` — heap-allocated, growable. Global mimalloc
/// backs the `Box`.
pub struct DynamicBuffer<T>(Box<[MaybeUninit<T>]>);

impl<T> LinearFifoBuffer<T> for DynamicBuffer<T> {
    const POWERS_OF_TWO: bool = true; // This could be configurable in future
    const DYNAMIC: bool = true;

    #[inline]
    fn as_slice(&self) -> &[T] {
        assume_init_slice(&self.0)
    }
    #[inline]
    fn as_mut_slice(&mut self) -> &mut [T] {
        assume_init_slice_mut(&mut self.0)
    }

    fn alloc_swap(&mut self, new_size: usize) -> Result<Box<[MaybeUninit<T>]>, AllocError> {
        let new = Box::<[T]>::new_uninit_slice(new_size);
        Ok(mem::replace(&mut self.0, new))
    }
}

// ── LinearFifo ────────────────────────────────────────────────────────────────

pub struct LinearFifo<T, B: LinearFifoBuffer<T>> {
    buf: B,
    head: usize,
    count: usize,
    _marker: PhantomData<T>,
}

// Reader/Writer access is via the impls on `LinearFifo<u8, B>` after the
// inherent impl below: `bun_core::write::Write` (the canonical byte sink,
// re-exported as `bun_io::Write`), plus `std::io::Read`, `std::io::Write`,
// and `core::fmt::Write` for std interop.

impl<T, const N: usize> LinearFifo<T, StaticBuffer<T, N>> {
    /// `init` for `.Static`.
    pub fn init() -> Self {
        Self {
            buf: StaticBuffer([const { MaybeUninit::uninit() }; N]),
            head: 0,
            count: 0,
            _marker: PhantomData,
        }
    }
}

impl<T> LinearFifo<T, DynamicBuffer<T>> {
    /// `init` for `.Dynamic`.
    pub fn init() -> Self {
        Self {
            buf: DynamicBuffer(Box::new([])),
            head: 0,
            count: 0,
            _marker: PhantomData,
        }
    }
}

// `pub fn deinit` → Drop. Dynamic frees `buf` via `Box` drop; Static/Slice are
// no-ops. Field drop glue covers it; no explicit impl needed.

impl<T, B: LinearFifoBuffer<T>> LinearFifo<T, B> {
    #[inline]
    fn buf_len(&self) -> usize {
        self.buf.len()
    }

    /// Allocated capacity of the backing buffer.
    /// Distinct from [`readable_length`] (live items) and
    /// [`writable_length`] (free slots) — `capacity == readable + writable`.
    /// Used by GC `memoryCost` reporting where the *allocation* size, not the
    /// occupancy, is what matters.
    #[inline]
    pub fn capacity(&self) -> usize {
        self.buf.len()
    }

    /// Rewind `head` to 0 when the queue is empty so the next `write` can use
    /// the full contiguous buffer without wrapping. Perf-only micro-opt; a
    /// no-op when items remain.
    #[inline]
    pub fn reset_head_if_empty(&mut self) {
        if self.count == 0 {
            self.head = 0;
        }
    }

    pub fn realign(&mut self) {
        let buf_len = self.buf_len();
        if buf_len - self.head >= self.count {
            // this copy overlaps
            let count = self.count;
            let head = self.head;
            let buf = self.buf.as_mut_slice().as_mut_ptr();
            // SAFETY: src/dst within same allocation; ptr::copy is memmove.
            unsafe { ptr::copy(buf.add(head), buf, count) };
            self.head = 0;
        } else {
            // Stable Rust cannot size a stack array by `size_of::<T>()`, so use
            // a fixed byte scratch (page_size/2 bytes, no heap) and compute the
            // element count at runtime.
            //
            // The scratch is a `[MaybeUninit<u8>; _]` (alignment 1). Reading or
            // writing through it as `*mut T` would violate
            // `ptr::copy_nonoverlapping`'s alignment precondition for any
            // `align_of::<T>() > 1`, so the tmp↔buf transfers are done at byte
            // granularity instead — `*mut u8` only requires 1-byte alignment,
            // which both the scratch and `buf` (cast down from `*T`) satisfy.
            let mut tmp_bytes = [MaybeUninit::<u8>::uninit(); PAGE_SIZE_MIN / 2];
            let tmp_ptr: *mut u8 = tmp_bytes.as_mut_ptr().cast::<u8>();
            let t_size = mem::size_of::<T>();
            let tmp_len = (PAGE_SIZE_MIN / 2) / t_size;

            while self.head != 0 {
                let n = self.head.min(tmp_len);
                let m = buf_len - n;
                let buf = self.buf.as_mut_slice().as_mut_ptr();
                // SAFETY: `tmp` is disjoint from `buf`. The tmp↔buf copies move
                // `n * size_of::<T>()` raw bytes (no `T` typed access through
                // the 1-aligned scratch). The buf→buf shift overlaps, so use
                // `ptr::copy` (memmove); it operates on properly-aligned `*T`.
                unsafe {
                    ptr::copy_nonoverlapping(buf.cast::<u8>(), tmp_ptr, n * t_size);
                    ptr::copy(buf.add(n), buf, m);
                    ptr::copy_nonoverlapping(tmp_ptr, buf.add(m).cast::<u8>(), n * t_size);
                }
                self.head -= n;
            }
        }
        // set unused area to undefined
        #[cfg(debug_assertions)]
        {
            let count = self.count;
            let unused = &mut self.buf.as_mut_slice()[count..];
            // SAFETY: the tail past `count` is logically uninitialized; writing
            // the 0xAA poison pattern there cannot invalidate live items.
            unsafe {
                ptr::write_bytes(
                    unused.as_mut_ptr().cast::<u8>(),
                    0xAA,
                    std::mem::size_of_val(unused),
                );
            }
        }
    }

    /// Ensure that the buffer can fit at least `size` items
    pub fn ensure_total_capacity(&mut self, size: usize) -> Result<(), AllocError> {
        if self.buf_len() >= size {
            return Ok(());
        }
        if B::DYNAMIC {
            self.realign();
            let new_size = if B::POWERS_OF_TWO {
                size.checked_next_power_of_two().ok_or(AllocError)?
            } else {
                size
            };
            let count = self.count;
            let old = self.buf.alloc_swap(new_size)?;
            if count > 0 {
                let new = self.buf.as_mut_slice();
                // After realign(), head==0 so readableSlice(0) == old[0..count].
                // SAFETY: old and new are disjoint allocations.
                unsafe {
                    ptr::copy_nonoverlapping(old.as_ptr().cast::<T>(), new.as_mut_ptr(), count);
                }
            }
            // `self.allocator.free(self.buf)` — `old` drops here.
            self.head = 0;
            Ok(())
        } else {
            Err(AllocError)
        }
    }

    /// Makes sure at least `size` items are unused
    pub fn ensure_unused_capacity(&mut self, size: usize) -> Result<(), AllocError> {
        if self.writable_length() >= size {
            return Ok(());
        }
        let total = self.count.checked_add(size).ok_or(AllocError)?;
        self.ensure_total_capacity(total)
    }

    /// Returns number of items currently in fifo
    #[inline]
    pub fn readable_length(&self) -> usize {
        self.count
    }

    /// Returns a writable slice from the 'read' end of the fifo
    fn readable_slice_mut(&mut self, offset: usize) -> &mut [T] {
        if offset > self.count {
            return &mut [];
        }
        let buf_len = self.buf_len();
        let head = self.head;
        let count = self.count;
        let buf = self.buf.as_mut_slice();
        let mut start = head + offset;
        if start >= buf_len {
            start -= buf_len;
            &mut buf[start..start + (count - offset)]
        } else {
            let end = (head + count).min(buf_len);
            &mut buf[start..end]
        }
    }

    /// Returns a readable slice from `offset`
    pub fn readable_slice(&self, offset: usize) -> &[T] {
        if offset > self.count {
            return &[];
        }
        let buf_len = self.buf_len();
        let buf = self.buf.as_slice();
        let mut start = self.head + offset;
        if start >= buf_len {
            start -= buf_len;
            &buf[start..start + (self.count - offset)]
        } else {
            let end = (self.head + self.count).min(buf_len);
            &buf[start..end]
        }
    }

    /// Discard first `count` items in the fifo
    pub fn discard(&mut self, count: usize) {
        debug_assert!(count <= self.count);

        #[cfg(debug_assertions)]
        {
            // set old range to undefined. Note: may be wrapped around
            // reshaped for borrowck — capture len, then re-borrow.
            let slice_len = self.readable_slice_mut(0).len();
            if slice_len >= count {
                poison(self.readable_slice_mut(0), count);
            } else {
                poison(self.readable_slice_mut(0), slice_len);
                let rem = count - slice_len;
                poison(self.readable_slice_mut(slice_len), rem);
            }
        }

        let mut head = self.head + count;
        if B::POWERS_OF_TWO {
            // Note it is safe to do a wrapping subtract as
            // bitwise & with all 1s is a noop
            head &= self.buf_len().wrapping_sub(1);
        } else {
            head %= self.buf_len();
        }
        self.head = head;
        self.count -= count;
    }

    /// Read the next item from the fifo
    pub fn read_item(&mut self) -> Option<T> {
        if self.count == 0 {
            return None;
        }
        // SAFETY: buf[head] is in the readable region (count > 0); we move it
        // out and immediately discard(1), so the slot is never read again.
        let c = unsafe { ptr::read(self.buf.as_slice().as_ptr().add(self.head)) };
        self.discard(1);
        Some(c)
    }

    /// Read data from the fifo into `dst`, returns number of items copied.
    pub fn read(&mut self, dst: &mut [T]) -> usize
    where
        T: Copy,
    {
        let total = dst.len();
        let mut dst_left = &mut dst[..];

        while !dst_left.is_empty() {
            let slice = self.readable_slice(0);
            if slice.is_empty() {
                break;
            }
            let n = slice.len().min(dst_left.len());
            dst_left[..n].copy_from_slice(&slice[..n]);
            // NLL drops `slice` borrow here before `&mut self`.
            self.discard(n);
            dst_left = &mut dst_left[n..];
        }

        total - dst_left.len()
    }

    /// Returns number of items available in fifo
    #[inline]
    pub fn writable_length(&self) -> usize {
        self.buf_len() - self.count
    }

    /// Returns the first section of writable buffer.
    /// Note that this may be of length 0.
    pub fn writable_slice(&mut self, offset: usize) -> &mut [T] {
        let buf_len = self.buf_len();
        if offset > buf_len {
            return &mut [];
        }
        let head = self.head;
        let count = self.count;
        let writable = buf_len - count;
        let buf = self.buf.as_mut_slice();
        let tail = head + offset + count;
        if tail < buf_len {
            &mut buf[tail..]
        } else {
            let start = tail - buf_len;
            &mut buf[start..start + (writable - offset)]
        }
    }

    /// Returns a writable buffer of at least `size` items, allocating memory as needed.
    /// Use `fifo.update` once you've written data to it.
    pub fn writable_with_size(&mut self, size: usize) -> Result<&mut [T], AllocError> {
        self.ensure_unused_capacity(size)?;

        // try to avoid realigning buffer
        // reshaped for borrowck — check len, drop borrow, maybe
        // realign, then take the final borrow.
        if self.writable_slice(0).len() < size {
            self.realign();
        }
        let slice = self.writable_slice(0);
        debug_assert!(slice.len() >= size);
        Ok(&mut slice[..size])
    }

    /// Update the tail location of the buffer (usually follows use of writable/writableWithSize)
    pub fn update(&mut self, count: usize) {
        debug_assert!(self.count + count <= self.buf_len());
        self.count += count;
    }

    /// Appends the data in `src` to the fifo.
    /// You must have ensured there is enough space.
    pub fn write_assume_capacity(&mut self, src: &[T])
    where
        T: Copy,
    {
        debug_assert!(self.writable_length() >= src.len());

        let mut src_left = src;
        while !src_left.is_empty() {
            // reshaped for borrowck — scoped block drops the
            // `writable` borrow before `self.update`.
            let n = {
                let writable = self.writable_slice(0);
                debug_assert!(!writable.is_empty());
                let n = writable.len().min(src_left.len());
                writable[..n].copy_from_slice(&src_left[..n]);
                n
            };
            self.update(n);
            src_left = &src_left[n..];
        }
    }

    /// Write a single item to the fifo
    pub fn write_item(&mut self, item: T) -> Result<(), AllocError> {
        self.ensure_unused_capacity(1)?;
        self.write_item_assume_capacity(item);
        Ok(())
    }

    pub fn write_item_assume_capacity(&mut self, item: T) {
        let mut tail = self.head + self.count;
        if B::POWERS_OF_TWO {
            tail &= self.buf_len() - 1;
        } else {
            tail %= self.buf_len();
        }
        // SAFETY: `tail` is in-bounds (capacity reserved by caller). The slot is
        // logically uninitialized — `ptr::write` does not drop the prior
        // bit-pattern, which is required for non-`Copy` `T` whose backing
        // storage is `MaybeUninit<T>`.
        unsafe { ptr::write(self.buf.as_mut_slice().as_mut_ptr().add(tail), item) };
        self.update(1);
    }

    /// Appends the data in `src` to the fifo.
    /// Allocates more memory as necessary
    pub fn write(&mut self, src: &[T]) -> Result<(), AllocError>
    where
        T: Copy,
    {
        self.ensure_unused_capacity(src.len())?;
        self.write_assume_capacity(src);
        Ok(())
    }

    /// Make `count` items available before the current read location
    fn rewind(&mut self, count: usize) {
        debug_assert!(self.writable_length() >= count);

        let mut head = self.head + (self.buf_len() - count);
        if B::POWERS_OF_TWO {
            head &= self.buf_len() - 1;
        } else {
            head %= self.buf_len();
        }
        self.head = head;
        self.count += count;
    }

    /// Place data back into the read stream
    pub fn unget(&mut self, src: &[T]) -> Result<(), AllocError>
    where
        T: Copy,
    {
        self.ensure_unused_capacity(src.len())?;

        self.rewind(src.len());

        // reshaped for borrowck — copy into first chunk in a scoped
        // block, drop borrow, then re-borrow for the wrapped chunk.
        let slice_len = {
            let s = self.readable_slice_mut(0);
            let n = s.len().min(src.len());
            s[..n].copy_from_slice(&src[..n]);
            s.len()
        };
        if src.len() > slice_len {
            let slice2 = self.readable_slice_mut(slice_len);
            slice2[..src.len() - slice_len].copy_from_slice(&src[slice_len..]);
        }
        Ok(())
    }

    /// Returns the item at `offset`.
    /// Asserts offset is within bounds.
    pub fn peek_item(&self, offset: usize) -> T
    where
        T: Copy,
    {
        debug_assert!(offset < self.count);

        let mut index = self.head + offset;
        if B::POWERS_OF_TWO {
            index &= self.buf_len() - 1;
        } else {
            index %= self.buf_len();
        }
        self.buf.as_slice()[index]
    }

    /// Returns the item at `offset`.
    /// Asserts offset is within bounds.
    pub fn peek_item_mut(&mut self, offset: usize) -> &mut T {
        debug_assert!(offset < self.count);

        let mut index = self.head + offset;
        if B::POWERS_OF_TWO {
            index &= self.buf_len() - 1;
        } else {
            index %= self.buf_len();
        }
        &mut self.buf.as_mut_slice()[index]
    }

    /// Remove one item at `offset` and MOVE all items after it up one.
    pub fn ordered_remove_item(&mut self, offset: usize) {
        if offset == 0 {
            return self.discard(1);
        }

        debug_assert!(offset < self.count);

        let buf_len = self.buf_len();
        let head = self.head;
        let count = self.count;

        if buf_len - head >= count {
            // If it doesnt overflow past the end, there is one copy to be done
            let buf = self.buf.as_mut_slice();
            shift_down_one(&mut buf[head + offset..]);
        } else {
            let mut index = head + offset;
            if B::POWERS_OF_TWO {
                index &= buf_len - 1;
            } else {
                index %= buf_len;
            }
            // Length of the wrapped prefix `buf[0..wrap_len)`. The readable
            // region is split into the tail `buf[head..buf_len)` and this
            // prefix; `wrap_len <= head` (since `count <= buf_len`) so the
            // prefix never overlaps the tail.
            let wrap_len = head + count - buf_len;
            let buf = self.buf.as_mut_slice();
            if index < head {
                // If the item to remove is before the head, one slice is moved.
                shift_down_one(&mut buf[index..wrap_len]);
            } else {
                // The items before and after the head have to be shifted
                // SAFETY: buf[0] is initialized (it's in the wrapped readable
                // region); we move it to the end after shifting.
                let wrap = unsafe { ptr::read(buf.as_ptr()) };
                shift_down_one(&mut buf[index..]);
                // SAFETY: writing into the last slot; previous occupant already
                // shifted down.
                unsafe { ptr::write(buf.as_mut_ptr().add(buf_len - 1), wrap) };
                shift_down_one(&mut buf[..wrap_len]);
            }
        }
        self.count -= 1;
    }
}

// ── Reader/Writer adapters ────────────────────────────────────────────────────

impl<B: LinearFifoBuffer<u8>> std::io::Read for LinearFifo<u8, B> {
    /// Drains up to `dst.len()` buffered bytes. `Ok(0)` means
    /// the fifo is empty (EOF, never an error).
    #[inline]
    fn read(&mut self, dst: &mut [u8]) -> std::io::Result<usize> {
        Ok(LinearFifo::read(self, dst))
    }
}

impl<B: LinearFifoBuffer<u8>> std::io::Write for LinearFifo<u8, B> {
    /// Appends the buffer, growing if `.Dynamic`. Fixed-capacity buffers
    /// follow the `std::io::Write` contract: write what fits and return the
    /// count (`Ok(0)` when full — `write_all` turns that into `WriteZero`).
    /// `ErrorKind::OutOfMemory` is reserved for dynamic-growth allocation
    /// failure.
    #[inline]
    fn write(&mut self, src: &[u8]) -> std::io::Result<usize> {
        let src = if B::DYNAMIC {
            src
        } else {
            &src[..src.len().min(self.writable_length())]
        };
        LinearFifo::write(self, src)
            .map_err(|AllocError| std::io::Error::from(std::io::ErrorKind::OutOfMemory))?;
        Ok(src.len())
    }

    #[inline]
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Enables `write!(fifo, ...)`.
impl<B: LinearFifoBuffer<u8>> core::fmt::Write for LinearFifo<u8, B> {
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        LinearFifo::write(self, s.as_bytes()).map_err(|AllocError| core::fmt::Error)
    }
}

/// Canonical in-tree byte sink (re-exported as
/// `bun_io::Write`), so a `LinearFifo<u8, _>` can be passed to every
/// `impl bun_io::Write` consumer. `written_len` keeps its panicking default:
/// a fifo drains, so it does not track total bytes written.
impl<B: LinearFifoBuffer<u8>> bun_core::write::Write for LinearFifo<u8, B> {
    /// Appends the whole buffer, growing if `.Dynamic`.
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<(), bun_core::Error> {
        LinearFifo::write(self, buf)?;
        Ok(())
    }
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    type DynFifoU8 = LinearFifo<u8, DynamicBuffer<u8>>;

    // Drives `realign()` down its wrapped-rotation branch (the `else` arm with
    // the tmp scratch loop). Growing a wrapped Dynamic fifo is the only path
    // that reaches it: write 8, read 6, write 5 leaves head=6 count=7 in an
    // 8-slot buffer, then a further write forces a grow → realign.
    #[test]
    fn realign_wrapped_rotation_preserves_contents() {
        let mut fifo = DynFifoU8::init();
        fifo.write(b"abcdefgh").unwrap();
        for _ in 0..6 {
            fifo.read_item().unwrap();
        }
        fifo.write(b"ijklm").unwrap();
        assert_eq!(fifo.buf_len(), 8);
        assert!(fifo.buf_len() - fifo.head < fifo.count, "must be wrapped");

        fifo.write(b"nop").unwrap();

        assert_eq!(fifo.head, 0);
        let mut out = [0u8; 16];
        let n = fifo.read(&mut out);
        assert_eq!(&out[..n], b"ghijklmnop");
    }

    #[test]
    fn discard_zero_from_empty_buffer_should_not_error_on_overflow() {
        let mut fifo = DynFifoU8::init();
        // If overflow is not explicitly allowed this will crash in debug / safe mode
        fifo.discard(0);
    }

    #[test]
    fn linear_fifo_u8_dynamic() {
        let mut fifo = DynFifoU8::init();

        fifo.write(b"HELLO").unwrap();
        assert_eq!(5usize, fifo.readable_length());
        assert_eq!(b"HELLO", fifo.readable_slice(0));

        {
            for i in 0..5 {
                fifo.write(&[fifo.peek_item(i)]).unwrap();
            }
            assert_eq!(10usize, fifo.readable_length());
            assert_eq!(b"HELLOHELLO", fifo.readable_slice(0));
        }

        {
            assert_eq!(b'H', fifo.read_item().unwrap());
            assert_eq!(b'E', fifo.read_item().unwrap());
            assert_eq!(b'L', fifo.read_item().unwrap());
            assert_eq!(b'L', fifo.read_item().unwrap());
            assert_eq!(b'O', fifo.read_item().unwrap());
        }
        assert_eq!(5usize, fifo.readable_length());

        {
            // Writes that wrap around
            assert_eq!(11usize, fifo.writable_length());
            assert_eq!(6usize, fifo.writable_slice(0).len());
            fifo.write_assume_capacity(b"6<chars<11");
            assert_eq!(b"HELLO6<char", fifo.readable_slice(0));
            assert_eq!(b"s<11", fifo.readable_slice(11));
            assert_eq!(b"11", fifo.readable_slice(13));
            assert_eq!(b"", fifo.readable_slice(15));
            fifo.discard(11);
            assert_eq!(b"s<11", fifo.readable_slice(0));
            fifo.discard(4);
            assert_eq!(0usize, fifo.readable_length());
        }

        {
            let buf = fifo.writable_with_size(12).unwrap();
            assert_eq!(12usize, buf.len());
            for i in 0..10 {
                buf[i] = i as u8 + b'a';
            }
            fifo.update(10);
            assert_eq!(b"abcdefghij", fifo.readable_slice(0));
        }

        {
            fifo.unget(b"prependedstring").unwrap();
            let mut result = [0u8; 30];
            let n = fifo.read(&mut result);
            assert_eq!(b"prependedstringabcdefghij", &result[..n]);
            fifo.unget(b"b").unwrap();
            fifo.unget(b"a").unwrap();
            let n = fifo.read(&mut result);
            assert_eq!(b"ab", &result[..n]);
        }

        {
            use core::fmt::Write as _;
            write!(fifo, "{}, {}!", "Hello", "World").unwrap();
            let mut result = [0u8; 30];
            let n = fifo.read(&mut result);
            assert_eq!(b"Hello, World!", &result[..n]);
            assert_eq!(0usize, fifo.readable_length());
        }

        {
            std::io::Write::write_all(&mut fifo, b"This is a test").unwrap();
            let mut drained = Vec::new();
            std::io::Read::read_to_end(&mut fifo, &mut drained).unwrap();
            let words: Vec<&[u8]> = drained.split(|&c| c == b' ').collect();
            assert_eq!(vec![&b"This"[..], b"is", b"a", b"test"], words);
        }
    }

    // Shared body for the T×buffer_type matrix below.
    fn run_generic_fifo_test<T, B>(mut fifo: LinearFifo<T, B>)
    where
        T: Copy + PartialEq + core::fmt::Debug + From<u8>,
        B: LinearFifoBuffer<T>,
    {
        let zero = T::from(0u8);
        let one = T::from(1u8);

        fifo.write(&[zero, one, one, zero, one]).unwrap();
        assert_eq!(5usize, fifo.readable_length());

        {
            assert_eq!(zero, fifo.read_item().unwrap());
            assert_eq!(one, fifo.read_item().unwrap());
            assert_eq!(one, fifo.read_item().unwrap());
            assert_eq!(zero, fifo.read_item().unwrap());
            assert_eq!(one, fifo.read_item().unwrap());
            assert_eq!(0usize, fifo.readable_length());
        }

        {
            fifo.write_item(one).unwrap();
            fifo.write_item(one).unwrap();
            fifo.write_item(one).unwrap();
            assert_eq!(3usize, fifo.readable_length());
        }

        {
            let mut read_buf = [zero; 3];
            let n = fifo.read(&mut read_buf);
            assert_eq!(3usize, n); // NOTE: It should be the number of items.
        }
    }

    // The element types are crossed with both buffer kinds.
    #[test]
    fn linear_fifo_generic_matrix() {
        macro_rules! per_type {
            ($($T:ty),* $(,)?) => {$(
                run_generic_fifo_test(LinearFifo::<$T, StaticBuffer<$T, 32>>::init());
                run_generic_fifo_test(LinearFifo::<$T, DynamicBuffer<$T>>::init());
            )*};
        }
        per_type!(u8, u16, u64);
    }

    // 16-slot static buffer: `POWERS_OF_TWO` is true, matching the in-tree
    // `weak_refs` FIFO in the dev server's source-map store (cap 16), the one
    // real caller of `ordered_remove_item`. `i32` elements make every shift
    // observable (distinct values), unlike a buffer of repeated bytes.
    type WrapFifo = LinearFifo<i32, StaticBuffer<i32, 16>>;

    /// Drains the FIFO into a `Vec` without mutating it, preserving FIFO order.
    fn fifo_to_vec(fifo: &WrapFifo) -> Vec<i32> {
        (0..fifo.readable_length())
            .map(|i| fifo.peek_item(i))
            .collect()
    }

    // Regression for the wrapped-branch bounds bug: `ordered_remove_item` used
    // `count - head` / `head - count` for the wrapped-prefix length instead of
    // the correct `head + count - buf_len`. In wrapped layouts that panics with
    // an out-of-range slice index (and in narrow cases silently corrupts
    // contents). The two sub-branches are `index < head` (item in the wrapped
    // prefix) and `index >= head` (item in the tail segment).
    #[test]
    fn ordered_remove_item_wrapped_tail_branch_head_lt_count() {
        // write 12, read 8, write 10 -> head=8, count=14, buf_len=16.
        let mut fifo = WrapFifo::init();
        for v in 0..12 {
            fifo.write_item(v).unwrap();
        }
        for _ in 0..8 {
            fifo.read_item().unwrap();
        }
        for v in 100..110 {
            fifo.write_item(v).unwrap();
        }

        // Precondition: readable region wraps, and head < count.
        assert_eq!(fifo.head, 8);
        assert_eq!(fifo.count, 14);
        assert_eq!(fifo.buf_len(), 16);
        assert!(fifo.buf_len() - fifo.head < fifo.count);
        assert!(fifo.head < fifo.count);

        let mut expected = fifo_to_vec(&fifo);
        assert_eq!(
            expected,
            vec![
                8, 9, 10, 11, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109
            ]
        );

        // offset 6 -> index = (8 + 6) & 15 = 14 >= head -> tail sub-branch.
        fifo.ordered_remove_item(6);
        expected.remove(6);

        assert_eq!(fifo.readable_length(), 13);
        assert_eq!(fifo_to_vec(&fifo), expected);
        assert_eq!(
            expected,
            vec![8, 9, 10, 11, 100, 101, 103, 104, 105, 106, 107, 108, 109]
        );
    }

    #[test]
    fn ordered_remove_item_wrapped_prefix_branch_head_gt_count() {
        // write 12, read 12, write 8 -> head=12, count=8, buf_len=16.
        let mut fifo = WrapFifo::init();
        for v in 0..12 {
            fifo.write_item(v).unwrap();
        }
        for _ in 0..12 {
            fifo.read_item().unwrap();
        }
        for v in 200..208 {
            fifo.write_item(v).unwrap();
        }

        // Precondition: readable region wraps, and head > count.
        assert_eq!(fifo.head, 12);
        assert_eq!(fifo.count, 8);
        assert_eq!(fifo.buf_len(), 16);
        assert!(fifo.buf_len() - fifo.head < fifo.count);
        assert!(fifo.head > fifo.count);

        let mut expected = fifo_to_vec(&fifo);
        assert_eq!(expected, vec![200, 201, 202, 203, 204, 205, 206, 207]);

        // offset 5 -> index = (12 + 5) & 15 = 1 < head -> wrapped-prefix sub-branch.
        fifo.ordered_remove_item(5);
        expected.remove(5);

        assert_eq!(fifo.readable_length(), 7);
        assert_eq!(fifo_to_vec(&fifo), expected);
        assert_eq!(expected, vec![200, 201, 202, 203, 204, 206, 207]);
    }

    // Exhaustively remove every valid offset from a wrapped layout and compare
    // against a reference `Vec`. Uses a fresh FIFO per offset (remove mutates).
    #[test]
    fn ordered_remove_item_wrapped_all_offsets_match_reference() {
        // Build the same wrapped layout as the tail-branch test: head=8, count=14.
        let build = || {
            let mut fifo = WrapFifo::init();
            for v in 0..12 {
                fifo.write_item(v).unwrap();
            }
            for _ in 0..8 {
                fifo.read_item().unwrap();
            }
            for v in 100..110 {
                fifo.write_item(v).unwrap();
            }
            fifo
        };

        let reference = fifo_to_vec(&build());
        assert!(build().buf_len() - build().head < build().count);

        for offset in 0..reference.len() {
            let mut fifo = build();
            fifo.ordered_remove_item(offset);

            let mut expected = reference.clone();
            expected.remove(offset);

            assert_eq!(
                fifo.readable_length(),
                expected.len(),
                "count must drop by one for offset {offset}"
            );
            assert_eq!(
                fifo_to_vec(&fifo),
                expected,
                "contents mismatch for offset {offset}"
            );
        }
    }
}
