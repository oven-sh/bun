//! `Bun.Transpiler` — single-file transform/scan over the JS parser.

use bun_alloc::ArenaVecExt as _;
use bun_options_types::TargetExt as _;
use std::io::Write as _;

use crate::Error;
use crate::node::{StringOrBuffer, ThreadIsolated};
use bun_alloc::{Arena, ArenaVec}; // bumpalo::Bump / bumpalo::collections::Vec re-exports
use bun_ast::Expr;
use bun_ast::Loader;
use bun_ast::{ImportRecord, ImportRecordFlags};
use bun_bundler::options::{self, PackagesOption, SourceMapOption};
use bun_bundler::transpiler::{
    JobTranspiler, MacroJSCtx, OwnedTranspiler, ParseOptions, ParseResult, TranspilerCall,
};
use bun_bundler::{self as Transpiler};
use bun_js_parser::lexer as JSLexer;
use bun_js_parser::parser::Runtime;
use bun_js_parser::parser::ScanPassResult;
use bun_js_parser::{self as JSAst};
use bun_js_printer as JSPrinter;
use bun_jsc::bun_string_jsc;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, ArgumentsSlice, CallFrame, ComptimeStringMapExt, JSArrayIterator, JSGlobalObject,
    JSPromise, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, JsCell, JsResult, LogJsc,
    StringJsc,
};
use bun_resolver::package_json::{MacroMap, PackageJSON};
use bun_resolver::tsconfig_json::TSConfigJSON;
// `bun_schema::api` → schema lives in `bun_options_types::schema::api`.
use bun_collections::ArrayHashMapExt;
use bun_core::{EncodedSlice, String as BunString};
use bun_options_types::schema::api;

// Host-fn re-entrancy: every JS-exposed method takes `&self`; per-field
// interior mutability via `JsCell` (= `UnsafeCell` projector). `JsCell` is
// `#[repr(transparent)]`, so field offsets are unchanged.
#[bun_jsc::JsClass(name = "Transpiler")]
#[derive(bun_ptr::RefCounted)]
pub struct JSTranspiler {
    /// Owns the arena the config strings and defines live in; aimed at
    /// `self.log` between host-fn calls.
    pub(crate) transpiler: JsCell<OwnedTranspiler>,
    /// Read-only after construction (its `log` has moved to `self.log`).
    pub(crate) config: Config,
    /// The resting-state log `transpiler` points at between host-fn calls
    /// (each call aims it at its own). Boxed: the transpiler is created before
    /// `Self` has an address.
    pub(crate) log: Box<JsCell<bun_ast::Log>>,
    pub(crate) scan_pass_result: JsCell<ScanPassResult>,
    pub(crate) buffer_writer: JsCell<Option<JSPrinter::BufferWriter>>,
    pub(crate) ref_count: bun_ptr::RefCount<JSTranspiler>,
}

fn default_transform_options() -> api::TransformOptions {
    api::TransformOptions {
        disable_hmr: true,
        target: Some(api::Target::Browser),
        ..Default::default()
    }
}

pub struct Config {
    pub(crate) transform: api::TransformOptions,
    pub(crate) default_loader: Loader,
    pub(crate) macro_map: MacroMap,
    pub(crate) tsconfig: Option<Box<TSConfigJSON>>,
    pub(crate) tsconfig_buf: Box<[u8]>,
    pub(crate) macros_buf: Box<[u8]>,
    pub(crate) log: bun_ast::Log,
    pub(crate) runtime: Runtime::Features,
    pub(crate) tree_shaking: bool,
    pub(crate) trim_unused_imports: Option<bool>,

    pub(crate) dead_code_elimination: bool,
    pub(crate) minify_whitespace: bool,
    pub(crate) minify_identifiers: bool,
    pub(crate) minify_syntax: bool,
    pub(crate) no_macros: bool,
    pub(crate) repl_mode: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            transform: default_transform_options(),
            default_loader: Loader::Jsx,
            macro_map: MacroMap::default(),
            tsconfig: None,
            tsconfig_buf: Box::default(),
            macros_buf: Box::default(),
            log: bun_ast::Log::default(), // overwritten at construction
            runtime: Runtime::Features {
                top_level_await: true,
                ..Default::default()
            },
            tree_shaking: false,
            trim_unused_imports: None,
            dead_code_elimination: true,
            minify_whitespace: false,
            minify_identifiers: false,
            minify_syntax: false,
            no_macros: false,
            repl_mode: false,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `from_js` enum lookups for `Loader`/`Target`. The canonical implementation
// lives in `bun_bundler_jsc::options_jsc` and
// carries the spec'd error semantics (throw `TypeError` on non-string / unknown
// loader). The earlier local shims here only did a bare `phf` lookup and
// silently returned `None` for unknown loaders, breaking
// `transpiler-utf16-loader.test.ts`.
// ──────────────────────────────────────────────────────────────────────────

use bun_bundler_jsc::options_jsc::{loader_from_js, target_from_js};
use bun_collections::index_sort;

fn source_map_option_from_js(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<SourceMapOption>> {
    options::SOURCE_MAP_OPTION_MAP.from_js(global, value)
}

fn level_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<bun_ast::Level>> {
    bun_ast::Level::MAP.from_js(global, value)
}

/// Deep-clone a [`MacroMap`]. The keys are `Box<[u8]>`, so an owned copy
/// is needed wherever the map is assigned by value.
fn clone_macro_map(src: &MacroMap) -> MacroMap {
    let mut out = MacroMap::default();
    bun_core::handle_oom(out.ensure_unused_capacity(src.count()));
    for (k, v) in src.keys().iter().zip(src.values().iter()) {
        // inner map: `StringArrayHashMap<&'static [u8]>` — `&[u8]: Clone` ⇒ inherent `clone()` works.
        let inner = v.clone().expect("OOM");
        out.put_assume_capacity(k, inner);
    }
    out
}

const PROP_ITER_OPTS: JSPropertyIteratorOptions = JSPropertyIteratorOptions {
    skip_empty_name: true,
    include_value: true,
    own_properties_only: true,
    observable: true,
    only_non_index_properties: false,
};

impl Config {
    // NOTE: out-param constructor kept as `&mut self` because `self` is a pre-initialized
    // field on `JSTranspiler` (in-place mutation), not a fresh value to return.
    pub fn from_js(
        &mut self,
        global: &JSGlobalObject,
        object: JSValue,
        arena: &Arena,
    ) -> JsResult<()> {
        if object.is_undefined_or_null() {
            return Ok(());
        }

        if !object.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Expected an object")));
        }

        if let Some(define) = object.get_truthy(global, "define")? {
            'define: {
                if define.is_undefined_or_null() {
                    break 'define;
                }

                let Some(define_obj) = define.get_object() else {
                    return Err(
                        global.throw_invalid_arguments(format_args!("define must be an object"))
                    );
                };

                let define_iter = JSPropertyIterator::init(global, define_obj, PROP_ITER_OPTS)?;
                // `defer define_iter.deinit()` → Drop

                // `define_iter.i` is the property position, not a dense index of yielded
                // entries. With `skip_empty_name = true` (or a skipped property getter),
                // writing at `define_iter.i` would leave earlier slots uninitialized.
                // Use Vecs so the stored slice is always exactly what was appended.
                let mut names: Vec<Box<[u8]>> = Vec::new();
                let mut values: Vec<Box<[u8]>> = Vec::new();
                names.reserve_exact(define_iter.len);
                values.reserve_exact(define_iter.len);

                while let Some((prop, property_value)) = define_iter.next()? {
                    let value_type = property_value.js_type();

                    if !value_type.is_string_like() {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "define \"{}\" must be a JSON string",
                            prop
                        )));
                    }

                    names.push(prop.to_owned_slice().into());
                    let val = property_value.to_js_string_view(global)?;
                    values.push(if val.is_empty() {
                        Box::from(&b"\"\""[..])
                    } else {
                        val.to_owned_slice().into_boxed_slice()
                    });
                }

                self.transform.define = Some(api::StringMap {
                    keys: names,
                    values,
                });
            }
        }

        if let Some(external) = object.get(global, "external")? {
            'external: {
                if external.is_undefined_or_null() {
                    break 'external;
                }

                let toplevel_type = external.js_type();
                if toplevel_type.is_string_like() {
                    let str = external.to_bun_string(global)?;
                    if str.is_empty() {
                        break 'external;
                    }
                    self.transform.external = vec![str.to_owned_slice().into_boxed_slice()];
                } else if toplevel_type.is_array() {
                    let count = external.get_length(global)?;
                    if count == 0 {
                        break 'external;
                    }

                    let mut externals: Vec<Box<[u8]>> = Vec::with_capacity(count as usize);
                    let mut iter = external.array_iterator(global)?;
                    while let Some(entry) = iter.next()? {
                        if !entry.js_type().is_string_like() {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "external must be a string or string[]",
                            )));
                        }

                        let str = entry.to_bun_string(global)?;
                        if str.is_empty() {
                            continue;
                        }
                        externals.push(str.to_owned_slice().into_boxed_slice());
                    }

                    self.transform.external = externals;
                } else {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "external must be a string or string[]",
                    )));
                }
            }
        }

        if let Some(loader) = object.get(global, "loader")? {
            if let Some(resolved) = loader_from_js(global, loader)? {
                if !resolved.is_java_script_like() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "only JavaScript-like loaders supported for now",
                    )));
                }

                self.default_loader = resolved;
            }
        }

        if let Some(target) = object.get(global, "target")? {
            if let Some(resolved) = target_from_js(global, target)? {
                self.transform.target = Some(resolved.to_api());
            }
        }

        if let Some(tsconfig) = object.get(global, "tsconfig")? {
            'tsconfig: {
                if tsconfig.is_undefined_or_null() {
                    break 'tsconfig;
                }
                let kind = tsconfig.js_type();

                if kind.is_array() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "tsconfig must be a string or object",
                    )));
                }

                let out = if !kind.is_string_like() {
                    // Use jsonStringifyFast for SIMD-optimized serialization
                    tsconfig.json_stringify_fast(global)?
                } else {
                    tsconfig.to_bun_string(global)?
                };

                if out.is_empty() {
                    break 'tsconfig;
                }
                self.tsconfig_buf = out.to_owned_slice().into();

                // TODO: JSC -> Ast conversion
                // SAFETY: VirtualMachine::get() returns the live singleton on the JS thread.
                let vm = VirtualMachine::get().as_mut();
                if let Ok(Some(parsed_tsconfig)) = TSConfigJSON::parse(
                    &mut self.log,
                    &bun_ast::Source::init_path_string(b"tsconfig.json", &self.tsconfig_buf[..]),
                    &mut vm.transpiler.resolver.caches.json,
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
                    return Err(
                        global.throw_invalid_arguments(format_args!("macro must be an object"))
                    );
                }

                // TODO: write a converter between JSC types and Bun AST types
                let out = if is_object {
                    // Use jsonStringifyFast for SIMD-optimized serialization
                    macros.json_stringify_fast(global)?
                } else {
                    macros.to_bun_string(global)?
                };

                if out.is_empty() {
                    break 'macros;
                }
                self.macros_buf = out.to_owned_slice().into();
                let source =
                    bun_ast::Source::init_path_string(b"macros.json", &self.macros_buf[..]);
                // SAFETY: VirtualMachine::get() returns the live singleton on the JS thread.
                let vm = VirtualMachine::get().as_mut();
                let Ok(Some(json)) = vm.transpiler.resolver.caches.json.parse_json(
                    &mut self.log,
                    &source,
                    bun_resolver::tsconfig_json::JsonMode::Json,
                ) else {
                    break 'macros;
                };
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
                return Err(global.throw_invalid_arguments(format_args!(
                    "Expected minify to be a boolean or an object",
                )));
            }
        }

        if let Some(flag) = object.get(global, "sourcemap")? {
            if flag.is_boolean() || flag.is_undefined_or_null() {
                if flag.to_boolean() {
                    self.transform.source_map = Some(api::SourceMapMode::Inline);
                } else {
                    self.transform.source_map = Some(api::SourceMapMode::None);
                }
            } else {
                if let Some(source) = source_map_option_from_js(global, flag)? {
                    self.transform.source_map = Some(SourceMapOption::to_api(Some(source)));
                } else {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "sourcemap must be one of \"inline\", \"linked\", \"external\", or \"none\"",
                    )));
                }
            }
        }

        if let Some(packages) = object.get_optional_enum_from_map(
            global,
            "packages",
            &options::PACKAGES_OPTION_MAP,
            "\"bundle\" or \"external\"",
        )? {
            self.transform.packages = Some(PackagesOption::to_api(Some(packages)));
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
                return Err(
                    global.throw_invalid_arguments(format_args!("exports must be an object"))
                );
            }

            let mut replacements = bun_ast::runtime::ReplaceableExportMap::default();
            // errdefer replacements.clearAndFree(allocator) → Drop on error path

            if let Some(eliminate) = exports.get_truthy(global, "eliminate")? {
                if !eliminate.js_type().is_array() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "exports.eliminate must be an array",
                    )));
                }

                let mut total_name_buf_len: u32 = 0;
                let mut string_count: u32 = 0;
                {
                    let mut length_iter = JSArrayIterator::init(eliminate, global)?;
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
                    bun_core::handle_oom(
                        replacements.ensure_unused_capacity(string_count as usize),
                    );
                    {
                        let mut length_iter = JSArrayIterator::init(eliminate, global)?;
                        while let Some(value) = length_iter.next()? {
                            if !value.is_string() {
                                continue;
                            }
                            let str = value.to_js_string_view(global)?;
                            if str.is_empty() {
                                continue;
                            }
                            // The capacity bound is sized from UTF-16 code-unit
                            // lengths and overflowing it must throw. `write!` on a
                            // `Vec` would silently grow instead, so check the
                            // bound explicitly to preserve the overflow throw.
                            let start = buf.len();
                            let _ = write!(&mut buf, "{}", str);
                            if buf.len() > total_name_buf_len as usize {
                                return Err(global.throw_invalid_arguments(format_args!(
                                    "Error reading exports.eliminate. TODO: utf-16",
                                )));
                            }
                            let name_len = buf.len() - start;
                            // `replacements.put_assume_capacity` boxes the key on insert
                            // (`Box::from(key)`), so the map owns its bytes and `buf`
                            // can drop normally at end of scope.
                            let name_slice = &buf[start..start + name_len];
                            if name_len > 0 {
                                replacements.put_assume_capacity(
                                    name_slice,
                                    bun_ast::runtime::ReplaceableExport::Delete,
                                );
                            }
                        }
                    }
                }
            }

            if let Some(replace) = exports.get_truthy(global, "replace")? {
                let Some(replace_obj) = replace.get_object() else {
                    return Err(
                        global.throw_invalid_arguments(format_args!("replace must be an object"))
                    );
                };

                let iter = JSPropertyIterator::init(global, replace_obj, PROP_ITER_OPTS)?;

                if iter.len > 0 {
                    bun_core::handle_oom(replacements.ensure_unused_capacity(iter.len));

                    // Exception cleanup is covered by RAII: a pending exception
                    // always surfaces as `Err(JsError::Thrown)` through `?`, and
                    // `replacements` is a local (moved into
                    // `self.runtime.replace_exports` only on success), so the
                    // early return drops it — freeing the `Box<[u8]>` keys and
                    // clearing the map.

                    while let Some((key_, value)) = iter.next()? {
                        if value.is_empty() {
                            continue;
                        }

                        let key: Vec<u8> = key_.to_owned_slice();

                        if !JSLexer::is_identifier(&key) {
                            // allocator.free(key) → drop(key)
                            return Err(global.throw_invalid_arguments(format_args!(
                                "\"{}\" is not a valid ECMAScript identifier",
                                bstr::BStr::new(&key)
                            )));
                        }

                        // NOTE: `StringArrayHashMap::get_or_put` is gated on
                        // `V: Default` upstream and `ReplaceableExport` has no Default. Compute
                        // the value first, then `put` (which upserts without needing a default
                        // slot).
                        if let Some(expr) = export_replacement_value(value, global, arena)? {
                            replacements
                                .put(&key, bun_ast::runtime::ReplaceableExport::Replace(expr))
                                .map_err(|_| bun_jsc::JsError::OutOfMemory)?;
                            continue;
                        }

                        if value.is_object() && value.get_length(global)? == 2 {
                            let replacement_value = value.get_index(global, 1)?;
                            if let Some(to_replace) =
                                export_replacement_value(replacement_value, global, arena)?
                            {
                                let replacement_key = value.get_index(global, 0)?;
                                let slice = replacement_key.to_bun_string(global)?;
                                let replacement_name = slice.to_owned_slice();

                                if !JSLexer::is_identifier(&replacement_name) {
                                    return Err(global.throw_invalid_arguments(format_args!(
                                        "\"{}\" is not a valid ECMAScript identifier",
                                        bstr::BStr::new(&replacement_name)
                                    )));
                                }

                                replacements
                                    .put(
                                        &key,
                                        bun_ast::runtime::ReplaceableExport::Inject {
                                            name: replacement_name.into(),
                                            value: to_replace,
                                        },
                                    )
                                    .map_err(|_| bun_jsc::JsError::OutOfMemory)?;
                                continue;
                            }
                        }

                        return Err(global.throw_invalid_arguments(format_args!(
                            "exports.replace values can only be string, null, undefined, number or boolean",
                        )));
                    }
                }
            }

            tree_shaking = Some(tree_shaking.unwrap_or_else(|| replacements.count() > 0));
            self.runtime.replace_exports = replacements;
        }

        if let Some(log_level) = object.get_truthy(global, "logLevel")? {
            if let Some(level) = level_from_js(global, log_level)? {
                self.log.level = level;
            } else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "logLevel must be one of \"verbose\", \"debug\", \"info\", \"warn\", or \"error\"",
                )));
            }
        }

        self.tree_shaking = tree_shaking.unwrap_or(false);
        self.trim_unused_imports = Some(trim_unused_imports.unwrap_or(self.tree_shaking));
        Ok(())
    }
}

// Mimalloc gets unstable if we try to move this to a different thread
// threadlocal var transform_buffer: bun.MutableString = undefined;
// threadlocal var transform_buffer_loaded: bool = false;

// This is going to be hard to not leak
/// `transpiler.transform()` off the JS thread: a [`JobTranspiler`] copy of the
/// owning `JSTranspiler`'s transpiler (which keeps what it aliases alive), and
/// owned snapshots of the rest of its config.
pub(crate) struct TransformTask {
    pub input_code: ThreadIsolated<StringOrBuffer<'static>>,
    pub output_code: BunString,
    pub transpiler: JobTranspiler,
    pub log: bun_ast::Log,
    pub err: Option<Error>,
    pub macro_map: MacroMap,
    pub tsconfig: TransformTsconfig,
    pub loader: Loader,
    pub replace_exports: bun_ast::runtime::ReplaceableExportMap,
}

/// What a transform reads of the `JSTranspiler`'s tsconfig.
pub(crate) struct TransformTsconfig {
    jsx: options::jsx::Pragma,
    experimental_decorators: bool,
    emit_decorator_metadata: bool,
    use_define_for_class_fields: bool,
}

#[derive(bun_jsc::JsAffine)]
pub(crate) struct TransformJs {
    promise: jsc::JSPromiseStrong,
    /// The `JSTranspiler` wrapper, so a transform in flight keeps it alive.
    _transpiler: jsc::Strong,
}

impl jsc::JobContext for TransformTask {
    type OffThread = Self;
    type Js = TransformJs;
    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        TransformTask::run(this, done.ticket());
        Some(done)
    }
    fn then(mut this: Self, mut js: TransformJs, cx: &jsc::JsThread<'_>) -> JsResult<()> {
        TransformTask::then(&mut this, js.promise.swap(), cx.global())
    }
}

impl TransformTsconfig {
    fn new(tsconfig: Option<&TSConfigJSON>, jsx: &options::jsx::Pragma) -> Self {
        Self {
            jsx: match tsconfig {
                Some(ts) => ts.merge_jsx(jsx.clone()),
                None => jsx.clone(),
            },
            experimental_decorators: tsconfig.is_some_and(|ts| ts.experimental_decorators),
            emit_decorator_metadata: tsconfig.is_some_and(|ts| ts.emit_decorator_metadata),
            use_define_for_class_fields: tsconfig
                .and_then(|ts| ts.use_define_for_class_fields)
                .unwrap_or(true),
        }
    }
}

impl TransformTask {
    // `pub const new = bun.TrivialNew(@This())` → Box::new

    /// Schedule the transform on the work pool; returns its promise.
    fn schedule(
        transpiler: &JSTranspiler,
        transpiler_js: JSValue,
        input_code: ThreadIsolated<StringOrBuffer<'static>>,
        global: &JSGlobalObject,
        loader: Loader,
    ) -> JSValue {
        let config = &transpiler.config;
        let mut log = bun_ast::Log::init();
        log.level = transpiler.log.get().level;

        let owned = transpiler.transpiler.get();
        let tsconfig = TransformTsconfig::new(config.tsconfig.as_deref(), &owned.get().options.jsx);
        let transpiler_copy = owned.new_job();

        let task = TransformTask {
            input_code,
            output_code: BunString::EMPTY,
            transpiler: transpiler_copy,
            macro_map: clone_macro_map(&config.macro_map),
            tsconfig,
            log,
            err: None,
            loader,
            replace_exports: bun_ast::runtime::ReplaceableExportMap {
                entries: config.runtime.replace_exports.entries.clone().expect("OOM"),
            },
        };
        let cx = global.js_thread();
        let promise = jsc::JSPromiseStrong::init(global);
        let value = promise.value();
        jsc::Job::<TransformTask>::schedule(
            &cx,
            task,
            TransformJs {
                promise,
                _transpiler: jsc::Strong::create(transpiler_js, global),
            },
        );
        value
    }

    fn run(&mut self, _: &jsc::Ticket) {
        let name = self.loader.stdin_name();
        let arena = Arena::new();
        self.run_in(&arena, name);
        // The macro context a parse lazily creates tears down through this
        // thread's per-thread state, so release it here rather than wherever
        // the job is dropped.
        self.transpiler.release_macro_context();
    }

    fn run_in<'a>(&'a mut self, arena: &'a Arena, name: &'static str) {
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(arena);
        let _ast_scope = ast_memory_allocator.enter();

        let source: &bun_ast::Source = arena.alloc(bun_ast::Source::init_path_string(
            name,
            self.input_code.slice(),
        ));
        let mut transpiler = self.transpiler.for_call(arena, &mut self.log);
        // self.log.msgs.allocator = bun.default_allocator → no-op

        let parse_options = ParseOptions {
            arena,
            macro_remappings: clone_macro_map(&self.macro_map),
            dirname_fd: bun_sys::Fd::INVALID,
            file_descriptor: None,
            loader: self.loader,
            jsx: self.tsconfig.jsx.clone(),
            path: source.path,
            virtual_source: Some(source),
            replace_exports: self.replace_exports.entries.clone().expect("OOM"),
            experimental_decorators: self.tsconfig.experimental_decorators,
            emit_decorator_metadata: self.tsconfig.emit_decorator_metadata,
            use_define_for_class_fields: self.tsconfig.use_define_for_class_fields,
            macro_js_ctx: MacroJSCtx::ZERO,
            file_fd_ptr: None,
            inject_jest_globals: false,
            set_breakpoint_on_first_line: false,
            remove_cjs_module_wrapper: false,
            dont_bundle_twice: false,
            allow_commonjs: false,
            module_type: Default::default(),
            runtime_transpiler_cache: None,
            keep_json_and_toml_as_one_statement: false,
            allow_bytecode_cache: false,
        };

        let Some(parse_result) = transpiler.parse(parse_options, None) else {
            self.err = Some(crate::Error::ParseError);
            return;
        };

        if parse_result.empty {
            self.output_code = BunString::EMPTY;
            return;
        }

        let mut buffer_writer = JSPrinter::BufferWriter::init();
        buffer_writer
            .buffer
            .list
            .reserve(512usize.saturating_sub(buffer_writer.buffer.list.len()));
        buffer_writer.reset();

        let mut printer = JSPrinter::BufferPrinter::init(buffer_writer);
        // Same per-call `arena` that `for_call` and `parse()` used.
        let printed = match transpiler.print(
            arena,
            parse_result,
            &mut printer,
            Transpiler::transpiler::PrintFormat::EsmAscii,
        ) {
            Ok(n) => n,
            Err(err) => {
                self.err = Some(err.into());
                return;
            }
        };

        if printed > 0 {
            buffer_writer = printer.ctx;
            // `written()` reslices via `written_len`; copy out the printed
            // bytes, then the local writer is dropped.
            self.output_code = BunString::clone_utf8(buffer_writer.written());
        } else {
            self.output_code = BunString::EMPTY;
        }
    }

    fn then(&mut self, promise: &mut JSPromise, global: &JSGlobalObject) -> JsResult<()> {
        // The job drops this `TransformTask` (running its `Drop`: transpiler
        // deref etc.) right after `then` returns.
        if self.log.has_any() || self.err.is_some() {
            let error_value: JsResult<JSValue> = 'brk: {
                if let Some(err) = &self.err {
                    if !self.log.has_any() {
                        break 'brk bun_jsc::BuildMessage::create(
                            global,
                            bun_ast::Msg {
                                data: bun_ast::Data {
                                    text: err.name().as_bytes().to_vec().into(),
                                    ..Default::default()
                                },
                                ..Default::default()
                            },
                        );
                    }
                }

                break 'brk self.log.to_js(global, format_args!("Transform failed"));
            };

            promise.reject_with_async_stack(global, error_value)?;
            return Ok(());
        }

        self.finish(promise, global)
    }

    fn finish(&mut self, promise: &mut JSPromise, global: &JSGlobalObject) -> JsResult<()> {
        promise.settle(
            global,
            core::mem::take(&mut self.output_code).into_js(global),
        )
    }
}

fn export_replacement_value(
    value: JSValue,
    global: &JSGlobalObject,
    arena: &Arena,
) -> JsResult<Option<bun_ast::Expr>> {
    if value.is_boolean() {
        return Ok(Some(Expr {
            data: bun_ast::ExprData::EBoolean(bun_ast::E::Boolean {
                value: value.to_boolean(),
            }),
            loc: bun_ast::Loc::EMPTY,
        }));
    }

    if value.is_number() {
        return Ok(Some(Expr {
            data: bun_ast::ExprData::ENumber(bun_ast::E::Number::new(value.as_number())),
            loc: bun_ast::Loc::EMPTY,
        }));
    }

    if value.is_null() {
        return Ok(Some(Expr {
            data: bun_ast::ExprData::ENull(bun_ast::E::Null {}),
            loc: bun_ast::Loc::EMPTY,
        }));
    }

    if value.is_undefined() {
        return Ok(Some(Expr {
            data: bun_ast::ExprData::EUndefined(bun_ast::E::Undefined {}),
            loc: bun_ast::Loc::EMPTY,
        }));
    }

    if value.is_string() {
        let str = value.to_js_string_view(global)?;
        let utf8 = str.to_utf8();
        // Bump-allocate so the bytes
        // live as long as the JSTranspiler arena that owns the resulting Expr;
        // `E::EString::init` erases the borrow to `'static` per the AST
        // crate's `Str` convention (see ast/E.rs).
        let data = arena.alloc_slice_copy(utf8.slice());
        return Ok(Some(Expr::init(
            bun_ast::E::EString::init(data),
            bun_ast::Loc::EMPTY,
        )));
    }

    Ok(None)
}

impl JSTranspiler {
    // JsClass construct hook — invoked via the codegen'd `${T}Class__construct`
    // shim emitted by `#[bun_jsc::JsClass]`, NOT via `#[host_fn]` (constructors
    // return `*mut Self`, not `JSValue`, so the free-fn shim would be ill-typed).
    pub(crate) fn constructor(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<*mut JSTranspiler> {
        let [config_arg] = callframe.arguments_as_array::<1>();

        // `config` and the transpiler are built before the `Box<JSTranspiler>`
        // exists; the address-sensitive parts (the arena the transpiler borrows,
        // the resting log it points at) are separately heap-allocated so the
        // move into the box leaves them in place.
        let mut config = Config {
            log: bun_ast::Log::init(),
            ..Default::default()
        };
        let arena = Box::new(Arena::new());

        // errdefer { ... } — on any `?` below, stack `config`/`arena` drop and run Drop, which
        // covers config.log, config.tsconfig, arena. ref_count.clearWithoutDestructor is a
        // no-op when we never handed out refs. `bun.destroy(this)` → Box not yet created.

        config.from_js(global, config_arg, &arena)?;

        if (config.log.warnings + config.log.errors) > 0 {
            return Err(global.throw_value(
                config
                    .log
                    .to_js(global, format_args!("Failed to create transpiler"))?,
            ));
        }

        // The construction log becomes the resting log.
        let log = Box::new(JsCell::new(core::mem::replace(
            &mut config.log,
            bun_ast::Log::init(),
        )));
        let log_has_any = |log: &JsCell<bun_ast::Log>| {
            let log = log.get();
            (log.warnings + log.errors) > 0
        };

        let vm = global.bun_vm();
        let mut transpiler = match OwnedTranspiler::new(arena, log.as_ptr(), |arena, log_ptr| {
            Transpiler::Transpiler::init(
                arena,
                log_ptr,
                config.transform.clone(),
                Some(vm.transpiler.env),
            )
        }) {
            Ok(t) => t,
            Err(err) => {
                if log_has_any(&log) {
                    return Err(global.throw_value(log.with_mut(|log| {
                        log.to_js(global, format_args!("Failed to create transpiler"))
                    })?));
                }
                return Err(global.throw_error(err, "Error creating transpiler"));
            }
        };

        // The transpiler is at its final address (inside `OwnedTranspiler`), so
        // the self-referential linker wiring can happen now.
        let configured = transpiler.with_mut(|transpiler| -> Result<(), bun_bundler::Error> {
            transpiler.options.no_macros = config.no_macros;
            transpiler.configure_linker_with_auto_jsx(false);
            transpiler.options.env.behavior = options::EnvBehavior::disable;
            transpiler.configure_defines()?;

            if config.macro_map.count() > 0 {
                transpiler.options.macro_remap = clone_macro_map(&config.macro_map);
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
            Ok(())
        });
        if let Err(err) = configured {
            if log_has_any(&log) {
                return Err(global.throw_value(
                    log.with_mut(|log| log.to_js(global, format_args!("Failed to load define")))?,
                ));
            }
            return Err(global.throw_error(err, "Failed to load define"));
        }

        let this: Box<JSTranspiler> = Box::new(JSTranspiler {
            transpiler: JsCell::new(transpiler),
            config,
            log,
            scan_pass_result: JsCell::new(ScanPassResult::init()),
            buffer_writer: JsCell::new(None),
            ref_count: bun_ptr::RefCount::init(),
        });
        Ok(bun_core::heap::into_raw(this))
    }
}

impl Drop for JSTranspiler {
    fn drop(&mut self) {
        // `scan()` / `scanImports()` lazily create a `MacroContext` on
        // `self.transpiler` and (unlike `transformSync`) leave it in place
        // for reuse across calls. The boxed `bun_js_parser_jsc::MacroContext`
        // behind `.data` has no `Drop` glue — release it explicitly.
        // `with_mut` borrow is closure-scoped; no JS re-entry inside.
        self.transpiler.with_mut(|t| t.release_macro_context());
        self.log.with_mut(|log| log.clear_and_free());
        // scan_pass_result.{named_imports,import_records,used_symbols}.deinit() → field Drop
        // buffer_writer.?.buffer.deinit() → Option<BufferWriter>: Drop
        // config.tsconfig.deinit() → Option<Box<TSConfigJSON>>: Drop
        // transpiler (and the arena it owns) → OwnedTranspiler: Drop
    }
}

/// `transformSync` snapshots the transpiler's macro context and restores it on
/// every exit, freeing the one the call created (the box behind its `data`
/// pointer is heap-owned and `MacroContext` has no `Drop`, so overwriting it
/// would strand the box). `scan` / `scanImports` leave theirs in place.
struct MacroContextRestore<'r, 't, 'a> {
    transpiler: &'r mut TranspilerCall<'t, 'a>,
    prev: Option<Option<JSAst::Macro::MacroContext>>,
}

impl Drop for MacroContextRestore<'_, '_, '_> {
    fn drop(&mut self) {
        if let Some(prev) = self.prev.take() {
            let slot = self.transpiler.macro_context();
            if let Some(new_ctx) = slot.take() {
                new_ctx.deinit();
            }
            *slot = prev;
        }
    }
}

impl JSTranspiler {
    fn get_parse_result<'a>(
        &self,
        transpiler: &mut TranspilerCall<'_, 'a>,
        arena: &'a Arena,
        code: &[u8],
        loader: Option<Loader>,
        macro_js_ctx: MacroJSCtx,
    ) -> Option<ParseResult<'a>> {
        let config = &self.config;
        let name = config.default_loader.stdin_name();

        // In REPL mode, wrap potential object literals in parentheses
        // If code starts with { and doesn't end with ; it might be an object literal
        // that would otherwise be parsed as a block statement
        //
        // Allocated in the
        // CALLER's arena so the bytes outlive `parse()` and the returned `ParseResult`
        // (whose AST may hold slices into the source). A stack-local `Vec` would drop at
        // the end of this fn and leave dangling references.
        let processed_code: &[u8] = if config.repl_mode && is_likely_object_literal(code) {
            let mut buf = ArenaVec::<u8>::with_capacity_in(code.len() + 2, arena);
            buf.push(b'(');
            buf.extend_from_slice(code);
            buf.push(b')');
            buf.into_bump_slice()
        } else {
            code
        };

        let source: &bun_ast::Source =
            arena.alloc(bun_ast::Source::init_path_string(name, processed_code));

        let jsx = match config.tsconfig.as_deref() {
            Some(ts) => ts.merge_jsx(transpiler.options().jsx.clone()),
            None => transpiler.options().jsx.clone(),
        };

        let parse_options = ParseOptions {
            arena,
            macro_remappings: clone_macro_map(&config.macro_map),
            dirname_fd: bun_sys::Fd::INVALID,
            file_descriptor: None,
            loader: loader.unwrap_or(config.default_loader),
            jsx,
            path: source.path,
            virtual_source: Some(source),
            replace_exports: config.runtime.replace_exports.entries.clone().expect("OOM"),
            macro_js_ctx,
            experimental_decorators: config
                .tsconfig
                .as_deref()
                .is_some_and(|ts| ts.experimental_decorators),
            emit_decorator_metadata: config
                .tsconfig
                .as_deref()
                .is_some_and(|ts| ts.emit_decorator_metadata),
            use_define_for_class_fields: config
                .tsconfig
                .as_deref()
                .and_then(|ts| ts.use_define_for_class_fields)
                .unwrap_or(true),
            file_fd_ptr: None,
            inject_jest_globals: false,
            set_breakpoint_on_first_line: false,
            remove_cjs_module_wrapper: false,
            dont_bundle_twice: false,
            allow_commonjs: false,
            module_type: Default::default(),
            runtime_transpiler_cache: None,
            keep_json_and_toml_as_one_statement: false,
            allow_bytecode_cache: false,
        };

        transpiler.parse(parse_options, None)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn scan(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding();
        // SAFETY: bun_vm() returns the live VM singleton on this thread.
        let vm = global.bun_vm();
        let mut args = ArgumentsSlice::init(vm, callframe.arguments());
        let Some(code_arg) = args.next() else {
            return Err(global.throw_invalid_argument_type("scan", "code", "string or Uint8Array"));
        };

        let Some(code_holder) = StringOrBuffer::from_js(global, code_arg)? else {
            return Err(global.throw_invalid_argument_type("scan", "code", "string or Uint8Array"));
        };
        let code = code_holder.slice();
        args.eat();

        let loader: Option<Loader> = 'brk: {
            if let Some(arg) = args.next() {
                args.eat();
                break 'brk loader_from_js(global, arg)?;
            }
            break 'brk None;
        };

        let arena = Arena::new();
        let mut log = bun_ast::Log::init();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        self.transpiler.with_mut(|t| {
            t.with_call(&arena, &mut log, |transpiler| {
                let parse_result =
                    self.get_parse_result(transpiler, &arena, code, loader, MacroJSCtx::ZERO);
                let log_ref = transpiler.log_mut();
                let Some(mut parse_result) = parse_result else {
                    if (log_ref.warnings + log_ref.errors) > 0 {
                        return Err(
                            global.throw_value(log_ref.to_js(global, format_args!("Parse error"))?)
                        );
                    }
                    return Err(global.throw(format_args!("Failed to parse")));
                };

                if (log_ref.warnings + log_ref.errors) > 0 {
                    return Err(
                        global.throw_value(log_ref.to_js(global, format_args!("Parse error"))?)
                    );
                }

                let exports_label = EncodedSlice::latin1(b"exports");
                let imports_label = EncodedSlice::latin1(b"imports");
                let named_imports_value = named_imports_to_js(
                    global,
                    parse_result.ast.import_records.as_slice(),
                    self.config.trim_unused_imports.unwrap_or(false),
                )?;

                let named_exports_value =
                    named_exports_to_js(global, &mut parse_result.ast.named_exports)?;

                JSValue::create_object2(
                    global,
                    &imports_label,
                    &exports_label,
                    named_imports_value,
                    named_exports_value,
                )
            })
        })
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn transform(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding();
        // SAFETY: bun_vm() returns the live VM singleton on this thread.
        let vm = global.bun_vm();
        let mut args = ArgumentsSlice::init(vm, callframe.arguments());
        let Some(code_arg) = args.next() else {
            return Err(global.throw_invalid_argument_type(
                "transform",
                "code",
                "string or Uint8Array",
            ));
        };

        let code = if let Some(buffer) = code_arg.as_array_buffer(global) {
            let bytes = buffer.byte_slice().to_vec();
            global.vm().report_extra_memory(bytes.len());
            StringOrBuffer::owned_isolated(bytes)
        } else if let Some(code) = StringOrBuffer::from_js_async(global, code_arg)? {
            code
        } else {
            return Err(global.throw_invalid_argument_type(
                "transform",
                "code",
                "string or Uint8Array",
            ));
        };

        args.eat();
        let loader: Option<Loader> = 'brk: {
            if let Some(arg) = args.next() {
                args.eat();
                break 'brk loader_from_js(global, arg)?;
            }
            break 'brk None;
        };

        let default_loader = self.config.default_loader;
        Ok(TransformTask::schedule(
            self,
            callframe.this(),
            code,
            global,
            loader.unwrap_or(default_loader),
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn transform_sync(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding();
        let arguments = callframe.arguments();

        // SAFETY: bun_vm() returns the live VM singleton on this thread.
        let vm = global.bun_vm();
        let mut args = ArgumentsSlice::init(vm, arguments);
        let Some(code_arg) = args.next() else {
            return Err(global.throw_invalid_argument_type(
                "transformSync",
                "code",
                "string or Uint8Array",
            ));
        };

        let arena = Arena::new();
        let Some(code_holder) = StringOrBuffer::from_js(global, code_arg)? else {
            return Err(global.throw_invalid_argument_type(
                "transformSync",
                "code",
                "string or Uint8Array",
            ));
        };
        let code = code_holder.slice();
        arguments[0].ensure_still_alive();
        let _keep0 = bun_jsc::EnsureStillAlive(arguments[0]);

        args.eat();
        let mut js_ctx_value: JSValue = JSValue::ZERO;
        let loader: Option<Loader> = 'brk: {
            if let Some(arg) = args.next() {
                args.eat();
                if arg.is_number() || arg.is_string() {
                    break 'brk loader_from_js(global, arg)?;
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
                return Err(global.throw_invalid_argument_type(
                    "transformSync",
                    "context",
                    "object or loader",
                ));
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

        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        // NOTE: spec snapshots the WHOLE `this.transpiler` by value
        // (`prev_bundler = this.transpiler`) and restores it on exit. Here the
        // per-call arena and log are `with_call`'s, and the macro context is
        // snapshotted/restored by `MacroContextRestore`.
        let mut log = bun_ast::Log::init();
        log.level = self.log.get().level;

        // `MacroJSCtx` carries the encoded `JSValue` bits (`#[repr(transparent)] i64`).
        let macro_js_ctx: MacroJSCtx = MacroJSCtx(js_ctx_value.0 as i64);
        self.transpiler.with_mut(|t| {
            t.with_call(&arena, &mut log, |transpiler| {
                // `take()` both reads the prior value AND nulls it.
                let prev_macro_context = transpiler.macro_context().take();
                let restore = MacroContextRestore {
                    transpiler,
                    prev: Some(prev_macro_context),
                };
                let transpiler = &mut *restore.transpiler;

                let parse_result =
                    self.get_parse_result(transpiler, &arena, code, loader, macro_js_ctx);
                let log_ref = transpiler.log_mut();
                let Some(parse_result) = parse_result else {
                    if (log_ref.warnings + log_ref.errors) > 0 {
                        return Err(
                            global.throw_value(log_ref.to_js(global, format_args!("Parse error"))?)
                        );
                    }
                    return Err(global.throw(format_args!("Failed to parse code")));
                };

                if (log_ref.warnings + log_ref.errors) > 0 {
                    return Err(
                        global.throw_value(log_ref.to_js(global, format_args!("Parse error"))?)
                    );
                }

                let mut buffer_writer = self.buffer_writer.replace(None).unwrap_or_else(|| {
                    let mut writer = JSPrinter::BufferWriter::init();
                    bun_core::handle_oom(writer.buffer.grow_if_needed(code.len()));
                    writer
                });

                buffer_writer.reset();
                let mut printer = JSPrinter::BufferPrinter::init(buffer_writer);
                // Same per-call `arena` that `with_call` and `parse()` used.
                if let Err(err) = transpiler.print(
                    &arena,
                    parse_result,
                    &mut printer,
                    Transpiler::transpiler::PrintFormat::EsmAscii,
                ) {
                    self.buffer_writer.set(Some(printer.ctx));
                    return Err(global.throw_error(err, "Failed to print code"));
                }

                // TODO: benchmark if pooling this way is faster or moving is faster
                buffer_writer = printer.ctx;
                let result = bun_string_jsc::create_utf8_for_js(global, buffer_writer.written());
                self.buffer_writer.set(Some(buffer_writer));
                result
            })
        })
    }
}

fn named_exports_to_js(
    global: &JSGlobalObject,
    named_exports: &mut bun_ast::ast_result::NamedExports,
) -> JsResult<JSValue> {
    if named_exports.count() == 0 {
        return JSValue::create_empty_array(global, 0);
    }

    // NOTE: `StringArrayHashMap` has no in-place sort, so collect the keys, sort them
    // lexicographically, then emit `BunString`s in that order.
    let mut keys: Vec<&[u8]> = Vec::with_capacity(named_exports.count());
    let mut named_exports_iter = named_exports.iterator();
    while let Some(entry) = named_exports_iter.next() {
        keys.push(&**entry.key_ptr);
    }
    index_sort::sort_slice_unstable_by(&mut keys, |a, b| a.cmp(b));

    let names: Vec<BunString> = keys.into_iter().map(BunString::from_bytes).collect();
    bun_string_jsc::to_js_array(global, &names)
}

fn named_imports_to_js(
    global: &JSGlobalObject,
    import_records: &[ImportRecord],
    trim_unused_imports: bool,
) -> JsResult<JSValue> {
    let path_label = EncodedSlice::latin1(b"path");
    let kind_label = EncodedSlice::latin1(b"kind");

    let mut count: u32 = 0;
    for record in import_records {
        if record.flags.contains(ImportRecordFlags::IS_INTERNAL) {
            continue;
        }
        if trim_unused_imports && record.flags.contains(ImportRecordFlags::IS_UNUSED) {
            continue;
        }
        count += 1;
    }

    let array = JSValue::create_empty_array(global, count as usize)?;
    array.ensure_still_alive();

    let mut i: u32 = 0;
    for record in import_records {
        if record.flags.contains(ImportRecordFlags::IS_INTERNAL) {
            continue;
        }
        if trim_unused_imports && record.flags.contains(ImportRecordFlags::IS_UNUSED) {
            continue;
        }

        array.ensure_still_alive();
        let path = bun_string_jsc::create_utf8_for_js(global, record.path.text)?;
        let kind = BunString::static_(record.kind.label()).to_js(global)?;
        let entry = JSValue::create_object2(global, &path_label, &kind_label, path, kind)?;
        array.put_index(global, i, entry)?;
        i += 1;
    }

    Ok(array)
}

impl JSTranspiler {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn scan_imports(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns the live VM singleton on this thread.
        let vm = global.bun_vm();
        let mut args = ArgumentsSlice::init(vm, callframe.arguments());

        let Some(code_arg) = args.next() else {
            return Err(global.throw_invalid_argument_type(
                "scanImports",
                "code",
                "string or Uint8Array",
            ));
        };

        let Some(code_holder) = StringOrBuffer::from_js(global, code_arg)? else {
            return Err(global.throw_invalid_argument_type(
                "scanImports",
                "code",
                "string or Uint8Array",
            ));
        };
        args.eat();
        let code = code_holder.slice();

        let mut loader: Loader = self.config.default_loader;
        if let Some(arg) = args.next() {
            if let Some(l) = loader_from_js(global, arg)? {
                loader = l;
            }
            args.eat();
        }

        if !loader.is_java_script_like() {
            return Err(global.throw_invalid_arguments(format_args!(
                "Only JavaScript-like files support this fast path",
            )));
        }

        let arena = Arena::new();
        let mut log = bun_ast::Log::init();
        // What the transpiler itself logs during the call (macros); `scan` logs to `log`.
        let mut call_log = bun_ast::Log::init();

        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        let source = bun_ast::Source::init_path_string(loader.stdin_name(), code);

        // NOTE: spec calls `transpiler.resolver.caches.js.scan`. The
        // resolver-side `cache::JavaScript` is a fieldless shell with
        // no `scan` body; the real `scan` lives on `bun_bundler::cache::JavaScript`.
        // Both are stateless unit structs, so calling the bundler-crate one
        // directly is equivalent.
        let scan_result = self.transpiler.with_mut(|t| {
            t.with_call(&arena, &mut call_log, |transpiler| {
                let jsx = match self.config.tsconfig.as_deref() {
                    Some(ts) => ts.merge_jsx(transpiler.options().jsx.clone()),
                    None => transpiler.options().jsx.clone(),
                };
                let mut opts = bun_js_parser::ParserOptions::init(jsx, loader);
                // `options.define` is `Box<Define>` owned by the long-lived `Transpiler`;
                // the parser borrows it for the arena lifetime.
                let (macro_context, define) = transpiler.macro_context_and_define();
                opts.macro_context = Some(macro_context);

                self.scan_pass_result.with_mut(|scan_pass_result| {
                    bun_bundler::cache::JavaScript::init().scan(
                        &arena,
                        scan_pass_result,
                        opts,
                        define,
                        &mut log,
                        &source,
                    )
                })
            })
        });
        call_log.append_to_with_recycled(&mut log, true);

        // `scan_pass_result` must be reset on every exit past this point
        // (including the error paths). Compute the result, then reset
        // unconditionally before returning.
        let result = (|| -> JsResult<JSValue> {
            if let Err(err) = scan_result {
                if (log.warnings + log.errors) > 0 {
                    return Err(global
                        .throw_value(log.to_js(global, format_args!("Failed to scan imports"))?));
                }
                return Err(global.throw_error(err, "Failed to scan imports"));
            }

            if (log.warnings + log.errors) > 0 {
                return Err(
                    global.throw_value(log.to_js(global, format_args!("Failed to scan imports"))?)
                );
            }

            named_imports_to_js(
                global,
                self.scan_pass_result.get().import_records.as_slice(),
                self.config.trim_unused_imports.unwrap_or(false),
            )
        })();
        self.scan_pass_result.with_mut(|s| s.reset());
        result
    }
}

/// Heuristic used by the REPL: returns true if `code` starts with `{` (after
/// whitespace) and doesn't end with `;` — i.e. should be wrapped in `()` to
/// parse as an object literal rather than a block statement. Mirrors Node.js.
pub(crate) fn is_likely_object_literal(code: &[u8]) -> bool {
    // Skip leading whitespace
    let mut start: usize = 0;
    while start < code.len() && matches!(code[start], b' ' | b'\t' | b'\n' | b'\r') {
        start += 1;
    }
    // Check if starts with {
    if start >= code.len() || code[start] != b'{' {
        return false;
    }
    // Skip trailing whitespace
    let mut end: usize = code.len();
    while end > 0 && matches!(code[end - 1], b' ' | b'\t' | b'\n' | b'\r') {
        end -= 1;
    }
    // Check if ends with semicolon - if so, it's likely a block statement
    !(end > 0 && code[end - 1] == b';')
}
