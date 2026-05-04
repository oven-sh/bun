use std::cell::Cell;
use std::io::Write as _;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_bundler::options::{self, Loader, PackagesOption, SourceMapOption, Target};
use bun_bundler::{self as Transpiler, MacroJSCtx, ParseResult};
use bun_core::Error;
use bun_jsc::{
    self as jsc, CallFrame, JSArrayIterator, JSGlobalObject, JSPromise, JSPropertyIterator,
    JSPropertyIteratorOptions, JSValue, JsResult, VirtualMachine, ZigString,
};
use bun_jsc::node::StringOrBuffer;
use bun_js_parser::runtime::Runtime;
use bun_js_parser::{self as JSParser, ScanPassResult};
use bun_js_parser::ast::{self as JSAst, Expr};
use bun_js_parser::lexer as JSLexer;
use bun_js_parser::printer as JSPrinter;
use bun_logger as logger;
use bun_options_types::ImportRecord;
use bun_resolver::package_json::{MacroMap, PackageJSON};
use bun_resolver::tsconfig_json::TSConfigJSON;
use bun_runtime::api::BuildMessage;
use bun_schema::api;
use bun_str::{self as strings, String as BunString};

// TODO(port): `pub const js = jsc.Codegen.JSTranspiler;` and the toJS/fromJS/fromJSDirect
// aliases are wired by `#[bun_jsc::JsClass]` codegen — see PORTING.md §JSC types.

#[bun_jsc::JsClass]
pub struct JSTranspiler {
    pub transpiler: Transpiler::Transpiler,
    pub config: Config,
    pub scan_pass_result: ScanPassResult,
    pub buffer_writer: Option<JSPrinter::BufferWriter>,
    pub log_level: logger::Log::Level,
    // TODO(port): non-AST crate keeps an arena field for bulk-freeing config strings.
    // Consider replacing with per-field Box ownership in Phase B.
    pub arena: Arena,
    // Intrusive refcount field for `bun_ptr::IntrusiveRc<JSTranspiler>`.
    // TODO(port): LIFETIMES.tsv classifies the consumer (`TransformTask.js_instance`) as
    // `Arc<JSTranspiler>`, but `bun.ptr.RefCount` is single-thread intrusive and `*JSTranspiler`
    // crosses FFI as `m_ctx`. Reconcile in Phase B (likely IntrusiveRc, not Arc).
    pub ref_count: Cell<u32>,
}

// `pub const ref/deref` from RefCount mixin → provided by `bun_ptr::IntrusiveRc<Self>`.
// TODO(port): expose `ref()`/`deref()` via IntrusiveRc impl.

const fn default_transform_options() -> api::TransformOptions {
    // SAFETY: api::TransformOptions is #[repr(C)] POD; all-zero is a valid value.
    let mut opts: api::TransformOptions = unsafe { core::mem::zeroed() };
    opts.disable_hmr = true;
    opts.target = api::Target::Browser;
    opts
}
const DEFAULT_TRANSFORM_OPTIONS: api::TransformOptions = default_transform_options();

pub struct Config {
    pub transform: api::TransformOptions,
    pub default_loader: Loader,
    pub macro_map: MacroMap,
    pub tsconfig: Option<Box<TSConfigJSON>>,
    pub tsconfig_buf: Box<[u8]>,
    pub macros_buf: Box<[u8]>,
    pub log: logger::Log,
    pub runtime: Runtime::Features,
    pub tree_shaking: bool,
    pub trim_unused_imports: Option<bool>,
    pub inlining: bool,

    pub dead_code_elimination: bool,
    pub minify_whitespace: bool,
    pub minify_identifiers: bool,
    pub minify_syntax: bool,
    pub no_macros: bool,
    pub repl_mode: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            transform: DEFAULT_TRANSFORM_OPTIONS,
            default_loader: Loader::Jsx,
            macro_map: MacroMap::default(),
            tsconfig: None,
            tsconfig_buf: Box::default(),
            macros_buf: Box::default(),
            log: logger::Log::default(), // overwritten at construction
            runtime: {
                let mut r = Runtime::Features::default();
                r.top_level_await = true;
                r
            },
            tree_shaking: false,
            trim_unused_imports: None,
            inlining: false,
            dead_code_elimination: true,
            minify_whitespace: false,
            minify_identifiers: false,
            minify_syntax: false,
            no_macros: false,
            repl_mode: false,
        }
    }
}

impl Config {
    // PORT NOTE: out-param constructor kept as `&mut self` because `self` is a pre-initialized
    // field on `JSTranspiler` (in-place mutation), not a fresh value to return.
    // Allocator param dropped (non-AST crate; global mimalloc).
    pub fn from_js(&mut self, global: &JSGlobalObject, object: JSValue) -> JsResult<()> {
        if object.is_undefined_or_null() {
            return Ok(());
        }

        if !object.is_object() {
            return global.throw_invalid_arguments("Expected an object", format_args!(""));
        }

        if let Some(define) = object.get_truthy(global, "define")? {
            'define: {
                if define.is_undefined_or_null() {
                    break 'define;
                }

                let Some(define_obj) = define.get_object() else {
                    return global
                        .throw_invalid_arguments("define must be an object", format_args!(""));
                };

                let mut define_iter = JSPropertyIterator::init(
                    global,
                    define_obj,
                    JSPropertyIteratorOptions {
                        skip_empty_name: true,
                        include_value: true,
                    },
                )?;
                // `defer define_iter.deinit()` → Drop

                // `define_iter.i` is the property position, not a dense index of yielded
                // entries. With `skip_empty_name = true` (or a skipped property getter),
                // writing at `define_iter.i` would leave earlier slots uninitialized.
                // Use Vecs so the stored slice is always exactly what was appended.
                let mut names: Vec<Box<[u8]>> = Vec::new();
                let mut values: Vec<Box<[u8]>> = Vec::new();
                names.reserve_exact(define_iter.len());
                values.reserve_exact(define_iter.len());

                while let Some(prop) = define_iter.next()? {
                    let property_value = define_iter.value;
                    let value_type = property_value.js_type();

                    if !value_type.is_string_like() {
                        return global.throw_invalid_arguments(
                            "define \"{}\" must be a JSON string",
                            format_args!("{}", prop),
                        );
                    }

                    // PERF(port): was appendAssumeCapacity — profile in Phase B
                    names.push(prop.to_owned_slice().into());
                    let mut val = ZigString::init(b"");
                    property_value.to_zig_string(&mut val, global)?;
                    if val.len == 0 {
                        val = ZigString::init(b"\"\"");
                    }
                    let mut buf = Vec::new();
                    write!(&mut buf, "{}", val).expect("unreachable");
                    // PERF(port): was appendAssumeCapacity — profile in Phase B
                    values.push(buf.into_boxed_slice());
                }

                self.transform.define = api::StringMap {
                    keys: names,
                    values,
                };
            }
        }

        if let Some(external) = object.get(global, "external")? {
            'external: {
                if external.is_undefined_or_null() {
                    break 'external;
                }

                let toplevel_type = external.js_type();
                if toplevel_type.is_string_like() {
                    let mut zig_str = ZigString::init(b"");
                    external.to_zig_string(&mut zig_str, global)?;
                    if zig_str.len == 0 {
                        break 'external;
                    }
                    let mut single_external: Vec<Box<[u8]>> = Vec::with_capacity(1);
                    let mut buf = Vec::new();
                    write!(&mut buf, "{}", zig_str).expect("unreachable");
                    single_external.push(buf.into_boxed_slice());
                    self.transform.external = single_external;
                } else if toplevel_type.is_array() {
                    let count = external.get_length(global)?;
                    if count == 0 {
                        break 'external;
                    }

                    let mut externals: Vec<Box<[u8]>> = Vec::with_capacity(count);
                    let mut iter = external.array_iterator(global)?;
                    let mut i: usize = 0;
                    while let Some(entry) = iter.next()? {
                        if !entry.js_type().is_string_like() {
                            return global.throw_invalid_arguments(
                                "external must be a string or string[]",
                                format_args!(""),
                            );
                        }

                        let mut zig_str = ZigString::init(b"");
                        entry.to_zig_string(&mut zig_str, global)?;
                        if zig_str.len == 0 {
                            continue;
                        }
                        let mut buf = Vec::new();
                        write!(&mut buf, "{}", zig_str).expect("unreachable");
                        externals.push(buf.into_boxed_slice());
                        i += 1;
                    }

                    externals.truncate(i);
                    self.transform.external = externals;
                } else {
                    return global.throw_invalid_arguments(
                        "external must be a string or string[]",
                        format_args!(""),
                    );
                }
            }
        }

        if let Some(loader) = object.get(global, "loader")? {
            if let Some(resolved) = Loader::from_js(global, loader)? {
                if !resolved.is_java_script_like() {
                    return global.throw_invalid_arguments(
                        "only JavaScript-like loaders supported for now",
                        format_args!(""),
                    );
                }

                self.default_loader = resolved;
            }
        }

        if let Some(target) = object.get(global, "target")? {
            if let Some(resolved) = Target::from_js(global, target)? {
                self.transform.target = resolved.to_api();
            }
        }

        if let Some(tsconfig) = object.get(global, "tsconfig")? {
            'tsconfig: {
                if tsconfig.is_undefined_or_null() {
                    break 'tsconfig;
                }
                let kind = tsconfig.js_type();
                let mut out = BunString::empty();
                // `defer out.deref()` → Drop on bun_str::String

                if kind.is_array() {
                    return global.throw_invalid_arguments(
                        "tsconfig must be a string or object",
                        format_args!(""),
                    );
                }

                if !kind.is_string_like() {
                    // Use jsonStringifyFast for SIMD-optimized serialization
                    tsconfig.json_stringify_fast(global, &mut out)?;
                } else {
                    out = tsconfig.to_bun_string(global)?;
                }

                if out.is_empty() {
                    break 'tsconfig;
                }
                self.tsconfig_buf = out.to_owned_slice();

                // TODO: JSC -> Ast conversion
                if let Ok(Some(parsed_tsconfig)) = TSConfigJSON::parse(
                    &mut self.log,
                    &logger::Source::init_path_string(b"tsconfig.json", &self.tsconfig_buf),
                    &mut VirtualMachine::get().transpiler.resolver.caches.json,
                ) {
                    self.tsconfig = Some(parsed_tsconfig);
                }
            }
        }

        self.runtime.allow_runtime = false;

        if let Some(macros) = object.get_truthy(global, "macro")? {
            'macros: {
                if macros.is_undefined_or_null() {
                    break 'macros;
                }
                if macros.is_boolean() {
                    self.no_macros = !macros.as_boolean();
                    break 'macros;
                }
                let kind = macros.js_type();
                let is_object = kind.is_object();
                if !(kind.is_string_like() || is_object) {
                    return global
                        .throw_invalid_arguments("macro must be an object", format_args!(""));
                }

                let mut out = BunString::empty();
                // `defer out.deref()` → Drop
                // TODO: write a converter between JSC types and Bun AST types
                if is_object {
                    // Use jsonStringifyFast for SIMD-optimized serialization
                    macros.json_stringify_fast(global, &mut out)?;
                } else {
                    out = macros.to_bun_string(global)?;
                }

                if out.is_empty() {
                    break 'macros;
                }
                self.macros_buf = out.to_owned_slice();
                let source = logger::Source::init_path_string(b"macros.json", &self.macros_buf);
                let Ok(Some(json)) = VirtualMachine::get()
                    .transpiler
                    .resolver
                    .caches
                    .json
                    .parse_json(&mut self.log, &source, /* mode */ JsonMode::Json, false)
                else {
                    break 'macros;
                };
                // TODO(port): `JsonMode::Json` placeholder for `.json` enum literal
                self.macro_map = PackageJSON::parse_macros_json(json, &mut self.log, &source);
            }
        }

        if let Some(flag) = object.get_boolean_loose(global, "autoImportJSX")? {
            self.runtime.auto_import_jsx = flag;
        }

        if let Some(flag) = object.get_boolean_loose(global, "allowBunRuntime")? {
            self.runtime.allow_runtime = flag;
        }

        if let Some(flag) = object.get_boolean_loose(global, "inline")? {
            self.runtime.inlining = flag;
        }

        if let Some(flag) = object.get_boolean_loose(global, "minifyWhitespace")? {
            self.minify_whitespace = flag;
        }

        if let Some(flag) = object.get_boolean_loose(global, "deadCodeElimination")? {
            self.dead_code_elimination = flag;
        }

        if let Some(flag) = object.get_boolean_loose(global, "replMode")? {
            self.repl_mode = flag;
        }

        if let Some(minify) = object.get_truthy(global, "minify")? {
            if minify.is_boolean() {
                self.minify_whitespace = minify.to_boolean();
                self.minify_syntax = self.minify_whitespace;
                self.minify_identifiers = self.minify_syntax;
            } else if minify.is_object() {
                if let Some(whitespace) = minify.get_boolean_loose(global, "whitespace")? {
                    self.minify_whitespace = whitespace;
                }
                if let Some(syntax) = minify.get_boolean_loose(global, "syntax")? {
                    self.minify_syntax = syntax;
                }
                if let Some(syntax) = minify.get_boolean_loose(global, "identifiers")? {
                    self.minify_identifiers = syntax;
                }
            } else {
                return global.throw_invalid_arguments(
                    "Expected minify to be a boolean or an object",
                    format_args!(""),
                );
            }
        }

        if let Some(flag) = object.get(global, "sourcemap")? {
            if flag.is_boolean() || flag.is_undefined_or_null() {
                if flag.to_boolean() {
                    self.transform.source_map = api::SourceMapMode::Inline;
                } else {
                    self.transform.source_map = api::SourceMapMode::None;
                }
            } else {
                if let Some(source) = SourceMapOption::Map::from_js(global, flag)? {
                    self.transform.source_map = source.to_api();
                } else {
                    return global.throw_invalid_arguments(
                        "sourcemap must be one of \"inline\", \"linked\", \"external\", or \"none\"",
                        format_args!(""),
                    );
                }
            }
        }

        if let Some(packages) =
            object.get_optional_enum::<PackagesOption>(global, "packages")?
        {
            self.transform.packages = packages.to_api();
        }

        let mut tree_shaking: Option<bool> = None;
        if let Some(v) = object.get_boolean_loose(global, "treeShaking")? {
            tree_shaking = Some(v);
        }

        let mut trim_unused_imports: Option<bool> = None;
        if let Some(v) = object.get_boolean_loose(global, "trimUnusedImports")? {
            trim_unused_imports = Some(v);
        }

        if let Some(exports) = object.get_truthy(global, "exports")? {
            if !exports.is_object() {
                return global
                    .throw_invalid_arguments("exports must be an object", format_args!(""));
            }

            let mut replacements = Runtime::Features::ReplaceableExport::Map::default();
            // errdefer replacements.clearAndFree(allocator) → Drop on error path

            if let Some(eliminate) = exports.get_truthy(global, "eliminate")? {
                if !eliminate.js_type().is_array() {
                    return global.throw_invalid_arguments(
                        "exports.eliminate must be an array",
                        format_args!(""),
                    );
                }

                let mut total_name_buf_len: u32 = 0;
                let mut string_count: u32 = 0;
                let iter = JSArrayIterator::init(eliminate, global)?;
                {
                    let mut length_iter = iter;
                    while let Some(value) = length_iter.next()? {
                        if value.is_string() {
                            let length: u32 = value.get_length(global)? as u32; // @truncate
                            string_count += (length > 0) as u32;
                            total_name_buf_len += length;
                        }
                    }
                }

                if total_name_buf_len > 0 {
                    let mut buf: Vec<u8> = Vec::with_capacity(total_name_buf_len as usize);
                    // errdefer buf.deinit(allocator) → Drop
                    replacements.ensure_unused_capacity(string_count as usize)?;
                    {
                        let mut length_iter = iter;
                        while let Some(value) = length_iter.next()? {
                            if !value.is_string() {
                                continue;
                            }
                            let str = value.get_zig_string(global)?;
                            if str.len == 0 {
                                continue;
                            }
                            // TODO(port): bufPrint into spare capacity of `buf`. Zig wrote into
                            // `buf.items.ptr[buf.items.len..buf.capacity]` and bumped `items.len`.
                            // Here we approximate by writing into a temp and extending; the
                            // intent is a contiguous backing buffer with stable subslices.
                            let start = buf.len();
                            if write!(&mut buf, "{}", str).is_err() {
                                return global.throw_invalid_arguments(
                                    "Error reading exports.eliminate. TODO: utf-16",
                                    format_args!(""),
                                );
                            }
                            let name_len = buf.len() - start;
                            // PORT NOTE: reshaped for borrowck — borrow `buf` after writing.
                            // TODO(port): `replacements` keys borrow into `buf`; in Zig both live
                            // in the same arena. In Rust this needs `buf` to outlive
                            // `replacements` or keys to be `Box<[u8]>`.
                            let name_slice = &buf[start..start + name_len];
                            if name_len > 0 {
                                // PERF(port): was putAssumeCapacity — profile in Phase B
                                replacements.put_assume_capacity(
                                    name_slice,
                                    Runtime::Features::ReplaceableExport::Delete,
                                );
                            }
                        }
                    }
                    // TODO(port): `buf` must be kept alive alongside `replacements`.
                    core::mem::forget(buf);
                }
            }

            if let Some(replace) = exports.get_truthy(global, "replace")? {
                let Some(replace_obj) = replace.get_object() else {
                    return global
                        .throw_invalid_arguments("replace must be an object", format_args!(""));
                };

                let mut iter = JSPropertyIterator::init(
                    global,
                    replace_obj,
                    JSPropertyIteratorOptions {
                        skip_empty_name: true,
                        include_value: true,
                    },
                )?;
                // defer iter.deinit() → Drop

                if iter.len() > 0 {
                    replacements.ensure_unused_capacity(iter.len())?;

                    // We cannot set the exception before `?` because it could be
                    // a double free with the errdefer.
                    // TODO(port): the Zig `defer if (globalThis.hasException()) { free keys; clear }`
                    // is a conditional cleanup at scope exit. Model with scopeguard in Phase B
                    // (captures &mut replacements + &global; borrowck conflict with the loop
                    // below — needs restructuring). Keys are Box<[u8]> in Rust, so dropping
                    // `replacements` on `?` already frees them; only the explicit
                    // `clear_and_free` on the has_exception path is unported.

                    while let Some(key_) = iter.next()? {
                        let value = iter.value;
                        if value.is_empty() {
                            continue;
                        }

                        let key = key_.to_owned_slice()?;

                        if !JSLexer::is_identifier(&key) {
                            // allocator.free(key) → drop(key)
                            return global.throw_invalid_arguments(
                                "\"{}\" is not a valid ECMAScript identifier",
                                format_args!("{}", bstr::BStr::new(&key)),
                            );
                        }

                        // PERF(port): was getOrPutAssumeCapacity — profile in Phase B
                        let entry = replacements.get_or_put_assume_capacity(key);

                        if let Some(expr) = export_replacement_value(value, global)? {
                            *entry.value_ptr =
                                Runtime::Features::ReplaceableExport::Replace(expr);
                            continue;
                        }

                        if value.is_object() && value.get_length(global)? == 2 {
                            let replacement_value = value.get_index(global, 1)?;
                            if let Some(to_replace) =
                                export_replacement_value(replacement_value, global)?
                            {
                                let replacement_key = value.get_index(global, 0)?;
                                let slice =
                                    replacement_key.to_slice_clone_with_allocator(global)?;
                                // errdefer slice.deinit() → Drop
                                let replacement_name = slice.slice();

                                if !JSLexer::is_identifier(replacement_name) {
                                    return global.throw_invalid_arguments(
                                        "\"{}\" is not a valid ECMAScript identifier",
                                        format_args!("{}", bstr::BStr::new(replacement_name)),
                                    );
                                }

                                *entry.value_ptr =
                                    Runtime::Features::ReplaceableExport::Inject {
                                        name: replacement_name.into(),
                                        value: to_replace,
                                    };
                                continue;
                            }
                        }

                        return global.throw_invalid_arguments(
                            "exports.replace values can only be string, null, undefined, number or boolean",
                            format_args!(""),
                        );
                    }
                }
            }

            tree_shaking = Some(tree_shaking.unwrap_or(replacements.count() > 0));
            self.runtime.replace_exports = replacements;
        }

        if let Some(log_level) = object.get_truthy(global, "logLevel")? {
            if let Some(level) = logger::Log::Level::Map::from_js(global, log_level)? {
                self.log.level = level;
            } else {
                return global.throw_invalid_arguments(
                    "logLevel must be one of \"verbose\", \"debug\", \"info\", \"warn\", or \"error\"",
                    format_args!(""),
                );
            }
        }

        self.tree_shaking = tree_shaking.unwrap_or(false);
        self.trim_unused_imports = Some(trim_unused_imports.unwrap_or(self.tree_shaking));
        Ok(())
    }
}

// Legacy alias for backwards compatibility during migration

// Mimalloc gets unstable if we try to move this to a different thread
// threadlocal var transform_buffer: bun.MutableString = undefined;
// threadlocal var transform_buffer_loaded: bool = false;

// This is going to be hard to not leak
pub struct TransformTask<'a> {
    pub input_code: StringOrBuffer,
    pub output_code: BunString,
    pub transpiler: Transpiler::Transpiler,
    // TODO(port): LIFETIMES.tsv says Arc<JSTranspiler> — reconcile. JSTranspiler uses
    // single-thread intrusive `bun.ptr.RefCount` and crosses FFI as `m_ctx`, so per
    // PORTING.md §Pointers this must be IntrusiveRc, not Arc.
    pub js_instance: bun_ptr::IntrusiveRc<JSTranspiler>,
    pub log: logger::Log,
    pub err: Option<Error>,
    pub macro_map: MacroMap,
    pub tsconfig: Option<&'a TSConfigJSON>,
    pub loader: Loader,
    pub global: &'a JSGlobalObject,
    pub replace_exports: Runtime::Features::ReplaceableExport::Map,
}

pub type AsyncTransformTask<'a> = jsc::ConcurrentPromiseTask<TransformTask<'a>>;
pub type AsyncTransformEventLoopTask<'a> = <AsyncTransformTask<'a> as jsc::ConcurrentPromiseTaskTrait>::EventLoopTask;
// TODO(port): the `EventLoopTask` associated type path above is a guess.

impl<'a> TransformTask<'a> {
    // `pub const new = bun.TrivialNew(@This())` → Box::new

    pub fn create(
        transpiler: &'a mut JSTranspiler,
        input_code: StringOrBuffer,
        global: &'a JSGlobalObject,
        loader: Loader,
    ) -> Box<AsyncTransformTask<'a>> {
        let mut transform_task = Box::new(TransformTask {
            input_code,
            transpiler: transpiler.transpiler.clone(),
            global,
            macro_map: transpiler.config.macro_map.clone(),
            tsconfig: transpiler.config.tsconfig.as_deref(),
            log: logger::Log::init(),
            loader,
            replace_exports: transpiler.config.runtime.replace_exports.clone(),
            // SAFETY: `transpiler` is the `m_ctx` payload of the JSTranspiler JSCell wrapper,
            // kept alive by its embedded intrusive `ref_count: Cell<u32>`. `ref_raw` bumps that
            // count (mirroring Zig `transpiler.ref()`); the matching deref happens in
            // `Drop for TransformTask` / `IntrusiveRc::drop`.
            // TODO(port): LIFETIMES.tsv says Arc — reconcile (see field decl).
            js_instance: unsafe { bun_ptr::IntrusiveRc::ref_raw(transpiler) },
            err: None,
            output_code: BunString::empty(),
        });

        transform_task.log.level = transpiler.config.log.level;
        transform_task.transpiler = transpiler.transpiler.clone();
        // PORT NOTE: reshaped for borrowck — Zig set `linker.resolver = &transform_task.transpiler.resolver`
        // (self-referential). Leave as TODO; Transpiler::Transpiler likely re-links internally.
        // TODO(port): self-referential resolver pointer.
        transform_task
            .transpiler
            .linker_set_resolver_self_referential();

        transform_task.transpiler.set_log(&mut transform_task.log);
        // set_allocator(bun.default_allocator) → no-op; global mimalloc
        transform_task.transpiler.set_allocator_default();

        // transpiler.ref() — handled by IntrusiveRc::ref_raw above.
        AsyncTransformTask::create_on_js_thread(global, transform_task)
    }

    pub fn run(&mut self) {
        let name = self.loader.stdin_name();
        let source = logger::Source::init_path_string(name, self.input_code.slice());

        // PERF(port): was MimallocArena bulk-free — profile in Phase B.
        let arena = Arena::new();
        // defer arena.deinit() → Drop

        // TODO(port): ASTMemoryAllocator scope — typed_arena in AST crates; here we just
        // construct one and enter it. Model as RAII guard.
        let ast_memory_allocator = JSAst::ASTMemoryAllocator::new(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        self.transpiler.set_allocator(&arena);
        self.transpiler.set_log(&mut self.log);
        // self.log.msgs.allocator = bun.default_allocator → no-op

        let jsx = if let Some(ts) = self.tsconfig {
            ts.merge_jsx(self.transpiler.options.jsx)
        } else {
            self.transpiler.options.jsx
        };

        let parse_options = Transpiler::Transpiler::ParseOptions {
            allocator: &arena,
            macro_remappings: self.macro_map.clone(),
            dirname_fd: bun_sys::Fd::INVALID,
            file_descriptor: None,
            loader: self.loader,
            jsx,
            path: source.path.clone(),
            virtual_source: Some(&source),
            replace_exports: self.replace_exports.clone(),
            experimental_decorators: self.tsconfig.map_or(false, |ts| ts.experimental_decorators),
            emit_decorator_metadata: self.tsconfig.map_or(false, |ts| ts.emit_decorator_metadata),
            ..Default::default()
        };

        let Some(parse_result) = self.transpiler.parse(parse_options, None) else {
            self.err = Some(bun_core::err!("ParseError"));
            return;
        };

        if parse_result.empty {
            self.output_code = BunString::empty();
            return;
        }

        let mut buffer_writer = JSPrinter::BufferWriter::init();
        buffer_writer
            .buffer
            .list
            .reserve(512usize.saturating_sub(buffer_writer.buffer.list.len()));
        buffer_writer.reset();

        let mut printer = JSPrinter::BufferPrinter::init(buffer_writer);
        let printed = match self
            .transpiler
            .print(parse_result, &mut printer, Transpiler::PrintFormat::EsmAscii)
        {
            Ok(n) => n,
            Err(err) => {
                self.err = Some(err);
                return;
            }
        };

        if printed > 0 {
            buffer_writer = printer.ctx;
            // TODO(port): `buffer_writer.buffer.list.items = buffer_writer.written;` —
            // Zig truncates the Vec's view to `written`. Map to `.truncate(written.len())` or
            // a slice copy depending on BufferWriter shape.
            self.output_code = BunString::clone_utf8(buffer_writer.written());
        } else {
            self.output_code = BunString::empty();
        }
    }

    pub fn then(&mut self, promise: &mut JSPromise) -> Result<(), bun_jsc::JsTerminated> {
        // defer this.deinit() — handled by caller / Drop on Box<TransformTask>
        // TODO(port): Zig `defer this.deinit()` here destroys self at end of `then`. In Rust,
        // ConcurrentPromiseTask should own the Box and drop it after `then` returns.
        let _drop_guard = scopeguard::guard((), |_| {
            // self.deinit() — see Drop impl
        });

        if self.log.has_any() || self.err.is_some() {
            let error_value: JsResult<JSValue> = 'brk: {
                if let Some(err) = self.err {
                    if !self.log.has_any() {
                        break 'brk BuildMessage::create(
                            self.global,
                            logger::Msg {
                                data: logger::Data {
                                    text: err.name().as_bytes().into(),
                                    ..Default::default()
                                },
                                ..Default::default()
                            },
                        );
                    }
                }

                break 'brk self.log.to_js(self.global, "Transform failed");
            };

            promise.reject_with_async_stack(self.global, error_value)?;
            return Ok(());
        }

        self.finish(promise)
    }

    fn finish(&mut self, promise: &mut JSPromise) -> Result<(), bun_jsc::JsTerminated> {
        match self.output_code.transfer_to_js(self.global) {
            Ok(value) => promise.resolve(self.global, value),
            Err(e) => promise.reject(self.global, self.global.take_exception(e)),
        }
    }
}

impl<'a> Drop for TransformTask<'a> {
    fn drop(&mut self) {
        // log.deinit() → logger::Log: Drop
        self.input_code.deinit_and_unprotect();
        // output_code.deref() → BunString: Drop
        // tsconfig is owned by JSTranspiler, not by TransformTask.
        // Do not free it here — JSTranspiler::drop handles it.
        // js_instance.deref() → IntrusiveRc::drop
        // bun.destroy(this) → Box drop by owner
    }
}

fn export_replacement_value(
    value: JSValue,
    global: &JSGlobalObject,
) -> JsResult<Option<JSAst::Expr>> {
    if value.is_boolean() {
        return Ok(Some(Expr {
            data: JSAst::ExprData::EBoolean(JSAst::E::Boolean {
                value: value.to_boolean(),
            }),
            loc: logger::Loc::EMPTY,
        }));
    }

    if value.is_number() {
        return Ok(Some(Expr {
            data: JSAst::ExprData::ENumber(JSAst::E::Number {
                value: value.as_number(),
            }),
            loc: logger::Loc::EMPTY,
        }));
    }

    if value.is_null() {
        return Ok(Some(Expr {
            data: JSAst::ExprData::ENull(JSAst::E::Null {}),
            loc: logger::Loc::EMPTY,
        }));
    }

    if value.is_undefined() {
        return Ok(Some(Expr {
            data: JSAst::ExprData::EUndefined(JSAst::E::Undefined {}),
            loc: logger::Loc::EMPTY,
        }));
    }

    if value.is_string() {
        let mut data = Vec::new();
        write!(&mut data, "{}", value.get_zig_string(global)?)
            .map_err(|_| bun_jsc::JsError::OutOfMemory)?;
        let out = Box::new(JSAst::E::String { data: data.into() });
        return Ok(Some(Expr {
            data: JSAst::ExprData::EString(out),
            loc: logger::Loc::EMPTY,
        }));
    }

    Ok(None)
}

#[bun_jsc::host_fn]
pub fn constructor(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<*mut JSTranspiler> {
    let arguments = callframe.arguments_old(3);

    // PORT NOTE: reshaped — Zig allocates `this` first with `transpiler = undefined` and
    // assigns it later. Rust cannot leave a non-POD field uninitialized in a live Box
    // (zeroed()/assume_init() on Transpiler is UB), so build `config` + `transpiler` on the
    // stack first, then move both into the Box.
    // TODO(port): in-place init — if Phase B needs the Box allocated up-front (e.g. stable
    // address for resolver backrefs), switch the field to `MaybeUninit<Transpiler>`.
    let mut config = Config {
        log: logger::Log::init(),
        ..Default::default()
    };
    let arena = Arena::new();

    // errdefer { ... } — on any `?` below, stack `config`/`arena` drop and run Drop, which
    // covers config.log, config.tsconfig, arena. ref_count.clearWithoutDestructor is a
    // no-op when we never handed out refs. `bun.destroy(this)` → Box not yet created.

    let config_arg = if arguments.len() > 0 {
        arguments.ptr[0]
    } else {
        JSValue::UNDEFINED
    };
    // allocator = arena.allocator() → dropped (non-AST crate)
    config.from_js(global, config_arg)?;

    if global.has_exception() {
        return Err(bun_jsc::JsError::Thrown);
    }

    if (config.log.warnings + config.log.errors) > 0 {
        return global.throw_value(config.log.to_js(global, "Failed to create transpiler")?);
    }

    let transpiler = match Transpiler::Transpiler::init(
        &mut config.log,
        config.transform.clone(),
        VirtualMachine::get().transpiler.env.clone(),
    ) {
        Ok(t) => t,
        Err(err) => {
            let log = &mut config.log;
            if (log.warnings + log.errors) > 0 {
                return global.throw_value(log.to_js(global, "Failed to create transpiler")?);
            }
            return global.throw_error(err, "Error creating transpiler");
        }
    };

    let mut this: Box<JSTranspiler> = Box::new(JSTranspiler {
        config,
        arena,
        transpiler,
        scan_pass_result: ScanPassResult::init(),
        buffer_writer: None,
        log_level: logger::Log::Level::Err,
        ref_count: Cell::new(1),
    });
    // errdefer past this point → `this: Box<_>` drops and runs Drop for JSTranspiler.

    // PORT NOTE: reshaped for borrowck — split-borrow `config` and `transpiler` from the Box.
    let config = &this.config;
    let transpiler = &mut this.transpiler;
    transpiler.options.no_macros = config.no_macros;
    transpiler.configure_linker_with_auto_jsx(false);
    transpiler.options.env.behavior = options::EnvBehavior::Disable;
    if let Err(err) = transpiler.configure_defines() {
        let log = &mut this.config.log;
        if (log.warnings + log.errors) > 0 {
            return global.throw_value(log.to_js(global, "Failed to load define")?);
        }
        return global.throw_error(err, "Failed to load define");
    }

    if config.macro_map.count() > 0 {
        transpiler.options.macro_remap = config.macro_map.clone();
    }

    // REPL mode disables DCE to preserve expressions like `42`
    transpiler.options.dead_code_elimination =
        config.dead_code_elimination && !config.repl_mode;
    transpiler.options.minify_whitespace = config.minify_whitespace;

    // Keep defaults for these
    if config.minify_syntax {
        transpiler.options.minify_syntax = true;
    }

    if config.minify_identifiers {
        transpiler.options.minify_identifiers = true;
    }

    transpiler.options.transform_only = !transpiler.options.allow_runtime;

    transpiler.options.tree_shaking = config.tree_shaking;
    transpiler.options.trim_unused_imports = config.trim_unused_imports;
    transpiler.options.allow_runtime = config.runtime.allow_runtime;
    transpiler.options.auto_import_jsx = config.runtime.auto_import_jsx;
    transpiler.options.inlining = config.runtime.inlining;
    transpiler.options.hot_module_reloading = config.runtime.hot_module_reloading;
    transpiler.options.react_fast_refresh = false;
    transpiler.options.repl_mode = config.repl_mode;

    Ok(Box::into_raw(this))
}

impl JSTranspiler {
    pub fn finalize(this: *mut JSTranspiler) {
        // SAFETY: called by JSC codegen on the mutator thread with the m_ctx payload.
        unsafe { bun_ptr::IntrusiveRc::<JSTranspiler>::deref_raw(this) };
    }
}

impl Drop for JSTranspiler {
    fn drop(&mut self) {
        self.transpiler.log.clear_and_free();
        // scan_pass_result.{named_imports,import_records,used_symbols}.deinit() → field Drop
        // buffer_writer.?.buffer.deinit() → Option<BufferWriter>: Drop
        // config.tsconfig.deinit() → Option<Box<TSConfigJSON>>: Drop
        // arena.deinit() → Arena: Drop
        // bun.destroy(this) → handled by Box owner / IntrusiveRc.
    }
}

/// Check if code looks like an object literal that would be misinterpreted as a block
/// Returns true if code starts with { (after whitespace) and doesn't end with ;
/// This matches Node.js REPL behavior for object literal disambiguation
fn is_likely_object_literal(code: &[u8]) -> bool {
    // Skip leading whitespace
    let mut start: usize = 0;
    while start < code.len()
        && (code[start] == b' '
            || code[start] == b'\t'
            || code[start] == b'\n'
            || code[start] == b'\r')
    {
        start += 1;
    }

    // Check if starts with {
    if start >= code.len() || code[start] != b'{' {
        return false;
    }

    // Skip trailing whitespace
    let mut end: usize = code.len();
    while end > 0
        && (code[end - 1] == b' '
            || code[end - 1] == b'\t'
            || code[end - 1] == b'\n'
            || code[end - 1] == b'\r')
    {
        end -= 1;
    }

    // Check if ends with semicolon - if so, it's likely a block statement
    if end > 0 && code[end - 1] == b';' {
        return false;
    }

    true
}

impl JSTranspiler {
    fn get_parse_result(
        &mut self,
        arena: &Arena,
        code: &[u8],
        loader: Option<Loader>,
        macro_js_ctx: MacroJSCtx,
    ) -> Option<ParseResult> {
        let name = self.config.default_loader.stdin_name();

        // In REPL mode, wrap potential object literals in parentheses
        // If code starts with { and doesn't end with ; it might be an object literal
        // that would otherwise be parsed as a block statement
        let processed_code: std::borrow::Cow<'_, [u8]> =
            if self.config.repl_mode && is_likely_object_literal(code) {
                let mut buf = Vec::with_capacity(code.len() + 2);
                buf.push(b'(');
                buf.extend_from_slice(code);
                buf.push(b')');
                std::borrow::Cow::Owned(buf)
                // Zig: allocPrint(allocator, "({s})", .{code}) catch code
            } else {
                std::borrow::Cow::Borrowed(code)
            };

        let source = logger::Source::init_path_string(name, &processed_code);

        let jsx = if let Some(ts) = self.config.tsconfig.as_deref() {
            ts.merge_jsx(self.transpiler.options.jsx)
        } else {
            self.transpiler.options.jsx
        };

        let parse_options = Transpiler::Transpiler::ParseOptions {
            allocator: arena,
            macro_remappings: self.config.macro_map.clone(),
            dirname_fd: bun_sys::Fd::INVALID,
            file_descriptor: None,
            loader: loader.unwrap_or(self.config.default_loader),
            jsx,
            path: source.path.clone(),
            virtual_source: Some(&source),
            replace_exports: self.config.runtime.replace_exports.clone(),
            macro_js_ctx,
            experimental_decorators: self
                .config
                .tsconfig
                .as_deref()
                .map_or(false, |ts| ts.experimental_decorators),
            emit_decorator_metadata: self
                .config
                .tsconfig
                .as_deref()
                .map_or(false, |ts| ts.emit_decorator_metadata),
            ..Default::default()
        };

        self.transpiler.parse(parse_options, None)
    }

    #[bun_jsc::host_fn(method)]
    pub fn scan(&mut self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding(core::panic::Location::caller());
        let arguments = callframe.arguments_old(3);
        let mut args = jsc::CallFrame::ArgumentsSlice::init(global.bun_vm(), arguments.slice());
        // defer args.deinit() → Drop
        let Some(code_arg) = args.next() else {
            return global.throw_invalid_argument_type("scan", "code", "string or Uint8Array");
        };

        let Some(code_holder) = StringOrBuffer::from_js(global, args.arena_allocator(), code_arg)?
        else {
            return global.throw_invalid_argument_type("scan", "code", "string or Uint8Array");
        };
        // defer code_holder.deinit() → Drop
        let code = code_holder.slice();
        args.eat();

        let loader: Option<Loader> = 'brk: {
            if let Some(arg) = args.next() {
                args.eat();
                break 'brk Loader::from_js(global, arg)?;
            }
            break 'brk None;
        };

        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }

        // PERF(port): was MimallocArena bulk-free — profile in Phase B
        let arena = Arena::new();
        let prev_allocator = self.transpiler.allocator();
        self.transpiler.set_allocator(&arena);
        let mut log = logger::Log::init();
        // defer log.deinit() → Drop
        self.transpiler.set_log(&mut log);
        let _restore = scopeguard::guard((), |_| {
            self.transpiler.set_log(&mut self.config.log);
            self.transpiler.set_allocator_raw(prev_allocator);
            // arena dropped at scope exit
        });
        // TODO(port): errdefer — scopeguard captures &mut self; borrowck conflict with body.
        // Phase B: restructure restore into explicit tail calls.

        let ast_memory_allocator = JSAst::ASTMemoryAllocator::new(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        let Some(mut parse_result) =
            self.get_parse_result(&arena, code, loader, MacroJSCtx::ZERO)
        else {
            if (self.transpiler.log.warnings + self.transpiler.log.errors) > 0 {
                return global.throw_value(self.transpiler.log.to_js(global, "Parse error")?);
            }
            return global.throw("Failed to parse", format_args!(""));
        };

        if (self.transpiler.log.warnings + self.transpiler.log.errors) > 0 {
            return global.throw_value(self.transpiler.log.to_js(global, "Parse error")?);
        }

        let exports_label = ZigString::static_(b"exports");
        let imports_label = ZigString::static_(b"imports");
        let named_imports_value = named_imports_to_js(
            global,
            parse_result.ast.import_records.slice(),
            self.config.trim_unused_imports.unwrap_or(false),
        )?;

        let named_exports_value = named_exports_to_js(global, &mut parse_result.ast.named_exports)?;
        JSValue::create_object2(
            global,
            imports_label,
            exports_label,
            named_imports_value,
            named_exports_value,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn transform(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding(core::panic::Location::caller());
        let arguments = callframe.arguments_old(3);
        let mut args = jsc::CallFrame::ArgumentsSlice::init(global.bun_vm(), arguments.slice());
        // defer args.arena.deinit() → Drop
        let Some(code_arg) = args.next() else {
            return global.throw_invalid_argument_type("transform", "code", "string or Uint8Array");
        };

        let allow_string_object = true;
        let Some(code) = StringOrBuffer::from_js_with_encoding_maybe_async(
            global,
            code_arg,
            jsc::node::Encoding::Utf8,
            true,
            allow_string_object,
        )?
        else {
            return global.throw_invalid_argument_type("transform", "code", "string or Uint8Array");
        };
        // errdefer code.deinitAndUnprotect() — TransformTask takes ownership; on early error
        // before that, Drop on `code` runs deinit_and_unprotect.
        // TODO(port): ensure StringOrBuffer::drop calls deinit_and_unprotect.

        args.eat();
        let loader: Option<Loader> = 'brk: {
            if let Some(arg) = args.next() {
                args.eat();
                break 'brk Loader::from_js(global, arg)?;
            }
            break 'brk None;
        };

        let task = TransformTask::create(
            self,
            code,
            global,
            loader.unwrap_or(self.config.default_loader),
        );
        task.schedule();
        Ok(task.promise.value())
    }

    #[bun_jsc::host_fn(method)]
    pub fn transform_sync(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding(core::panic::Location::caller());
        let arguments = callframe.arguments_old(3);

        let mut args = jsc::CallFrame::ArgumentsSlice::init(global.bun_vm(), arguments.slice());
        // defer args.arena.deinit() → Drop
        let Some(code_arg) = args.next() else {
            return global.throw_invalid_argument_type(
                "transformSync",
                "code",
                "string or Uint8Array",
            );
        };

        // PERF(port): was MimallocArena bulk-free — profile in Phase B
        let arena = Arena::new();
        let Some(code_holder) = StringOrBuffer::from_js(global, &arena, code_arg)? else {
            return global.throw_invalid_argument_type(
                "transformSync",
                "code",
                "string or Uint8Array",
            );
        };
        // defer code_holder.deinit() → Drop
        let code = code_holder.slice();
        arguments.ptr[0].ensure_still_alive();
        let _keep0 = bun_jsc::EnsureStillAlive(arguments.ptr[0]);

        args.eat();
        let mut js_ctx_value: JSValue = JSValue::ZERO;
        let loader: Option<Loader> = 'brk: {
            if let Some(arg) = args.next() {
                args.eat();
                if arg.is_number() || arg.is_string() {
                    break 'brk Loader::from_js(global, arg)?;
                }

                if arg.is_object() {
                    js_ctx_value = arg;
                    break 'brk None;
                }
            }
            break 'brk None;
        };

        if let Some(arg) = args.next_eat() {
            if arg.is_object() {
                js_ctx_value = arg;
            } else {
                return global.throw_invalid_argument_type(
                    "transformSync",
                    "context",
                    "object or loader",
                );
            }
        }
        if !js_ctx_value.is_empty() {
            js_ctx_value.ensure_still_alive();
        }

        let _keep_ctx = if !js_ctx_value.is_empty() {
            Some(bun_jsc::EnsureStillAlive(js_ctx_value))
        } else {
            None
        };

        let ast_memory_allocator = JSAst::ASTMemoryAllocator::new(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        let prev_bundler = self.transpiler.clone();
        self.transpiler.set_allocator(&arena);
        self.transpiler.macro_context = None;
        let mut log = logger::Log::init();
        log.level = self.config.log.level;
        self.transpiler.set_log(&mut log);

        let _restore = scopeguard::guard((), |_| {
            self.transpiler = prev_bundler;
        });
        // TODO(port): errdefer — scopeguard captures &mut self; borrowck conflict with body.
        // Phase B: restructure restore into explicit assignment at every return.

        let Some(parse_result) = self.get_parse_result(&arena, code, loader, js_ctx_value) else {
            if (self.transpiler.log.warnings + self.transpiler.log.errors) > 0 {
                return global.throw_value(self.transpiler.log.to_js(global, "Parse error")?);
            }
            return global.throw("Failed to parse code", format_args!(""));
        };

        if (self.transpiler.log.warnings + self.transpiler.log.errors) > 0 {
            return global.throw_value(self.transpiler.log.to_js(global, "Parse error")?);
        }

        let mut buffer_writer = self.buffer_writer.take().unwrap_or_else(|| {
            let mut writer = JSPrinter::BufferWriter::init();
            writer.buffer.grow_if_needed(code.len()).expect("unreachable");
            writer.buffer.list.expand_to_capacity();
            writer
        });

        // defer { this.buffer_writer = buffer_writer } — handled below at every exit
        // TODO(port): restore buffer_writer to self on early returns too.

        buffer_writer.reset();
        let mut printer = JSPrinter::BufferPrinter::init(buffer_writer);
        if let Err(err) = self
            .transpiler
            .print(parse_result, &mut printer, Transpiler::PrintFormat::EsmAscii)
        {
            self.buffer_writer = Some(printer.ctx);
            return global.throw_error(err, "Failed to print code");
        }

        // TODO: benchmark if pooling this way is faster or moving is faster
        buffer_writer = printer.ctx;
        let mut out = ZigString::init(buffer_writer.written());
        out.set_output_encoding();

        let result = out.to_js(global);
        self.buffer_writer = Some(buffer_writer);
        Ok(result)
    }
}

fn named_exports_to_js(
    global: &JSGlobalObject,
    named_exports: &mut JSAst::Ast::NamedExports,
) -> JsResult<JSValue> {
    if named_exports.count() == 0 {
        return JSValue::create_empty_array(global, 0);
    }

    let mut named_exports_iter = named_exports.iterator();
    // PERF(port): was stack-fallback allocator — profile in Phase B
    let mut names: Vec<BunString> = Vec::with_capacity(named_exports.count());
    named_exports.sort(strings::StringArrayByIndexSorter {
        keys: named_exports.keys(),
    });
    // PORT NOTE: reshaped for borrowck — Zig sorts while holding the iterator; here we sort
    // first then iterate. TODO(port): verify iteration reflects sorted order.
    let mut i: usize = 0;
    while let Some(entry) = named_exports_iter.next() {
        names.push(BunString::from_bytes(entry.key_ptr));
        i += 1;
    }
    let _ = i;
    BunString::to_js_array(global, &names)
}

fn named_imports_to_js(
    global: &JSGlobalObject,
    import_records: &[ImportRecord],
    trim_unused_imports: bool,
) -> JsResult<JSValue> {
    let path_label = ZigString::static_(b"path");
    let kind_label = ZigString::static_(b"kind");

    let mut count: u32 = 0;
    for record in import_records {
        if record.flags.is_internal {
            continue;
        }
        if trim_unused_imports && record.flags.is_unused {
            continue;
        }
        count += 1;
    }

    let array = JSValue::create_empty_array(global, count)?;
    array.ensure_still_alive();

    let mut i: u32 = 0;
    for record in import_records {
        if record.flags.is_internal {
            continue;
        }
        if trim_unused_imports && record.flags.is_unused {
            continue;
        }

        array.ensure_still_alive();
        let path = ZigString::init(record.path.text.as_ref()).to_js(global);
        let kind = ZigString::init(record.kind.label()).to_js(global);
        array.put_index(
            global,
            i,
            JSValue::create_object2(global, path_label, kind_label, path, kind)?,
        )?;
        i += 1;
    }

    Ok(array)
}

impl JSTranspiler {
    #[bun_jsc::host_fn(method)]
    pub fn scan_imports(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2);
        let mut args = jsc::CallFrame::ArgumentsSlice::init(global.bun_vm(), arguments.slice());
        // defer args.deinit() → Drop

        let Some(code_arg) = args.next() else {
            return global.throw_invalid_argument_type(
                "scanImports",
                "code",
                "string or Uint8Array",
            );
        };

        let code_holder = match StringOrBuffer::from_js(global, args.arena_allocator(), code_arg)? {
            Some(h) => h,
            None => {
                if !global.has_exception() {
                    return global.throw_invalid_argument_type(
                        "scanImports",
                        "code",
                        "string or Uint8Array",
                    );
                }
                return Ok(JSValue::ZERO);
            }
        };
        args.eat();
        // defer code_holder.deinit() → Drop
        let code = code_holder.slice();

        let mut loader: Loader = self.config.default_loader;
        if let Some(arg) = args.next() {
            if let Some(l) = Loader::from_js(global, arg)? {
                loader = l;
            }
            args.eat();
        }

        if !loader.is_java_script_like() {
            return global.throw_invalid_arguments(
                "Only JavaScript-like files support this fast path",
                format_args!(""),
            );
        }

        // PERF(port): was MimallocArena bulk-free — profile in Phase B
        let arena = Arena::new();
        let prev_allocator = self.transpiler.allocator();
        let ast_memory_allocator = JSAst::ASTMemoryAllocator::new(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        self.transpiler.set_allocator(&arena);
        let mut log = logger::Log::init();
        // defer log.deinit() → Drop
        self.transpiler.set_log(&mut log);
        let _restore = scopeguard::guard((), |_| {
            self.transpiler.set_log(&mut self.config.log);
            self.transpiler.set_allocator_raw(prev_allocator);
            // arena dropped at scope exit
        });
        // TODO(port): errdefer — scopeguard captures &mut self; borrowck conflict with body.

        let source = logger::Source::init_path_string(loader.stdin_name(), code);
        let transpiler = &mut self.transpiler;
        let jsx = if let Some(ts) = self.config.tsconfig.as_deref() {
            ts.merge_jsx(transpiler.options.jsx)
        } else {
            transpiler.options.jsx
        };

        let mut opts = JSParser::Parser::Options::init(jsx, loader);
        if transpiler.macro_context.is_none() {
            transpiler.macro_context = Some(JSAst::Macro::MacroContext::init(transpiler));
        }
        opts.macro_context = transpiler.macro_context.as_mut();

        if let Err(err) = transpiler.resolver.caches.js.scan(
            transpiler.allocator(),
            &mut self.scan_pass_result,
            opts,
            transpiler.options.define.clone(),
            &mut log,
            &source,
        ) {
            self.scan_pass_result.reset();
            if (log.warnings + log.errors) > 0 {
                return global.throw_value(log.to_js(global, "Failed to scan imports")?);
            }
            return global.throw_error(err, "Failed to scan imports");
        }

        let _reset = scopeguard::guard((), |_| {
            self.scan_pass_result.reset();
        });
        // TODO(port): errdefer — scopeguard captures &mut self.scan_pass_result; borrowck.

        if (log.warnings + log.errors) > 0 {
            return global.throw_value(log.to_js(global, "Failed to scan imports")?);
        }

        let named_imports_value = named_imports_to_js(
            global,
            self.scan_pass_result.import_records.as_slice(),
            self.config.trim_unused_imports.unwrap_or(false),
        )?;
        Ok(named_imports_value)
    }
}

// TODO(port): placeholder used in Config::from_js for `.json` enum literal in
// `parse_json` call — replace with the real cache JSON-mode enum from bun_resolver.
#[allow(dead_code)]
enum JsonMode {
    Json,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/JSTranspiler.zig (1228 lines)
//   confidence: medium
//   todos:      25
//   notes:      LIFETIMES.tsv lists Arc<JSTranspiler> but ported as IntrusiveRc per §Pointers (reconcile); several `defer`/restore blocks need scopeguard borrowck reshaping; arena field retained in non-AST crate.
// ──────────────────────────────────────────────────────────────────────────
