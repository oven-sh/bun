//! `js_parser/ast/` — AST type definitions.
//!
//! B-2 round A: progressively un-gating real Phase-A drafts. Real modules are
//! declared via `#[path = "X.rs"] pub mod x;`; not-yet-un-gated ones keep an
//! inline stub body (migrated from the former inline stub in `lib.rs`).
#![allow(non_snake_case, dead_code, unused, clippy::all)]

// ── REAL (un-gated Phase-A drafts) ─────────────────────────────────────────
#[path = "base.rs"]
pub mod base;
#[path = "Op.rs"]
pub mod op;
#[path = "UseDirective.rs"]
pub mod use_directive;
#[path = "CharFreq.rs"]
pub mod char_freq;
#[path = "Symbol.rs"]
pub mod symbol;
#[path = "Scope.rs"]
pub mod scope;
#[path = "TS.rs"]
pub mod ts;
#[path = "G.rs"]
pub mod g;
#[path = "B.rs"]
pub mod b;
#[path = "Binding.rs"]
pub mod binding;

/// Minimal `TypeScript` namespace surface for the AST type-def files.
/// `ast/TypeScript.rs` (494L) holds `Metadata` plus parser-state predicates that
/// depend on `P`; only the data enum is hoisted here. Full file un-gates with the
/// parser round.
#[allow(non_snake_case)]
pub mod TypeScript {
    use super::base::Ref;

    #[derive(Clone, Default)]
    pub enum Metadata {
        #[default]
        MNone,
        MNever,
        MUnknown,
        MAny,
        MVoid,
        MNull,
        MUndefined,
        MFunction,
        MArray,
        MBoolean,
        MString,
        MObject,
        MNumber,
        MBigint,
        MSymbol,
        MPromise,
        MIdentifier(Ref),
        // TODO(port): arena-backed `bumpalo::collections::Vec<'bump, Ref>` in Phase B.
        MDot(Vec<Ref>),
    }
}

// ── STUB (inline opaque types until each file is un-gated below) ───────────
    pub mod ast_memory_allocator { #[derive(Default)] pub struct ASTMemoryAllocator; }
    pub mod ast { #[derive(Default)] pub struct Ast; }
    pub mod bundled_ast { #[derive(Default)] pub struct BundledAst; }
    pub mod expr {
        use bun_logger as logger;

        #[derive(Copy, Clone, Default)]
        pub struct Expr {
            pub loc: logger::Loc,
            // TODO(b1): real `data: Data` is a tagged-union pointer; the stub
            // `Data` below is opaque so this stays a marker until ast/Expr.rs
            // is un-gated.
        }
        #[derive(Copy, Clone)]
        pub struct Data; // opaque tag — real variant set lives in ast/Expr.rs

        /// Result of `Expr::as_property` — Zig: `struct { expr: Expr, loc: Loc, i: u32 = 0 }`.
        #[derive(Copy, Clone)]
        pub struct Query {
            pub expr: Expr,
            pub loc: logger::Loc,
            pub i: u32,
        }

        /// Backing arena store for `Expr.Data` payloads.
        ///
        /// Zig nests this as `Expr.Data.Store`; Rust cannot express that path
        /// on a struct without nightly `inherent_associated_types`, so the
        /// stub lives at `ast::expr::Store`. Callers that wrote
        /// `Expr::Data::Store::create()` should use `ast::expr::Store::create()`.
        pub struct Store;
        impl Store {
            #[inline]
            pub fn create() { todo!("b1-stub: Expr.Data.Store::create — gated NewStore") }
            #[inline]
            pub fn reset() { todo!("b1-stub: Expr.Data.Store::reset — gated NewStore") }
            #[inline]
            pub fn begin() { todo!("b1-stub: Expr.Data.Store::begin — gated NewStore") }
            #[inline]
            pub fn deinit() { todo!("b1-stub: Expr.Data.Store::deinit — gated NewStore") }
            #[inline]
            pub fn assert() {}
        }

        impl Expr {
            /// Allocate `st` into the thread-local `Data.Store` and return an
            /// `Expr` wrapping it.
            ///
            /// Zig: `pub fn init(comptime Type: type, st: Type, loc: Loc) Expr`.
            /// `T` is one of the `E::*` payload structs.
            #[inline]
            pub fn init<T>(_st: T, _loc: logger::Loc) -> Expr {
                todo!("b1-stub: Expr::init — Data.Store is gated (ast/Expr.rs)")
            }

            /// Look up `name` in this object expression's properties.
            ///
            /// Zig: `pub fn asProperty(expr: *const Expr, name: string) ?Query`.
            #[inline]
            pub fn as_property(&self, _name: &[u8]) -> Option<Query> {
                todo!("b1-stub: Expr::as_property — Data variants are gated (ast/Expr.rs)")
            }

            /// Build an `Expr` from a fetched Blob during macro expansion.
            ///
            /// Zig: `pub fn fromBlob(blob: *const jsc.WebCore.Blob, allocator,
            /// mime_type_: ?MimeType, log: *logger.Log, loc: Loc) !Expr`.
            /// `B`/`M` are generic stand-ins for the higher-tier `Blob` and
            /// `MimeType` types so this crate stays free of a *_jsc dep.
            #[inline]
            pub fn from_blob<B, M>(
                _blob: &B,
                _mime_type: Option<M>,
                _log: &mut logger::Log,
                _loc: logger::Loc,
            ) -> core::result::Result<Expr, bun_core::Error> {
                todo!("b1-stub: Expr::from_blob — JSC-dependent macro path (bun_js_parser_jsc)")
            }
        }
    }
    pub mod stmt {
        #[derive(Copy, Clone, Default)]
        pub struct Stmt;
        #[derive(Copy, Clone)]
        pub struct Data; // opaque tag — real variant set lives in ast/Stmt.rs
    }
    pub mod server_component_boundary {
        use bun_collections::MultiArrayList;

        #[derive(Default)] pub struct ServerComponentBoundary;

        /// Lookup-friendly container of all server-component boundaries.
        ///
        /// Zig: `ServerComponentBoundary.List = struct {
        ///   list: std.MultiArrayList(ServerComponentBoundary), map: Map }`
        /// where `Map = std.ArrayHashMapUnmanaged(void, void, …)`.
        #[derive(Default)]
        pub struct List {
            pub list: MultiArrayList<ServerComponentBoundary>,
            // TODO(b1): `map: ArrayHashMap<(), ()>` — bun_collections::ArrayHashMap
            // currently requires `K: Hash + Eq`; revisit once the void-key
            // adapter pattern is ported.
        }
    }
    pub mod new_store { #[derive(Default)] pub struct NewStore; }
    pub mod e {
        use bun_collections::BabyList;
        use bun_logger as logger;

        #[derive(Copy, Clone, Default)] pub struct String;
        impl String {
            pub fn init(_data: &[u8]) -> Self { todo!("b1-stub: E::String::init") }
            pub fn init_utf16(_data: &[u16]) -> Self { todo!("b1-stub: E::String::init_utf16") }
            pub fn to_utf8(&mut self, _bump: &bun_alloc::Arena) -> core::result::Result<(), bun_alloc::AllocError> {
                todo!("b1-stub: E::String::to_utf8")
            }
            /// Flatten a UTF-8 rope-string into a single contiguous slice.
            ///
            /// Zig: `pub fn resolveRopeIfNeeded(this: *String, allocator) void`.
            pub fn resolve_rope_if_needed(&mut self, _bump: &bun_alloc::Arena) {
                todo!("b1-stub: E::String::resolve_rope_if_needed — rope fields gated (ast/E.rs)")
            }
        }
        #[derive(Copy, Clone, Default)] pub struct Undefined;
        #[derive(Copy, Clone, Default)] pub struct Identifier;
        #[derive(Copy, Clone, Default)] pub struct Function;

        /// Zig: `E.Null = struct {}`.
        #[derive(Copy, Clone, Default)] pub struct Null;

        /// Zig: `E.Boolean = struct { value: bool }`.
        #[derive(Copy, Clone, Default)]
        pub struct Boolean {
            pub value: bool,
        }

        /// Zig: `E.Number = struct { value: f64 }`.
        #[derive(Copy, Clone, Default)]
        pub struct Number {
            pub value: f64,
        }

        /// Zig: `E.BigInt = struct { value: string }` (source-text slice).
        #[derive(Copy, Clone)]
        pub struct BigInt {
            pub value: super::super::ArenaStr,
        }
        impl Default for BigInt {
            fn default() -> Self { Self { value: super::super::empty_arena_str() } }
        }

        /// Zig: `E.Array = struct { items: ExprNodeList, comma_after_spread: ?Loc,
        /// is_single_line, is_parenthesized, was_originally_macro: bool,
        /// close_bracket_loc: Loc }`.
        #[derive(Default)]
        pub struct Array {
            pub items: BabyList<super::expr::Expr>,
            pub comma_after_spread: Option<logger::Loc>,
            pub is_single_line: bool,
            pub is_parenthesized: bool,
            pub was_originally_macro: bool,
            pub close_bracket_loc: logger::Loc,
        }

        /// Zig: `E.Object = struct { properties: G.Property.List, comma_after_spread: ?Loc,
        /// is_single_line, is_parenthesized, was_originally_macro: bool,
        /// close_brace_loc: Loc }`.
        #[derive(Default)]
        pub struct Object {
            pub properties: BabyList<super::g::Property>,
            pub comma_after_spread: Option<logger::Loc>,
            pub is_single_line: bool,
            pub is_parenthesized: bool,
            pub was_originally_macro: bool,
            pub close_brace_loc: logger::Loc,
        }
    }
    pub mod s {
        use bun_logger as logger;

        /// Zig: `S.Import = struct { namespace_ref: Ref, default_name: ?LocRef,
        /// items: []ClauseItem, star_name_loc: ?Loc, import_record_index: u32,
        /// is_single_line: bool }`.
        pub struct Import {
            pub namespace_ref: super::base::Ref,
            pub default_name: Option<crate::LocRef>,
            // TODO(port): &'bump mut [ClauseItem] once 'bump is threaded.
            pub items: *mut [crate::ClauseItem],
            pub star_name_loc: Option<logger::Loc>,
            pub import_record_index: u32,
            pub is_single_line: bool,
        }
        impl Default for Import {
            fn default() -> Self {
                Self {
                    namespace_ref: super::base::Ref::NONE,
                    default_name: None,
                    items: super::super::empty_arena_slice_mut(),
                    star_name_loc: None,
                    import_record_index: 0,
                    is_single_line: false,
                }
            }
        }
    }
