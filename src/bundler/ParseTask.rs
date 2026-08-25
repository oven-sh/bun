//! A `ParseTask` is the unit of work scheduled on the thread pool for each
//! source file the bundler needs to parse. It carries everything needed to
//! read the file (or use already-loaded contents), run the JS/CSS/etc. parser,
//! and ship a `Result` back to the bundler thread.

use core::ffi::c_void;
use core::sync::atomic::{AtomicU32, Ordering};

use crate::Error as AnyError;
use bun_alloc::Arena as Bump; // bumpalo::Bump re-export
use bun_ast::ImportRecord;
use bun_ast::{Loc, Location, Log, Msg, Source};
use bun_collections::VecExt;
use bun_core::strings;
use bun_core::{self, FeatureFlags, declare_scope, scoped_log};
use bun_sys::Fd;

use crate::JSAst;
use bun_ast::Index;
use bun_ast::{self as ast, E, Expr, G, Part};
use bun_js_parser as js_parser;
/// `js_parser.Parser.Options` — the real parser-entry options struct.
pub use bun_js_parser::parser::ParserOptions;

use crate::bun_css;
use crate::bun_fs as Fs;
use crate::bun_node_fallbacks as NodeFallbackModules;
use crate::bundle_v2::{self as bundler, BundleV2, ParseShared};
use crate::cache::{Entry as CacheEntry, ExternalFreeFunction};
use crate::html_scanner::HTMLScanner;
use crate::options::{self, Loader};
use crate::transpiler::Transpiler;
use crate::{ContentHasher, UseDirective, perf, target_from_hashbang};
use bun_resolver::fs::PathResolverExt as _;
use bun_resolver::{self as _resolver, Resolver};
use std::sync::Arc;

declare_scope!(ParseTask, hidden);

// The per-file parse arena is the worker's `&'a Bump` (owned by the
// `BundleHeap` the bundle borrows for `'a`), so `bump.alloc_*` /
// `ArenaString::into_bump_str` yield `&'a` borrows directly; `StoreStr::new`
// covers the remaining AST-string sites (`E::String.data`, `FileLoaderHash.key`).

// `JSBundlerPlugin::{has_on_before_parse_plugins, call_on_before_parse_plugins}`
// live on the canonical `impl Plugin` in `bundle_v2.rs::api::JSBundler` next to
// the other FFI wrappers; `bundler::JSBundlerPlugin` re-exports that type.
//
// `FileMap::get` now lives on the real `JSBundler::FileMap` in
// bundle_v2.rs (no longer an opaque forward-decl). The placeholder
// always-miss `get` shim that used to sit here has been removed so the two
// inherent impls don't collide.

// ───────────────────────────────────────────────────────────────────────────
// ContentsOrFd
// ───────────────────────────────────────────────────────────────────────────

#[derive(bun_core::EnumTag)]
#[enum_tag(existing = ContentsOrFdTag)]
pub enum ContentsOrFd {
    Fd { dir: Fd, file: Fd },
    // The `'static` is ownership-erased: contents may be arena-owned,
    // plugin-owned, or truly static (runtime source). The producer keeps the
    // backing allocation alive for the duration of the bundle pass.
    Contents(&'static [u8]),
}

#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub(crate) enum ContentsOrFdTag {
    Fd,
    Contents,
}

// ───────────────────────────────────────────────────────────────────────────
// ParseTask
// ───────────────────────────────────────────────────────────────────────────

pub struct ParseTask<'a> {
    // lifetime-erased `'static` — paths borrow from `DirnameStore`
    // (process-lifetime BSS string pool); see `bun_resolver::fs::Path<'a>`.
    pub(crate) path: Fs::Path<'static>,
    pub(crate) secondary_path_for_commonjs_interop: Option<Fs::Path<'static>>,
    pub(crate) contents_or_fd: ContentsOrFd,
    pub(crate) external_free_function: ExternalFreeFunction,
    pub(crate) side_effects: bun_ast::SideEffects,
    pub(crate) loader: Option<Loader>,
    pub(crate) jsx: options::jsx::Pragma,
    pub(crate) source_index: Index,
    /// Pool node; the task is queued on the IO pool (to read the file) or the
    /// parse pool depending on `stage`.
    pub task: bun_threading::GroupedTask,

    // Used for splitting up the work between the io and parse steps.
    pub(crate) stage: ParseTaskStage,

    pub(crate) known_target: options::Target,
    pub(crate) module_type: options::ModuleType,
    pub(crate) emit_decorator_metadata: bool,
    pub(crate) experimental_decorators: bool,
    pub(crate) use_define_for_class_fields: bool,
    /// What the bundle shares with the thread that runs this task; `None`
    /// only before enqueue (`Default`, runtime source).
    pub ctx: Option<Arc<ParseShared<'a>>>,
    // Borrows package_json (resolver arena); valid for the bundle pass.
    pub(crate) package_version: ast::StoreStr,
    pub(crate) package_name: ast::StoreStr,
    pub(crate) is_entry_point: bool,
}

bun_core::intrusive_field!(['a] ParseTask<'a>, task: bun_threading::GroupedTask);
impl bun_threading::GroupTask for ParseTask<'_> {
    #[inline]
    fn run(self: Box<Self>) {
        parse_worker::run_from_thread_pool(self);
    }
}

pub enum ParseTaskStage {
    NeedsSourceCode,
    NeedsParse(CacheEntry),
}

// ───────────────────────────────────────────────────────────────────────────
// Result
// ───────────────────────────────────────────────────────────────────────────

/// The information returned to the Bundler thread when a parse finishes.
pub(crate) struct Result<'a> {
    /// The finished task, kept alive by the bundle: its `stage` owns the
    /// source bytes `Success::source` borrows. `None` for
    /// `ServerComponentParseTask` results.
    pub(crate) parse_task: Option<Box<ParseTask<'a>>>,
    pub(crate) value: ResultValue<'a>,
    pub(crate) watcher_data: WatcherData,
    /// This is used for native onBeforeParsePlugins to store
    /// a function pointer and context pointer to free the
    /// returned source code by the plugin.
    pub(crate) external: ExternalFreeFunction,
}
#[allow(clippy::large_enum_variant)]
pub(crate) enum ResultValue<'a> {
    Success(Success<'a>),
    Err(ResultError),
    Empty { source_index: Index },
}

impl ResultValue<'_> {
    pub(crate) fn source_index(&self) -> u32 {
        match self {
            ResultValue::Empty { source_index } => source_index.get(),
            ResultValue::Err(data) => data.source_index.get(),
            ResultValue::Success(val) => val.source.index.0,
        }
    }
}

pub(crate) struct WatcherData {
    pub(crate) fd: Fd,
    pub(crate) dir_fd: Fd,
}

impl WatcherData {
    /// When no files to watch, this encoding is used.
    pub(crate) const NONE: WatcherData = WatcherData {
        fd: Fd::INVALID,
        dir_fd: Fd::INVALID,
    };
}

pub(crate) struct Success<'a> {
    pub(crate) ast: JSAst<'a>,
    pub(crate) source: Source,
    pub(crate) log: Log,
    pub(crate) use_directive: UseDirective,
    pub(crate) side_effects: bun_ast::SideEffects,

    /// Used by "file" loader files.
    pub(crate) unique_key_for_additional_file: ast::StoreStr,
    /// Used by "file" loader files.
    pub(crate) content_hash_for_additional_file: u64,

    pub(crate) loader: Loader,

    /// The package name from package.json, used for barrel optimization.
    pub(crate) package_name: ast::StoreStr,
}

pub(crate) struct ResultError {
    pub(crate) err: AnyError,
    pub(crate) step: Step,
    pub(crate) log: Log,
    pub(crate) target: options::Target,
    pub(crate) source_index: Index,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Step {
    Pending,
    Parse,
    Resolve,
}

// ───────────────────────────────────────────────────────────────────────────
// init
// ───────────────────────────────────────────────────────────────────────────

impl<'a> ParseTask<'a> {
    /// What the bundle shares with this task; cloned so the borrow is not
    /// tied to `&self`.
    #[inline]
    pub(crate) fn ctx(&self) -> Arc<ParseShared<'a>> {
        Arc::clone(self.ctx.as_ref().expect("ParseTask.ctx unset"))
    }

    pub(crate) fn init(
        resolve_result: &_resolver::Result,
        source_index: Index,
        ctx: &BundleV2<'a>,
    ) -> ParseTask<'a> {
        let (package_name, package_version) = match resolve_result.package_json_ref() {
            Some(pj) => (
                ast::StoreStr::new(&pj.name[..]),
                ast::StoreStr::new(&pj.version[..]),
            ),
            None => (ast::StoreStr::EMPTY, ast::StoreStr::EMPTY),
        };
        let known_target = ctx.transpiler().options.target;
        ParseTask {
            ctx: None,
            path: resolve_result.path_pair.primary,
            contents_or_fd: ContentsOrFd::Fd {
                dir: resolve_result.dirname_fd,
                file: resolve_result.file_fd,
            },
            side_effects: resolve_result.primary_side_effects_data,
            // D042: resolver-side and bundler-side `jsx::Pragma` are the SAME
            // nominal type (`bun_options_types::jsx::Pragma`). Preserves
            // jsxImportSource/runtime/etc. from tsconfig.json.
            jsx: resolve_result.jsx.clone(),
            source_index,
            module_type: resolve_result.module_type,
            emit_decorator_metadata: resolve_result.flags.emit_decorator_metadata(),
            experimental_decorators: resolve_result.flags.experimental_decorators(),
            use_define_for_class_fields: resolve_result.flags.use_define_for_class_fields(),
            package_version,
            package_name,
            known_target,
            // defaults:
            secondary_path_for_commonjs_interop: None,
            external_free_function: ExternalFreeFunction::NONE,
            loader: None,
            task: bun_threading::GroupedTask::default(),
            stage: ParseTaskStage::NeedsSourceCode,
            is_entry_point: false,
        }
    }

    /// Re-export of `parse_worker::get_runtime_source` as an associated fn so
    /// callers can spell it `ParseTask::get_runtime_source`.
    #[inline]
    pub(crate) fn get_runtime_source<'r>(target: options::Target) -> RuntimeSource<'r> {
        parse_worker::get_runtime_source(target)
    }
}

impl Default for ParseTask<'_> {
    fn default() -> Self {
        ParseTask {
            ctx: None,
            path: Fs::Path::init(b""),
            secondary_path_for_commonjs_interop: None,
            contents_or_fd: ContentsOrFd::Contents(b""),
            external_free_function: ExternalFreeFunction::NONE,
            side_effects: bun_ast::SideEffects::HasSideEffects,
            loader: None,
            jsx: Default::default(),
            source_index: Index::INVALID,
            task: bun_threading::GroupedTask::default(),
            stage: ParseTaskStage::NeedsSourceCode,
            known_target: options::Target::default(),
            module_type: options::ModuleType::Unknown,
            emit_decorator_metadata: false,
            experimental_decorators: false,
            use_define_for_class_fields: true,
            package_version: ast::StoreStr::EMPTY,
            package_name: ast::StoreStr::EMPTY,
            is_entry_point: false,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// RuntimeSource
// ───────────────────────────────────────────────────────────────────────────

pub(crate) struct RuntimeSource<'a> {
    pub(crate) parse_task: ParseTask<'a>,
    pub(crate) source: Source,
}

// When the `require` identifier is visited, it is replaced with e_require_call_target
// and then that is either replaced with the module itself, or an import to the
// runtime here.

// Previously, Bun inlined `import.meta.require` at all usages. This broke
// code that called `fn.toString()` and parsed the code outside a module
// context.
const RUNTIME_REQUIRE_BUN: &str = "export var __require = import.meta.require;";

const RUNTIME_REQUIRE_NODE: &str = "\
import { createRequire } from \"node:module\";
export var __require = /* @__PURE__ */ createRequire(import.meta.url);
";

// Copied from esbuild's runtime.go:
//
// > This fallback "require" function exists so that "typeof require" can
// > naturally be "function" even in non-CommonJS environments since esbuild
// > emulates a CommonJS environment (issue #1202). However, people want this
// > shim to fall back to "globalThis.require" even if it's defined later
// > (including property accesses such as "require.resolve") so we need to
// > use a proxy (issue #1614).
//
// When bundling to node, esbuild picks this code path as well, but `globalThis.require`
// is not always defined there. The `createRequire` call approach is more reliable.
const RUNTIME_REQUIRE_OTHER: &str = "\
export var __require = /* @__PURE__ */ (x =>
  typeof require !== 'undefined' ? require :
  typeof Proxy !== 'undefined' ? new Proxy(x, {
    get: (a, b) => (typeof require !== 'undefined' ? require : a)[b]
  }) : x
)(function (x) {
  if (typeof require !== 'undefined') return require.apply(this, arguments)
  throw Error('Dynamic require of \"' + x + '\" is not supported')
});
";

// JavaScriptCore supports `using` / `await using` natively (see
// `lower_using = !target.isBun()` below), so these helpers are unused
// when bundling for Bun and will be tree-shaken. They are still defined
// here so the runtime module exports a consistent shape across targets.
// Bun's WebKit also has Symbol.asyncDispose, Symbol.dispose, and
// SuppressedError, so no polyfills are needed.
const RUNTIME_USING_BUN: &str = "\
export var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== 'object' && typeof value !== 'function') throw TypeError('Object expected to be assigned to \"using\" declaration')
    let dispose
    if (async) dispose = value[Symbol.asyncDispose]
    if (dispose === void 0) dispose = value[Symbol.dispose]
    if (typeof dispose !== 'function') throw TypeError('Object not disposable')
    stack.push([async, dispose, value])
  } else if (async) {
    stack.push([async])
  }
  return value
}

export var __callDispose = (stack, error, hasError) => {
  let fail = e => error = hasError ? new SuppressedError(e, error, 'An error was suppressed during disposal') : (hasError = true, e)
    , next = (it) => {
      while (it = stack.pop()) {
        try {
          var result = it[1] && it[1].call(it[2])
          if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()))
        } catch (e) {
          fail(e)
        }
      }
      if (hasError) throw error
    }
  return next()
}
";

// Other platforms may or may not have the symbol or errors
// The definitions of __dispose and __asyncDispose match what esbuild's __wellKnownSymbol() helper does
const RUNTIME_USING_OTHER: &str = "\
var __dispose = Symbol.dispose || /* @__PURE__ */ Symbol.for('Symbol.dispose');
var __asyncDispose =  Symbol.asyncDispose || /* @__PURE__ */ Symbol.for('Symbol.asyncDispose');

export var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== 'object' && typeof value !== 'function') throw TypeError('Object expected to be assigned to \"using\" declaration')
    var dispose
    if (async) dispose = value[__asyncDispose]
    if (dispose === void 0) dispose = value[__dispose]
    if (typeof dispose !== 'function') throw TypeError('Object not disposable')
    stack.push([async, dispose, value])
  } else if (async) {
    stack.push([async])
  }
  return value
}

export var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === 'function' ? SuppressedError :
    function (e, s, m, _) { return _ = Error(m), _.name = 'SuppressedError', _.error = e, _.suppressed = s, _ },
    fail = e => error = hasError ? new E(e, error, 'An error was suppressed during disposal') : (hasError = true, e),
    next = (it) => {
      while (it = stack.pop()) {
        try {
          var result = it[1] && it[1].call(it[2])
          if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()))
        } catch (e) {
          fail(e)
        }
      }
      if (hasError) throw error
    }
  return next()
}
";

// ══════════════════════════════════════════════════════════════════════════
// Per-file parse worker — `getAST`/`getCodeForParseTask`/`runFromThreadPool`.
// ══════════════════════════════════════════════════════════════════════════
pub mod parse_worker {
    use super::*;

    fn get_runtime_source_comptime<'a>(target: options::Target) -> RuntimeSource<'a> {
        // The runtime module is the shared `runtime.js` body plus a per-target
        // `__require`/`__using` tail. Concatenating at compile time would embed
        // four copies of the 13 KB body, so each variant is assembled once on
        // first use instead.
        #[derive(Clone, Copy)]
        enum Variant {
            Bun,
            BunMacro,
            Node,
            Other,
        }
        let variant = match target {
            options::Target::Bun => Variant::Bun,
            options::Target::BunMacro => Variant::BunMacro,
            options::Target::Node => Variant::Node,
            _ => Variant::Other,
        };
        static SOURCES: [bun_core::Once<Box<[u8]>>; 4] = [
            bun_core::Once::new(),
            bun_core::Once::new(),
            bun_core::Once::new(),
            bun_core::Once::new(),
        ];
        let runtime_code: &'static [u8] = SOURCES[variant as usize].get_or_init(|| {
            let (require, using): (&str, &str) = match variant {
                Variant::Bun => (RUNTIME_REQUIRE_BUN, RUNTIME_USING_BUN),
                Variant::BunMacro => (RUNTIME_REQUIRE_BUN, RUNTIME_USING_OTHER),
                Variant::Node => (RUNTIME_REQUIRE_NODE, RUNTIME_USING_OTHER),
                Variant::Other => (RUNTIME_REQUIRE_OTHER, RUNTIME_USING_OTHER),
            };
            [include_str!("../runtime.js"), require, using]
                .concat()
                .into_bytes()
                .into_boxed_slice()
        });

        let parse_task = ParseTask {
            ctx: None,
            path: Fs::Path::init_with_namespace(b"runtime", b"bun:runtime"),
            side_effects: bun_ast::SideEffects::NoSideEffectsPureData,
            jsx: options::jsx::Pragma {
                parse: false,
                ..Default::default()
            },
            contents_or_fd: ContentsOrFd::Contents(runtime_code),
            source_index: Index::RUNTIME,
            loader: Some(Loader::Js),
            known_target: target,
            // defaults:
            secondary_path_for_commonjs_interop: None,
            external_free_function: ExternalFreeFunction::NONE,
            task: bun_threading::GroupedTask::default(),
            stage: ParseTaskStage::NeedsSourceCode,
            module_type: options::ModuleType::Unknown,
            emit_decorator_metadata: false,
            experimental_decorators: false,
            use_define_for_class_fields: true,
            package_version: ast::StoreStr::EMPTY,
            package_name: ast::StoreStr::EMPTY,
            is_entry_point: false,
        };
        let source = Source {
            // `bun_ast::Source.path` is `bun_paths::fs::Path<'static>`, distinct
            // from `bun_resolver::fs::Path` (TYPE_ONLY mirror). Construct
            // directly rather than `clone()` across the type boundary.
            path: bun_paths::fs::Path {
                text: b"runtime",
                namespace: b"bun:runtime",
                pretty: b"",
                is_disabled: false,
                is_symlink: false,
            },
            contents: std::borrow::Cow::Borrowed(runtime_code),
            // `Source.index` is `bun_ast::Index` (newtype `u32`),
            // distinct from `bun_ast::Index`. Runtime source is index 0.
            index: bun_ast::Index(Index::RUNTIME.get()),
            ..Default::default()
        };
        RuntimeSource { parse_task, source }
    }

    pub(crate) fn get_runtime_source<'a>(target: options::Target) -> RuntimeSource<'a> {
        get_runtime_source_comptime(target)
    }

    // ───────────────────────────────────────────────────────────────────────────
    // getEmptyCSSAST / getEmptyAST
    // ───────────────────────────────────────────────────────────────────────────

    fn get_empty_css_ast<'a>(
        log: &mut Log,
        define: &'a crate::defines::Define,
        opts: ParserOptions<'a>,
        bump: &'a Bump,
        source: &'a Source,
    ) -> core::result::Result<JSAst<'a>, AnyError> {
        let root = Expr::init(E::Object::default(), Loc { start: 0 });
        let mut ast = JSAst::init(
            js_parser::new_lazy_export_ast(bump, define, opts, log, root, source, b"")?
                .ok_or(AnyError::ParserError)?,
        );
        ast.css = Some(crate::bundled_ast::CssAstRef::from_bump(
            bump.alloc(bun_css::BundlerStyleSheet::empty()),
        ));
        Ok(ast)
    }

    fn get_empty_ast<'a, RootType: Default + bun_ast::expr::IntoExprData>(
        log: &mut Log,
        define: &'a crate::defines::Define,
        opts: ParserOptions<'a>,
        bump: &'a Bump,
        source: &'a Source,
    ) -> core::result::Result<JSAst<'a>, AnyError> {
        let root = Expr::init(RootType::default(), Loc::EMPTY);
        Ok(JSAst::init(
            js_parser::new_lazy_export_ast(bump, define, opts, log, root, source, b"")?
                .ok_or(AnyError::ParserError)?,
        ))
    }

    // ───────────────────────────────────────────────────────────────────────────
    // FileLoaderHash
    // ───────────────────────────────────────────────────────────────────────────

    pub(crate) struct FileLoaderHash {
        pub(crate) key: ast::StoreStr,
        pub(crate) content_hash: u64,
    }

    /// Returns the unique key the printer replaces with the asset's final path.
    fn register_embedded_asset<'b>(
        bump: &'b Bump,
        source: &Source,
        unique_key_prefix: u64,
        unique_key_for_additional_file: &mut FileLoaderHash,
    ) -> &'b [u8] {
        use core::fmt::Write as _;
        let mut buf = bun_alloc::ArenaString::new_in(bump);
        write!(
            &mut buf,
            "{}",
            crate::chunk::UniqueKey {
                prefix: unique_key_prefix,
                kind: crate::chunk::QueryKind::Asset,
                index: source.index.0,
            },
        )
        .expect("unreachable");
        let unique_key = buf.into_bump_str().as_bytes();
        *unique_key_for_additional_file = FileLoaderHash {
            key: ast::StoreStr::new(unique_key),
            content_hash: ContentHasher::run(&source.contents),
        };
        unique_key
    }

    /// `require("<unique key>")`. Unlike `import.meta.require`, the call target
    /// prints per output format, so `--bytecode` (CommonJS) can compile it.
    fn require_embedded_asset(unique_key: &[u8]) -> Expr {
        let import_path = Expr::init(
            E::String {
                data: unique_key.into(),
                ..Default::default()
            },
            Loc { start: 0 },
        );
        Expr::init(
            E::Call {
                target: Expr {
                    data: ast::ExprData::ERequireCallTarget,
                    loc: Loc { start: 0 },
                },
                args: bun_ast::ExprNodeList::from_arena_slice(&[import_path]),
                ..Default::default()
            },
            Loc { start: 0 },
        )
    }

    // ───────────────────────────────────────────────────────────────────────────
    // CSS Symbol bridge — `bun_ast::Symbol` ↔ `bun_ast::Symbol`
    //
    // `StylesheetExtra.symbols` is `Vec<bun_ast::Symbol>`;
    // `new_lazy_export_ast_impl` takes `Vec<bun_ast::Symbol>`. Convert
    // field-by-field so CSS-module local refs (`ref.inner_index()`) index a
    // populated symbol table.
    // ───────────────────────────────────────────────────────────────────────────

    fn css_symbols_to_parser_symbols<'a>(
        src: &[bun_ast::Symbol],
        bump: &'a Bump,
    ) -> bun_ast::symbol::List<'a> {
        use bun_ast::symbol::{Kind as PKind, Symbol as PSym};
        let mut out = bun_ast::symbol::List::with_capacity_in(src.len(), bump);
        for s in src {
            // Post-dedup `bun_ast::Symbol` IS `bun_ast::symbol::Symbol`, so
            // `s.kind`/`s.import_item_status` are already the target nominal types
            // — the former `#[repr(u8)]` round-trip bridge is no longer needed.
            let kind: PKind = s.kind;
            let import_item_status: bun_ast::ImportItemStatus = s.import_item_status;
            // `bun_ast::Ref` is a re-export of `bun_ast::Ref` (ast/base.rs:172)
            // — same nominal type, no bridge needed.
            let link: bun_ast::Ref = s.link.get();
            out.push(PSym {
                original_name: bun_ast::StoreStr::new(s.original_name.slice()),
                // CSS-module locals are never ES6 namespace-aliased (the CSS parser
                // never assigns `namespace_alias`); drop rather than bridge the
                // distinct `NamespaceAlias` mirrors.
                namespace_alias: None,
                link: std::cell::Cell::new(link),
                use_count_estimate: s.use_count_estimate,
                chunk_index: core::sync::atomic::AtomicU32::new(
                    s.chunk_index.load(core::sync::atomic::Ordering::Relaxed),
                ),
                nested_scope_slot: s.nested_scope_slot,
                kind,
                import_item_status,
                flags: s.flags,
            });
        }
        out
    }

    // ───────────────────────────────────────────────────────────────────────────
    // getAST
    // ───────────────────────────────────────────────────────────────────────────

    /// `topts` and `resolver` may belong to different worker transpilers (see
    /// `run_with_source_code`).
    #[allow(clippy::too_many_arguments)]
    fn get_ast<'a>(
        log: &mut Log,
        topts: &mut options::BundleOptions<'a>,
        define: &'a crate::defines::Define,
        opts: ParserOptions<'a>,
        bump: &'a Bump,
        resolver: &mut Resolver<'a>,
        source: &'a Source,
        loader: Loader,
        unique_key_prefix: u64,
        unique_key_for_additional_file: &mut FileLoaderHash,
        has_any_css_locals: &AtomicU32,
    ) -> core::result::Result<JSAst<'a>, AnyError> {
        use core::fmt::Write as _;

        match loader {
            Loader::Jsx | Loader::Tsx | Loader::Js | Loader::Ts => {
                let _trace = perf::trace("Bundler.ParseJS");
                // `ParserOptions` is not `Clone` (holds `&'a mut MacroContext`).
                // The empty-AST fallback needs the same options; since `opts`
                // moves into `.parse()`,
                // snapshot a faithful field-by-field copy via
                // `Options::clone_for_lazy_export` (co-located with the struct so
                // field drift is a hard error) before the move.
                let fallback_opts = opts.clone_for_lazy_export();
                let module_type = opts.module_type;
                return if let Some(res) =
                    (crate::cache::JavaScript {}).parse(bump, opts, define, log, source)?
                {
                    // `Cached`/`AlreadyBundled` are runtime-loader
                    // states that never reach the bundler's `getAST`, so unwrap.
                    match res {
                        bun_js_parser::Result::Ast(ast) => Ok(JSAst::init(*ast)),
                        bun_js_parser::Result::Cached
                        | bun_js_parser::Result::AlreadyBundled(_) => {
                            unreachable!("bundler parse never yields Cached/AlreadyBundled")
                        }
                    }
                } else if module_type == options::ModuleType::Esm {
                    get_empty_ast::<E::Undefined>(log, define, fallback_opts, bump, source)
                } else {
                    get_empty_ast::<E::Object>(log, define, fallback_opts, bump, source)
                };
            }
            Loader::Json | Loader::Jsonc => {
                let _trace = perf::trace("Bundler.ParseJSON");
                let mode = if matches!(loader, Loader::Jsonc) {
                    bun_resolver::tsconfig_json::JsonMode::Jsonc
                } else {
                    bun_resolver::tsconfig_json::JsonMode::Json
                };
                let root: Expr = resolver
                    .caches
                    .json
                    .parse_json(log, source, mode)?
                    .unwrap_or_else(|| Expr::init(E::Object::default(), Loc::EMPTY));
                return Ok(JSAst::init(
                    js_parser::new_lazy_export_ast(bump, define, opts, log, root, source, b"")?
                        .ok_or(AnyError::ParserError)?,
                ));
            }
            Loader::Toml => {
                let _trace = perf::trace("Bundler.ParseTOML");
                let mut temp_log = Log::init();
                // `temp_log` must flush into `log` on the error path too.
                // scopeguard would alias `log`/`temp_log` (both borrowed mutably
                // below); reshape as a closure so every `?` exits through one
                // post-amble that flushes `temp_log`.
                let result = (|| -> core::result::Result<JSAst<'a>, AnyError> {
                    let root: Expr =
                        bun_parsers::toml::TOML::parse(source, &mut temp_log, bump, false)?;
                    Ok(JSAst::init(
                        js_parser::new_lazy_export_ast(
                            bump,
                            define,
                            opts,
                            &mut temp_log,
                            root,
                            source,
                            b"",
                        )?
                        .ok_or(AnyError::ParserError)?,
                    ))
                })();
                let _ = temp_log.clone_to_with_recycled(log, true);
                return result;
            }
            Loader::Yaml => {
                let _trace = perf::trace("Bundler.ParseYAML");
                let mut temp_log = Log::init();
                let result = (|| -> core::result::Result<JSAst<'a>, AnyError> {
                    let root: Expr = bun_parsers::yaml::YAML::parse(
                        source,
                        &mut temp_log,
                        bump,
                        bun_parsers::yaml::CyclicAliases::Reject,
                    )?;
                    Ok(JSAst::init(
                        js_parser::new_lazy_export_ast(
                            bump,
                            define,
                            opts,
                            &mut temp_log,
                            root,
                            source,
                            b"",
                        )?
                        .ok_or(AnyError::ParserError)?,
                    ))
                })();
                let _ = temp_log.clone_to_with_recycled(log, true);
                return result;
            }
            Loader::Json5 => {
                let _trace = perf::trace("Bundler.ParseJSON5");
                let mut temp_log = Log::init();
                let result = (|| -> core::result::Result<JSAst<'a>, AnyError> {
                    let root: Expr =
                        bun_parsers::json5::JSON5Parser::parse(source, &mut temp_log, bump)?;
                    Ok(JSAst::init(
                        js_parser::new_lazy_export_ast(
                            bump,
                            define,
                            opts,
                            &mut temp_log,
                            root,
                            source,
                            b"",
                        )?
                        .ok_or(AnyError::ParserError)?,
                    ))
                })();
                let _ = temp_log.clone_to_with_recycled(log, true);
                return result;
            }
            Loader::Xml => {
                let _trace = perf::trace("Bundler.ParseXML");
                let mut temp_log = Log::init();
                let result = (|| -> core::result::Result<JSAst<'a>, AnyError> {
                    bun_core::analytics::Features::xml_parse_inc();
                    let rows: Expr = bun_parsers::xml::XML::parse(
                        source,
                        &mut temp_log,
                        bump,
                        bun_parsers::xml::Options {
                            compact: true,
                            encoding: bun_parsers::xml::InputEncoding::File,
                        },
                    )?;
                    let root = bun_parsers::json::materialize(&rows, source, &mut temp_log, bump)?;
                    Ok(JSAst::init(
                        js_parser::new_lazy_export_ast(
                            bump,
                            define,
                            opts,
                            &mut temp_log,
                            root,
                            source,
                            b"",
                        )?
                        .ok_or(AnyError::ParserError)?,
                    ))
                })();
                let _ = temp_log.clone_to_with_recycled(log, true);
                return result;
            }
            Loader::Text => {
                // A standalone executable embeds the text as a string body the
                // runtime aliases without a copy (`encode_text_module`), so the
                // module becomes `export default require("<bunfs path>")`.
                // Browser chunks cannot reach the embedded graph.
                let root = if topts.compile_mode.is_executable() && topts.target.is_bun() {
                    require_embedded_asset(register_embedded_asset(
                        bump,
                        source,
                        unique_key_prefix,
                        unique_key_for_additional_file,
                    ))
                } else {
                    Expr::init(
                        E::String {
                            data: source.contents().into(),
                            ..Default::default()
                        },
                        Loc { start: 0 },
                    )
                };
                let mut ast = JSAst::init(
                    js_parser::new_lazy_export_ast(bump, define, opts, log, root, source, b"")?
                        .ok_or(AnyError::ParserError)?,
                );
                ast.add_url_for_css(
                    bump,
                    source,
                    Some(b"text/plain"),
                    None,
                    topts.compile_mode.is_standalone_html(),
                );
                return Ok(ast);
            }
            Loader::Md => {
                let html = match bun_md::root::render_to_html(&source.contents) {
                    Ok(h) => h,
                    Err(_) => {
                        let _ = log.add_error(
                            Some(source),
                            Loc::EMPTY,
                            b"Failed to render markdown to HTML",
                        ); // logger OOM-only
                        return Err(crate::Error::ParserError);
                    }
                };
                let html: &[u8] = bump.alloc_slice_copy(&html);
                let root = Expr::init(
                    E::String {
                        data: html.into(),
                        ..Default::default()
                    },
                    Loc { start: 0 },
                );
                let mut ast = JSAst::init(
                    js_parser::new_lazy_export_ast(bump, define, opts, log, root, source, b"")?
                        .ok_or(AnyError::ParserError)?,
                );
                ast.add_url_for_css(
                    bump,
                    source,
                    Some(b"text/html"),
                    None,
                    topts.compile_mode.is_standalone_html(),
                );
                return Ok(ast);
            }

            Loader::SqliteEmbedded | Loader::Sqlite => {
                if !topts.target.is_bun() {
                    // logger OOM-only
                    let _ = log.add_error(
                        Some(source),
                        Loc::EMPTY,
                        b"To use the \"sqlite\" loader, set target to \"bun\"",
                    );
                    return Err(crate::Error::ParserError);
                }

                let path_to_use: &[u8] = if loader == Loader::SqliteEmbedded {
                    register_embedded_asset(
                        bump,
                        source,
                        unique_key_prefix,
                        unique_key_for_additional_file,
                    )
                } else {
                    source.path.text
                };

                // This injects the following code:
                //
                // import.meta.require(unique_key).db
                //
                let import_path = Expr::init(
                    E::String {
                        data: path_to_use.into(),
                        ..Default::default()
                    },
                    Loc { start: 0 },
                );

                let import_meta = Expr::init(E::ImportMeta {}, Loc { start: 0 });
                let require_property = Expr::init(
                    E::Dot {
                        target: import_meta,
                        name_loc: Loc::EMPTY,
                        name: b"require".into(),
                        ..Default::default()
                    },
                    Loc { start: 0 },
                );
                let require_args = bump.alloc_slice_fill_default::<Expr>(2);
                require_args[0] = import_path;
                let object_property = G::Property {
                    key: Some(Expr::init(
                        E::String {
                            data: b"type".into(),
                            ..Default::default()
                        },
                        Loc { start: 0 },
                    )),
                    value: Some(Expr::init(
                        E::String {
                            data: b"sqlite".into(),
                            ..Default::default()
                        },
                        Loc { start: 0 },
                    )),
                    ..Default::default()
                };
                require_args[1] = Expr::init(
                    E::Object {
                        properties: G::PropertyList::from_owned_slice(Box::new([object_property])),
                        is_single_line: true,
                        ..Default::default()
                    },
                    Loc { start: 0 },
                );
                let require_call = Expr::init(
                    E::Call {
                        target: require_property,
                        args: bun_ast::ExprNodeList::from_arena_slice(require_args),
                        ..Default::default()
                    },
                    Loc { start: 0 },
                );

                let root = Expr::init(
                    E::Dot {
                        target: require_call,
                        name_loc: Loc::EMPTY,
                        name: b"db".into(),
                        ..Default::default()
                    },
                    Loc { start: 0 },
                );

                return Ok(JSAst::init(
                    js_parser::new_lazy_export_ast(bump, define, opts, log, root, source, b"")?
                        .ok_or(AnyError::ParserError)?,
                ));
            }
            Loader::Napi => {
                // (dap-eval-cb "source.contents.ptr")
                if topts.target == options::Target::Browser {
                    // logger OOM-only
                    let _ = log.add_error(
                    Some(source),
                    Loc::EMPTY,
                    b"Loading .node files won't work in the browser. Make sure to set target to \"bun\" or \"node\"",
                );
                    return Err(crate::Error::ParserError);
                }

                // This injects the following code:
                //
                // require(unique_key)
                //
                let root = require_embedded_asset(register_embedded_asset(
                    bump,
                    source,
                    unique_key_prefix,
                    unique_key_for_additional_file,
                ));
                return Ok(JSAst::init(
                    js_parser::new_lazy_export_ast(bump, define, opts, log, root, source, b"")?
                        .ok_or(AnyError::ParserError)?,
                ));
            }
            Loader::Html => {
                // scope the scanner so its `&mut log` / `&source`
                // borrows release before `new_lazy_export_ast` re-borrows them.
                let import_records = {
                    let mut scanner = HTMLScanner::init(log, source);
                    scanner.scan(&source.contents)?;
                    scanner.import_records
                };

                // Reuse existing code for creating the AST
                // because it handles the various Ref and other structs we
                // need in order to print code later.
                let import_records_len = import_records.len();
                let output_format = opts.output_format;
                let mut ast = js_parser::new_lazy_export_ast(
                    bump,
                    define,
                    opts,
                    log,
                    Expr::init(E::Missing {}, Loc::EMPTY),
                    source,
                    b"",
                )?
                .ok_or(AnyError::ParserError)?;
                ast.import_records = bun_alloc::vec_from_iter_in(import_records, bump);

                // We're banning import default of html loader files for now.
                //
                // TLDR: it kept including:
                //
                //   var name_default = ...;
                //
                // in the bundle because of the exports AST, and
                // gave up on figuring out how to fix it so that
                // this feature could ship.
                ast.has_lazy_export = false;
                // Liveness for this synthetic part is seeded in
                // `tree_shaking_and_code_splitting` (the per-part bitset
                // does not exist at parse time).
                ast.parts.as_mut_slice()[1] = Part {
                    stmts: ast::StoreSlice::EMPTY,
                    import_record_indices: {
                        // Generate a single part that depends on all the import records.
                        // This is to ensure that we generate a JavaScript bundle containing all the user's code.
                        let mut import_record_indices = ast::PartImportRecordIndices::init_capacity(
                            import_records_len as usize,
                        );
                        import_record_indices
                            .extend(0..u32::try_from(import_records_len).expect("int cast"));
                        import_record_indices
                    },
                    ..Default::default()
                };

                // Try to avoid generating unnecessary ESM <> CJS wrapper code.
                if output_format == js_parser::options::Format::Esm
                    || output_format == js_parser::options::Format::Iife
                {
                    ast.exports_kind = ast::ExportsKind::Esm;
                }

                return Ok(JSAst::init(ast));
            }
            Loader::Css => {
                // make css ast
                let mut import_records = Vec::<ImportRecord>::default();
                let source_code = &source.contents;
                let mut temp_log = Log::init();
                // `temp_log` is flushed into `log` on every exit path via linear
                // control flow (scopeguard would alias `log`/`temp_log`).

                const CSS_MODULE_SUFFIX: &[u8] = b".module.css";
                let enable_css_modules = source.path.pretty.len() > CSS_MODULE_SUFFIX.len()
                    && &source.path.pretty[source.path.pretty.len() - CSS_MODULE_SUFFIX.len()..]
                        == CSS_MODULE_SUFFIX;
                // `parse_bundler` takes `ParserOptions<'static>` (the
                // `'a` on `ParserOptions` is PhantomData-only; storage is a raw
                // `NonNull<Log>`). Construct via `default(None)` to get `'static`,
                // then poke the logger pointer in directly — `temp_log` outlives
                // all parsing/minification below.
                let parser_options = {
                    let mut parseropts = bun_css::ParserOptions::default(None);
                    parseropts.logger = Some(core::ptr::NonNull::from(&mut temp_log));
                    if enable_css_modules {
                        parseropts.filename = bun_paths::basename(source.path.pretty);
                        parseropts.css_modules = Some(bun_css::CssModuleConfig::default());
                    }
                    parseropts
                };

                let (mut css_ast, extra) = match bun_css::BundlerStyleSheet::parse_bundler(
                    bump,
                    source_code,
                    parser_options,
                    &mut import_records,
                    bun_ast::Index::source(source.index.0),
                ) {
                    Ok(v) => v,
                    Err(e) => {
                        // Surface the actual CSS parse diagnostic.
                        let _ = e.add_to_logger(&mut temp_log, source);
                        let _ = temp_log.append_to_maybe_recycled(log, source);
                        return Err(crate::Error::SyntaxError);
                    }
                };
                // Make sure the css modules local refs have a valid tag
                #[cfg(debug_assertions)]
                if css_ast.local_scope.count() > 0 {
                    for entry in css_ast.local_scope.values() {
                        debug_assert!(entry.ref_.inner_index() < extra.symbols.len() as u32);
                    }
                }
                if let Err(e) = css_ast.minify(
                    bump,
                    &bun_css::MinifyOptions {
                        targets: bun_css::Targets::for_bundler_target(topts.target),
                        unused_symbols: Default::default(),
                    },
                    &extra,
                ) {
                    // Surface the actual minify diagnostic.
                    let _ = e.add_to_logger(&mut temp_log, source);
                    let _ = temp_log.append_to_maybe_recycled(log, source);
                    return Err(crate::Error::MinifyError);
                }
                if css_ast.local_scope.count() > 0 {
                    let _ = has_any_css_locals.fetch_add(1, Ordering::Relaxed);
                }
                // If this is a css module, the final exports object wil be set in `generateCodeForLazyExport`.
                let root = Expr::init(E::Object::default(), Loc { start: 0 });
                // `StylesheetExtra.symbols` is
                // `Vec<bun_ast::Symbol>`; `new_lazy_export_ast_impl` takes
                // `Vec<bun_ast::Symbol>`. Convert field-by-field so CSS-module local refs
                // index a populated symbol table.
                let symbols = css_symbols_to_parser_symbols(&extra.symbols, bump);
                // `temp_log` flushes into `log` on EVERY exit; match explicitly
                // so accumulated CSS-module diagnostics are
                // not dropped on the error path.
                let lazy = js_parser::new_lazy_export_ast_impl(
                    bump,
                    define,
                    opts,
                    &mut temp_log,
                    root,
                    source,
                    b"",
                    symbols,
                );
                let _ = temp_log.append_to_maybe_recycled(log, source);
                let mut ast = JSAst::init(lazy?.ok_or(AnyError::ParserError)?);
                let css_ast_heap = crate::bundled_ast::CssAstRef::from_bump(bump.alloc(css_ast));
                ast.css = Some(css_ast_heap);
                ast.import_records = bun_alloc::vec_from_iter_in(import_records, bump);
                return Ok(ast);
            }
            // TODO:
            Loader::Dataurl | Loader::Base64 | Loader::Bunsh => {
                return get_empty_ast::<E::String>(log, define, opts, bump, source);
            }
            Loader::File | Loader::Wasm => {
                debug_assert!(loader.should_copy_for_bundling());

                // Put a unique key in the AST to implement the URL loader. At the end
                // of the bundle, the key is replaced with the actual URL.
                let content_hash = ContentHasher::run(&source.contents);

                let unique_key: &[u8] = if topts.has_dev_server() {
                    // With DevServer, the actual URL is added now, since it can be
                    // known this far ahead of time, and it means the unique key code
                    // does not have to perform an additional pass over files.
                    //
                    // To avoid a mutex, the actual insertion of the asset to DevServer
                    // is done on the bundler thread.
                    let mut buf = bun_alloc::ArenaString::new_in(bump);
                    write!(
                        &mut buf,
                        "{}/{}{}",
                        crate::bake_types::ASSET_PREFIX,
                        bun_core::fmt::bytes_to_hex_lower_string(&content_hash.to_ne_bytes()),
                        bstr::BStr::new(bun_paths::extension(source.path.text)),
                    )
                    .expect("unreachable");
                    buf.into_bump_str().as_bytes()
                } else {
                    let mut buf = bun_alloc::ArenaString::new_in(bump);
                    write!(
                        &mut buf,
                        "{}",
                        crate::chunk::UniqueKey {
                            prefix: unique_key_prefix,
                            kind: crate::chunk::QueryKind::Asset,
                            index: source.index.0,
                        },
                    )
                    .expect("unreachable");
                    buf.into_bump_str().as_bytes()
                };
                let root = Expr::init(
                    E::String {
                        data: unique_key.into(),
                        ..Default::default()
                    },
                    Loc { start: 0 },
                );
                *unique_key_for_additional_file = FileLoaderHash {
                    key: ast::StoreStr::new(unique_key),
                    content_hash,
                };
                let mut ast = JSAst::init(
                    js_parser::new_lazy_export_ast(bump, define, opts, log, root, source, b"")?
                        .ok_or(AnyError::ParserError)?,
                );
                ast.add_url_for_css(
                    bump,
                    source,
                    None,
                    Some(unique_key),
                    topts.compile_mode.is_standalone_html(),
                );
                return Ok(ast);
            }
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // getCodeForParseTaskWithoutPlugins
    // ───────────────────────────────────────────────────────────────────────────

    fn get_code_for_parse_task_without_plugins(
        task: &mut ParseTask<'_>,
        log: &mut Log,
        fs_cache: &mut bun_resolver::cache::Fs,
        framework: Option<&crate::bake_types::Framework>,
        bump: &Bump,
        file_path: &mut Fs::Path,
        _loader: Loader,
    ) -> core::result::Result<CacheEntry, AnyError> {
        match &task.contents_or_fd {
            ContentsOrFd::Fd { dir, file } => 'brk: {
                let contents_dir = *dir;
                let contents_file = *file;
                let _trace = perf::trace("Bundler.readFile");

                let ctx = task.ctx();

                // Check FileMap for in-memory files first
                if let Some(file_map) = ctx.file_map {
                    if let Some(file_contents) = file_map.get(file_path.text) {
                        break 'brk Ok(CacheEntry {
                            contents: crate::cache::Contents::SharedBuffer {
                                ptr: file_contents.as_ptr(),
                                len: file_contents.len(),
                            },
                            fd: Fd::INVALID,
                            ..Default::default()
                        });
                    }
                }

                if file_path.namespace == b"node" {
                    'lookup_builtin: {
                        if let Some(f) = framework {
                            if let Some(file) = f.built_in_modules.get(file_path.text) {
                                match file {
                                    crate::bake_types::BuiltInModule::Code(code) => {
                                        break 'brk Ok(CacheEntry {
                                            contents: crate::cache::Contents::SharedBuffer {
                                                ptr: code.as_ptr(),
                                                len: code.len(),
                                            },
                                            fd: Fd::INVALID,
                                            ..Default::default()
                                        });
                                    }
                                    crate::bake_types::BuiltInModule::Import(path) => {
                                        // The framework (an `Arc` the bundle's
                                        // owner also holds) outlives the graph.
                                        *file_path =
                                            Fs::Path::init(ast::StoreStr::new(path).slice());
                                        break 'lookup_builtin;
                                    }
                                }
                            }
                        }

                        let fallback =
                            NodeFallbackModules::contents_from_path(file_path.text).unwrap_or(b"");
                        break 'brk Ok(CacheEntry {
                            contents: crate::cache::Contents::SharedBuffer {
                                ptr: fallback.as_ptr(),
                                len: fallback.len(),
                            },
                            fd: Fd::INVALID,
                            ..Default::default()
                        });
                    }
                }

                // Always read into the worker arena: it is pinned for the
                // entire bundle pass (freed only via `pool.deinit()` inside
                // `deinit_without_freeing_arena`, after `process_files_to_copy`
                // has already deep-copied every additional-file body into its
                // `OutputFile`). This avoids churning the global allocator with
                // one `Vec<u8>` per file.
                let read_arena: Option<&Bump> = Some(bump);
                break 'brk match fs_cache.read_file_with_allocator(
                    Fs::FileSystem::instance(),
                    file_path.text,
                    contents_dir,
                    false,
                    contents_file.unwrap_valid(),
                    read_arena,
                ) {
                    Ok(e) => {
                        // `bun_resolver::cache::Entry` ↔ `crate::cache::Entry`
                        // are structurally identical twins; convert
                        // by-variant so ownership of `Owned(Vec<u8>)` transfers.
                        use bun_resolver::cache::Contents as RC;
                        let contents = match e.contents {
                            RC::Empty => crate::cache::Contents::Empty,
                            RC::Owned(v) => crate::cache::Contents::Owned(v),
                            RC::Arena { ptr, len } => crate::cache::Contents::Arena { ptr, len },
                            RC::SharedBuffer { ptr, len } => {
                                crate::cache::Contents::SharedBuffer { ptr, len }
                            }
                            RC::External { ptr, len } => {
                                crate::cache::Contents::External { ptr, len }
                            }
                        };
                        Ok(CacheEntry {
                            contents,
                            fd: e.fd,
                            ..Default::default()
                        })
                    }
                    Err(e) => {
                        let source = Source::init_empty_file(
                            // `file_path.text`
                            // borrows either the process-lifetime DirnameStore
                            // pool (resolver paths) or, after the
                            // `BuiltInModule::Import` reassignment above, the
                            // framework-owned `built_in_modules` storage held by
                            // the BundleV2 — both outlive the log's consumption.
                            file_path.text,
                        );
                        if e == bun_resolver::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                            let _ = log.add_error_fmt(
                                Some(&source),
                                Loc::EMPTY,
                                format_args!(
                                    "File not found {}",
                                    bun_core::fmt::quote(file_path.text)
                                ),
                            );
                            return Err(crate::Error::Sys(bun_errno::SystemErrno::ENOENT));
                        } else {
                            let _ = log.add_error_fmt(
                                Some(&source),
                                Loc::EMPTY,
                                format_args!(
                                    "{} reading file: {}",
                                    e.name(),
                                    bun_core::fmt::quote(file_path.text)
                                ),
                            );
                        }
                        return Err(e.into());
                    }
                };
            }
            ContentsOrFd::Contents(contents) => Ok(CacheEntry {
                contents: crate::cache::Contents::SharedBuffer {
                    ptr: contents.as_ptr(),
                    len: contents.len(),
                },
                fd: Fd::INVALID,
                ..Default::default()
            }),
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // getCodeForParseTask
    // ───────────────────────────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    fn get_code_for_parse_task<'f>(
        task: &mut ParseTask<'_>,
        log: &mut Log,
        fs_cache: &mut bun_resolver::cache::Fs,
        framework: Option<&'f crate::bake_types::Framework>,
        bump: &Bump,
        file_path: &mut Fs::Path<'static>,
        loader: &mut Loader,
        from_plugin: &mut bool,
    ) -> core::result::Result<CacheEntry, AnyError> {
        let ctx = task.ctx();
        let might_have_on_parse_plugins = 'brk: {
            if task.source_index.is_runtime() {
                break 'brk false;
            }
            let Some(plugin) = ctx.plugins() else {
                break 'brk false;
            };
            if !plugin.has_on_before_parse_plugins() {
                break 'brk false;
            }

            if file_path.namespace == b"node" {
                break 'brk false;
            }
            true
        };

        if !might_have_on_parse_plugins {
            return get_code_for_parse_task_without_plugins(
                task, log, fs_cache, framework, bump, file_path, *loader,
            );
        }

        let state = OnBeforeParsePlugin {
            task,
            log,
            fs_cache,
            framework,
            bump,
            file_path,
            loader,
            deferred_error: None,
            original_contents: None,
        };

        let plugins = ctx.plugins().expect("unreachable");
        state.run(plugins, from_plugin)
    }

    // ───────────────────────────────────────────────────────────────────────────
    // OnBeforeParsePlugin
    // ───────────────────────────────────────────────────────────────────────────

    /// The bundler's side of one `onBeforeParse` native-plugin round: the
    /// plugins reach it through [`OnBeforeParseArguments::context`].
    pub struct OnBeforeParsePlugin<'a, 't> {
        task: &'a mut ParseTask<'t>,
        log: &'a mut Log,
        fs_cache: &'a mut bun_resolver::cache::Fs,
        framework: Option<&'a crate::bake_types::Framework>,
        bump: &'a Bump,
        file_path: &'a mut Fs::Path<'static>,
        loader: &'a mut Loader,
        deferred_error: Option<AnyError>,
        // Owns the `Contents` fetched by `fetch_source_code` so the buffer the
        // native plugin reads through `wrapper.original_source` stays alive for
        // the duration of `run`. Returned to the caller when the plugin keeps
        // the original source, dropped otherwise.
        original_contents: Option<crate::cache::Contents>,
    }

    /// `OnBeforeParseArguments` in `bundler_plugin.h`. `context` is opaque to
    /// plugins; they hand the struct back to [`fetch_source_code`] /
    /// [`BunLogOptions::log_fn`].
    #[repr(C)]
    pub struct OnBeforeParseArguments<'s, 'a, 't> {
        pub(crate) struct_size: usize,
        pub(crate) context: Option<&'s mut OnBeforeParsePlugin<'a, 't>>,
        pub(crate) path_ptr: *const u8,
        pub(crate) path_len: usize,
        pub(crate) namespace_ptr: *const u8,
        pub(crate) namespace_len: usize,
        pub(crate) default_loader: Loader,
        pub(crate) external: *mut c_void, // FFI (LIFETIMES.tsv)
    }

    /// `BunLogOptions` in `bundler_plugin.h`; filled in by the plugin.
    #[repr(C)]
    pub struct BunLogOptions<'p> {
        pub(crate) struct_size: usize,
        pub(crate) message: bun_core::ffi::FfiSlice<'p>,
        pub(crate) path: bun_core::ffi::FfiSlice<'p>,
        pub(crate) source_line_text: bun_core::ffi::FfiSlice<'p>,
        pub(crate) level: bun_ast::Level,
        // Field order matches `packages/bun-native-bundler-plugin-api/bundler_plugin.h`
        // `BunLogOptions` (`line, lineEnd, column, columnEnd`) — verified by the
        // `assert_ffi_layout!` offset checks below.
        pub(crate) line: i32,
        pub(crate) line_end: i32,
        pub(crate) column: i32,
        pub(crate) column_end: i32,
    }

    // These structs are passed by-pointer to **third-party** native plugins via
    // `packages/bun-native-bundler-plugin-api/bundler_plugin.h`, so layout drift
    // is a silent ABI break for every plugin in the wild. Literals are the 64-bit
    // C layout from `bundler_plugin.h`.
    bun_core::assert_ffi_layout!(
        OnBeforeParseArguments<'_, '_, '_>, 64, 8;
        struct_size @ 0, context @ 8, path_ptr @ 16, path_len @ 24,
        namespace_ptr @ 32, namespace_len @ 40, default_loader @ 48, external @ 56,
    );
    bun_core::assert_ffi_layout!(
        BunLogOptions<'_>, 80, 8;
        struct_size @ 0, message @ 8, path @ 24, source_line_text @ 40,
        level @ 56, line @ 60, line_end @ 64, column @ 68, column_end @ 72,
    );
    bun_core::assert_ffi_layout!(
        OnBeforeParseResult, 64, 8;
        struct_size @ 0, source_ptr @ 8, source_len @ 16, loader @ 24,
        fetch_source_code_fn @ 32, external @ 40, log @ 56,
    );
    const _: () = assert!(core::mem::offset_of!(OnBeforeParseResultWrapper, result) == 0);

    impl BunLogOptions<'_> {
        fn append(&self, log: &mut Log, namespace: &'static [u8]) {
            // `Location.{file,line_text}`
            // are `&'static [u8]` here; `Log::dupe` copies into Log-owned storage
            // (freed when the Log drops) and returns a lifetime-erased borrow —
            // the "alloc-dupe into the log arena" pattern. We dupe `path` too:
            // a raw slice into C-plugin memory may be
            // freed after `log_fn` returns, so duping is required.
            let source_line_text = self.source_line_text.as_slice();
            let file = log.dupe(self.path.as_slice());
            let line_text = if !source_line_text.is_empty() {
                Some(log.dupe(source_line_text))
            } else {
                None
            };
            let location = Location::init(
                file,
                namespace,
                self.line.max(-1),
                self.column.max(-1),
                (self.column_end - self.column).max(0) as u32,
                line_text,
            );
            let mut msg = Msg {
                data: bun_ast::Data {
                    location: Some(location),
                    text: std::borrow::Cow::Owned(self.message.as_slice().to_vec()),
                    ..Default::default()
                },
                ..Default::default()
            };
            match self.level {
                bun_ast::Level::Err => msg.kind = bun_ast::Kind::Err,
                bun_ast::Level::Warn => msg.kind = bun_ast::Kind::Warn,
                bun_ast::Level::Verbose => msg.kind = bun_ast::Kind::Verbose,
                bun_ast::Level::Debug => msg.kind = bun_ast::Kind::Debug,
                _ => {}
            }
            if msg.kind == bun_ast::Kind::Err {
                log.errors += 1;
            } else if msg.kind == bun_ast::Kind::Warn {
                log.warnings += 1;
            }
            let _ = log.add_msg(msg);
        }

        /// `BunLogOptions::log` in `bundler_plugin.h`: the plugin logs a message.
        extern "C" fn log_fn(
            args: Option<&mut OnBeforeParseArguments<'_, '_, '_>>,
            log_options: Option<&BunLogOptions<'_>>,
        ) {
            let (Some(args), Some(log_options)) = (args, log_options) else {
                return;
            };
            let Some(ctx) = args.context.as_deref_mut() else {
                return;
            };
            log_options.append(ctx.log, ctx.file_path.namespace);
        }
    }

    /// What plugins (and `JSBundlerPlugin.cpp`) hold as `OnBeforeParseResult*`
    /// — and as the opaque bun context — is this whole struct: `result` sits
    /// at offset 0.
    #[repr(C)]
    pub struct OnBeforeParseResultWrapper {
        pub result: OnBeforeParseResult,
        pub original_source: *const u8,
        pub original_source_len: usize,
        pub original_source_fd: Fd,
        pub loader: Loader,
        /// `JSBundlerPlugin.cpp` reads this through the `int*` it is handed;
        /// [`fetch_source_code`] clears it to stop the plugin chain.
        pub should_continue_running: core::cell::Cell<i32>,
    }

    #[repr(C)]
    pub struct OnBeforeParseResult {
        pub(crate) struct_size: usize,
        pub(crate) source_ptr: *const u8,
        pub(crate) source_len: usize,
        pub(crate) loader: Loader,

        pub(crate) fetch_source_code_fn: for<'s, 'a, 't> extern "C" fn(
            Option<&mut OnBeforeParseArguments<'s, 'a, 't>>,
            Option<&mut OnBeforeParseResultWrapper>,
        ) -> i32,

        /// `plugin_source_code_context` + `free_plugin_source_code_context`.
        pub(crate) external: ExternalFreeFunction,

        pub(crate) log: for<'s, 'a, 't, 'b, 'p> extern "C" fn(
            Option<&mut OnBeforeParseArguments<'s, 'a, 't>>,
            Option<&BunLogOptions<'p>>,
        ),
    }

    /// `OnBeforeParseResult::fetchSourceCode` in `bundler_plugin.h`: the plugin
    /// asks for the file's original source.
    extern "C" fn fetch_source_code(
        args: Option<&mut OnBeforeParseArguments<'_, '_, '_>>,
        wrapper: Option<&mut OnBeforeParseResultWrapper>,
    ) -> i32 {
        scoped_log!(ParseTask, "fetchSourceCode");
        let (Some(args), Some(wrapper)) = (args, wrapper) else {
            return 1;
        };
        let Some(this) = args.context.as_deref_mut() else {
            return 1;
        };
        if this.log.errors > 0
            || this.deferred_error.is_some()
            || wrapper.should_continue_running.get() != 1
        {
            return 1;
        }

        if !wrapper.result.source_ptr.is_null() {
            return 0;
        }

        let mut entry = match get_code_for_parse_task_without_plugins(
            this.task,
            this.log,
            this.fs_cache,
            this.framework,
            this.bump,
            this.file_path,
            wrapper.result.loader,
        ) {
            Ok(e) => e,
            Err(e) => {
                this.deferred_error = Some(e);
                wrapper.should_continue_running.set(0);
                return 1;
            }
        };
        // `Contents::Owned(Vec<u8>)` (the file-read path) frees on drop, which
        // would leave `result.source_ptr` / `wrapper.original_source` dangling
        // for the native plugin and `OnBeforeParsePlugin::run` to read through.
        // Stash ownership on `this.original_contents` so the bytes outlive
        // the wrapper; `OnBeforeParsePlugin::run` returns it when the
        // plugin keeps the original source, or drops it when the plugin
        // replaces the source.
        let fd = entry.fd;
        let contents_slice = this
            .original_contents
            .insert(core::mem::take(&mut entry.contents))
            .as_slice();
        let source_ptr = contents_slice.as_ptr();
        let source_len = contents_slice.len();
        wrapper.result.source_ptr = source_ptr;
        wrapper.result.source_len = source_len;
        wrapper.result.external = ExternalFreeFunction::NONE;
        wrapper.original_source = source_ptr;
        wrapper.original_source_len = source_len;
        wrapper.original_source_fd = fd;
        0
    }

    /// `JSBundlerPlugin.cpp`, between plugins in the chain; `result` is the
    /// `OnBeforeParseResult*` it was handed, i.e. the wrapper (offset 0).
    #[unsafe(no_mangle)]
    extern "C" fn OnBeforeParseResult__reset(result: Option<&mut OnBeforeParseResultWrapper>) {
        if let Some(wrapper) = result {
            wrapper.reset();
        }
    }

    /// `JSBundlerPlugin.cpp`, after each plugin; `context` is the opaque bun
    /// context it was handed, i.e. the wrapper.
    #[unsafe(no_mangle)]
    extern "C" fn OnBeforeParsePlugin__isDone(context: Option<&OnBeforeParseResultWrapper>) -> i32 {
        context.map_or(1, OnBeforeParseResultWrapper::is_done)
    }

    impl OnBeforeParseResultWrapper {
        /// `OnBeforeParseResult__reset` (`JSBundlerPlugin.cpp`): reset the
        /// result between plugins in the chain.
        pub fn reset(&mut self) {
            self.result.loader = self.loader;
            if !self.original_source.is_null() {
                self.result.source_ptr = self.original_source;
                self.result.source_len = self.original_source_len;
            } else {
                self.result.source_ptr = core::ptr::null();
                self.result.source_len = 0;
            }
        }

        /// `OnBeforeParsePlugin__isDone` (`JSBundlerPlugin.cpp`): whether the
        /// plugin chain can stop. Its opaque bun context is this wrapper.
        pub fn is_done(&self) -> i32 {
            if self.should_continue_running.get() != 1 {
                return 1;
            }
            // The first plugin to set the source wins.
            // But, we must check that they actually modified it
            // since fetching the source stores it inside `result.source_ptr`
            let source_ptr = self.result.source_ptr;
            if !source_ptr.is_null() {
                return (source_ptr != self.original_source) as i32;
            }
            0
        }
    }

    impl OnBeforeParsePlugin<'_, '_> {
        pub(crate) fn run(
            mut self,
            plugin: &bundler::JSBundlerPlugin,
            from_plugin: &mut bool,
        ) -> core::result::Result<CacheEntry, AnyError> {
            let mut wrapper = OnBeforeParseResultWrapper {
                original_source: core::ptr::null(),
                original_source_len: 0,
                original_source_fd: Fd::INVALID,
                loader: *self.loader,
                should_continue_running: core::cell::Cell::new(1),
                result: OnBeforeParseResult {
                    struct_size: core::mem::size_of::<OnBeforeParseResult>(),
                    source_ptr: core::ptr::null(),
                    source_len: 0,
                    loader: *self.loader,
                    fetch_source_code_fn: fetch_source_code,
                    external: ExternalFreeFunction::NONE,
                    log: BunLogOptions::log_fn,
                },
            };
            let namespace_str;
            let namespace = if self.file_path.namespace == b"file" {
                &bun_core::String::EMPTY
            } else {
                namespace_str = bun_core::String::from_bytes(self.file_path.namespace);
                &namespace_str
            };
            let path_str = bun_core::String::from_bytes(self.file_path.text);
            let path_text: &'static [u8] = self.file_path.text;
            let path_namespace: &'static [u8] = self.file_path.namespace;
            let mut args = OnBeforeParseArguments {
                struct_size: core::mem::size_of::<OnBeforeParseArguments>(),
                path_ptr: path_text.as_ptr(),
                path_len: path_text.len(),
                namespace_ptr: b"file".as_ptr(),
                namespace_len: b"file".len(),
                default_loader: *self.loader,
                external: core::ptr::null_mut(),
                // The callbacks reach `self` only through here while the
                // plugins run.
                context: Some(&mut self),
            };
            if !path_namespace.is_empty() {
                args.namespace_ptr = path_namespace.as_ptr();
                args.namespace_len = path_namespace.len();
            }
            // One pointer to `wrapper` for everything C touches: the result,
            // the opaque context `OnBeforeParsePlugin__isDone` gets back, and
            // `should_continue_running`.
            let wrapper_ptr: *mut OnBeforeParseResultWrapper = &raw mut wrapper;
            let count = plugin.call_on_before_parse_plugins(
                wrapper_ptr.cast(),
                namespace,
                &path_str,
                (&raw mut args).cast(),
                wrapper_ptr.cast(),
                wrapper_ptr
                    .wrapping_byte_add(core::mem::offset_of!(
                        OnBeforeParseResultWrapper,
                        should_continue_running
                    ))
                    .cast(),
            );
            let OnBeforeParseArguments { context, .. } = args;
            let this = context.expect("set above");
            if count > 0 {
                if let Some(e) = this.deferred_error {
                    wrapper.result.external.call();
                    return Err(e);
                }

                // If the plugin sets the `free_user_context` function pointer, it _must_ set the `user_context` pointer.
                // Otherwise this is just invalid behavior.
                if wrapper.result.external.is_missing_ctx() {
                    let mut msg = Msg {
                    data: bun_ast::Data {
                        location: None,
                        text: std::borrow::Cow::Borrowed(
                            &b"Native plugin set the `free_plugin_source_code_context` field without setting the `plugin_source_code_context` field."[..],
                        ),
                        ..Default::default()
                    },
                    ..Default::default()
                };
                    msg.kind = bun_ast::Kind::Err;
                    this.log.errors += 1;
                    let _ = this.log.add_msg(msg); // logger OOM-only
                    return Err(crate::Error::InvalidNativePlugin);
                }

                if this.log.errors > 0 {
                    wrapper.result.external.call();
                    return Err(crate::Error::SyntaxError);
                }

                if !wrapper.result.source_ptr.is_null() {
                    let ptr = wrapper.result.source_ptr;
                    if wrapper.result.external.is_some() {
                        this.task.external_free_function =
                            core::mem::take(&mut wrapper.result.external);
                    }
                    *from_plugin = true;
                    *this.loader = wrapper.result.loader;
                    // If the plugin called `fetch_source_code` and left the
                    // source unchanged, hand the original `Contents` back to
                    // the caller so the buffer is reclaimed instead of leaked.
                    // Otherwise the plugin replaced the source; the original
                    // (if any) drops with `self`.
                    let contents =
                        if !wrapper.original_source.is_null() && ptr == wrapper.original_source {
                            this.original_contents
                                .take()
                                .expect("original_contents set alongside original_source")
                        } else {
                            crate::cache::Contents::External {
                                ptr,
                                len: wrapper.result.source_len,
                            }
                        };
                    // The plugin buffer has exactly one owner:
                    // `self.task.external_free_function` (set above),
                    // released via `BundleV2.finalizers`.
                    return Ok(CacheEntry {
                        contents,
                        fd: wrapper.original_source_fd,
                    });
                }
            }

            get_code_for_parse_task_without_plugins(
                this.task,
                this.log,
                this.fs_cache,
                this.framework,
                this.bump,
                this.file_path,
                *this.loader,
            )
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // getSourceCode
    // ───────────────────────────────────────────────────────────────────────────

    /// The read stage: runs on an IO-pool thread (`reader` is an
    /// [`IoReader`](crate::thread_pool::IoReader)) or on the parse worker.
    fn get_source_code<'a>(
        task: &mut ParseTask<'a>,
        bump: &'a Bump,
        fs_cache: &mut bun_resolver::cache::Fs,
        options: &crate::options::BundleOptions<'a>,
        log: &mut Log,
    ) -> core::result::Result<CacheEntry, AnyError> {
        let mut file_path = task.path;
        let mut loader = task
            .loader
            .or_else(|| file_path.loader(&options.loaders))
            .unwrap_or(Loader::File);

        let mut contents_came_from_plugin: bool = false;
        get_code_for_parse_task(
            task,
            log,
            fs_cache,
            options.framework.as_deref(),
            bump,
            &mut file_path,
            &mut loader,
            &mut contents_came_from_plugin,
        )
    }

    // ───────────────────────────────────────────────────────────────────────────
    // runWithSourceCode
    // ───────────────────────────────────────────────────────────────────────────

    fn run_with_source_code<'a>(
        task: &mut ParseTask<'a>,
        this: &mut crate::thread_pool::WorkerGuard<'_, 'a>,
        step: &mut Step,
        log: &mut Log,
        entry: &mut CacheEntry,
    ) -> core::result::Result<Success<'a>, AnyError> {
        let bump: &'a Bump = this.arena();
        let ctx = task.ctx();
        let worker_ctx: &ParseShared<'a> = &ctx;

        // The transpiler for `task.known_target` supplies the resolver (and the
        // options up to the server-components switch below); the browser
        // transpiler, when the file turns out to be client-side, supplies the
        // options and macro context for the parse itself.
        let (primary_define, client_define) = (this.define, this.client_define);
        let crate::thread_pool::TargetTranspilers {
            primary,
            browser,
            primary_is_client,
        } = this.transpilers_for_target(task.known_target);
        let Transpiler {
            options: primary_options,
            resolver,
            macro_context: primary_macro_context,
            ..
        } = primary;
        let (mut topts, mut macro_context) = (primary_options, primary_macro_context);
        let mut parse_config: &'a crate::thread_pool::ParseConfig = if primary_is_client {
            client_define.expect("client transpiler exists for browser files")
        } else {
            primary_define
        };
        let file_path = &mut task.path;
        let loader = task
            .loader
            .or_else(|| file_path.loader(&topts.loaders))
            .unwrap_or(Loader::File);

        // WARNING: Do not change the variant of `task.contents_or_fd` from
        // `.fd` to `.contents` (or back) after this point!
        //
        // When `task.contents_or_fd == .fd`, `entry.contents` is an owned string.
        // When `task.contents_or_fd == .contents`, `entry.contents` is NOT owned! Freeing it here will cause a double free!
        //
        // Changing from `.contents` to `.fd` will cause a double free.
        // This was the case in the situation where the ParseTask receives its `.contents` from an onLoad plugin, which caused it to be
        // allocated by `bun.default_allocator` and then freed in `BundleV2.deinit` (and also by `entry.deinit(arena)` below).
        #[cfg(debug_assertions)]
        let debug_original_variant_check: ContentsOrFdTag = task.contents_or_fd.tag();

        // Only close a descriptor this task opened. A valid `file` was borrowed
        // from the resolver's entry cache (symlink-resolved files cache their fd
        // there); closing it leaves a stale fd for the next in-process build.
        let opened_own_fd =
            matches!(task.contents_or_fd, ContentsOrFd::Fd { file, .. } if !file.is_valid());
        let will_close_file_descriptor = opened_own_fd
            && entry.fd.is_valid()
            && entry.fd.stdio_tag().is_none()
            && !worker_ctx.is_watching;
        if will_close_file_descriptor {
            let _ = entry.close_fd();
            task.contents_or_fd = ContentsOrFd::Fd {
                file: Fd::INVALID,
                dir: Fd::INVALID,
            };
        } else if matches!(task.contents_or_fd, ContentsOrFd::Fd { .. }) {
            task.contents_or_fd = ContentsOrFd::Fd {
                file: entry.fd,
                dir: Fd::INVALID,
            };
        }
        *step = Step::Parse;

        let entry_contents: &[u8] = entry.contents.as_slice();
        let is_empty = strings::is_all_whitespace(entry_contents);

        let use_directive: UseDirective = if !is_empty && topts.server_components {
            UseDirective::parse(entry_contents).unwrap_or(UseDirective::None)
        } else {
            UseDirective::None
        };

        if (use_directive == UseDirective::Client
        && task.known_target != options::Target::ServerComponentsSsr
        && topts
            .framework
            .as_ref()
            .and_then(|fw| fw.server_components.as_ref())
            .is_some_and(|sc| sc.separate_ssr_graph))
        ||
        // set the target to the client when bundling client-side files
        ((topts.server_components || topts.has_dev_server())
            && task.known_target == options::Target::Browser)
        {
            // separate_ssr_graph makes boundaries switch to client because the server file uses that generated file as input.
            // this is not done when there is one server graph because it is easier for plugins to deal with.
            if let Some(browser) = browser.into_transpiler() {
                topts = &mut browser.options;
                macro_context = &mut browser.macro_context;
                parse_config = client_define.expect("client transpiler exists for browser files");
            }
        }

        // Allocated in the worker arena so `js_parser::new_lazy_export_ast`'s
        // `&'bump Source` parameter is satisfied (`bump` is the same arena).
        let source: &'a Source = bump.alloc(Source {
            // `Source.path` is `bun_paths::fs::Path<'static>`, distinct from
            // `bun_resolver::fs::Path` (TYPE_ONLY mirror). Construct
            // field-by-field across the type boundary.
            path: bun_paths::fs::Path {
                text: file_path.text,
                namespace: file_path.namespace,
                pretty: file_path.pretty,
                is_disabled: file_path.is_disabled,
                is_symlink: file_path.is_symlink,
            },
            index: bun_ast::Index(task.source_index.get()),
            // `entry.contents` is owned by `task.stage` (written back by
            // the caller after parse — see `ParseTask::run`). `Source` is stored in
            // `Success` which lives no longer than the `ParseTask` itself, so this
            // borrow is sound. Routed through the audited `StoreStr` arena-erasure
            // path (single `from_raw_parts` in `StoreStr::slice`); replace with
            // `Source<'arena>` once that lifetime is threaded through `Success`/Graph.
            contents: std::borrow::Cow::Borrowed(ast::StoreStr::new(entry_contents).slice()),
            contents_is_recycled: false,
            ..Default::default()
        });

        let target = (if task.source_index.get() == 1 {
            target_from_hashbang(entry_contents)
        } else {
            None
        })
        .unwrap_or_else(|| {
            if task.known_target == options::Target::ServerComponentsSsr
                && topts
                    .framework
                    .as_ref()
                    .unwrap()
                    .server_components
                    .as_ref()
                    .unwrap()
                    .separate_ssr_graph
            {
                options::Target::ServerComponentsSsr
            } else {
                topts.target
            }
        });

        let output_format = topts.output_format;

        // D042: `crate::options::jsx::Pragma` IS `bun_js_parser::options::JSX::Pragma`
        // (both re-export `bun_options_types::jsx::Pragma`). `to_parser_jsx_pragma`
        // applies the `_None → Automatic` runtime fold the old `From` bridge did so
        // parser-side `== Automatic` checks keep their semantics.
        let mut opts = ParserOptions::init(
            crate::transpiler::to_parser_jsx_pragma(task.jsx.clone()),
            loader,
        );
        opts.bundle = true;
        opts.warn_about_unbundled_modules = false;
        // `wire_after_move` set the macro context before any ParseTask ran.
        opts.macro_context = Some(macro_context.as_ref().unwrap().handle());
        opts.package_version = task.package_version.slice();

        opts.features.allow_runtime = !task.source_index.is_runtime();
        opts.features.unwrap_commonjs_to_esm =
            output_format == options::Format::Esm && FeatureFlags::UNWRAP_COMMONJS_TO_ESM;
        opts.features.top_level_await = output_format == options::Format::Esm
            || output_format == options::Format::InternalBakeDev;
        opts.features.auto_import_jsx = task.jsx.parse && topts.auto_import_jsx;
        opts.features.trim_unused_imports =
            loader.is_typescript() || topts.trim_unused_imports.unwrap_or(false);
        opts.features.inlining = topts.minify_syntax;
        // `bun_options_types::Format` and `bun_js_parser::options::Format` are
        // distinct enums; map explicitly.
        opts.output_format = match output_format {
            options::Format::Esm => js_parser::options::Format::Esm,
            options::Format::Cjs => js_parser::options::Format::Cjs,
            options::Format::Iife => js_parser::options::Format::Iife,
            options::Format::InternalBakeDev => js_parser::options::Format::InternalBakeDev,
        };
        opts.features.minify_syntax = topts.minify_syntax;
        opts.features.minify_identifiers = topts.minify_identifiers;
        opts.features.minify_keep_names = topts.keep_names;
        opts.features.minify_whitespace = topts.minify_whitespace;
        opts.use_define_for_class_fields = task.use_define_for_class_fields;
        opts.features.emit_decorator_metadata = task.emit_decorator_metadata;
        // emitDecoratorMetadata implies legacy/experimental decorators, as it only
        // makes sense with TypeScript's legacy decorator system (reflect-metadata).
        // TC39 standard decorators have their own metadata mechanism.
        opts.features.standard_decorators = !loader.is_typescript()
            || !(task.experimental_decorators || task.emit_decorator_metadata);
        opts.features.unwrap_commonjs_packages = topts.unwrap_commonjs_packages;
        opts.features.no_macros = topts.no_macros;
        // Modeled as
        // `Option<Box<StringSet>>` on both sides, so we deep-clone (small —
        // CLI-supplied flag set). PERF: retype
        // `RuntimeFeatures.bundler_feature_flags` to `Option<&'a StringSet>` so
        // this clone disappears.
        opts.features.bundler_feature_flags = topts
            .bundler_feature_flags
            .as_deref()
            .map(|s| Box::new(bun_core::handle_oom(s.clone())));
        // JavaScriptCore implements `using` / `await using` natively, so when
        // targeting Bun there is no need to lower them.
        opts.features.lower_using = !target.is_bun();
        opts.features.hot_module_reloading =
            output_format == options::Format::InternalBakeDev && !task.source_index.is_runtime();
        opts.features.auto_polyfill_require =
            output_format == options::Format::Esm && !opts.features.hot_module_reloading;
        opts.features.react_fast_refresh =
            topts.react_fast_refresh && loader.is_jsx() && !source.path.is_node_module();
        opts.features.react_compiler = if topts.react_compiler.is_enabled()
            && loader.is_jsx()
            && !source.path.is_node_module()
        {
            topts.react_compiler
        } else {
            bun_ast::runtime::ReactCompilerMode::Disabled
        };
        opts.features.react_compiler_parse_test_pragmas =
            opts.features.react_compiler.is_enabled() && topts.react_compiler_parse_test_pragmas;

        opts.features.server_components = if topts.server_components {
            use bun_ast::runtime::ServerComponentsMode as SC;
            match target {
                options::Target::Browser => SC::ClientSide,
                _ => match use_directive {
                    UseDirective::None => SC::WrapAnonServerFunctions,
                    UseDirective::Client => {
                        if topts
                            .framework
                            .as_ref()
                            .unwrap()
                            .server_components
                            .as_ref()
                            .unwrap()
                            .separate_ssr_graph
                        {
                            SC::ClientSide
                        } else {
                            SC::WrapExportsForClientReference
                        }
                    }
                    UseDirective::Server => SC::WrapExportsForServerReference,
                },
            }
        } else {
            bun_ast::runtime::ServerComponentsMode::None
        };

        // `transpiler.options.framework: Option<&bake_types::Framework>`
        // vs `opts.framework: Option<&js_parser::options::Framework>` — both
        // TYPE_ONLY mirrors of `bake.Framework`. Project the fields the parser
        // reads into the parser-side mirror and bump-alloc
        // so `opts` can borrow it.
        opts.framework = topts.framework.as_deref().map(|f| {
            // `Framework` is bump-allocated below, so `Drop` never runs — use arena-owned slices.
            let projected = js_parser::options::Framework {
                is_built_in_react: f.is_built_in_react,
                server_components: f.server_components.as_ref().map(|sc| {
                    js_parser::options::FrameworkServerComponents {
                        separate_ssr_graph: sc.separate_ssr_graph,
                        server_runtime_import: std::borrow::Cow::Borrowed(
                            ast::StoreStr::new(bump.alloc_slice_copy(&sc.server_runtime_import))
                                .slice(),
                        ),
                        server_register_client_reference: std::borrow::Cow::Borrowed(
                            ast::StoreStr::new(
                                bump.alloc_slice_copy(&sc.server_register_client_reference),
                            )
                            .slice(),
                        ),
                        server_register_server_reference: std::borrow::Cow::Borrowed(
                            ast::StoreStr::new(
                                bump.alloc_slice_copy(&sc.server_register_server_reference),
                            )
                            .slice(),
                        ),
                        client_register_server_reference: std::borrow::Cow::Borrowed(
                            ast::StoreStr::new(
                                bump.alloc_slice_copy(&sc.client_register_server_reference),
                            )
                            .slice(),
                        ),
                    }
                }),
                react_fast_refresh: f.react_fast_refresh.as_ref().map(|rfr| {
                    js_parser::options::ReactFastRefresh {
                        import_source: std::borrow::Cow::Borrowed(
                            ast::StoreStr::new(bump.alloc_slice_copy(&rfr.import_source)).slice(),
                        ),
                    }
                }),
            };
            &*bump.alloc(projected)
        });

        opts.ignore_dce_annotations =
            topts.ignore_dce_annotations && !task.source_index.is_runtime();

        // For files that are not user-specified entrypoints, set `import.meta.main` to `false`.
        // Entrypoints will have `import.meta.main` set as "unknown", unless we use `--compile`,
        // in which we inline `true`.
        if topts.inline_entrypoint_import_meta_main || !task.is_entry_point {
            opts.import_meta_main_value = Some(task.is_entry_point && !topts.has_dev_server());
        } else if target == options::Target::Node {
            opts.lower_import_meta_main_for_node_js = true;
        }

        opts.allow_unresolved = &parse_config.allow_unresolved;
        opts.tree_shaking = if task.source_index.is_runtime() {
            true
        } else {
            topts.tree_shaking
        };
        opts.code_splitting = topts.code_splitting;
        opts.module_type = task.module_type;
        opts.is_entry_point = task.is_entry_point;

        task.jsx.parse = loader.is_jsx();

        let mut unique_key_for_additional_file = FileLoaderHash {
            key: ast::StoreStr::EMPTY,
            content_hash: 0,
        };
        let module_type = opts.module_type;
        let define = &parse_config.define;
        let ast_result: core::result::Result<JSAst, AnyError> =
            if !is_empty || loader.handles_empty_file() {
                get_ast(
                    log,
                    topts,
                    define,
                    opts,
                    bump,
                    resolver,
                    source,
                    loader,
                    worker_ctx.unique_key,
                    &mut unique_key_for_additional_file,
                    &worker_ctx.has_any_css_locals,
                )
            } else if loader.is_css() {
                get_empty_css_ast(log, define, opts, bump, source)
            } else if module_type == options::ModuleType::Esm {
                get_empty_ast::<E::Undefined>(log, define, opts, bump, source)
            } else {
                get_empty_ast::<E::Object>(log, define, opts, bump, source)
            };
        let mut ast = match ast_result {
            Ok(a) => a,
            Err(e) => {
                // Error-path cleanup: reset the AST store
                // unconditionally, and free the owned `entry.contents` only when
                // it was sourced from `.fd` (the `.contents` variant is borrowed —
                // freeing it would double-free in `BundleV2.deinit`).
                #[cfg(debug_assertions)]
                if task.contents_or_fd.tag() != debug_original_variant_check {
                    panic!(
                        "BUG: `task.contents_or_fd` changed in a way that will cause a double free or memory to leak!\n\n    Original = {}\n    New = {}\n",
                        <&'static str>::from(debug_original_variant_check),
                        <&'static str>::from(task.contents_or_fd.tag()),
                    );
                }
                this.data.transpiler.reset_store();
                if matches!(task.contents_or_fd, ContentsOrFd::Fd { .. }) {
                    entry.deinit();
                }
                return Err(e);
            }
        };

        ast.target = target;
        if ast.parts.len() <= 1
            && ast.css.is_none()
            && (task.loader.is_none() || task.loader.unwrap() != Loader::Html)
        {
            task.side_effects = bun_ast::SideEffects::NoSideEffectsEmptyAst;
        }

        // bun.debugAssert(ast.parts.len > 0); // when parts.len == 0, it is assumed to be pending/failed. empty ast has at least 1 part.

        *step = Step::Resolve;

        Ok(Success {
            ast,
            source: source.clone(),
            log: core::mem::take(log),
            use_directive,
            unique_key_for_additional_file: unique_key_for_additional_file.key,
            side_effects: task.side_effects,
            loader,
            package_name: task.package_name,

            // Hash the files in here so that we do it in parallel.
            content_hash_for_additional_file: unique_key_for_additional_file.content_hash,
        })
    }

    // ───────────────────────────────────────────────────────────────────────────
    // runFromThreadPool
    // ───────────────────────────────────────────────────────────────────────────

    /// Worker-thread entry point: read and/or parse `this`, then hand the
    /// result (and the task) back to the bundle thread.
    pub(crate) fn run_from_thread_pool(mut this: Box<ParseTask<'_>>) {
        let ctx = this.ctx();
        let ctx: &ParseShared<'_> = &ctx;
        scoped_log!(
            ParseTask,
            "ParseTask(0x{:x}, {}) callback",
            std::ptr::from_ref::<ParseTask<'_>>(&this) as usize,
            bstr::BStr::new(this.path.text)
        );

        let mut step: Step = Step::Pending;
        let mut log = Log::init();
        debug_assert!(this.source_index.is_valid()); // forgot to set source_index

        // With an IO pool the read stage runs there first, with only an arena
        // and a file cache, and then hands the task to the parse pool.
        if matches!(this.stage, ParseTaskStage::NeedsSourceCode)
            && crate::ThreadPool::uses_io_pool()
        {
            let (source_index, target) = (this.source_index, this.known_target);
            let read = {
                let mut reader = ctx.pool.get_io_reader();
                let crate::thread_pool::IoReader { heap, fs_cache, .. } = &mut *reader;
                let heap = heap.get();
                get_source_code(
                    &mut this,
                    heap,
                    fs_cache,
                    &ctx.pool.seed().options,
                    &mut log,
                )
            };
            match read {
                Ok(entry) if !log.has_errors() => {
                    this.stage = ParseTaskStage::NeedsParse(entry);
                    ctx.pool.schedule_inside_thread_pool(this);
                    return;
                }
                read => {
                    let err = match read {
                        Err(e) => e,
                        Ok(_) => crate::Error::SyntaxError,
                    };
                    finish(
                        this,
                        ctx,
                        ResultValue::Err(ResultError {
                            err,
                            step,
                            log,
                            source_index,
                            target,
                        }),
                    );
                    return;
                }
            }
        }

        let mut worker = ctx.pool.get_worker();
        let value: ResultValue = 'value: {
            if matches!(this.stage, ParseTaskStage::NeedsSourceCode) {
                let read = {
                    let heap = worker.arena();
                    let t = &mut *worker.data.transpiler;
                    get_source_code(
                        &mut this,
                        heap,
                        &mut t.resolver.caches.fs,
                        &t.options,
                        &mut log,
                    )
                };
                match read {
                    Ok(entry) => this.stage = ParseTaskStage::NeedsParse(entry),
                    Err(e) => {
                        worker.data.transpiler.reset_store();
                        break 'value ResultValue::Err(ResultError {
                            err: e,
                            step,
                            log,
                            source_index: this.source_index,
                            target: this.known_target,
                        });
                    }
                }

                if log.has_errors() {
                    break 'value ResultValue::Err(ResultError {
                        err: crate::Error::SyntaxError,
                        step,
                        log,
                        source_index: this.source_index,
                        target: this.known_target,
                    });
                }
            }

            // The entry must live in-place so its `Contents::Owned` buffer
            // survives in `task.stage` for the bundle's lifetime
            // (Success.source.contents borrows it). Take it out, parse, then
            // *write it back* on every path before `break 'value` so dropping
            // the local can't free the buffer underneath the borrowed source.
            let mut entry =
                match core::mem::replace(&mut this.stage, ParseTaskStage::NeedsSourceCode) {
                    ParseTaskStage::NeedsParse(e) => e,
                    ParseTaskStage::NeedsSourceCode => unreachable!(),
                };
            let parsed =
                run_with_source_code(&mut this, &mut worker, &mut step, &mut log, &mut entry);
            this.stage = ParseTaskStage::NeedsParse(entry);
            match parsed {
                Ok(ast) => {
                    // When using HMR, always flag asts with errors as parse failures.
                    // Not done outside of the dev server out of fear of breaking existing code.
                    if ctx.has_dev_server && ast.log.has_errors() {
                        break 'value ResultValue::Err(ResultError {
                            err: crate::Error::SyntaxError,
                            step: Step::Parse,
                            log: ast.log,
                            source_index: this.source_index,
                            target: this.known_target,
                        });
                    }

                    break 'value ResultValue::Success(ast);
                }
                Err(e) => {
                    if e == crate::Error::EmptyAST {
                        drop(log);
                        break 'value ResultValue::Empty {
                            source_index: this.source_index,
                        };
                    }

                    break 'value ResultValue::Err(ResultError {
                        err: e,
                        step,
                        log,
                        source_index: this.source_index,
                        target: this.known_target,
                    });
                }
            }
        };

        drop(worker);
        finish(this, ctx, value);
    }

    /// Hand the task and its outcome back to the bundle thread
    /// (`on_parse_task_complete`).
    fn finish<'a>(mut this: Box<ParseTask<'a>>, ctx: &ParseShared<'a>, value: ResultValue<'a>) {
        // Held only while the task is out (a queued result must not keep
        // `ParseShared` — and through its inbox, itself — alive).
        this.ctx = None;
        drop(core::mem::take(&mut this.jsx));
        let result = Result {
            value,
            external: core::mem::take(&mut this.external_free_function),
            watcher_data: match this.contents_or_fd {
                ContentsOrFd::Fd { file, dir } => WatcherData {
                    fd: file,
                    dir_fd: dir,
                },
                ContentsOrFd::Contents(_) => WatcherData::NONE,
            },
            parse_task: Some(this),
        };
        ctx.inbox.push(crate::inbox::Incoming::ParseTask(result));
    }
} // end mod parse_worker
