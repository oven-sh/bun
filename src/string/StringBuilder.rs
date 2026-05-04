use core::fmt;
use core::ptr::NonNull;
use core::slice;

use bun_str::{self as strings_mod, ZStr, String as BunString, StringPointer};
// TODO(port): verify `bun.StringPointer` lives in bun_str (it's `bun.StringPointer` in Zig)
// TODO(port): verify `bun.simdutf` crate path
use bun_simdutf as simdutf;

/// Two-phase string builder: callers first `count()` every slice they will
/// append, then `allocate()` once, then `append()` each slice. Returned slices
/// point into the single backing buffer.
///
// TODO(port): the `append*` methods return `&[u8]` borrowing `self.ptr` while
// also taking `&mut self`. Zig hands out aliasing slices freely; in Rust this
// needs either an explicit `'a` on the builder, interior mutability (`Cell<usize>`
// for len), or callers must use `StringPointer` offsets instead. Phase B decision.
#[derive(Default)]
pub struct StringBuilder {
    pub len: usize,
    pub cap: usize,
    pub ptr: Option<NonNull<u8>>,
}

impl StringBuilder {
    pub fn init_capacity(cap: usize) -> Result<StringBuilder, bun_alloc::AllocError> {
        // allocator.alloc(u8, cap)
        let mut buf = Box::<[u8]>::new_uninit_slice(cap);
        let ptr = NonNull::new(buf.as_mut_ptr().cast::<u8>());
        core::mem::forget(buf);
        Ok(StringBuilder { cap, len: 0, ptr })
    }

    pub fn count_z(&mut self, slice: &[u8]) {
        self.cap += slice.len() + 1;
    }

    pub fn count(&mut self, slice: &[u8]) {
        self.cap += slice.len();
    }

    pub fn allocate(&mut self) -> Result<(), bun_alloc::AllocError> {
        let mut buf = Box::<[u8]>::new_uninit_slice(self.cap);
        self.ptr = NonNull::new(buf.as_mut_ptr().cast::<u8>());
        core::mem::forget(buf);
        self.len = 0;
        Ok(())
    }

    pub fn count16(&mut self, slice: &[u16]) {
        let result = simdutf::length::utf8::from_utf16_le(slice);
        self.cap += result;
    }

    pub fn count16_z(&mut self, slice: &bun_str::WStr) {
        let result = bun_str::strings::element_length_utf16_into_utf8(slice);
        self.cap += result + 1;
    }

    pub fn append16(&mut self, slice: &[u16]) -> Option<&mut ZStr> {
        // PORT NOTE: fallback_allocator param dropped (global mimalloc).
        let buf = self.writable();
        if slice.is_empty() {
            buf[0] = 0;
            self.len += 1;
            // SAFETY: buf[0] == 0 written above; len 0 excludes the NUL.
            return Some(unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), 0) });
        }

        let result = simdutf::convert::utf16::to_utf8_with_errors_le(slice, buf);
        if result.status == simdutf::Status::Success {
            let count = result.count;
            buf[count] = 0;
            self.len += count + 1;
            // SAFETY: buf[count] == 0 written above.
            Some(unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), count) })
        } else {
            // Fallback: WTF-16 → UTF-8 via the slow path that handles lone surrogates.
            let mut list: Vec<u8> = Vec::new();
            let out = match bun_str::strings::to_utf8_list_with_type_bun(&mut list, slice, false) {
                Ok(v) => v,
                Err(_) => return None,
            };
            if out.try_reserve(1).is_err() {
                return None;
            }
            out.push(0);
            // TODO(port): Zig returns `out.items[0 .. out.items.len - 1 :0]`, i.e. a
            // slice into a heap Vec that the *caller* now owns (leaked from this fn's
            // perspective — fallback_allocator owned it). Phase B: decide ownership.
            let len = out.len() - 1;
            let ptr = out.as_mut_ptr();
            core::mem::forget(core::mem::take(out));
            // SAFETY: ptr[len] == 0 pushed above; buffer leaked so it outlives the return.
            Some(unsafe { ZStr::from_raw_mut(ptr, len) })
        }
    }

    pub fn append_z(&mut self, slice: &[u8]) -> &ZStr {
        debug_assert!(self.len + 1 <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        // SAFETY: ptr was allocated with cap bytes; len+slice.len()+1 <= cap asserted.
        let base = unsafe { self.ptr.unwrap().as_ptr().add(self.len) };
        let dst = unsafe { slice::from_raw_parts_mut(base, self.cap - self.len) };
        dst[..slice.len()].copy_from_slice(slice);
        dst[slice.len()] = 0;
        // SAFETY: dst[slice.len()] == 0 written above.
        let result = unsafe { ZStr::from_raw(base, slice.len()) };
        self.len += slice.len() + 1;

        debug_assert!(self.len <= self.cap);

        result
    }

    pub fn append_str(&mut self, str: &BunString) -> &[u8] {
        let slice = str.to_utf8();
        self.append(slice.as_bytes())
        // `slice` (Utf8Slice) drops here — Drop frees if it owned a transcoded buffer.
    }

    pub fn append(&mut self, slice: &[u8]) -> &[u8] {
        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        // SAFETY: ptr allocated with cap bytes; bounds asserted above.
        let base = unsafe { self.ptr.unwrap().as_ptr().add(self.len) };
        let dst = unsafe { slice::from_raw_parts_mut(base, self.cap - self.len) };
        dst[..slice.len()].copy_from_slice(slice);
        // SAFETY: base..base+slice.len() was just written.
        let result = unsafe { slice::from_raw_parts(base, slice.len()) };
        self.len += slice.len();

        debug_assert!(self.len <= self.cap);

        result
    }

    pub fn add_concat(&mut self, slices: &[&[u8]]) -> StringPointer {
        // PORT NOTE: reshaped for borrowck — capture base ptr instead of reslicing `remain`.
        let alloc = self.allocated_slice();
        let mut remain = &mut alloc[self.len..];
        let mut len: usize = 0;
        for slice in slices {
            remain[..slice.len()].copy_from_slice(slice);
            remain = &mut remain[slice.len()..];
            len += slice.len();
        }
        self.add(len)
    }

    pub fn add(&mut self, len: usize) -> StringPointer {
        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        let start = self.len;
        self.len += len;

        debug_assert!(self.len <= self.cap);

        StringPointer { offset: start as u32, length: len as u32 }
    }

    pub fn append_count(&mut self, slice: &[u8]) -> StringPointer {
        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        let start = self.len;
        // SAFETY: ptr allocated with cap bytes; bounds asserted above.
        let base = unsafe { self.ptr.unwrap().as_ptr().add(self.len) };
        let dst = unsafe { slice::from_raw_parts_mut(base, self.cap - self.len) };
        dst[..slice.len()].copy_from_slice(slice);
        let _result = &dst[..slice.len()];
        self.len += slice.len();

        debug_assert!(self.len <= self.cap);

        StringPointer { offset: start as u32, length: slice.len() as u32 }
    }

    pub fn append_count_z(&mut self, slice: &[u8]) -> StringPointer {
        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        let start = self.len;
        // SAFETY: ptr allocated with cap bytes; bounds asserted above.
        let base = unsafe { self.ptr.unwrap().as_ptr().add(self.len) };
        let dst = unsafe { slice::from_raw_parts_mut(base, self.cap - self.len) };
        dst[..slice.len()].copy_from_slice(slice);
        dst[slice.len()] = 0;
        let _result = &dst[..slice.len()];
        self.len += slice.len();
        self.len += 1;

        debug_assert!(self.len <= self.cap);

        StringPointer { offset: start as u32, length: slice.len() as u32 }
    }

    pub fn fmt(&mut self, args: fmt::Arguments<'_>) -> &[u8] {
        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        // SAFETY: ptr allocated with cap bytes.
        let base = unsafe { self.ptr.unwrap().as_ptr().add(self.len) };
        let buf = unsafe { slice::from_raw_parts_mut(base, self.cap - self.len) };
        let written = buf_print(buf, args).expect("unreachable");
        // SAFETY: base..base+written was just written by buf_print.
        let out = unsafe { slice::from_raw_parts(base, written) };
        self.len += written;

        debug_assert!(self.len <= self.cap);

        out
    }

    pub fn fmt_append_count(&mut self, args: fmt::Arguments<'_>) -> StringPointer {
        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        // SAFETY: ptr allocated with cap bytes.
        let base = unsafe { self.ptr.unwrap().as_ptr().add(self.len) };
        let buf = unsafe { slice::from_raw_parts_mut(base, self.cap - self.len) };
        let written = buf_print(buf, args).expect("unreachable");
        let off = self.len;
        self.len += written;

        debug_assert!(self.len <= self.cap);

        StringPointer { offset: off as u32, length: written as u32 }
    }

    pub fn fmt_append_count_z(&mut self, args: fmt::Arguments<'_>) -> StringPointer {
        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        // SAFETY: ptr allocated with cap bytes.
        let base = unsafe { self.ptr.unwrap().as_ptr().add(self.len) };
        let buf = unsafe { slice::from_raw_parts_mut(base, self.cap - self.len) };
        let written = buf_print_z(buf, args).expect("unreachable");
        let off = self.len;
        self.len += written;
        self.len += 1;

        debug_assert!(self.len <= self.cap);

        StringPointer { offset: off as u32, length: written as u32 }
    }

    pub fn fmt_count(&mut self, args: fmt::Arguments<'_>) {
        self.cap += fmt_count_bytes(args);
    }

    pub fn allocated_slice(&mut self) -> &mut [u8] {
        let Some(ptr) = self.ptr else { return &mut [] };
        debug_assert!(self.cap > 0);
        // SAFETY: ptr was allocated with self.cap bytes.
        unsafe { slice::from_raw_parts_mut(ptr.as_ptr(), self.cap) }
    }

    pub fn writable(&mut self) -> &mut [u8] {
        let Some(ptr) = self.ptr else { return &mut [] };
        debug_assert!(self.cap > 0);
        // SAFETY: ptr was allocated with self.cap bytes; len <= cap.
        unsafe { slice::from_raw_parts_mut(ptr.as_ptr().add(self.len), self.cap - self.len) }
    }

    /// Transfer ownership of the underlying memory to a slice.
    ///
    /// After calling this, you are responsible for freeing the underlying memory.
    /// This StringBuilder should not be used after calling this function.
    pub fn move_to_slice(&mut self) -> Box<[u8]> {
        // TODO(port): Zig wrote into `*[]u8` out-param and reset self. Here we
        // reconstruct the Box (allocated in init_capacity/allocate) and hand it back.
        let Some(ptr) = self.ptr else {
            *self = Self::default();
            return Box::default();
        };
        let cap = self.cap;
        *self = Self::default();
        // SAFETY: ptr came from Box::<[u8]>::new_uninit_slice(cap) leaked above;
        // all `cap` bytes have been written iff caller appended everything counted.
        // TODO(port): if not fully written this reads uninit bytes — Zig didn't care.
        unsafe { Box::from_raw(slice::from_raw_parts_mut(ptr.as_ptr(), cap)) }
    }
}

impl Drop for StringBuilder {
    fn drop(&mut self) {
        let Some(ptr) = self.ptr else { return };
        if self.cap == 0 {
            return;
        }
        // SAFETY: ptr came from Box::<[MaybeUninit<u8>]>::new_uninit_slice(self.cap)
        // leaked in init_capacity/allocate; reconstruct to free via global allocator.
        unsafe {
            drop(Box::<[core::mem::MaybeUninit<u8>]>::from_raw(
                slice::from_raw_parts_mut(ptr.as_ptr().cast(), self.cap),
            ));
        }
    }
}

// ── local helpers (std.fmt.bufPrint / bufPrintZ / count equivalents) ──────────

/// `std.fmt.bufPrint`: write formatted args into `buf`, return bytes written.
fn buf_print(buf: &mut [u8], args: fmt::Arguments<'_>) -> Result<usize, fmt::Error> {
    let mut cursor = SliceWriter { buf, pos: 0 };
    fmt::write(&mut cursor, args)?;
    Ok(cursor.pos)
}

/// `std.fmt.bufPrintZ`: like buf_print but writes a trailing NUL (not counted in return).
fn buf_print_z(buf: &mut [u8], args: fmt::Arguments<'_>) -> Result<usize, fmt::Error> {
    let n = buf_print(buf, args)?;
    if n >= buf.len() {
        return Err(fmt::Error);
    }
    buf[n] = 0;
    Ok(n)
}

/// `std.fmt.count`: count bytes the formatted args would produce.
fn fmt_count_bytes(args: fmt::Arguments<'_>) -> usize {
    struct Counter(usize);
    impl fmt::Write for Counter {
        fn write_str(&mut self, s: &str) -> fmt::Result {
            self.0 += s.len();
            Ok(())
        }
    }
    let mut c = Counter(0);
    let _ = fmt::write(&mut c, args);
    c.0
}

struct SliceWriter<'a> {
    buf: &'a mut [u8],
    pos: usize,
}

impl fmt::Write for SliceWriter<'_> {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        let bytes = s.as_bytes();
        let end = self.pos + bytes.len();
        if end > self.buf.len() {
            return Err(fmt::Error);
        }
        self.buf[self.pos..end].copy_from_slice(bytes);
        self.pos = end;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/StringBuilder.zig (253 lines)
//   confidence: medium
//   todos:      5
//   notes:      append* return slices aliasing &mut self — Phase B must pick lifetime/Cell strategy; simdutf/StringPointer crate paths guessed
// ──────────────────────────────────────────────────────────────────────────
