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
use bun_core::{self, err, Error as AnyError, FeatureFlags};
use bun_jsc::{self as jsc};
use bun_logger::{self as logger, Loc, Location, Log, Msg, Source};
use bun_options_types::ImportRecord;
use bun_output::{declare_scope, scoped_log};
use bun_str::{self as bun_string, strings};
use bun_sys::Fd;
use bun_threading::ThreadPool as ThreadPoolLib;

use bun_js_parser::{
    self as js_parser,
    ast::{self, BundledAst as JSAst, Expr, Part, E, G},
};

use crate::bundle_v2::{
    self as bundler, target_from_hashbang, BundleV2, ContentHasher, UseDirective,
};
use crate::cache::fs::Entry as CacheEntry;
use crate::html_scanner::HTMLScanner;
use crate::options::{self, Loader};
use bun_resolver::{self as _resolver, fs as Fs, node_fallbacks as NodeFallbackModules, Resolver};
use bun_transpiler::Transpiler;

declare_scope!(ParseTask, hidden);

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
    pub path: Fs::Path,
    pub secondary_path_for_commonjs_interop: Option<Fs::Path>,
    pub contents_or_fd: ContentsOrFd,
    pub external_free_function: CacheEntry::ExternalFreeFunction,
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
    pub ctx: *const BundleV2, // BACKREF (LIFETIMES.tsv)
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
    pub ctx: *const BundleV2, // BACKREF (LIFETIMES.tsv)
    pub value: ResultValue,
    pub watcher_data: WatcherData,
    /// This is used for native onBeforeParsePlugins to store
    /// a function pointer and context pointer to free the
    /// returned source code by the plugin.
    pub external: CacheEntry::ExternalFreeFunction,
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
    pub fn init(
        resolve_result: &_resolver::Result,
        source_index: Index,
        ctx: &BundleV2,
    ) -> ParseTask {
        ParseTask {
            ctx: ctx as *const BundleV2,
            path: resolve_result.path_pair.primary.clone(),
            contents_or_fd: ContentsOrFd::Fd {
                dir: resolve_result.dirname_fd,
                file: resolve_result.file_fd,
            },
            side_effects: resolve_result.primary_side_effects_data,
            jsx: resolve_result.jsx.clone(),
            source_index,
            module_type: resolve_result.module_type,
            emit_decorator_metadata: resolve_result.flags.emit_decorator_metadata,
            experimental_decorators: resolve_result.flags.experimental_decorators,
            package_version: match &resolve_result.package_json {
                Some(package_json) => package_json.version,
                None => b"",
            },
            package_name: match &resolve_result.package_json {
                Some(package_json) => package_json.name,
                None => b"",
            },
            known_target: ctx.transpiler.options.target,
            // defaults:
            secondary_path_for_commonjs_interop: None,
            external_free_function: CacheEntry::ExternalFreeFunction::NONE,
            loader: None,
            task: ThreadPoolLib::Task::new(task_callback),
            io_task: ThreadPoolLib::Task::new(io_task_callback),
            stage: ParseTaskStage::NeedsSourceCode,
            tree_shaking: false,
            is_entry_point: false,
            // TODO(port): Zig struct-field defaults; Rust has no per-field
            // default syntax. Consider impl Default for ParseTask in Phase B
            // and use `..Default::default()` here.
        }
    }
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
        ctx: core::ptr::null(),
        path: Fs::Path::init_with_namespace(b"runtime", b"bun:runtime"),
        side_effects: _resolver::SideEffects::NoSideEffectsPureData,
        jsx: options::jsx::Pragma { parse: false, ..Default::default() },
        contents_or_fd: ContentsOrFd::Contents(runtime_code.as_bytes()),
        source_index: Index::RUNTIME,
        loader: Some(Loader::Js),
        known_target: target,
        // defaults:
        secondary_path_for_commonjs_interop: None,
        external_free_function: CacheEntry::ExternalFreeFunction::NONE,
        task: ThreadPoolLib::Task::new(task_callback),
        io_task: ThreadPoolLib::Task::new(io_task_callback),
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
        path: parse_task.path.clone(),
        contents: runtime_code.as_bytes(),
        index: Index::RUNTIME,
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

fn get_empty_css_ast(
    log: &mut Log,
    transpiler: &mut Transpiler,
    opts: js_parser::parser::Options,
    bump: &Bump,
    source: &Source,
) -> core::result::Result<JSAst, AnyError> {
    let root = Expr::init(E::Object::default(), Loc { start: 0 });
    let mut ast = JSAst::init(
        js_parser::new_lazy_export_ast(bump, &transpiler.options.define, opts, log, root, source, b"")?
            .unwrap(),
    );
    ast.css = Some(bump.alloc(bun_css::BundlerStyleSheet::empty(bump)));
    Ok(ast)
}

fn get_empty_ast<RootType: Default>(
    log: &mut Log,
    transpiler: &mut Transpiler,
    opts: js_parser::parser::Options,
    bump: &Bump,
    source: &Source,
) -> core::result::Result<JSAst, AnyError>
where
    // TODO(port): Expr::init needs to accept RootType; bound is a placeholder.
    RootType: Into<ast::ExprData>,
{
    let root = Expr::init(RootType::default(), Loc::EMPTY);
    Ok(JSAst::init(
        js_parser::new_lazy_export_ast(bump, &transpiler.options.define, opts, log, root, source, b"")?
            .unwrap(),
    ))
}

// ───────────────────────────────────────────────────────────────────────────
// FileLoaderHash
// ───────────────────────────────────────────────────────────────────────────

struct FileLoaderHash {
    // TODO(port): arena lifetime
    key: &'static [u8],
    content_hash: u64,
}

// ───────────────────────────────────────────────────────────────────────────
// getAST
// ───────────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn get_ast(
    log: &mut Log,
    transpiler: &mut Transpiler,
    opts: js_parser::parser::Options,
    bump: &Bump,
    resolver: &mut Resolver,
    source: &Source,
    loader: Loader,
    unique_key_prefix: u64,
    unique_key_for_additional_file: &mut FileLoaderHash,
    has_any_css_locals: &AtomicU32,
) -> core::result::Result<JSAst, AnyError> {
    use std::io::Write as _;

    match loader {
        Loader::Jsx | Loader::Tsx | Loader::Js | Loader::Ts => {
            let _trace = bun_core::perf::trace("Bundler.ParseJS");
            return if let Some(res) = resolver.caches.js.parse(
                bump, // TODO(port): zig passed transpiler.allocator
                opts.clone(),
                &transpiler.options.define,
                log,
                source,
            )? {
                Ok(JSAst::init(res.ast))
            } else if opts.module_type == options::ModuleType::Esm {
                get_empty_ast::<E::Undefined>(log, transpiler, opts, bump, source)
            } else {
                get_empty_ast::<E::Object>(log, transpiler, opts, bump, source)
            };
            // PERF(port): Zig used `switch (bool) { inline else => |as_undefined| ... }`
            // to monomorphize the RootType. Expanded to two calls.
        }
        Loader::Json | Loader::Jsonc => {
            let _trace = bun_core::perf::trace("Bundler.ParseJSON");
            let mode = if matches!(loader, Loader::Jsonc) {
                bun_interchange::json::Mode::Jsonc
            } else {
                bun_interchange::json::Mode::Json
            };
            let root = resolver
                .caches
                .json
                .parse_json(log, source, bump, mode, true)?
                .unwrap_or_else(|| Expr::init(E::Object::default(), Loc::EMPTY));
            return Ok(JSAst::init(
                js_parser::new_lazy_export_ast(bump, &transpiler.options.define, opts, log, root, source, b"")?
                    .unwrap(),
            ));
        }
        Loader::Toml => {
            let _trace = bun_core::perf::trace("Bundler.ParseTOML");
            let mut temp_log = Log::init(bump);
            let guard = scopeguard::guard((), |_| {
                temp_log.clone_to_with_recycled(log, true);
                temp_log.msgs.clear();
            });
            // TODO(port): errdefer/defer reshaped — guard runs on both paths.
            let root = bun_interchange::toml::TOML::parse(source, &mut temp_log, bump, false)?;
            let result = JSAst::init(
                js_parser::new_lazy_export_ast(bump, &transpiler.options.define, opts, &mut temp_log, root, source, b"")?
                    .unwrap(),
            );
            drop(guard);
            return Ok(result);
        }
        Loader::Yaml => {
            let _trace = bun_core::perf::trace("Bundler.ParseYAML");
            let mut temp_log = Log::init(bump);
            let guard = scopeguard::guard((), |_| {
                temp_log.clone_to_with_recycled(log, true);
                temp_log.msgs.clear();
            });
            let root = bun_interchange::yaml::YAML::parse(source, &mut temp_log, bump)?;
            let result = JSAst::init(
                js_parser::new_lazy_export_ast(bump, &transpiler.options.define, opts, &mut temp_log, root, source, b"")?
                    .unwrap(),
            );
            drop(guard);
            return Ok(result);
        }
        Loader::Json5 => {
            let _trace = bun_core::perf::trace("Bundler.ParseJSON5");
            let mut temp_log = Log::init(bump);
            let guard = scopeguard::guard((), |_| {
                temp_log.clone_to_with_recycled(log, true);
                temp_log.msgs.clear();
            });
            let root = bun_interchange::json5::JSON5Parser::parse(source, &mut temp_log, bump)?;
            let result = JSAst::init(
                js_parser::new_lazy_export_ast(bump, &transpiler.options.define, opts, &mut temp_log, root, source, b"")?
                    .unwrap(),
            );
            drop(guard);
            return Ok(result);
        }
        Loader::Text => {
            let root = Expr::init(E::String { data: source.contents, ..Default::default() }, Loc { start: 0 });
            let mut ast = JSAst::init(
                js_parser::new_lazy_export_ast(bump, &transpiler.options.define, opts, log, root, source, b"")?
                    .unwrap(),
            );
            ast.add_url_for_css(bump, source, Some(b"text/plain"), None, transpiler.options.compile_to_standalone_html);
            return Ok(ast);
        }
        Loader::Md => {
            let html = match bun_md::render_to_html(source.contents, bump) {
                Ok(h) => h,
                Err(_) => {
                    log.add_error(Some(source), Loc::EMPTY, b"Failed to render markdown to HTML");
                    return Err(err!("ParserError"));
                }
            };
            let root = Expr::init(E::String { data: html, ..Default::default() }, Loc { start: 0 });
            let mut ast = JSAst::init(
                js_parser::new_lazy_export_ast(bump, &transpiler.options.define, opts, log, root, source, b"")?
                    .unwrap(),
            );
            ast.add_url_for_css(bump, source, Some(b"text/html"), None, transpiler.options.compile_to_standalone_html);
            return Ok(ast);
        }

        Loader::SqliteEmbedded | Loader::Sqlite => {
            if !transpiler.options.target.is_bun() {
                log.add_error(
                    Some(source),
                    Loc::EMPTY,
                    b"To use the \"sqlite\" loader, set target to \"bun\"",
                );
                return Err(err!("ParserError"));
            }

            let path_to_use: &[u8] = 'brk: {
                // Implements embedded sqlite
                if loader == Loader::SqliteEmbedded {
                    let mut buf = bumpalo::collections::Vec::new_in(bump);
                    write!(
                        &mut buf,
                        "{}A{:08}",
                        bun_core::fmt::hex_int_lower(unique_key_prefix),
                        source.index.get()
                    )
                    .expect("unreachable");
                    let embedded_path = buf.into_bump_slice();
                    *unique_key_for_additional_file = FileLoaderHash {
                        key: embedded_path,
                        content_hash: ContentHasher::run(source.contents),
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
                    properties: G::Property::List::from_owned_slice(object_properties),
                    is_single_line: true,
                    ..Default::default()
                },
                Loc { start: 0 },
            );
            let require_call = Expr::init(
                E::Call {
                    target: require_property,
                    args: BabyList::<Expr>::from_owned_slice(require_args),
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
                js_parser::new_lazy_export_ast(bump, &transpiler.options.define, opts, log, root, source, b"")?
                    .unwrap(),
            ));
        }
        Loader::Napi => {
            // (dap-eval-cb "source.contents.ptr")
            if transpiler.options.target == options::Target::Browser {
                log.add_error(
                    Some(source),
                    Loc::EMPTY,
                    b"Loading .node files won't work in the browser. Make sure to set target to \"bun\" or \"node\"",
                );
                return Err(err!("ParserError"));
            }

            let mut buf = bumpalo::collections::Vec::new_in(bump);
            write!(
                &mut buf,
                "{}A{:08}",
                bun_core::fmt::hex_int_lower(unique_key_prefix),
                source.index.get()
            )
            .expect("unreachable");
            let unique_key = buf.into_bump_slice();
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
                    args: BabyList::<Expr>::from_owned_slice(require_args),
                    ..Default::default()
                },
                Loc { start: 0 },
            );

            *unique_key_for_additional_file = FileLoaderHash {
                key: unique_key,
                content_hash: ContentHasher::run(source.contents),
            };
            return Ok(JSAst::init(
                js_parser::new_lazy_export_ast(bump, &transpiler.options.define, opts, log, root, source, b"")?
                    .unwrap(),
            ));
        }
        Loader::Html => {
            let mut scanner = HTMLScanner::init(bump, log, source);
            scanner.scan(source.contents)?;

            // Reuse existing code for creating the AST
            // because it handles the various Ref and other structs we
            // need in order to print code later.
            let mut ast = js_parser::new_lazy_export_ast(
                bump,
                &transpiler.options.define,
                opts,
                log,
                Expr::init(E::Missing {}, Loc::EMPTY),
                source,
                b"",
            )?
            .unwrap();
            ast.import_records = scanner.import_records;

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
            ast.parts.ptr_mut()[1] = Part {
                stmts: &[],
                is_live: true,
                import_record_indices: 'brk2: {
                    // Generate a single part that depends on all the import records.
                    // This is to ensure that we generate a JavaScript bundle containing all the user's code.
                    let mut import_record_indices =
                        Part::ImportRecordIndices::init_capacity(bump, scanner.import_records.len)?;
                    import_record_indices.len = scanner.import_records.len as u32;
                    for (index, import_record) in import_record_indices.slice_mut().iter_mut().enumerate() {
                        *import_record = u32::try_from(index).unwrap();
                    }
                    break 'brk2 import_record_indices;
                },
                ..Default::default()
            };

            // Try to avoid generating unnecessary ESM <> CJS wrapper code.
            if opts.output_format == options::OutputFormat::Esm
                || opts.output_format == options::OutputFormat::Iife
            {
                ast.exports_kind = ast::ExportsKind::Esm;
            }

            return Ok(JSAst::init(ast));
        }
        Loader::Css => {
            // make css ast
            let mut import_records = BabyList::<ImportRecord>::default();
            let source_code = source.contents;
            let mut temp_log = Log::init(bump);
            // PORT NOTE: Zig `defer { temp_log.appendToMaybeRecycled(log, source) }`
            let guard = scopeguard::guard((), |_| {
                let _ = temp_log.append_to_maybe_recycled(log, source);
            });

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
                source.index,
            ) {
                Ok(v) => v,
                Err(e) => {
                    e.add_to_logger(&mut temp_log, source, bump)?;
                    drop(guard);
                    return Err(err!("SyntaxError"));
                }
            };
            // Make sure the css modules local refs have a valid tag
            #[cfg(debug_assertions)]
            {
                if css_ast.local_scope.count() > 0 {
                    for entry in css_ast.local_scope.values() {
                        let r = entry.ref_;
                        debug_assert!(r.inner_index() < extra.symbols.len);
                    }
                }
            }
            if let Some(e) = css_ast
                .minify(
                    bump,
                    bun_css::MinifyOptions {
                        targets: bun_css::Targets::for_bundler_target(transpiler.options.target),
                        unused_symbols: Default::default(),
                    },
                    &mut extra,
                )
                .as_err()
            {
                e.add_to_logger(&mut temp_log, source, bump)?;
                drop(guard);
                return Err(err!("MinifyError"));
            }
            if css_ast.local_scope.count() > 0 {
                let _ = has_any_css_locals.fetch_add(1, Ordering::Relaxed);
            }
            // If this is a css module, the final exports object wil be set in `generateCodeForLazyExport`.
            let root = Expr::init(E::Object::default(), Loc { start: 0 });
            let css_ast_heap = bump.alloc(css_ast);
            let mut ast = JSAst::init(
                js_parser::new_lazy_export_ast_impl(
                    bump,
                    &transpiler.options.define,
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
            drop(guard);
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
            let content_hash = ContentHasher::run(source.contents);

            let unique_key: &[u8] = if transpiler.options.dev_server.is_some() {
                // With DevServer, the actual URL is added now, since it can be
                // known this far ahead of time, and it means the unique key code
                // does not have to perform an additional pass over files.
                //
                // To avoid a mutex, the actual insertion of the asset to DevServer
                // is done on the bundler thread.
                let mut buf = bumpalo::collections::Vec::new_in(bump);
                write!(
                    &mut buf,
                    "{}/{}{}",
                    bun_bake::DevServer::ASSET_PREFIX,
                    bun_core::fmt::bytes_to_hex_lower(&content_hash.to_ne_bytes()),
                    bstr::BStr::new(bun_paths::extension(source.path.text)),
                )?;
                buf.into_bump_slice()
            } else {
                let mut buf = bumpalo::collections::Vec::new_in(bump);
                write!(
                    &mut buf,
                    "{}A{:08}",
                    bun_core::fmt::hex_int_lower(unique_key_prefix),
                    source.index.get()
                )?;
                buf.into_bump_slice()
            };
            let root = Expr::init(E::String { data: unique_key, ..Default::default() }, Loc { start: 0 });
            *unique_key_for_additional_file = FileLoaderHash {
                key: unique_key,
                content_hash,
            };
            let mut ast = JSAst::init(
                js_parser::new_lazy_export_ast(bump, &transpiler.options.define, opts, log, root, source, b"")?
                    .unwrap(),
            );
            ast.add_url_for_css(bump, source, None, Some(unique_key), transpiler.options.compile_to_standalone_html);
            return Ok(ast);
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// getCodeForParseTaskWithoutPlugins
// ───────────────────────────────────────────────────────────────────────────

fn get_code_for_parse_task_without_plugins(
    task: &mut ParseTask,
    log: &mut Log,
    transpiler: &mut Transpiler,
    resolver: &mut Resolver,
    bump: &Bump,
    file_path: &mut Fs::Path,
    loader: Loader,
) -> core::result::Result<CacheEntry, AnyError> {
    match &task.contents_or_fd {
        ContentsOrFd::Fd { dir, file } => 'brk: {
            let contents_dir = *dir;
            let contents_file = *file;
            let _trace = bun_core::perf::trace("Bundler.readFile");

            // SAFETY: ctx backref is valid for ParseTask lifetime.
            let ctx = unsafe { &*task.ctx };

            // Check FileMap for in-memory files first
            if let Some(file_map) = &ctx.file_map {
                if let Some(file_contents) = file_map.get(file_path.text) {
                    break 'brk Ok(CacheEntry {
                        contents: file_contents,
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
                                bun_bake::BuiltInModule::Code(code) => {
                                    break 'brk Ok(CacheEntry {
                                        contents: code,
                                        fd: Fd::INVALID,
                                        ..Default::default()
                                    });
                                }
                                bun_bake::BuiltInModule::Import(path) => {
                                    *file_path = Fs::Path::init(path);
                                    break 'lookup_builtin;
                                }
                            }
                        }
                    }

                    break 'brk Ok(CacheEntry {
                        contents: NodeFallbackModules::contents_from_path(file_path.text)
                            .unwrap_or(b""),
                        fd: Fd::INVALID,
                        ..Default::default()
                    });
                }
            }

            break 'brk match resolver.caches.fs.read_file_with_allocator(
                // TODO: this allocator may be wrong for native plugins
                if loader.should_copy_for_bundling() {
                    // The OutputFile will own the memory for the contents
                    // TODO(port): bun.default_allocator vs bump distinction
                    None
                } else {
                    Some(bump)
                },
                &transpiler.fs,
                file_path.text,
                contents_dir,
                false,
                contents_file.unwrap_valid(),
            ) {
                Ok(e) => Ok(e),
                Err(e) => {
                    let source = Source::init_empty_file(
                        // TODO(port): zig duped via log.msgs.allocator
                        bump.alloc_slice_copy(file_path.text),
                    );
                    if e == err!("ENOENT") || e == err!("FileNotFound") {
                        let _ = log.add_error_fmt(
                            Some(&source),
                            Loc::EMPTY,
                            bump,
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
                            bump,
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
            contents,
            fd: Fd::INVALID,
            ..Default::default()
        }),
    }
}

// ───────────────────────────────────────────────────────────────────────────
// getCodeForParseTask
// ───────────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn get_code_for_parse_task(
    task: &mut ParseTask,
    log: &mut Log,
    transpiler: &mut Transpiler,
    resolver: &mut Resolver,
    bump: &Bump,
    file_path: &mut Fs::Path,
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
        if !plugin.has_on_before_parse_plugins() {
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
        result: None,
    };

    // SAFETY: task.ctx backref valid for the duration of the parse.
    let plugins = unsafe { &*ctx.task.ctx }.plugins.as_ref().expect("unreachable");
    ctx.run(plugins, from_plugin)
}

// ───────────────────────────────────────────────────────────────────────────
// OnBeforeParsePlugin
// ───────────────────────────────────────────────────────────────────────────

pub struct OnBeforeParsePlugin<'a> {
    task: &'a mut ParseTask,
    log: &'a mut Log,
    transpiler: &'a mut Transpiler,
    resolver: &'a mut Resolver,
    bump: &'a Bump,
    file_path: &'a mut Fs::Path,
    loader: &'a mut Loader,
    deferred_error: Option<AnyError>,
    should_continue_running: &'a mut i32,

    result: Option<&'a mut OnBeforeParseResult>,
}

// TODO(port): comptime size/align asserts vs bun.c.OnBeforeParseArguments etc.
// Phase B: const _: () = assert!(size_of::<OnBeforeParseArguments>() == size_of::<bun_sys::c::OnBeforeParseArguments>());
const _: () = {
    // Placeholder to keep the comptime block visible to reviewers.
};

#[repr(C)]
pub struct OnBeforeParseArguments {
    pub struct_size: usize,
    pub context: *mut OnBeforeParsePlugin<'static>, // FFI (LIFETIMES.tsv)
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

    pub fn append(&self, log: &mut Log, namespace: &[u8]) {
        // TODO(port): zig used log.msgs.allocator; using global alloc.
        let source_line_text = self.source_line_text();
        let location = Location::init(
            self.path(),
            namespace,
            self.line.max(-1),
            self.column.max(-1),
            (self.column_end - self.column).max(0),
            if !source_line_text.is_empty() {
                Some(Box::<[u8]>::from(source_line_text))
            } else {
                None
            },
        );
        let mut msg = Msg {
            data: logger::Data {
                location: Some(location),
                text: Box::<[u8]>::from(self.message()),
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
        log.add_msg(msg);
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

pub extern "C" fn fetch_source_code(
    args: *mut OnBeforeParseArguments,
    result: *mut OnBeforeParseResult,
) -> i32 {
    scoped_log!(ParseTask, "fetchSourceCode");
    // SAFETY: called from C plugin; args/result are valid per FFI contract.
    let args = unsafe { &mut *args };
    let result = unsafe { &mut *result };
    let this = unsafe { &mut *args.context };
    if this.log.errors > 0 || this.deferred_error.is_some() || *this.should_continue_running != 1 {
        return 1;
    }

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
            *this.should_continue_running = 0;
            return 1;
        }
    };
    result.source_ptr = entry.contents.as_ptr();
    result.source_len = entry.contents.len();
    result.free_user_context = None;
    result.user_context = core::ptr::null_mut();
    // SAFETY: result is always embedded in a wrapper.
    let wrapper = unsafe { &mut *OnBeforeParseResult::get_wrapper(result) };
    wrapper.original_source = entry.contents.as_ptr();
    wrapper.original_source_len = entry.contents.len();
    wrapper.original_source_fd = entry.fd;
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn OnBeforeParseResult__reset(this: *mut OnBeforeParseResult) {
    // SAFETY: called from C++ with valid ptr embedded in wrapper.
    let this = unsafe { &mut *this };
    let wrapper = unsafe { &mut *OnBeforeParseResult::get_wrapper(this) };
    this.loader = wrapper.loader;
    if !wrapper.original_source.is_null() {
        this.source_ptr = wrapper.original_source;
        this.source_len = wrapper.original_source_len;
    } else {
        this.source_ptr = core::ptr::null();
        this.source_len = 0;
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn OnBeforeParsePlugin__isDone(this: *mut OnBeforeParsePlugin<'_>) -> i32 {
    // SAFETY: called from C++ with valid ptr.
    let this = unsafe { &mut *this };
    if *this.should_continue_running != 1 {
        return 1;
    }

    let Some(result) = this.result.as_deref_mut() else { return 1 };
    // The first plugin to set the source wins.
    // But, we must check that they actually modified it
    // since fetching the source stores it inside `result.source_ptr`
    if !result.source_ptr.is_null() {
        // SAFETY: result is always embedded in a wrapper.
        let wrapper = unsafe { &*OnBeforeParseResult::get_wrapper(result) };
        return (result.source_ptr != wrapper.original_source) as i32;
    }

    0
}

impl<'a> OnBeforeParsePlugin<'a> {
    pub fn run(
        &mut self,
        plugin: &jsc::api::JSBundler::Plugin,
        from_plugin: &mut bool,
    ) -> core::result::Result<CacheEntry, AnyError> {
        let mut args = OnBeforeParseArguments {
            context: self as *mut _ as *mut OnBeforeParsePlugin<'static>,
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

        // SAFETY: wrapper.result outlives self.result usage (cleared before return).
        // TODO(port): self-referential borrow — using raw ptr cast to satisfy borrowck.
        self.result = Some(unsafe { &mut *(&mut wrapper.result as *mut _) });
        let namespace_str;
        let path_str = bun_string::String::init(self.file_path.text);
        let count = plugin.call_on_before_parse_plugins(
            self as *mut _,
            if self.file_path.namespace == b"file" {
                &bun_string::String::EMPTY
            } else {
                namespace_str = bun_string::String::init(self.file_path.namespace);
                &namespace_str
            },
            &path_str,
            &mut args,
            &mut wrapper.result,
            self.should_continue_running,
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
                        text: Box::<[u8]>::from(
                            &b"Native plugin set the `free_plugin_source_code_context` field without setting the `plugin_source_code_context` field."[..],
                        ),
                        ..Default::default()
                    },
                    ..Default::default()
                };
                msg.kind = logger::Kind::Err;
                // SAFETY: args.context == self.
                let ctx = unsafe { &mut *args.context };
                ctx.log.errors += 1;
                ctx.log.add_msg(msg);
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
                if wrapper.result.free_user_context.is_some() {
                    self.task.external_free_function = CacheEntry::ExternalFreeFunction {
                        ctx: wrapper.result.user_context,
                        function: wrapper.result.free_user_context,
                    };
                }
                *from_plugin = true;
                *self.loader = wrapper.result.loader;
                // SAFETY: ptr/len set by C plugin; trusted per FFI contract.
                let contents =
                    unsafe { core::slice::from_raw_parts(ptr, wrapper.result.source_len) };
                return Ok(CacheEntry {
                    contents,
                    external_free_function: CacheEntry::ExternalFreeFunction {
                        ctx: wrapper.result.user_context,
                        function: wrapper.result.free_user_context,
                    },
                    fd: wrapper.original_source_fd,
                    ..Default::default()
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
    this: &mut ThreadPool::Worker,
    log: &mut Log,
) -> core::result::Result<CacheEntry, AnyError> {
    let bump = this.allocator;

    let data = this.data;
    let transpiler = &mut data.transpiler;
    // PORT NOTE: errdefer transpiler.resetStore() — using scopeguard.
    let guard = scopeguard::guard(&mut *transpiler, |t| t.reset_store());
    let resolver: &mut Resolver = &mut guard.resolver;
    let mut file_path = task.path.clone();
    let mut loader = task
        .loader
        .or_else(|| file_path.loader(&guard.options.loaders))
        .unwrap_or(Loader::File);

    let mut contents_came_from_plugin: bool = false;
    let result = get_code_for_parse_task(
        task,
        log,
        // PORT NOTE: reshaped for borrowck — guard derefs to &mut Transpiler.
        &mut *guard,
        resolver,
        bump,
        &mut file_path,
        &mut loader,
        &mut contents_came_from_plugin,
    );
    if result.is_ok() {
        scopeguard::ScopeGuard::into_inner(guard);
    }
    result
}

// ───────────────────────────────────────────────────────────────────────────
// runWithSourceCode
// ───────────────────────────────────────────────────────────────────────────

fn run_with_source_code(
    task: &mut ParseTask,
    this: &mut ThreadPool::Worker,
    step: &mut Step,
    log: &mut Log,
    entry: &mut CacheEntry,
) -> core::result::Result<Success, AnyError> {
    let bump = this.allocator;

    let mut transpiler = this.transpiler_for_target(task.known_target);
    // TODO(port): errdefer transpiler.resetStore() + errdefer entry.deinit().
    // Using a single scopeguard that captures both; disarmed on success.
    let resolver: &mut Resolver = &mut transpiler.resolver;
    let file_path = &mut task.path;
    let loader = task
        .loader
        .or_else(|| file_path.loader(&transpiler.options.loaders))
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

    let cleanup = scopeguard::guard((&mut *transpiler, &mut *entry, task.contents_or_fd.tag()), |(t, e, tag)| {
        #[cfg(debug_assertions)]
        {
            // TODO(port): cannot re-read task here without aliasing; check moved
            // to use captured tag snapshot. Phase B: revisit.
            let _ = debug_original_variant_check;
        }
        if tag == ContentsOrFdTag::Fd {
            e.deinit(/* bump */);
        }
        t.reset_store();
    });
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

    let is_empty = strings::is_all_whitespace(entry.contents);

    let use_directive: UseDirective = if !is_empty && transpiler.options.server_components {
        UseDirective::parse(entry.contents).unwrap_or(UseDirective::None)
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
        ((transpiler.options.server_components || transpiler.options.dev_server.is_some())
            && task.known_target == options::Target::Browser)
    {
        // separate_ssr_graph makes boundaries switch to client because the server file uses that generated file as input.
        // this is not done when there is one server graph because it is easier for plugins to deal with.
        transpiler = this.transpiler_for_target(options::Target::Browser);
    }

    let source = Source {
        path: file_path.clone(),
        index: task.source_index,
        contents: entry.contents,
        contents_is_recycled: false,
        ..Default::default()
    };

    let target = (if task.source_index.get() == 1 {
        target_from_hashbang(entry.contents)
    } else {
        None
    })
    .unwrap_or_else(|| {
        if task.known_target == options::Target::BakeServerComponentsSsr
            && transpiler
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
            transpiler.options.target
        }
    });

    let output_format = transpiler.options.output_format;

    let mut opts = js_parser::parser::Options::init(task.jsx.clone(), loader);
    opts.bundle = true;
    opts.warn_about_unbundled_modules = false;
    opts.allow_unresolved = &transpiler.options.allow_unresolved;
    opts.macro_context = transpiler.macro_context.as_mut().unwrap();
    opts.package_version = task.package_version;

    opts.features.allow_runtime = !source.index.is_runtime();
    opts.features.unwrap_commonjs_to_esm =
        output_format == options::OutputFormat::Esm && FeatureFlags::UNWRAP_COMMONJS_TO_ESM;
    opts.features.top_level_await = output_format == options::OutputFormat::Esm
        || output_format == options::OutputFormat::InternalBakeDev;
    opts.features.auto_import_jsx = task.jsx.parse && transpiler.options.auto_import_jsx;
    opts.features.trim_unused_imports =
        loader.is_typescript() || transpiler.options.trim_unused_imports.unwrap_or(false);
    opts.features.inlining = transpiler.options.minify_syntax;
    opts.output_format = output_format;
    opts.features.minify_syntax = transpiler.options.minify_syntax;
    opts.features.minify_identifiers = transpiler.options.minify_identifiers;
    opts.features.minify_keep_names = transpiler.options.keep_names;
    opts.features.minify_whitespace = transpiler.options.minify_whitespace;
    opts.features.emit_decorator_metadata = task.emit_decorator_metadata;
    // emitDecoratorMetadata implies legacy/experimental decorators, as it only
    // makes sense with TypeScript's legacy decorator system (reflect-metadata).
    // TC39 standard decorators have their own metadata mechanism.
    opts.features.standard_decorators =
        !loader.is_typescript() || !(task.experimental_decorators || task.emit_decorator_metadata);
    opts.features.unwrap_commonjs_packages = transpiler.options.unwrap_commonjs_packages.clone();
    opts.features.bundler_feature_flags = transpiler.options.bundler_feature_flags;
    // JavaScriptCore implements `using` / `await using` natively, so when
    // targeting Bun there is no need to lower them.
    opts.features.lower_using = !target.is_bun();
    opts.features.hot_module_reloading =
        output_format == options::OutputFormat::InternalBakeDev && !source.index.is_runtime();
    opts.features.auto_polyfill_require =
        output_format == options::OutputFormat::Esm && !opts.features.hot_module_reloading;
    opts.features.react_fast_refresh = transpiler.options.react_fast_refresh
        && loader.is_jsx()
        && !source.path.is_node_module();

    opts.features.server_components = if transpiler.options.server_components {
        match target {
            options::Target::Browser => js_parser::ServerComponents::ClientSide,
            _ => match use_directive {
                UseDirective::None => js_parser::ServerComponents::WrapAnonServerFunctions,
                UseDirective::Client => {
                    if transpiler
                        .options
                        .framework
                        .as_ref()
                        .unwrap()
                        .server_components
                        .as_ref()
                        .unwrap()
                        .separate_ssr_graph
                    {
                        js_parser::ServerComponents::ClientSide
                    } else {
                        js_parser::ServerComponents::WrapExportsForClientReference
                    }
                }
                UseDirective::Server => js_parser::ServerComponents::WrapExportsForServerReference,
            },
        }
    } else {
        js_parser::ServerComponents::None
    };

    opts.framework = transpiler.options.framework.clone();

    opts.ignore_dce_annotations =
        transpiler.options.ignore_dce_annotations && !source.index.is_runtime();

    // For files that are not user-specified entrypoints, set `import.meta.main` to `false`.
    // Entrypoints will have `import.meta.main` set as "unknown", unless we use `--compile`,
    // in which we inline `true`.
    if transpiler.options.inline_entrypoint_import_meta_main || !task.is_entry_point {
        opts.import_meta_main_value =
            Some(task.is_entry_point && transpiler.options.dev_server.is_none());
    } else if target == options::Target::Node {
        opts.lower_import_meta_main_for_node_js = true;
    }

    opts.tree_shaking = if source.index.is_runtime() {
        true
    } else {
        transpiler.options.tree_shaking
    };
    opts.code_splitting = transpiler.options.code_splitting;
    opts.module_type = task.module_type;

    task.jsx.parse = loader.is_jsx();

    let mut unique_key_for_additional_file = FileLoaderHash {
        key: b"",
        content_hash: 0,
    };
    // SAFETY: task.ctx backref valid.
    let task_ctx = unsafe { &*task.ctx };
    let mut ast: JSAst = if !is_empty || loader.handles_empty_file() {
        get_ast(
            log,
            transpiler,
            opts.clone(),
            bump,
            resolver,
            &source,
            loader,
            task_ctx.unique_key,
            &mut unique_key_for_additional_file,
            &task_ctx.linker.has_any_css_locals,
        )?
    } else if opts.module_type == options::ModuleType::Esm {
        if loader.is_css() {
            get_empty_css_ast(log, transpiler, opts, bump, &source)?
        } else {
            get_empty_ast::<E::Undefined>(log, transpiler, opts, bump, &source)?
        }
    } else {
        if loader.is_css() {
            get_empty_css_ast(log, transpiler, opts, bump, &source)?
        } else {
            get_empty_ast::<E::Object>(log, transpiler, opts, bump, &source)?
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

    // Disarm errdefer cleanup.
    scopeguard::ScopeGuard::into_inner(cleanup);

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
// taskCallback / ioTaskCallback
// ───────────────────────────────────────────────────────────────────────────

fn io_task_callback(task: *mut ThreadPoolLib::Task) {
    // SAFETY: task points to ParseTask.io_task.
    let parse_task = unsafe {
        &mut *(task as *mut u8)
            .sub(offset_of!(ParseTask, io_task))
            .cast::<ParseTask>()
    };
    run_from_thread_pool(parse_task);
}

fn task_callback(task: *mut ThreadPoolLib::Task) {
    // SAFETY: task points to ParseTask.task.
    let parse_task = unsafe {
        &mut *(task as *mut u8)
            .sub(offset_of!(ParseTask, task))
            .cast::<ParseTask>()
    };
    run_from_thread_pool(parse_task);
}

pub fn run_from_thread_pool(this: &mut ParseTask) {
    // SAFETY: ctx backref valid.
    let ctx = unsafe { &*this.ctx };
    let mut worker = ThreadPool::Worker::get(ctx);
    // PORT NOTE: `defer worker.unget()` — handled by guard / Drop.
    let _worker_guard = scopeguard::guard((), |_| worker.unget());
    scoped_log!(
        ParseTask,
        "ParseTask(0x{:x}, {}) callback",
        this as *mut _ as usize,
        bstr::BStr::new(this.path.text)
    );

    let mut step: Step = Step::Pending;
    let mut log = Log::init(worker.allocator);
    debug_assert!(this.source_index.is_valid()); // forgot to set source_index

    let value: ResultValue = 'value: {
        if matches!(this.stage, ParseTaskStage::NeedsSourceCode) {
            match get_source_code(this, &mut worker, &mut log) {
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

            if ThreadPool::uses_io_pool() {
                ctx.graph.pool.schedule_inside_thread_pool(this);
                return;
            }
        }

        let ParseTaskStage::NeedsParse(ref mut entry) = this.stage else {
            unreachable!()
        };
        match run_with_source_code(this, &mut worker, &mut step, &mut log, entry) {
            // PORT NOTE: reshaped for borrowck — `this` and `this.stage.needs_parse`
            // both borrowed mutably; Phase B may need to restructure.
            Ok(ast) => {
                // When using HMR, always flag asts with errors as parse failures.
                // Not done outside of the dev server out of fear of breaking existing code.
                if ctx.transpiler.options.dev_server.is_some() && ast.log.has_errors() {
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
        task: Default::default(),
        value,
        external: this.external_free_function,
        watcher_data: match this.contents_or_fd {
            ContentsOrFd::Fd { file, dir } => WatcherData { fd: file, dir_fd: dir },
            ContentsOrFd::Contents(_) => WatcherData::NONE,
        },
    });
    let result = Box::into_raw(result);

    // SAFETY: worker.ctx backref valid.
    match unsafe { &*worker.ctx }.loop_() {
        EventLoop::Js(jsc_event_loop) => {
            jsc_event_loop
                .enqueue_task_concurrent(jsc::ConcurrentTask::from_callback(result, on_complete));
        }
        EventLoop::Mini(mini) => {
            mini.enqueue_task_concurrent_with_extra_ctx::<Result, BundleV2>(
                result,
                BundleV2::on_parse_task_complete,
                offset_of!(Result, task),
                // TODO(port): Zig passed `.task` (field name) for the comptime
                // offset; using offset_of! here. Phase B: verify signature.
            );
        }
    }
}

pub fn on_complete(result: *mut Result) {
    // SAFETY: result allocated via Box::into_raw above; ctx backref valid.
    let r = unsafe { &mut *result };
    BundleV2::on_parse_task_complete(result, unsafe { &*r.ctx });
}

// ───────────────────────────────────────────────────────────────────────────
// Re-exports
// ───────────────────────────────────────────────────────────────────────────

pub use bun_js_parser::ast::Ref;
pub use bun_js_parser::ast::Index;

pub use crate::bundle_v2::DeferredBatchTask;
pub use crate::bundle_v2::ThreadPool;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/ParseTask.zig (1496 lines)
//   confidence: medium
//   todos:      19
//   notes:      Arena lifetimes for &[u8] fields placeholdered as &'static; init() should switch to ..Default::default() in Phase B; errdefer scopeguards in run_with_source_code/get_source_code reshaped for borrowck and need Phase B verification; OnBeforeParseResultWrapper.check field layout differs in release.
// ──────────────────────────────────────────────────────────────────────────
