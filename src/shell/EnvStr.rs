//! Environment strings need to be copied a lot
//! So we make them reference counted
//!
//! But sometimes we use strings that are statically allocated, or are allocated
//! with a predetermined lifetime (e.g. strings in the AST). In that case we
//! don't want to incur the cost of heap allocating them and refcounting them
//!
//! So environment strings can be ref counted or borrowed slices

use core::ffi::c_void;

use crate::interpreter::RefCountedStr;

bun_output::declare_scope!(EnvStr, hidden);

/// Packed `u128` layout (Zig `packed struct(u128)`, LSB-first):
/// - bits  0..48  : `ptr` (u48)
/// - bits 48..64  : `tag` (u16)
/// - bits 64..128 : `len` (usize)
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct EnvStr(u128);

#[repr(u16)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Tag {
    /// no value
    Empty = 0,

    /// Dealloced by reference counting
    Refcounted = 1,

    /// Memory is managed elsewhere so don't dealloc it
    Slice = 2,
}

const PTR_MASK: u128 = (1u128 << 48) - 1;
const TAG_SHIFT: u32 = 48;
const TAG_MASK: u128 = 0xFFFF;
const LEN_SHIFT: u32 = 64;

impl EnvStr {
    #[inline]
    const fn pack(ptr: u64, tag: Tag, len: usize) -> EnvStr {
        EnvStr(
            (ptr as u128 & PTR_MASK)
                | ((tag as u16 as u128) << TAG_SHIFT)
                | ((len as u64 as u128) << LEN_SHIFT),
        )
    }

    #[inline]
    fn ptr(self) -> u64 {
        (self.0 & PTR_MASK) as u64
    }

    #[inline]
    fn tag(self) -> Tag {
        // SAFETY: only constructed via `pack` with a valid `Tag` discriminant.
        unsafe { core::mem::transmute::<u16, Tag>(((self.0 >> TAG_SHIFT) & TAG_MASK) as u16) }
    }

    #[inline]
    fn len(self) -> usize {
        (self.0 >> LEN_SHIFT) as u64 as usize
    }

    #[inline]
    pub fn init_slice(str: &[u8]) -> EnvStr {
        if str.is_empty() {
            // Zero length strings may have invalid pointers, leading to a bad integer cast.
            return Self::pack(0, Tag::Empty, 0);
        }

        Self::pack(to_ptr(str.as_ptr() as *const c_void), Tag::Slice, str.len())
    }

    /// Same thing as `init_ref_counted` except it duplicates the passed string
    pub fn dupe_ref_counted(old_str: &[u8]) -> EnvStr {
        if old_str.is_empty() {
            return Self::pack(0, Tag::Empty, 0);
        }

        // PORT NOTE: Zig was `bun.handleOom(bun.default_allocator.dupe(u8, old_str))`.
        // Global mimalloc + abort-on-OOM is the Rust default; ownership of the
        // duplicated bytes transfers to RefCountedStr.
        let str: Box<[u8]> = Box::<[u8]>::from(old_str);
        let len = str.len();
        // TODO(port): RefCountedStr::init signature — assumed to take ownership and return *mut RefCountedStr
        Self::pack(
            to_ptr(RefCountedStr::init(str) as *const c_void),
            Tag::Refcounted,
            len,
        )
    }

    pub fn init_ref_counted(str: Box<[u8]>) -> EnvStr {
        // TODO(port): Zig took `[]const u8` here and RefCountedStr assumed ownership of the
        // backing allocation. In Rust the caller must hand over a Box<[u8]> (or this should
        // borrow + dupe — revisit RefCountedStr ownership contract in Phase B).
        if str.is_empty() {
            return Self::pack(0, Tag::Empty, 0);
        }

        // PORT NOTE: Zig left `len` defaulted to 0 here (only `ptr` + `tag` set); the slice
        // length is recovered via RefCountedStr::byte_slice(). Preserve that.
        Self::pack(
            to_ptr(RefCountedStr::init(str) as *const c_void),
            Tag::Refcounted,
            0,
        )
    }

    pub fn slice(self) -> &[u8] {
        // TODO(port): lifetime — the returned slice borrows either external memory (Tag::Slice)
        // or the RefCountedStr buffer; neither is tied to `self` (which is Copy). Phase B should
        // decide whether to return `*const [u8]` or thread a lifetime.
        match self.tag() {
            Tag::Empty => b"",
            Tag::Slice => self.cast_slice(),
            Tag::Refcounted => unsafe { (*self.cast_ref_counted()).byte_slice() },
        }
    }

    pub fn memory_cost(self) -> usize {
        let divisor: usize = 'brk: {
            if let Some(refc) = self.as_ref_counted() {
                // SAFETY: as_ref_counted returned a live *mut RefCountedStr
                break 'brk unsafe { (*refc).refcount } as usize;
            }
            break 'brk 1;
        };
        if divisor == 0 {
            #[cold]
            fn cold() {}
            cold();
            return 0;
        }

        self.len() / divisor
    }

    pub fn ref_(self) {
        if let Some(refc) = self.as_ref_counted() {
            // SAFETY: as_ref_counted returned a live *mut RefCountedStr
            unsafe { (*refc).ref_() };
        }
    }

    pub fn deref(self) {
        if let Some(refc) = self.as_ref_counted() {
            // SAFETY: as_ref_counted returned a live *mut RefCountedStr
            unsafe { (*refc).deref() };
        }
    }

    #[inline]
    fn as_ref_counted(self) -> Option<*mut RefCountedStr> {
        if self.tag() == Tag::Refcounted {
            return Some(self.cast_ref_counted());
        }
        None
    }

    #[inline]
    fn cast_slice(self) -> &[u8] {
        // SAFETY: tag == Slice guarantees `ptr` was derived from a valid `[*]const u8` of
        // length `len` whose lifetime is managed elsewhere (caller contract of init_slice).
        // TODO(port): strict-provenance — ptr was round-tripped through an integer.
        unsafe { core::slice::from_raw_parts(self.ptr() as usize as *const u8, self.len()) }
    }

    #[inline]
    fn cast_ref_counted(self) -> *mut RefCountedStr {
        // SAFETY: tag == Refcounted guarantees `ptr` was derived from RefCountedStr::init.
        self.ptr() as usize as *mut RefCountedStr
    }
}

impl Default for EnvStr {
    fn default() -> Self {
        Self::pack(0, Tag::Empty, 0)
    }
}

#[inline]
fn to_ptr(ptr_val: *const c_void) -> u64 {
    // Zig: bitcast usize→[8]u8, take low 6 bytes, bitcast→u48.
    // Equivalent to masking the low 48 bits of the address.
    (ptr_val as usize as u64) & ((1u64 << 48) - 1)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/EnvStr.zig (119 lines)
//   confidence: medium
//   todos:      4
//   notes:      packed u128 modeled as #[repr(transparent)] with shift accessors; slice() lifetime + RefCountedStr::init ownership need Phase-B review
// ──────────────────────────────────────────────────────────────────────────
