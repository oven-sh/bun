use core::fmt;

use crate::symbol;

// ───────────────────────────────── Index ─────────────────────────────────

/// In some parts of Bun, we have many different IDs pointing to different things.
/// It's easy for them to get mixed up, so we use this type to make sure we don't.
//
// Zig: `packed struct(u32) { value: Int }` — single field fills the whole word,
// so `#[repr(transparent)]` over `u32` is bit-identical. Tuple-struct shape so
// the (many) bundler call sites that wrote `Index(n)` / `.0` keep compiling;
// `.value()` is provided for sites that read the Zig field name.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Index(pub IndexInt);

/// Zig: `pub const Int = u32;` (nested in `Index`)
pub type IndexInt = u32;

/// Zig `anytype` → `@truncate` adaptor for [`Index::source`]/[`Index::part`].
/// Callers pass both `u32` and `usize`; this truncates wider inputs the way
/// Zig's `@as(Int, @truncate(num))` does.
pub trait IntoIndexInt {
    fn into_index_int(self) -> IndexInt;
}
impl IntoIndexInt for u32 {
    #[inline]
    fn into_index_int(self) -> IndexInt {
        self
    }
}
impl IntoIndexInt for usize {
    #[inline]
    fn into_index_int(self) -> IndexInt {
        self as IndexInt
    }
}
impl IntoIndexInt for i32 {
    #[inline]
    fn into_index_int(self) -> IndexInt {
        self as IndexInt
    }
}

impl Index {
    #[inline]
    pub fn set(&mut self, val: IndexInt) {
        self.0 = val;
    }

    /// Zig field-name accessor (`idx.value`).
    #[inline]
    pub const fn value(self) -> IndexInt {
        self.0
    }

    /// if you are within the parser, use p.isSourceRuntime() instead, as the
    /// runtime index (0) is used as the id for single-file transforms.
    #[inline]
    pub const fn is_runtime(self) -> bool {
        self.0 == Self::RUNTIME.0
    }

    pub const INVALID: Index = Index(IndexInt::MAX);
    pub const RUNTIME: Index = Index(0);

    pub const BAKE_SERVER_DATA: Index = Index(1);
    pub const BAKE_CLIENT_DATA: Index = Index(2);

    // Zig: `source(num: anytype) Index { .value = @truncate(num) }`
    // `@truncate` → `as` (intentional wrap). `anytype` callers pass both `u32`
    // and `usize`; `IntoIndexInt` covers both with truncating semantics.
    #[inline]
    pub fn source(num: impl IntoIndexInt) -> Index {
        Index(num.into_index_int())
    }

    #[inline]
    pub fn part(num: impl IntoIndexInt) -> Index {
        Index(num.into_index_int())
    }

    // Zig: `init(num: anytype)` — `@intCast` (checked narrow). The `@typeInfo ==
    // .pointer` auto-deref branch is Zig-only reflection; Rust callers pass by
    // value.
    #[inline]
    pub fn init<N>(num: N) -> Index
    where
        N: TryInto<IndexInt>,
        N::Error: core::fmt::Debug,
    {
        Index(num.try_into().expect("Index::init: out of range"))
    }

    #[inline]
    pub const fn is_valid(self) -> bool {
        self.0 != Self::INVALID.0
    }

    #[inline]
    pub const fn is_invalid(self) -> bool {
        !self.is_valid()
    }

    #[inline]
    pub const fn get(self) -> IndexInt {
        self.0
    }
}

impl Default for Index {
    #[inline]
    fn default() -> Self {
        Self::INVALID
    }
}

// (Former bridge `From` impls to `bun_ast::Index`

// ───────────────────────────────── Ref ─────────────────────────────────

/// -- original comment from esbuild --
///
/// Files are parsed in parallel for speed. We want to allow each parser to
/// generate symbol IDs that won't conflict with each other. We also want to be
/// able to quickly merge symbol tables from all files into one giant symbol
/// table.
///
/// We can accomplish both goals by giving each symbol ID two parts: a source
/// index that is unique to the parser goroutine, and an inner index that
/// increments as the parser generates new symbol IDs. Then a symbol map can
/// be an array of arrays indexed first by source index, then by inner index.
/// The maps can be merged quickly by creating a single outer array containing
/// all inner arrays from all parsed files.
pub use crate::{Ref, RefInt, RefTag};

// Zig: `comptime { bun.assert(None.isEmpty()); }`
const _: () = assert!(Ref::NONE.is_empty());

// ─────────────── getSymbol `anytype` dispatch → trait ───────────────
//
// Zig switches on `@TypeOf(symbol_table)`:
//   *const ArrayList(Symbol) | *ArrayList(Symbol) | []Symbol → index by
//     `ref.innerIndex()` (parser: single flat array, source_index ignored)
//   *Symbol.Map → `map.get(ref)` (bundler: 2D, both halves used)
//
// Different parts of the bundler use different formats of the symbol table.
// In the parser you only have one array, and .sourceIndex() is ignored.
// In the bundler, you have a 2D array where both parts of the ref are used.
pub trait SymbolTable {
    fn get_symbol(&mut self, r: Ref) -> &mut symbol::Symbol;
}

impl SymbolTable for [symbol::Symbol] {
    #[inline]
    fn get_symbol(&mut self, r: Ref) -> &mut symbol::Symbol {
        &mut self[r.inner_index() as usize]
    }
}

impl SymbolTable for Vec<symbol::Symbol> {
    #[inline]
    fn get_symbol(&mut self, r: Ref) -> &mut symbol::Symbol {
        &mut self[r.inner_index() as usize]
    }
}

// `impl SymbolTable for symbol::Map` (the bundler's 2-D table arm) lives next
// to `Map` in `symbol.rs` — it does the `source_index + inner_index` lookup.

/// `Ref` methods that need `Symbol` / JSON writer.
impl Ref {
    #[inline]
    pub fn get_symbol<T: SymbolTable + ?Sized>(self, symbol_table: &mut T) -> &mut symbol::Symbol {
        symbol_table.get_symbol(self)
    }
    pub fn dump<T: SymbolTable + ?Sized>(self, symbol_table: &mut T) -> RefDump<'_> {
        RefDump {
            ref_: self,
            symbol: symbol_table.get_symbol(self),
        }
    }
    pub fn json_stringify<W: crate::JsonWriter>(
        self,
        writer: &mut W,
    ) -> Result<(), bun_core::Error> {
        writer.write(&[self.source_index(), self.inner_index()])
    }
}

// Zig: `DumpImplData` + `dumpImpl` — formatter wrapper returned by `Ref.dump`.
pub struct RefDump<'a> {
    ref_: Ref,
    symbol: &'a symbol::Symbol,
}
impl fmt::Display for RefDump<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // SAFETY: original_name is an arena-owned slice valid for the lifetime of
        // the symbol table this RefDump was borrowed from (parser/AST arena outlives it).
        let name = self.symbol.original_name.slice();
        write!(
            f,
            "Ref[inner={}, src={}, .{}; original_name={}, uses={}]",
            self.ref_.inner_index(),
            self.ref_.source_index(),
            <&'static str>::from(self.ref_.tag()),
            bstr::BStr::new(name),
            self.symbol.use_count_estimate,
        )
    }
}

// ported from: src/js_parser/ast/base.zig
