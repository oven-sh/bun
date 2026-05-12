use core::fmt;
use core::ptr::NonNull;
use core::slice;

use crate::string::{self as strings_mod, String as BunString, StringPointer, ZStr};
use bun_simdutf_sys::simdutf;

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
    pub fn init_capacity(cap: usize) -> StringBuilder {
        // allocator.alloc(u8, cap)
        let mut buf = Box::<[u8]>::new_uninit_slice(cap);
        let ptr = NonNull::new(buf.as_mut_ptr().cast::<u8>());
        core::mem::forget(buf);
        StringBuilder { cap, len: 0, ptr }
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
        self.cap += simdutf::length::utf8::from::utf16::le(slice);
    }

    pub fn count16_z(&mut self, slice: &[u16]) {
        // PORT NOTE: WStr has no len method on its DST slice yet; callers pass &[u16].
        // Zig's `elementLengthUTF16IntoUTF8` is the same simdutf length call when input
        // is valid; for WTF-16 with lone surrogates the slow path overestimates by 0-1
        // bytes which is fine for a capacity reservation.
        self.cap += simdutf::length::utf8::from::utf16::le(slice) + 1;
    }

    pub fn append16(&mut self, slice: &[u16]) -> Option<&mut ZStr> {
        // PORT NOTE: fallback_allocator param dropped (global mimalloc).
        // PORT NOTE: borrowck — capture buf ptr, drop the &mut borrow before
        // mutating self.len, then rebuild ZStr from the raw ptr.
        let buf = self.writable();
        let buf_ptr = buf.as_mut_ptr();
        if slice.is_empty() {
            buf[0] = 0;
            self.len += 1;
            // SAFETY: buf_ptr[0] == 0 written above; len 0 excludes the NUL.
            return Some(unsafe { ZStr::from_raw_mut(buf_ptr, 0) });
        }

        let result = simdutf::convert::utf16::to::utf8::with_errors::le(slice, buf);
        if result.status == simdutf::Status::SUCCESS {
            let count = result.count;
            // SAFETY: buf has at least count+1 bytes (count16 reserved them).
            unsafe { *buf_ptr.add(count) = 0 };
            self.len += count + 1;
            // SAFETY: buf_ptr[count] == 0 written above.
            Some(unsafe { ZStr::from_raw_mut(buf_ptr, count) })
        } else {
            // Fallback: WTF-16 → WTF-8 via the slow path that handles lone surrogates.
            // Zig allocated from `fallback_allocator` and handed ownership to the
            // caller; the Rust signature returns a borrow into `self`, so we copy
            // the WTF-8 bytes into the builder's reserved buffer (count16_z reserved
            // enough — simdutf's length estimate is an upper bound for WTF-16) and
            // drop the temporary Vec normally. No `mem::forget`.
            let out = crate::string::strings::to_utf8_alloc(slice);
            let len = out.len();
            let avail = self.cap - self.len;
            if len + 1 > avail {
                return None;
            }
            // SAFETY: buf_ptr points to `avail` writable bytes (self.writable()).
            unsafe {
                core::ptr::copy_nonoverlapping(out.as_ptr(), buf_ptr, len);
                *buf_ptr.add(len) = 0;
            }
            self.len += len + 1;
            // SAFETY: buf_ptr[len] == 0 written above.
            Some(unsafe { ZStr::from_raw_mut(buf_ptr, len) })
        }
    }

    pub fn append_z(&mut self, slice: &[u8]) -> &ZStr {
        debug_assert!(self.len + 1 <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        let start = self.len;
        let dst = self.writable();
        dst[..slice.len()].copy_from_slice(slice);
        dst[slice.len()] = 0;
        self.len += slice.len() + 1;

        debug_assert!(self.len <= self.cap);

        ZStr::from_buf(&self.allocated_slice()[start..], slice.len())
    }

    pub fn append_str(&mut self, str: &BunString) -> &[u8] {
        let slice = str.to_utf8();
        self.append(slice.slice())
    }

    pub fn append(&mut self, slice: &[u8]) -> &[u8] {
        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        let start = self.len;
        let dst = self.writable();
        dst[..slice.len()].copy_from_slice(slice);
        self.len += slice.len();

        debug_assert!(self.len <= self.cap);

        &self.allocated_slice()[start..start + slice.len()]
    }

    /// Copy `slice` into the reserved buffer and return a borrow of the copied
    /// bytes with an *unbound* lifetime. Mirrors Zig's untracked `[]const u8`
    /// return so callers may interleave appends and stash both slices (e.g.
    /// `picohttp::Header::clone`).
    ///
    /// # Safety
    /// The returned slice aliases `self.ptr` and is only valid until the
    /// builder is dropped or `move_to_slice()` is called. Caller must keep the
    /// builder (or the moved-out buffer) alive while the slice is in use.
    pub unsafe fn append_raw<'a>(&mut self, slice: &[u8]) -> &'a [u8] {
        debug_assert!(self.len + slice.len() <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        // Reuse the safe `writable()` accessor for the bounds-checked copy
        // instead of open-coding `ptr.add(len)` + `copy_nonoverlapping` here.
        let dst = &mut self.writable()[..slice.len()];
        dst.copy_from_slice(slice);
        let base = dst.as_ptr();
        self.len += slice.len();

        debug_assert!(self.len <= self.cap);

        // SAFETY: `base..base+slice.len()` was just initialized above and lives
        // for as long as `self.ptr` (heap allocation never moves). The unbound
        // `'a` lifetime is the documented caller contract of `append_raw`.
        unsafe { core::slice::from_raw_parts(base, slice.len()) }
    }

    pub fn add_concat(&mut self, slices: &[&[u8]]) -> StringPointer {
        // PORT NOTE: reshaped for borrowck — capture self.len before borrowing alloc.
        let start = self.len;
        let alloc = self.allocated_slice();
        let mut remain = &mut alloc[start..];
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

        StringPointer {
            offset: start as u32,
            length: len as u32,
        }
    }

    pub fn append_count(&mut self, slice: &[u8]) -> StringPointer {
        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        let start = self.len;
        let dst = self.writable();
        dst[..slice.len()].copy_from_slice(slice);
        self.len += slice.len();

        debug_assert!(self.len <= self.cap);

        StringPointer {
            offset: start as u32,
            length: slice.len() as u32,
        }
    }

    pub fn append_count_z(&mut self, slice: &[u8]) -> StringPointer {
        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        let start = self.len;
        let dst = self.writable();
        dst[..slice.len()].copy_from_slice(slice);
        dst[slice.len()] = 0;
        self.len += slice.len();
        self.len += 1;

        debug_assert!(self.len <= self.cap);

        StringPointer {
            offset: start as u32,
            length: slice.len() as u32,
        }
    }

    pub fn fmt(&mut self, args: fmt::Arguments<'_>) -> &[u8] {
        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        let start = self.len;
        let written = crate::fmt::buf_print_len(self.writable(), args).expect("unreachable");
        self.len += written;

        debug_assert!(self.len <= self.cap);

        &self.allocated_slice()[start..start + written]
    }

    pub fn fmt_append_count(&mut self, args: fmt::Arguments<'_>) -> StringPointer {
        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        let off = self.len;
        let written = crate::fmt::buf_print_len(self.writable(), args).expect("unreachable");
        self.len += written;

        debug_assert!(self.len <= self.cap);

        StringPointer {
            offset: off as u32,
            length: written as u32,
        }
    }

    pub fn fmt_append_count_z(&mut self, args: fmt::Arguments<'_>) -> StringPointer {
        debug_assert!(self.len <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        let off = self.len;
        let written = crate::fmt::buf_print_z(self.writable(), args)
            .expect("unreachable")
            .len();
        self.len += written;
        self.len += 1;

        debug_assert!(self.len <= self.cap);

        StringPointer {
            offset: off as u32,
            length: written as u32,
        }
    }

    pub fn fmt_count(&mut self, args: fmt::Arguments<'_>) {
        self.cap += bun_alloc::fmt_count(args);
    }

    pub fn allocated_slice(&mut self) -> &mut [u8] {
        let Some(ptr) = self.ptr else { return &mut [] };
        debug_assert!(self.cap > 0);
        // SAFETY: ptr was allocated with self.cap bytes.
        unsafe { slice::from_raw_parts_mut(ptr.as_ptr(), self.cap) }
    }

    /// Immutable view of the bytes appended so far (`ptr[0..len]`). Safe wrapper
    /// for the recurring `unsafe { ffi::slice(self.ptr.unwrap().as_ptr(), self.len) }`
    /// pattern at call sites.
    #[inline]
    pub fn written_slice(&self) -> &[u8] {
        let Some(ptr) = self.ptr else { return &[] };
        // SAFETY: `ptr` came from `Box::<[u8]>::new_uninit_slice(self.cap)` in
        // `allocate()`/`init_capacity()`; `self.len <= self.cap` is upheld by
        // every `append*` (debug-asserted there), and bytes `[0, len)` were
        // initialized by those appends. The borrow is tied to `&self`.
        unsafe { slice::from_raw_parts(ptr.as_ptr(), self.len) }
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
        //
        // `take()` first: `*self = Self::default()` drops the old value, and
        // `Drop` frees the buffer when `ptr` is still `Some` — leaving it set
        // here would free the allocation we're about to hand back.
        let Some(ptr) = self.ptr.take() else {
            *self = Self::default();
            return Box::default();
        };
        let cap = self.cap;
        *self = Self::default();
        // SAFETY: ptr came from Box::<[u8]>::new_uninit_slice(cap) leaked above;
        // all `cap` bytes have been written iff caller appended everything counted.
        // TODO(port): if not fully written this reads uninit bytes — Zig didn't care.
        unsafe { crate::heap::take(slice::from_raw_parts_mut(ptr.as_ptr(), cap)) }
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
            crate::heap::destroy::<[core::mem::MaybeUninit<u8>]>(slice::from_raw_parts_mut(
                ptr.as_ptr().cast(),
                self.cap,
            ));
        }
    }
}

// ported from: src/string/StringBuilder.zig
