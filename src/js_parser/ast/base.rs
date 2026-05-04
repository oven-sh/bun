// TODO: figure out if we actually need this

use core::fmt;

use bun_js_parser::ast;
use bun_wyhash;

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
// Zig: `packed struct(u64) { inner_index: u31, tag: enum(u2), source_index: u31 }`.
// Zig packed structs are LSB-first, so:
//   bits  0..31  inner_index
//   bits 31..33  tag
//   bits 33..64  source_index
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Ref(u64);

/// Zig: `pub const Int = u31;` — Rust has no `u31`; use `u32` and mask at the
/// pack/unpack boundary.
pub type RefInt = u32;

const REF_INT_MASK: u64 = (1u64 << 31) - 1; // 0x7FFF_FFFF
const REF_TAG_SHIFT: u32 = 31;
const REF_TAG_MASK: u64 = 0b11;
const REF_SOURCE_INDEX_SHIFT: u32 = 33;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum RefTag {
    Invalid = 0,
    AllocatedName = 1,
    SourceContentsSlice = 2,
    Symbol = 3,
}

impl RefTag {
    #[inline]
    const fn from_raw(n: u8) -> RefTag {
        debug_assert!(n <= 3);
        // SAFETY: `n` is masked to 2 bits at every call site; all 4 values are
        // valid discriminants of this `#[repr(u8)]` enum.
        unsafe { core::mem::transmute::<u8, RefTag>(n) }
    }
}

impl Ref {
    /// Represents a null state without using an extra bit
    pub const NONE: Ref = Ref(0);

    // Zig: `pub const ArrayHashCtx = RefHashCtx; pub const HashCtx = RefCtx;`
    // Rust can't nest type aliases in inherent impls — callers use the
    // top-level `RefHashCtx` / `RefCtx` directly.

    #[inline]
    const fn pack(inner_index: RefInt, tag: RefTag, source_index: RefInt) -> Ref {
        debug_assert!((inner_index as u64) <= REF_INT_MASK);
        debug_assert!((source_index as u64) <= REF_INT_MASK);
        Ref((inner_index as u64 & REF_INT_MASK)
            | ((tag as u64) << REF_TAG_SHIFT)
            | ((source_index as u64 & REF_INT_MASK) << REF_SOURCE_INDEX_SHIFT))
    }

    #[inline]
    pub const fn is_empty(self) -> bool {
        self.as_u64() == 0
    }

    // Zig: `isSourceIndexNull(this: anytype)` — callers pass a bare integer,
    // not a `Ref`.
    #[inline]
    pub fn is_source_index_null(this: RefInt) -> bool {
        this as u64 == REF_INT_MASK // std.math.maxInt(u31)
    }

    #[inline]
    pub fn is_symbol(self) -> bool {
        self.tag() == RefTag::Symbol
    }

    #[inline]
    pub fn tag(self) -> RefTag {
        RefTag::from_raw(((self.0 >> REF_TAG_SHIFT) & REF_TAG_MASK) as u8)
    }

    #[inline]
    pub fn is_valid(self) -> bool {
        self.tag() != RefTag::Invalid
    }

    #[inline]
    pub const fn source_index(self) -> RefInt {
        (self.0 >> REF_SOURCE_INDEX_SHIFT) as RefInt
    }

    #[inline]
    pub const fn inner_index(self) -> RefInt {
        (self.0 & REF_INT_MASK) as RefInt
    }

    #[inline]
    pub fn is_source_contents_slice(self) -> bool {
        self.tag() == RefTag::SourceContentsSlice
    }

    pub fn init(inner_index: RefInt, source_index: u32, is_source_contents_slice: bool) -> Ref {
        // Zig: `source_index = @intCast(source_index)` (u32 → u31)
        debug_assert!((source_index as u64) <= REF_INT_MASK);
        Self::pack(
            inner_index,
            if is_source_contents_slice {
                RefTag::SourceContentsSlice
            } else {
                RefTag::AllocatedName
            },
            source_index,
        )
    }

    pub fn init_source_end(old: Ref) -> Ref {
        debug_assert!(old.tag() != RefTag::Invalid);
        Self::init(
            old.inner_index(),
            old.source_index(),
            old.tag() == RefTag::SourceContentsSlice,
        )
    }

    #[inline]
    pub fn hash(self) -> u32 {
        self.hash64() as u32 // @truncate
    }

    #[inline]
    pub const fn as_u64(self) -> u64 {
        // Zig: `@bitCast(key)` — `#[repr(transparent)]` over u64, so the inner
        // value IS the bitcast.
        self.0
    }

    #[inline]
    pub fn hash64(self) -> u64 {
        bun_wyhash::hash(&self.as_u64().to_ne_bytes())
    }

    #[inline]
    pub fn eql(self, other: Ref) -> bool {
        self.as_u64() == other.as_u64()
    }

    #[deprecated = "use is_empty"]
    #[inline]
    pub const fn is_null(self) -> bool {
        self.is_empty()
    }

    // Zig: `jsonStringify(self, writer: anytype) !void` — std.json protocol,
    // writes `[source_index, inner_index]`.
    // TODO(port): wire to whatever JSON writer Phase B picks (serde or
    // bun_interchange). Kept as a free-standing method for now.
    pub fn json_stringify<W: JsonWriter>(&self, writer: &mut W) -> Result<(), W::Error> {
        writer.write(&[self.source_index(), self.inner_index()])
    }

    pub fn get_symbol<T: SymbolTable + ?Sized>(self, symbol_table: &mut T) -> &mut ast::Symbol {
        symbol_table.get_symbol(self)
    }

    pub fn dump<'a, T: SymbolTable + ?Sized>(self, symbol_table: &'a mut T) -> RefDump<'a> {
        RefDump {
            ref_: self,
            symbol: symbol_table.get_symbol(self),
        }
    }
}

// Zig: `comptime { bun.assert(None.isEmpty()); }`
const _: () = assert!(Ref::NONE.is_empty());

// Zig: `pub fn format(ref, writer) !void` — std.fmt protocol → `Display`.
impl fmt::Display for Ref {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Ref[inner={}, src={}, .{}]",
            self.inner_index(),
            self.source_index(),
            <&'static str>::from(self.tag()),
        )
    }
}

impl fmt::Debug for Ref {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

// Zig: `DumpImplData` + `dumpImpl` — formatter wrapper returned by `Ref.dump`.
pub struct RefDump<'a> {
    ref_: Ref,
    symbol: &'a ast::Symbol,
}

impl fmt::Display for RefDump<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Ref[inner={}, src={}, .{}; original_name={}, uses={}]",
            self.ref_.inner_index(),
            self.ref_.source_index(),
            <&'static str>::from(self.ref_.tag()),
            bstr::BStr::new(&self.symbol.original_name),
            self.symbol.use_count_estimate,
        )
    }
}

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
    fn get_symbol(&mut self, r: Ref) -> &mut ast::Symbol;
}

impl SymbolTable for [ast::Symbol] {
    #[inline]
    fn get_symbol(&mut self, r: Ref) -> &mut ast::Symbol {
        &mut self[r.inner_index() as usize]
    }
}

impl SymbolTable for Vec<ast::Symbol> {
    #[inline]
    fn get_symbol(&mut self, r: Ref) -> &mut ast::Symbol {
        &mut self[r.inner_index() as usize]
    }
}

// TODO(port): `impl SymbolTable for ast::Symbol::Map` lives next to `Symbol::Map`
// (it calls `.get(ref).unwrap()`); add it when that type is ported.

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
//   notes:      Ref/Index packed-struct bit layout hand-coded (LSB-first); getSymbol anytype → SymbolTable trait; json_stringify writer protocol stubbed.
// ──────────────────────────────────────────────────────────────────────────
