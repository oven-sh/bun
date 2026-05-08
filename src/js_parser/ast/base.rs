use core::fmt;

use crate::ast;

// ───────────────────────────── RefHashCtx / RefCtx ─────────────────────────────
//
// Zig hash-context adaptors for `std.ArrayHashMap` / `std.HashMap`. In Rust the
// `bun_collections::{ArrayHashMap, HashMap}` wrappers take a context value with
// the same shape; kept as ZSTs so Phase B can wire them through unchanged.

#[derive(Default, Clone, Copy)]
pub struct RefHashCtx;

impl RefHashCtx {
    #[inline]
    pub fn hash(&self, key: Ref) -> u32 {
        key.hash()
    }

    #[inline]
    pub fn eql(&self, a: Ref, b: Ref, _b_index: usize) -> bool {
        a.as_u64() == b.as_u64()
    }
}

#[derive(Default, Clone, Copy)]
pub struct RefCtx;

impl RefCtx {
    #[inline]
    pub fn hash(&self, key: Ref) -> u64 {
        key.hash64()
    }

    #[inline]
    pub fn eql(&self, a: Ref, b: Ref) -> bool {
        a.as_u64() == b.as_u64()
    }
}

// ───────────────────────────────── Index ─────────────────────────────────

/// In some parts of Bun, we have many different IDs pointing to different things.
/// It's easy for them to get mixed up, so we use this type to make sure we don't.
//
// Zig: `packed struct(u32) { value: Int }` — single field fills the whole word,
// so `#[repr(transparent)]` over `u32` is bit-identical.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Index {
    pub value: IndexInt,
}

/// Zig: `pub const Int = u32;` (nested in `Index`)
pub type IndexInt = u32;

impl Index {
    #[inline]
    pub fn set(&mut self, val: IndexInt) {
        self.value = val;
    }

    /// if you are within the parser, use p.isSourceRuntime() instead, as the
    /// runtime index (0) is used as the id for single-file transforms.
    #[inline]
    pub const fn is_runtime(self) -> bool {
        self.value == Self::RUNTIME.value
    }

    pub const INVALID: Index = Index { value: IndexInt::MAX };
    pub const RUNTIME: Index = Index { value: 0 };

    pub const BAKE_SERVER_DATA: Index = Index { value: 1 };
    pub const BAKE_CLIENT_DATA: Index = Index { value: 2 };

    // Zig: `source(num: anytype) Index { .value = @truncate(num) }`
    // `@truncate` → `as` (intentional wrap). `anytype` covered by accepting the
    // widest unsigned the callers use; Phase B can widen the bound if needed.
    // TODO(port): callers pass usize/u32/u64 — confirm `usize` covers all sites.
    #[inline]
    pub const fn source(num: usize) -> Index {
        Index { value: num as IndexInt }
    }

    #[inline]
    pub const fn part(num: usize) -> Index {
        Index { value: num as IndexInt }
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
        Index {
            value: num.try_into().expect("Index::init: out of range"),
        }
    }

    #[inline]
    pub const fn is_valid(self) -> bool {
        self.value != Self::INVALID.value
    }

    #[inline]
    pub const fn is_invalid(self) -> bool {
        !self.is_valid()
    }

    #[inline]
    pub const fn get(self) -> IndexInt {
        self.value
    }
}

impl Default for Index {
    #[inline]
    fn default() -> Self {
        Self::INVALID
    }
}

// Bridge to the move-in copy in `bun_options_types::BundleEnums::Index` —
// both are `#[repr(transparent)]` u32 newtypes for the same Zig `bun.ast.Index`.
// Lets bundler call sites that still spell `js_ast::Index` flow into APIs
// typed at `crate::Index` until the two unify (Phase B-3).
impl From<Index> for bun_options_types::BundleEnums::Index {
    #[inline]
    fn from(i: Index) -> Self {
        Self { value: i.value }
    }
}
impl From<bun_options_types::BundleEnums::Index> for Index {
    #[inline]
    fn from(i: bun_options_types::BundleEnums::Index) -> Self {
        Self { value: i.value }
    }
}

/// Compat shim for callers that wrote `<Index as IndexExt>::Int` (Zig's
/// `Index.Int` nested-decl pattern). Prefer the module-level `IndexInt`.
pub trait IndexExt {
    type Int;
}
impl IndexExt for Index {
    type Int = IndexInt;
}

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
//
// Canonical definition lives in `bun_logger` (lower tier so `bun_css` can name
// it without depending on the parser). Re-export it here so the parser/bundler
// see the same nominal type — no transmute bridges.
pub use bun_logger::{Ref, RefInt, RefTag};

/// Field-init form for callers (e.g. `bun_css`) that constructed the Zig packed
/// struct via `.{ .inner_index, .source_index, .tag }`. The packed `Ref(u64)`
/// layout has no public fields, so this struct + `From` impl reconciles the API.
#[derive(Clone, Copy)]
pub struct RefFields {
    pub inner_index: RefInt,
    pub source_index: RefInt,
    pub tag: RefTag,
}

impl From<RefFields> for Ref {
    #[inline]
    fn from(f: RefFields) -> Ref {
        Ref::new(f.inner_index, f.source_index, f.tag)
    }
}

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
    fn get_symbol(&mut self, r: Ref) -> &mut ast::symbol::Symbol;
}

impl SymbolTable for [ast::symbol::Symbol] {
    #[inline]
    fn get_symbol(&mut self, r: Ref) -> &mut ast::symbol::Symbol {
        &mut self[r.inner_index() as usize]
    }
}

impl SymbolTable for Vec<ast::symbol::Symbol> {
    #[inline]
    fn get_symbol(&mut self, r: Ref) -> &mut ast::symbol::Symbol {
        &mut self[r.inner_index() as usize]
    }
}

// TODO(port): `impl SymbolTable for ast::Symbol::Map` lives next to `Symbol::Map`
// (it calls `.get(ref).unwrap()`); add it when that type is ported.

/// `Ref` methods that need parser-crate types (`Symbol`, JSON writer). The
/// canonical `Ref` lives in `bun_logger`, so these can't be inherent.
pub trait RefExt: Copy {
    fn get_symbol<T: SymbolTable + ?Sized>(self, symbol_table: &mut T) -> &mut ast::symbol::Symbol;
    fn dump<T: SymbolTable + ?Sized>(self, symbol_table: &mut T) -> RefDump<'_>;
    // Zig: `jsonStringify(self, writer: anytype) !void` — std.json protocol,
    // writes `[source_index, inner_index]`.
    // TODO(port): wire to whatever JSON writer Phase B picks (serde or
    // bun_interchange). Kept as a free-standing method for now.
    fn json_stringify<W: JsonWriter>(self, writer: &mut W) -> Result<(), W::Error>;
}

impl RefExt for Ref {
    #[inline]
    fn get_symbol<T: SymbolTable + ?Sized>(self, symbol_table: &mut T) -> &mut ast::symbol::Symbol {
        symbol_table.get_symbol(self)
    }
    fn dump<T: SymbolTable + ?Sized>(self, symbol_table: &mut T) -> RefDump<'_> {
        RefDump { ref_: self, symbol: symbol_table.get_symbol(self) }
    }
    fn json_stringify<W: JsonWriter>(self, writer: &mut W) -> Result<(), W::Error> {
        writer.write(&[self.source_index(), self.inner_index()])
    }
}

// Zig: `DumpImplData` + `dumpImpl` — formatter wrapper returned by `Ref.dump`.
pub struct RefDump<'a> {
    ref_: Ref,
    symbol: &'a ast::symbol::Symbol,
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

// TODO(port): placeholder for `writer.write([2]u32{...})` in json_stringify.
pub trait JsonWriter {
    type Error;
    fn write(&mut self, v: &[u32; 2]) -> Result<(), Self::Error>;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/base.zig (235 lines)
//   confidence: medium
//   todos:      3
//   notes:      Ref re-exported from bun_logger (unified type); getSymbol anytype → SymbolTable trait + RefExt; json_stringify writer protocol stubbed.
// ──────────────────────────────────────────────────────────────────────────
