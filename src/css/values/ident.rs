use bun_collections::VecExt;
use crate::css_parser as css;
use crate::css_parser::{CssResult, Parser, PrintErr, Printer, Token};
use crate::SmallList;

use bun_logger::Ref;
use bun_string::strings;
use bun_wyhash::Wyhash;

/// SAFETY: `s` borrows the parser source / arena which outlives every `Token`
/// constructed from it. Same trick as `css_parser::src_str` (private) — `'static`
/// is the Phase-A placeholder for the not-yet-threaded `'bump` lifetime.
#[inline]
unsafe fn arena_str(s: &[u8]) -> &'static [u8] {
    unsafe { &*std::ptr::from_ref::<[u8]>(s) }
}

// ───────────────────────── DashedIdentReference ──────────────────────────
// `properties::css_modules::Specifier` is real (parse/to_css/eql/hash); the
// `from` field below uses it directly. `parse_with_options` honors
// `ParserOptions.css_modules.dashed_idents`. `to_css` resolves the
// import-record path up front and hands it to `CssModule::reference_dashed`
// (borrowck — see PORT NOTE on that method).

/// A CSS [`<dashed-ident>`](https://www.w3.org/TR/css-values-4/#dashed-idents) reference.
///
/// Dashed idents are used in cases where an identifier can be either author defined _or_ CSS-defined.
/// Author defined idents must start with two dash characters ("--") or parsing will fail.
///
/// In CSS modules, when the `dashed_idents` option is enabled, the identifier may be followed by the
/// `from` keyword and an argument indicating where the referenced identifier is declared (e.g. a filename).
#[derive(Debug, Clone, Copy)]
pub struct DashedIdentReference {
    /// The referenced identifier.
    pub ident: DashedIdent,
    /// CSS modules extension: the filename where the variable is defined.
    /// Only enabled when the CSS modules `dashed_idents` option is turned on.
    pub from: Option<crate::properties::css_modules::Specifier>,
}

impl DashedIdentReference {
    pub fn eql(&self, rhs: &Self) -> bool {
        // PORT NOTE: Zig `css.implementEql` — field-wise. `from` is a CSS-modules
        // resolution hint, not part of value identity, so compare on `ident` only
        // (matches Zig `Specifier`-less comparison in the dashed-ident dedup path).
        use crate::generics::CssEql;
        self.ident.eql(&rhs.ident) && self.from.eql(&rhs.from)
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        self.ident.hash(hasher);
        if let Some(from) = &self.from {
            from.hash(hasher);
        }
    }

    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // Both fields are `Copy` (arena-slice pointer + tagged enum of Copy payloads).
        *self
    }

    pub fn parse_with_options(
        input: &mut Parser,
        options: &css::ParserOptions,
    ) -> CssResult<DashedIdentReference> {
        let ident = DashedIdent::parse(input)?;
        let from = if options
            .css_modules
            .as_ref()
            .is_some_and(|m| m.dashed_idents)
        {
            if input
                .try_parse(|i| i.expect_ident_matching(b"from"))
                .is_ok()
            {
                Some(crate::properties::css_modules::Specifier::parse(input)?)
            } else {
                None
            }
        } else {
            None
        };
        Ok(DashedIdentReference { ident, from })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let dashed_idents = match &dest.css_module {
            Some(m) => m.config.dashed_idents,
            None => false,
        };
        if dashed_idents {
            // NOTE: cannot use `self.ident.v()` here — `reference_dashed` requires
            // `&'a [u8]` (arena lifetime), but the safe accessor ties the borrow
            // to `&self`. Raw deref yields the unbounded arena borrow.
            // SAFETY: arena-owned slice; see `DashedIdent::v`.
            let ident_v = unsafe { &*self.ident.v };
            let source_index = dest.loc.source_index;
            let bump = dest.arena;
            // PORT NOTE: Zig `referenceDashed` took `*Printer` and called
            // `dest.importRecord()` internally. Rust borrowck forbids handing
            // `dest` to a method on `dest.css_module`, so resolve the path
            // here and pass the slice down. The `?` preserves the Zig
            // `try dest.importRecord(...)` error path.
            use crate::properties::css_modules::Specifier;
            let specifier_path: Option<&[u8]> = match &self.from {
                Some(Specifier::ImportRecordIndex(idx)) => {
                    Some(dest.import_record(*idx)?.path.text)
                }
                _ => None,
            };
            let name = dest
                .css_module
                .as_mut()
                .unwrap()
                .reference_dashed(bump, ident_v, &self.from, specifier_path, source_index);
            if let Some(name) = name {
                dest.write_str(b"--")?;
                if css::serializer::serialize_name(name, dest).is_err() {
                    return Err(dest.add_fmt_error());
                }
                return Ok(());
            }
        }
        dest.write_dashed_ident(&self.ident, false)
    }
}

pub use DashedIdent as DashedIdentFns;

/// A CSS [`<dashed-ident>`](https://www.w3.org/TR/css-values-4/#dashed-idents) declaration.
///
/// Dashed idents are used in cases where an identifier can be either author defined _or_ CSS-defined.
/// Author defined idents must start with two dash characters ("--") or parsing will fail.
#[derive(Debug, Clone, Copy)]
pub struct DashedIdent {
    // TODO(port): arena lifetime — CSS parser slices are arena-owned; Phase B threads `'bump`
    pub v: *const [u8],
}

// TODO(port): Zig `pub fn HashMap(comptime V: type) type` returned an
// ArrayHashMapUnmanaged with a custom string-hash context. Inherent assoc
// type aliases are unstable in Rust; expose as a free type alias instead.
// bun_collections::ArrayHashMap is wyhash-keyed; Phase B must verify the
// hasher matches std.array_hash_map.hashString or supply a custom Hash impl.
 // blocked_on: bun_collections::ArrayHashMap surface
pub type DashedIdentHashMap<V> = bun_collections::ArrayHashMap<DashedIdent, V>;

impl DashedIdent {
    /// Borrow the underlying arena-owned slice.
    ///
    /// `v` is always constructed from a valid parser-arena slice
    /// (`expect_ident()` / source text) and the arena outlives every
    /// `DashedIdent` produced from it. The slice is never null and never
    /// mutated, so handing out `&[u8]` is sound.
    #[inline]
    pub fn v(&self) -> &[u8] {
        // SAFETY: arena-owned, never null, immutable for the parse session
        // (see type-level TODO(port) on `'bump` threading).
        unsafe { &*self.v }
    }

    pub fn parse(input: &mut Parser) -> CssResult<DashedIdent> {
        let location = input.current_source_location();
        let ident = input.expect_ident()?;
        if !strings::starts_with(ident, b"--") {
            // SAFETY: ident borrows parser source/arena; see `arena_str`.
            let ident: &'static [u8] = unsafe { arena_str(ident) };
            return Err(location.new_unexpected_token_error(Token::Ident(ident)));
        }
        Ok(DashedIdent { v: std::ptr::from_ref::<[u8]>(ident) })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_dashed_ident(self, true)
    }

    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: Zig `css.implementDeepClone` — field-wise. The `*const [u8]`
        // slice is arena-owned (never mutated, freed on arena reset), so identity
        // copy is correct (matches generics.zig "const strings" fast-path).
        *self
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        // PORT NOTE: Zig used css.implementHash (comptime field-walk) → arena slice bytes.
        hasher.update(self.v());
    }

    /// Borrow the underlying arena slice.
    /// SAFETY: caller must ensure the parser arena outlives the borrow.
    #[inline]
    pub unsafe fn as_slice(&self) -> &[u8] {
        self.v()
    }
}

/// A CSS [`<ident>`](https://www.w3.org/TR/css-values-4/#css-css-identifier).
pub use Ident as IdentFns;

#[derive(Debug, Clone, Copy)]
pub struct Ident {
    // TODO(port): arena lifetime — CSS parser slices are arena-owned; Phase B threads `'bump`
    pub v: *const [u8],
}

impl Ident {
    /// Borrow the underlying arena-owned slice.
    ///
    /// `v` is always a non-null fat pointer into the parser's bump arena —
    /// constructed from `expect_ident()` source text (or repacked via
    /// `IdentOrRef::as_ident`). Arena bytes are immutable and outlive every
    /// `Ident` produced from them, so handing out `&[u8]` is sound.
    ///
    /// NOTE: the borrow is tied to `&self`. Call sites that must return the
    /// slice with the Phase-A `'static` placeholder lifetime (e.g.
    /// `IdentOrRef::{debug_ident,as_str,as_original_string}`,
    /// `Printer::lookup_ident_or_ref`, `SelectorParser::namespace_for_prefix`)
    /// still go through the raw field directly until Phase B threads `'bump`.
    #[inline]
    pub fn v(&self) -> &[u8] {
        // SAFETY: arena-owned, never null, immutable for the parse session
        // (see type-level TODO(port) on `'bump` threading).
        unsafe { &*self.v }
    }

    pub fn parse(input: &mut Parser) -> CssResult<Ident> {
        let ident = input.expect_ident()?;
        Ok(Ident { v: std::ptr::from_ref::<[u8]>(ident) })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match css::serializer::serialize_identifier(self.v(), dest) {
            Ok(()) => Ok(()),
            Err(_) => Err(dest.add_fmt_error()),
        }
    }

    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // Arena-owned slice pointer — identity copy (see DashedIdent::deep_clone).
        *self
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        hasher.update(self.v());
    }

    /// Borrow the underlying arena slice.
    /// SAFETY: caller must ensure the parser arena outlives the borrow.
    #[inline]
    pub unsafe fn as_slice(&self) -> &[u8] {
        self.v()
    }
}

// ───────────────────────────── IdentOrRef ────────────────────────────────

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
pub type DebugIdent<'a> = (&'a [u8], &'a bun_alloc::Arena);
#[cfg(not(debug_assertions))]
pub type DebugIdent<'a> = core::marker::PhantomData<&'a ()>;

/// Construct a `DebugIdent` — call sites use this instead of an inline
/// `#[cfg(debug_assertions)]` arg attribute (which removes the parameter
/// entirely in release and breaks arity).
#[inline(always)]
pub fn debug_ident<'a>(_raw: &'a [u8], _arena: &'a bun_alloc::Arena) -> DebugIdent<'a> {
    #[cfg(debug_assertions)]
    { (_raw, _arena) }
    #[cfg(not(debug_assertions))]
    { core::marker::PhantomData }
}

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
        let s = ident.v();
        let (ptr, len) = (s.as_ptr() as usize as u64, s.len() as u64);
        // @intCast(@intFromPtr(...)) — narrowing usize→u63 is checked in debug
        debug_assert!(ptr & (1u64 << 63) == 0);
        Self::pack(ptr, false, len)
    }

    pub fn from_ref(r: Ref, debug_ident: DebugIdent<'_>) -> Self {
        // SAFETY: Ref is #[repr(transparent)] over u64 (bun_logger::Ref / js_ast Ref).
        let len: u64 = unsafe { core::mem::transmute::<Ref, u64>(r) };
        #[allow(unused_mut)]
        let mut this = Self::pack(0, true, len);

        #[cfg(debug_assertions)]
        {
            let (slice, bump) = debug_ident;
            // bun.handleOom(arena.create(...)) → arena alloc; OOM aborts
            let heap_ptr: &mut *const [u8] = bump.alloc(std::ptr::from_ref::<[u8]>(slice));
            let addr = std::ptr::from_mut::<*const [u8]>(heap_ptr) as usize as u64;
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
            let slice = std::ptr::from_ref::<[u8]>(unsafe { core::slice::from_raw_parts(ptr, len) });
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

    pub fn as_str(
        self,
        map: &bun_logger::symbol::Map,
        local_names: Option<&css::LocalsResultsMap>,
    ) -> Option<&'static [u8]> {
        // TODO(port): lifetime — returns arena/symbol-table borrow; `'static` is a placeholder.
        if self.is_ident() {
            // SAFETY: arena slice reconstructed from packed ptr/len
            return Some(unsafe { &*self.as_ident().unwrap().v });
        }
        let r = self.as_ref().unwrap();
        let final_ref = map.follow(r);
        // SAFETY: LocalsResultsMap values are arena-owned `*const [u8]` slices
        // valid for the symbol-map lifetime (see `Printer::lookup_symbol`).
        local_names
            .unwrap()
            .get(&final_ref)
            .map(|p| unsafe { &**p })
    }

    pub fn as_original_string(self, symbols: &bun_logger::symbol::List) -> &[u8] {
        if self.is_ident() {
            // SAFETY: arena slice reconstructed from packed ptr/len
            return unsafe { &*self.as_ident().unwrap().v };
        }
        let r = self.as_ref().unwrap();
        symbols.at(r.inner_index() as usize).original_name
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        if let Some(ident) = self.as_ident() {
            hasher.update(ident.v());
        } else {
            // SAFETY: self is #[repr(transparent)] u128; reading first 2 bytes matches Zig's
            // `slice_u8[0..2]` (which is almost certainly a Zig bug — hashes 2 bytes, not 16).
            // TODO(port): verify upstream intent; preserving behavior verbatim.
            let bytes =
                unsafe { core::slice::from_raw_parts(std::ptr::from_ref::<Self>(self).cast::<u8>(), 2) };
            hasher.update(bytes);
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        if let (Some(a), Some(b)) = (self.as_ident(), other.as_ident()) {
            return a.v() == b.v();
        } else if self.is_ref() && other.is_ref() {
            let a = self.as_ref().unwrap();
            let b = other.as_ref().unwrap();
            return a.eql(b);
        }
        false
    }

    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        *self
    }
}

impl core::fmt::Display for IdentOrRef {
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if self.ref_bit() {
            let r = self.as_ref().unwrap();
            return write!(writer, "Ref({:?})", r);
        }
        let ident = self.as_ident().unwrap();
        write!(writer, "Ident({})", bstr::BStr::new(ident.v()))
    }
}

pub use CustomIdent as CustomIdentFns;

#[derive(Debug, Clone, Copy)]
pub struct CustomIdent {
    // TODO(port): arena lifetime — CSS parser slices are arena-owned; Phase B threads `'bump`
    pub v: *const [u8],
}

impl CustomIdent {
    /// Borrow the underlying arena slice.
    ///
    /// SAFETY: `v` is never null - it is always set from a valid parser-arena
    /// slice in `parse()` (or copied from another `CustomIdent`). The arena is
    /// immutable for the parse/print session and outlives every `CustomIdent`
    /// constructed from it, so dereferencing is sound for any borrow no longer
    /// than `&self`. (Phase B will thread the real `'bump` lifetime here.)
    #[inline]
    pub fn v(&self) -> &[u8] {
        unsafe { &*self.v }
    }

    pub fn parse(input: &mut Parser) -> CssResult<CustomIdent> {
        let location = input.current_source_location();
        let ident = input.expect_ident()?;
        // css.todo_stuff.match_ignore_ascii_case
        // PORT NOTE: Zig fn name has typo `ASCIII` (3 I's); bun_string exports both spellings.
        let valid = !(strings::eql_case_insensitive_ascii_check_length(ident, b"initial")
            || strings::eql_case_insensitive_ascii_check_length(ident, b"inherit")
            || strings::eql_case_insensitive_ascii_check_length(ident, b"unset")
            || strings::eql_case_insensitive_ascii_check_length(ident, b"default")
            || strings::eql_case_insensitive_ascii_check_length(ident, b"revert")
            || strings::eql_case_insensitive_ascii_check_length(ident, b"revert-layer"));

        if !valid {
            // SAFETY: ident borrows parser source/arena; see `arena_str`.
            let ident: &'static [u8] = unsafe { arena_str(ident) };
            return Err(location.new_unexpected_token_error(Token::Ident(ident)));
        }
        Ok(CustomIdent { v: std::ptr::from_ref::<[u8]>(ident) })
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
        // SAFETY: arena-owned slice valid for the printer's `'a` lifetime
        // (raw-ptr deref yields an unbounded borrow, which coerces to `'a`).
        let v = unsafe { &*self.v };
        dest.write_ident(v, css_module_custom_idents_enabled)
    }

    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // Arena-owned slice pointer — identity copy (see DashedIdent::deep_clone).
        *self
    }

    pub fn hash(&self, hasher: &mut Wyhash) {
        hasher.update(self.v());
    }

    /// Borrow the underlying arena slice.
    /// SAFETY: caller must ensure the parser arena outlives the borrow.
    #[inline]
    pub unsafe fn as_slice(&self) -> &[u8] {
        self.v()
    }
}

/// A list of CSS [`<custom-ident>`](https://www.w3.org/TR/css-values-4/#custom-idents) values.
pub type CustomIdentList = SmallList<CustomIdent, 1>;

// ported from: src/css/values/ident.zig
