use crate::SmallList;
use crate::css_parser as css;
use crate::css_parser::{CssResult, Parser, PrintErr, Printer, Token};

use bun_ast::Ref;
use bun_core::strings;
use bun_wyhash::Wyhash;

// ──────────────────────── arena-slice newtype boilerplate ────────────────
// `DashedIdent` / `Ident` / `CustomIdent` are DISTINCT CSS value types per
// spec (their `parse`/`to_css` differ intentionally — `--` prefix check,
// plain ident, CSS-wide-keyword rejection respectively) but share an
// identical `*const [u8]` arena-slice newtype shell. This macro stamps out
// the struct + the byte-identical `v()`/`deep_clone`/`hash`/`as_slice`
// boilerplate; per-type `parse`/`to_css` live in separate inherent `impl`
// blocks below (Rust allows multiple inherent impls). Precedent:
// `generics.rs` `ident_eql_impl!` already macroizes the shared `CssEql`.
macro_rules! arena_slice_newtype {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy)]
        pub struct $name {
            // CSS parser slices are arena-owned; the borrow is erased to a raw
            // pointer until the crate threads a `'bump` lifetime (see
            // PORTING.md §Allocators). Never dereferenced after arena reset.
            pub v: *const [u8],
        }

        impl $name {
            /// Borrow the underlying arena-owned slice.
            ///
            /// `v` is always a non-null fat pointer into the parser's bump arena
            /// (constructed from `expect_ident()` source text or copied from
            /// another instance). Arena bytes are immutable and outlive every
            /// value produced from them, so handing out `&[u8]` is sound.
            ///
            /// NOTE: the borrow is tied to `&self`. Call sites that must return
            /// the slice with the `'static` placeholder lifetime (e.g.
            /// `IdentOrRef::{debug_ident,as_str,as_original_string}`,
            /// `Printer::lookup_ident_or_ref`, `SelectorParser::namespace_for_prefix`)
            /// still go through the raw `v` field directly until `'bump` is threaded.
            #[inline]
            pub fn v(&self) -> &[u8] {
                // SAFETY: arena-owned, never null, immutable for the parse session
                // (see the field-level comment on `'bump` threading).
                unsafe { crate::arena_str(self.v) }
            }

            pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
                // The `*const [u8]` slice is arena-owned (never mutated, freed
                // on arena reset), so identity copy is correct.
                *self
            }

            pub fn hash(&self, hasher: &mut Wyhash) {
                // Hash the arena slice bytes.
                hasher.update(self.v());
            }

            /// Borrow the underlying arena slice.
            /// SAFETY: caller must ensure the parser arena outlives the borrow.
            #[inline]
            pub unsafe fn as_slice(&self) -> &[u8] {
                self.v()
            }
        }
    };
}

// ───────────────────────── DashedIdentReference ──────────────────────────
// `properties::css_modules::Specifier` is real (parse/to_css/eql/hash); the
// `from` field below uses it directly. `parse_with_options` honors
// `ParserOptions.css_modules.dashed_idents`. `to_css` resolves the
// import-record path up front and hands it to `CssModule::reference_dashed`
// (borrowck — see the comment on that method).

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
    pub(crate) ident: DashedIdent,
    /// CSS modules extension: the filename where the variable is defined.
    /// Only enabled when the CSS modules `dashed_idents` option is turned on.
    pub(crate) from: Option<crate::properties::css_modules::Specifier>,
}

impl DashedIdentReference {
    pub(crate) fn eql(&self, rhs: &Self) -> bool {
        // Field-wise over `ident` and `from`.
        use crate::generics::CssEql;
        self.ident.eql(&rhs.ident) && self.from.eql(&rhs.from)
    }

    pub(crate) fn hash(&self, hasher: &mut Wyhash) {
        self.ident.hash(hasher);
        if let Some(from) = &self.from {
            from.hash(hasher);
        }
    }

    pub(crate) fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // Both fields are `Copy` (arena-slice pointer + tagged enum of Copy payloads).
        *self
    }

    pub(crate) fn parse_with_options(
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

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let dashed_idents = match &dest.css_module {
            Some(m) => m.config.dashed_idents,
            None => false,
        };
        if dashed_idents {
            // NOTE: cannot use `self.ident.v()` here — `reference_dashed` requires
            // `&'a [u8]` (arena lifetime), but the safe accessor ties the borrow
            // to `&self`. Raw deref yields the unbounded arena borrow.
            // SAFETY: arena-owned slice; see `DashedIdent::v`.
            let ident_v = unsafe { crate::arena_str(self.ident.v) };
            let source_index = dest.loc.source_index;
            let bump = dest.arena;
            // Borrowck forbids handing
            // `dest` to a method on `dest.css_module`, so resolve the path
            // here and pass the slice down. The `?` propagates the
            // `import_record` error path.
            use crate::properties::css_modules::Specifier;
            let specifier_path: Option<&[u8]> = match &self.from {
                Some(Specifier::ImportRecordIndex(idx)) => {
                    Some(dest.import_record(*idx)?.path.text)
                }
                _ => None,
            };
            let name = dest.css_module.as_mut().unwrap().reference_dashed(
                bump,
                ident_v,
                self.from,
                specifier_path,
                source_index,
            );
            if let Some(name) = name {
                dest.write_str(b"--")?;
                return dest.serialize_name(name);
            }
        }
        dest.write_dashed_ident(&self.ident)
    }
}

pub use DashedIdent as DashedIdentFns;

arena_slice_newtype! {
    /// A CSS [`<dashed-ident>`](https://www.w3.org/TR/css-values-4/#dashed-idents) declaration.
    ///
    /// Dashed idents are used in cases where an identifier can be either author defined _or_ CSS-defined.
    /// Author defined idents must start with two dash characters ("--") or parsing will fail.
    DashedIdent
}

impl DashedIdent {
    pub(crate) fn parse(input: &mut Parser) -> CssResult<DashedIdent> {
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        if !strings::starts_with(ident, b"--") {
            return Err(location.new_unexpected_token_error(Token::Ident(ident)));
        }
        Ok(DashedIdent {
            v: std::ptr::from_ref::<[u8]>(ident),
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_dashed_ident(self)
    }
}

pub use Ident as IdentFns;

arena_slice_newtype! {
    /// A CSS [`<ident>`](https://www.w3.org/TR/css-values-4/#css-css-identifier).
    Ident
}

impl Ident {
    pub(crate) fn parse(input: &mut Parser) -> CssResult<Ident> {
        let ident = input.expect_ident()?;
        Ok(Ident {
            v: std::ptr::from_ref::<[u8]>(ident),
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.serialize_identifier(self.v())
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
#[derive(Clone, Copy, Default)]
pub struct IdentOrRef(u128);

// Packed u128 field layout, LSB-first:
//   __ptrbits: u63  -> bits  0..63
//   __ref_bit: bool -> bit   63
//   __len:     u64  -> bits 64..128
const PTRBITS_MASK: u128 = (1u128 << 63) - 1;
const REF_BIT: u128 = 1u128 << 63;

#[cfg(debug_assertions)]
pub(crate) type DebugIdent<'a> = (&'a [u8], &'a bun_alloc::Arena);
#[cfg(not(debug_assertions))]
pub(crate) type DebugIdent<'a> = core::marker::PhantomData<&'a ()>;

/// Construct a `DebugIdent` — call sites use this instead of an inline
/// `#[cfg(debug_assertions)]` arg attribute (which removes the parameter
/// entirely in release and breaks arity).
#[inline(always)]
pub(crate) fn debug_ident<'a>(_raw: &'a [u8], _arena: &'a bun_alloc::Arena) -> DebugIdent<'a> {
    #[cfg(debug_assertions)]
    {
        (_raw, _arena)
    }
    #[cfg(not(debug_assertions))]
    {
        core::marker::PhantomData
    }
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

    pub(crate) fn from_ident(ident: Ident) -> Self {
        let s = ident.v();
        let (ptr, len) = (s.as_ptr() as usize as u64, s.len() as u64);
        // narrowing usize→u63 is checked in debug
        debug_assert!(ptr & (1u64 << 63) == 0);
        Self::pack(ptr, false, len)
    }

    pub(crate) fn from_ref(r: Ref, debug_ident: DebugIdent<'_>) -> Self {
        let len: u64 = r.to_raw_bits();
        #[cfg(not(debug_assertions))]
        let this = Self::pack(0, true, len);

        #[cfg(debug_assertions)]
        let this = {
            let (slice, bump) = debug_ident;
            // bun.handleOom(arena.create(...)) → arena alloc; OOM aborts
            let heap_ptr: &mut *const [u8] = bump.alloc(std::ptr::from_ref::<[u8]>(slice));
            let addr = std::ptr::from_mut::<*const [u8]>(heap_ptr) as usize as u64;
            debug_assert!(addr & (1u64 << 63) == 0);
            Self::pack(addr, true, len)
        };
        #[cfg(not(debug_assertions))]
        {
            let _ = debug_ident;
        }

        this
    }

    #[inline]
    pub(crate) fn is_ident(self) -> bool {
        !self.ref_bit()
    }

    #[inline]
    pub(crate) fn is_ref(self) -> bool {
        self.ref_bit()
    }

    #[inline]
    pub(crate) fn as_ident(self) -> Option<Ident> {
        if !self.ref_bit() {
            let ptr = self.ptrbits() as usize as *const u8;
            let len = self.len_bits() as usize;
            // SAFETY: ptr/len were packed from a valid arena slice in from_ident
            let slice =
                std::ptr::from_ref::<[u8]>(unsafe { core::slice::from_raw_parts(ptr, len) });
            return Some(Ident { v: slice });
        }
        None
    }

    #[inline]
    pub(crate) fn as_ref(self) -> Option<Ref> {
        if self.ref_bit() {
            // len_bits stores the exact u64 bit pattern written by from_ref
            return Some(Ref::from_raw_bits(self.len_bits()));
        }
        None
    }

    pub fn as_str(
        self,
        map: &bun_ast::symbol::Map,
        local_names: Option<&css::LocalsResultsMap>,
    ) -> Option<&'static [u8]> {
        // Returns an arena/symbol-table borrow; `'static` is a placeholder for
        // the not-yet-threaded `'bump` lifetime.
        if self.is_ident() {
            // SAFETY: arena slice reconstructed from packed ptr/len
            return Some(unsafe { crate::arena_str(self.as_ident().unwrap().v) });
        }
        let r = self.as_ref().unwrap();
        let final_ref = map.follow(r);
        // SAFETY: LocalsResultsMap values are `Box<[u8]>` owned by the linker
        // for the symbol-map lifetime; `arena_str` erases to the placeholder
        // `'static` until the proper `'bump` lifetime is threaded.
        local_names
            .unwrap()
            .get(&final_ref)
            .map(|p| unsafe { crate::arena_str(&raw const **p) })
    }

    pub(crate) fn as_original_string(self, symbols: &[bun_ast::Symbol]) -> &[u8] {
        if self.is_ident() {
            // SAFETY: arena slice reconstructed from packed ptr/len
            return unsafe { crate::arena_str(self.as_ident().unwrap().v) };
        }
        let r = self.as_ref().unwrap();
        symbols[r.inner_index() as usize].original_name.slice()
    }

    pub(crate) fn hash(&self, hasher: &mut Wyhash) {
        if let Some(ident) = self.as_ident() {
            hasher.update(ident.v());
        } else {
            // SAFETY: self is #[repr(transparent)] u128 (16 bytes), so reading the first 2
            // bytes is in-bounds. Hashing only 2 of the 16 bytes (sic) is preserved for
            // behavioral compatibility; PR #30784 hashes the full identity.
            let bytes = unsafe {
                core::slice::from_raw_parts(std::ptr::from_ref::<Self>(self).cast::<u8>(), 2)
            };
            hasher.update(bytes);
        }
    }

    pub(crate) fn eql(&self, other: &Self) -> bool {
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

/// ASCII-case-insensitive check for the words reserved from the
/// [`<custom-ident>`](https://www.w3.org/TR/css-values-4/#custom-idents)
/// production: the CSS-wide keywords + `default`.
///
/// `default` is *not* a CSS-wide keyword (cf. [`CSSWideKeyword`]); it is
/// reserved separately by css-values-4. `none` is *not* in this set —
/// `<keyframes-name>` / `<single-animation-name>` callers check it themselves.
#[inline]
pub(crate) fn is_reserved_custom_ident(s: &[u8]) -> bool {
    strings::eql_any_case_insensitive_ascii(
        s,
        &[
            b"initial",
            b"inherit",
            b"unset",
            b"default",
            b"revert",
            b"revert-layer",
        ],
    )
}

arena_slice_newtype! {
    /// A CSS [`<custom-ident>`](https://www.w3.org/TR/css-values-4/#custom-idents).
    CustomIdent
}

impl CustomIdent {
    pub(crate) fn parse(input: &mut Parser) -> CssResult<CustomIdent> {
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        let valid = !is_reserved_custom_ident(ident);

        if !valid {
            return Err(location.new_unexpected_token_error(Token::Ident(ident)));
        }
        Ok(CustomIdent {
            v: std::ptr::from_ref::<[u8]>(ident),
        })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        Self::to_css_with_options(self, dest, true)
    }

    /// Write the custom ident to CSS.
    pub(crate) fn to_css_with_options(
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
        // (`arena_str` yields an unbounded borrow, which coerces to `'a`).
        let v = unsafe { crate::arena_str(self.v) };
        dest.write_ident(v, css_module_custom_idents_enabled)
    }
}

/// A list of CSS [`<custom-ident>`](https://www.w3.org/TR/css-values-4/#custom-idents) values.
pub type CustomIdentList = SmallList<CustomIdent, 1>;
