// These are all extern so they can't be top-level structs.
pub use crate::semver_string::String;
pub use crate::external_string::ExternalString;
pub use crate::version::Version;
pub use crate::version::VersionType;

pub use crate::sliced_string::SlicedString;
pub use crate::semver_range::Range;
pub use crate::semver_query::Query;
// PORT NOTE: `SemverObject` re-export from `../semver_jsc/` deleted — *_jsc
// extension traits live in the `bun_semver_jsc` crate, not here.

// TODO(b1): Phase-A draft bodies preserved behind cfg(any()); un-gate in B-2.
#[cfg(any())] #[path = "Version.rs"] pub mod version;
#[cfg(any())] #[path = "SemverRange.rs"] pub mod semver_range;
#[cfg(any())] #[path = "SemverQuery.rs"] pub mod semver_query;

// ── B-1 stub surface for gated modules ────────────────────────────────────
#[cfg(not(any()))]
pub mod version {
    #[repr(C)] #[derive(Copy, Clone, Default)]
    pub struct VersionType<T> { _p: core::marker::PhantomData<T> }
    pub type Version = VersionType<u64>;
}
#[cfg(not(any()))]
pub mod semver_range {
    #[derive(Copy, Clone, Default)]
    pub struct Range;
}
#[cfg(not(any()))]
pub mod semver_query {
    #[derive(Default)]
    pub struct Query;
    pub mod token {
        #[derive(Copy, Clone, Default)]
        pub struct Wildcard;
    }
}
pub use crate::semver_range as range;
pub use crate::semver_query as query;

/// Alias so callers can name `bun_semver::string::Formatter` etc.
pub use crate::semver_string as string;

// ──────────────────────────────────────────────────────────────────────────
// StringBuilder — trait abstracting `comptime StringBuilder: type` callers
// in Version::count / Version::clone_into. Concrete impl is
// `semver_string::Builder`; higher-tier crates may provide their own.
// ──────────────────────────────────────────────────────────────────────────
pub trait StringBuilder {
    fn count(&mut self, slice_: &[u8]);
    fn append<T: crate::semver_string::BuilderStringType>(&mut self, slice_: &[u8]) -> T;
}

impl StringBuilder for crate::semver_string::Builder {
    #[inline]
    fn count(&mut self, slice_: &[u8]) {
        crate::semver_string::Builder::count(self, slice_)
    }
    #[inline]
    fn append<T: crate::semver_string::BuilderStringType>(&mut self, slice_: &[u8]) -> T {
        crate::semver_string::Builder::append::<T>(self, slice_)
    }
}

// ══════════════════════════════════════════════════════════════════════════
// MOVE-IN: bun_install_types::sliced_string → bun_semver::sliced_string
// Ground truth: src/install_types/SlicedString.zig
// ══════════════════════════════════════════════════════════════════════════
pub mod sliced_string {
    use super::external_string::ExternalString;
    use super::semver_string::String;

    // TODO(port): lifetime — PORTING.md says "no lifetime param on struct for []const u8 fields",
    // but SlicedString is purely a borrowed (ptr+len) view used for offset arithmetic into a
    // backing buffer; Box/&'static/raw are all wrong here. Phase B: confirm `'a` threading or
    // swap to raw `*const [u8]` if borrowck fights at call sites.
    #[derive(Copy, Clone)]
    pub struct SlicedString<'a> {
        pub buf: &'a [u8],
        pub slice: &'a [u8],
    }

    impl<'a> SlicedString<'a> {
        #[inline]
        pub fn init(buf: &'a [u8], slice: &'a [u8]) -> SlicedString<'a> {
            if cfg!(debug_assertions) {
                if (buf.as_ptr() as usize) > (slice.as_ptr() as usize) {
                    panic!("SlicedString.init buf is not in front of slice");
                }
            }
            SlicedString { buf, slice }
        }

        #[inline]
        pub fn external(self) -> ExternalString {
            debug_assert!(
                (self.buf.as_ptr() as usize) <= (self.slice.as_ptr() as usize)
                    && ((self.slice.as_ptr() as usize) + self.slice.len())
                        <= ((self.buf.as_ptr() as usize) + self.buf.len())
            );

            ExternalString::init(self.buf, self.slice, bun_wyhash::Wyhash11::hash(0, self.slice))
        }

        #[inline]
        pub fn value(self) -> String {
            debug_assert!(
                (self.buf.as_ptr() as usize) <= (self.slice.as_ptr() as usize)
                    && ((self.slice.as_ptr() as usize) + self.slice.len())
                        <= ((self.buf.as_ptr() as usize) + self.buf.len())
            );

            String::init(self.buf, self.slice)
        }

        #[inline]
        pub fn sub(self, input: &'a [u8]) -> SlicedString<'a> {
            if cfg!(debug_assertions) {
                if !bun_alloc::is_slice_in_buffer(input, self.buf) {
                    let start_buf = self.buf.as_ptr() as usize;
                    let end_buf = (self.buf.as_ptr() as usize) + self.buf.len();
                    let start_i = input.as_ptr() as usize;
                    let end_i = (input.as_ptr() as usize) + input.len();

                    // TODO(b1): bun_core::output::panic stub takes (&str, Arguments); use std panic for now
                    panic!(
                        concat!(
                            "SlicedString.sub input [{}, {}) is not a substring of the ",
                            "slice [{}, {})"
                        ),
                        start_i, end_i, start_buf, end_buf
                    );
                }
            }
            SlicedString { buf: self.buf, slice: input }
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// MOVE-IN: bun_install_types::external_string → bun_semver::external_string
// Ground truth: src/install_types/ExternalString.zig
// ══════════════════════════════════════════════════════════════════════════
pub mod external_string {
    use core::cmp::Ordering;

    use super::semver_string::{Formatter, String};

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct ExternalString {
        pub value: String,
        pub hash: u64,
    }

    impl Default for ExternalString {
        fn default() -> Self {
            Self { value: String::default(), hash: 0 }
        }
    }

    impl ExternalString {
        #[inline]
        pub fn fmt<'a>(&'a self, buf: &'a [u8]) -> Formatter<'a> {
            self.value.fmt(buf)
        }

        pub fn order(&self, rhs: &ExternalString, lhs_buf: &[u8], rhs_buf: &[u8]) -> Ordering {
            if self.hash == rhs.hash && self.hash > 0 {
                return Ordering::Equal;
            }

            self.value.order(&rhs.value, lhs_buf, rhs_buf)
        }

        /// ExternalString but without the hash
        #[inline]
        pub fn from(in_: &[u8]) -> ExternalString {
            ExternalString {
                value: String::init(in_, in_),
                // `bun.Wyhash.hash(0, in)` — std.hash.Wyhash with seed 0, same as `bun.hash`
                hash: bun_wyhash::Wyhash11::hash(0, in_),
            }
        }

        #[inline]
        pub fn is_inline(&self) -> bool {
            self.value.is_inline()
        }

        #[inline]
        pub fn is_empty(&self) -> bool {
            self.value.is_empty()
        }

        #[inline]
        pub fn len(&self) -> usize {
            self.value.len()
        }

        #[inline]
        pub fn init(buf: &[u8], in_: &[u8], hash: u64) -> ExternalString {
            ExternalString { value: String::init(buf, in_), hash }
        }

        #[inline]
        pub fn slice<'a>(&'a self, buf: &'a [u8]) -> &'a [u8] {
            self.value.slice(buf)
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// MOVE-IN: bun_install_types::semver_string → bun_semver::semver_string
// Ground truth: src/install_types/SemverString.zig
// ══════════════════════════════════════════════════════════════════════════
pub mod semver_string {
    use core::cmp::Ordering;
    use core::fmt;

    use bun_alloc::AllocError;
    // TODO(b1): bun_collections::IdentityContext missing from lower-tier stub surface
    #[allow(unused_imports)]
    use bun_collections::HashMap;

    // TODO(b1): bun_string::strings missing `order` / `is_all_ascii`; local shim wraps it.
    mod strings {
        #[allow(unused_imports)]
        pub use bun_string::strings::*;
        #[inline]
        pub fn order(a: &[u8], b: &[u8]) -> core::cmp::Ordering { a.cmp(b) }
        #[inline]
        pub fn is_all_ascii(s: &[u8]) -> bool { s.iter().all(|&b| b < 0x80) }
    }

    use super::external_string::ExternalString;
    use super::sliced_string::SlicedString;

    /// String type that stores either an offset/length into an external buffer or a string inline directly
    #[repr(C)]
    #[derive(Copy, Clone, PartialEq, Eq)]
    pub struct String {
        /// This is three different types of string.
        /// 1. Empty string. If it's all zeroes, then it's an empty string.
        /// 2. If the final bit is not set, then it's a string that is stored inline.
        /// 3. If the final bit is set, then it's a string that is stored in an external buffer.
        pub bytes: [u8; String::MAX_INLINE_LEN],
    }

    impl Default for String {
        fn default() -> Self {
            Self { bytes: [0, 0, 0, 0, 0, 0, 0, 0] }
        }
    }

    // https://en.wikipedia.org/wiki/Intel_5-level_paging
    // https://developer.arm.com/documentation/101811/0101/Address-spaces-in-AArch64#:~:text=0%2DA%2C%20the%20maximum%20size,2%2DA.
    // X64 seems to need some of the pointer bits
    // Zig: `const max_addressable_space = u63;` — Rust has no u63; use a mask for the @truncate semantics.
    const MAX_ADDRESSABLE_SPACE_MASK: u64 = (1u64 << 63) - 1;

    const _: () = assert!(
        core::mem::size_of::<usize>() == 8,
        "This code needs to be updated for non-64-bit architectures",
    );

    impl String {
        pub const MAX_INLINE_LEN: usize = 8;

        pub const EMPTY: String = String { bytes: [0, 0, 0, 0, 0, 0, 0, 0] };

        /// Create an inline string
        // TODO(port): make const fn once `init` is const-evaluable; Zig used `comptime` block.
        pub fn from(inlinable_buffer: &'static [u8]) -> String {
            debug_assert!(
                !(inlinable_buffer.len() > Self::MAX_INLINE_LEN
                    || (inlinable_buffer.len() == Self::MAX_INLINE_LEN
                        && inlinable_buffer[Self::MAX_INLINE_LEN - 1] >= 0x80)),
                "string constant too long to be inlined",
            );
            String::init(inlinable_buffer, inlinable_buffer)
        }

        #[inline]
        pub fn fmt<'a>(&'a self, buf: &'a [u8]) -> Formatter<'a> {
            Formatter { buf, str: self }
        }

        /// Escapes for json. Defaults to quoting the string.
        #[inline]
        pub fn fmt_json<'a>(&'a self, buf: &'a [u8], opts: JsonFormatterOptions) -> JsonFormatter<'a> {
            JsonFormatter { buf, str: self, opts }
        }

        #[inline]
        pub fn fmt_store_path<'a>(&'a self, buf: &'a [u8]) -> StorePathFormatter<'a> {
            StorePathFormatter { buf, str: self }
        }

        #[inline]
        pub fn order(&self, rhs: &String, lhs_buf: &[u8], rhs_buf: &[u8]) -> Ordering {
            strings::order(self.slice(lhs_buf), rhs.slice(rhs_buf))
        }

        #[inline]
        pub fn can_inline(buf: &[u8]) -> bool {
            const MAX_INLINE_LEN_M1: usize = String::MAX_INLINE_LEN - 1;
            match buf.len() {
                0..=MAX_INLINE_LEN_M1 => true,
                Self::MAX_INLINE_LEN => buf[Self::MAX_INLINE_LEN - 1] & 0x80 == 0,
                _ => false,
            }
        }

        #[inline]
        pub fn is_inline(self) -> bool {
            self.bytes[Self::MAX_INLINE_LEN - 1] & 0x80 == 0
        }

        #[inline]
        pub fn sliced<'a>(&'a self, buf: &'a [u8]) -> SlicedString<'a> {
            if self.is_inline() {
                let s = self.slice(b"");
                SlicedString::init(s, s)
            } else {
                SlicedString::init(buf, self.slice(buf))
            }
        }

        // PORT NOTE: `hashContext`/`arrayHashContext` (took *Lockfile) intentionally NOT moved
        // down — they would create a back-edge to bun_install. The HashContext/ArrayHashContext
        // structs themselves live here; the Lockfile-taking convenience constructors stay in
        // bun_install (or bun_install_types) as inherent helpers there.

        pub fn init(buf: &[u8], in_: &[u8]) -> String {
            match in_.len() {
                0 => String::default(),
                1 => String { bytes: [in_[0], 0, 0, 0, 0, 0, 0, 0] },
                2 => String { bytes: [in_[0], in_[1], 0, 0, 0, 0, 0, 0] },
                3 => String { bytes: [in_[0], in_[1], in_[2], 0, 0, 0, 0, 0] },
                4 => String { bytes: [in_[0], in_[1], in_[2], in_[3], 0, 0, 0, 0] },
                5 => String { bytes: [in_[0], in_[1], in_[2], in_[3], in_[4], 0, 0, 0] },
                6 => String { bytes: [in_[0], in_[1], in_[2], in_[3], in_[4], in_[5], 0, 0] },
                7 => String { bytes: [in_[0], in_[1], in_[2], in_[3], in_[4], in_[5], in_[6], 0] },
                Self::MAX_INLINE_LEN => {
                    // If they use the final bit, then it's a big string.
                    // This should only happen for non-ascii strings that are exactly 8 bytes.
                    // so that's an edge-case
                    if in_[Self::MAX_INLINE_LEN - 1] >= 128 {
                        let ptr_bits: u64 =
                            // SAFETY: Pointer is #[repr(C)] with two u32 fields == 8 bytes
                            unsafe { core::mem::transmute::<Pointer, u64>(Pointer::init(buf, in_)) };
                        let packed: u64 = (0u64 | (ptr_bits & MAX_ADDRESSABLE_SPACE_MASK)) | (1u64 << 63);
                        String { bytes: packed.to_ne_bytes() }
                    } else {
                        String { bytes: [in_[0], in_[1], in_[2], in_[3], in_[4], in_[5], in_[6], in_[7]] }
                    }
                }
                _ => {
                    let ptr_bits: u64 =
                        // SAFETY: Pointer is #[repr(C)] with two u32 fields == 8 bytes
                        unsafe { core::mem::transmute::<Pointer, u64>(Pointer::init(buf, in_)) };
                    let packed: u64 = (0u64 | (ptr_bits & MAX_ADDRESSABLE_SPACE_MASK)) | (1u64 << 63);
                    String { bytes: packed.to_ne_bytes() }
                }
            }
        }

        pub fn init_inline(in_: &[u8]) -> String {
            debug_assert!(Self::can_inline(in_));
            match in_.len() {
                0 => String::default(),
                1 => String { bytes: [in_[0], 0, 0, 0, 0, 0, 0, 0] },
                2 => String { bytes: [in_[0], in_[1], 0, 0, 0, 0, 0, 0] },
                3 => String { bytes: [in_[0], in_[1], in_[2], 0, 0, 0, 0, 0] },
                4 => String { bytes: [in_[0], in_[1], in_[2], in_[3], 0, 0, 0, 0] },
                5 => String { bytes: [in_[0], in_[1], in_[2], in_[3], in_[4], 0, 0, 0] },
                6 => String { bytes: [in_[0], in_[1], in_[2], in_[3], in_[4], in_[5], 0, 0] },
                7 => String { bytes: [in_[0], in_[1], in_[2], in_[3], in_[4], in_[5], in_[6], 0] },
                8 => String { bytes: [in_[0], in_[1], in_[2], in_[3], in_[4], in_[5], in_[6], in_[7]] },
                _ => unreachable!(),
            }
        }

        pub fn init_append_if_needed(buf: &mut Vec<u8>, in_: &[u8]) -> Result<String, AllocError> {
            Ok(match in_.len() {
                0 => String::default(),
                1 => String { bytes: [in_[0], 0, 0, 0, 0, 0, 0, 0] },
                2 => String { bytes: [in_[0], in_[1], 0, 0, 0, 0, 0, 0] },
                3 => String { bytes: [in_[0], in_[1], in_[2], 0, 0, 0, 0, 0] },
                4 => String { bytes: [in_[0], in_[1], in_[2], in_[3], 0, 0, 0, 0] },
                5 => String { bytes: [in_[0], in_[1], in_[2], in_[3], in_[4], 0, 0, 0] },
                6 => String { bytes: [in_[0], in_[1], in_[2], in_[3], in_[4], in_[5], 0, 0] },
                7 => String { bytes: [in_[0], in_[1], in_[2], in_[3], in_[4], in_[5], in_[6], 0] },

                Self::MAX_INLINE_LEN => {
                    // If they use the final bit, then it's a big string.
                    // This should only happen for non-ascii strings that are exactly 8 bytes.
                    // so that's an edge-case
                    if in_[Self::MAX_INLINE_LEN - 1] >= 128 {
                        Self::init_append(buf, in_)?
                    } else {
                        String { bytes: [in_[0], in_[1], in_[2], in_[3], in_[4], in_[5], in_[6], in_[7]] }
                    }
                }

                _ => Self::init_append(buf, in_)?,
            })
        }

        pub fn init_append(buf: &mut Vec<u8>, in_: &[u8]) -> Result<String, AllocError> {
            // PERF(port): Zig used `try buf.appendSlice(allocator, in)`; Vec::extend_from_slice
            // panics on OOM under the global mimalloc allocator instead of returning an error.
            buf.extend_from_slice(in_);
            let items = buf.as_slice();
            let in_buf = &items[items.len() - in_.len()..];
            let ptr_bits: u64 =
                // SAFETY: Pointer is #[repr(C)] with two u32 fields == 8 bytes
                unsafe { core::mem::transmute::<Pointer, u64>(Pointer::init(items, in_buf)) };
            let packed: u64 = (0u64 | (ptr_bits & MAX_ADDRESSABLE_SPACE_MASK)) | (1u64 << 63);
            Ok(String { bytes: packed.to_ne_bytes() })
        }

        pub fn eql(self, that: String, this_buf: &[u8], that_buf: &[u8]) -> bool {
            if self.is_inline() && that.is_inline() {
                u64::from_ne_bytes(self.bytes) == u64::from_ne_bytes(that.bytes)
            } else if self.is_inline() != that.is_inline() {
                false
            } else {
                let a = self.ptr();
                let b = that.ptr();
                strings::eql(
                    &this_buf[a.off as usize..][..a.len as usize],
                    &that_buf[b.off as usize..][..b.len as usize],
                )
            }
        }

        #[inline]
        pub fn is_empty(self) -> bool {
            u64::from_ne_bytes(self.bytes) == 0u64
        }

        pub fn len(self) -> usize {
            match self.bytes[Self::MAX_INLINE_LEN - 1] & 128 {
                0 => {
                    // Edgecase: string that starts with a 0 byte will be considered empty.
                    match self.bytes[0] {
                        0 => 0,
                        _ => {
                            // PERF(port): was `inline while` (manually unrolled) — profile in Phase B
                            let mut i: usize = 0;
                            while i < self.bytes.len() {
                                if self.bytes[i] == 0 {
                                    return i;
                                }
                                i += 1;
                            }
                            8
                        }
                    }
                }
                _ => {
                    let ptr_ = self.ptr();
                    ptr_.len as usize
                }
            }
        }

        #[inline]
        pub fn ptr(self) -> Pointer {
            let bits: u64 = u64::from_ne_bytes(self.bytes);
            // @as(u63, @truncate(bits)) → mask off bit 63
            let masked: u64 = bits & MAX_ADDRESSABLE_SPACE_MASK;
            // SAFETY: Pointer is #[repr(C)] with two u32 fields == 8 bytes; same size as u64
            unsafe { core::mem::transmute::<u64, Pointer>(masked) }
        }

        // PORT NOTE: `toJS` deleted — lives in bun_semver_jsc (tier-6; deferred to Pass C).

        // String must be a pointer because we reference it as a slice. It will become a dead pointer if it is copied.
        pub fn slice<'a>(&'a self, buf: &'a [u8]) -> &'a [u8] {
            match self.bytes[Self::MAX_INLINE_LEN - 1] & 128 {
                0 => {
                    // Edgecase: string that starts with a 0 byte will be considered empty.
                    match self.bytes[0] {
                        0 => b"",
                        _ => {
                            // PERF(port): was `inline while` (manually unrolled) — profile in Phase B
                            let mut i: usize = 0;
                            while i < self.bytes.len() {
                                if self.bytes[i] == 0 {
                                    return &self.bytes[0..i];
                                }
                                i += 1;
                            }
                            &self.bytes
                        }
                    }
                }
                _ => {
                    let ptr_ = self.ptr();
                    &buf[ptr_.off as usize..][..ptr_.len as usize]
                }
            }
        }
    }

    // ── String.Buf ────────────────────────────────────────────────────────
    // PORT NOTE: `Buf::init(lockfile: *const Lockfile)` intentionally NOT moved down — would
    // create a back-edge to bun_install. Higher-tier callers construct `Buf` via struct literal.
    pub struct Buf<'a> {
        pub bytes: &'a mut Vec<u8>,
        pub pool: &'a mut StringPool,
    }

    impl<'a> Buf<'a> {
        pub fn append(&mut self, str: &[u8]) -> Result<String, AllocError> {
            if String::can_inline(str) {
                return Ok(String::init_inline(str));
            }

            let hash = Builder::string_hash(str);
            let entry = self.pool.get_or_put(hash)?;
            if entry.found_existing {
                return Ok(*entry.value_ptr);
            }

            // new entry
            let new = String::init_append(self.bytes, str)?;
            *entry.value_ptr = new;
            Ok(new)
        }

        pub fn append_with_hash(&mut self, str: &[u8], hash: u64) -> Result<String, AllocError> {
            if String::can_inline(str) {
                return Ok(String::init_inline(str));
            }

            let entry = self.pool.get_or_put(hash)?;
            if entry.found_existing {
                return Ok(*entry.value_ptr);
            }

            // new entry
            let new = String::init_append(self.bytes, str)?;
            *entry.value_ptr = new;
            Ok(new)
        }

        pub fn append_external(&mut self, str: &[u8]) -> Result<ExternalString, AllocError> {
            let hash = Builder::string_hash(str);

            if String::can_inline(str) {
                return Ok(ExternalString { value: String::init_inline(str), hash });
            }

            let entry = self.pool.get_or_put(hash)?;
            if entry.found_existing {
                return Ok(ExternalString { value: *entry.value_ptr, hash });
            }

            let new = String::init_append(self.bytes, str)?;
            *entry.value_ptr = new;
            Ok(ExternalString { value: new, hash })
        }

        pub fn append_external_with_hash(
            &mut self,
            str: &[u8],
            hash: u64,
        ) -> Result<ExternalString, AllocError> {
            if String::can_inline(str) {
                return Ok(ExternalString { value: String::init_inline(str), hash });
            }

            let entry = self.pool.get_or_put(hash)?;
            if entry.found_existing {
                return Ok(ExternalString { value: *entry.value_ptr, hash });
            }

            let new = String::init_append(self.bytes, str)?;
            *entry.value_ptr = new;
            Ok(ExternalString { value: new, hash })
        }
    }

    // ── String.Tag ────────────────────────────────────────────────────────
    pub enum Tag {
        Small,
        Big,
    }

    // ── String.Formatter ──────────────────────────────────────────────────
    pub struct Formatter<'a> {
        pub str: &'a String,
        pub buf: &'a [u8],
    }

    impl<'a> fmt::Display for Formatter<'a> {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            let str = self.str;
            write!(f, "{}", bstr::BStr::new(str.slice(self.buf)))
        }
    }

    // ── String.JsonFormatter ──────────────────────────────────────────────
    #[derive(Copy, Clone)]
    pub struct JsonFormatterOptions {
        pub quote: bool,
    }

    impl Default for JsonFormatterOptions {
        fn default() -> Self {
            Self { quote: true }
        }
    }

    pub struct JsonFormatter<'a> {
        pub str: &'a String,
        pub buf: &'a [u8],
        pub opts: JsonFormatterOptions,
    }

    impl<'a> fmt::Display for JsonFormatter<'a> {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            // TODO(b1): bun_core::fmt gated out in lower tier; preserve draft behind cfg(any())
            #[cfg(any())]
            {
                return write!(
                    f,
                    "{}",
                    bun_core::fmt::format_json_string_utf8(
                        self.str.slice(self.buf),
                        bun_core::fmt::JsonStringOptions { quote: self.opts.quote },
                    ),
                );
            }
            #[cfg(not(any()))]
            { let _ = f; todo!("b1: JsonFormatter Display") }
        }
    }

    // ── String.StorePathFormatter ─────────────────────────────────────────
    pub struct StorePathFormatter<'a> {
        pub str: &'a String,
        pub buf: &'a [u8],
    }

    impl<'a> fmt::Display for StorePathFormatter<'a> {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            for &c in self.str.slice(self.buf) {
                let n = match c {
                    b'/' => b'+',
                    b'\\' => b'+',
                    b':' => b'+',
                    b'#' => b'+',
                    _ => c,
                };
                // TODO(port): writing raw byte through fmt::Write requires char conversion;
                // bytes here are path-safe ASCII so `as char` is fine.
                use core::fmt::Write;
                f.write_char(n as char)?;
            }
            Ok(())
        }
    }

    // ── Sorter(comptime direction) ────────────────────────────────────────
    // TODO(b1): was `const DIRECTION: SortDirection` const-generic param; requires nightly
    // `adt_const_params`. Rewritten as a runtime field for stable. Revisit in B-2 if
    // monomorphization is load-bearing for perf.
    #[derive(PartialEq, Eq, Clone, Copy)]
    pub enum SortDirection {
        Asc,
        Desc,
    }

    pub struct Sorter<'a> {
        pub direction: SortDirection,
        pub lhs_buf: &'a [u8],
        pub rhs_buf: &'a [u8],
    }

    impl<'a> Sorter<'a> {
        pub fn less_than(&self, lhs: String, rhs: String) -> bool {
            lhs.order(&rhs, self.lhs_buf, self.rhs_buf)
                == if self.direction == SortDirection::Asc { Ordering::Less } else { Ordering::Greater }
        }
    }

    // ── HashContext / ArrayHashContext ────────────────────────────────────
    pub struct HashContext<'a> {
        pub arg_buf: &'a [u8],
        pub existing_buf: &'a [u8],
    }

    impl<'a> HashContext<'a> {
        pub fn eql(&self, arg: String, existing: String) -> bool {
            arg.eql(existing, self.arg_buf, self.existing_buf)
        }

        pub fn hash(&self, arg: String) -> u64 {
            let str = arg.slice(self.arg_buf);
            bun_wyhash::Wyhash11::hash(0, str)
        }
    }

    pub struct ArrayHashContext<'a> {
        pub arg_buf: &'a [u8],
        pub existing_buf: &'a [u8],
    }

    impl<'a> ArrayHashContext<'a> {
        pub fn eql(&self, arg: String, existing: String, _: usize) -> bool {
            arg.eql(existing, self.arg_buf, self.existing_buf)
        }

        pub fn hash(&self, arg: String) -> u32 {
            let str = arg.slice(self.arg_buf);
            bun_wyhash::Wyhash11::hash(0, str) as u32
        }
    }

    // ── String.Pointer ────────────────────────────────────────────────────
    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    pub struct Pointer {
        pub off: u32,
        pub len: u32,
    }

    impl Pointer {
        #[inline]
        pub fn init(buf: &[u8], in_: &[u8]) -> Pointer {
            if cfg!(debug_assertions) {
                debug_assert!(bun_alloc::is_slice_in_buffer(in_, buf));
            }

            Pointer {
                off: (in_.as_ptr() as usize - buf.as_ptr() as usize) as u32,
                len: in_.len() as u32,
            }
        }
    }

    // ── String.Builder ────────────────────────────────────────────────────

    /// Trait abstracting over `String` and `ExternalString` for `Builder::append*` methods.
    /// Replaces Zig's `comptime Type: type` + `switch (Type)` dispatch.
    pub trait BuilderStringType: Sized {
        fn from_init(allocated: &[u8], slice_: &[u8], hash: u64) -> Self;
        fn from_pooled(value: String, hash: u64) -> Self;
    }

    impl BuilderStringType for String {
        fn from_init(allocated: &[u8], slice_: &[u8], _hash: u64) -> Self {
            String::init(allocated, slice_)
        }
        fn from_pooled(value: String, _hash: u64) -> Self {
            value
        }
    }

    impl BuilderStringType for ExternalString {
        fn from_init(allocated: &[u8], slice_: &[u8], hash: u64) -> Self {
            ExternalString::init(allocated, slice_, hash)
        }
        fn from_pooled(value: String, hash: u64) -> Self {
            ExternalString { value, hash }
        }
    }

    // TODO(port): std.HashMap(u64, String, IdentityContext(u64), 80) — 80% max load factor not
    // expressible in bun_collections::HashMap signature; verify default load factor matches.
    // TODO(b1): bun_collections::HashMap stub is 2-param std alias and lacks `get_or_put`;
    // local opaque stub keeps Buf/Builder signatures intact. Un-stub in B-2.
    #[derive(Default)]
    pub struct StringPool {
        _p: (),
    }
    pub struct StringPoolEntry<'a> {
        pub found_existing: bool,
        pub value_ptr: &'a mut String,
    }
    impl StringPool {
        #[allow(unused_variables)]
        pub fn get_or_put(&mut self, hash: u64) -> Result<StringPoolEntry<'_>, AllocError> {
            todo!("b1: StringPool::get_or_put")
        }
        #[allow(unused_variables)]
        pub fn contains(&self, hash: &u64) -> bool {
            todo!("b1: StringPool::contains")
        }
    }

    pub struct Builder {
        pub len: usize,
        pub cap: usize,
        pub ptr: Option<Box<[u8]>>,
        pub string_pool: StringPool,
    }

    impl Default for Builder {
        fn default() -> Self {
            Self {
                len: 0,
                cap: 0,
                ptr: None,
                // TODO(port): Zig had `= undefined`; callers must initialize before use.
                string_pool: StringPool::default(),
            }
        }
    }

    impl Builder {
        #[inline]
        pub fn string_hash(buf: &[u8]) -> u64 {
            bun_wyhash::Wyhash11::hash(0, buf)
        }

        #[inline]
        pub fn count(&mut self, slice_: &[u8]) {
            self.count_with_hash(
                slice_,
                if slice_.len() >= String::MAX_INLINE_LEN { Self::string_hash(slice_) } else { u64::MAX },
            )
        }

        #[inline]
        pub fn count_with_hash(&mut self, slice_: &[u8], hash: u64) {
            if slice_.len() <= String::MAX_INLINE_LEN {
                return;
            }

            if !self.string_pool.contains(&hash) {
                self.cap += slice_.len();
            }
        }

        #[inline]
        pub fn allocated_slice(&self) -> &[u8] {
            if self.cap > 0 {
                // SAFETY mirror: Zig did `this.ptr.?[0..this.cap]` — caller guarantees allocate() ran when cap > 0
                &self.ptr.as_ref().expect("allocate() not called")[0..self.cap]
            } else {
                &[]
            }
        }

        pub fn allocate(&mut self) -> Result<(), AllocError> {
            // PERF(port): Zig used uninitialized alloc; using zeroed Box<[u8]> here — profile in Phase B
            let ptr_ = vec![0u8; self.cap].into_boxed_slice();
            self.ptr = Some(ptr_);
            Ok(())
        }

        pub fn append<T: BuilderStringType>(&mut self, slice_: &[u8]) -> T {
            // PERF(port): was @call(bun.callmod_inline, ...) — relying on #[inline] / LLVM inlining
            self.append_with_hash::<T>(slice_, Self::string_hash(slice_))
        }

        pub fn append_utf8_without_pool<T: BuilderStringType>(&mut self, slice_: &[u8], hash: u64) -> T {
            if slice_.len() <= String::MAX_INLINE_LEN {
                if strings::is_all_ascii(slice_) {
                    return T::from_init(self.allocated_slice(), slice_, hash);
                }
            }

            if cfg!(debug_assertions) {
                debug_assert!(self.len <= self.cap); // didn't count everything
                debug_assert!(self.ptr.is_some()); // must call allocate first
            }

            // PORT NOTE: reshaped for borrowck — compute final slice range, then borrow once.
            let start = self.len;
            let end = self.cap;
            {
                let dst = &mut self.ptr.as_mut().unwrap()[start..end];
                dst[..slice_.len()].copy_from_slice(slice_);
            }
            self.len += slice_.len();

            if cfg!(debug_assertions) {
                debug_assert!(self.len <= self.cap);
            }

            let allocated = &self.ptr.as_ref().unwrap()[0..self.cap];
            let final_slice = &allocated[start..start + slice_.len()];
            T::from_init(allocated, final_slice, hash)
        }

        // SlicedString is not supported due to inline strings.
        pub fn append_without_pool<T: BuilderStringType>(&mut self, slice_: &[u8], hash: u64) -> T {
            if slice_.len() <= String::MAX_INLINE_LEN {
                return T::from_init(self.allocated_slice(), slice_, hash);
            }
            if cfg!(debug_assertions) {
                debug_assert!(self.len <= self.cap); // didn't count everything
                debug_assert!(self.ptr.is_some()); // must call allocate first
            }

            // PORT NOTE: reshaped for borrowck
            let start = self.len;
            let end = self.cap;
            {
                let dst = &mut self.ptr.as_mut().unwrap()[start..end];
                dst[..slice_.len()].copy_from_slice(slice_);
            }
            self.len += slice_.len();

            if cfg!(debug_assertions) {
                debug_assert!(self.len <= self.cap);
            }

            let allocated = &self.ptr.as_ref().unwrap()[0..self.cap];
            let final_slice = &allocated[start..start + slice_.len()];
            T::from_init(allocated, final_slice, hash)
        }

        pub fn append_with_hash<T: BuilderStringType>(&mut self, slice_: &[u8], hash: u64) -> T {
            if slice_.len() <= String::MAX_INLINE_LEN {
                return T::from_init(self.allocated_slice(), slice_, hash);
            }

            if cfg!(debug_assertions) {
                debug_assert!(self.len <= self.cap); // didn't count everything
                debug_assert!(self.ptr.is_some()); // must call allocate first
            }

            // PORT NOTE: reshaped for borrowck — get_or_put borrows self.string_pool while we also need
            // &mut self.ptr; capture scalars first, then re-borrow.
            let start = self.len;
            let cap = self.cap;
            let string_entry = self.string_pool.get_or_put(hash).expect("unreachable");
            if !string_entry.found_existing {
                {
                    let dst = &mut self.ptr.as_mut().unwrap()[start..cap];
                    dst[..slice_.len()].copy_from_slice(slice_);
                }
                self.len += slice_.len();

                let allocated = &self.ptr.as_ref().unwrap()[0..cap];
                let final_slice = &allocated[start..start + slice_.len()];
                *string_entry.value_ptr = String::init(allocated, final_slice);
            }

            if cfg!(debug_assertions) {
                debug_assert!(self.len <= self.cap);
            }

            T::from_pooled(*string_entry.value_ptr, hash)
        }
    }

    const _: () = assert!(
        core::mem::size_of::<String>() == core::mem::size_of::<Pointer>(),
        "String types must be the same size",
    );
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/semver/semver.zig (10 lines)
//               + MOVE-IN src/install_types/{SlicedString,ExternalString,SemverString}.zig
//   confidence: medium
//   todos:      5
//   notes:      thin re-export crate root; *_jsc alias dropped per guide. SlicedString /
//               ExternalString / String moved down from bun_install_types to break the
//               install_types↔semver cycle. Lockfile-taking helpers (Buf::init, hash_context,
//               array_hash_context) and toJS stay upstream.
// ──────────────────────────────────────────────────────────────────────────
