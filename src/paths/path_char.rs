//! Canonical `PathChar` — the one trait abstracting over `u8`/`u16` path code
//! units. Replaces the per-crate re-definitions that grew out of porting Zig's
//! `comptime T: type` duck-typing (Zig had **no** trait; every site asserted
//! `T ∈ {u8,u16}` via `validatePathT` and shared exactly one helper,
//! `bun.strings.literal(T, str)` at `string/immutable/unicode.zig:1395`).
//!
//! Tier-0: depends only on `bun_core`. Higher crates **extend** this trait
//! (`bun_paths::PathUnit`, `bun_sys::make_path::MakePathUnit`,
//! `bun_runtime::node::path::PathCharCwd`, `bun_core::Ch`) — they never
//! redefine the core surface.

use bun_core::strings;

/// A path code unit: `u8` (UTF-8/WTF-8) or `u16` (WTF-16, Windows).
///
/// Supertrait `PathByte` provides `Copy + Eq + 'static` plus `from_u8`. This
/// trait adds the closed-set operations every path-generic fn in the codebase
/// reaches for: ASCII comparison, case folding, widening to `u32`, the
/// `bun.strings.literal(T, "...")` const-widened static, and the one
/// transcoding write (`write_u8_part`) that lets `u16` call sites memcpy a
/// UTF-8 part without an `if T::IS_U16` branch.
pub trait PathChar: strings::PathByte + Ord {
    /// `true` iff `Self == u16` (WTF-16). Replaces Zig's `if (T == u16)`.
    const IS_U16: bool;

    // `from_u8` inherited from `PathByte`.

    /// Widen losslessly to `u32` (for `is_windows_device_root_t` range checks
    /// and other ASCII classification that wants a uniform integer type).
    fn as_u32(self) -> u32;

    /// `Some(b)` if this code unit is in the ASCII range (`<= 0x7F`), else
    /// `None`. `u8` always returns `Some(self)` (matches Zig's `@intCast` site
    /// which never observed non-ASCII u8 there).
    #[inline]
    fn to_ascii(self) -> Option<u8> {
        let w = self.as_u32();
        if w < 128 { Some(w as u8) } else { None }
    }

    /// `self == c as Self` — compare against an ASCII byte without widening
    /// the literal at every call site.
    #[inline]
    fn eq_ascii(self, c: u8) -> bool {
        self == Self::from_u8(c)
    }

    /// ASCII upper-case (passes through non-ASCII unchanged). Port of the
    /// per-unit upper-casing in `resolve_path.zig` drive-letter handling.
    #[inline]
    fn to_ascii_upper(self) -> Self {
        match self.to_ascii() {
            Some(b @ b'a'..=b'z') => Self::from_u8(b - 32),
            _ => self,
        }
    }

    #[inline]
    fn is_ascii_alphabetic(self) -> bool {
        matches!(self.to_ascii(), Some(b) if b.is_ascii_alphabetic())
    }

    /// `bun.strings.literal(T, "...")` — yields a `&'static [Self]` for an
    /// ASCII byte literal. `u8` returns the input slice; `u16` const-widens
    /// the **closed set** of literals actually passed by callers (see the
    /// `match` in the `u16` impl). Zero allocation; matches Zig's comptime
    /// `Holder.value` static-per-call-site emission.
    fn lit(s: &'static [u8]) -> &'static [Self];

    /// Write a UTF-8 path part into `dest` (transcoding to UTF-16 when
    /// `Self == u16`, else memcpy). Returns units written.
    fn write_u8_part(dest: &mut [Self], part: &[u8]) -> usize;
}

impl PathChar for u8 {
    const IS_U16: bool = false;
    #[inline(always)]
    fn as_u32(self) -> u32 {
        self as u32
    }
    #[inline(always)]
    fn to_ascii(self) -> Option<u8> {
        Some(self)
    }
    #[inline(always)]
    fn eq_ascii(self, c: u8) -> bool {
        self == c
    }
    #[inline(always)]
    fn to_ascii_upper(self) -> Self {
        self.to_ascii_uppercase()
    }
    #[inline(always)]
    fn lit(s: &'static [u8]) -> &'static [u8] {
        s
    }
    #[inline]
    fn write_u8_part(dest: &mut [u8], part: &[u8]) -> usize {
        dest[..part.len()].copy_from_slice(part);
        part.len()
    }
}

impl PathChar for u16 {
    const IS_U16: bool = true;
    #[inline(always)]
    fn as_u32(self) -> u32 {
        self as u32
    }
    #[inline]
    fn lit(s: &'static [u8]) -> &'static [u16] {
        // Zig's `bun.strings.literal(u16, str)` is `std.unicode.utf8ToUtf16LeStringLiteral`
        // — a comptime constant. Rust cannot widen an arbitrary `&'static [u8]` at
        // const time, so dispatch on the closed set of ASCII literals actually
        // passed through `T::lit` across the codebase. Each gets one static,
        // exactly as Zig emits one `Holder.value` per call site. Zero runtime
        // allocation; `Box::leak` is forbidden here (PORTING.md §Forbidden).
        macro_rules! w {
            ($($b:literal),* $(,)?) => {{ static W: &[u16] = &[$($b as u16),*]; W }};
        }
        match s {
            b"" => &[],
            b"." => w!(b'.'),
            b"/" => w!(b'/'),
            b"\\" => w!(b'\\'),
            b".." => w!(b'.', b'.'),
            b"./" => w!(b'.', b'/'),
            b"//" => w!(b'/', b'/'),
            b"/\\" => w!(b'/', b'\\'),
            b":\\" => w!(b':', b'\\'),
            b"UNC" => w!(b'U', b'N', b'C'),
            b"\\:\\" => w!(b'\\', b':', b'\\'),
            b"\\??\\" => w!(b'\\', b'?', b'?', b'\\'),
            // The literal set is closed (every `T::lit` call site is one of the
            // arms above). Reaching this arm is a porting bug — fail loudly in
            // debug, return empty in release rather than leak.
            _ => {
                debug_assert!(false, "PathChar::<u16>::lit: unhandled literal {:?}", s);
                &[]
            }
        }
    }
    #[inline]
    fn write_u8_part(dest: &mut [u16], part: &[u8]) -> usize {
        strings::convert_utf8_to_utf16_in_buffer(dest, part).len()
    }
}
