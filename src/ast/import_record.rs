//! `src/options_types/import_record.zig` — `ImportRecord` and friends.
//!
//! Lives in `bun_ast` so `Ast` (which holds `Vec<ImportRecord>`) is
//! self-contained and `bun_js_printer` can drop its `bun_js_parser` dep.
//! `ImportKind::to_api()` lives in `bun_ast::ImportKindExt` (would
//! back-edge into the schema crate).

use crate::Range;
use bun_paths::fs::Path;

// Re-exported here (canonical at crate root) so callers that path through
// `bun_ast::import_record::{ImportKind, Index, Loader}` — mirroring the Zig
// `import_record.zig` namespace — keep resolving.
pub use crate::{ImportKind, Index, Loader};

pub struct ImportRecord {
    pub range: Range,
    // TODO(port): lifetime — `bun_paths::fs::Path<'a>` borrows resolver-owned
    // strings. Phase A uses 'static (PORTING.md: no struct lifetime params).
    pub path: Path<'static>,
    pub kind: ImportKind,
    pub tag: Tag,
    pub loader: Option<Loader>,

    pub source_index: Index,

    /// `js_printer::printBundledImport` reads this. The Zig field was removed
    /// from `ImportRecord` but the printer body referencing it is dead (never
    /// analysed by Zig's lazy compilation). Kept here so the eagerly-compiled
    /// Rust port of that body type-checks; always 0 in practice.
    // TODO(port): delete once `printBundledImport` is confirmed dead and removed.
    pub module_id: u32,

    /// The original import specifier as written in source code (e.g., "./foo.js").
    /// This is preserved before resolution overwrites `path` with the resolved path.
    /// Used for metafile generation.
    // TODO(port): lifetime — Zig `[]const u8` defaulting to "", never freed in this file.
    // Likely a borrow into parser-owned source text; using &'static [u8] as Phase-A placeholder.
    pub original_path: &'static [u8],

    /// Pack all boolean flags into 2 bytes to reduce padding overhead.
    /// Previously 15 separate bool fields caused ~14-16 bytes of padding waste.
    pub flags: Flags,
}

bitflags::bitflags! {
    #[derive(Copy, Clone, Eq, PartialEq, Default, Debug)]
    pub struct Flags: u16 {
        /// True for the following cases:
        ///
        ///   try { require('x') } catch { handle }
        ///   try { await import('x') } catch { handle }
        ///   try { require.resolve('x') } catch { handle }
        ///   import('x').catch(handle)
        ///   import('x').then(_, handle)
        ///
        /// In these cases we shouldn't generate an error if the path could not be
        /// resolved.
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

        /// True for require calls like this: "try { require() } catch {}". In this
        /// case we shouldn't generate an error if the path could not be resolved.
        const IS_INSIDE_TRY_BODY = 1 << 7;

        /// If true, this was originally written as a bare "import 'file'" statement
        const WAS_ORIGINALLY_BARE_IMPORT = 1 << 8;

        const WAS_ORIGINALLY_REQUIRE = 1 << 9;

        /// If a macro used <import>, it will be tracked here.
        const WAS_INJECTED_BY_MACRO = 1 << 10;

        /// If true, this import can be removed if it's unused
        const IS_EXTERNAL_WITHOUT_SIDE_EFFECTS = 1 << 11;

        /// Tell the printer to print the record as "foo:my-path" instead of "path"
        /// where "foo" is the namespace
        ///
        /// Used to prevent running resolve plugins multiple times for the same path
        const PRINT_NAMESPACE_IN_PATH = 1 << 12;

        const WRAP_WITH_TO_ESM = 1 << 13;
        const WRAP_WITH_TO_COMMONJS = 1 << 14;

        // bit 15 (_padding: u1) intentionally unused
    }
}

pub type List = Vec<ImportRecord>;

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

    Tailwind,
}

impl Tag {
    #[inline]
    pub fn is_runtime(self) -> bool {
        self == Tag::Runtime
    }

    #[inline]
    pub fn is_internal(self) -> bool {
        (self as u8) >= (Tag::Runtime as u8)
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum PrintMode {
    Normal,
    ImportPath,
    Css,
    NapiModule,
}

// NOTE: no `impl Default for ImportRecord` — Zig gives `range`, `path`, `kind` no defaults,
// so `.{}` is invalid there. Construction sites must supply required fields explicitly
// (struct-update or a `new(range, path, kind)` helper).

// ported from: src/options_types/import_record.zig
