//! `ImportRecord` and friends.
//!
//! Lives in `bun_ast` so `Ast` (which holds `Vec<ImportRecord>`) is
//! self-contained and `bun_js_printer` can drop its `bun_js_parser` dep.

use crate::Range;
use bun_paths::fs::Path;

// Re-exported here (canonical at crate root) so callers that path through
// `bun_ast::import_record::{ImportKind, Index, Loader}` keep resolving.
pub use crate::{ImportKind, Index, Loader};

pub struct ImportRecord {
    pub range: Range,
    // TODO: lifetime — `bun_paths::fs::Path<'a>` borrows resolver-owned
    // strings. Uses 'static (PORTING.md: no struct lifetime params).
    pub path: Path<'static>,
    pub kind: ImportKind,
    pub tag: Tag,
    pub loader: Option<Loader>,

    pub source_index: Index,

    /// The original import specifier as written in source code (e.g., "./foo.js").
    /// This is preserved before resolution overwrites `path` with the resolved path.
    /// Used for metafile generation.
    // TODO: lifetime — likely a borrow into parser-owned source text; using
    // &'static [u8] as a placeholder.
    pub original_path: &'static [u8],

    /// Pack all boolean flags into 4 bytes to reduce padding overhead.
    /// Previously 15 separate bool fields caused ~14-16 bytes of padding waste.
    pub flags: Flags,
}

bitflags::bitflags! {
    #[derive(Copy, Clone, Eq, PartialEq, Default, Debug)]
    pub struct Flags: u32 {
        /// require() / await import() / require.resolve() inside the try or
        /// catch body of a try/catch, or import('x').catch(..) / .then(_, ..):
        /// don't fail the build when the path can't be resolved.
        const HANDLES_IMPORT_ERRORS = 1 << 0;

        const IS_INTERNAL = 1 << 1;

        /// Sometimes the parser creates an import record and decides it isn't needed.
        /// For example, TypeScript code may have import statements that later turn
        /// out to be type-only imports after analyzing the whole file.
        const IS_UNUSED = 1 << 2;

        /// If this is true, the import contains syntax like "* as ns". This is used
        /// to determine whether modules that have no exports need to be wrapped in a
        /// CommonJS wrapper or not.
        const CONTAINS_IMPORT_STAR = 1 << 3;

        /// If this is true, the import contains an import for the alias "default",
        /// either via the "import x from" or "import {default as x} from" syntax.
        const CONTAINS_DEFAULT_ALIAS = 1 << 4;

        const CONTAINS_ES_MODULE_ALIAS = 1 << 5;

        /// If true, this "export * from 'path'" statement is evaluated at run-time by
        /// calling the "__reExport()" helper function
        const CALLS_RUNTIME_RE_EXPORT_FN = 1 << 6;

        /// Resolution failed (ModuleNotFound). `path.is_disabled` alone can't
        /// tell this apart from an intentional `"browser": false` disable.
        const WAS_UNRESOLVED = 1 << 7;

        /// If true, this was originally written as a bare "import 'file'" statement
        const WAS_ORIGINALLY_BARE_IMPORT = 1 << 8;

        const WAS_ORIGINALLY_REQUIRE = 1 << 9;

        /// A split `require()` (code splitting, target bun): the target is a chunk
        /// of its own; `path` is pointed at that chunk and the call is printed as
        /// `import.meta.require(path)`.
        const CROSS_CHUNK_REQUIRE = 1 << 10;

        /// If true, this import can be removed if it's unused
        const IS_EXTERNAL_WITHOUT_SIDE_EFFECTS = 1 << 11;

        /// Tell the printer to print the record as "foo:my-path" instead of "path"
        /// where "foo" is the namespace
        ///
        /// Used to prevent running resolve plugins multiple times for the same path
        const PRINT_NAMESPACE_IN_PATH = 1 << 12;

        const WRAP_WITH_TO_ESM = 1 << 13;
        const WRAP_WITH_TO_COMMONJS = 1 << 14;

        /// "import defer * as ns from 'path'" — defer evaluation of the
        /// imported module until a property on the namespace object is
        /// accessed. Requires `CONTAINS_IMPORT_STAR`.
        const PHASE_DEFER = 1 << 15;

        /// The linker pointed `path` at another output chunk (a split
        /// `import()` / `require()`): `text` is its path, `pretty` its id; `source_index` is cleared.
        const IMPORTS_CHUNK = 1 << 16;

        /// `import()` / `require()` whose value nothing reads: the linker bound
        /// every name read off it to an export, so it evaluates to `{}`.
        const NAMESPACE_UNUSED = 1 << 17;

        /// A split `require()` whose target is CommonJS at link time: the
        /// chunk's namespace is `{ default: module.exports }`, so the call
        /// reads `.default` to return `module.exports`.
        const CROSS_CHUNK_REQUIRE_DEFAULT = 1 << 18;
    }
}

pub type List<'a> = bun_alloc::ArenaVec<'a, ImportRecord>;

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub enum Tag {
    /// A normal import to a user's source file
    #[default]
    None,
    /// An import to 'bun'
    Bun,
    /// A builtin module, such as `node:fs` or `bun:sqlite`
    Builtin,
    /// An import to the internal runtime
    Runtime,
    /// A 'macro:' import namespace or 'with { type: "macro" }'
    Macro,

    /// For Bun Kit, if a module in the server graph should actually
    /// crossover to the SSR graph. See bake.Framework.ServerComponents.separate_ssr_graph
    BakeResolveToSsrGraph,
}

impl Tag {
    #[inline]
    pub fn is_internal(self) -> bool {
        (self as u8) >= (Tag::Runtime as u8)
    }
}

// NOTE: no `impl Default for ImportRecord` — `range`, `path`, `kind` have no
// sensible defaults. Construction sites must supply required fields explicitly
// (struct-update or a `new(range, path, kind)` helper).
