// clone of zig stdlib
// except, this one vectorizes

// FIFO of fixed size items
// Usually used for e.g. byte buffers

use core::marker::PhantomData;
use core::mem::{self, MaybeUninit};

use bun_alloc::AllocError;

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
///
/// The storage is exposed as `&[MaybeUninit<T>]`: only the `[head, head+count)`
/// ring-subrange is initialized at any time, and the fifo's accessors are the
/// sole place that narrows that to `&[T]`.
pub trait LinearFifoBuffer<T> {
    const POWERS_OF_TWO: bool;
    const DYNAMIC: bool;

    fn storage(&self) -> &[MaybeUninit<T>];
    fn storage_mut(&mut self) -> &mut [MaybeUninit<T>];
    #[inline]
    fn len(&self) -> usize {
        self.storage().len()
    }

    /// Reallocate to exactly `new_size` elements, preserving the prefix.
    /// Static/Slice variants are unreachable (callers gate on `DYNAMIC`).
    fn realloc(&mut self, _new_size: usize) -> Result<(), AllocError> {
        unreachable!("realloc on non-Dynamic LinearFifo buffer")
    }
}

// ── .Static ───────────────────────────────────────────────────────────────────

/// `buffer_type == .Static` — inline `[MaybeUninit<T>; N]` storage.
pub struct StaticBuffer<T, const N: usize>([MaybeUninit<T>; N]);

impl<T, const N: usize> LinearFifoBuffer<T> for StaticBuffer<T, N> {
    const POWERS_OF_TWO: bool = N.is_power_of_two();
    const DYNAMIC: bool = false;

    #[inline]
    fn storage(&self) -> &[MaybeUninit<T>] {
        &self.0
    }
    #[inline]
    fn storage_mut(&mut self) -> &mut [MaybeUninit<T>] {
        &mut self.0
    }
}

// ── .Slice ────────────────────────────────────────────────────────────────────

/// `buffer_type == .Slice` — caller-provided `[MaybeUninit<T>]`.
pub struct SliceBuffer<'a, T>(&'a mut [MaybeUninit<T>]);

impl<'a, T> LinearFifoBuffer<T> for SliceBuffer<'a, T> {
    const POWERS_OF_TWO: bool = false; // Any size slice could be passed in
    const DYNAMIC: bool = false;

    #[inline]
    fn storage(&self) -> &[MaybeUninit<T>] {
        self.0
    }
    #[inline]
    fn storage_mut(&mut self) -> &mut [MaybeUninit<T>] {
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
    fn storage(&self) -> &[MaybeUninit<T>] {
        &self.0
    }
    #[inline]
    fn storage_mut(&mut self) -> &mut [MaybeUninit<T>] {
        &mut self.0
    }

    fn realloc(&mut self, new_size: usize) -> Result<(), AllocError> {
        // Box→Vec is alloc-free; Vec's grow path does the prefix-preserving
        // bitwise copy internally (sound for MaybeUninit<T> regardless of T).
        // try_reserve_exact + restore on Err preserves the old buffer on OOM
        // so head/count never describe freed storage during unwind.
        let old_len = self.0.len();
        let mut v: Vec<MaybeUninit<T>> = mem::take(&mut self.0).into_vec();
        if new_size > old_len {
            if let Err(_) = v.try_reserve_exact(new_size - old_len) {
                self.0 = v.into_boxed_slice(); // restore
                return Err(AllocError);
            }
            v.resize_with(new_size, MaybeUninit::uninit);
        } else {
            v.truncate(new_size); // MaybeUninit drop is a no-op
        }
        self.0 = v.into_boxed_slice();
        Ok(())
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
    pub fn init(buf: &'a mut [MaybeUninit<T>]) -> Self {
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
        if self.head == 0 {
            return;
        }
        let buf_len = self.buf_len();
        let head = self.head;
        let count = self.count;
        let storage = self.buf.storage_mut();
        if buf_len - head >= count {
            // Non-wrapped: rotate only the prefix that contains live data.
            // (rotate_left is O(head+count) vs the previous O(count) memmove;
            // a `T: Copy` `copy_within` fast-path would need specialization.
            // realign is only reached from grow/shrink/contiguous-miss paths.)
            storage[..head + count].rotate_left(head);
        } else {
            storage.rotate_left(head);
        }
        self.head = 0;
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
            // After realign(), head==0; realloc preserves the [0..count) prefix.
            self.buf.realloc(new_size)?;
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
        let storage = self.buf.storage_mut();
        let mut start = head + offset;
        let raw = if start >= buf_len {
            start -= buf_len;
            &mut storage[start..start + (count - offset)]
        } else {
            let end = (head + count).min(buf_len);
            &mut storage[start..end]
        };
        // SAFETY: every slot in the [head, head+count) ring-range is
        // initialized; `raw` is a subslice of that range (offset <= count).
        unsafe { raw.assume_init_mut() }
    }

    /// Returns a readable slice from `offset`
    pub fn readable_slice(&self, offset: usize) -> &[T] {
        if offset > self.count {
            return &[];
        }
        let buf_len = self.buf_len();
        let storage = self.buf.storage();
        let mut start = self.head + offset;
        let raw = if start >= buf_len {
            start -= buf_len;
            &storage[start..start + (self.count - offset)]
        } else {
            let end = (self.head + self.count).min(buf_len);
            &storage[start..end]
        };
        // SAFETY: every slot in the [head, head+count) ring-range is
        // initialized; `raw` is a subslice of that range (offset <= count).
        unsafe { raw.assume_init_ref() }
    }

    /// The two contiguous initialized halves of the ring buffer, in logical
    /// order — `(a, b)` such that `a ++ b` is the readable sequence. Mirrors
    /// `VecDeque::as_mut_slices` but at the `MaybeUninit` layer (used only
    /// internally for in-place permutations, so no `assume_init` needed).
    fn readable_segments_mut(&mut self) -> (&mut [MaybeUninit<T>], &mut [MaybeUninit<T>]) {
        let buf_len = self.buf_len();
        let head = self.head;
        let count = self.count;
        let storage = self.buf.storage_mut();
        if buf_len - head >= count {
            (&mut storage[head..head + count], &mut [][..])
        } else {
            let wrap_len = count - (buf_len - head);
            let (front, back) = storage.split_at_mut(head);
            (back, &mut front[..wrap_len])
        }
    }

    /// Discard first `count` items in the fifo
    pub fn discard(&mut self, count: usize) {
        debug_assert!(count <= self.count);
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
        let head = self.head;
        // SAFETY: storage[head] is in the readable region (count > 0); we move
        // it out and immediately discard(1), so the slot is never read as T
        // again before being rewritten.
        let c = unsafe { self.buf.storage()[head].assume_init_read() };
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
    pub fn writable_slice(&mut self, offset: usize) -> &mut [MaybeUninit<T>] {
        let buf_len = self.buf_len();
        if offset > buf_len {
            return &mut [];
        }
        let head = self.head;
        let count = self.count;
        let writable = buf_len - count;
        let storage = self.buf.storage_mut();
        let tail = head + offset + count;
        if tail < buf_len {
            &mut storage[tail..]
        } else {
            let start = tail - buf_len;
            &mut storage[start..start + (writable - offset)]
        }
    }

    /// Returns a writable buffer of at least `size` items, allocating memory as needed.
    /// Use `fifo.update` once you've written data to it.
    // TODO(port): narrow error set
    pub fn writable_with_size(&mut self, size: usize) -> Result<&mut [MaybeUninit<T>], AllocError> {
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
                writable[..n].write_copy_of_slice(&src_left[..n]);
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
        self.buf.storage_mut()[tail].write(item);
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


    /// Place data back into the read stream
    // TODO(port): narrow error set
    pub fn unget(&mut self, src: &[T]) -> Result<(), AllocError>
    where
        T: Copy,
    {
        self.ensure_unused_capacity(src.len())?;

        // Compute where the rewound head will land, fill those (currently
        // uninitialized) slots first, then commit head/count. Avoids forming
        // `&mut [T]` over uninit storage via `readable_slice_mut`.
        let buf_len = self.buf_len();
        let mut new_head = self.head + (buf_len - src.len());
        if B::POWERS_OF_TWO {
            new_head &= buf_len - 1;
        } else {
            new_head %= buf_len;
        }
        let storage = self.buf.storage_mut();
        let first_len = (buf_len - new_head).min(src.len());
        storage[new_head..new_head + first_len].write_copy_of_slice(&src[..first_len]);
        if src.len() > first_len {
            storage[..src.len() - first_len].write_copy_of_slice(&src[first_len..]);
        }
        self.head = new_head;
        self.count += src.len();
        Ok(())
    }

    /// Returns the item at `offset`.
    /// Asserts offset is within bounds.
    pub fn peek_item(&self, offset: usize) -> T
    where
        T: Copy,
    {
        debug_assert!(offset < self.count);
        self.readable_slice(offset)[0]
    }

    /// Returns the item at `offset`.
    /// Asserts offset is within bounds.
    pub fn peek_item_mut(&mut self, offset: usize) -> &mut T {
        debug_assert!(offset < self.count);
        &mut self.readable_slice_mut(offset)[0]
    }

    /// Remove one item at `offset` and MOVE all items after it up one.
    ///
    /// The removed element is **not** dropped (matches the Zig original) — it
    /// is left in the now-unreadable tail slot. Only use with `T` that has no
    /// drop glue, or follow up with explicit cleanup.
    pub fn ordered_remove_item(&mut self, offset: usize) {
        if offset == 0 {
            return self.discard(1);
        }
        debug_assert!(offset < self.count);

        let (a, b) = self.readable_segments_mut();
        if offset < a.len() {
            a[offset..].rotate_left(1);
            if !b.is_empty() {
                mem::swap(a.last_mut().unwrap(), &mut b[0]);
                b.rotate_left(1);
            }
        } else {
            b[offset - a.len()..].rotate_left(1);
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
        R: FnMut(&mut [MaybeUninit<T>]) -> Result<usize, E>,
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
    /// As [`writable_with_size`] but zero-fills the returned region and hands
    /// it back as `&mut [u8]`. For callers (websocket frame assembly) that
    /// pass the buffer to APIs taking `&mut [u8]` and read-modify-write it.
    pub fn writable_with_size_zeroed(&mut self, size: usize) -> Result<&mut [u8], AllocError> {
        Ok(self.writable_with_size(size)?.write_filled(0u8))
    }

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
                buf[i].write(i as u8 + b'a');
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
        let mut fifo = LinearFifo::<u8, StaticBuffer<u8, 32>>::init();

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

    #[test]
    fn ordered_remove_across_wrap() {
        // Exercise the segment-swap path: cap 8, head 5, count 6 → wrap at 3.
        let mut fifo = LinearFifo::<u32, StaticBuffer<u32, 8>>::init();
        for i in 0..8 {
            fifo.write_item(i).unwrap();
        }
        for _ in 0..5 {
            fifo.read_item();
        }
        // readable = [5,6,7] then write 3 more → [5,6,7,100,101,102], head=5
        fifo.write_item(100).unwrap();
        fifo.write_item(101).unwrap();
        fifo.write_item(102).unwrap();
        assert_eq!(6, fifo.readable_length());
        // remove offset 1 (value 6) → [5,7,100,101,102]
        fifo.ordered_remove_item(1);
        let mut out = [0u32; 5];
        assert_eq!(5, fifo.read(&mut out));
        assert_eq!([5, 7, 100, 101, 102], out);
    }
}

// ported from: src/collections/linear_fifo.zig
