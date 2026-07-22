//! A `ParseTask` is the unit of work scheduled on the thread pool for each
//! source file the bundler needs to parse. It carries everything needed to
//! read the file (or use already-loaded contents), run the JS/CSS/etc. parser,
//! and ship a `Result` back to the bundler thread.

use core::ffi::c_void;
use core::mem::offset_of;
use core::sync::atomic::{AtomicU32, Ordering};

use crate::Error as AnyError;
use bun_alloc::Arena as Bump; // bumpalo::Bump re-export
use bun_ast::ImportRecord;
use bun_ast::{Loc, Location, Log, Msg, Source};
use bun_collections::VecExt;
use bun_core::strings;
use bun_core::{self, FeatureFlags, declare_scope, scoped_log};
use bun_sys::Fd;
use bun_threading::thread_pool as ThreadPoolLib;

use bun_ast::Index;
use bun_ast::{self as ast, E, Expr, G, Part};
use bun_js_parser as js_parser;
// `BundledAst<'arena>` — the bundler graph stores `'static`-erased
// ASTs (arena outlives the link step). Use the crate-level alias so the
// `Success`/helper signatures don't carry an explicit `'static` everywhere.
use crate::JSAst;
/// `js_parser.Parser.Options` — the real parser-entry options struct.
pub use bun_js_parser::parser::ParserOptions;

use crate::bun_css;
use crate::bun_fs as Fs;
use crate::bun_node_fallbacks as NodeFallbackModules;
use crate::bundle_v2::{self as bundler, BundleV2};
use crate::cache::{Entry as CacheEntry, ExternalFreeFunction};
use crate::html_scanner::HTMLScanner;
use crate::options::{self, Loader};
use crate::transpiler::Transpiler;
use crate::{ContentHasher, UseDirective, perf, target_from_hashbang};
use bun_resolver::fs::PathResolverExt as _;
use bun_resolver::{self as _resolver, Resolver};

declare_scope!(ParseTask, hidden);

#[allow(non_snake_case)]
mod EventLoop {
    pub(super) type Task = bun_event_loop::ConcurrentTask::ConcurrentTask;
}

// the per-file parse arena is held as `bump: &'static Bump` (the
// worker arena is pinned for the entire bundle pass — see `run_with_source_code`),
// so `bump.alloc_*` / `ArenaString::into_bump_str` already yield `&'static`
// borrows directly. No erasure helper is needed; `StoreStr::new` covers the
// remaining AST-string sites (`E::String.data`, `FileLoaderHash.key`).

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

pub struct ParseTask {
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
    pub task: ThreadPoolLib::Task,

    // Split this into a different task so that we don't accidentally run the
    // tasks for io on the threads that are meant for parsing.
    pub(crate) io_task: ThreadPoolLib::Task,

    // Used for splitting up the work between the io and parse steps.
    pub(crate) stage: ParseTaskStage,

    pub(crate) tree_shaking: bool,
    pub(crate) known_target: options::Target,
    pub(crate) module_type: options::ModuleType,
    pub(crate) emit_decorator_metadata: bool,
    pub(crate) experimental_decorators: bool,
    /// BACKREF (LIFETIMES.tsv) — written through in
    /// `on_complete`. `None` only in the `default()` placeholder; every
    /// scheduled task has it set via `init` / `bundle_v2.rs` write-sites.
    pub ctx: Option<bun_ptr::ParentRef<BundleV2<'static>>>,
    // Borrows package_json (resolver arena); valid for the bundle pass.
    pub(crate) package_version: ast::StoreStr,
    pub(crate) package_name: ast::StoreStr,
    pub(crate) is_entry_point: bool,
}

pub enum ParseTaskStage {
    NeedsSourceCode,
    NeedsParse(CacheEntry),
}

// ───────────────────────────────────────────────────────────────────────────
// Result
// ───────────────────────────────────────────────────────────────────────────

/// The information returned to the Bundler thread when a parse finishes.
pub struct Result {
    pub(crate) task: EventLoop::Task,
    pub(crate) ctx: bun_ptr::ParentRef<BundleV2<'static>>,
    pub(crate) value: ResultValue,
    pub(crate) watcher_data: WatcherData,
    /// This is used for native onBeforeParsePlugins to store
    /// a function pointer and context pointer to free the
    /// returned source code by the plugin.
    pub(crate) external: ExternalFreeFunction,
}
// `Result` lives in a bump arena (no Drop on free); boxing the large arm
// would leak the heap allocation. The size diff is acceptable.
#[allow(clippy::large_enum_variant)]
pub enum ResultValue {
    Success(Success),
    Err(ResultError),
    Empty { source_index: Index },
}

pub struct WatcherData {
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

pub struct Success {
    pub(crate) ast: JSAst<'static>,
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

pub struct ResultError {
    pub(crate) err: AnyError,
    pub(crate) step: Step,
    pub(crate) log: Log,
    pub(crate) target: options::Target,
    pub(crate) source_index: Index,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Step {
    Pending,
    ReadFile,
    Parse,
    Resolve,
}

// ───────────────────────────────────────────────────────────────────────────
// init
// ───────────────────────────────────────────────────────────────────────────

impl ParseTask {
    /// Shared borrow of the owning `BundleV2`. `ctx` is a BACKREF
    /// (LIFETIMES.tsv) into the arena-allocated bundle, set at `init` time and
    /// valid until `BundleV2::deinit`. Prefer this over open-coded
    /// `unsafe { &*task.ctx }`; sites that mutate the bundle (e.g.
    /// `on_complete`) must continue to deref the raw `ctx` field directly.
    ///
    /// # Safety
    ///
    /// The returned lifetime `'r` is **decoupled** from `&self`: callers in
    /// `get_code_for_parse_task_*` stash slices borrowed from `ctx` into
    /// out-params whose lifetime is independent of `task`, so we cannot tie
    /// `'r` to the `ParseTask` borrow. The caller must ensure the bundle
    /// outlives `'r` — true for every site, since the bundle drives the parse
    /// tasks and outlives all of them. Also requires `ctx` to be initialized
    /// (`init()` was called); debug-asserted.
    #[inline]
    pub(crate) unsafe fn ctx<'r>(&self) -> &'r BundleV2<'static> {
        // SAFETY: caller upholds: bundle outlives `'r`. `expect` enforces init().
        unsafe { bun_ptr::detach_lifetime_ref(self.ctx.expect("ParseTask.ctx unset").get()) }
    }

    pub(crate) fn init(
        resolve_result: &_resolver::Result,
        source_index: Index,
        // Take `*mut` so the stored BACKREF retains
        // write provenance for `on_complete` (a `&BundleV2` param would shrink
        // provenance to read-only, making the later `&mut *ctx` UB).
        ctx: *mut BundleV2<'_>,
    ) -> ParseTask {
        let (package_name, package_version) = match resolve_result.package_json {
            // SAFETY: `package_json` is `Option<*const PackageJSON>`; the resolver
            // arena outlives the bundle pass, so deref'ing the raw pointer here to
            // borrow `name`/`version` is sound.
            Some(pj) => unsafe {
                let pj = &*pj;
                (
                    ast::StoreStr::new(&pj.name[..]),
                    ast::StoreStr::new(&pj.version[..]),
                )
            },
            None => (ast::StoreStr::EMPTY, ast::StoreStr::EMPTY),
        };
        // SAFETY: lifetime erased — `ctx` outlives the ParseTask (BACKREF);
        // write provenance from the `*mut BundleV2` parameter; caller passes a
        // live `&mut BundleV2` coerced to `*mut`.
        let ctx_ref = unsafe { bun_ptr::ParentRef::from_raw_mut(ctx.cast::<BundleV2<'static>>()) };
        let known_target = ctx_ref.get().transpiler().options.target;
        ParseTask {
            ctx: Some(ctx_ref),
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
            package_version,
            package_name,
            known_target,
            // defaults:
            secondary_path_for_commonjs_interop: None,
            external_free_function: ExternalFreeFunction::NONE,
            loader: None,
            task: ThreadPoolLib::Task {
                node: ThreadPoolLib::Node::default(),
                callback: task_callback,
            },
            io_task: ThreadPoolLib::Task {
                node: ThreadPoolLib::Node::default(),
                callback: io_task_callback,
            },
            stage: ParseTaskStage::NeedsSourceCode,
            tree_shaking: false,
            is_entry_point: false,
        }
    }

    /// Re-export of `parse_worker::get_runtime_source` as an associated fn so
    /// callers can spell it `ParseTask::get_runtime_source`.
    #[inline]
    pub(crate) fn get_runtime_source(target: options::Target) -> RuntimeSource {
        parse_worker::get_runtime_source(target)
    }
}

impl Default for ParseTask {
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
            task: ThreadPoolLib::Task {
                node: ThreadPoolLib::Node::default(),
                callback: task_callback,
            },
            io_task: ThreadPoolLib::Task {
                node: ThreadPoolLib::Node::default(),
                callback: io_task_callback,
            },
            stage: ParseTaskStage::NeedsSourceCode,
            tree_shaking: false,
            known_target: options::Target::default(),
            module_type: options::ModuleType::Unknown,
            emit_decorator_metadata: false,
            experimental_decorators: false,
            package_version: ast::StoreStr::EMPTY,
            package_name: ast::StoreStr::EMPTY,
            is_entry_point: false,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// taskCallback / ioTaskCallback — thread-pool entry points. Safe-fn wrappers
// (coerce to the `ThreadPoolLib::Task.callback` field type at the struct-init
// sites); bodies dispatch to `parse_worker::run_from_thread_pool`.
// ───────────────────────────────────────────────────────────────────────────

// CONCURRENCY: thread-pool callback — runs on worker (or IO-pool) threads,
// one task per `ParseTask`. Each `ParseTask` is a heap node owned by the
// bundle graph; the `&mut ParseTask` recovered here is unique per task (no
// two callbacks fire for the same `ParseTask` concurrently — the IO→worker
// hand-off in `run_from_thread_pool_impl` reschedules sequentially). Writes:
// `ParseTask.{stage, source_index, ...}` (own fields); result is sent via
// `ctx.loop_.enqueue_task_concurrent` (MPSC queue). Reads `ctx: &BundleV2`
// shared (`Worker::get`, `ctx.graph.pool`, `ctx.transpiler.options`).
// `ParseTask` is `Send` because its non-auto-`Send` fields are bundle-
// lifetime arena slices / backref pointers (`ctx`, `path`, `contents`).
/// # Safety
/// `task` must point at the `io_task` intrusive field of a live `ParseTask`
/// scheduled by the thread pool, with provenance over the full `ParseTask`.
unsafe fn io_task_callback(task: *mut ThreadPoolLib::Task) {
    // SAFETY: `task` points to `ParseTask.io_task` (intrusive field) — only
    // ever invoked by the thread pool against a `ParseTask` it scheduled, so
    // provenance covers the full `ParseTask` and the `&mut` is unique per the
    // CONCURRENCY note above.
    let parse_task = unsafe { &mut *bun_core::from_field_ptr!(ParseTask, io_task, task) };
    parse_worker::run_from_thread_pool(parse_task);
}

// CONCURRENCY: see `io_task_callback` — same task, different intrusive field.
/// # Safety
/// `task` must point at the `task` intrusive field of a live `ParseTask`
/// scheduled by the thread pool, with provenance over the full `ParseTask`.
unsafe fn task_callback(task: *mut ThreadPoolLib::Task) {
    // SAFETY: `task` points to `ParseTask.task` (intrusive field) — see
    // `io_task_callback` for the dispatch invariant.
    let parse_task = unsafe { &mut *bun_core::from_field_ptr!(ParseTask, task, task) };
    parse_worker::run_from_thread_pool(parse_task);
}

// ───────────────────────────────────────────────────────────────────────────
// RuntimeSource
// ───────────────────────────────────────────────────────────────────────────

pub struct RuntimeSource {
    pub(crate) parse_task: ParseTask,
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

    fn get_runtime_source_comptime(target: options::Target) -> RuntimeSource {
        use const_format::concatcp;

        let runtime_code: &'static str = match target {
            options::Target::Bun => {
                concatcp!(
                    include_str!("../runtime.js"),
                    RUNTIME_REQUIRE_BUN,
                    RUNTIME_USING_BUN
                )
            }
            options::Target::BunMacro => {
                concatcp!(
                    include_str!("../runtime.js"),
                    RUNTIME_REQUIRE_BUN,
                    RUNTIME_USING_OTHER
                )
            }
            options::Target::Node => {
                concatcp!(
                    include_str!("../runtime.js"),
                    RUNTIME_REQUIRE_NODE,
                    RUNTIME_USING_OTHER
                )
            }
            _ => {
                concatcp!(
                    include_str!("../runtime.js"),
                    RUNTIME_REQUIRE_OTHER,
                    RUNTIME_USING_OTHER
                )
            }
        };

        let parse_task = ParseTask {
            ctx: None,
            path: Fs::Path::init_with_namespace(b"runtime", b"bun:runtime"),
            side_effects: bun_ast::SideEffects::NoSideEffectsPureData,
            jsx: options::jsx::Pragma {
                parse: false,
                ..Default::default()
            },
            contents_or_fd: ContentsOrFd::Contents(runtime_code.as_bytes()),
            source_index: Index::RUNTIME,
            loader: Some(Loader::Js),
            known_target: target,
            // defaults:
            secondary_path_for_commonjs_interop: None,
            external_free_function: ExternalFreeFunction::NONE,
            task: ThreadPoolLib::Task {
                node: ThreadPoolLib::Node::default(),
                callback: task_callback,
            },
            io_task: ThreadPoolLib::Task {
                node: ThreadPoolLib::Node::default(),
                callback: io_task_callback,
            },
            stage: ParseTaskStage::NeedsSourceCode,
            tree_shaking: false,
            module_type: options::ModuleType::Unknown,
            emit_decorator_metadata: false,
            experimental_decorators: false,
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
            contents: std::borrow::Cow::Borrowed(runtime_code.as_bytes()),
            // `Source.index` is `bun_ast::Index` (newtype `u32`),
            // distinct from `bun_ast::Index`. Runtime source is index 0.
            index: bun_ast::Index(Index::RUNTIME.get()),
            ..Default::default()
        };
        RuntimeSource { parse_task, source }
    }

    pub fn get_runtime_source(target: options::Target) -> RuntimeSource {
        get_runtime_source_comptime(target)
    }

    // ───────────────────────────────────────────────────────────────────────────
    // getEmptyCSSAST / getEmptyAST
    // ───────────────────────────────────────────────────────────────────────────

    // `transpiler: *mut Transpiler` stays raw. Callers
    // (`get_ast`, `run_with_source_code`) may also hold a raw pointer to
    // `(*transpiler).resolver`; materializing `&mut Transpiler` here would assert
    // exclusive access to the whole struct and invalidate that sibling pointer.
    // We only touch the disjoint `options.define` field.
    fn get_empty_css_ast(
        log: &mut Log,
        transpiler: *mut Transpiler,
        opts: ParserOptions<'static>,
        bump: &'static Bump,
        source: &'static Source,
    ) -> core::result::Result<JSAst<'static>, AnyError> {
        let root = Expr::init(E::Object::default(), Loc { start: 0 });
        // SAFETY: `transpiler` is a live worker-owned `*mut Transpiler`; `options`
        // is disjoint from any other field the caller may hold a pointer to.
        let define = unsafe { &mut (*transpiler).options.define };
        let mut ast = JSAst::init(
            js_parser::new_lazy_export_ast(bump, define, opts, log, root, source, b"")?.unwrap(),
        );
        ast.css = Some(crate::bundled_ast::CssAstRef::from_bump(
            bump.alloc(bun_css::BundlerStyleSheet::empty()),
        ));
        Ok(ast)
    }

    fn get_empty_ast<RootType: Default + bun_ast::expr::IntoExprData>(
        log: &mut Log,
        transpiler: *mut Transpiler,
        opts: ParserOptions<'static>,
        bump: &'static Bump,
        source: &'static Source,
    ) -> core::result::Result<JSAst<'static>, AnyError> {
        let root = Expr::init(RootType::default(), Loc::EMPTY);
        // SAFETY: see `get_empty_css_ast` — disjoint field of a live `*mut Transpiler`.
        let define = unsafe { &mut (*transpiler).options.define };
        Ok(JSAst::init(
            js_parser::new_lazy_export_ast(bump, define, opts, log, root, source, b"")?.unwrap(),
        ))
    }

    // ───────────────────────────────────────────────────────────────────────────
    // FileLoaderHash
    // ───────────────────────────────────────────────────────────────────────────

    pub struct FileLoaderHash {
        pub(crate) key: ast::StoreStr,
        pub(crate) content_hash: u64,
    }

    // ───────────────────────────────────────────────────────────────────────────
    // CSS Symbol bridge — `bun_ast::Symbol` ↔ `bun_ast::Symbol`
    //
    // `StylesheetExtra.symbols` is `Vec<bun_ast::Symbol>`;
    // `new_lazy_export_ast_impl` takes `Vec<bun_ast::Symbol>`. Convert
    // field-by-field so CSS-module local refs (`ref.inner_index()`) index a
    // populated symbol table.
    // ───────────────────────────────────────────────────────────────────────────

    fn css_symbols_to_parser_symbols(
        src: &[bun_ast::Symbol],
        bump: &'static Bump,
    ) -> bun_ast::symbol::List<'static> {
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

    // `transpiler`/`resolver` are raw `*mut`. The caller may pass
    // `resolver = &transpiler.resolver`, so
    // the two may point into the same allocation. Taking `&mut Transpiler` +
    // `&mut Resolver` would be aliased-`&mut` UB. We instead reborrow only the
    // disjoint `(*transpiler).options` field, never the whole struct.
    #[allow(clippy::too_many_arguments)]
    fn get_ast(
        log: &mut Log,
        transpiler: *mut Transpiler,
        opts: ParserOptions<'static>,
        bump: &'static Bump,
        resolver: *mut Resolver,
        source: &'static Source,
        loader: Loader,
        unique_key_prefix: u64,
        unique_key_for_additional_file: &mut FileLoaderHash,
        has_any_css_locals: &AtomicU32,
    ) -> core::result::Result<JSAst<'static>, AnyError> {
        use core::fmt::Write as _;

        // SAFETY: `transpiler` is a live worker-owned `*mut Transpiler`.
        // `options` and `resolver` are disjoint fields of `Transpiler`; reborrowing
        // `options` here does not overlap any access through `resolver` below.
        let topts = unsafe { &mut (*transpiler).options };

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
                    (crate::cache::JavaScript {}).parse(bump, opts, &topts.define, log, source)?
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
                    get_empty_ast::<E::Undefined>(log, transpiler, fallback_opts, bump, source)
                } else {
                    get_empty_ast::<E::Object>(log, transpiler, fallback_opts, bump, source)
                };
            }
            Loader::Json | Loader::Jsonc => {
                let _trace = perf::trace("Bundler.ParseJSON");
                let mode = if matches!(loader, Loader::Jsonc) {
                    bun_resolver::tsconfig_json::JsonMode::Jsonc
                } else {
                    bun_resolver::tsconfig_json::JsonMode::Json
                };
                // SAFETY: `resolver` is a live `*mut Resolver`;
                // `caches` is disjoint from `(*transpiler).options` reborrowed above.
                let root: Expr = unsafe { &mut (*resolver).caches.json }
                    .parse_json(log, source, mode)?
                    .unwrap_or_else(|| Expr::init(E::Object::default(), Loc::EMPTY));
                return Ok(JSAst::init(
                    js_parser::new_lazy_export_ast(
                        bump,
                        &mut topts.define,
                        opts,
                        log,
                        root,
                        source,
                        b"",
                    )?
                    .unwrap(),
                ));
            }
            Loader::Toml => {
                let _trace = perf::trace("Bundler.ParseTOML");
                let mut temp_log = Log::init();
                // `temp_log` must flush into `log` on the error path too.
                // scopeguard would alias `log`/`temp_log` (both borrowed mutably
                // below); reshape as a closure so every `?` exits through one
                // post-amble that flushes `temp_log`.
                let result = (|| -> core::result::Result<JSAst<'static>, AnyError> {
                    let root: Expr =
                        bun_parsers::toml::TOML::parse(source, &mut temp_log, bump, false)?;
                    Ok(JSAst::init(
                        js_parser::new_lazy_export_ast(
                            bump,
                            &mut topts.define,
                            opts,
                            &mut temp_log,
                            root,
                            source,
                            b"",
                        )?
                        .unwrap(),
                    ))
                })();
                let _ = temp_log.clone_to_with_recycled(log, true);
                return result;
            }
            Loader::Yaml => {
                let _trace = perf::trace("Bundler.ParseYAML");
                let mut temp_log = Log::init();
                let result = (|| -> core::result::Result<JSAst<'static>, AnyError> {
                    let root: Expr = bun_parsers::yaml::YAML::parse(source, &mut temp_log, bump)?;
                    Ok(JSAst::init(
                        js_parser::new_lazy_export_ast(
                            bump,
                            &mut topts.define,
                            opts,
                            &mut temp_log,
                            root,
                            source,
                            b"",
                        )?
                        .unwrap(),
                    ))
                })();
                let _ = temp_log.clone_to_with_recycled(log, true);
                return result;
            }
            Loader::Json5 => {
                let _trace = perf::trace("Bundler.ParseJSON5");
                let mut temp_log = Log::init();
                let result = (|| -> core::result::Result<JSAst<'static>, AnyError> {
                    let root: Expr =
                        bun_parsers::json5::JSON5Parser::parse(source, &mut temp_log, bump)?;
                    Ok(JSAst::init(
                        js_parser::new_lazy_export_ast(
                            bump,
                            &mut topts.define,
                            opts,
                            &mut temp_log,
                            root,
                            source,
                            b"",
                        )?
                        .unwrap(),
                    ))
                })();
                let _ = temp_log.clone_to_with_recycled(log, true);
                return result;
            }
            Loader::Text => {
                let root = Expr::init(
                    E::String {
                        data: source.contents().into(),
                        ..Default::default()
                    },
                    Loc { start: 0 },
                );
                let mut ast = JSAst::init(
                    js_parser::new_lazy_export_ast(
                        bump,
                        &mut topts.define,
                        opts,
                        log,
                        root,
                        source,
                        b"",
                    )?
                    .unwrap(),
                );
                ast.add_url_for_css(
                    bump,
                    source,
                    Some(b"text/plain"),
                    None,
                    topts.compile_to_standalone_html,
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
                    js_parser::new_lazy_export_ast(
                        bump,
                        &mut topts.define,
                        opts,
                        log,
                        root,
                        source,
                        b"",
                    )?
                    .unwrap(),
                );
                ast.add_url_for_css(
                    bump,
                    source,
                    Some(b"text/html"),
                    None,
                    topts.compile_to_standalone_html,
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

                let path_to_use: &[u8] = 'brk: {
                    // Implements embedded sqlite
                    if loader == Loader::SqliteEmbedded {
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
                        let embedded_path = buf.into_bump_str().as_bytes();
                        *unique_key_for_additional_file = FileLoaderHash {
                            key: ast::StoreStr::new(embedded_path),
                            content_hash: ContentHasher::run(&source.contents),
                        };
                        break 'brk embedded_path;
                    }

                    break 'brk source.path.text;
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
                let object_properties = bump.alloc_slice_fill_default::<G::Property>(1);
                object_properties[0] = G::Property {
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
                        // SAFETY: bump-owned slice; never grown via this Vec.
                        properties: unsafe { G::PropertyList::from_bump_slice(object_properties) },
                        is_single_line: true,
                        ..Default::default()
                    },
                    Loc { start: 0 },
                );
                let require_call = Expr::init(
                    E::Call {
                        target: require_property,
                        // SAFETY: bump-owned slice; never grown via this Vec.
                        args: unsafe { bun_ast::ExprNodeList::from_bump_slice(require_args) },
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
                    js_parser::new_lazy_export_ast(
                        bump,
                        &mut topts.define,
                        opts,
                        log,
                        root,
                        source,
                        b"",
                    )?
                    .unwrap(),
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
                // This injects the following code:
                //
                // require(unique_key)
                //
                let import_path = Expr::init(
                    E::String {
                        data: unique_key.into(),
                        ..Default::default()
                    },
                    Loc { start: 0 },
                );

                let require_args = bump.alloc_slice_fill_default::<Expr>(1);
                require_args[0] = import_path;

                let root = Expr::init(
                    E::Call {
                        target: Expr {
                            data: ast::ExprData::ERequireCallTarget,
                            loc: Loc { start: 0 },
                        },
                        // SAFETY: bump-owned slice; never grown via this Vec.
                        args: unsafe { bun_ast::ExprNodeList::from_bump_slice(require_args) },
                        ..Default::default()
                    },
                    Loc { start: 0 },
                );

                *unique_key_for_additional_file = FileLoaderHash {
                    key: ast::StoreStr::new(unique_key),
                    content_hash: ContentHasher::run(&source.contents),
                };
                return Ok(JSAst::init(
                    js_parser::new_lazy_export_ast(
                        bump,
                        &mut topts.define,
                        opts,
                        log,
                        root,
                        source,
                        b"",
                    )?
                    .unwrap(),
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
                    &mut topts.define,
                    opts,
                    log,
                    Expr::init(E::Missing {}, Loc::EMPTY),
                    source,
                    b"",
                )?
                .unwrap();
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
                    &mut topts.define,
                    opts,
                    &mut temp_log,
                    root,
                    source,
                    b"",
                    symbols,
                );
                let _ = temp_log.append_to_maybe_recycled(log, source);
                let mut ast = JSAst::init(lazy?.unwrap());
                let css_ast_heap = crate::bundled_ast::CssAstRef::from_bump(bump.alloc(css_ast));
                ast.css = Some(css_ast_heap);
                ast.import_records = bun_alloc::vec_from_iter_in(import_records, bump);
                return Ok(ast);
            }
            // TODO:
            Loader::Dataurl | Loader::Base64 | Loader::Bunsh => {
                return get_empty_ast::<E::String>(log, transpiler, opts, bump, source);
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
                    js_parser::new_lazy_export_ast(
                        bump,
                        &mut topts.define,
                        opts,
                        log,
                        root,
                        source,
                        b"",
                    )?
                    .unwrap(),
                );
                ast.add_url_for_css(
                    bump,
                    source,
                    None,
                    Some(unique_key),
                    topts.compile_to_standalone_html,
                );
                return Ok(ast);
            }
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // getCodeForParseTaskWithoutPlugins
    // ───────────────────────────────────────────────────────────────────────────

    // `transpiler`/`resolver` are raw `*mut`.
    // Callers pass `resolver = &mut (*transpiler).resolver`; taking
    // `&mut Transpiler` + `&mut Resolver` would be aliased-`&mut` UB. We only
    // touch the disjoint `(*transpiler).fs` and `(*resolver).caches.fs` fields.
    fn get_code_for_parse_task_without_plugins(
        task: &mut ParseTask,
        log: &mut Log,
        transpiler: *mut Transpiler,
        resolver: *mut Resolver,
        bump: &Bump,
        file_path: &mut Fs::Path,
        _loader: Loader,
    ) -> core::result::Result<CacheEntry, AnyError> {
        match &task.contents_or_fd {
            ContentsOrFd::Fd { dir, file } => 'brk: {
                let contents_dir = *dir;
                let contents_file = *file;
                let _trace = perf::trace("Bundler.readFile");

                // SAFETY: ctx backref is valid for the bundle pass (outlives `'r`).
                let ctx = unsafe { task.ctx() };

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
                        if let Some(f) = &ctx.framework {
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
                                        *file_path = Fs::Path::init(path);
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
                // SAFETY: `transpiler` is a live worker-owned `*mut Transpiler`;
                // `(*transpiler).fs` is a live `*mut FileSystem` BACKREF.
                let fs_ref = unsafe { &mut *(*transpiler).fs };
                // SAFETY: `resolver` is a live `*mut Resolver`; `caches.fs` is
                // disjoint from `(*transpiler).fs` (a backref pointer field).
                break 'brk match unsafe { &mut (*resolver).caches.fs }.read_file_with_allocator(
                    fs_ref,
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

    // `transpiler`/`resolver` are raw `*mut` — see
    // `get_code_for_parse_task_without_plugins`.
    #[allow(clippy::too_many_arguments)]
    fn get_code_for_parse_task<'b>(
        task: &mut ParseTask,
        log: &mut Log,
        transpiler: *mut Transpiler<'b>,
        resolver: *mut Resolver<'b>,
        bump: &Bump,
        file_path: &mut Fs::Path<'b>,
        loader: &mut Loader,
        from_plugin: &mut bool,
    ) -> core::result::Result<CacheEntry, AnyError> {
        let might_have_on_parse_plugins = 'brk: {
            if task.source_index.is_runtime() {
                break 'brk false;
            }
            // SAFETY: ctx backref is valid for the bundle pass (outlives `'r`).
            let ctx = unsafe { task.ctx() };
            let Some(plugin) = ctx.plugins_ref() else {
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
                task, log, transpiler, resolver, bump, file_path, *loader,
            );
        }

        let should_continue_running = core::cell::Cell::new(1i32);

        let mut ctx = OnBeforeParsePlugin {
            task,
            log,
            transpiler,
            resolver,
            bump,
            file_path,
            loader,
            deferred_error: None,
            should_continue_running: &should_continue_running,
            result: core::ptr::null_mut(),
            original_contents: None,
        };

        // SAFETY: ctx backref is valid for the bundle pass (outlives `'r`).
        let plugins = unsafe { ctx.task.ctx() }
            .plugins_ref()
            .expect("unreachable");
        ctx.run(plugins, from_plugin)
    }

    // ───────────────────────────────────────────────────────────────────────────
    // OnBeforeParsePlugin
    // ───────────────────────────────────────────────────────────────────────────

    pub struct OnBeforeParsePlugin<'a, 'b: 'a> {
        task: &'a mut ParseTask,
        log: &'a mut Log,
        // raw `*mut`. Callers pass
        // `resolver = &mut (*transpiler).resolver`; storing `&'a mut Transpiler<'b>`
        // alongside `&'a mut Resolver<'b>` would be aliased-`&mut` UB. The data
        // lifetime `'b` is retained on the pointee for variance only.
        transpiler: *mut Transpiler<'b>,
        resolver: *mut Resolver<'b>,
        bump: &'a Bump,
        file_path: &'a mut Fs::Path<'b>,
        loader: &'a mut Loader,
        deferred_error: Option<AnyError>,
        // `fetch_source_code` and `OnBeforeParsePlugin__isDone` re-enter
        // via FFI while the outer `run` call has already handed this same i32 to
        // C++, so a `&'a mut i32` here would be aliased-`&mut` UB. `Cell<i32>` is
        // `repr(transparent)` over `UnsafeCell<i32>`; FFI receives `Cell::as_ptr()`
        // (a real `*mut i32`) and Rust callers use safe `.get()/.set()`.
        should_continue_running: &'a core::cell::Cell<i32>,

        // Raw pointer. Must stay raw — the pointee
        // is `OnBeforeParseResultWrapper.result`, and `get_wrapper` walks back to
        // the parent via offset_of; a `&mut` here would (a) shrink provenance to
        // the inner field and (b) alias with any `&`/`&mut` to the wrapper.
        result: *mut OnBeforeParseResult,
        // Owns the `Contents` fetched by `fetch_source_code` so the buffer the
        // native plugin reads through `wrapper.original_source` stays alive for
        // the duration of `run`. Returned to the caller when the plugin keeps
        // the original source, dropped otherwise.
        original_contents: Option<crate::cache::Contents>,
    }

    #[repr(C)]
    pub struct OnBeforeParseArguments {
        pub(crate) struct_size: usize,
        pub(crate) context: *mut OnBeforeParsePlugin<'static, 'static>, // FFI (LIFETIMES.tsv)
        pub(crate) path_ptr: *const u8,
        pub(crate) path_len: usize,
        pub(crate) namespace_ptr: *const u8,
        pub(crate) namespace_len: usize,
        pub(crate) default_loader: Loader,
        pub(crate) external: *mut c_void, // FFI (LIFETIMES.tsv)
    }

    impl Default for OnBeforeParseArguments {
        fn default() -> Self {
            Self {
                struct_size: core::mem::size_of::<OnBeforeParseArguments>(),
                context: core::ptr::null_mut(),
                path_ptr: b"".as_ptr(),
                path_len: 0,
                namespace_ptr: b"file".as_ptr(),
                namespace_len: b"file".len(),
                default_loader: Loader::File,
                external: core::ptr::null_mut(),
            }
        }
    }

    #[repr(C)]
    pub struct BunLogOptions {
        pub(crate) struct_size: usize,
        pub(crate) message_ptr: *const u8,
        pub(crate) message_len: usize,
        pub(crate) path_ptr: *const u8,
        pub(crate) path_len: usize,
        pub(crate) source_line_text_ptr: *const u8,
        pub(crate) source_line_text_len: usize,
        pub(crate) level: bun_ast::Level,
        // Field order matches `packages/bun-native-bundler-plugin-api/bundler_plugin.h`
        // `BunLogOptions` (`line, lineEnd, column, columnEnd`) — verified by the
        // `assert_ffi_layout!` offset checks below.
        pub(crate) line: i32,
        pub(crate) line_end: i32,
        pub(crate) column: i32,
        pub(crate) column_end: i32,
    }

    impl Default for BunLogOptions {
        fn default() -> Self {
            Self {
                struct_size: core::mem::size_of::<BunLogOptions>(),
                message_ptr: core::ptr::null(),
                message_len: 0,
                path_ptr: core::ptr::null(),
                path_len: 0,
                source_line_text_ptr: core::ptr::null(),
                source_line_text_len: 0,
                level: bun_ast::Level::Err,
                line: 0,
                line_end: 0,
                column: 0,
                column_end: 0,
            }
        }
    }

    // These structs are passed by-pointer to **third-party** native plugins via
    // `packages/bun-native-bundler-plugin-api/bundler_plugin.h`, so layout drift
    // is a silent ABI break for every plugin in the wild. Literals are the 64-bit
    // C layout from `bundler_plugin.h`.
    bun_core::assert_ffi_layout!(
        OnBeforeParseArguments, 64, 8;
        struct_size @ 0, context @ 8, path_ptr @ 16, path_len @ 24,
        namespace_ptr @ 32, namespace_len @ 40, default_loader @ 48, external @ 56,
    );
    bun_core::assert_ffi_layout!(
        BunLogOptions, 80, 8;
        struct_size @ 0, message_ptr @ 8, message_len @ 16, path_ptr @ 24,
        path_len @ 32, source_line_text_ptr @ 40, source_line_text_len @ 48,
        level @ 56, line @ 60, line_end @ 64, column @ 68, column_end @ 72,
    );
    bun_core::assert_ffi_layout!(
        OnBeforeParseResult, 64, 8;
        struct_size @ 0, source_ptr @ 8, source_len @ 16, loader @ 24,
        fetch_source_code_fn @ 32, user_context @ 40, free_user_context @ 48, log @ 56,
    );

    impl BunLogOptions {
        fn source_line_text(&self) -> &[u8] {
            if !self.source_line_text_ptr.is_null() && self.source_line_text_len > 0 {
                // SAFETY: genuine FFI — ptr/len are populated by a third-party native
                // plugin per `bundler_plugin.h`'s `BunLogOptions` ABI. Non-null and
                // len > 0 are checked above; the plugin contract requires the buffer
                // to remain valid for the duration of the `log` callback (the only
                // caller of this accessor), and `append` dupes before that returns.
                return unsafe {
                    core::slice::from_raw_parts(
                        self.source_line_text_ptr,
                        self.source_line_text_len,
                    )
                };
            }
            b""
        }

        fn path(&self) -> &[u8] {
            if !self.path_ptr.is_null() && self.path_len > 0 {
                // SAFETY: genuine FFI — ptr/len are populated by a third-party native
                // plugin per `bundler_plugin.h`'s `BunLogOptions` ABI. Non-null and
                // len > 0 are checked above; the plugin contract requires the buffer
                // to remain valid for the duration of the `log` callback, and
                // `append` dupes the bytes into the `Log` arena before that returns.
                return unsafe { core::slice::from_raw_parts(self.path_ptr, self.path_len) };
            }
            b""
        }

        fn message(&self) -> &[u8] {
            if !self.message_ptr.is_null() && self.message_len > 0 {
                // SAFETY: genuine FFI — ptr/len are populated by a third-party native
                // plugin per `bundler_plugin.h`'s `BunLogOptions` ABI. Non-null and
                // len > 0 are checked above; the plugin contract requires the buffer
                // to remain valid for the duration of the `log` callback, and
                // `append` dupes the bytes into the `Log` arena before that returns.
                return unsafe { core::slice::from_raw_parts(self.message_ptr, self.message_len) };
            }
            b""
        }

        fn append(&self, log: &mut Log, namespace: &'static [u8]) {
            // `Location.{file,line_text}`
            // are `&'static [u8]` here; `Log::dupe` copies into Log-owned storage
            // (freed when the Log drops) and returns a lifetime-erased borrow —
            // the "alloc-dupe into the log arena" pattern. We dupe `path` too:
            // a raw slice into C-plugin memory may be
            // freed after `log_fn` returns, so duping is required.
            let source_line_text = self.source_line_text();
            let file = log.dupe(self.path());
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
                    text: std::borrow::Cow::Owned(self.message().to_vec()),
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

        /// # Safety
        /// `args_` and `log_options_`, when non-null, must point at live
        /// `OnBeforeParseArguments` / `BunLogOptions` for the duration of the
        /// call (the native-plugin FFI contract).
        unsafe extern "C" fn log_fn(
            args_: *mut OnBeforeParseArguments,
            log_options_: *mut BunLogOptions,
        ) {
            // SAFETY: called from C plugin with valid ptrs or null.
            let Some(args) = (unsafe { args_.as_mut() }) else {
                return;
            };
            // SAFETY: called from C plugin; when non-null, `log_options_` points
            // to a live `BunLogOptions` for the duration of the call.
            let Some(log_options) = (unsafe { log_options_.as_ref() }) else {
                return;
            };
            // SAFETY: context backref valid for plugin call duration.
            let ctx = unsafe { &mut *args.context };
            log_options.append(ctx.log, ctx.file_path.namespace);
        }
    }

    #[repr(C)]
    struct OnBeforeParseResultWrapper {
        pub original_source: *const u8,
        pub original_source_len: usize,
        pub original_source_fd: Fd,
        pub loader: Loader,
        #[cfg(debug_assertions)]
        pub check: u32, // Value to ensure OnBeforeParseResult is wrapped in this struct
        // (the `cfg(debug_assertions)` gate
        // above removes the field entirely in release.)
        pub result: OnBeforeParseResult,
    }

    #[repr(C)]
    pub struct OnBeforeParseResult {
        pub(crate) struct_size: usize,
        pub(crate) source_ptr: *const u8,
        pub(crate) source_len: usize,
        pub(crate) loader: Loader,

        pub(crate) fetch_source_code_fn:
            unsafe extern "C" fn(*mut OnBeforeParseArguments, *mut OnBeforeParseResult) -> i32,

        pub(crate) user_context: *mut c_void,
        pub(crate) free_user_context: Option<extern "C" fn(*mut c_void)>,

        pub(crate) log: unsafe extern "C" fn(*mut OnBeforeParseArguments, *mut BunLogOptions),
    }

    impl OnBeforeParseResult {
        /// # Safety
        /// `result` must be the `.result` field of a live
        /// `OnBeforeParseResultWrapper`, with provenance covering the wrapper
        /// (derived via `addr_of_mut!(wrapper.result)`).
        unsafe fn get_wrapper(result: *mut OnBeforeParseResult) -> *mut OnBeforeParseResultWrapper {
            // SAFETY: result points to OnBeforeParseResultWrapper.result (always
            // constructed that way in `OnBeforeParsePlugin::run`).
            let wrapper =
                unsafe { bun_core::from_field_ptr!(OnBeforeParseResultWrapper, result, result) };
            #[cfg(debug_assertions)]
            // SAFETY: wrapper just computed via offset_of from valid result ptr.
            debug_assert_eq!(unsafe { (*wrapper).check }, 42069);
            wrapper
        }
    }

    /// # Safety
    /// `args` and `result_ptr` must point at the live `OnBeforeParseArguments`
    /// / `OnBeforeParseResultWrapper.result` set up by `OnBeforeParsePlugin::run`
    /// (the native-plugin FFI contract).
    unsafe extern "C" fn fetch_source_code(
        args: *mut OnBeforeParseArguments,
        result_ptr: *mut OnBeforeParseResult,
    ) -> i32 {
        scoped_log!(ParseTask, "fetchSourceCode");
        // SAFETY: called from C plugin; args/result are valid per FFI contract.
        // `args` and `*args.context` are disjoint allocations (the
        // `OnBeforeParseArguments` stack local vs. the `OnBeforeParsePlugin` it
        // points back to), so holding both `&mut` is sound.
        let args = unsafe { &mut *args };
        // SAFETY: `args.context` points to the `OnBeforeParsePlugin` that owns
        // this callback invocation; disjoint from `*args` (see above).
        let this = unsafe { &mut *args.context };
        if this.log.errors > 0
            || this.deferred_error.is_some()
            || this.should_continue_running.get() != 1
        {
            return 1;
        }

        {
            // SAFETY: `result_ptr` is the `.result` field of an
            // `OnBeforeParseResultWrapper` (see `OnBeforeParsePlugin::run`). Keep the
            // raw pointer un-shadowed so `get_wrapper`'s `from_field_ptr!` walk-back
            // retains provenance over the enclosing wrapper; a `&mut *result_ptr` here
            // would shrink provenance to just the `OnBeforeParseResult` and make the
            // later offset-walk UB. The `&mut` reborrow below is scoped to end before
            // any wrapper access so no overlapping `&mut` exists.
            let result = unsafe { &mut *result_ptr };
            if !result.source_ptr.is_null() {
                return 0;
            }

            let mut entry = match get_code_for_parse_task_without_plugins(
                this.task,
                this.log,
                this.transpiler,
                this.resolver,
                this.bump,
                this.file_path,
                result.loader,
            ) {
                Ok(e) => e,
                Err(e) => {
                    this.deferred_error = Some(e);
                    this.should_continue_running.set(0);
                    return 1;
                }
            };
            // `Contents::Owned(Vec<u8>)` (the file-read path — see
            // `.rs:1287` / `resolver/lib.rs:2285`) frees on drop, which would
            // leave `result.source_ptr` / `wrapper.original_source` dangling for
            // the native plugin and `OnBeforeParsePlugin::run` to read through.
            // Stash ownership on `this.original_contents` so the bytes outlive
            // the wrapper; `OnBeforeParsePlugin::run` returns it when the
            // plugin keeps the original source, or drops it when the plugin
            // replaces the source.
            let fd = entry.fd;
            this.original_contents = Some(core::mem::take(&mut entry.contents));
            let contents_slice = this
                .original_contents
                .as_ref()
                .expect("just set")
                .as_slice();
            let source_ptr = contents_slice.as_ptr();
            let source_len = contents_slice.len();
            result.source_ptr = source_ptr;
            result.source_len = source_len;
            result.free_user_context = None;
            result.user_context = core::ptr::null_mut();
            // SAFETY: `result_ptr` is `OnBeforeParseResultWrapper.result` (see above).
            let wrapper = unsafe { OnBeforeParseResult::get_wrapper(result_ptr) };
            // SAFETY: result is always embedded in a wrapper. Write wrapper fields
            // via raw pointer — `wrapper.result`
            // *is* `*result_ptr`, so materializing `&mut *wrapper` here would
            // overlap the live `result` borrow above (aliased-`&mut` UB).
            unsafe {
                (*wrapper).original_source = source_ptr;
                (*wrapper).original_source_len = source_len;
                (*wrapper).original_source_fd = fd;
            }
        }
        0
    }

    /// # Safety
    /// `this` must be the `.result` field of a live `OnBeforeParseResultWrapper`
    /// constructed by `OnBeforeParsePlugin::run` (called from C++ with that
    /// pointer).
    #[unsafe(no_mangle)]
    unsafe extern "C" fn OnBeforeParseResult__reset(this: *mut OnBeforeParseResult) {
        // SAFETY: `this` is the wrapper's `.result` field (caller contract).
        let wrapper = unsafe { OnBeforeParseResult::get_wrapper(this) };
        // SAFETY: called from C++ with valid ptr embedded in wrapper. Operate on
        // raw pointers throughout: `wrapper.result`
        // *is* `*this`, so materializing `&mut *this` alongside `&mut *wrapper`
        // would be aliased-`&mut` UB, and forming `&mut *this` first would shrink
        // provenance so `from_field_ptr!` in `get_wrapper` walks out of bounds.
        unsafe {
            (*this).loader = (*wrapper).loader;
            if !(*wrapper).original_source.is_null() {
                (*this).source_ptr = (*wrapper).original_source;
                (*this).source_len = (*wrapper).original_source_len;
            } else {
                (*this).source_ptr = core::ptr::null();
                (*this).source_len = 0;
            }
        }
    }

    /// # Safety
    /// `this` must point at the live `OnBeforeParsePlugin` set up by
    /// `OnBeforeParsePlugin::run` (called from C++ with that pointer).
    #[unsafe(no_mangle)]
    unsafe extern "C" fn OnBeforeParsePlugin__isDone(
        this: *mut OnBeforeParsePlugin<'_, '_>,
    ) -> i32 {
        // SAFETY: called from C++ with valid ptr. Read via raw pointers
        // — `wrapper.result` aliases `*result`, so forming
        // overlapping references would be UB, and a `&mut`-derived `*mut` would
        // lack provenance over the enclosing wrapper.
        unsafe {
            if (*this).should_continue_running.get() != 1 {
                return 1;
            }

            let result = (*this).result;
            if result.is_null() {
                return 1;
            }
            // The first plugin to set the source wins.
            // But, we must check that they actually modified it
            // since fetching the source stores it inside `result.source_ptr`
            let source_ptr = (*result).source_ptr;
            if !source_ptr.is_null() {
                let wrapper = OnBeforeParseResult::get_wrapper(result);
                return (source_ptr != (*wrapper).original_source) as i32;
            }
        }

        0
    }

    impl<'a, 'b: 'a> OnBeforeParsePlugin<'a, 'b> {
        pub(crate) fn run(
            &mut self,
            plugin: &bundler::JSBundlerPlugin,
            from_plugin: &mut bool,
        ) -> core::result::Result<CacheEntry, AnyError> {
            let mut args = OnBeforeParseArguments {
                // `context` is filled in immediately before the FFI call below —
                // deriving it here would create a raw from `&mut self` that gets
                // popped (Stacked Borrows) by the `&mut self` reads/writes that
                // follow, making the callback's `&mut *args.context` UB.
                path_ptr: self.file_path.text.as_ptr(),
                path_len: self.file_path.text.len(),
                default_loader: *self.loader,
                ..Default::default()
            };
            if !self.file_path.namespace.is_empty() {
                args.namespace_ptr = self.file_path.namespace.as_ptr();
                args.namespace_len = self.file_path.namespace.len();
            }
            let mut wrapper = OnBeforeParseResultWrapper {
                original_source: core::ptr::null(),
                original_source_len: 0,
                original_source_fd: Fd::INVALID,
                loader: *self.loader,
                #[cfg(debug_assertions)]
                check: 42069,
                result: OnBeforeParseResult {
                    struct_size: core::mem::size_of::<OnBeforeParseResult>(),
                    source_ptr: core::ptr::null(),
                    source_len: 0,
                    loader: *self.loader,
                    fetch_source_code_fn: fetch_source_code,
                    user_context: core::ptr::null_mut(),
                    free_user_context: None,
                    log: BunLogOptions::log_fn,
                },
            };

            // Raw pointer with provenance over the whole `wrapper` local so
            // `get_wrapper`'s offset_of walk-back stays in-bounds. Never form
            // `&mut wrapper.result` while this must reach the wrapper — that
            // retags and shrinks provenance to the inner `OnBeforeParseResult`
            // only, making `from_field_ptr!` in `get_wrapper` out-of-provenance
            // UB (and pushes a Unique tag that invalidates this raw under SB).
            let result_ptr = core::ptr::addr_of_mut!(wrapper.result);
            let namespace_str;
            let namespace = if self.file_path.namespace == b"file" {
                &bun_core::String::EMPTY
            } else {
                namespace_str = bun_core::String::init(self.file_path.namespace);
                &namespace_str
            };
            let path_str = bun_core::String::init(self.file_path.text);
            // Copy the `&Cell<i32>` out so passing it to FFI doesn't go through
            // `&mut self` after `self_ptr` is derived.
            let should_continue_running = self.should_continue_running;
            self.result = result_ptr;
            // Derive `args.context` *after* the last `&mut self` access above so
            // no parent-`&mut` use pops its SharedRW tag before the FFI callbacks
            // (`fetch_source_code` / `log_fn`) dereference it. Reuse the same raw
            // for the `ctx` argument instead of re-deriving from `&mut self`.
            let self_ptr = std::ptr::from_mut(self).cast::<OnBeforeParsePlugin<'static, 'static>>();
            args.context = self_ptr;
            let count = plugin.call_on_before_parse_plugins(
                self_ptr.cast(),
                namespace,
                &path_str,
                &raw mut args,
                result_ptr,
                should_continue_running,
            );
            if cfg!(feature = "debug_logs") {
                scoped_log!(
                    ParseTask,
                    "callOnBeforeParsePlugins({}:{}) = {}",
                    bstr::BStr::new(self.file_path.namespace),
                    bstr::BStr::new(self.file_path.text),
                    count
                );
            }
            if count > 0 {
                if let Some(e) = self.deferred_error {
                    if let Some(free_user_context) = wrapper.result.free_user_context {
                        free_user_context(wrapper.result.user_context);
                    }

                    return Err(e);
                }

                // If the plugin sets the `free_user_context` function pointer, it _must_ set the `user_context` pointer.
                // Otherwise this is just invalid behavior.
                if wrapper.result.user_context.is_null()
                    && wrapper.result.free_user_context.is_some()
                {
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
                    // `args.context == self` — use `self` directly; materializing
                    // a second `&mut` via `&mut *args.context` while `&mut self`
                    // is live would be aliased-`&mut` UB.
                    self.log.errors += 1;
                    let _ = self.log.add_msg(msg); // logger OOM-only
                    return Err(crate::Error::InvalidNativePlugin);
                }

                if self.log.errors > 0 {
                    if let Some(free_user_context) = wrapper.result.free_user_context {
                        free_user_context(wrapper.result.user_context);
                    }

                    return Err(crate::Error::SyntaxError);
                }

                if !wrapper.result.source_ptr.is_null() {
                    let ptr = wrapper.result.source_ptr;
                    // `ExternalFreeFunction.function` is `Option<unsafe extern "C" fn>`;
                    // `OnBeforeParseResult.free_user_context` is `Option<extern "C" fn>` (safe ABI per
                    // the C header). Coerce safe→unsafe via cast.
                    let free_fn = wrapper
                        .result
                        .free_user_context
                        .map(|f| f as unsafe extern "C" fn(*mut c_void));
                    if free_fn.is_some() {
                        self.task.external_free_function = ExternalFreeFunction {
                            ctx: wrapper.result.user_context,
                            function: free_fn,
                        };
                    }
                    *from_plugin = true;
                    *self.loader = wrapper.result.loader;
                    // If the plugin called `fetch_source_code` and left the
                    // source unchanged, hand the original `Contents` back to
                    // the caller so the buffer is reclaimed instead of leaked.
                    // Otherwise the plugin replaced the source; the original
                    // (if any) drops with `self`.
                    let contents =
                        if !wrapper.original_source.is_null() && ptr == wrapper.original_source {
                            self.original_contents
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
                self.task,
                self.log,
                self.transpiler,
                self.resolver,
                self.bump,
                self.file_path,
                *self.loader,
            )
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // getSourceCode
    // ───────────────────────────────────────────────────────────────────────────

    fn get_source_code(
        task: &mut ParseTask,
        this: &mut crate::Worker,
        log: &mut Log,
    ) -> core::result::Result<CacheEntry, AnyError> {
        // `Worker.arena` is a `BackRef` to `Worker.heap` once `has_created` (see
        // `ThreadPool::Worker::create`); the worker is pinned for the bundle pass.
        // Disjoint-field borrow vs `this.data` below.
        let bump: &Bump = this.arena.get();

        // `has_created` ⇒ `data`/`transpiler` were initialized in `create()`.
        let data = this.data.as_mut().expect("Worker.data set in create()");
        // `resolver` is a field of
        // `*transpiler`. Hold both as raw `*mut` and never materialize
        // `&mut Transpiler` while `resolver` is live — the callee chain takes raw
        // pointers and reborrows disjoint fields only.
        // SAFETY: `data.transpiler` is initialized (see above) and pinned for the
        // bundle pass.
        let transpiler: *mut Transpiler<'static> = &raw mut data.transpiler;
        // errdefer transpiler.resetStore() — reshaped: call on the err
        // path explicitly (scopeguard would alias `transpiler` access below).
        // SAFETY: `transpiler` is live; `resolver` projects a field of it.
        let resolver: *mut Resolver = unsafe { core::ptr::addr_of_mut!((*transpiler).resolver) };
        let mut file_path = task.path;
        let mut loader = task
            .loader
            // SAFETY: `options` is a disjoint field of the live `*transpiler`.
            .or_else(|| file_path.loader(unsafe { &(*transpiler).options.loaders }))
            .unwrap_or(Loader::File);

        let mut contents_came_from_plugin: bool = false;
        let result = get_code_for_parse_task(
            task,
            log,
            transpiler,
            resolver,
            bump,
            &mut file_path,
            &mut loader,
            &mut contents_came_from_plugin,
        );
        if result.is_err() {
            // SAFETY: `transpiler` is live; no other borrow of it is held here.
            unsafe { (*transpiler).reset_store() };
        }
        result
    }

    // ───────────────────────────────────────────────────────────────────────────
    // runWithSourceCode
    // ───────────────────────────────────────────────────────────────────────────

    fn run_with_source_code(
        task: &mut ParseTask,
        this: &mut crate::Worker,
        step: &mut Step,
        log: &mut Log,
        entry: &mut CacheEntry,
    ) -> core::result::Result<Success, AnyError> {
        // reshaped for borrowck — `transpiler_for_target` borrows `this`
        // mutably; we may need to call it again below (server-components branch),
        // so hold it as a raw pointer and reborrow per use site.
        //
        // Stacked-Borrows: derive a single raw `*mut Worker` once and route every
        // subsequent worker access through it. The second `transpiler_for_target`
        // call (server-components/browser branch) must NOT autoref `&mut *this`
        // directly — that retag of the parent `&mut` pops the SharedRW tag chain
        // backing the first `transpiler` (and the `resolver` field-projection
        // derived from it), making the later `(*resolver)` derefs in `get_ast` UB.
        // `transpiler` may be rebound below while `resolver` keeps
        // pointing into the original;
        // both calls' `&mut self` must be children of the same raw so neither pops
        // the other's tag chain.
        let worker_raw: *mut crate::Worker = this;
        // SAFETY: see `get_source_code` — worker arena pinned for the bundle pass.
        // `'static` matches `JSAst = BundledAst<'static>`; the arena outlives all
        // reads through the returned ASTs. `arena` is a `*const Bump` field; the
        // deref points outside `*worker_raw`.
        let bump: &'static Bump = unsafe { bun_ptr::detach_lifetime_ref(&*(*worker_raw).arena) };

        // SAFETY: `worker_raw` just derived from the live `this: &mut Worker`.
        let mut transpiler: *mut Transpiler<'static> =
            std::ptr::from_mut(unsafe { (*worker_raw).transpiler_for_target(task.known_target) });
        // Error-path cleanup (`transpiler.resetStore()` and
        // `if (.fd) entry.deinit(arena)`) is reshaped into the
        // explicit `match ast_result { Err(e) => ... }` cleanup below — scopeguard
        // would alias the `&mut Transpiler` / `&mut CacheEntry` borrows that
        // follow. There are no other fallible `?` between here and that match.
        // `resolver` is a field of
        // `*transpiler`. Keep raw — never materialize `&mut Transpiler`
        // while a `&mut` derived from `resolver` is live. `resolver` is
        // bound *before* the possible `transpiler` reassignment below and stays
        // pointing into the original target's transpiler.
        // SAFETY: `transpiler` just derived from a live `&mut`.
        let resolver: *mut Resolver = unsafe { core::ptr::addr_of_mut!((*transpiler).resolver) };
        let file_path = &mut task.path;
        let loader = task
            .loader
            // SAFETY: `options` is a disjoint field of the live `*transpiler` (see .rs:1955).
            .or_else(|| file_path.loader(unsafe { &(*transpiler).options.loaders }))
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

        // SAFETY: `worker_raw` derived from the live `this: &mut Worker` above.
        // Read the `BackRef` field via `worker_raw` (not `this`) so no
        // parent-`&mut` access pops the `transpiler`/`resolver` tag chain derived
        // above. `BackRef` is `Copy`; the deref to `&BundleV2` is safe.
        let worker_ctx = unsafe { (*worker_raw).ctx };

        // Only close a descriptor this task opened. A valid `file` was borrowed
        // from the resolver's entry cache (symlink-resolved files cache their fd
        // there); closing it leaves a stale fd for the next in-process build.
        let opened_own_fd =
            matches!(task.contents_or_fd, ContentsOrFd::Fd { file, .. } if !file.is_valid());
        let will_close_file_descriptor = opened_own_fd
            && entry.fd.is_valid()
            && entry.fd.stdio_tag().is_none()
            && worker_ctx.bun_watcher.is_none();
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

        // SAFETY: `transpiler` derived from a live `&mut` above. Reborrow only the
        // disjoint `options` field — never the whole struct — so the raw `resolver`
        // pointer (which targets `(*transpiler).resolver`) remains valid.
        let topts = unsafe { &(*transpiler).options };
        let use_directive: UseDirective = if !is_empty && topts.server_components {
            UseDirective::parse(entry_contents).unwrap_or(UseDirective::None)
        } else {
            UseDirective::None
        };

        if (use_directive == UseDirective::Client
        && task.known_target != options::Target::ServerComponentsSsr
        && worker_ctx.framework.is_some()
        && worker_ctx
            .framework
            .as_ref()
            .unwrap()
            .server_components
            .as_ref()
            .unwrap()
            .separate_ssr_graph)
        ||
        // set the target to the client when bundling client-side files
        ((topts.server_components || topts.has_dev_server())
            && task.known_target == options::Target::Browser)
        {
            // separate_ssr_graph makes boundaries switch to client because the server file uses that generated file as input.
            // this is not done when there is one server graph because it is easier for plugins to deal with.
            // SAFETY: route through `worker_raw` (see top-of-function note)
            // so this call's `&mut self` is a child of the same raw and does not
            // pop the SharedRW tag backing `resolver` (which still points into the
            // original target's transpiler).
            transpiler = std::ptr::from_mut(unsafe {
                (*worker_raw).transpiler_for_target(options::Target::Browser)
            });
        }
        // SAFETY: `transpiler` is a live worker-owned `*mut Transpiler` (possibly
        // reassigned above); reborrow only the disjoint `options` field.
        let topts = unsafe { &(*transpiler).options };

        // Allocated in the worker arena so `js_parser::new_lazy_export_ast`'s
        // `&'bump Source` parameter is satisfied (`bump` is the same arena).
        let source: &'static Source = bump.alloc(Source {
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
        // `AllowUnresolved` is the same nominal type on
        // both sides (re-export in options.rs). `'static` erasure: `topts` borrows
        // a worker-owned `Transpiler` that outlives the parse.
        // SAFETY: ARENA — `topts` outlives `opts` (worker-owned for the bundle pass).
        opts.allow_unresolved = unsafe { bun_collections::detach_ref(&topts.allow_unresolved) };
        // `Transpiler.macro_context` is `Option<bun_ast::Macro::MacroContext>`
        // (same nominal type as `ParserOptions.macro_context`'s pointee). Reborrow
        // through the raw `*mut Transpiler` so the `&mut MacroContext` is disjoint
        // from `topts` (which borrows `(*transpiler).options`). `.unwrap()` is
        // sound — caller (`BundleV2::init`) guarantees
        // it is set before any ParseTask runs.
        // SAFETY: `transpiler` is live; `macro_context` is a disjoint field.
        // `'static` erasure: the context outlives the parse.
        opts.macro_context = unsafe {
            Some(&mut *std::ptr::from_mut(
                (*transpiler).macro_context.as_mut().unwrap(),
            ))
        };
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
        opts.framework = topts.framework.map(|f| {
            // `Framework` is bump-allocated below, so `Drop` never runs — use arena-owned slices.
            let projected = js_parser::options::Framework {
                is_built_in_react: f.is_built_in_react,
                server_components: f.server_components.as_ref().map(|sc| {
                    js_parser::options::FrameworkServerComponents {
                        separate_ssr_graph: sc.separate_ssr_graph,
                        server_runtime_import: std::borrow::Cow::Borrowed(
                            bump.alloc_slice_copy(&sc.server_runtime_import),
                        ),
                        server_register_client_reference: std::borrow::Cow::Borrowed(
                            bump.alloc_slice_copy(&sc.server_register_client_reference),
                        ),
                        server_register_server_reference: std::borrow::Cow::Borrowed(
                            bump.alloc_slice_copy(&sc.server_register_server_reference),
                        ),
                        client_register_server_reference: std::borrow::Cow::Borrowed(
                            bump.alloc_slice_copy(&sc.client_register_server_reference),
                        ),
                    }
                }),
                react_fast_refresh: f.react_fast_refresh.as_ref().map(|rfr| {
                    js_parser::options::ReactFastRefresh {
                        import_source: std::borrow::Cow::Borrowed(
                            bump.alloc_slice_copy(&rfr.import_source),
                        ),
                    }
                }),
            };
            // SAFETY: ARENA — `bump: &'static Bump` (worker arena pinned for the
            // bundle pass), so `bump.alloc(..)` already yields a `&'static` borrow.
            unsafe {
                bun_collections::detach_ref::<js_parser::options::Framework>(bump.alloc(projected))
            }
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

        opts.tree_shaking = if task.source_index.is_runtime() {
            true
        } else {
            topts.tree_shaking
        };
        opts.code_splitting = topts.code_splitting;
        opts.module_type = task.module_type;

        task.jsx.parse = loader.is_jsx();

        let mut unique_key_for_additional_file = FileLoaderHash {
            key: ast::StoreStr::EMPTY,
            content_hash: 0,
        };
        // SAFETY: task.ctx backref valid for the bundle pass (outlives `'r`).
        let task_ctx = unsafe { task.ctx() };
        let module_type = opts.module_type;
        // `topts` (a `&BundleOptions`) is dead past this point; the callees take
        // raw `*mut Transpiler` and reborrow `(*transpiler).options` mutably.
        let _ = topts;
        let ast_result: core::result::Result<JSAst, AnyError> =
            if !is_empty || loader.handles_empty_file() {
                get_ast(
                    log,
                    transpiler,
                    opts,
                    bump,
                    resolver,
                    source,
                    loader,
                    task_ctx.unique_key,
                    &mut unique_key_for_additional_file,
                    &task_ctx.linker.has_any_css_locals,
                )
            } else if loader.is_css() {
                get_empty_css_ast(log, transpiler, opts, bump, source)
            } else if module_type == options::ModuleType::Esm {
                get_empty_ast::<E::Undefined>(log, transpiler, opts, bump, source)
            } else {
                get_empty_ast::<E::Object>(log, transpiler, opts, bump, source)
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
                // SAFETY: `transpiler` is live; no other borrow of it is held here.
                unsafe { (*transpiler).reset_store() };
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
            content_hash_for_additional_file: if loader.should_copy_for_bundling() {
                unique_key_for_additional_file.content_hash
            } else {
                0
            },
        })
    }

    // ───────────────────────────────────────────────────────────────────────────
    // runFromThreadPool
    // ───────────────────────────────────────────────────────────────────────────

    /// Live entry point for `task_callback` / `io_task_callback` (hoisted to
    /// `super::*`). Thin shim over `run_from_thread_pool_impl` so the public
    /// symbol stays stable while the body lives in a private fn for borrowck
    /// reshaping.
    // CONCURRENCY: see `task_callback` — `&mut ParseTask` is unique per callback
    // invocation; all shared state is accessed via `&BundleV2` (read-only) or
    // the per-OS-thread `Worker` arena.
    pub(crate) fn run_from_thread_pool(this: &mut ParseTask) {
        run_from_thread_pool_impl(this);
    }

    fn run_from_thread_pool_impl(this: &mut ParseTask) {
        // SAFETY: ctx backref valid for the bundle pass (outlives this task).
        let ctx = unsafe { this.ctx() };
        let worker: &mut crate::Worker = crate::Worker::get(ctx);
        // `defer worker.unget()` — handled at function exit (scopeguard
        // would alias the `&mut worker` borrows below).
        scoped_log!(
            ParseTask,
            "ParseTask(0x{:x}, {}) callback",
            std::ptr::from_mut(this) as usize,
            bstr::BStr::new(this.path.text)
        );

        let mut step: Step = Step::Pending;
        let mut log = Log::init();
        debug_assert!(this.source_index.is_valid()); // forgot to set source_index

        let value: ResultValue = 'value: {
            if matches!(this.stage, ParseTaskStage::NeedsSourceCode) {
                match get_source_code(this, worker, &mut log) {
                    Ok(entry) => this.stage = ParseTaskStage::NeedsParse(entry),
                    Err(e) => {
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

                if crate::ThreadPool::uses_io_pool() {
                    // SAFETY: `pool` is a `NonNull<ThreadPool>` BACKREF live for the
                    // bundle pass.
                    ctx.graph.pool().schedule_inside_thread_pool(this);
                    worker.unget();
                    return;
                }
            }

            // reshaped for borrowck — `this` and `this.stage.needs_parse`
            // both borrowed mutably. The entry must live
            // in-place so its `Contents::Owned` buffer survives in
            // `task.stage` for the bundle's lifetime (Success.source.contents
            // borrows it via the arena-erased `StoreStr` path). Take it out, parse, then *write it
            // back* on every path before `break 'value` so dropping the local
            // can't free the buffer underneath the borrowed source.
            let mut entry =
                match core::mem::replace(&mut this.stage, ParseTaskStage::NeedsSourceCode) {
                    ParseTaskStage::NeedsParse(e) => e,
                    ParseTaskStage::NeedsSourceCode => unreachable!(),
                };
            let parsed = run_with_source_code(this, worker, &mut step, &mut log, &mut entry);
            this.stage = ParseTaskStage::NeedsParse(entry);
            match parsed {
                Ok(ast) => {
                    // When using HMR, always flag asts with errors as parse failures.
                    // Not done outside of the dev server out of fear of breaking existing code.
                    if ctx.transpiler().options.has_dev_server() && ast.log.has_errors() {
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

        let result = Box::new(Result {
            ctx: this.ctx.expect("ParseTask.ctx unset"),
            task: EventLoop::Task::default(),
            value,
            // `ExternalFreeFunction`
            // doesn't derive `Copy`, so move it out (task is consumed here).
            external: core::mem::take(&mut this.external_free_function),
            watcher_data: match this.contents_or_fd {
                ContentsOrFd::Fd { file, dir } => WatcherData {
                    fd: file,
                    dir_fd: dir,
                },
                ContentsOrFd::Contents(_) => WatcherData::NONE,
            },
        });
        let result = bun_core::heap::into_raw(result);

        // `ParseTask` is arena-owned (no Drop); `jsx` may hold owned slices from tsconfig.
        drop(core::mem::take(&mut this.jsx));

        // `worker.ctx` is a `BackRef<BundleV2>` (safe `Deref`); the BACKREF deref
        // of `linker.r#loop` is centralised in `LinkerContext::any_loop_mut`.
        //
        // The loop is effectively non-optional — `BundleV2::init`
        // always sets `linker.r#loop` before scheduling any ParseTask. Running
        // `on_complete` inline on the worker thread would violate
        // `BundleV2::on_parse_task_complete`'s threading contract (it mutates the
        // bundler graph, which is owned by the main/bundler thread).
        match worker
            .ctx
            .linker
            .any_loop_mut()
            .expect("BundleV2.linker.loop must be set before scheduling ParseTask")
        {
            bun_event_loop::AnyEventLoop::Js { owner } => {
                owner.enqueue_task_concurrent(
                    bun_event_loop::ConcurrentTask::ConcurrentTask::from_callback(result, |p| {
                        // SAFETY: `p` is the `result` Box leaked above; ownership
                        // transfers to `on_complete`, which deallocates it.
                        unsafe { on_complete(p) };
                        Ok(())
                    }),
                );
            }
            bun_event_loop::AnyEventLoop::Mini(mini) => {
                // SAFETY: `result` is a valid heap pointer with `task` at the given offset;
                // ownership transfers to the mini event loop which frees it after `on_complete_mini`.
                unsafe {
                    mini.enqueue_task_concurrent_with_extra_ctx::<Result, BundleV2<'static>>(
                        result,
                        on_complete_mini,
                        offset_of!(Result, task),
                    );
                }
            }
        }
        // Runs at function exit, i.e. after enqueue.
        worker.unget();
    }

    // The struct-only `dealloc` below skips field Drop; the `Log` is the only
    // heap-owning field `on_parse_task_complete` doesn't move out, so take it here.
    fn drop_result_owned_fields(result: &mut Result) {
        match &mut result.value {
            ResultValue::Success(s) => drop(core::mem::take(&mut s.log)),
            ResultValue::Err(e) => drop(core::mem::take(&mut e.log)),
            ResultValue::Empty { .. } => {}
        }
    }

    fn on_complete_mini(result: *mut Result, ctx: *mut BundleV2<'static>) {
        // SAFETY: callback contract — `result` was heap-allocated above; `ctx` is
        // the BACKREF stashed in `result.ctx`.
        BundleV2::on_parse_task_complete(unsafe { &mut *result }, unsafe { &mut *ctx });
        // SAFETY: `result` is uniquely owned (callback contract).
        drop_result_owned_fields(unsafe { &mut *result });
        // `drop(heap::take(result))` would run full Drop glue:
        // `on_parse_task_complete` SWAPS `result.value.Success.source` with the
        // graph's placeholder and moves `result.ast` out, so post-swap
        // `result.value` holds the *placeholder* `Source` whose
        // `contents: Cow::Borrowed` may alias plugin-/loader-provided bytes the
        // graph's swapped-in Source still references (asan use-after-poison at
        // process_files_to_copy:4241 in bundler_loader/_plugin tests). So:
        // dealloc the box without running Drop.
        // SAFETY: `result` came from `bun_core::heap::into_raw(Box<Result>)`
        // above; uniquely owned. Dealloc with the same layout, no field Drop.
        unsafe { std::alloc::dealloc(result.cast::<u8>(), std::alloc::Layout::new::<Result>()) };
    }

    /// # Safety
    /// `result` must be a live, uniquely-owned heap allocation produced by
    /// `bun_core::heap::into_raw(Box<Result>)` in `run_from_thread_pool_impl`
    /// (or `ServerComponentParseTask`'s equivalent). Ownership transfers to
    /// this fn, which deallocates `result` before returning. Must run on the
    /// main/bundler thread (it dereferences `result.ctx` mutably).
    pub unsafe fn on_complete(result: *mut Result) {
        // SAFETY: result allocated via heap::alloc above; uniquely owned here.
        let r = unsafe { &mut *result };
        let ctx = r.ctx;
        // SAFETY: `ctx` is a ParentRef<BundleV2> stored with write provenance
        // (`from_raw_mut` in `ParseTask::init`); the BundleV2 outlives the bundle
        // pass and no other `&mut BundleV2` is live on this (main) thread when the
        // event-loop callback fires. `r` and `*ctx` are disjoint allocations.
        BundleV2::on_parse_task_complete(r, unsafe { ctx.assume_mut() });
        drop_result_owned_fields(r);
        // See `on_complete_mini` for why this is `dealloc`, not `drop(take(_))`.
        // SAFETY: `result` came from `bun_core::heap::into_raw(Box<Result>)`
        // above; uniquely owned. Dealloc with the same layout, no field Drop.
        unsafe { std::alloc::dealloc(result.cast::<u8>(), std::alloc::Layout::new::<Result>()) };
    }
} // end mod parse_worker

pub(crate) use parse_worker::on_complete;
