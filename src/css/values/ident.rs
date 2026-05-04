use crate as css;
use crate::{Parser, ParserOptions, Printer, PrintErr, Result as CssResult, LocalsResultsMap, SmallList};
use crate::css_properties::css_modules::Specifier;

use bun_alloc::Arena as Bump;
use bun_str::strings;
use bun_wyhash::Wyhash;
use bun_bundler::Ref;
use bun_js_parser::Symbol;

/// A CSS [`<dashed-ident>`](https://www.w3.org/TR/css-values-4/#dashed-idents) reference.
///
/// Dashed idents are used in cases where an identifier can be either author defined _or_ CSS-defined.
/// Author defined idents must start with two dash characters ("--") or parsing will fail.
///
/// In CSS modules, when the `dashed_idents` option is enabled, the identifier may be followed by the
/// `from` keyword and an argument indicating where the referenced identifier is declared (e.g. a filename).
pub struct DashedIdentReference {
    /// The referenced identifier.
    pub ident: DashedIdent,
    /// CSS modules extension: the filename where the variable is defined.
    /// Only enabled when the CSS modules `dashed_idents` option is turned on.
    pub from: Option<Specifier>,
}

impl DashedIdentReference {
    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        css::implement_eql(lhs, rhs)
    }

    pub fn parse_with_options(input: &mut Parser, options: &ParserOptions) -> CssResult<DashedIdentReference> {
        let ident = match DashedIdent::parse(input) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };

        let from = if options.css_modules.is_some() && options.css_modules.as_ref().unwrap().dashed_idents {
            'from: {
                if input.try_parse(Parser::expect_ident_matching, (b"from",)).is_ok() {
                    break 'from match Specifier::parse(input) {
                        CssResult::Ok(vv) => Some(vv),
                        CssResult::Err(e) => return CssResult::Err(e),
                    };
                }
                break 'from None;
            }
        } else {
            None
        };

        CssResult::Ok(DashedIdentReference { ident, from })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if let Some(css_module) = &mut dest.css_module {
            if css_module.config.dashed_idents {
                // SAFETY: arena-owned slice; see DashedIdent.v
                let ident_v = unsafe { &*self.ident.v };
                if let Some(name) = css_module.reference_dashed(dest, ident_v, &self.from, dest.loc.source_index)? {
                    dest.write_str("--")?;
                    if let Err(_) = css::serializer::serialize_name(name, dest) {
                        return dest.add_fmt_error();
                    }
                    return Ok(());
                }
            }
        }

        dest.write_dashed_ident(&self.ident, false)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }
}

pub use DashedIdent as DashedIdentFns;

/// A CSS [`<dashed-ident>`](https://www.w3.org/TR/css-values-4/#dashed-idents) declaration.
///
/// Dashed idents are used in cases where an identifier can be either author defined _or_ CSS-defined.
/// Author defined idents must start with two dash characters ("--") or parsing will fail.
pub struct DashedIdent {
    // TODO(port): arena lifetime — CSS parser slices are arena-owned; Phase B threads `'bump`
    pub v: *const [u8],
}

impl DashedIdent {
    // TODO(port): Zig `pub fn HashMap(comptime V: type) type` returned an ArrayHashMapUnmanaged
    // with a custom string-hash context. bun_collections::ArrayHashMap is wyhash-keyed; Phase B
    // must verify the hasher matches std.array_hash_map.hashString or supply a custom Hash impl.
    pub type HashMap<V> = bun_collections::ArrayHashMap<DashedIdent, V>;

    pub fn parse(input: &mut Parser) -> CssResult<DashedIdent> {
        let location = input.current_source_location();
        let ident = match input.expect_ident() {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        if !strings::starts_with(ident, b"--") {
            return CssResult::Err(location.new_unexpected_token_error(css::Token::Ident(ident)));
        }

        CssResult::Ok(DashedIdent { v: ident as *const [u8] })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_dashed_ident(self, true)
    }

    pub fn deep_clone(&self, bump: &Bump) -> Self {
        css::implement_deep_clone(self, bump)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }
}

/// A CSS [`<ident>`](https://www.w3.org/TR/css-values-4/#css-css-identifier).
pub use Ident as IdentFns;

pub struct Ident {
    // TODO(port): arena lifetime — CSS parser slices are arena-owned; Phase B threads `'bump`
    pub v: *const [u8],
}

impl Ident {
    pub fn parse(input: &mut Parser) -> CssResult<Ident> {
        let ident = match input.expect_ident() {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        CssResult::Ok(Ident { v: ident as *const [u8] })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // SAFETY: arena-owned slice valid for the printer's lifetime
        let v = unsafe { &*self.v };
        match css::serializer::serialize_identifier(v, dest) {
            Ok(()) => Ok(()),
            Err(_) => dest.add_fmt_error(),
        }
    }

    pub fn deep_clone(&self, bump: &Bump) -> Self {
        css::implement_deep_clone(self, bump)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }
}

/// Encodes an `Ident` or the bundler's `Ref` into 16 bytes.
///
/// It uses the top bit of the pointer to denote whether it's an ident or a ref
///
/// If it's an `Ident`, then `__ref_bit == false` and `__len` is the length of the slice.
///
/// If it's `Ref`, then `__ref_bit == true` and `__len` is the bit pattern of the `Ref`.
///
/// In debug mode, if it is a `Ref` we will also set the `__ptrbits` to point to the original
/// []const u8 so we can debug the string. This should be fine since we use arena
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct IdentOrRef(u128);

impl Default for IdentOrRef {
    fn default() -> Self {
        IdentOrRef(0)
    }
}

// Zig packed struct(u128) field layout, LSB-first:
//   __ptrbits: u63  -> bits  0..63
//   __ref_bit: bool -> bit   63
//   __len:     u64  -> bits 64..128
const PTRBITS_MASK: u128 = (1u128 << 63) - 1;
const REF_BIT: u128 = 1u128 << 63;

#[allow(dead_code)]
enum Tag {
    Ident,
    Ref,
}

#[cfg(debug_assertions)]
pub type DebugIdent<'a> = (&'a [u8], &'a Bump);
#[cfg(not(debug_assertions))]
pub type DebugIdent = ();

impl IdentOrRef {
    #[inline]
    fn ptrbits(self) -> u64 {
        (self.0 & PTRBITS_MASK) as u64
    }

    #[inline]
    fn ref_bit(self) -> bool {
        (self.0 & REF_BIT) != 0
    }

    #[inline]
    fn len_bits(self) -> u64 {
        (self.0 >> 64) as u64
    }

    #[inline]
    fn pack(ptrbits: u64, ref_bit: bool, len: u64) -> Self {
        let mut v: u128 = (ptrbits as u128) & PTRBITS_MASK;
        if ref_bit {
            v |= REF_BIT;
        }
        v |= (len as u128) << 64;
        IdentOrRef(v)
    }

    #[cfg(debug_assertions)]
    pub fn debug_ident(self) -> &'static [u8] {
        // TODO(port): lifetime — returns arena-borrowed slice; `'static` is a placeholder.
        if self.ref_bit() {
            // SAFETY: in debug builds, ptrbits stores a heap pointer to a *const [u8] written by from_ref
            let ptr = self.ptrbits() as usize as *const *const [u8];
            unsafe { &**ptr }
        } else {
            // SAFETY: as_ident reconstructs the arena slice this was packed from
            unsafe { &*self.as_ident().unwrap().v }
        }
    }

    // NOTE: no `#[cfg(not(debug_assertions))]` variant. Zig's `@compileError` is lazy (fires only
    // if the body is analyzed); Rust's `compile_error!` fires at expansion and would break every
    // release build. Omitting the fn in release yields a name-resolution error at the call site,
    // which is the closest Rust equivalent.

    pub fn from_ident(ident: Ident) -> Self {
        // SAFETY: ident.v is a valid fat pointer; we extract addr+len for packing
        let (ptr, len) = unsafe {
            let s = &*ident.v;
            (s.as_ptr() as usize as u64, s.len() as u64)
        };
        // @intCast(@intFromPtr(...)) — narrowing usize→u63 is checked in debug
        debug_assert!(ptr & (1u64 << 63) == 0);
        Self::pack(ptr, false, len)
    }

    pub fn from_ref(r: Ref, debug_ident: DebugIdent) -> Self {
        // SAFETY: Ref is #[repr(transparent)] over u64 (bun.bundle_v2.Ref is packed struct(u64))
        let len: u64 = unsafe { core::mem::transmute::<Ref, u64>(r) };
        let mut this = Self::pack(0, true, len);

        #[cfg(debug_assertions)]
        {
            let (slice, bump) = debug_ident;
            // bun.handleOom(allocator.create(...)) → arena alloc; OOM aborts
            let heap_ptr: &mut *const [u8] = bump.alloc(slice as *const [u8]);
            let addr = heap_ptr as *mut *const [u8] as usize as u64;
            debug_assert!(addr & (1u64 << 63) == 0);
            this = Self::pack(addr, true, len);
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = debug_ident;
        }

        this
    }

    #[inline]
    pub fn is_ident(self) -> bool {
        !self.ref_bit()
    }

    #[inline]
    pub fn is_ref(self) -> bool {
        self.ref_bit()
    }

    #[inline]
    pub fn as_ident(self) -> Option<Ident> {
        if !self.ref_bit() {
            let ptr = self.ptrbits() as usize as *const u8;
            let len = self.len_bits() as usize;
            // SAFETY: ptr/len were packed from a valid arena slice in from_ident
            let slice = unsafe { core::slice::from_raw_parts(ptr, len) } as *const [u8];
            return Some(Ident { v: slice });
        }
        None
    }

    #[inline]
    pub fn as_ref(self) -> Option<Ref> {
        if self.ref_bit() {
            // SAFETY: len_bits stores the exact u64 bit pattern written by from_ref
            let out: Ref = unsafe { core::mem::transmute::<u64, Ref>(self.len_bits()) };
            return Some(out);
        }
        None
    }

    pub fn as_str(self, map: &Symbol::Map, local_names: Option<&LocalsResultsMap>) -> Option<&'static [u8]> {
        // TODO(port): lifetime — returns arena/symbol-table borrow; `'static` is a placeholder.
        if self.is_ident() {
            // SAFETY: arena slice reconstructed from packed ptr/len
            return Some(unsafe { &*self.as_ident().unwrap().v });
        }
        let r = self.as_ref().unwrap();
        let final_ref = map.follow(r);
        local_names.unwrap().get(final_ref)
    }

    pub fn as_original_string(self, symbols: &Symbol::List) -> &[u8] {
        if self.is_ident() {
            // SAFETY: arena slice reconstructed from packed ptr/len
            return unsafe { &*self.as_ident().unwrap().v };
        }
        let r = self.as_ref().unwrap();
        symbols.at(r.inner_index()).original_name
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        if self.is_ident() {
            // SAFETY: arena slice reconstructed from packed ptr/len
            hasher.update(unsafe { &*self.as_ident().unwrap().v });
        } else {
            // SAFETY: self is #[repr(transparent)] u128; reading first 2 bytes matches Zig's
            // `slice_u8[0..2]` (which is almost certainly a Zig bug — hashes 2 bytes, not 16).
            // TODO(port): verify upstream intent; preserving behavior verbatim.
            let bytes = unsafe {
                core::slice::from_raw_parts(self as *const Self as *const u8, 2)
            };
            hasher.update(bytes);
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        if self.is_ident() && other.is_ident() {
            // SAFETY: arena slices reconstructed from packed ptr/len
            let a = unsafe { &*self.as_ident().unwrap().v };
            let b = unsafe { &*other.as_ident().unwrap().v };
            return a == b;
        } else if self.is_ref() && other.is_ref() {
            let a = self.as_ref().unwrap();
            let b = other.as_ref().unwrap();
            return a.eql(b);
        }
        false
    }

    pub fn deep_clone(&self, _bump: &Bump) -> Self {
        *self
    }
}

impl core::fmt::Display for IdentOrRef {
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if self.ref_bit() {
            let r = self.as_ref().unwrap();
            return write!(writer, "Ref({})", r);
        }
        // SAFETY: arena slice reconstructed from packed ptr/len
        let v = unsafe { &*self.as_ident().unwrap().v };
        write!(writer, "Ident({})", bstr::BStr::new(v))
    }
}

pub use CustomIdent as CustomIdentFns;

pub struct CustomIdent {
    // TODO(port): arena lifetime — CSS parser slices are arena-owned; Phase B threads `'bump`
    pub v: *const [u8],
}

impl CustomIdent {
    pub fn parse(input: &mut Parser) -> CssResult<CustomIdent> {
        let location = input.current_source_location();
        let ident = match input.expect_ident() {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        // css.todo_stuff.match_ignore_ascii_case
        // TODO(port): Zig fn name has typo `ASCIII` (3 I's); bun_str exports the corrected name.
        let valid = !(strings::eql_case_insensitive_ascii_check_length(ident, b"initial")
            || strings::eql_case_insensitive_ascii_check_length(ident, b"inherit")
            || strings::eql_case_insensitive_ascii_check_length(ident, b"unset")
            || strings::eql_case_insensitive_ascii_check_length(ident, b"default")
            || strings::eql_case_insensitive_ascii_check_length(ident, b"revert")
            || strings::eql_case_insensitive_ascii_check_length(ident, b"revert-layer"));

        if !valid {
            return CssResult::Err(location.new_unexpected_token_error(css::Token::Ident(ident)));
        }
        CssResult::Ok(CustomIdent { v: ident as *const [u8] })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        Self::to_css_with_options(self, dest, true)
    }

    /// Write the custom ident to CSS.
    pub fn to_css_with_options(
        &self,
        dest: &mut Printer,
        enabled_css_modules: bool,
    ) -> Result<(), PrintErr> {
        let css_module_custom_idents_enabled = enabled_css_modules
            && if let Some(css_module) = &dest.css_module {
                css_module.config.custom_idents
            } else {
                false
            };
        // SAFETY: arena-owned slice
        let v = unsafe { &*self.v };
        dest.write_ident(v, css_module_custom_idents_enabled)
    }

    pub fn deep_clone(&self, bump: &Bump) -> Self {
        css::implement_deep_clone(self, bump)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        css::implement_hash(self, hasher)
    }
}

/// A list of CSS [`<custom-ident>`](https://www.w3.org/TR/css-values-4/#custom-idents) values.
pub type CustomIdentList = SmallList<CustomIdent, 1>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/ident.zig (324 lines)
//   confidence: medium
//   todos:      8
//   notes:      `v: []const u8` fields use raw *const [u8] (arena-owned) pending 'bump threading; IdentOrRef.hash preserves suspicious Zig 2-byte hash; inherent assoc type alias (HashMap<V>) needs Phase B reshape; debug_ident is debug-only (no release stub — Rust compile_error! is eager).
// ──────────────────────────────────────────────────────────────────────────
