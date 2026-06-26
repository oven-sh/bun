//! The parser-output struct.
//!
//! Moved down from `bun_js_parser` so `bun_js_printer` can consume it without
//! a `bun_js_parser` dep. The previous blocker (`Target`/`ImportRecord` living
//! in `bun_options_types`) is gone now that those are canonical in `bun_ast`.

use bun_alloc::{AstAlloc, AstVec};
use bun_collections::array_hash_map::{AutoContext, StringContext};
use bun_collections::{ArrayHashMap, StringArrayHashMap, StringHashMap};

use crate::runtime;
use crate::{
    CharFreq, ExportsKind, Expr, InlinedEnumValue, LocRef, NamedExport, NamedImport, Part, Range,
    Ref, Scope, SlotCounts, StoreStr, Target,
};

use crate::part::List as PartList;
use crate::symbol::List as SymbolList;
type ImportRecordList<'a> = crate::import_record::List<'a>;

pub type TopLevelSymbolToParts = ArrayHashMap<Ref, AstVec<u32>, AutoContext, AstAlloc>;

pub struct Ast<'a> {
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
    pub import_records: ImportRecordList<'a>,

    // `hashbang`/`directive` are slices into source text. `StoreStr` records
    // them under the same lifetime-erased contract as `StoreRef`.
    pub hashbang: StoreStr,
    pub directive: Option<StoreStr>,
    pub parts: PartList<'a>,
    // This list may be mutated later, so we should store the capacity
    pub symbols: SymbolList<'a>,
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
    pub export_star_import_records: AstVec<u32>,

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

// `parts`/`symbols`/`import_records` are now `ArenaVec`s and need an allocator,
// so `Default` no longer applies; use `Ast::empty_in(arena)`.
impl<'a> Ast<'a> {
    pub fn empty_in(arena: &'a bun_alloc::MimallocArena) -> Self {
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
            import_records: ImportRecordList::new_in(arena),
            hashbang: StoreStr::EMPTY,
            directive: None,
            parts: PartList::new_in(arena),
            symbols: SymbolList::new_in(arena),
            module_scope: Scope::default(),
            char_freq: None,
            exports_ref: Ref::NONE,
            module_ref: Ref::NONE,
            wrapper_ref: Ref::NONE,
            require_ref: Ref::NONE,
            named_imports: Default::default(),
            named_exports: Default::default(),
            export_star_import_records: AstAlloc::vec(),
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
pub type TsEnumsMap =
    ArrayHashMap<Ref, StringHashMap<InlinedEnumValue, AstAlloc>, AutoContext, AstAlloc>;

impl<'a> Ast<'a> {
    pub fn from_parts(parts: Box<[Part]>, arena: &'a bun_alloc::MimallocArena) -> Ast<'a> {
        let mut p = PartList::with_capacity_in(parts.len(), arena);
        p.extend(parts.into_vec());
        Ast {
            parts: p,
            ..Ast::empty_in(arena)
        }
    }

    // `parts`/`symbols`/`import_records` are `ArenaVec`s (`BabyVec`) whose
    // `Drop` deallocates through the allocator each instance was constructed
    // with, so arena-vs-heap conditional-free is encoded in the type — no
    // explicit body needed.
}

pub use crate::g::Class;
