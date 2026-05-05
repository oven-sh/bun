use bun_alloc::AllocError;
use bun_str::{strings, ZStr};

/// VTable surface for `bun.ast.E.String` (CYCLEBREAK b0: GENUINE upward dep on
/// `bun_js_parser::E::String`). Low tier defines the interface; high tier
/// (`bun_js_parser`) provides `impl EStringRef for E::String`.
/// PERF(port): was inline concrete type — cold path (formatter/writer).
pub trait EStringRef {
    fn is_utf8(&self) -> bool;
    fn slice(&mut self) -> &[u8];
    fn slice16(&mut self) -> &[u16];
}

/// A growable byte buffer. In Zig this paired an `Allocator` with an
/// `ArrayListUnmanaged(u8)`; in Rust the global mimalloc allocator is implicit,
/// so this is a thin wrapper over `Vec<u8>`.
#[derive(Default)]
pub struct MutableString {
    // Zig field `allocator: Allocator` — deleted (global mimalloc).
    pub list: Vec<u8>,
}

impl MutableString {
    pub fn init2048() -> Result<MutableString, AllocError> {
        MutableString::init(2048)
    }

    pub fn clone(&self) -> Result<MutableString, AllocError> {
        MutableString::init_copy(&self.list)
    }

    /// Returns a `std::io::Write` borrow of this buffer.
    /// Zig: `pub const Writer = std.Io.GenericWriter(*@This(), Allocator.Error, writeAll)`.
    pub fn writer(&mut self) -> &mut Self {
        self
    }

    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    // Zig `deinit` only freed `list`; `Vec<u8>` drops automatically — no `Drop` impl needed.

    pub fn owns(&self, items: &[u8]) -> bool {
        // Zig: bun.isSliceInBuffer(items, this.list.items.ptr[0..this.list.capacity])
        bun_core::is_slice_in_buffer(items, self.allocated_slice())
    }

    #[inline]
    pub fn grow_if_needed(&mut self, amount: usize) -> Result<(), AllocError> {
        self.list.reserve(amount);
        Ok(())
    }

    pub fn writable_n_bytes_assume_capacity(&mut self, amount: usize) -> &mut [u8] {
        debug_assert!(self.list.len() + amount <= self.list.capacity());
        let old = self.list.len();
        // SAFETY: capacity checked above; the returned slice is immediately
        // written by the caller (matches Zig semantics where the bytes are
        // uninitialized until written).
        unsafe { self.list.set_len(old + amount) };
        &mut self.list[old..]
    }

    /// Increases the length of the buffer by `amount` bytes, expanding the capacity if necessary.
    /// Returns a pointer to the end of the list - `amount` bytes.
    pub fn writable_n_bytes(&mut self, amount: usize) -> Result<&mut [u8], AllocError> {
        self.grow_if_needed(amount)?;
        Ok(self.writable_n_bytes_assume_capacity(amount))
    }

    pub fn write(&mut self, bytes: impl AsRef<[u8]>) -> Result<usize, AllocError> {
        let bytes = bytes.as_ref();
        debug_assert!(bytes.is_empty() || !bun_core::is_slice_in_buffer(bytes, self.allocated_slice()));
        self.list.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    pub fn buffered_writer(&mut self) -> BufferedWriter<'_> {
        BufferedWriter {
            context: self,
            buffer: [0u8; BufferedWriter::MAX], // PERF(port): Zig left this `undefined`
            pos: 0,
        }
    }

    pub fn init(capacity: usize) -> Result<MutableString, AllocError> {
        Ok(MutableString {
            list: if capacity > 0 {
                Vec::with_capacity(capacity)
            } else {
                Vec::new()
            },
        })
    }

    pub fn init_empty() -> MutableString {
        MutableString { list: Vec::new() }
    }

    #[inline]
    pub fn ensure_unused_capacity(&mut self, amount: usize) -> Result<(), AllocError> {
        // Zig: `pub const ensureUnusedCapacity = growIfNeeded;`
        self.grow_if_needed(amount)
    }

    pub fn init_copy(str: impl AsRef<[u8]>) -> Result<MutableString, AllocError> {
        let str = str.as_ref();
        let mut mutable = MutableString::init(str.len())?;
        mutable.copy(str)?;
        Ok(mutable)
    }

    /// Convert it to an ASCII identifier. Note: If you change this to a non-ASCII
    /// identifier, you're going to potentially cause trouble with non-BMP code
    /// points in target environments that don't support bracketed Unicode escapes.
    pub fn ensure_valid_identifier(str: &[u8]) -> Result<Box<[u8]>, AllocError> {
        // TODO(port): Zig returned `[]const u8` which could be either the input
        // borrow or a fresh allocation. Rust cannot express that without a
        // lifetime + Cow; for now we always return owned `Box<[u8]>` and copy
        // on the borrow paths. Phase B: consider `Cow<'a, [u8]>`.
        if str.is_empty() {
            return Ok(Box::<[u8]>::from(b"_".as_slice()));
        }

        let mut iterator = strings::CodepointIterator::init(str);
        let mut cursor = strings::CodepointIterator::Cursor::default();

        let mut has_needed_gap = false;
        let mut needs_gap;
        let mut start_i: usize = 0;

        if !iterator.next(&mut cursor) {
            return Ok(Box::<[u8]>::from(b"_".as_slice()));
        }

        // TODO(b0): lexer / lexer_tables arrive from move-in (MOVE_DOWN bun_js_parser::{lexer,lexer_tables} → string)
        use crate::lexer_tables as js_lexer_tables;
        use crate::lexer as js_lexer;

        // Common case: no gap necessary. No allocation necessary.
        needs_gap = !js_lexer::is_identifier_start(cursor.c);
        if !needs_gap {
            // Are there any non-alphanumeric chars at all?
            while iterator.next(&mut cursor) {
                if !js_lexer::is_identifier_continue(cursor.c) || cursor.width > 1 {
                    needs_gap = true;
                    start_i = cursor.i as usize;
                    break;
                }
            }
        }

        if !needs_gap {
            let remapped = js_lexer_tables::STRICT_MODE_RESERVED_WORDS_REMAP
                .get(str)
                .copied()
                .unwrap_or(str);
            return Ok(Box::<[u8]>::from(remapped));
        }

        if needs_gap {
            let mut mutable = MutableString::init_copy(if start_i == 0 {
                // the first letter can be a non-identifier start
                // https://github.com/oven-sh/bun/issues/2946
                b"_".as_slice()
            } else {
                &str[0..start_i]
            })?;
            needs_gap = false;

            let items = &str[start_i..];
            iterator = strings::CodepointIterator::init(items);
            cursor = strings::CodepointIterator::Cursor::default();

            while iterator.next(&mut cursor) {
                if js_lexer::is_identifier_continue(cursor.c) && cursor.width == 1 {
                    if needs_gap {
                        mutable.append_char(b'_')?;
                        needs_gap = false;
                        has_needed_gap = true;
                    }
                    let i = cursor.i as usize;
                    let w = cursor.width as usize;
                    mutable.append(&items[i..i + w])?;
                } else if !needs_gap {
                    needs_gap = true;
                    // skip the code point, replace it with a single _
                }
            }

            // If it ends with an emoji
            if needs_gap {
                mutable.append_char(b'_')?;
                needs_gap = false;
                has_needed_gap = true;
            }

            let _ = has_needed_gap;

            if cfg!(debug_assertions) {
                debug_assert!(js_lexer::is_identifier(&mutable.list));
            }

            return Ok(mutable.to_owned_slice());
        }

        Ok(Box::<[u8]>::from(str))
    }

    pub fn len(&self) -> usize {
        self.list.len()
    }

    pub fn copy(&mut self, str: impl AsRef<[u8]>) -> Result<(), AllocError> {
        let str = str.as_ref();
        self.list
            .reserve(str.len().saturating_sub(self.list.len()));

        if self.list.is_empty() {
            // Zig: list.insertSlice(allocator, 0, str)
            self.list.extend_from_slice(str);
        } else {
            // Zig: list.replaceRange(allocator, 0, str.len, str)
            // TODO(port): verify Vec::splice matches ArrayList.replaceRange semantics
            let n = str.len().min(self.list.len());
            self.list[..n].copy_from_slice(&str[..n]);
            if str.len() > n {
                self.list.extend_from_slice(&str[n..]);
            }
        }
        Ok(())
    }

    #[inline]
    pub fn grow_by(&mut self, amount: usize) -> Result<(), AllocError> {
        self.list.reserve(amount);
        Ok(())
    }

    #[inline]
    pub fn append_slice(&mut self, items: &[u8]) -> Result<(), AllocError> {
        self.list.extend_from_slice(items);
        Ok(())
    }

    #[inline]
    pub fn append_slice_exact(&mut self, items: &[u8]) -> Result<(), AllocError> {
        if items.is_empty() {
            return Ok(());
        }
        // Zig: ensureTotalCapacityPrecise(len + items.len) → reserve_exact(items.len())
        self.list.reserve_exact(items.len());
        // PORT NOTE: reshaped for borrowck — Zig wrote via raw end ptr then bumped len.
        let old = self.list.len();
        // SAFETY: capacity reserved above for `items.len()` more bytes.
        unsafe { self.list.set_len(old + items.len()) };
        self.list[old..].copy_from_slice(items);
        Ok(())
    }

    #[inline]
    pub fn reset(&mut self) {
        self.list.clear();
    }

    #[inline]
    pub fn reset_to(&mut self, index: usize) {
        debug_assert!(index <= self.list.capacity());
        // SAFETY: index <= capacity asserted; bytes in [len..index] may be
        // uninitialized — matches Zig semantics. Callers must have previously
        // written those bytes (e.g. via writable_n_bytes).
        unsafe { self.list.set_len(index) };
    }

    pub fn inflate(&mut self, amount: usize) -> Result<(), AllocError> {
        self.list.resize(amount, 0);
        Ok(())
    }

    #[inline]
    pub fn append_char_n_times(&mut self, char: u8, n: usize) -> Result<(), AllocError> {
        // Zig: list.appendNTimes
        self.list.extend(core::iter::repeat_n(char, n));
        Ok(())
    }

    #[inline]
    pub fn append_char(&mut self, char: u8) -> Result<(), AllocError> {
        self.list.push(char);
        Ok(())
    }

    #[inline]
    pub fn append_char_assume_capacity(&mut self, char: u8) {
        // PERF(port): was assume_capacity
        self.list.push(char);
    }

    #[inline]
    pub fn append(&mut self, char: &[u8]) -> Result<(), AllocError> {
        self.list.extend_from_slice(char);
        Ok(())
    }

    #[inline]
    pub fn append_int(&mut self, int: u64) -> Result<(), AllocError> {
        let count = bun_core::fmt::fast_digit_count(int);
        self.list.reserve(count);
        let old = self.list.len();
        // SAFETY: reserved `count` bytes above; fully written below.
        unsafe { self.list.set_len(old + count) };
        let written = {
            use std::io::Write as _;
            let mut buf = &mut self.list[old..old + count];
            write!(&mut buf, "{int}").ok();
            count - buf.len()
        };
        debug_assert!(count == written);
        Ok(())
    }

    #[inline]
    pub fn append_assume_capacity(&mut self, char: &[u8]) {
        // PERF(port): was assume_capacity
        self.list.extend_from_slice(char);
    }

    #[inline]
    pub fn len_i(&self) -> i32 {
        i32::try_from(self.list.len()).unwrap()
    }

    pub fn take_slice(&mut self) -> Vec<u8> {
        core::mem::take(&mut self.list)
    }

    pub fn to_owned_slice(&mut self) -> Box<[u8]> {
        // Zig: bun.handleOom(self.list.toOwnedSlice(self.allocator))
        core::mem::take(&mut self.list).into_boxed_slice()
    }

    pub fn to_dynamic_owned(&mut self) -> Box<[u8]> {
        // TODO(port): Zig `DynamicOwned([]u8)` carried its allocator; with the
        // global allocator this collapses to `Box<[u8]>`. Revisit if a distinct
        // `bun_ptr::DynamicOwned` type is introduced.
        self.to_owned_slice()
    }

    /// `self.allocator` must be `bun.default_allocator`.
    pub fn to_default_owned(&mut self) -> Box<[u8]> {
        // Zig asserted allocator == default_allocator; allocator field is gone.
        self.to_owned_slice()
    }

    pub fn slice(&mut self) -> &mut [u8] {
        &mut self.list
    }

    /// Appends `0` if needed
    pub fn slice_with_sentinel(&mut self) -> &mut ZStr {
        if !self.list.is_empty() && self.list[self.list.len() - 1] != 0 {
            self.list.push(0);
        }
        let len = self.list.len() - 1;
        // SAFETY: self.list[len] == 0 (just pushed or was already there).
        unsafe { ZStr::from_raw_mut(self.list.as_mut_ptr(), len) }
    }

    pub fn to_owned_slice_length(&mut self, length: usize) -> Box<[u8]> {
        // SAFETY: caller guarantees `length` bytes have been initialized.
        unsafe { self.list.set_len(length) };
        self.to_owned_slice()
    }

    pub fn contains_char(&self, char: u8) -> bool {
        self.index_of_char(char).is_some()
    }

    pub fn index_of_char(&self, char: u8) -> Option<u32> {
        strings::index_of_char(&self.list, char)
    }

    pub fn last_index_of_char(&self, char: u8) -> Option<usize> {
        strings::last_index_of_char(&self.list, char)
    }

    pub fn last_index_of(&self, str: u8) -> Option<usize> {
        strings::last_index_of_char(&self.list, str)
    }

    pub fn index_of(&self, str: u8) -> Option<usize> {
        // TODO(port): Zig signature is `str: u8` but body calls
        // `std.mem.indexOf(u8, items, str)` which expects a slice — looks like
        // a latent bug in the Zig source. Porting as single-byte search.
        self.list.iter().position(|&b| b == str)
    }

    pub fn eql(&self, other: &[u8]) -> bool {
        self.list.as_slice() == other
    }

    pub fn to_socket_buffers<const COUNT: usize>(
        &self,
        ranges: [(usize, usize); COUNT],
    ) -> [bun_sys::IoVecConst; COUNT] {
        // TODO(port): `std.posix.iovec_const` mapped to `bun_sys::IoVecConst`;
        // verify exact type name in Phase B.
        // PERF(port): Zig used `inline for` (unrolled); plain loop here.
        let mut buffers: [bun_sys::IoVecConst; COUNT] =
            // SAFETY: every element is written in the loop below before return.
            unsafe { core::mem::zeroed() };
        for (b, r) in buffers.iter_mut().zip(ranges.iter()) {
            let s = &self.list[r.0..r.1];
            *b = bun_sys::IoVecConst {
                iov_base: s.as_ptr(),
                iov_len: s.len(),
            };
        }
        buffers
    }

    pub fn write_all(&mut self, bytes: &[u8]) -> Result<usize, AllocError> {
        self.list.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    /// Helper: full allocated slice `ptr[0..capacity]` (for `owns`/debug asserts).
    fn allocated_slice(&self) -> &[u8] {
        // SAFETY: ptr is valid for `capacity` bytes (Vec invariant). Bytes in
        // [len..capacity] may be uninitialized; this is only used for pointer
        // range comparison, never dereferenced beyond `len`.
        unsafe { core::slice::from_raw_parts(self.list.as_ptr(), self.list.capacity()) }
    }
}

impl std::io::Write for MutableString {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.list.extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub struct BufferedWriter<'a> {
    pub context: &'a mut MutableString,
    pub buffer: [u8; Self::MAX],
    pub pos: usize,
}

impl<'a> BufferedWriter<'a> {
    const MAX: usize = 2048;

    // Zig: `pub const Writer = std.Io.GenericWriter(*BufferedWriter, Allocator.Error, writeAll)`
    // → `impl std::io::Write for BufferedWriter` below; `writer()` returns `&mut Self`.

    #[inline]
    fn remain(&mut self) -> &mut [u8] {
        &mut self.buffer[self.pos..]
    }

    pub fn flush(&mut self) -> Result<(), AllocError> {
        let _ = self.context.write_all(&self.buffer[0..self.pos])?;
        self.pos = 0;
        Ok(())
    }

    pub fn write_all(&mut self, bytes: &[u8]) -> Result<usize, AllocError> {
        let pending = bytes;

        if pending.len() >= Self::MAX {
            self.flush()?;
            self.context.append(pending)?;
            return Ok(pending.len());
        }

        if !pending.is_empty() {
            if pending.len() + self.pos > Self::MAX {
                self.flush()?;
            }
            // PORT NOTE: reshaped for borrowck (cannot call self.remain() while
            // borrowing pending.len() against self.pos).
            let pos = self.pos;
            self.buffer[pos..pos + pending.len()].copy_from_slice(pending);
            self.pos += pending.len();
        }

        Ok(pending.len())
    }

    /// Write a E.String to the buffer.
    /// This automatically encodes UTF-16 into UTF-8 using
    /// the same code path as TextEncoder
    pub fn write_string(
        &mut self,
        bytes: &mut dyn EStringRef,
    ) -> Result<usize, AllocError> {
        // CYCLEBREAK(b0): was `&mut bun_js_parser::E::String`; now vtable dispatch.
        if bytes.is_utf8() {
            return self.write_all(bytes.slice());
        }

        self.write_all16(bytes.slice16())
    }

    /// Write a UTF-16 string to the (UTF-8) buffer
    /// This automatically encodes UTF-16 into UTF-8 using
    /// the same code path as TextEncoder
    pub fn write_all16(&mut self, bytes: &[u16]) -> Result<usize, AllocError> {
        let pending = bytes;

        if pending.len() >= Self::MAX {
            self.flush()?;
            self.context.list.reserve(bytes.len() * 2);
            // PORT NOTE: Zig wrote into `this.remain()[0..bytes.len*2]` here,
            // which after `flush()` is `this.buffer[0..bytes.len*2]` — but
            // `bytes.len*2 > MAX`, so that indexes past the stack buffer. This
            // looks like a latent bug in the Zig (should write into
            // `context.list`). Porting the apparent intent: write into the
            // freshly-reserved context.list tail.
            // TODO(port): confirm and fix upstream.
            let old = self.context.list.len();
            // SAFETY: reserved bytes.len*2 above; copy_utf16_into_utf8 writes
            // `decoded.written` bytes which we then trim to.
            unsafe { self.context.list.set_len(old + bytes.len() * 2) };
            let decoded =
                strings::copy_utf16_into_utf8(&mut self.context.list[old..], bytes);
            // SAFETY: decoded.written <= bytes.len*2.
            unsafe { self.context.list.set_len(old + decoded.written as usize) };
            return Ok(pending.len());
        }

        if !pending.is_empty() {
            if (pending.len() * 2) + self.pos > Self::MAX {
                self.flush()?;
            }
            let pos = self.pos;
            let decoded = strings::copy_utf16_into_utf8(
                &mut self.buffer[pos..pos + bytes.len() * 2],
                bytes,
            );
            self.pos += decoded.written as usize;
        }

        Ok(pending.len())
    }

    pub fn write_html_attribute_value_string(
        &mut self,
        str: &mut dyn EStringRef,
    ) -> Result<(), AllocError> {
        // CYCLEBREAK(b0): was `&mut bun_js_parser::E::String`; now vtable dispatch.
        if str.is_utf8() {
            self.write_html_attribute_value(str.slice())?;
            return Ok(());
        }

        self.write_html_attribute_value16(str.slice16())
    }

    pub fn write_html_attribute_value(&mut self, bytes: &[u8]) -> Result<(), AllocError> {
        let mut items = bytes;
        while !items.is_empty() {
            // TODO: SIMD
            if let Some(j) = strings::index_of_any(items, b"\"<>") {
                let _ = self.write_all(&items[0..j])?;
                let _ = match items[j] {
                    b'"' => self.write_all(b"&quot;")?,
                    b'<' => self.write_all(b"&lt;")?,
                    b'>' => self.write_all(b"&gt;")?,
                    _ => unreachable!(),
                };

                items = &items[j + 1..];
                continue;
            }

            let _ = self.write_all(items)?;
            break;
        }
        Ok(())
    }

    pub fn write_html_attribute_value16(&mut self, bytes: &[u16]) -> Result<(), AllocError> {
        let mut items = bytes;
        while !items.is_empty() {
            if let Some(j) = strings::index_of_any16(items, b"\"<>") {
                // this won't handle strings larger than 4 GB
                // that's fine though, 4 GB of SSR'd HTML is quite a lot...
                let _ = self.write_all16(&items[0..j])?;
                let _ = match items[j] {
                    c if c == '"' as u16 => self.write_all(b"&quot;")?,
                    c if c == '<' as u16 => self.write_all(b"&lt;")?,
                    c if c == '>' as u16 => self.write_all(b"&gt;")?,
                    _ => unreachable!(),
                };

                items = &items[j + 1..];
                continue;
            }

            let _ = self.write_all16(items)?;
            break;
        }
        Ok(())
    }

    pub fn writer(&mut self) -> &mut Self {
        self
    }
}

impl<'a> std::io::Write for BufferedWriter<'a> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.write_all(buf)
            .map_err(|_| std::io::ErrorKind::OutOfMemory.into())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        BufferedWriter::flush(self).map_err(|_| std::io::ErrorKind::OutOfMemory.into())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/MutableString.zig (473 lines)
//   confidence: medium
//   todos:      7
//   notes:      Allocator field dropped (global mimalloc); ensure_valid_identifier returns owned Box<[u8]> instead of borrow-or-owned (consider Cow); write_all16 large-path looks buggy upstream — ported intent, flagged.
// ──────────────────────────────────────────────────────────────────────────
