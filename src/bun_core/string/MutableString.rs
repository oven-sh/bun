use crate::string::ZStr;
use crate::strings;
use bun_alloc::AllocError;

/// VTable surface for `bun.ast.E.String` (CYCLEBREAK b0: GENUINE upward dep on
/// `bun_ast::E::String`). Low tier defines the interface; high tier
/// (`bun_js_parser`) provides `impl EStringRef for E::String`.
/// Dyn dispatch is acceptable: cold path (formatter/writer).
pub trait EStringRef {
    fn is_utf8(&self) -> bool;
    fn slice(&mut self) -> &[u8];
    fn slice16(&mut self) -> &[u16];
}

/// Layout-identical to POSIX `struct iovec` with a const base
/// (`{ base: *const u8, len: usize }`), used unconditionally on every target —
/// it does NOT alias `uv_buf_t`/`WSABUF` on Windows (those have reversed field
/// order and a `u32` len). `to_socket_buffers` returns this shape on all
/// platforms, so there is no `cfg(windows)` split.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct SocketBuffer {
    pub iov_base: *const u8,
    pub iov_len: usize,
}

/// A growable byte buffer: a thin wrapper over `Vec<u8>` (the global mimalloc
/// allocator is implicit).
#[derive(Default, Clone)]
pub struct MutableString {
    pub list: Vec<u8>,
}

// The `bun_collections::pool::ObjectPoolType` impl
// lives in `bun_collections` (trait owner) to avoid a `bun_core →
// bun_collections` dep cycle now that `MutableString` is in `bun_core`.

impl MutableString {
    pub fn init2048() -> Result<MutableString, AllocError> {
        MutableString::init(2048)
    }

    /// Snake-case alias of [`init2048`] for callers that spell it `init_2048`.
    #[inline]
    pub fn init_2048() -> Result<MutableString, AllocError> {
        MutableString::init(2048)
    }

    pub fn clone(&self) -> Result<MutableString, AllocError> {
        MutableString::init_copy(&self.list)
    }

    /// Returns a `std::io::Write` borrow of this buffer.
    pub fn writer(&mut self) -> &mut Self {
        self
    }

    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    // `Vec<u8>` drops automatically — no `Drop` impl needed.

    /// Set `len = capacity` so callers
    /// can index into the spare region (e.g. `read()` into `&mut list[n..]`).
    ///
    /// Callers must treat `list[old_len..]` as write-only until overwritten
    /// (typically by `read()`).
    #[inline]
    pub fn expand_to_capacity(&mut self) {
        // Zero only the spare region so the exposed tail is defined (avoids
        // CWE-908 uninit-memory exposure if a caller reads before write).
        let old = self.list.len();
        self.list.resize(self.list.capacity(), 0);
        debug_assert_eq!(self.list.len(), self.list.capacity());
        let _ = old;
    }

    pub fn owns(&self, items: &[u8]) -> bool {
        // Pointer-range check against the full allocation; done with addresses
        // rather than forming a `&[u8]` over `[len..cap)` (uninit) bytes.
        let base = self.list.as_ptr() as usize;
        let item = items.as_ptr() as usize;
        base <= item && item + items.len() <= base + self.list.capacity()
    }

    #[inline]
    pub fn grow_if_needed(&mut self, amount: usize) -> Result<(), AllocError> {
        self.list.reserve(amount);
        Ok(())
    }

    pub fn writable_n_bytes_assume_capacity(&mut self, amount: usize) -> &mut [u8] {
        // SAFETY: caller has reserved at least `amount` bytes of spare capacity
        // (debug-asserted in the callee) and fully writes the returned slice
        // before reading it.
        unsafe { crate::vec::writable_slice_assume_capacity(&mut self.list, amount) }
    }

    /// Increases the length of the buffer by `amount` bytes, expanding the capacity if necessary.
    /// Returns a pointer to the end of the list - `amount` bytes.
    pub fn writable_n_bytes(&mut self, amount: usize) -> Result<&mut [u8], AllocError> {
        self.grow_if_needed(amount)?;
        Ok(self.writable_n_bytes_assume_capacity(amount))
    }

    pub fn write(&mut self, bytes: impl AsRef<[u8]>) -> Result<usize, AllocError> {
        let bytes = bytes.as_ref();
        debug_assert!(bytes.is_empty() || !self.owns(bytes));
        self.list.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    pub fn buffered_writer(&mut self) -> BufferedWriter<'_> {
        BufferedWriter {
            context: self,
            buffer: [0u8; BufferedWriter::MAX],
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
        self.grow_if_needed(amount)
    }

    pub fn init_copy(str: impl AsRef<[u8]>) -> Result<MutableString, AllocError> {
        let str = str.as_ref();
        let mut mutable = MutableString::init(str.len())?;
        mutable.copy(str)?;
        Ok(mutable)
    }

    /// Convert `str` to a valid ES identifier, replacing any run of non
    /// `ID_Continue` code points with a single `_`. Valid Unicode identifier
    /// code points (including non-BMP) are preserved.
    pub fn ensure_valid_identifier(str: &[u8]) -> Result<Box<[u8]>, AllocError> {
        // The result could be either the input borrow or a fresh allocation;
        // rather than a lifetime + Cow we always return owned `Box<[u8]>` and
        // copy on the borrow paths.
        if str.is_empty() {
            return Ok(Box::<[u8]>::from(b"_".as_slice()));
        }

        let mut iterator = strings::CodepointIterator::init(str);
        let mut cursor = strings::Cursor::default();

        let mut has_needed_gap = false;
        let mut needs_gap;
        let mut start_i: usize = 0;

        if !iterator.next(&mut cursor) {
            return Ok(Box::<[u8]>::from(b"_".as_slice()));
        }

        use crate::string::lexer as js_lexer;
        use crate::string::lexer_tables as js_lexer_tables;

        // Common case: no gap necessary. No allocation necessary.
        needs_gap = !js_lexer::is_identifier_start(cursor.c as u32);
        if !needs_gap {
            // Are there any non-alphanumeric chars at all?
            while iterator.next(&mut cursor) {
                if !js_lexer::is_identifier_continue(cursor.c as u32) {
                    needs_gap = true;
                    start_i = cursor.i as usize;
                    break;
                }
            }
        }

        if !needs_gap {
            let remapped = js_lexer_tables::strict_mode_reserved_word_remap(str).unwrap_or(str);
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
            cursor = strings::Cursor::default();

            while iterator.next(&mut cursor) {
                if js_lexer::is_identifier_continue(cursor.c as u32) {
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
        self.list.reserve(str.len().saturating_sub(self.list.len()));

        if self.list.is_empty() {
            self.list.extend_from_slice(str);
        } else {
            // Overwrite-then-extend replaces the range [0, str.len).
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
        self.list.reserve_exact(items.len());
        // After `reserve_exact`, `extend_from_slice` is a single memcpy with
        // no further reallocation — same codegen as the raw `set_len` path.
        self.list.extend_from_slice(items);
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
        // uninitialized. Callers must have previously
        // written those bytes (e.g. via writable_n_bytes).
        unsafe { self.list.set_len(index) };
    }

    pub fn inflate(&mut self, amount: usize) -> Result<(), AllocError> {
        // Callers always overwrite the inflated region, so the
        // zero-fill here is technically redundant — but it lowers to a single
        // memset and avoids `clippy::uninit_vec` / a `set_len` over uninit bytes.
        self.list.resize(amount, 0);
        Ok(())
    }

    #[inline]
    pub fn append_char_n_times(&mut self, char: u8, n: usize) -> Result<(), AllocError> {
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
        self.list.push(char);
    }

    #[inline]
    pub fn append(&mut self, char: &[u8]) -> Result<(), AllocError> {
        self.list.extend_from_slice(char);
        Ok(())
    }
}

/// Growable string sink.
impl crate::io::Write for MutableString {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<(), crate::Error> {
        self.append(buf)?;
        Ok(())
    }
    #[inline]
    fn written_len(&self) -> usize {
        self.len()
    }
}

impl MutableString {
    #[inline]
    pub fn append_int(&mut self, int: u64) -> Result<(), AllocError> {
        let mut b = [0u8; 20];
        self.list
            .extend_from_slice(crate::fmt::int_as_bytes(&mut b, int));
        Ok(())
    }

    #[inline]
    pub fn append_assume_capacity(&mut self, char: &[u8]) {
        self.list.extend_from_slice(char);
    }

    #[inline]
    pub fn len_i(&self) -> i32 {
        i32::try_from(self.list.len()).expect("int cast")
    }

    pub fn take_slice(&mut self) -> Vec<u8> {
        core::mem::take(&mut self.list)
    }

    pub fn to_owned_slice(&mut self) -> Box<[u8]> {
        core::mem::take(&mut self.list).into_boxed_slice()
    }

    pub fn to_dynamic_owned(&mut self) -> Box<[u8]> {
        // With the global allocator this collapses to `Box<[u8]>`.
        self.to_owned_slice()
    }

    /// Alias of [`Self::to_owned_slice`]; the global allocator is implicit.
    pub fn to_default_owned(&mut self) -> Box<[u8]> {
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
        ZStr::from_buf_mut(&mut self.list, len)
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
        // Single-byte search (the `str` parameter is one byte despite the name).
        self.list.iter().position(|&b| b == str)
    }

    pub fn eql(&self, other: &[u8]) -> bool {
        self.list.as_slice() == other
    }

    /// Returns `[SocketBuffer; COUNT]` —
    /// `{ base: *const u8, len: usize }` on every target (including Windows;
    /// it is NOT `uv_buf_t`). Single implementation, no `cfg(windows)` split.
    pub fn to_socket_buffers<const COUNT: usize>(
        &self,
        ranges: [(usize, usize); COUNT],
    ) -> [SocketBuffer; COUNT] {
        core::array::from_fn(|i| {
            let r = ranges[i];
            let s = &self.list[r.0..r.1];
            SocketBuffer {
                iov_base: s.as_ptr(),
                iov_len: s.len(),
            }
        })
    }

    pub fn write_all(&mut self, bytes: &[u8]) -> Result<usize, AllocError> {
        self.list.extend_from_slice(bytes);
        Ok(bytes.len())
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

const BUFFERED_WRITER_MAX: usize = 2048;

pub struct BufferedWriter<'a> {
    pub context: &'a mut MutableString,
    pub buffer: [u8; BUFFERED_WRITER_MAX],
    pub pos: usize,
}

impl<'a> BufferedWriter<'a> {
    const MAX: usize = BUFFERED_WRITER_MAX;

    // `impl std::io::Write for BufferedWriter` below; `writer()` returns `&mut Self`.

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
            let pos = self.pos;
            self.buffer[pos..pos + pending.len()].copy_from_slice(pending);
            self.pos += pending.len();
        }

        Ok(pending.len())
    }

    /// Write a E.String to the buffer.
    /// This automatically encodes UTF-16 into UTF-8 using
    /// the same code path as TextEncoder
    pub fn write_string(&mut self, bytes: &mut dyn EStringRef) -> Result<usize, AllocError> {
        // was `&mut bun_ast::E::String`; now vtable dispatch.
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
            // Write into the freshly-reserved context.list tail.
            let old = self.context.list.len();
            // SAFETY: copy_utf16_into_utf8 writes <= bytes.len*2; trimmed below.
            let tail =
                unsafe { crate::vec::writable_slice(&mut self.context.list, bytes.len() * 2) };
            let decoded = strings::copy_utf16_into_utf8(tail, bytes);
            self.context.list.truncate(old + decoded.written as usize);
            return Ok(pending.len());
        }

        if !pending.is_empty() {
            if (pending.len() * 2) + self.pos > Self::MAX {
                self.flush()?;
            }
            let pos = self.pos;
            let decoded =
                strings::copy_utf16_into_utf8(&mut self.buffer[pos..pos + bytes.len() * 2], bytes);
            self.pos += decoded.written as usize;
        }

        Ok(pending.len())
    }

    pub fn write_html_attribute_value_string(
        &mut self,
        str: &mut dyn EStringRef,
    ) -> Result<(), AllocError> {
        // was `&mut bun_ast::E::String`; now vtable dispatch.
        if str.is_utf8() {
            self.write_html_attribute_value(str.slice())?;
            return Ok(());
        }

        self.write_html_attribute_value16(str.slice16())
    }

    pub fn write_html_attribute_value(&mut self, bytes: &[u8]) -> Result<(), AllocError> {
        let mut items = bytes;
        while !items.is_empty() {
            // index_of_any_char dispatches to highway SIMD for n>=2.
            if let Some(j) = strings::index_of_any(items, b"\"<>") {
                let _ = self.write_all(&items[0..j])?;
                // needle b"\"<>" ⇒ Some, &/' never reached
                let _ = self.write_all(strings::html_escape_entity(items[j]).unwrap())?;

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
            const NEEDLES: &[u16] = &[b'"' as u16, b'<' as u16, b'>' as u16];
            if let Some(j) = strings::index_of_any16(items, NEEDLES) {
                let _ = self.write_all16(&items[0..j])?;
                // needle ∈ {0x22,0x3C,0x3E} so `as u8` is lossless
                let _ = self.write_all(strings::html_escape_entity(items[j] as u8).unwrap())?;

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
