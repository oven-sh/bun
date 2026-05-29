use crate::symbol;

// ───────────────────────────────── Index ─────────────────────────────────

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

pub use crate::{Ref, RefInt, RefTag};

// Zig: `comptime { bun.assert(None.isEmpty()); }`
const _: () = assert!(Ref::NONE.is_empty());

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
}

// ported from: src/js_parser/ast/base.zig
