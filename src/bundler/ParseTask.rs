//! Port of src/bundler/ParseTask.zig
//!
//! A `ParseTask` is the unit of work scheduled on the thread pool for each
//! source file the bundler needs to parse. It carries everything needed to
//! read the file (or use already-loaded contents), run the JS/CSS/etc. parser,
//! and ship a `Result` back to the bundler thread.

use core::ffi::c_void;
use core::mem::offset_of;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_alloc::Arena as Bump; // bumpalo::Bump re-export
use bun_collections::BabyList;
use bun_core::{self, declare_scope, scoped_log, err, Error as AnyError, FeatureFlags};
use bun_logger::{self as logger, Loc, Location, Log, Msg, Source};
use bun_options_types::ImportRecord;
use bun_string::{self, strings};
use bun_sys::Fd;
// PORT NOTE: Zig `bun.threading.ThreadPool` is the *module*; the draft used the
// struct alias which made `ThreadPoolLib::Task` unresolvable. Import the module.
use bun_threading::thread_pool as ThreadPoolLib;

use bun_js_parser::{
    self as js_parser,
    ast::{self, Expr, Part, E, G},
};
use bun_js_parser::Index;
// PORT NOTE: `BundledAst<'arena>` — the bundler graph stores `'static`-erased
// ASTs (arena outlives the link step). Use the crate-level alias so the
// `Success`/helper signatures don't carry an explicit `'static` everywhere.
use crate::ungate_support::JSAst;
/// `js_parser.Parser.Options` — the real parser-entry options struct.
pub use bun_js_parser::parser::ParserOptions;

use crate::bun_css;
use crate::bundle_v2::{self as bundler, BundleV2};
use crate::ungate_support::{target_from_hashbang, ContentHasher, UseDirective, perf};
use crate::cache::{Entry as CacheEntry, ExternalFreeFunction};
use crate::html_scanner::HTMLScanner;
use crate::options::{self, Loader};
use crate::bun_fs as Fs;
use crate::bun_node_fallbacks as NodeFallbackModules;
use bun_resolver::{self as _resolver, Resolver};
use crate::transpiler::Transpiler;

declare_scope!(ParseTask, hidden);

/// `bun.jsc.EventLoopTask` (ParseTask.zig:Result.task). T6 type erased here.
#[allow(non_snake_case)]
mod EventLoop {
    pub type Task = bun_event_loop::ConcurrentTask::ConcurrentTask;
}

// PORT NOTE: arena-lifetime erasure helper. Slices borrowed from the per-file
// parse arena (or `Source.contents: Cow<'static,[u8]>`) outlive the link step;
// see TODO(port): arena lifetime notes throughout. Centralized so the unsafe
// transmute is auditable.
#[inline(always)]
fn leak_static(s: &[u8]) -> &'static [u8] {
    // SAFETY: ARENA — caller guarantees `s` borrows storage that outlives all
    // reads through the returned slice (parse arena / interned source bytes).
    unsafe { core::mem::transmute::<&[u8], &'static [u8]>(s) }
}

// CYCLEBREAK FORWARD_DECL bridges: `JSBundlerPlugin` / `FileMap` are opaque
// `[u8; 0]` in `bundle_v2.rs`; the real bodies live in T6 (`jsc::api::JSBundler`).
// These impls forward to the C++ entry points via FFI so ParseTask can call
// them without naming the gated `__phase_a_draft::api` module.
unsafe extern "C" {
    fn JSBundlerPlugin__hasOnBeforeParsePlugins(this: *const bundler::JSBundlerPlugin) -> i32;
    fn JSBundlerPlugin__callOnBeforeParsePlugins(
        this: *const bundler::JSBundlerPlugin,
        ctx: *mut c_void,
        namespace: *const bun_string::String,
        path: *const bun_string::String,
        args: *mut c_void,
        result: *mut c_void,
        should_continue_running: *mut i32,
    ) -> i32;
}
impl bundler::JSBundlerPlugin {
    #[inline]
    pub(crate) fn has_on_before_parse_plugins(&self) -> bool {
        // SAFETY: `self` is a live opaque C++ BunPlugin; FFI signature matches.
        unsafe { JSBundlerPlugin__hasOnBeforeParsePlugins(self) != 0 }
    }
    #[inline]
    pub(crate) fn call_on_before_parse_plugins(
        &self,
        ctx: *mut c_void,
        namespace: &bun_string::String,
        path: &bun_string::String,
        args: *mut parse_worker::OnBeforeParseArguments,
        result: *mut parse_worker::OnBeforeParseResult,
        should_continue_running: *mut i32,
    ) -> i32 {
        // SAFETY: `self` is a live opaque C++ BunPlugin; FFI signature matches.
        unsafe {
            JSBundlerPlugin__callOnBeforeParsePlugins(
                self,
                ctx,
                namespace,
                path,
                args.cast(),
                result.cast(),
                should_continue_running,
            )
        }
    }
}
// PORT NOTE: `FileMap::get` now lives on the real `JSBundler::FileMap` in
// bundle_v2.rs (no longer an opaque CYCLEBREAK forward-decl). The placeholder
// always-miss `get` shim that used to sit here has been removed so the two
// inherent impls don't collide.

// ───────────────────────────────────────────────────────────────────────────
// ContentsOrFd
// ───────────────────────────────────────────────────────────────────────────

pub enum ContentsOrFd {
    Fd { dir: Fd, file: Fd },
    // TODO(port): arena lifetime — contents may be arena-owned, plugin-owned,
    // or &'static (runtime). Using &'static as Phase-A placeholder.
    Contents(&'static [u8]),
}

#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum ContentsOrFdTag {
    Fd,
    Contents,
}

impl ContentsOrFd {
    pub fn tag(&self) -> ContentsOrFdTag {
        match self {
            ContentsOrFd::Fd { .. } => ContentsOrFdTag::Fd,
            ContentsOrFd::Contents(_) => ContentsOrFdTag::Contents,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// ParseTask
// ───────────────────────────────────────────────────────────────────────────

pub struct ParseTask {
    // PORT NOTE: lifetime-erased `'static` — paths borrow from `DirnameStore`
    // (process-lifetime BSS string pool); see `bun_resolver::fs::Path<'a>`.
    pub path: Fs::Path<'static>,
    pub secondary_path_for_commonjs_interop: Option<Fs::Path<'static>>,
    pub contents_or_fd: ContentsOrFd,
    pub external_free_function: ExternalFreeFunction,
    pub side_effects: _resolver::SideEffects,
    pub loader: Option<Loader>,
    pub jsx: options::jsx::Pragma,
    pub source_index: Index,
    pub task: ThreadPoolLib::Task,

    // Split this into a different task so that we don't accidentally run the
    // tasks for io on the threads that are meant for parsing.
    pub io_task: ThreadPoolLib::Task,

    // Used for splitting up the work between the io and parse steps.
    pub stage: ParseTaskStage,

    pub tree_shaking: bool,
    pub known_target: options::Target,
    pub module_type: options::ModuleType,
    pub emit_decorator_metadata: bool,
    pub experimental_decorators: bool,
    pub ctx: *mut BundleV2<'static>, // BACKREF (LIFETIMES.tsv) — Zig `*BundleV2` is mutable; written through in `on_complete`.
    // TODO(port): arena lifetime — borrowed from package_json
    pub package_version: &'static [u8],
    pub package_name: &'static [u8],
    pub is_entry_point: bool,
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
    pub task: EventLoop::Task,
    pub ctx: *mut BundleV2<'static>, // BACKREF (LIFETIMES.tsv) — Zig `*BundleV2` is mutable; written through in `on_complete`.
    pub value: ResultValue,
    pub watcher_data: WatcherData,
    /// This is used for native onBeforeParsePlugins to store
    /// a function pointer and context pointer to free the
    /// returned source code by the plugin.
    pub external: ExternalFreeFunction,
}

pub enum ResultValue {
    Success(Success),
    Err(ResultError),
    Empty { source_index: Index },
}

pub struct WatcherData {
    pub fd: Fd,
    pub dir_fd: Fd,
}

impl WatcherData {
    /// When no files to watch, this encoding is used.
    pub const NONE: WatcherData = WatcherData {
        fd: Fd::INVALID,
        dir_fd: Fd::INVALID,
    };
}

pub struct Success {
    pub ast: JSAst,
    pub source: Source,
    pub log: Log,
    pub use_directive: UseDirective,
    pub side_effects: _resolver::SideEffects,

    /// Used by "file" loader files.
    // TODO(port): arena lifetime
    pub unique_key_for_additional_file: &'static [u8],
    /// Used by "file" loader files.
    pub content_hash_for_additional_file: u64,

    pub loader: Loader,

    /// The package name from package.json, used for barrel optimization.
    // TODO(port): arena lifetime
    pub package_name: &'static [u8],
}

pub struct ResultError {
    pub err: AnyError,
    pub step: Step,
    pub log: Log,
    pub target: options::Target,
    pub source_index: Index,
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
    // blocked_on: cross-crate type divergence —
    //   - `_resolver::Result.path_pair.primary` is `bun_resolver::fs::Path<'_>`
    //     (lifetime'd mirror), distinct from the `'static` `bun_resolver::fs::Path`
    //     this struct stores;
    //   - `_resolver::Result.jsx` is `bun_resolver::options::jsx::Pragma`
    //     (resolver-local TYPE_ONLY mirror), distinct from
    //     `crate::options::jsx::Pragma`;
    //   - `_resolver::Result.module_type` is
    //     `bun_options_types::BundleEnums::ModuleType`, distinct from
    //     `crate::options::ModuleType` (`options_impl::ModuleType` — local enum
    //     not yet unified with the lower-tier def).
    // All three collapse to `clone()`/direct-assign once the TYPE_ONLY mirrors
    // unify (lib.rs `pub mod options` shadow + resolver `fs::Path` lifetime
    // erasure). Body preserved verbatim for that flip.
    
    pub fn init(
        resolve_result: &_resolver::Result,
        source_index: Index,
        // Zig `ctx: *BundleV2` — take `*mut` so the stored BACKREF retains
        // write provenance for `on_complete` (a `&BundleV2` param would shrink
        // provenance to read-only, making the later `&mut *ctx` UB).
        ctx: *mut BundleV2<'_>,
    ) -> ParseTask {
        // SAFETY: `package_json` is `Option<*const PackageJSON>`; the resolver
        // arena outlives the bundle pass, so deref'ing the raw pointer here to
        // borrow `name`/`version` is sound. Slices are leaked to `'static` per
        // the Phase-A arena-lifetime convention (TODO(port): arena lifetime).
        let (package_name, package_version): (&'static [u8], &'static [u8]) =
            match resolve_result.package_json {
                Some(pj) => unsafe {
                    let pj = &*pj;
                    (
                        core::mem::transmute::<&[u8], &'static [u8]>(&pj.name[..]),
                        core::mem::transmute::<&[u8], &'static [u8]>(&pj.version[..]),
                    )
                },
                None => (b"", b""),
            };
        // SAFETY: caller passes a live `&mut BundleV2` coerced to `*mut`; we
        // only read `transpiler().options.target` here.
        let known_target = unsafe { (*ctx).transpiler().options.target };
        ParseTask {
            // SAFETY: lifetime erased — `ctx` outlives the ParseTask (BACKREF).
            ctx: ctx as *mut BundleV2<'static>,
            path: resolve_result.path_pair.primary.clone(),
            contents_or_fd: ContentsOrFd::Fd {
                dir: resolve_result.dirname_fd,
                file: resolve_result.file_fd,
            },
            side_effects: resolve_result.primary_side_effects_data,
            // TODO(port): TYPE_ONLY divergence — `_resolver::Result.jsx` is
            // `bun_resolver::options::jsx::Pragma`, distinct from
            // `crate::options::jsx::Pragma`. Collapses to `.clone()` once the
            // mirrors unify (see blocked_on note above).
            jsx: Default::default(),
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
            // TODO(port): Zig struct-field defaults; Rust has no per-field
            // default syntax. Consider impl Default for ParseTask in Phase B
            // and use `..Default::default()` here.
        }
    }

    /// Re-export of `parse_worker::get_runtime_source` as an associated fn so
    /// callers can spell it `ParseTask::get_runtime_source` (matches Zig).
    #[inline]
    pub fn get_runtime_source(target: options::Target) -> RuntimeSource {
        parse_worker::get_runtime_source(target)
    }
}

impl Default for ParseTask {
    fn default() -> Self {
        ParseTask {
            ctx: core::ptr::null_mut(),
            path: Fs::Path::init(b""),
            secondary_path_for_commonjs_interop: None,
            contents_or_fd: ContentsOrFd::Contents(b""),
            external_free_function: ExternalFreeFunction::NONE,
            side_effects: _resolver::SideEffects::HasSideEffects,
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
            package_version: b"",
            package_name: b"",
            is_entry_point: false,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// taskCallback / ioTaskCallback — thread-pool entry points. Real `unsafe fn`
// signatures matching `ThreadPoolLib::Task.callback`; bodies dispatch to
// `parse_worker::run_from_thread_pool` once the `ThreadPool::Worker` module
// un-gates (lib.rs ` pub mod ThreadPool`).
// ───────────────────────────────────────────────────────────────────────────

pub unsafe fn io_task_callback(task: *mut ThreadPoolLib::Task) {
    // SAFETY: task points to ParseTask.io_task (intrusive field).
    let parse_task = unsafe {
        &mut *(task as *mut u8)
            .sub(offset_of!(ParseTask, io_task))
            .cast::<ParseTask>()
    };
    parse_worker::run_from_thread_pool(parse_task);
}

pub unsafe fn task_callback(task: *mut ThreadPoolLib::Task) {
    // SAFETY: task points to ParseTask.task (intrusive field).
    let parse_task = unsafe {
        &mut *(task as *mut u8)
            .sub(offset_of!(ParseTask, task))
            .cast::<ParseTask>()
    };
    parse_worker::run_from_thread_pool(parse_task);
}

// ───────────────────────────────────────────────────────────────────────────
// RuntimeSource
// ───────────────────────────────────────────────────────────────────────────

pub struct RuntimeSource {
    pub parse_task: ParseTask,
    pub source: Source,
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
// Un-gated B-2: struct/FFI surface and `get_runtime_source` are real. Bodies
// that touch the still-gated `crate::ThreadPool` Worker module or the opaque
// `JSBundlerPlugin`/`FileMap` forward-decls remain ``-gated
// per-function below with explicit `// blocked_on:` notes; they un-gate by
// deletion once those modules land.
// ══════════════════════════════════════════════════════════════════════════
pub mod parse_worker {
use super::*;

fn get_runtime_source_comptime(target: options::Target) -> RuntimeSource {
    use const_format::concatcp;

    let runtime_code: &'static str = match target {
        options::Target::Bun => {
            concatcp!(include_str!("../runtime.js"), RUNTIME_REQUIRE_BUN, RUNTIME_USING_BUN)
        }
        options::Target::BunMacro => {
            concatcp!(include_str!("../runtime.js"), RUNTIME_REQUIRE_BUN, RUNTIME_USING_OTHER)
        }
        options::Target::Node => {
            concatcp!(include_str!("../runtime.js"), RUNTIME_REQUIRE_NODE, RUNTIME_USING_OTHER)
        }
        _ => {
            concatcp!(include_str!("../runtime.js"), RUNTIME_REQUIRE_OTHER, RUNTIME_USING_OTHER)
        }
    };
    // PERF(port): Zig built one comptime string per Target variant via
    // `inline else`. Here we use `const_format::concatcp!` per arm; the match
    // itself is runtime but each arm yields a &'static str. Profile in Phase B
    // if the extra match matters (it shouldn't — called once).

    let parse_task = ParseTask {
        // TODO(port): Zig used `undefined` for ctx; using null ptr.
        ctx: core::ptr::null_mut(),
        path: Fs::Path::init_with_namespace(b"runtime", b"bun:runtime"),
        side_effects: _resolver::SideEffects::NoSideEffectsPureData,
        jsx: options::jsx::Pragma { parse: false, ..Default::default() },
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
        package_version: b"",
        package_name: b"",
        is_entry_point: false,
    };
    let source = Source {
        // PORT NOTE: `logger::Source.path` is `bun_logger::fs::Path`, distinct
        // from `bun_resolver::fs::Path` (CYCLEBREAK TYPE_ONLY mirror). Construct
        // directly rather than `clone()` across the type boundary.
        path: bun_logger::fs::Path {
            text: b"runtime",
            namespace: b"bun:runtime",
            name: bun_logger::fs::PathName::init(b"runtime"),
            pretty: b"",
            is_disabled: false,
            is_symlink: false,
        },
        contents: std::borrow::Cow::Borrowed(runtime_code.as_bytes()),
        // PORT NOTE: `Source.index` is `bun_logger::Index` (newtype `u32`),
        // distinct from `bun_options_types::Index`. Runtime source is index 0.
        index: bun_logger::Index(Index::RUNTIME.get()),
        ..Default::default()
    };
    RuntimeSource { parse_task, source }
}

pub fn get_runtime_source(target: options::Target) -> RuntimeSource {
    // PERF(port): Zig `switch (target) { inline else => |t| comptime ... }`
    // monomorphized per variant at comptime. Runtime dispatch here is fine
    // since each arm in `get_runtime_source_comptime` already yields static data.
    get_runtime_source_comptime(target)
}

// ───────────────────────────────────────────────────────────────────────────
// getEmptyCSSAST / getEmptyAST
// ───────────────────────────────────────────────────────────────────────────

// blocked_on: `js_parser::new_lazy_export_ast` body (parser.rs round-D gate —
// `Parser::to_lazy_export_ast`); `bun_css::BundlerStyleSheet` (gated upstream);
// `Expr::init` overload set for arbitrary `E::*` defaults.

// PORT NOTE: `transpiler: *mut Transpiler` (raw, Zig `*Transpiler`). Callers
// (`get_ast`, `run_with_source_code`) may also hold a raw pointer to
// `(*transpiler).resolver`; materializing `&mut Transpiler` here would assert
// exclusive access to the whole struct and invalidate that sibling pointer.
// We only touch the disjoint `options.define` field.
fn get_empty_css_ast(
    log: &mut Log,
    transpiler: *mut Transpiler,
    opts: ParserOptions,
    bump: &'static Bump,
    source: &Source,
) -> core::result::Result<JSAst, AnyError> {
    let root = Expr::init(E::Object::default(), Loc { start: 0 });
    // SAFETY: `transpiler` is a live worker-owned `*mut Transpiler`; `options`
    // is disjoint from any other field the caller may hold a pointer to.
    let define = unsafe { &mut (*transpiler).options.define };
    let mut ast = JSAst::init(
        js_parser::new_lazy_export_ast(bump, define, opts, log, root, source, b"")?
            .unwrap(),
    );
    ast.css = Some(bump.alloc(bun_css::BundlerStyleSheet::empty()) as *mut _ as *mut c_void);
    Ok(ast)
}

fn get_empty_ast<RootType: Default + ast::expr::IntoExprData>(
    log: &mut Log,
    transpiler: *mut Transpiler,
    opts: ParserOptions,
    bump: &'static Bump,
    source: &Source,
) -> core::result::Result<JSAst, AnyError> {
    let root = Expr::init(RootType::default(), Loc::EMPTY);
    // SAFETY: see `get_empty_css_ast` — disjoint field of a live `*mut Transpiler`.
    let define = unsafe { &mut (*transpiler).options.define };
    Ok(JSAst::init(
        js_parser::new_lazy_export_ast(bump, define, opts, log, root, source, b"")?
            .unwrap(),
    ))
}

// ───────────────────────────────────────────────────────────────────────────
// FileLoaderHash
// ───────────────────────────────────────────────────────────────────────────

pub struct FileLoaderHash {
    // TODO(port): arena lifetime
    pub key: &'static [u8],
    pub content_hash: u64,
}

// ───────────────────────────────────────────────────────────────────────────
// getAST
// ───────────────────────────────────────────────────────────────────────────

// blocked_on: per-loader branches require:
//   - `resolver.caches.js.parse` / `resolver.caches.json.parse_json` (gated in
//     `bun_resolver::cache_set`);
//   - `bun_interchange::{toml,yaml,json5}` parser entry points;
//   - `bun_css::BundlerStyleSheet::parse_bundler` (gated upstream);
//   - `crate::HTMLScanner` (gated module);
//   - `bun_core::fmt::bytes_to_hex_lower` Display adaptor;
//   - `js_parser::new_lazy_export_ast` body (round-D).
// The signature now names the real `ParserOptions`; body un-gates in lockstep
// with the above.

// PORT NOTE: `transpiler`/`resolver` are raw `*mut` (Zig `*Transpiler` /
// `*Resolver`). In Zig the caller passes `resolver = &transpiler.resolver`, so
// the two may point into the same allocation. Taking `&mut Transpiler` +
// `&mut Resolver` would be aliased-`&mut` UB. We instead reborrow only the
// disjoint `(*transpiler).options` field, never the whole struct.
#[allow(clippy::too_many_arguments)]
fn get_ast(
    log: &mut Log,
    transpiler: *mut Transpiler,
    opts: ParserOptions,
    bump: &'static Bump,
    resolver: *mut Resolver,
    source: &Source,
    loader: Loader,
    unique_key_prefix: u64,
    unique_key_for_additional_file: &mut FileLoaderHash,
    has_any_css_locals: &AtomicU32,
) -> core::result::Result<JSAst, AnyError> {
    use core::fmt::Write as _;

    // SAFETY: `transpiler` is a live worker-owned `*mut Transpiler`.
    // `options` and `resolver` are disjoint fields of `Transpiler`; reborrowing
    // `options` here does not overlap any access through `resolver` below.
    let topts = unsafe { &mut (*transpiler).options };

    match loader {
        Loader::Jsx | Loader::Tsx | Loader::Js | Loader::Ts => {
            let _trace = perf::trace("Bundler.ParseJS");
            // PORT NOTE: `ParserOptions` is not `Clone` (holds `&'a mut MacroContext`).
            // Read what the fallback needs *before* moving `opts` into the parser.
            let module_type = opts.module_type;
            return if let Some(res) = (crate::cache::JavaScript {}).parse(
                bump, // TODO(port): zig passed transpiler.allocator
                opts,
                &topts.define,
                log,
                source,
            )? {
                // PORT NOTE: Zig's `js_parser.Result` is a bare-union whose
                // `.ast` field is read unconditionally. The Rust port models it
                // as an enum; `Cached`/`AlreadyBundled` are runtime-loader
                // states that never reach the bundler's `getAST`, so unwrap.
                match res {
                    bun_js_parser::Result::Ast(ast) => Ok(JSAst::init(ast)),
                    bun_js_parser::Result::Cached
                    | bun_js_parser::Result::AlreadyBundled(_) => {
                        unreachable!("bundler parse never yields Cached/AlreadyBundled")
                    }
                }
            } else if module_type == options::ModuleType::Esm {
                get_empty_ast::<E::Undefined>(log, transpiler, ParserOptions::default(), bump, source)
            } else {
                get_empty_ast::<E::Object>(log, transpiler, ParserOptions::default(), bump, source)
            };
            // PERF(port): Zig used `switch (bool) { inline else => |as_undefined| ... }`
            // to monomorphize the RootType. Expanded to two calls.
        }
        Loader::Json | Loader::Jsonc => {
            let _trace = perf::trace("Bundler.ParseJSON");
            let mode = if matches!(loader, Loader::Jsonc) {
                bun_resolver::tsconfig_json::JsonMode::Jsonc
            } else {
                bun_resolver::tsconfig_json::JsonMode::Json
            };
            // SAFETY: `resolver` is a live `*mut Resolver` (Zig `*Resolver`);
            // `caches` is disjoint from `(*transpiler).options` reborrowed above.
            let root: Expr = unsafe { &mut (*resolver).caches.json }
                .parse_json(log, source, mode, true)?
                .map(Into::into)
                .unwrap_or_else(|| Expr::init(E::Object::default(), Loc::EMPTY));
            return Ok(JSAst::init(
                js_parser::new_lazy_export_ast(bump, &mut topts.define, opts, log, root, source, b"")?
                    .unwrap(),
            ));
        }
        Loader::Toml => {
            let _trace = perf::trace("Bundler.ParseTOML");
            let mut temp_log = Log::init();
            // TODO(port): errdefer/defer reshaped — Zig had `defer { temp_log.cloneToWithRecycled(log) }`.
            // scopeguard captured `log`/`temp_log` by-ref while both are also borrowed
            // mutably below (NLL conflict); folded into the linear control flow.
            let root: Expr = bun_interchange::toml::TOML::parse(source, &mut temp_log, bump, false)?.into();
            let result = JSAst::init(
                js_parser::new_lazy_export_ast(bump, &mut topts.define, opts, &mut temp_log, root, source, b"")?
                    .unwrap(),
            );
            let _ = temp_log.clone_to_with_recycled(log, true);
            return Ok(result);
        }
        Loader::Yaml => {
            let _trace = perf::trace("Bundler.ParseYAML");
            let mut temp_log = Log::init();
            let root: Expr = match bun_interchange::yaml::YAML::parse(source, &mut temp_log, bump) {
                Ok(r) => r.into(),
                Err(_) => {
                    let _ = temp_log.clone_to_with_recycled(log, true);
                    return Err(err!("ParserError"));
                }
            };
            let result = JSAst::init(
                js_parser::new_lazy_export_ast(bump, &mut topts.define, opts, &mut temp_log, root, source, b"")?
                    .unwrap(),
            );
            let _ = temp_log.clone_to_with_recycled(log, true);
            return Ok(result);
        }
        Loader::Json5 => {
            let _trace = perf::trace("Bundler.ParseJSON5");
            let mut temp_log = Log::init();
            let root: Expr = bun_interchange::json5::JSON5Parser::parse(source, &mut temp_log, bump)?.into();
            let result = JSAst::init(
                js_parser::new_lazy_export_ast(bump, &mut topts.define, opts, &mut temp_log, root, source, b"")?
                    .unwrap(),
            );
            let _ = temp_log.clone_to_with_recycled(log, true);
            return Ok(result);
        }
        Loader::Text => {
            let root = Expr::init(E::String { data: leak_static(&source.contents), ..Default::default() }, Loc { start: 0 });
            let mut ast = JSAst::init(
                js_parser::new_lazy_export_ast(bump, &mut topts.define, opts, log, root, source, b"")?
                    .unwrap(),
            );
            ast.add_url_for_css(bump, source, Some(b"text/plain"), None, topts.compile_to_standalone_html);
            return Ok(ast);
        }
        Loader::Md => {
            let html = match bun_md::root::render_to_html(&source.contents) {
                Ok(h) => h,
                Err(_) => {
                    log.add_error(Some(source), Loc::EMPTY, b"Failed to render markdown to HTML");
                    return Err(err!("ParserError"));
                }
            };
            let html: &'static [u8] = leak_static(bump.alloc_slice_copy(&html));
            let root = Expr::init(E::String { data: html, ..Default::default() }, Loc { start: 0 });
            let mut ast = JSAst::init(
                js_parser::new_lazy_export_ast(bump, &mut topts.define, opts, log, root, source, b"")?
                    .unwrap(),
            );
            ast.add_url_for_css(bump, source, Some(b"text/html"), None, topts.compile_to_standalone_html);
            return Ok(ast);
        }

        Loader::SqliteEmbedded | Loader::Sqlite => {
            if !topts.target.is_bun() {
                log.add_error(
                    Some(source),
                    Loc::EMPTY,
                    b"To use the \"sqlite\" loader, set target to \"bun\"",
                );
                return Err(err!("ParserError"));
            }

            let path_to_use: &'static [u8] = 'brk: {
                // Implements embedded sqlite
                if loader == Loader::SqliteEmbedded {
                    let mut buf = bumpalo::collections::String::new_in(bump);
                    write!(
                        &mut buf,
                        "{}A{:08}",
                        bun_core::fmt::hex_int_lower::<16>(unique_key_prefix),
                        source.index.0
                    )
                    .expect("unreachable");
                    let embedded_path = leak_static(buf.into_bump_str().as_bytes());
                    *unique_key_for_additional_file = FileLoaderHash {
                        key: embedded_path,
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
                E::String { data: path_to_use, ..Default::default() },
                Loc { start: 0 },
            );

            let import_meta = Expr::init(E::ImportMeta {}, Loc { start: 0 });
            let require_property = Expr::init(
                E::Dot {
                    target: import_meta,
                    name_loc: Loc::EMPTY,
                    name: b"require",
                    ..Default::default()
                },
                Loc { start: 0 },
            );
            let require_args = bump.alloc_slice_fill_default::<Expr>(2);
            require_args[0] = import_path;
            let object_properties = bump.alloc_slice_fill_default::<G::Property>(1);
            object_properties[0] = G::Property {
                key: Some(Expr::init(E::String { data: b"type", ..Default::default() }, Loc { start: 0 })),
                value: Some(Expr::init(E::String { data: b"sqlite", ..Default::default() }, Loc { start: 0 })),
                ..Default::default()
            };
            require_args[1] = Expr::init(
                E::Object {
                    // SAFETY: bump-owned slice; never grown via this BabyList.
                    properties: unsafe { G::PropertyList::from_bump_slice(object_properties) },
                    is_single_line: true,
                    ..Default::default()
                },
                Loc { start: 0 },
            );
            let require_call = Expr::init(
                E::Call {
                    target: require_property,
                    // SAFETY: bump-owned slice; never grown via this BabyList.
                    args: unsafe { BabyList::<Expr>::from_bump_slice(require_args) },
                    ..Default::default()
                },
                Loc { start: 0 },
            );

            let root = Expr::init(
                E::Dot {
                    target: require_call,
                    name_loc: Loc::EMPTY,
                    name: b"db",
                    ..Default::default()
                },
                Loc { start: 0 },
            );

            return Ok(JSAst::init(
                js_parser::new_lazy_export_ast(bump, &mut topts.define, opts, log, root, source, b"")?
                    .unwrap(),
            ));
        }
        Loader::Napi => {
            // (dap-eval-cb "source.contents.ptr")
            if topts.target == options::Target::Browser {
                log.add_error(
                    Some(source),
                    Loc::EMPTY,
                    b"Loading .node files won't work in the browser. Make sure to set target to \"bun\" or \"node\"",
                );
                return Err(err!("ParserError"));
            }

            let mut buf = bumpalo::collections::String::new_in(bump);
            write!(
                &mut buf,
                "{}A{:08}",
                bun_core::fmt::hex_int_lower::<16>(unique_key_prefix),
                source.index.0
            )
            .expect("unreachable");
            let unique_key = leak_static(buf.into_bump_str().as_bytes());
            // This injects the following code:
            //
            // require(unique_key)
            //
            let import_path = Expr::init(
                E::String { data: unique_key, ..Default::default() },
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
                    // SAFETY: bump-owned slice; never grown via this BabyList.
                    args: unsafe { BabyList::<Expr>::from_bump_slice(require_args) },
                    ..Default::default()
                },
                Loc { start: 0 },
            );

            *unique_key_for_additional_file = FileLoaderHash {
                key: unique_key,
                content_hash: ContentHasher::run(&source.contents),
            };
            return Ok(JSAst::init(
                js_parser::new_lazy_export_ast(bump, &mut topts.define, opts, log, root, source, b"")?
                    .unwrap(),
            ));
        }
        Loader::Html => {
            let mut scanner = HTMLScanner::init(bump, log, source);
            scanner.scan(&source.contents)?;

            // Reuse existing code for creating the AST
            // because it handles the various Ref and other structs we
            // need in order to print code later.
            let import_records = scanner.import_records;
            let import_records_len = import_records.len;
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
            ast.import_records = import_records;

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
            ast.parts.slice_mut()[1] = Part {
                stmts: core::ptr::slice_from_raw_parts_mut(
                    core::ptr::NonNull::<ast::Stmt>::dangling().as_ptr(),
                    0,
                ),
                is_live: true,
                import_record_indices: 'brk2: {
                    // Generate a single part that depends on all the import records.
                    // This is to ensure that we generate a JavaScript bundle containing all the user's code.
                    let mut import_record_indices =
                        BabyList::<u32>::init_capacity(import_records_len as usize)?;
                    import_record_indices.len = import_records_len;
                    for (index, import_record) in import_record_indices.slice_mut().iter_mut().enumerate() {
                        *import_record = u32::try_from(index).unwrap();
                    }
                    break 'brk2 import_record_indices;
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
            let mut import_records = BabyList::<ImportRecord>::default();
            let source_code = &source.contents;
            let mut temp_log = Log::init();
            // PORT NOTE: Zig `defer { temp_log.appendToMaybeRecycled(log, source) }` —
            // folded into linear control flow (scopeguard would alias `log`/`temp_log`).

            const CSS_MODULE_SUFFIX: &[u8] = b".module.css";
            let enable_css_modules = source.path.pretty.len() > CSS_MODULE_SUFFIX.len()
                && &source.path.pretty[source.path.pretty.len() - CSS_MODULE_SUFFIX.len()..]
                    == CSS_MODULE_SUFFIX;
            let parser_options = if enable_css_modules {
                let mut parseropts = bun_css::ParserOptions::default(bump, &mut temp_log);
                parseropts.filename = bun_paths::basename(source.path.pretty);
                parseropts.css_modules = Some(bun_css::CssModuleConfig::default());
                parseropts
            } else {
                bun_css::ParserOptions::default(bump, &mut temp_log)
            };

            let (mut css_ast, mut extra) = match bun_css::BundlerStyleSheet::parse_bundler(
                bump,
                source_code,
                parser_options,
                &mut import_records,
                source.index.0,
            ) {
                Ok(v) => v,
                Err(_e) => {
                    // TODO(port): `e.add_to_logger` once `bun_css` error type carries it.
                    let _ = temp_log.append_to_maybe_recycled(log, source);
                    return Err(err!("SyntaxError"));
                }
            };
            // Make sure the css modules local refs have a valid tag
            // TODO(port): re-enable once `bun_css::LocalScope` value type
            // exposes `.ref_` (current no-css stub stores `()`).
            // (debug-only assertion in Zig — omitted here, not gated.)
            let _ = &extra;
            if let Err(_e) = css_ast.minify(
                bump,
                bun_css::MinifyOptions {
                    targets: bun_css::Targets::for_bundler_target(topts.target),
                    unused_symbols: Default::default(),
                },
                &mut extra,
            ) {
                // TODO(port): `e.add_to_logger` once `bun_css` error type carries it.
                let _ = temp_log.append_to_maybe_recycled(log, source);
                return Err(err!("MinifyError"));
            }
            if css_ast.local_scope.count() > 0 {
                let _ = has_any_css_locals.fetch_add(1, Ordering::Relaxed);
            }
            // If this is a css module, the final exports object wil be set in `generateCodeForLazyExport`.
            let root = Expr::init(E::Object::default(), Loc { start: 0 });
            let css_ast_heap = bump.alloc(css_ast) as *mut _ as *mut c_void;
            let mut ast = JSAst::init(
                js_parser::new_lazy_export_ast_impl(
                    bump,
                    &mut topts.define,
                    opts,
                    &mut temp_log,
                    root,
                    source,
                    b"",
                    extra.symbols,
                )?
                .unwrap(),
            );
            ast.css = Some(css_ast_heap);
            ast.import_records = import_records;
            let _ = temp_log.append_to_maybe_recycled(log, source);
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

            let unique_key: &'static [u8] = if !topts.dev_server.is_null() {
                // With DevServer, the actual URL is added now, since it can be
                // known this far ahead of time, and it means the unique key code
                // does not have to perform an additional pass over files.
                //
                // To avoid a mutex, the actual insertion of the asset to DevServer
                // is done on the bundler thread.
                let mut buf = bumpalo::collections::String::new_in(bump);
                write!(
                    &mut buf,
                    "{}/{}{}",
                    crate::bake_types::ASSET_PREFIX,
                    bun_core::fmt::bytes_to_hex_lower_string(&content_hash.to_ne_bytes()),
                    bstr::BStr::new(bun_paths::extension(source.path.text)),
                )
                .expect("unreachable");
                leak_static(buf.into_bump_str().as_bytes())
            } else {
                let mut buf = bumpalo::collections::String::new_in(bump);
                write!(
                    &mut buf,
                    "{}A{:08}",
                    bun_core::fmt::hex_int_lower::<16>(unique_key_prefix),
                    source.index.0
                )
                .expect("unreachable");
                leak_static(buf.into_bump_str().as_bytes())
            };
            let root = Expr::init(E::String { data: unique_key, ..Default::default() }, Loc { start: 0 });
            *unique_key_for_additional_file = FileLoaderHash {
                key: unique_key,
                content_hash,
            };
            let mut ast = JSAst::init(
                js_parser::new_lazy_export_ast(bump, &mut topts.define, opts, log, root, source, b"")?
                    .unwrap(),
            );
            ast.add_url_for_css(bump, source, None, Some(unique_key), topts.compile_to_standalone_html);
            return Ok(ast);
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// getCodeForParseTaskWithoutPlugins
// ───────────────────────────────────────────────────────────────────────────

// blocked_on: `BundleV2.file_map` is `Option<NonNull<FileMap>>` where `FileMap`
// is an opaque CYCLEBREAK forward-decl (`_opaque: [u8; 0]`); `.get(path)`
// requires the real T6 `jsc::api::JSBundler::FileMap` surface. Also blocked on
// `bake_types::Framework.built_in_modules` value variant carrying `&[u8]` (vs
// `Box<[u8]>` here) and `resolver.caches.fs.read_file_with_allocator` shape.

// PORT NOTE: `transpiler`/`resolver` are raw `*mut` (Zig `*Transpiler` /
// `*Resolver`). Callers pass `resolver = &mut (*transpiler).resolver`; taking
// `&mut Transpiler` + `&mut Resolver` would be aliased-`&mut` UB. We only
// touch the disjoint `(*transpiler).fs` and `(*resolver).caches.fs` fields.
fn get_code_for_parse_task_without_plugins(
    task: &mut ParseTask,
    log: &mut Log,
    transpiler: *mut Transpiler,
    resolver: *mut Resolver,
    bump: &Bump,
    file_path: &mut Fs::Path,
    loader: Loader,
) -> core::result::Result<CacheEntry, AnyError> {
    let _ = bump; // TODO(port): allocator routing for read_file_with_allocator
    match &task.contents_or_fd {
        ContentsOrFd::Fd { dir, file } => 'brk: {
            let contents_dir = *dir;
            let contents_file = *file;
            let _trace = perf::trace("Bundler.readFile");

            // SAFETY: ctx backref is valid for ParseTask lifetime.
            let ctx = unsafe { &*task.ctx };

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

                    let fallback = NodeFallbackModules::contents_from_path(file_path.text)
                        .unwrap_or(b"");
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

            // TODO: this allocator may be wrong for native plugins
            // TODO(port): bun.default_allocator vs bump distinction — Zig passed
            // `bun.default_allocator` for copy-for-bundling and the worker arena
            // otherwise; the Rust `read_file_with_allocator` always allocates
            // from the global heap (see resolver/lib.rs PORT NOTE).
            let _ = loader.should_copy_for_bundling();
            // SAFETY: `transpiler.fs` is a live `*mut FileSystem` BACKREF.
            let fs_ref = unsafe { &mut *transpiler.fs };
            break 'brk match resolver.caches.fs.read_file_with_allocator(
                fs_ref,
                file_path.text,
                contents_dir,
                false,
                contents_file.unwrap_valid(),
            ) {
                Ok(e) => {
                    // PORT NOTE: `bun_resolver::cache::Entry` ↔ `crate::cache::Entry`
                    // are structurally identical CYCLEBREAK twins; convert
                    // by-variant so ownership of `Owned(Vec<u8>)` transfers.
                    use bun_resolver::cache::Contents as RC;
                    let contents = match e.contents {
                        RC::Empty => crate::cache::Contents::Empty,
                        RC::Owned(v) => crate::cache::Contents::Owned(v),
                        RC::SharedBuffer { ptr, len } => {
                            crate::cache::Contents::SharedBuffer { ptr, len }
                        }
                        RC::External { ptr, len } => {
                            crate::cache::Contents::External { ptr, len }
                        }
                    };
                    Ok(CacheEntry { contents, fd: e.fd, ..Default::default() })
                }
                Err(e) => {
                    let source = Source::init_empty_file(
                        // TODO(port): zig duped via log.msgs.allocator
                        leak_static(file_path.text),
                    );
                    if e == err!("ENOENT") || e == err!("FileNotFound") {
                        let _ = log.add_error_fmt(
                            Some(&source),
                            Loc::EMPTY,
                            format_args!(
                                "File not found {}",
                                bun_core::fmt::quote(file_path.text)
                            ),
                        );
                        return Err(err!("FileNotFound"));
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
                    return Err(e);
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

// blocked_on: `BundleV2.plugins` is `Option<NonNull<JSBundlerPlugin>>` where
// `JSBundlerPlugin` is an opaque forward-decl; `.has_on_before_parse_plugins()`
// requires the real T6 `jsc::api::JSBundler::Plugin` surface (or a
// `dispatch::PluginVTable` slot). Also calls the gated
// `get_code_for_parse_task_without_plugins`.

#[allow(clippy::too_many_arguments)]
fn get_code_for_parse_task<'b>(
    task: &mut ParseTask,
    log: &mut Log,
    transpiler: &mut Transpiler<'b>,
    resolver: &mut Resolver<'b>,
    bump: &Bump,
    file_path: &mut Fs::Path<'b>,
    loader: &mut Loader,
    from_plugin: &mut bool,
) -> core::result::Result<CacheEntry, AnyError> {
    let might_have_on_parse_plugins = 'brk: {
        if task.source_index.is_runtime() {
            break 'brk false;
        }
        // SAFETY: ctx backref is valid for ParseTask lifetime.
        let ctx = unsafe { &*task.ctx };
        let Some(plugin) = &ctx.plugins else { break 'brk false };
        // SAFETY: `plugin` is a live BACKREF for the bundle pass.
        if !unsafe { plugin.as_ref() }.has_on_before_parse_plugins() {
            break 'brk false;
        }

        if file_path.namespace == b"node" {
            break 'brk false;
        }
        true
    };

    if !might_have_on_parse_plugins {
        return get_code_for_parse_task_without_plugins(task, log, transpiler, resolver, bump, file_path, *loader);
    }

    let mut should_continue_running: i32 = 1;

    let mut ctx = OnBeforeParsePlugin {
        task,
        log,
        transpiler,
        resolver,
        bump,
        file_path,
        loader,
        deferred_error: None,
        should_continue_running: &mut should_continue_running,
        result: core::ptr::null_mut(),
    };

    // SAFETY: task.ctx backref valid for the duration of the parse.
    let plugins = unsafe { &*ctx.task.ctx }.plugins.expect("unreachable");
    // SAFETY: `plugins` is a live BACKREF for the bundle pass.
    ctx.run(unsafe { plugins.as_ref() }, from_plugin)
}

// ───────────────────────────────────────────────────────────────────────────
// OnBeforeParsePlugin
// ───────────────────────────────────────────────────────────────────────────

pub struct OnBeforeParsePlugin<'a, 'b: 'a> {
    task: &'a mut ParseTask,
    log: &'a mut Log,
    // PORT NOTE: split borrow lifetime `'a` from data lifetime `'b` so callers
    // (e.g. `get_code_for_parse_task`) don't have to satisfy the invariant
    // `&'a mut Transpiler<'a>` shape, which would force every argument's
    // lifetime to unify (and, with `'static` Worker-owned transpilers, demand
    // `'static` borrows of stack locals). Zig has no lifetimes; this is a
    // Rust-side relaxation only.
    transpiler: &'a mut Transpiler<'b>,
    resolver: &'a mut Resolver<'b>,
    bump: &'a Bump,
    file_path: &'a mut Fs::Path<'b>,
    loader: &'a mut Loader,
    deferred_error: Option<AnyError>,
    // Raw pointer (Zig: `*i32`). Must stay raw — `fetch_source_code` and
    // `OnBeforeParsePlugin__isDone` re-enter via FFI while the outer `run`
    // call has already handed this same i32 to C++; a `&'a mut i32` here
    // would mean two live `&mut` to one i32 (aliased-`&mut` UB).
    should_continue_running: *mut i32,

    // Raw pointer (Zig: `?*OnBeforeParseResult`). Must stay raw — the pointee
    // is `OnBeforeParseResultWrapper.result`, and `get_wrapper` walks back to
    // the parent via offset_of; a `&mut` here would (a) shrink provenance to
    // the inner field and (b) alias with any `&`/`&mut` to the wrapper.
    result: *mut OnBeforeParseResult,
}

// TODO(port): comptime size/align asserts vs bun.c.OnBeforeParseArguments etc.
// Phase B: const _: () = assert!(size_of::<OnBeforeParseArguments>() == size_of::<bun_sys::c::OnBeforeParseArguments>());
const _: () = {
    // Placeholder to keep the comptime block visible to reviewers.
};

#[repr(C)]
pub struct OnBeforeParseArguments {
    pub struct_size: usize,
    pub context: *mut OnBeforeParsePlugin<'static, 'static>, // FFI (LIFETIMES.tsv)
    pub path_ptr: *const u8,
    pub path_len: usize,
    pub namespace_ptr: *const u8,
    pub namespace_len: usize,
    pub default_loader: Loader,
    pub external: *mut c_void, // FFI (LIFETIMES.tsv)
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
    pub struct_size: usize,
    pub message_ptr: *const u8,
    pub message_len: usize,
    pub path_ptr: *const u8,
    pub path_len: usize,
    pub source_line_text_ptr: *const u8,
    pub source_line_text_len: usize,
    pub level: logger::Level,
    pub line: i32,
    pub column: i32,
    pub line_end: i32,
    pub column_end: i32,
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
            level: logger::Level::Err,
            line: 0,
            column: 0,
            line_end: 0,
            column_end: 0,
        }
    }
}

impl BunLogOptions {
    pub fn source_line_text(&self) -> &[u8] {
        if !self.source_line_text_ptr.is_null() && self.source_line_text_len > 0 {
            // SAFETY: ptr/len pair set by C plugin; trusted per FFI contract.
            return unsafe {
                core::slice::from_raw_parts(self.source_line_text_ptr, self.source_line_text_len)
            };
        }
        b""
    }

    pub fn path(&self) -> &[u8] {
        if !self.path_ptr.is_null() && self.path_len > 0 {
            // SAFETY: ptr/len pair set by C plugin; trusted per FFI contract.
            return unsafe { core::slice::from_raw_parts(self.path_ptr, self.path_len) };
        }
        b""
    }

    pub fn message(&self) -> &[u8] {
        if !self.message_ptr.is_null() && self.message_len > 0 {
            // SAFETY: ptr/len pair set by C plugin; trusted per FFI contract.
            return unsafe { core::slice::from_raw_parts(self.message_ptr, self.message_len) };
        }
        b""
    }

    pub fn append(&self, log: &mut Log, namespace: &'static [u8]) {
        // TODO(port): `bun_logger::Location.file` / `.line_text` are currently
        // `&'static [u8]`. Zig (ParseTask.zig:874-884) passes `this.path()`
        // through *unduped* and dupes `source_line_text` via
        // `log.msgs.allocator` so it is freed with the Log. Carrying owned
        // bytes here requires those fields to become `Cow<'static,[u8]>`.
        // `Box::leak` to fake `'static` is forbidden (PORTING.md §Forbidden),
        // so until the type change lands we omit the borrowed path/line_text
        // rather than leak per-message. The only caller (`log_fn`) is itself
        // only reachable from the ``-gated `run` below.
        let _ = self.path();
        let _ = self.source_line_text();
        let location = Location::init(
            // TODO(port): self.path() — blocked on Location.file: Cow<'static,[u8]>
            b"",
            namespace,
            self.line.max(-1),
            self.column.max(-1),
            (self.column_end - self.column).max(0) as u32,
            // TODO(port): Some(Cow::Owned(self.source_line_text().to_vec()))
            // — blocked on Location.line_text: Option<Cow<'static,[u8]>>
            None,
        );
        let mut msg = Msg {
            data: logger::Data {
                location: Some(location),
                text: std::borrow::Cow::Owned(self.message().to_vec()),
                ..Default::default()
            },
            ..Default::default()
        };
        match self.level {
            logger::Level::Err => msg.kind = logger::Kind::Err,
            logger::Level::Warn => msg.kind = logger::Kind::Warn,
            logger::Level::Verbose => msg.kind = logger::Kind::Verbose,
            logger::Level::Debug => msg.kind = logger::Kind::Debug,
            _ => {}
        }
        if msg.kind == logger::Kind::Err {
            log.errors += 1;
        } else if msg.kind == logger::Kind::Warn {
            log.warnings += 1;
        }
        let _ = log.add_msg(msg);
    }

    pub extern "C" fn log_fn(
        args_: *mut OnBeforeParseArguments,
        log_options_: *mut BunLogOptions,
    ) {
        // SAFETY: called from C plugin with valid ptrs or null.
        let Some(args) = (unsafe { args_.as_mut() }) else { return };
        let Some(log_options) = (unsafe { log_options_.as_ref() }) else { return };
        // SAFETY: context backref valid for plugin call duration.
        let ctx = unsafe { &mut *args.context };
        log_options.append(ctx.log, ctx.file_path.namespace);
    }
}

#[repr(C)]
pub struct OnBeforeParseResultWrapper {
    pub original_source: *const u8,
    pub original_source_len: usize,
    pub original_source_fd: Fd,
    pub loader: Loader,
    #[cfg(debug_assertions)]
    pub check: u32, // Value to ensure OnBeforeParseResult is wrapped in this struct
    // TODO(port): zig used `if (debug) u32 else u0`; in release this field
    // must be zero-sized to keep extern layout matching headers. Phase B:
    // verify with static_assert against bun.c.
    pub result: OnBeforeParseResult,
}

#[repr(C)]
pub struct OnBeforeParseResult {
    pub struct_size: usize,
    pub source_ptr: *const u8,
    pub source_len: usize,
    pub loader: Loader,

    pub fetch_source_code_fn:
        extern "C" fn(*mut OnBeforeParseArguments, *mut OnBeforeParseResult) -> i32,

    pub user_context: *mut c_void,
    pub free_user_context: Option<extern "C" fn(*mut c_void)>,

    pub log: extern "C" fn(*mut OnBeforeParseArguments, *mut BunLogOptions),
}

impl OnBeforeParseResult {
    pub fn get_wrapper(result: *mut OnBeforeParseResult) -> *mut OnBeforeParseResultWrapper {
        // SAFETY: result points to OnBeforeParseResultWrapper.result (always
        // constructed that way in `OnBeforeParsePlugin::run`).
        let wrapper = unsafe {
            (result as *mut u8)
                .sub(offset_of!(OnBeforeParseResultWrapper, result))
                .cast::<OnBeforeParseResultWrapper>()
        };
        #[cfg(debug_assertions)]
        // SAFETY: wrapper just computed via offset_of from valid result ptr.
        debug_assert_eq!(unsafe { (*wrapper).check }, 42069);
        wrapper
    }
}

// blocked_on: calls `get_code_for_parse_task_without_plugins` (gated above).

pub extern "C" fn fetch_source_code(
    args: *mut OnBeforeParseArguments,
    result_ptr: *mut OnBeforeParseResult,
) -> i32 {
    scoped_log!(ParseTask, "fetchSourceCode");
    // SAFETY: called from C plugin; args/result are valid per FFI contract.
    // `args` and `*args.context` are disjoint allocations (the
    // `OnBeforeParseArguments` stack local vs. the `OnBeforeParsePlugin` it
    // points back to), so holding both `&mut` is sound.
    let args = unsafe { &mut *args };
    let this = unsafe { &mut *args.context };
    // SAFETY: `should_continue_running` points at the `run` caller's stack
    // local for the duration of the plugin call.
    if this.log.errors > 0
        || this.deferred_error.is_some()
        || unsafe { *this.should_continue_running } != 1
    {
        return 1;
    }

    // SAFETY: `result_ptr` is the `.result` field of an
    // `OnBeforeParseResultWrapper` (see `OnBeforeParsePlugin::run`). Keep the
    // raw pointer un-shadowed so `get_wrapper`'s `.sub(offset_of!)` walk-back
    // retains provenance over the enclosing wrapper; a `&mut *result_ptr` here
    // would shrink provenance to just the `OnBeforeParseResult` and make the
    // later offset-walk UB. The `&mut` reborrow below is scoped to end before
    // any wrapper access so no overlapping `&mut` exists.
    {
        let result = unsafe { &mut *result_ptr };
        if !result.source_ptr.is_null() {
            return 0;
        }

        let entry = match get_code_for_parse_task_without_plugins(
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
                // SAFETY: see deref above; same pointer, still live.
                unsafe { *this.should_continue_running = 0 };
                return 1;
            }
        };
        let contents_slice = entry.contents.as_slice();
        result.source_ptr = contents_slice.as_ptr();
        result.source_len = contents_slice.len();
        result.free_user_context = None;
        result.user_context = core::ptr::null_mut();
        // SAFETY: result is always embedded in a wrapper. Write wrapper fields
        // via raw pointer (mirrors Zig `@fieldParentPtr`) — `wrapper.result`
        // *is* `*result_ptr`, so materializing `&mut *wrapper` here would
        // overlap the live `result` borrow above (aliased-`&mut` UB).
        let wrapper = OnBeforeParseResult::get_wrapper(result_ptr);
        unsafe {
            (*wrapper).original_source = contents_slice.as_ptr();
            (*wrapper).original_source_len = contents_slice.len();
            (*wrapper).original_source_fd = entry.fd;
        }
    }
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn OnBeforeParseResult__reset(this: *mut OnBeforeParseResult) {
    // SAFETY: called from C++ with valid ptr embedded in wrapper. Operate on
    // raw pointers throughout (mirrors Zig `@fieldParentPtr`): `wrapper.result`
    // *is* `*this`, so materializing `&mut *this` alongside `&mut *wrapper`
    // would be aliased-`&mut` UB, and forming `&mut *this` first would shrink
    // provenance so `.sub(offset_of!)` in `get_wrapper` walks out of bounds.
    let wrapper = OnBeforeParseResult::get_wrapper(this);
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

#[unsafe(no_mangle)]
pub extern "C" fn OnBeforeParsePlugin__isDone(this: *mut OnBeforeParsePlugin<'_, '_>) -> i32 {
    // SAFETY: called from C++ with valid ptr. Read via raw pointers (mirrors
    // Zig `@fieldParentPtr`) — `wrapper.result` aliases `*result`, so forming
    // overlapping references would be UB, and a `&mut`-derived `*mut` would
    // lack provenance over the enclosing wrapper.
    unsafe {
        if *(*this).should_continue_running != 1 {
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

// blocked_on: `crate::api::JSBundler::Plugin` (T6) — `call_on_before_parse_plugins`
// is an `extern "C"` JSC dispatch; needs a `dispatch` vtable slot or the real
// `bun_bundler_jsc::JSBundler::Plugin` re-export. Also references the gated
// `fetch_source_code` callback above.

impl<'a, 'b: 'a> OnBeforeParsePlugin<'a, 'b> {
    pub fn run(
        &mut self,
        // TODO(b0): jsc::api arrives from move-in (TYPE_ONLY → bundler)
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
        // only, making `.sub(offset_of!)` in `get_wrapper` out-of-provenance
        // UB (and pushes a Unique tag that invalidates this raw under SB).
        let result_ptr = core::ptr::addr_of_mut!(wrapper.result);
        let namespace_str;
        let namespace = if self.file_path.namespace == b"file" {
            &bun_string::String::EMPTY
        } else {
            namespace_str = bun_string::String::init(self.file_path.namespace);
            &namespace_str
        };
        let path_str = bun_string::String::init(self.file_path.text);
        // Copy the raw `*mut i32` out so passing it to FFI doesn't go through
        // `&mut self` after `self_ptr` is derived.
        let should_continue_running = self.should_continue_running;
        self.result = result_ptr;
        // Derive `args.context` *after* the last `&mut self` access above so
        // no parent-`&mut` use pops its SharedRW tag before the FFI callbacks
        // (`fetch_source_code` / `log_fn`) dereference it. Reuse the same raw
        // for the `ctx` argument instead of re-deriving from `&mut self`.
        let self_ptr = self as *mut _ as *mut OnBeforeParsePlugin<'static, 'static>;
        args.context = self_ptr;
        let count = plugin.call_on_before_parse_plugins(
            self_ptr.cast(),
            namespace,
            &path_str,
            &mut args,
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
            if wrapper.result.user_context.is_null() && wrapper.result.free_user_context.is_some() {
                let mut msg = Msg {
                    data: logger::Data {
                        location: None,
                        text: std::borrow::Cow::Borrowed(
                            &b"Native plugin set the `free_plugin_source_code_context` field without setting the `plugin_source_code_context` field."[..],
                        ),
                        ..Default::default()
                    },
                    ..Default::default()
                };
                msg.kind = logger::Kind::Err;
                // `args.context == self` — use `self` directly; materializing
                // a second `&mut` via `&mut *args.context` while `&mut self`
                // is live would be aliased-`&mut` UB.
                self.log.errors += 1;
                self.log.add_msg(msg);
                return Err(err!("InvalidNativePlugin"));
            }

            if self.log.errors > 0 {
                if let Some(free_user_context) = wrapper.result.free_user_context {
                    free_user_context(wrapper.result.user_context);
                }

                return Err(err!("SyntaxError"));
            }

            if !wrapper.result.source_ptr.is_null() {
                let ptr = wrapper.result.source_ptr;
                // PORT NOTE: `ExternalFreeFunction.function` is `Option<unsafe extern "C" fn>`;
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
                return Ok(CacheEntry {
                    contents: crate::cache::Contents::External {
                        ptr,
                        len: wrapper.result.source_len,
                    },
                    external_free_function: ExternalFreeFunction {
                        ctx: wrapper.result.user_context,
                        function: free_fn,
                    },
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

// blocked_on: `crate::ThreadPool::Worker` (lib.rs ` pub mod
// ThreadPool` — the bundler worker module, distinct from `bun_threading`).
// `Worker.{allocator, data.transpiler}` field shape comes from there.

fn get_source_code(
    task: &mut ParseTask,
    this: &mut crate::Worker,
    log: &mut Log,
) -> core::result::Result<CacheEntry, AnyError> {
    // SAFETY: `Worker.allocator` points at `Worker.heap` once `has_created` (see
    // `ThreadPool::Worker::create`); the worker is pinned for the bundle pass.
    let bump: &Bump = unsafe { &*this.allocator };

    // SAFETY: `has_created` ⇒ `data`/`transpiler` were initialized in `create()`.
    let data = unsafe { this.data.assume_init_mut() };
    let transpiler: &mut Transpiler<'static> = unsafe { data.transpiler.assume_init_mut() };
    // PORT NOTE: errdefer transpiler.resetStore() — reshaped: call on the err
    // path explicitly (scopeguard would alias `transpiler` with the &mut passed
    // to `get_code_for_parse_task` below).
    // PORT NOTE: reshaped for borrowck — `resolver` is a field of `transpiler`;
    // pass via raw to avoid two overlapping `&mut`.
    let resolver: &mut Resolver = unsafe { &mut *(core::ptr::addr_of_mut!(transpiler.resolver)) };
    let mut file_path = task.path.clone();
    let mut loader = task
        .loader
        .or_else(|| file_path.loader(&transpiler.options.loaders))
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
        transpiler.reset_store();
    }
    result
}

// ───────────────────────────────────────────────────────────────────────────
// runWithSourceCode
// ───────────────────────────────────────────────────────────────────────────

// blocked_on: `crate::ThreadPool::Worker` (gated module) for
// `this.{allocator, transpiler_for_target, ctx}`; `bake_types::Framework`
// missing `server_components` field; `ParserOptions` field-type mismatches
// (`allow_unresolved`, `framework`, `unwrap_commonjs_packages`,
// `server_components` — bundler's `BundleOptions` types diverge from the
// js_parser-local `parser::options` shims); `get_ast`/`get_empty_*` (gated).
// Signature is real; body un-gates once the `ThreadPool` module + the
// `parser::options` ↔ `BundleOptions` type unification land.

fn run_with_source_code(
    task: &mut ParseTask,
    this: &mut crate::Worker,
    step: &mut Step,
    log: &mut Log,
    entry: &mut CacheEntry,
) -> core::result::Result<Success, AnyError> {
    // SAFETY: see `get_source_code` — worker arena pinned for the bundle pass.
    // `'static` matches `JSAst = BundledAst<'static>` (ungate_support.rs); the
    // arena outlives all reads through the returned ASTs.
    let bump: &'static Bump = unsafe { &*this.allocator };

    // PORT NOTE: reshaped for borrowck — `transpiler_for_target` borrows `this`
    // mutably; we may need to call it again below (server-components branch),
    // so hold it as a raw pointer and reborrow per use site.
    let mut transpiler: *mut Transpiler<'static> =
        this.transpiler_for_target(task.known_target) as *mut _;
    // TODO(port): errdefer transpiler.resetStore() + errdefer entry.deinit().
    // Reshaped: cleanup runs on the err return paths explicitly (scopeguard
    // would alias the `&mut Transpiler` / `&mut CacheEntry` borrows below).
    // SAFETY: `transpiler` just derived from a live `&mut`.
    let resolver: &mut Resolver =
        unsafe { &mut *(core::ptr::addr_of_mut!((*transpiler).resolver)) };
    let file_path = &mut task.path;
    let loader = task
        .loader
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
    // allocated by `bun.default_allocator` and then freed in `BundleV2.deinit` (and also by `entry.deinit(allocator)` below).
    #[cfg(debug_assertions)]
    let debug_original_variant_check: ContentsOrFdTag = task.contents_or_fd.tag();
    #[cfg(debug_assertions)]
    let _ = debug_original_variant_check;

    // PORT NOTE: reshaped for borrowck — Zig had two errdefers (transpiler.resetStore
    // unconditional; entry.deinit only when contents_or_fd == .fd, with a debug
    // tag-change panic). The debug check used live `task.contents_or_fd` which
    // overlaps borrows in Rust; left as TODO above.

    // SAFETY: this.ctx backref valid.
    let worker_ctx = unsafe { &*this.ctx };

    let will_close_file_descriptor = matches!(task.contents_or_fd, ContentsOrFd::Fd { .. })
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

    // SAFETY: `transpiler` derived from a live `&mut` above.
    let transpiler_ref = unsafe { &mut *transpiler };
    let use_directive: UseDirective = if !is_empty && transpiler_ref.options.server_components {
        UseDirective::parse(entry_contents).unwrap_or(UseDirective::None)
    } else {
        UseDirective::None
    };

    if (use_directive == UseDirective::Client
        && task.known_target != options::Target::BakeServerComponentsSsr
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
        ((transpiler_ref.options.server_components || !transpiler_ref.options.dev_server.is_null())
            && task.known_target == options::Target::Browser)
    {
        // separate_ssr_graph makes boundaries switch to client because the server file uses that generated file as input.
        // this is not done when there is one server graph because it is easier for plugins to deal with.
        transpiler = this.transpiler_for_target(options::Target::Browser) as *mut _;
    }
    // SAFETY: `transpiler` re-derived from a live `&mut` above.
    let transpiler_ref = unsafe { &mut *transpiler };

    let source = Source {
        // PORT NOTE: `Source.path` is `bun_logger::fs::Path`, distinct from
        // `bun_resolver::fs::Path` (CYCLEBREAK TYPE_ONLY mirror). Construct
        // field-by-field across the type boundary.
        path: bun_logger::fs::Path {
            text: leak_static(file_path.text),
            namespace: leak_static(file_path.namespace),
            name: bun_logger::fs::PathName::init(leak_static(file_path.text)),
            pretty: leak_static(file_path.pretty),
            is_disabled: file_path.is_disabled,
            is_symlink: file_path.is_symlink,
        },
        index: bun_logger::Index(task.source_index.get()),
        contents: std::borrow::Cow::Borrowed(leak_static(entry_contents)),
        contents_is_recycled: false,
        ..Default::default()
    };

    let target = (if task.source_index.get() == 1 {
        target_from_hashbang(entry_contents)
    } else {
        None
    })
    .unwrap_or_else(|| {
        if task.known_target == options::Target::BakeServerComponentsSsr
            && transpiler_ref
                .options
                .framework
                .as_ref()
                .unwrap()
                .server_components
                .as_ref()
                .unwrap()
                .separate_ssr_graph
        {
            options::Target::BakeServerComponentsSsr
        } else {
            transpiler_ref.options.target
        }
    });

    let output_format = transpiler_ref.options.output_format;

    // PORT NOTE: `ParserOptions::init` takes `bun_js_parser::options::JSX::Pragma`,
    // distinct from `crate::options::jsx::Pragma` (TYPE_ONLY divergence). Until
    // those unify, construct from defaults and copy the one field both share.
    // TODO(port): replace with `task.jsx.clone()` once Pragma types unify.
    let mut opts = ParserOptions::init(Default::default(), loader);
    opts.bundle = true;
    opts.warn_about_unbundled_modules = false;
    // TODO(port): TYPE_ONLY divergence — `transpiler.options.allow_unresolved`
    // is `crate::options::AllowUnresolved`, distinct from
    // `bun_js_parser::options::AllowUnresolved`.
    opts.allow_unresolved = &js_parser::options::AllowUnresolved::DEFAULT;
    // TODO(port): TYPE_ONLY divergence — `transpiler.macro_context` is
    // `Option<js_ast::Macro::MacroContext>` (owned), distinct from
    // `Option<&'a mut bun_js_parser::MacroContext>`.
    opts.macro_context = None;
    opts.package_version = task.package_version;

    opts.features.allow_runtime = !task.source_index.is_runtime();
    opts.features.unwrap_commonjs_to_esm =
        output_format == options::Format::Esm && FeatureFlags::UNWRAP_COMMONJS_TO_ESM;
    opts.features.top_level_await = output_format == options::Format::Esm
        || output_format == options::Format::InternalBakeDev;
    opts.features.auto_import_jsx = task.jsx.parse && transpiler_ref.options.auto_import_jsx;
    opts.features.trim_unused_imports =
        loader.is_typescript() || transpiler_ref.options.trim_unused_imports.unwrap_or(false);
    opts.features.inlining = transpiler_ref.options.minify_syntax;
    // TODO(port): TYPE_ONLY divergence — `bun_options_types::Format` vs
    // `bun_js_parser::options::Format`. Map by discriminant.
    opts.output_format = match output_format {
        options::Format::Esm => js_parser::options::Format::Esm,
        options::Format::Cjs => js_parser::options::Format::Cjs,
        options::Format::Iife => js_parser::options::Format::Iife,
        options::Format::InternalBakeDev => js_parser::options::Format::InternalBakeDev,
    };
    opts.features.minify_syntax = transpiler_ref.options.minify_syntax;
    opts.features.minify_identifiers = transpiler_ref.options.minify_identifiers;
    opts.features.minify_keep_names = transpiler_ref.options.keep_names;
    opts.features.minify_whitespace = transpiler_ref.options.minify_whitespace;
    opts.features.emit_decorator_metadata = task.emit_decorator_metadata;
    // emitDecoratorMetadata implies legacy/experimental decorators, as it only
    // makes sense with TypeScript's legacy decorator system (reflect-metadata).
    // TC39 standard decorators have their own metadata mechanism.
    opts.features.standard_decorators =
        !loader.is_typescript() || !(task.experimental_decorators || task.emit_decorator_metadata);
    opts.features.unwrap_commonjs_packages = transpiler_ref.options.unwrap_commonjs_packages;
    // TODO(port): `bundler_feature_flags` is `Option<Box<StringSet>>` on both
    // sides; cannot move out of `&transpiler.options`. Phase B: store as
    // `Option<&'a StringSet>` on `RuntimeFeatures`.
    opts.features.bundler_feature_flags = None;
    // JavaScriptCore implements `using` / `await using` natively, so when
    // targeting Bun there is no need to lower them.
    opts.features.lower_using = !target.is_bun();
    opts.features.hot_module_reloading =
        output_format == options::Format::InternalBakeDev && !task.source_index.is_runtime();
    opts.features.auto_polyfill_require =
        output_format == options::Format::Esm && !opts.features.hot_module_reloading;
    opts.features.react_fast_refresh = transpiler_ref.options.react_fast_refresh
        && loader.is_jsx()
        && !source.path.is_node_module();

    opts.features.server_components = if transpiler_ref.options.server_components {
        use js_parser::options::ServerComponents as SC;
        match target {
            options::Target::Browser => SC::ClientSide,
            _ => match use_directive {
                UseDirective::None => SC::WrapAnonServerFunctions,
                UseDirective::Client => {
                    if transpiler_ref
                        .options
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
        js_parser::options::ServerComponents::None
    };

    // TODO(port): TYPE_ONLY divergence — `transpiler.options.framework:
    // Option<&bake_types::Framework>` vs `opts.framework:
    // Option<&js_parser::options::Framework>`.
    opts.framework = None;

    opts.ignore_dce_annotations =
        transpiler_ref.options.ignore_dce_annotations && !task.source_index.is_runtime();

    // For files that are not user-specified entrypoints, set `import.meta.main` to `false`.
    // Entrypoints will have `import.meta.main` set as "unknown", unless we use `--compile`,
    // in which we inline `true`.
    if transpiler_ref.options.inline_entrypoint_import_meta_main || !task.is_entry_point {
        opts.import_meta_main_value =
            Some(task.is_entry_point && transpiler_ref.options.dev_server.is_null());
    } else if target == options::Target::Node {
        opts.lower_import_meta_main_for_node_js = true;
    }

    opts.tree_shaking = if task.source_index.is_runtime() {
        true
    } else {
        transpiler_ref.options.tree_shaking
    };
    opts.code_splitting = transpiler_ref.options.code_splitting;
    opts.module_type = task.module_type;

    task.jsx.parse = loader.is_jsx();

    let mut unique_key_for_additional_file = FileLoaderHash {
        key: b"",
        content_hash: 0,
    };
    // SAFETY: task.ctx backref valid.
    let task_ctx = unsafe { &*task.ctx };
    let module_type = opts.module_type;
    let mut ast: JSAst = if !is_empty || loader.handles_empty_file() {
        get_ast(
            log,
            transpiler_ref,
            opts,
            bump,
            resolver,
            &source,
            loader,
            task_ctx.unique_key,
            &mut unique_key_for_additional_file,
            &task_ctx.linker.has_any_css_locals,
        )?
    } else if module_type == options::ModuleType::Esm {
        if loader.is_css() {
            get_empty_css_ast(log, transpiler_ref, opts, bump, &source)?
        } else {
            get_empty_ast::<E::Undefined>(log, transpiler_ref, opts, bump, &source)?
        }
    } else {
        if loader.is_css() {
            get_empty_css_ast(log, transpiler_ref, opts, bump, &source)?
        } else {
            get_empty_ast::<E::Object>(log, transpiler_ref, opts, bump, &source)?
        }
    };
    // PERF(port): Zig used `switch (bool) { inline else => |as_undefined| ... }`
    // to monomorphize. Expanded to if/else.

    ast.target = target;
    if ast.parts.len <= 1
        && ast.css.is_none()
        && (task.loader.is_none() || task.loader.unwrap() != Loader::Html)
    {
        task.side_effects = _resolver::SideEffects::NoSideEffectsEmptyAst;
    }

    // bun.debugAssert(ast.parts.len > 0); // when parts.len == 0, it is assumed to be pending/failed. empty ast has at least 1 part.

    *step = Step::Resolve;

    Ok(Success {
        ast,
        source,
        log: core::mem::take(log),
        // PORT NOTE: Zig returned `log.*` by value; here we take ownership.
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
pub fn run_from_thread_pool(this: &mut ParseTask) {
    run_from_thread_pool_impl(this);
}

fn run_from_thread_pool_impl(this: &mut ParseTask) {
    // SAFETY: ctx backref valid.
    let ctx = unsafe { &*this.ctx };
    let worker: &mut crate::Worker = crate::Worker::get(ctx);
    // PORT NOTE: `defer worker.unget()` — handled at function exit (scopeguard
    // would alias the `&mut worker` borrows below).
    scoped_log!(
        ParseTask,
        "ParseTask(0x{:x}, {}) callback",
        this as *mut _ as usize,
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
                    err: err!("SyntaxError"),
                    step,
                    log,
                    source_index: this.source_index,
                    target: this.known_target,
                });
            }

            if crate::ThreadPool::uses_io_pool() {
                // SAFETY: `pool` is a `NonNull<ThreadPool>` BACKREF live for the
                // bundle pass.
                unsafe { ctx.graph.pool.as_ref() }.schedule_inside_thread_pool(this);
                worker.unget();
                return;
            }
        }

        // PORT NOTE: reshaped for borrowck — `this` and `this.stage.needs_parse`
        // both borrowed mutably; take the entry out, pass `&mut entry`, write back.
        let mut entry = match core::mem::replace(&mut this.stage, ParseTaskStage::NeedsSourceCode) {
            ParseTaskStage::NeedsParse(e) => e,
            ParseTaskStage::NeedsSourceCode => unreachable!(),
        };
        match run_with_source_code(this, worker, &mut step, &mut log, &mut entry) {
            Ok(ast) => {
                // When using HMR, always flag asts with errors as parse failures.
                // Not done outside of the dev server out of fear of breaking existing code.
                if !ctx.transpiler().options.dev_server.is_null() && ast.log.has_errors() {
                    break 'value ResultValue::Err(ResultError {
                        err: err!("SyntaxError"),
                        step: Step::Parse,
                        log: ast.log,
                        source_index: this.source_index,
                        target: this.known_target,
                    });
                }

                break 'value ResultValue::Success(ast);
            }
            Err(e) => {
                if e == err!("EmptyAST") {
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
        ctx: this.ctx,
        // SAFETY: Zig leaves `.task = undefined`; consumer overwrites before read.
        // `ConcurrentTask` is POD with no NonNull/NonZero fields.
        task: unsafe { core::mem::zeroed() },
        value,
        // PORT NOTE: `ExternalFreeFunction` is POD in Zig (copied); Rust port
        // doesn't derive `Copy`, so move it out (task is consumed here).
        external: core::mem::take(&mut this.external_free_function),
        watcher_data: match this.contents_or_fd {
            ContentsOrFd::Fd { file, dir } => WatcherData { fd: file, dir_fd: dir },
            ContentsOrFd::Contents(_) => WatcherData::NONE,
        },
    });
    let result = Box::into_raw(result);

    // PORT NOTE: Zig matched `worker.ctx.loop().*` on `EventLoopHandle::{js,mini}`.
    // `LinkerContext.r#loop` is currently CYCLEBREAK-erased to `Option<NonNull<()>>`
    // (LinkerContext.rs:43); the discriminant lives in T6. Until that un-erases to
    // `bun_event_loop::EventLoopHandle`, treat the erased pointer as a
    // `MiniEventLoop` (the CLI is the only path that reaches here without a JS VM).
    // TODO(port): re-expand to `Js`/`Mini` match once `linker.r#loop` is
    // `bun_event_loop::EventLoopHandle`.
    // SAFETY: worker.ctx backref valid.
    let r#loop = unsafe { (*worker.ctx).linker.r#loop };
    worker.unget();
    if let Some(mini) = r#loop {
        let mini = mini.cast::<bun_event_loop::MiniEventLoop::MiniEventLoop>();
        // SAFETY: erased BACKREF to a live MiniEventLoop for the bundle pass.
        unsafe {
            (*mini.as_ptr()).enqueue_task_concurrent_with_extra_ctx::<Result, BundleV2<'static>>(
                result,
                on_complete_mini,
                offset_of!(Result, task),
            );
        }
    } else {
        // No event loop registered (e.g., synchronous CLI bundling) — run inline.
        on_complete(result);
    }
}

fn on_complete_mini(result: *mut Result, ctx: *mut BundleV2<'static>) {
    // SAFETY: callback contract — `result` was Box::into_raw'd above; `ctx` is
    // the BACKREF stashed in `result.ctx` (Zig passed `BundleV2` as ParentContext).
    BundleV2::on_parse_task_complete(unsafe { &mut *result }, unsafe { &mut *ctx });
}

pub fn on_complete(result: *mut Result) {
    // SAFETY: result allocated via Box::into_raw above; uniquely owned here.
    let r = unsafe { &mut *result };
    let ctx = r.ctx;
    // SAFETY: `ctx` is a `*mut BundleV2` BACKREF (Zig `*BundleV2`) stored with
    // write provenance in `ParseTask::init`; the BundleV2 outlives the bundle
    // pass and no other `&mut BundleV2` is live on this (main) thread when the
    // event-loop callback fires. `r` and `*ctx` are disjoint allocations.
    BundleV2::on_parse_task_complete(r, unsafe { &mut *ctx });
}
} // end mod parse_worker

pub use parse_worker::{get_runtime_source, on_complete, FileLoaderHash, OnBeforeParsePlugin};

// ───────────────────────────────────────────────────────────────────────────
// Re-exports
// ───────────────────────────────────────────────────────────────────────────

pub use bun_js_parser::ast::Ref;

pub use crate::DeferredBatchTask::DeferredBatchTask;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/ParseTask.zig (1496 lines)
//   confidence: medium
//   todos:      21
//   notes:      `parse_worker` module un-gated B-2: get_runtime_source +
//               task_callback/io_task_callback + FFI structs (OnBeforeParse*,
//               BunLogOptions) + on_complete are real. Per-function gates
//               remain on getAST/getCodeForParseTask*/runWithSourceCode/
//               runFromThreadPool bodies — blocked on `crate::ThreadPool`
//               (gated bundler-worker module), opaque `JSBundlerPlugin`/
//               `FileMap` forward-decls, and `parser::options` ↔
//               `BundleOptions` type-mirror unification (ModuleType, jsx::
//               Pragma, AllowUnresolved, Framework). `init()` gated on the
//               same TYPE_ONLY divergence. Arena lifetimes for &[u8] fields
//               placeholdered as &'static. errdefer scopeguards reshaped for
//               borrowck (Phase-B verify). OnBeforeParseResultWrapper.check
//               field layout differs in release.
// ──────────────────────────────────────────────────────────────────────────
