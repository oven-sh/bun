use crate::strings;
use bun_alloc::AllocError;

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

            debug_assert!(js_lexer::is_identifier(&mutable.list));

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
    pub fn append_char(&mut self, char: u8) -> Result<(), AllocError> {
        self.list.push(char);
        Ok(())
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

    pub fn take_slice(&mut self) -> Vec<u8> {
        core::mem::take(&mut self.list)
    }

    pub fn to_owned_slice(&mut self) -> Box<[u8]> {
        core::mem::take(&mut self.list).into_boxed_slice()
    }

    /// Alias of [`Self::to_owned_slice`]; the global allocator is implicit.
    pub fn to_default_owned(&mut self) -> Box<[u8]> {
        self.to_owned_slice()
    }

    pub fn slice(&mut self) -> &mut [u8] {
        &mut self.list
    }

    pub fn index_of(&self, str: u8) -> Option<usize> {
        // Single-byte search (the `str` parameter is one byte despite the name).
        self.list.iter().position(|&b| b == str)
    }

    pub fn eql(&self, other: &[u8]) -> bool {
        self.list.as_slice() == other
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
