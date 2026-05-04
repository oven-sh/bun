use bun_collections::{ArrayHashMap, BabyList, StringArrayHashMap, StringHashMap};
use bun_logger as logger;
use bun_options_types::ImportRecord;

use crate::ast::{
    CharFreq, ExportsKind, Expr, InlinedEnumValue, LocRef, NamedExport, NamedImport, Part, Ref,
    Scope, SlotCounts, Symbol,
};
use crate::runtime::Runtime;

// TODO(port): `Part.List` / `Symbol.List` / `ImportRecord.List` are nested decls in Zig.
// Rust has no inherent associated types on structs, so reference them via their modules.
// Phase B: confirm actual paths.
use crate::ast::part::List as PartList;
use crate::ast::symbol::List as SymbolList;
use bun_options_types::import_record::List as ImportRecordList;

pub type TopLevelSymbolToParts = ArrayHashMap<Ref, BabyList<u32>>;

#[derive(Default)]
pub struct Ast {
    pub approximate_newline_count: usize,
    pub has_lazy_export: bool,
    pub runtime_imports: crate::runtime::Imports,

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
    pub import_keyword: logger::Range, // Does not include TypeScript-specific syntax or "import()"
    pub export_keyword: logger::Range, // Does not include TypeScript-specific syntax
    pub top_level_await_keyword: logger::Range,

    /// These are stored at the AST level instead of on individual AST nodes so
    /// they can be manipulated efficiently without a full AST traversal
    pub import_records: ImportRecordList,

    // TODO(port): lifetime — `hashbang`/`directive` are `[]const u8` slices into source text
    // (not freed in Zig `deinit`). Using &'static as placeholder; Phase B may need arena lifetime
    // or a StoreRef.
    pub hashbang: &'static [u8],
    pub directive: Option<&'static [u8]>,
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

    // allocator: std.mem.Allocator,
    pub top_level_symbols_to_parts: TopLevelSymbolToParts,

    pub commonjs_named_exports: CommonJSNamedExports,

    pub redirect_import_record_index: Option<u32>,

    /// Only populated when bundling
    pub target: bun_bundler::options::Target,
    // const_values: ConstValuesMap,
    pub ts_enums: TsEnumsMap,

    /// Not to be confused with `commonjs_named_exports`
    /// This is a list of named exports that may exist in a CommonJS module
    /// We use this with `commonjs_at_runtime` to re-export CommonJS
    pub has_commonjs_export_names: bool,
    pub has_import_meta: bool,
    pub import_meta_ref: Ref,
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

pub type CommonJSNamedExports = StringArrayHashMap<CommonJSNamedExport>;

pub type NamedImports = ArrayHashMap<Ref, NamedImport>;
pub type NamedExports = StringArrayHashMap<NamedExport>;
pub type ConstValuesMap = ArrayHashMap<Ref, Expr>;
pub type TsEnumsMap = ArrayHashMap<Ref, StringHashMap<InlinedEnumValue>>;

impl Ast {
    pub fn from_parts(parts: Box<[Part]>) -> Ast {
        Ast {
            parts: PartList::from_owned_slice(parts),
            runtime_imports: Default::default(),
            ..Default::default()
        }
    }

    pub fn init_test(parts: &[Part]) -> Ast {
        Ast {
            parts: PartList::from_borrowed_slice_dangerous(parts),
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

    pub fn to_json<W: std::io::Write>(&self, stream: &mut W) -> Result<(), bun_core::Error> {
        // TODO(port): Zig used `std.json.stringify(self.parts, opts, stream)` with whitespace.separator = true.
        // Phase B: pick a JSON serializer for `parts` (serde or hand-rolled). Stubbed for now.
        // TODO(port): narrow error set
        let _ = stream;
        let _ = &self.parts;
        Ok(())
    }

    // Zig `deinit` only freed `parts`, `symbols`, `import_records` via `bun.default_allocator`,
    // and was guarded by "Do not call this if it wasn't globally allocated!".
    // In Rust those fields own their storage and free on Drop; no explicit body needed.
    // TODO(port): BabyList<T> Drop semantics must distinguish arena-backed vs heap-backed to
    // preserve the Zig conditional-free behavior. Revisit in Phase B.
}

pub use crate::ast::g::Class;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/Ast.zig (143 lines)
//   confidence: medium
//   todos:      6
//   notes:      Zig nested `.List` types referenced via module paths; hashbang/directive/export_star_import_records ownership needs Phase-B lifetime decision; deinit folded into Drop semantics of field types.
// ──────────────────────────────────────────────────────────────────────────
