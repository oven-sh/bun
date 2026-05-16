// clone of zig stdlib
// except, this one vectorizes

// FIFO of fixed size items
// Usually used for e.g. byte buffers

use core::marker::PhantomData;
use core::mem::{self, MaybeUninit};
use core::ptr;

use bun_alloc::AllocError;

// TODO(port): std.heap.page_size_min — Zig resolves this per-target; 4096 is the
// conservative minimum on every platform Bun ships on.
const PAGE_SIZE_MIN: usize = 4096;

/// Mirrors Zig's `LinearFifoBufferType = union(enum)`.
///
/// In the Zig original this is a *comptime* value that selects a struct layout
/// (`buf: [N]T` vs `buf: []T`, `std.mem.Allocator` param vs `void`). Rust cannot
/// branch struct layout on a const-generic enum payload, so dispatch is done
/// via the [`LinearFifoBuffer`] trait below; this enum is kept for API parity.
pub enum LinearFifoBufferType {
    /// The buffer is internal to the fifo; it is of the specified size.
    Static(usize),
    /// The buffer is passed as a slice to the initialiser.
    Slice,
    /// The buffer is managed dynamically using a `mem.Allocator`.
    Dynamic,
}

/// Backing-storage abstraction replacing Zig's `comptime buffer_type` switch.
/// `POWERS_OF_TWO` mirrors the Zig `powers_of_two` const inside the returned
/// struct; `DYNAMIC` mirrors `buffer_type == .Dynamic`.
// TODO(port): the Zig fn returns structurally different layouts per variant;
// trait+assoc-consts is the closest stable-Rust encoding. Phase B: confirm all
// in-tree callers are covered by the three impls below.
pub trait LinearFifoBuffer<T> {
    const POWERS_OF_TWO: bool;
    const DYNAMIC: bool;

    fn as_slice(&self) -> &[T];
    fn as_mut_slice(&mut self) -> &mut [T];
    #[inline]
    fn len(&self) -> usize {
        self.as_slice().len()
    }

    /// Reallocate to exactly `new_size` elements, preserving the prefix.
    /// Static/Slice variants are unreachable (callers gate on `DYNAMIC`).
    fn realloc(&mut self, _new_size: usize) -> Result<(), AllocError> {
        unreachable!("realloc on non-Dynamic LinearFifo buffer")
    }

    /// Allocate fresh storage of `new_size` and return the old buffer so the
    /// caller can copy out of it before drop.
    fn alloc_swap(&mut self, _new_size: usize) -> Result<Box<[MaybeUninit<T>]>, AllocError> {
        unreachable!("alloc_swap on non-Dynamic LinearFifo buffer")
    }
}

/// Reinterpret `&[MaybeUninit<T>]` as `&[T]`. `MaybeUninit<T>` has identical
/// layout to `T`; exposing uninitialized bytes as `T` is sound only when any
/// bit pattern is a valid `T` (in-tree LinearFifo users are byte buffers —
/// see the `StaticBuffer` TODO below). Centralises the four per-buffer-kind
/// casts behind one audited block.
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
    if slice.len() <= 1 {
        return;
    }
    // SAFETY: src `[1..len)` and dst `[0..len-1)` are both in-bounds of
    // `slice`; `ptr::copy` handles the overlap.
    unsafe { ptr::copy(slice.as_ptr().add(1), slice.as_mut_ptr(), slice.len() - 1) };
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
// TODO(port): Zig leaves the array `undefined`; we use MaybeUninit and expose
// it as &[T] via pointer cast. Sound only for `T` whose any-bit-pattern is
// valid (in-tree users are byte buffers). Phase B: bound `T: Copy` or rework
// accessors to MaybeUninit if a non-POD T appears.
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

// ── .Slice ────────────────────────────────────────────────────────────────────

/// `buffer_type == .Slice` — caller-provided `[]T`.
pub struct SliceBuffer<'a, T>(&'a mut [T]);

impl<'a, T> LinearFifoBuffer<T> for SliceBuffer<'a, T> {
    const POWERS_OF_TWO: bool = false; // Any size slice could be passed in
    const DYNAMIC: bool = false;

    #[inline]
    fn as_slice(&self) -> &[T] {
        self.0
    }
    #[inline]
    fn as_mut_slice(&mut self) -> &mut [T] {
        self.0
    }
}

// ── .Dynamic ──────────────────────────────────────────────────────────────────

/// `buffer_type == .Dynamic` — heap-allocated, growable.
///
/// Zig stores `std.mem.Allocator` param + `buf: []T`. Per §Allocators (non-AST
/// crate) the allocator param is dropped and global mimalloc backs `Box`.
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

    fn realloc(&mut self, new_size: usize) -> Result<(), AllocError> {
        // Zig: `self.allocator.realloc(self.buf, size)` preserving prefix.
        let mut new = Box::<[T]>::new_uninit_slice(new_size);
        let n = self.0.len().min(new_size);
        // SAFETY: disjoint allocations; MaybeUninit copy is always sound.
        unsafe { ptr::copy_nonoverlapping(self.0.as_ptr(), new.as_mut_ptr(), n) };
        self.0 = new;
        Ok(())
    }

    fn alloc_swap(&mut self, new_size: usize) -> Result<Box<[MaybeUninit<T>]>, AllocError> {
        let new = Box::<[T]>::new_uninit_slice(new_size);
        Ok(mem::replace(&mut self.0, new))
    }
}

// ── LinearFifo ────────────────────────────────────────────────────────────────

pub struct LinearFifo<T, B: LinearFifoBuffer<T>> {
    // Zig field `allocator` is folded into `B` (or dropped) — see DynamicBuffer.
    buf: B,
    head: usize,
    count: usize,
    _marker: PhantomData<T>,
}

// PORT NOTE: Zig's `SliceSelfArg = if (.Static) *Self else Self` exists because
// returning a slice into a by-value `Self` would dangle when buf is inline. In
// Rust every accessor takes `&self`/`&mut self`, so the distinction disappears.

// TODO(port): Reader/Writer std.Io adapters. Zig exposes
// `pub const Reader = std.Io.GenericReader(*Self, error{}, readFn)` and a
// matching Writer. Phase B: impl `bun_io::Read`/`bun_io::Write` (and
// `core::fmt::Write`) on `LinearFifo<u8, B>`.

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

impl<'a, T> LinearFifo<T, SliceBuffer<'a, T>> {
    /// `init` for `.Slice`.
    pub fn init(buf: &'a mut [T]) -> Self {
        Self {
            buf: SliceBuffer(buf),
            head: 0,
            count: 0,
            _marker: PhantomData,
        }
    }
}

impl<T> LinearFifo<T, DynamicBuffer<T>> {
    /// `init` for `.Dynamic`. Zig takes `std.mem.Allocator` param; dropped per
    /// §Allocators (non-AST crate).
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

    /// Allocated capacity of the backing buffer (Zig: `fifo.buf.len`).
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
    /// no-op when items remain. Mirrors the `head = 0` post-drain idiom in
    /// `src/jsc/Task.zig` `tickQueueWithCount`.
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
            let buf = self.buf.as_mut_slice();
            // SAFETY: src/dst within same allocation; ptr::copy is memmove.
            unsafe { ptr::copy(buf.as_ptr().add(head), buf.as_mut_ptr(), count) };
            self.head = 0;
        } else {
            // Zig: `var tmp: [page_size_min / 2 / @sizeOf(T)]T = undefined;`
            // Stable Rust cannot size a stack array by `size_of::<T>()`, so use
            // a fixed byte scratch and compute the element count at runtime.
            // PERF(port): was stack array sized by page_size/2/sizeof(T) — same
            // byte footprint here, no heap.
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
                let buf = self.buf.as_mut_slice();
                // SAFETY: `tmp` is disjoint from `buf`. The tmp↔buf copies move
                // `n * size_of::<T>()` raw bytes (no `T` typed access through
                // the 1-aligned scratch). The buf→buf shift overlaps, so use
                // `ptr::copy` (memmove); it operates on properly-aligned `*T`.
                unsafe {
                    ptr::copy_nonoverlapping(buf.as_ptr().cast::<u8>(), tmp_ptr, n * t_size);
                    ptr::copy(buf.as_ptr().add(n), buf.as_mut_ptr(), m);
                    ptr::copy_nonoverlapping(
                        tmp_ptr,
                        buf.as_mut_ptr().add(m).cast::<u8>(),
                        n * t_size,
                    );
                }
                self.head -= n;
            }
        }
        // set unused area to undefined
        #[cfg(debug_assertions)]
        {
            let count = self.count;
            let unused = &mut self.buf.as_mut_slice()[count..];
            // SAFETY: poisoning unused tail; matches Zig `@memset(unused, undefined)`.
            unsafe {
                ptr::write_bytes(
                    unused.as_mut_ptr().cast::<u8>(),
                    0xAA,
                    unused.len() * mem::size_of::<T>(),
                );
            }
        }
    }

    /// Reduce allocated capacity to `size`.
    pub fn shrink(&mut self, size: usize) {
        debug_assert!(size >= self.count);
        if B::DYNAMIC {
            self.realign();
            match self.buf.realloc(size) {
                Ok(()) => {}
                Err(AllocError) => return, // no problem, capacity is still correct then.
            }
        }
    }

    #[deprecated(note = "deprecated; call `ensure_unused_capacity` or `ensure_total_capacity`")]
    pub fn ensure_capacity(&mut self, _size: usize) {
        // Zig: `pub const ensureCapacity = @compileError(...)`
        unreachable!("deprecated; call ensure_unused_capacity or ensure_total_capacity");
    }

    /// Ensure that the buffer can fit at least `size` items
    // TODO(port): narrow error set
    pub fn ensure_total_capacity(&mut self, size: usize) -> Result<(), AllocError> {
        if self.buf_len() >= size {
            return Ok(());
        }
        if B::DYNAMIC {
            self.realign();
            let new_size = if B::POWERS_OF_TWO {
                // math.ceilPowerOfTwo(usize, size) catch return error.OutOfMemory
                size.checked_next_power_of_two().ok_or(AllocError)?
            } else {
                size
            };
            // Zig: alloc new, memcpy readableSlice(0) bytes, free old.
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
            // PORT NOTE: reshaped for borrowck — capture len, then re-borrow.
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
            // PORT NOTE: NLL drops `slice` borrow here before `&mut self`.
            self.discard(n);
            dst_left = &mut dst_left[n..];
        }

        total - dst_left.len()
    }

    // TODO(port): `pub fn reader(self: *Self) Reader` — see Reader/Writer note.

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
    // TODO(port): narrow error set
    pub fn writable_with_size(&mut self, size: usize) -> Result<&mut [T], AllocError> {
        self.ensure_unused_capacity(size)?;

        // try to avoid realigning buffer
        // PORT NOTE: reshaped for borrowck — check len, drop borrow, maybe
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
            // PORT NOTE: reshaped for borrowck — scoped block drops the
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
    // TODO(port): narrow error set
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
        // logically uninitialized — `ptr::write` matches Zig assignment semantics
        // (no drop of the prior bit-pattern), required for non-`Copy` `T` whose
        // backing storage is `MaybeUninit<T>`.
        unsafe { ptr::write(self.buf.as_mut_slice().as_mut_ptr().add(tail), item) };
        self.update(1);
    }

    /// Appends the data in `src` to the fifo.
    /// Allocates more memory as necessary
    // TODO(port): narrow error set
    pub fn write(&mut self, src: &[T]) -> Result<(), AllocError>
    where
        T: Copy,
    {
        self.ensure_unused_capacity(src.len())?;
        self.write_assume_capacity(src);
        Ok(())
    }

    // TODO(port): `pub fn writer(self: *Self) Writer` — see Reader/Writer note.

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
    // TODO(port): narrow error set
    pub fn unget(&mut self, src: &[T]) -> Result<(), AllocError>
    where
        T: Copy,
    {
        self.ensure_unused_capacity(src.len())?;

        self.rewind(src.len());

        // PORT NOTE: reshaped for borrowck — copy into first chunk in a scoped
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
            let buf = self.buf.as_mut_slice();
            if index < head {
                // If the item to remove is before the head, one slice is moved.
                shift_down_one(&mut buf[index..count - head]);
            } else {
                // The items before and after the head have to be shifted
                // SAFETY: buf[0] is initialized (it's in the wrapped readable
                // region); we move it to the end after shifting.
                let wrap = unsafe { ptr::read(buf.as_ptr()) };
                shift_down_one(&mut buf[index..]);
                // SAFETY: writing into the last slot; previous occupant already
                // shifted down.
                unsafe { ptr::write(buf.as_mut_ptr().add(buf_len - 1), wrap) };
                shift_down_one(&mut buf[..head - count]);
            }
        }
        self.count -= 1;
    }

    /// Pump data from a reader into a writer
    /// stops when reader returns 0 bytes (EOF)
    /// Buffer size must be set before calling; a buffer length of 0 is invalid.
    // TODO(port): `src_reader: anytype, dest_writer: *std.Io.Writer`. Phase B:
    // bind to `bun_io::Read`/`bun_io::Write` (or whatever the byte-stream traits
    // land as). Stubbed with generic bounds matching the called methods.
    pub fn pump<R, W, E>(&mut self, mut src_reader: R, dest_writer: &mut W) -> Result<(), E>
    where
        R: FnMut(&mut [T]) -> Result<usize, E>,
        W: FnMut(&[T]) -> Result<usize, E>,
    {
        debug_assert!(self.buf_len() > 0);
        loop {
            if self.writable_length() > 0 {
                // PORT NOTE: reshaped for borrowck.
                let n = {
                    let ws = self.writable_slice(0);
                    src_reader(ws)?
                };
                if n == 0 {
                    break; // EOF
                }
                self.update(n);
            }
            let written = {
                let rs = self.readable_slice(0);
                dest_writer(rs)?
            };
            self.discard(written);
        }
        // flush remaining data
        while self.readable_length() > 0 {
            let written = {
                let rs = self.readable_slice(0);
                dest_writer(rs)?
            };
            self.discard(written);
        }
        Ok(())
    }
}

// PORT NOTE: Zig's `Reader = std.Io.GenericReader(*Self, error{}, readFn)` /
// `Writer` typedefs constrain T == u8 at the type level. In Rust that
// constraint is expressed by a separate impl block on `LinearFifo<u8, _>`, not
// a `where B: LinearFifoBuffer<u8>` bound on the generic impl (which would not
// constrain `T`).
impl<B: LinearFifoBuffer<u8>> LinearFifo<u8, B> {
    /// Same as `read` except it returns an error union
    /// The purpose of this function existing is to match `std.io.Reader` API.
    fn read_fn(&mut self, dest: &mut [u8]) -> Result<usize, core::convert::Infallible> {
        Ok(self.read(dest))
    }

    /// Same as `write` except it returns the number of bytes written, which is always the same
    /// as `bytes.len`. The purpose of this function existing is to match `std.io.Writer` API.
    fn append_write(&mut self, bytes: &[u8]) -> Result<usize, AllocError> {
        self.write(bytes)?;
        Ok(bytes.len())
    }
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    type DynFifoU8 = LinearFifo<u8, DynamicBuffer<u8>>;

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

        fifo.shrink(0);

        // TODO(port): writer().print / reader().readUntilDelimiterOrEof tests
        // depend on the std.Io adapter port.

        // TODO(port): pump test depends on std.io.fixedBufferStream port.
    }

    // `inline for ([_]type{u1,u8,u16,u64}) |T|` × `inline for (buffer types)`
    // — expanded for one representative element type; the rest are mechanical.
    // TODO(port): macro-generate the full T×buffer_type matrix in Phase B.
    #[test]
    fn linear_fifo_generic_u8_static() {
        let mut fifo: LinearFifo<u8, StaticBuffer<u8, 32>> = LinearFifo::init();

        fifo.write(&[0, 1, 1, 0, 1]).unwrap();
        assert_eq!(5usize, fifo.readable_length());

        {
            assert_eq!(0u8, fifo.read_item().unwrap());
            assert_eq!(1u8, fifo.read_item().unwrap());
            assert_eq!(1u8, fifo.read_item().unwrap());
            assert_eq!(0u8, fifo.read_item().unwrap());
            assert_eq!(1u8, fifo.read_item().unwrap());
            assert_eq!(0usize, fifo.readable_length());
        }

        {
            fifo.write_item(1).unwrap();
            fifo.write_item(1).unwrap();
            fifo.write_item(1).unwrap();
            assert_eq!(3usize, fifo.readable_length());
        }

        {
            let mut read_buf = [0u8; 3];
            let n = fifo.read(&mut read_buf);
            assert_eq!(3usize, n); // NOTE: It should be the number of items.
        }
    }
}

// ported from: src/collections/linear_fifo.zig
