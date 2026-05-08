use crate::schema::api;
use bun_collections::VecExt;
use bun_logger::Range;
use bun_paths::fs::Path;
// move-in resolved: Loader & ast::Index now live in this crate (BundleEnums.rs)
use crate::BundleEnums::Loader;
use crate::BundleEnums::Index as AstIndex;
use enum_map::{Enum, EnumMap};

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default, Enum, strum::IntoStaticStr)]
pub enum ImportKind {
    /// An entry point provided to `bun run` or `bun`
    #[strum(serialize = "entry_point_run")]
    #[default]
    EntryPointRun = 0,
    /// An entry point provided to `bun build` or `Bun.build`
    #[strum(serialize = "entry_point_build")]
    EntryPointBuild = 1,
    /// An ES6 import or re-export statement
    #[strum(serialize = "stmt")]
    Stmt = 2,
    /// A call to "require()"
    #[strum(serialize = "require")]
    Require = 3,
    /// An "import()" expression with a string argument
    #[strum(serialize = "dynamic")]
    Dynamic = 4,
    /// A call to "require.resolve()"
    #[strum(serialize = "require_resolve")]
    RequireResolve = 5,
    /// A CSS "@import" rule
    #[strum(serialize = "at")]
    At = 6,
    /// A CSS "@import" rule with import conditions
    #[strum(serialize = "at_conditional")]
    AtConditional = 7,
    /// A CSS "url(...)" token
    #[strum(serialize = "url")]
    Url = 8,
    /// A CSS "composes" property
    #[strum(serialize = "composes")]
    Composes = 9,

    #[strum(serialize = "html_manifest")]
    HtmlManifest = 10,

    #[strum(serialize = "internal")]
    Internal = 11,
}

pub type Label = EnumMap<ImportKind, &'static [u8]>;

// `bun_logger::ImportKind` is the canonical T2 definition (see comment at
// logger/lib.rs:279). This T3 mirror has identical `#[repr(u8)]`
// discriminants. Kept as an explicit `From` (not a `pub use`) until the
// type-unification pass collapses the duplicate; lets
// `import_record.kind.into()` flow into `Log::add_resolve_*`.
impl From<ImportKind> for bun_logger::ImportKind {
    #[inline]
    fn from(k: ImportKind) -> Self {
        use bun_logger::ImportKind as L;
        match k {
            ImportKind::EntryPointRun => L::EntryPointRun,
            ImportKind::EntryPointBuild => L::EntryPointBuild,
            ImportKind::Stmt => L::Stmt,
            ImportKind::Require => L::Require,
            ImportKind::Dynamic => L::Dynamic,
            ImportKind::RequireResolve => L::RequireResolve,
            ImportKind::At => L::At,
            ImportKind::AtConditional => L::AtConditional,
            ImportKind::Url => L::Url,
            ImportKind::Composes => L::Composes,
            ImportKind::HtmlManifest => L::HtmlManifest,
            ImportKind::Internal => L::Internal,
        }
    }
}

// E0015: EnumMap indexing isn't const; Zig's `comptime brk: { ... }` initializer
// is folded into match arms inside label()/error_label() below — same lookup
// table, zero runtime init (PORTING.md §Concurrency: prefer no-lock over OnceLock
// when the data is pure const).
//
// If these are changed, make sure to update
// - src/js/builtins/codegen/replacements.ts
// - packages/bun-types/bun.d.ts

impl ImportKind {
    #[inline]
    pub fn label(self) -> &'static [u8] {
        match self {
            ImportKind::EntryPointRun => b"entry-point-run",
            ImportKind::EntryPointBuild => b"entry-point-build",
            ImportKind::Stmt => b"import-statement",
            ImportKind::Require => b"require-call",
            ImportKind::Dynamic => b"dynamic-import",
            ImportKind::RequireResolve => b"require-resolve",
            ImportKind::At => b"import-rule",
            ImportKind::AtConditional => b"",
            ImportKind::Url => b"url-token",
            ImportKind::Composes => b"composes",
            ImportKind::Internal => b"internal",
            ImportKind::HtmlManifest => b"html_manifest",
        }
    }

    #[inline]
    pub fn error_label(self) -> &'static [u8] {
        match self {
            ImportKind::EntryPointRun => b"entry point (run)",
            ImportKind::EntryPointBuild => b"entry point (build)",
            ImportKind::Stmt => b"import",
            ImportKind::Require => b"require()",
            ImportKind::Dynamic => b"import()",
            ImportKind::RequireResolve => b"require.resolve()",
            ImportKind::At => b"@import",
            ImportKind::AtConditional => b"",
            ImportKind::Url => b"url()",
            ImportKind::Internal => b"<bun internal>",
            ImportKind::Composes => b"composes",
            ImportKind::HtmlManifest => b"HTML import",
        }
    }

    #[inline]
    pub fn is_common_js(self) -> bool {
        matches!(self, Self::Require | Self::RequireResolve)
    }

    // TODO(port): Zig `jsonStringify` uses the std.json writer protocol; replace
    // with a `serde::Serialize` impl or the project's JSON writer trait. For now
    // emit the quoted string directly — every tag name is a plain ASCII
    // identifier with no chars that need JSON escaping.
    pub fn json_stringify<W: core::fmt::Write>(self, writer: &mut W) -> core::fmt::Result {
        writer.write_char('"')?;
        writer.write_str(<&'static str>::from(self))?;
        writer.write_char('"')
    }

    pub fn is_from_css(self) -> bool {
        self == Self::AtConditional || self == Self::At || self == Self::Url || self == Self::Composes
    }

    pub fn to_api(self) -> api::ImportKind {
        // TODO(port): source Zig references `ImportKind.entry_point` which is not a declared variant
        // (only entry_point_run / entry_point_build exist). This compiles in Zig only because the
        // function is never analyzed. Mapping both entry-point variants to api::ImportKind::entry_point.
        match self {
            ImportKind::EntryPointRun | ImportKind::EntryPointBuild => api::ImportKind::entry_point,
            ImportKind::Stmt => api::ImportKind::stmt,
            ImportKind::Require => api::ImportKind::require,
            ImportKind::Dynamic => api::ImportKind::dynamic,
            ImportKind::RequireResolve => api::ImportKind::require_resolve,
            ImportKind::At => api::ImportKind::at,
            ImportKind::Url => api::ImportKind::url,
            _ => api::ImportKind::internal,
        }
    }
}

pub struct ImportRecord {
    pub range: Range,
    // TODO(port): lifetime — `bun_paths::fs::Path<'a>` borrows resolver-owned
    // strings. Phase A uses 'static (PORTING.md: no struct lifetime params).
    pub path: Path<'static>,
    pub kind: ImportKind,
    pub tag: Tag,
    pub loader: Option<Loader>,

    pub source_index: AstIndex,

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

/// `bun.GenericIndex(u32, ImportRecord)` — newtype index distinct from other u32 indices.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct Index(pub u32);

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
// (struct-update or a `new(range, path, kind)` helper in Phase B).

// ported from: src/options_types/import_record.zig
