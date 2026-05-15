//! `js_parser/ast/Ast.zig` — the parser-output struct.
//!
//! Moved down from `bun_js_parser` so `bun_js_printer` can consume it without
//! a `bun_js_parser` dep. The previous blocker (`Target`/`ImportRecord` living
//! in `bun_options_types`) is gone now that those are canonical in `bun_ast`.

use bun_alloc::AstAlloc;
use bun_collections::array_hash_map::{AutoContext, StringContext};
use bun_collections::{ArrayHashMap, StringArrayHashMap, StringHashMap, VecExt};

use crate::import_record::ImportRecord;
use crate::runtime;
use crate::{
    CharFreq, ExportsKind, Expr, InlinedEnumValue, LocRef, NamedExport, NamedImport, Part, Range,
    Ref, Scope, SlotCounts, StoreStr, Target,
};

use crate::part::List as PartList;
use crate::symbol::List as SymbolList;
// `ImportRecord.List` is `Vec<ImportRecord>` (`bun_ast::import_record::List`).
type ImportRecordList = Vec<ImportRecord>;

pub type TopLevelSymbolToParts = ArrayHashMap<Ref, Vec<u32>>;

pub struct Ast {
    pub approximate_newline_count: usize,
    pub has_lazy_export: bool,
    pub runtime_imports: runtime::Imports,

    pub nested_scope_slot_counts: SlotCounts,

    pub runtime_import_record_id: Option<u32>,
    pub needs_runtime: bool,
    // This is a list of CommonJS features. When a file uses CommonJS features,
    // it's not a candidate for "flat bundling" and must be wrapped in its own
    // closure.
    pub has_top_level_return: bool,
    pub uses_exports_ref: bool,
    pub uses_module_ref: bool,
    pub uses_require_ref: bool,
    pub commonjs_module_exports_assigned_deoptimized: bool,

    pub force_cjs_to_esm: bool,
    pub exports_kind: ExportsKind,

    // This is a list of ES6 features. They are ranges instead of booleans so
    // that they can be used in log messages. Check to see if "Len > 0".
    pub import_keyword: Range, // Does not include TypeScript-specific syntax or "import()"
    pub export_keyword: Range, // Does not include TypeScript-specific syntax
    pub top_level_await_keyword: Range,

    /// These are stored at the AST level instead of on individual AST nodes so
    /// they can be manipulated efficiently without a full AST traversal
    pub import_records: ImportRecordList,

    // `hashbang`/`directive` are `[]const u8` slices into source text (not
    // freed in Zig `deinit`). `StoreStr` records them under the same
    // lifetime-erased contract as `StoreRef`.
    pub hashbang: StoreStr,
    pub directive: Option<StoreStr>,
    pub parts: PartList,
    // This list may be mutated later, so we should store the capacity
    pub symbols: SymbolList,
    pub module_scope: Scope,
    pub char_freq: Option<CharFreq>,
    pub exports_ref: Ref,
    pub module_ref: Ref,
    /// When using format .bake_internal_dev, this is the HMR variable instead
    /// of the wrapper. This is because that format does not store module
    /// wrappers in a variable.
    pub wrapper_ref: Ref,
    pub require_ref: Ref,

    // These are used when bundling. They are filled in during the parser pass
    // since we already have to traverse the AST then anyway and the parser pass
    // is conveniently fully parallelized.
    pub named_imports: NamedImports,
    pub named_exports: NamedExports,
    // TODO(port): `[]u32` not freed in Zig `deinit` — likely arena-owned. Using Box<[u32]> for now.
    pub export_star_import_records: Box<[u32]>,

    // arena: std.mem.Allocator,
    pub top_level_symbols_to_parts: TopLevelSymbolToParts,

    pub commonjs_named_exports: CommonJSNamedExports,

    pub redirect_import_record_index: Option<u32>,

    /// Only populated when bundling
    pub target: Target,
    // const_values: ConstValuesMap,
    pub ts_enums: TsEnumsMap,

    /// Not to be confused with `commonjs_named_exports`
    /// This is a list of named exports that may exist in a CommonJS module
    /// We use this with `commonjs_at_runtime` to re-export CommonJS
    pub has_commonjs_export_names: bool,
    pub has_import_meta: bool,
    pub import_meta_ref: Ref,
}

// PORT NOTE: Zig field defaults reference named constants (`Ref.None`, `logger.Range.None`,
// `ExportsKind.none`, `Target.browser`) whose equivalence to the Rust types' `Default::default()`
// is unverified across crates, so spell them out here instead of `#[derive(Default)]`.
impl Default for Ast {
    fn default() -> Self {
        Self {
            approximate_newline_count: 0,
            has_lazy_export: false,
            runtime_imports: Default::default(),
            nested_scope_slot_counts: SlotCounts::default(),
            runtime_import_record_id: None,
            needs_runtime: false,
            has_top_level_return: false,
            uses_exports_ref: false,
            uses_module_ref: false,
            uses_require_ref: false,
            commonjs_module_exports_assigned_deoptimized: false,
            force_cjs_to_esm: false,
            exports_kind: ExportsKind::None,
            import_keyword: Range::NONE,
            export_keyword: Range::NONE,
            top_level_await_keyword: Range::NONE,
            import_records: Default::default(),
            hashbang: StoreStr::EMPTY,
            directive: None,
            parts: Default::default(),
            symbols: Default::default(),
            module_scope: Scope::default(),
            char_freq: None,
            exports_ref: Ref::NONE,
            module_ref: Ref::NONE,
            wrapper_ref: Ref::NONE,
            require_ref: Ref::NONE,
            named_imports: Default::default(),
            named_exports: Default::default(),
            export_star_import_records: Box::default(),
            top_level_symbols_to_parts: Default::default(),
            commonjs_named_exports: Default::default(),
            redirect_import_record_index: None,
            target: Target::Browser,
            ts_enums: Default::default(),
            has_commonjs_export_names: false,
            has_import_meta: false,
            import_meta_ref: Ref::NONE,
        }
    }
}

pub struct CommonJSNamedExport {
    pub loc_ref: LocRef,
    pub needs_decl: bool,
}

impl Default for CommonJSNamedExport {
    fn default() -> Self {
        Self {
            loc_ref: LocRef::default(),
            needs_decl: true,
        }
    }
}

// `Ast` is held in arena-allocated structures whose `Drop` never runs (the
// `BabyList` pattern — bulk-freed on `ASTMemoryAllocator` / `store_ast_alloc_heap`
// reset). Any `Vec`/`Box` field that defaults to the global allocator therefore
// leaks. The `AstAlloc` parameter routes the column vecs and per-key boxes
// into the same thread-local AST `mi_heap` so they're reclaimed by
// `mi_heap_destroy` alongside the AST nodes (same motivation as
// `G::DeclList`/`PropertyList` and `Scope::members`).
pub type CommonJSNamedExports = StringArrayHashMap<CommonJSNamedExport, StringContext, AstAlloc>;

pub type NamedImports = ArrayHashMap<Ref, NamedImport, AutoContext, AstAlloc>;
pub type NamedExports = StringArrayHashMap<NamedExport, StringContext, AstAlloc>;
pub type ConstValuesMap = ArrayHashMap<Ref, Expr, AutoContext, AstAlloc>;
pub type TsEnumsMap = ArrayHashMap<Ref, StringHashMap<InlinedEnumValue>, AutoContext, AstAlloc>;

impl Ast {
    pub fn from_parts(parts: Box<[Part]>) -> Ast {
        Ast {
            parts: PartList::from_owned_slice(parts),
            runtime_imports: Default::default(),
            ..Default::default()
        }
    }

    // Zig `initTest` borrowed `parts` via `Part.List.fromBorrowedSliceDangerous`
    // and relied on explicit `deinit` never being called. `Vec::drop` now
    // unconditionally guards on `Origin::Borrowed` (not debug-only), so unwrapping
    // the `ManuallyDrop` is safe — the caller's slice is never freed by `Ast`'s Drop.
    pub fn init_test(parts: &[Part]) -> Ast {
        Ast {
            // SAFETY: test-only helper; the borrowed list is tagged
            // `Origin::Borrowed`, so `Vec::drop` skips the free, and no
            // grow/free path is reached on `Ast.parts` before the borrow ends.
            parts: std::mem::ManuallyDrop::into_inner(unsafe {
                PartList::from_borrowed_slice_dangerous(parts)
            }),
            runtime_imports: Default::default(),
            ..Default::default()
        }
    }

    // Zig: `pub const empty = Ast{ .parts = Part.List{}, .runtime_imports = .{} };`
    // All fields use their defaults, so `Ast::default()` is the Rust equivalent.
    // TODO(port): if a true `const` is required at use sites, revisit once field types are `const`-constructible.
    pub fn empty() -> Ast {
        Ast::default()
    }

    // Zig: `std.json.stringify(self.parts, opts, stream)` where
    // `opts = .{ .whitespace = .{ .separator = true } }`. In the Rust port the
    // `crate::JsonWriter` trait stands in for the configured
    // `std.json.WriteStream` (separator/whitespace are properties of the
    // writer impl, not passed per-call), so the body collapses to a single
    // `write` of the parts slice — the writer emits the JSON array,
    // dispatching to `Part::json_stringify` per element (same shape as
    // `Part::json_stringify` writing `self.stmts`). No live callers.
    pub fn to_json<W: crate::JsonWriter>(&self, stream: &mut W) -> Result<(), bun_core::Error> {
        // PORT NOTE: `whitespace.separator = true` is the caller's
        // responsibility when constructing the `JsonWriter` impl.
        stream.write(self.parts.slice())
    }

    // Zig `deinit` only freed `parts`, `symbols`, `import_records` via `bun.default_allocator`,
    // and was guarded by "Do not call this if it wasn't globally allocated!".
    // In Rust those fields own their storage and free on Drop; no explicit body needed.
    // TODO(port): Vec<T> Drop semantics must distinguish arena-backed vs heap-backed to
    // preserve the Zig conditional-free behavior. Revisit.
}

pub use crate::g::Class;

// ported from: src/js_parser/ast/Ast.zig
