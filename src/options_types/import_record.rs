use bun_collections::BabyList;
use bun_logger::Range;
use bun_fs::Path;
// TODO(b0): Loader arrives from move-in (TYPE_ONLY bun_bundler::options::Loader → options_types)
use crate::Loader;
// TODO(b0): Index arrives from move-in (TYPE_ONLY bun_js_parser::Index → options_types)
use crate::Index as AstIndex;
use bun_schema::api;
use enum_map::{Enum, EnumMap};

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Enum, strum::IntoStaticStr)]
pub enum ImportKind {
    /// An entry point provided to `bun run` or `bun`
    #[strum(serialize = "entry_point_run")]
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

// TODO(port): EnumMap may not be const-constructible; Phase B may need lazy_static/OnceLock or convert to a `match` body inside label()/error_label().
pub static ALL_LABELS: Label = 'brk: {
    // If these are changed, make sure to update
    // - src/js/builtins/codegen/replacements.ts
    // - packages/bun-types/bun.d.ts
    let mut labels: Label = EnumMap::from_array([b"" as &'static [u8]; 12]);
    labels[ImportKind::EntryPointRun] = b"entry-point-run";
    labels[ImportKind::EntryPointBuild] = b"entry-point-build";
    labels[ImportKind::Stmt] = b"import-statement";
    labels[ImportKind::Require] = b"require-call";
    labels[ImportKind::Dynamic] = b"dynamic-import";
    labels[ImportKind::RequireResolve] = b"require-resolve";
    labels[ImportKind::At] = b"import-rule";
    labels[ImportKind::Url] = b"url-token";
    labels[ImportKind::Composes] = b"composes";
    labels[ImportKind::Internal] = b"internal";
    labels[ImportKind::HtmlManifest] = b"html_manifest";
    break 'brk labels;
};

pub static ERROR_LABELS: Label = 'brk: {
    let mut labels: Label = EnumMap::from_array([b"" as &'static [u8]; 12]);
    labels[ImportKind::EntryPointRun] = b"entry point (run)";
    labels[ImportKind::EntryPointBuild] = b"entry point (build)";
    labels[ImportKind::Stmt] = b"import";
    labels[ImportKind::Require] = b"require()";
    labels[ImportKind::Dynamic] = b"import()";
    labels[ImportKind::RequireResolve] = b"require.resolve()";
    labels[ImportKind::At] = b"@import";
    labels[ImportKind::Url] = b"url()";
    labels[ImportKind::Internal] = b"<bun internal>";
    labels[ImportKind::Composes] = b"composes";
    labels[ImportKind::HtmlManifest] = b"HTML import";
    break 'brk labels;
};

impl ImportKind {
    #[inline]
    pub fn label(self) -> &'static [u8] {
        ALL_LABELS[self]
    }

    #[inline]
    pub fn error_label(self) -> &'static [u8] {
        ERROR_LABELS[self]
    }

    #[inline]
    pub fn is_common_js(self) -> bool {
        matches!(self, Self::Require | Self::RequireResolve)
    }

    // TODO(port): Zig `jsonStringify` uses the std.json writer protocol (`writer.write(str)`).
    // Phase B should likely replace this with a `serde::Serialize` impl or the project's JSON writer trait.
    pub fn json_stringify<W: core::fmt::Write>(self, writer: &mut W) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        writer.write_str(<&'static str>::from(self)).map_err(Into::into)
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
    pub path: Path,
    pub kind: ImportKind,
    pub tag: Tag,
    pub loader: Option<Loader>,

    pub source_index: AstIndex,

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

pub type List = BabyList<ImportRecord>;

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/options_types/import_record.zig (225 lines)
//   confidence: medium
//   todos:      4
//   notes:      ALL_LABELS/ERROR_LABELS static init may need OnceLock; to_api() source references nonexistent `entry_point` variant; original_path lifetime needs review
// ──────────────────────────────────────────────────────────────────────────
