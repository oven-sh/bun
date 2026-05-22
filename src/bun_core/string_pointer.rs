// ── StringBuilder ─────────────────────────────────────────────────────────
// Port of src/string/StringBuilder.zig. Count-then-allocate-then-append arena
// for building a single contiguous buffer. Allocator param dropped per
// PORTING.md §Allocators (always `bun.default_allocator`).
//
// PORT NOTE: returned sub-slices borrow `*self`, but in Zig they alias the
// final `allocated_slice()` and outlive the builder. To keep that pattern
// without self-referential lifetimes, callers stash `(offset, len)` via
// `StringPointer` (see install/hosted_git_info.rs).
//
// Canonical `StringBuilder` lives in `bun_core::StringBuilder`
// (src/string/StringBuilder.rs). Cannot re-export here (`bun_string` depends
// on `bun_core` → cycle); callers import `bun_core::StringBuilder` directly.
// `StringPointer` stays here as the layered #[repr(C)] ABI type re-exported by
// `bun_string` et al.

/// `bun.schema.api.StringPointer` — `(offset, length)` span into an external
/// buffer. Canonical definition; re-exported by `bun_string`, `bun_http_types`,
/// and `bun_url` (formerly each had a structurally-identical copy). Layout MUST
/// match `extern struct { offset: u32, length: u32 }` — C++ (`WebCore::FetchHeaders`)
/// and on-disk formats (lockfile, npm manifest cache) read it directly.
#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct StringPointer {
    pub offset: u32,
    pub length: u32,
}
impl StringPointer {
    #[inline]
    pub fn slice<'a>(self, buf: &'a [u8]) -> &'a [u8] {
        &buf[self.offset as usize..(self.offset + self.length) as usize]
    }
    #[inline]
    pub fn is_empty(self) -> bool {
        self.length == 0
    }
}
