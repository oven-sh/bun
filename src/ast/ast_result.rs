//! The parser-output struct.
//!
//! Moved down from `bun_js_parser` so `bun_js_printer` can consume it without
//! a `bun_js_parser` dep. The previous blocker (`Target`/`ImportRecord` living
//! in `bun_options_types`) is gone now that those are canonical in `bun_ast`.

use crate::runtime;
use crate::{
    CharFreq, ExportsKind, Expr, InlinedEnumValue, LocRef, NamedExport, NamedImport, Part, Range,
    Ref, Scope, SlotCounts, StoreStr, Target,
};

use crate::part::List as PartList;
use crate::symbol::{self, List as SymbolList};
use crate::{AstArrayHashMap, AstBox, AstStringArrayHashMap, AstStringHashMap, AstVec, StoreRef};
type ImportRecordList<'a> = crate::import_record::List<'a>;

pub type TopLevelSymbolToParts<'a> = AstArrayHashMap<'a, Ref, AstVec<'a, u32>>;

pub struct Ast<'a> {
    pub approximate_newline_count: usize,
    pub has_lazy_export: bool,
    pub runtime_imports: runtime::Imports,

    pub nested_scope_slot_counts: SlotCounts,

    // This is a list of CommonJS features. When a file uses CommonJS features,
    // it's not a candidate for "flat bundling" and must be wrapped in its own
    // closure.
    pub uses_exports_ref: bool,
    pub uses_module_ref: bool,
    pub uses_require_ref: bool,
    pub commonjs_module_exports_assigned_deoptimized: bool,

    pub force_cjs_to_esm: bool,
    /// `force_cjs_to_esm` for a file with no ES module syntax: its exports were
    /// lifted from `exports.foo = ...`, so its `module.exports` is the namespace.
    pub commonjs_lifted_to_esm: bool,
    pub exports_kind: ExportsKind,

    // This is a list of ES6 features. They are ranges instead of booleans so
    // that they can be used in log messages. Check to see if "Len > 0".
    pub export_keyword: Range, // Does not include TypeScript-specific syntax
    pub top_level_await_keyword: Range,

    /// These are stored at the AST level instead of on individual AST nodes so
    /// they can be manipulated efficiently without a full AST traversal
    pub import_records: ImportRecordList<'a>,

    // `hashbang`/`directive` are slices into source text.
    pub hashbang: StoreStr<'a>,
    pub directive: Option<StoreStr<'a>>,
    /// `export default X` where `X` is an import binding in this file. When
    /// `X` resolves to a module namespace the linker binds importers of
    /// `default` through `X` (a namespace never changes identity, so the
    /// default's snapshot of it is the live value).
    pub export_default_alias_of_import: Ref,
    pub parts: PartList<'a>,
    // This list may be mutated later, so we should store the capacity
    pub symbols: SymbolList<'a>,
    pub module_scope: Scope<'a>,
    pub char_freq: Option<AstBox<'a, CharFreq>>,
    pub scope_uses: ScopeUseList<'a>,
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
    pub named_imports: NamedImports<'a>,
    pub named_exports: NamedExports<'a>,
    pub export_star_import_records: AstVec<'a, u32>,
    /// `import_record_index → aliases`. An entry means every use of that
    /// `import()` call's result was a tracked property access / destructuring
    /// of exactly these names; absence means the namespace escaped (keep all
    /// exports).
    pub dynamic_import_aliases: DynamicImportAliases<'a>,

    pub top_level_symbols_to_parts: TopLevelSymbolToParts<'a>,

    pub commonjs_named_exports: CommonJSNamedExports<'a>,

    pub redirect_import_record_index: Option<u32>,

    /// Only populated when bundling
    pub target: Target,
    // const_values: ConstValuesMap,
    pub ts_enums: TsEnumsMap<'a>,

    /// Not to be confused with `commonjs_named_exports`
    /// This is a list of named exports that may exist in a CommonJS module
    /// We use this with `commonjs_at_runtime` to re-export CommonJS
    pub has_commonjs_export_names: bool,
    pub import_meta_ref: Ref,
    /// Output depends on more than the source text (macros, `import.meta.glob`), so don't cache it.
    pub depends_on_more_than_source: bool,
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
            uses_exports_ref: false,
            uses_module_ref: false,
            uses_require_ref: false,
            commonjs_module_exports_assigned_deoptimized: false,
            force_cjs_to_esm: false,
            commonjs_lifted_to_esm: false,
            exports_kind: ExportsKind::None,
            export_keyword: Range::NONE,
            top_level_await_keyword: Range::NONE,
            import_records: ImportRecordList::new_in(arena),
            hashbang: StoreStr::EMPTY,
            directive: None,
            export_default_alias_of_import: Ref::NONE,
            parts: PartList::new_in(arena),
            symbols: SymbolList::new_in(arena),
            module_scope: Scope::default(),
            char_freq: None,
            scope_uses: ScopeUseList::default(),
            exports_ref: Ref::NONE,
            module_ref: Ref::NONE,
            wrapper_ref: Ref::NONE,
            require_ref: Ref::NONE,
            named_imports: Default::default(),
            named_exports: Default::default(),
            export_star_import_records: AstVec::new(),
            dynamic_import_aliases: Default::default(),
            top_level_symbols_to_parts: Default::default(),
            commonjs_named_exports: Default::default(),
            redirect_import_record_index: None,
            target: Target::Browser,
            ts_enums: Default::default(),
            has_commonjs_export_names: false,
            import_meta_ref: Ref::NONE,
            depends_on_more_than_source: false,
        }
    }

    pub fn take_symbols(&mut self) -> symbol::Map<'a> {
        let empty = SymbolList::new_in(self.symbols.allocator());
        symbol::Map::init_with_one_list(core::mem::replace(&mut self.symbols, empty))
    }
}

pub struct CommonJSNamedExport {
    pub loc_ref: LocRef,
    pub needs_decl: bool,
    /// How many times the file assigns `exports.name`.
    pub assign_count: u32,
    /// The value of the top-level statement that declares the export.
    pub decl_value: CommonJSExportValue,
}

/// The kind of value in `exports.name = value`, for a call of the export.
#[derive(Clone, Copy, Default)]
pub enum CommonJSExportValue {
    #[default]
    Other,
    /// A function or an arrow function with no `this` inside.
    FunctionIgnoringThis,
    /// An identifier, as in `exports.name = name`.
    Identifier(Ref),
}

pub type CommonJSNamedExports<'a> = AstStringArrayHashMap<'a, CommonJSNamedExport>;

pub type NamedImports<'a> = AstArrayHashMap<'a, Ref, NamedImport<'a>>;
/// This file's symbol `symbol` (inner index) is referenced directly in the
/// scope whose `Scope::visit_span` starts at `scope`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct ScopeUse {
    pub scope: u32,
    pub symbol: u32,
}

/// The symbol may be referenced from any scope in `first..=last`.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ScopeUseSpan {
    pub symbol: u32,
    pub first: u32,
    pub last: u32,
}

impl ScopeUseSpan {
    pub const fn whole_file(symbol: u32) -> ScopeUseSpan {
        ScopeUseSpan {
            symbol,
            first: 0,
            last: u32::MAX,
        }
    }
}

/// Where the file references each symbol, for the bundler's number renamer:
/// a nested binding may keep a name an enclosing binding also has when the
/// enclosing one is never referenced beneath it. Filled only when bundling
/// without identifier minification. References to unbound globals are left
/// out (every scope avoids their names anyway).
#[derive(Default)]
pub struct ScopeUseList<'a> {
    /// `false`: nothing was recorded; every symbol must count as referenced
    /// everywhere.
    pub tracked: bool,
    /// In visit order, adjacent repeats dropped.
    pub points: AstVec<'a, ScopeUse>,
    /// Sorted, no repeats. Class field initializers (may be printed inside
    /// the constructor: the span is the class body), the parser's generated
    /// temporaries and helpers (may be printed deeper than recorded) and
    /// `module`/`exports` (printed for one another): the span is the file.
    pub spans: AstVec<'a, ScopeUseSpan>,
}

/// One `import()` / `require()` whose every use the parser accounted for.
#[derive(Clone, Copy, Default)]
pub struct DynamicImportUse<'a> {
    /// The export names read off the result, sorted and deduplicated.
    pub aliases: crate::StoreSlice<'a, crate::StoreStr<'a>>,
    /// The import items those names are read through: a local a pattern
    /// binds (`const { z } = …`) or a read off a namespace local (`ns.z`).
    pub items: crate::StoreSlice<'a, DynamicImportItem<'a>>,
    /// Some use needs the namespace object whatever the linker binds: a read
    /// that is not an item, or a local that may hold several namespaces.
    pub needs_namespace_object: bool,
}

#[derive(Clone, Copy)]
pub struct DynamicImportItem<'a> {
    pub local: Ref,
    pub alias: crate::StoreStr<'a>,
    pub namespace_ref: Ref,
}
pub type DynamicImportAliases<'a> = AstArrayHashMap<'a, u32, DynamicImportUse<'a>>;
pub type NamedExports<'a> = AstStringArrayHashMap<'a, NamedExport>;
pub type ConstValuesMap<'a> = AstArrayHashMap<'a, Ref, Expr<'a>>;
pub type TsEnumsMap<'a> =
    AstArrayHashMap<'a, Ref, StoreRef<'a, AstStringHashMap<'a, InlinedEnumValue<'a>>>>;
/// `import X ...; X.name` where `X` resolved to a module namespace while
/// linking: `X` -> `name` -> the generated import symbol bound to that export.
/// The printer emits that symbol in place of the property access.
pub type ImportMemberBindings<'a> = AstArrayHashMap<'a, Ref, AstStringHashMap<'a, Ref>>;

impl<'a> Ast<'a> {
    pub fn from_parts(parts: Box<[Part<'a>]>, arena: &'a bun_alloc::MimallocArena) -> Ast<'a> {
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
