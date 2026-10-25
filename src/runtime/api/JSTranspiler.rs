//! `Bun.Transpiler` — single-file transform/scan over the JS parser.

use bun_alloc::ArenaVecExt as _;
use bun_options_types::TargetExt as _;
use std::io::Write as _;

use crate::Error;
use crate::generated_bindgen::transpiler::{
    TranspilerExternal, TranspilerMinify, TranspilerOptions, TranspilerSourcemap,
};
use crate::node::types::Buffer;
use crate::node::{Encoding, StringOrBuffer, ThreadIsolated};
use bun_alloc::{Arena, ArenaVec}; // bumpalo::Bump / bumpalo::collections::Vec re-exports
use bun_ast::Expr;
use bun_ast::Loader;
use bun_ast::{ImportRecord, ImportRecordFlags};
use bun_bundler::options::{self, PackagesOption, SourceMapOption};
use bun_bundler::transpiler::{MacroJSCtx, ParseOptions, ParseResult};
use bun_bundler::{self as Transpiler};
use bun_js_parser::lexer as JSLexer;
use bun_js_parser::parser::Runtime;
use bun_js_parser::parser::ScanPassResult;
use bun_js_parser::{self as JSAst};
use bun_js_printer as JSPrinter;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper, StringOrJsBytes};
use bun_jsc::bun_string_jsc;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, JSArrayIterator, JSGlobalObject, JSPromise, JSPropertyIterator,
    JSPropertyIteratorOptions, JSValue, JsCell, JsResult, LogJsc, StringJsc,
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
/// `Transpiler`, declared in `Transpiler.bind.ts`.
#[derive(bun_ptr::RefCounted)]
pub(crate) struct JSTranspiler {
    pub(crate) transpiler: JsCell<Transpiler::Transpiler<'static>>,
    /// Read-only after construction EXCEPT for `config.log`, which is the
    /// resting-state log that `transpiler.log: *mut Log` points at between
    /// host-fn calls. `JsCell` so a `*mut Log` can be projected from `&self`.
    pub(crate) config: JsCell<Config>,
    pub(crate) scan_pass_result: JsCell<ScanPassResult>,
    pub(crate) buffer_writer: JsCell<Option<JSPrinter::BufferWriter>>,
    // Arena bulk-frees the config strings. Boxed so its
    // address is stable across the move into `Box<JSTranspiler>` —
    // `transpiler.arena` holds a `&'static Arena` pointing into it.
    pub(crate) _arena: Box<Arena>,
    pub(crate) ref_count: bun_ptr::RefCount<JSTranspiler>,
}

fn default_transform_options() -> api::TransformOptions {
    api::TransformOptions {
        disable_hmr: true,
        target: Some(api::Target::Browser),
        ..Default::default()
    }
}

pub(crate) struct Config {
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

use bun_bundler_jsc::options_jsc::loader_from_js;
use bun_collections::index_sort;

/// Reads the `code` argument. Copies a buffer because the loader's `toString()` and macros run JS that can
/// write to, shrink or detach it. Skips the copy when the parser will reject the buffer for its length anyway.
fn code_from_js(
    global: &JSGlobalObject,
    value: StringOrJsBytes<'_>,
) -> JsResult<StringOrBuffer<'static>> {
    let parsed = StringOrBuffer::from_string_or_js_bytes(global, value, Encoding::Utf8);
    let StringOrBuffer::Buffer(buffer) = &parsed else {
        return Ok(parsed);
    };
    if !buffer.buffer.can_change_under_borrow()
        && buffer.buffer.byte_len > bun_ast::Source::MAX_PARSEABLE_LEN
    {
        return Ok(parsed);
    }
    match buffer.buffer.try_copy_bytes() {
        Some(copy) => Ok(StringOrBuffer::owned(copy)),
        None => Err(global.throw_out_of_memory()),
    }
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
    include_symbols: false,
};

impl Config {
    // NOTE: out-param constructor kept as `&mut self` because `self` is a pre-initialized
    // field on `JSTranspiler` (in-place mutation), not a fresh value to return.
    pub(crate) fn from_js(
        &mut self,
        global: &JSGlobalObject,
        object: Option<&TranspilerOptions<'_>>,
        arena: &Arena,
    ) -> JsResult<()> {
        let Some(object) = object else {
            return Ok(());
        };

        if let Some(define) = object.define.map(JsLocal::to_js) {
            'define: {
                if define.is_undefined_or_null() {
                    break 'define;
                }

                let Some(define_obj) = define.get_object() else {
                    return Err(
                        global.throw_invalid_arguments(format_args!("define must be an object"))
                    );
                };

                // SAFETY: `define_obj` is a non-null *mut JSObject (just returned by get_object()).
                let define_obj_ref = unsafe { &*define_obj };
                let define_iter = JSPropertyIterator::init(global, define_obj_ref, PROP_ITER_OPTS)?;
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

        if let Some(external) = &object.external {
            match external {
                TranspilerExternal::Name(str) => {
                    if !str.is_empty() {
                        self.transform.external = vec![str.to_owned_slice().into_boxed_slice()];
                    }
                }
                TranspilerExternal::Names(names) => {
                    let mut externals: Vec<Box<[u8]>> = Vec::with_capacity(names.len());
                    for str in names {
                        if str.is_empty() {
                            continue;
                        }
                        externals.push(str.to_owned_slice().into_boxed_slice());
                    }

                    self.transform.external = externals;
                }
            }
        }

        if let Some(resolved) = loader_from_js(global, object.loader.to_js())? {
            if !resolved.is_java_script_like() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "only JavaScript-like loaders supported for now",
                )));
            }

            self.default_loader = resolved;
        }

        if let Some(target) = object.target {
            if let Some(resolved) = bun_ast::Target::MAP.get(target) {
                self.transform.target = Some(resolved.to_api());
            }
        }

        let tsconfig = object.tsconfig.to_js();
        if !tsconfig.is_undefined_or_null() {
            'tsconfig: {
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

        if let Some(macros) = object.r#macro.map(JsLocal::to_js) {
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

        if let Some(flag) = object.auto_import_jsx {
            self.runtime.auto_import_jsx = flag;
        }

        if let Some(flag) = object.allow_bun_runtime {
            self.runtime.allow_runtime = flag;
        }

        if let Some(flag) = object.inlining {
            self.runtime.inlining = flag;
        }

        if let Some(flag) = object.minify_whitespace {
            self.minify_whitespace = flag;
        }

        if let Some(flag) = object.dead_code_elimination {
            self.dead_code_elimination = flag;
        }

        if let Some(flag) = object.repl_mode {
            self.repl_mode = flag;
        }

        if let Some(minify) = &object.minify {
            match minify {
                TranspilerMinify::All(minify) => {
                    self.minify_whitespace = *minify;
                    self.minify_syntax = self.minify_whitespace;
                    self.minify_identifiers = self.minify_syntax;
                }
                TranspilerMinify::Options(minify) => {
                    if let Some(whitespace) = minify.whitespace {
                        self.minify_whitespace = whitespace;
                    }
                    if let Some(syntax) = minify.syntax {
                        self.minify_syntax = syntax;
                    }
                    if let Some(syntax) = minify.identifiers {
                        self.minify_identifiers = syntax;
                    }
                }
            }
        }

        if let Some(flag) = object.sourcemap {
            match flag {
                TranspilerSourcemap::Enabled(flag) => {
                    if flag {
                        self.transform.source_map = Some(api::SourceMapMode::Inline);
                    } else {
                        self.transform.source_map = Some(api::SourceMapMode::None);
                    }
                }
                TranspilerSourcemap::Mode(flag) => {
                    if let Some(source) = options::SOURCE_MAP_OPTION_MAP.get(flag) {
                        self.transform.source_map = Some(SourceMapOption::to_api(Some(*source)));
                    } else {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "sourcemap must be one of \"inline\", \"linked\", \"external\", or \"none\"",
                        )));
                    }
                }
            }
        }

        if let Some(packages) = object.packages {
            let Some(packages) = options::PACKAGES_OPTION_MAP.get(packages) else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "packages must be one of \"bundle\" or \"external\"",
                )));
            };
            self.transform.packages = Some(PackagesOption::to_api(Some(*packages)));
        }

        let mut tree_shaking: Option<bool> = object.tree_shaking;
        let trim_unused_imports: Option<bool> = object.trim_unused_imports;

        if let Some(exports) = &object.exports {
            let mut replacements = bun_ast::runtime::ReplaceableExportMap::default();
            // errdefer replacements.clearAndFree(allocator) → Drop on error path

            if let Some(eliminate) = exports.eliminate.map(JsLocal::to_js) {
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

            if let Some(replace) = exports.replace.map(JsLocal::to_js) {
                let Some(replace_obj) = replace.get_object() else {
                    return Err(
                        global.throw_invalid_arguments(format_args!("replace must be an object"))
                    );
                };

                // SAFETY: `replace_obj` is non-null (just returned by get_object()).
                let replace_obj_ref = unsafe { &*replace_obj };
                let iter = JSPropertyIterator::init(global, replace_obj_ref, PROP_ITER_OPTS)?;

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

        if let Some(log_level) = object.log_level {
            if let Some(level) = bun_ast::Level::MAP.get(log_level) {
                self.log.level = *level;
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
/// `transpiler.transform()` off the JS thread. The parse/print state points
/// into the owning `JSTranspiler`'s config (its `Transpiler` is bit-copied),
/// which the job's Js side keeps alive and the pool borrow keeps valid.
pub(crate) struct TransformTask {
    pub input_code: ThreadIsolated<StringOrBuffer<'static>>,
    pub output_code: BunString,
    pub transpiler: core::mem::ManuallyDrop<Transpiler::Transpiler<'static>>,
    pub log: bun_ast::Log,
    pub err: Option<Error>,
    pub macro_map: MacroMap,
    pub tsconfig: Option<jsc::JsPtr<TSConfigJSON>>,
    pub loader: Loader,
    pub replace_exports: bun_ast::runtime::ReplaceableExportMap,
}
// SAFETY: see the type doc — VM-owned config is read only under the pool
// borrow; everything else is owned.
unsafe impl Send for TransformTask {}

#[derive(bun_jsc::JsAffine)]
pub(crate) struct TransformJs {
    promise: jsc::JSPromiseStrong,
    /// The `JSTranspiler` wrapper whose config the task reads.
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

impl TransformTask {
    // `pub const new = bun.TrivialNew(@This())` → Box::new

    /// Schedule the transform on the work pool; returns its promise.
    fn schedule(
        transpiler: &JSTranspiler,
        transpiler_js: JSValue,
        input_code: ThreadIsolated<StringOrBuffer<'static>>,
        cx: &bun_jsc::JsThread<'_>,
        loader: Loader,
    ) -> JSValue {
        let config = transpiler.config.get();
        let mut log = bun_ast::Log::init();
        log.level = config.log.level;

        // SAFETY: `ManuallyDrop` keeps this bitwise copy from freeing what the
        // wrapper owns; `run` re-aims its log and arena pointers.
        let transpiler_copy = core::mem::ManuallyDrop::new(unsafe {
            core::ptr::read(transpiler.transpiler.as_ptr())
        });

        let task = TransformTask {
            input_code,
            output_code: BunString::EMPTY,
            transpiler: transpiler_copy,
            macro_map: clone_macro_map(&config.macro_map),
            tsconfig: config
                .tsconfig
                .as_deref()
                // SAFETY: points into the wrapper's config, kept alive by `TransformJs`.
                .map(|t| unsafe { jsc::JsPtr::new(core::ptr::NonNull::from(t)) }),
            log,
            err: None,
            loader,
            replace_exports: bun_ast::runtime::ReplaceableExportMap {
                entries: config.runtime.replace_exports.entries.clone().expect("OOM"),
            },
        };
        let promise = jsc::JSPromiseStrong::init(cx.global());
        let value = promise.value();
        jsc::Job::<TransformTask>::schedule(
            cx,
            task,
            TransformJs {
                promise,
                _transpiler: jsc::Strong::create(transpiler_js, cx.global()),
            },
        );
        value
    }

    fn run(&mut self, vm: &jsc::Ticket) {
        let name = self.loader.stdin_name();
        // SAFETY: the wrapper's config, alive under the job's ticket (see `schedule`).
        let tsconfig: Option<&TSConfigJSON> =
            self.tsconfig.map(|p| &*unsafe { p.under_ticket(vm) });

        let arena = Arena::new();

        // `self.transpiler` is a `ManuallyDrop` bytewise copy of the
        // `JSTranspiler`'s long-lived transpiler (`ptr::read` in `create()`),
        // so its `macro_context` may alias a box the `JSTranspiler` still owns
        // — and that box's `resolver`/`remap` raw pointers point at the
        // *original* transpiler, not this copy. Null it so `parse()` lazily
        // creates a fresh one whose self-refs target this copy, then reclaim
        // the fresh box on every return path (mirrors `RuntimeTranspilerStore`).
        self.transpiler.macro_context = None;
        let _macro_ctx_guard = scopeguard::guard(
            core::ptr::addr_of_mut!(self.transpiler.macro_context),
            |slot| {
                // SAFETY: `slot` points into the heap-stable `TransformTask`
                // box; only this thread holds `&mut self`, and the parser's
                // `&mut MacroContext` borrow ended with `parse()`.
                if let Some(ctx) = unsafe { (*slot).take() } {
                    ctx.deinit();
                }
            },
        );

        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        // SAFETY: `arena` outlives every use through `self.transpiler` in this fn body;
        // Transpiler<'static> forces the borrow to 'static, so launder through a raw ptr.
        let arena_ref: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(&arena) };
        let source: &bun_ast::Source = arena_ref.alloc(bun_ast::Source::init_path_string(
            name,
            self.input_code.slice(),
        ));
        self.transpiler.set_arena(arena_ref);
        self.transpiler.set_log(&raw mut self.log);
        // self.log.msgs.allocator = bun.default_allocator → no-op

        let jsx = match tsconfig {
            Some(ts) => ts.merge_jsx(self.transpiler.options.jsx.clone()),
            None => self.transpiler.options.jsx.clone(),
        };

        let parse_options = ParseOptions {
            arena: arena_ref,
            macro_remappings: clone_macro_map(&self.macro_map),
            dirname_fd: bun_sys::Fd::INVALID,
            file_descriptor: None,
            loader: self.loader,
            jsx,
            path: source.path,
            virtual_source: Some(source),
            replace_exports: self.replace_exports.entries.clone().expect("OOM"),
            experimental_decorators: tsconfig.is_some_and(|ts| ts.experimental_decorators),
            emit_decorator_metadata: tsconfig.is_some_and(|ts| ts.emit_decorator_metadata),
            use_define_for_class_fields: tsconfig
                .and_then(|ts| ts.use_define_for_class_fields)
                .unwrap_or(true),
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

        let Some(parse_result) = self.transpiler.parse(parse_options, None) else {
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
        // Same per-call `arena` that `set_arena(&arena)` and `parse()` used.
        let printed = match self.transpiler.print(
            &arena,
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
        // The result outlives every parse, so don't allocate it in the thread-local store.
        return Ok(Some(Expr::allocate(
            arena,
            bun_ast::E::EString::init(data),
            bun_ast::Loc::EMPTY,
        )));
    }

    Ok(None)
}

impl JSTranspiler {
    pub(crate) fn constructor(
        cx: &mut JsScope<'_>,
        config_arg: Option<&TranspilerOptions<'_>>,
    ) -> JsResult<*mut JSTranspiler> {
        let global = cx.global();
        // NOTE: a non-POD field cannot be left uninitialized in a live Box
        // (zeroed()/assume_init() on Transpiler is UB), so build `config` + `transpiler` on the
        // stack first, then move both into the Box. Nothing observes the
        // `Box<JSTranspiler>` address before construction completes. The
        // address-sensitive pointers are `transpiler.arena` (points into the
        // separately-boxed `arena`, whose address is move-stable) and
        // `transpiler.log` (initially points at the stack-local `config.log`;
        // it is re-pointed via `set_log` once the Box exists — see the NOTE
        // below), so no up-front allocation / `MaybeUninit` in-place init is
        // needed.
        let mut config = Config {
            log: bun_ast::Log::init(),
            ..Default::default()
        };
        let arena = Box::new(Arena::new());
        // SAFETY: `arena` is heap-allocated and moved (as a Box) into `Box<JSTranspiler>` below;
        // its address is stable for the lifetime of the JSTranspiler. `Transpiler<'static>` forces
        // the borrow to 'static, so launder through a raw ptr.
        let arena_ref: &'static Arena =
            unsafe { bun_ptr::detach_lifetime_ref::<Arena>(arena.as_ref()) };

        // errdefer { ... } — on any `?` below, stack `config`/`arena` drop and run Drop, which
        // covers config.log, config.tsconfig, arena. ref_count.clearWithoutDestructor is a
        // no-op when we never handed out refs. `bun.destroy(this)` → Box not yet created.

        config.from_js(global, config_arg, arena_ref)?;

        if (config.log.warnings + config.log.errors) > 0 {
            return Err(global.throw_value(
                config
                    .log
                    .to_js(global, format_args!("Failed to create transpiler"))?,
            ));
        }

        // SAFETY: VirtualMachine::get() returns the live singleton on the JS thread.
        let vm = VirtualMachine::get().as_mut();
        let transpiler = match Transpiler::Transpiler::init(
            arena_ref,
            &raw mut config.log,
            config.transform.clone(),
            Some(vm.transpiler.env),
        ) {
            Ok(t) => t,
            Err(err) => {
                let log = &mut config.log;
                if (log.warnings + log.errors) > 0 {
                    return Err(global.throw_value(
                        log.to_js(global, format_args!("Failed to create transpiler"))?,
                    ));
                }
                return Err(global.throw_error(err, "Error creating transpiler"));
            }
        };

        let this: Box<JSTranspiler> = Box::new(JSTranspiler {
            config: JsCell::new(config),
            _arena: arena,
            transpiler: JsCell::new(transpiler),
            scan_pass_result: JsCell::new(ScanPassResult::init()),
            buffer_writer: JsCell::new(None),
            ref_count: bun_ptr::RefCount::init(),
        });
        // errdefer past this point → `this: Box<_>` drops and runs Drop for JSTranspiler.

        // NOTE: `config` was built on the stack and moved into the Box, so
        // `transpiler.log` (a `*mut Log`) still points at the moved-from
        // stack slot. Re-point it at the heap-stable field now that the Box exists.
        // SAFETY: `this: Box<_>` is exclusively owned (init-time, before the JS
        // wrapper exists) so projecting `&mut`/`*mut` from the JsCells is trivially
        // alias-free.
        let config = unsafe { this.config.get_mut() };
        // SAFETY: same exclusive-ownership invariant as the line above — `this: Box<_>`
        // is uniquely owned at init time, so `&mut` projection is alias-free.
        let transpiler = unsafe { this.transpiler.get_mut() };
        transpiler.set_log(&raw mut config.log);
        // `set_log` doesn't update `options.log`, which `configure_defines` logs to.
        transpiler.options.log = &raw mut config.log;

        transpiler.options.no_macros = config.no_macros;
        transpiler.configure_linker_with_auto_jsx(false);
        transpiler.options.env.behavior = options::EnvBehavior::disable;
        if let Err(err) = transpiler.configure_defines() {
            let log = &mut config.log;
            if (log.warnings + log.errors) > 0 {
                return Err(
                    global.throw_value(log.to_js(global, format_args!("Failed to load define"))?)
                );
            }
            return Err(global.throw_error(err, "Failed to load define"));
        }

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
        self.transpiler.with_mut(|t| {
            if let Some(ctx) = t.macro_context.take() {
                ctx.deinit();
            }
        });
        let log = self.transpiler.get().log;
        if !log.is_null() {
            // SAFETY: `transpiler.log` was set via `set_log` to `&mut self.config.log`
            // (heap-stable for `Self`'s lifetime) and just checked non-null.
            unsafe { (*log).clear_and_free() };
        }
        // scan_pass_result.{named_imports,import_records,used_symbols}.deinit() → field Drop
        // buffer_writer.?.buffer.deinit() → Option<BufferWriter>: Drop
        // config.tsconfig.deinit() → Option<Box<TSConfigJSON>>: Drop
        // arena.deinit() → Arena: Drop
    }
}

/// `scan` / `transform_sync` / `scan_imports` temporarily point the long-lived
/// `Transpiler` at a stack-local `Arena`/`Log`; on EVERY exit (including `?`
/// and early `return Err`) those must be restored before the locals drop, or
/// the next method call dereferences a dangling allocator/log.
struct TranspilerStateGuard {
    transpiler: *mut Transpiler::Transpiler<'static>,
    prev_arena: &'static Arena,
    restore_log: *mut bun_ast::Log,
    /// `Some(prev)` ⇒ also restore `macro_context` to `prev` (transformSync's
    /// by-value snapshot). `None` ⇒ leave untouched (scan / scanImports only
    /// restore log+allocator per spec).
    prev_macro_context: Option<Option<JSAst::Macro::MacroContext>>,
}

impl TranspilerStateGuard {
    /// Mutable access to the guarded `Transpiler`.
    ///
    /// SAFETY: `self.transpiler` is always non-null — every construction site
    /// initializes it from `js_transpiler.transpiler.as_ptr()` (the
    /// `JsCell<Transpiler>` in the heap-stable `Box<JSTranspiler>`), which
    /// outlives this stack-local guard. The guard is held as
    /// `let _restore = ...;` and never touched between construction and `Drop`,
    /// so no other `&mut Transpiler` projection from that `JsCell` is live when
    /// this runs.
    #[inline]
    fn transpiler_mut(&mut self) -> &mut Transpiler::Transpiler<'static> {
        // SAFETY: `self.transpiler` is non-null (set from `JsCell::as_ptr()` on the
        // heap-stable `Box<JSTranspiler>`); the guard holds the only live `&mut`
        // projection of that `JsCell` between construction and `Drop`.
        unsafe { &mut *self.transpiler }
    }

    /// Raw `*mut Log` to restore on drop. Returned as a pointer (not `&mut`)
    /// because the sole consumer, `Transpiler::set_log`, takes `*mut Log`, and
    /// the pointee (`js_transpiler.config.log`) is never dereferenced by the
    /// guard itself.
    #[inline]
    fn restore_log_ptr(&self) -> *mut bun_ast::Log {
        self.restore_log
    }
}

impl Drop for TranspilerStateGuard {
    fn drop(&mut self) {
        // `transpiler` and `restore_log` point into the heap-stable
        // `Box<JSTranspiler>` (`self.transpiler` / `self.config.log`) which
        // outlives this stack frame. The guard is declared after the temporary
        // arena/log and so drops before them (reverse-decl order), ensuring the
        // Transpiler never observes a dangling `&'static Arena`.
        let restore_log = self.restore_log_ptr();
        let prev_arena = self.prev_arena;
        let prev_macro_context = self.prev_macro_context.take();
        let transpiler = self.transpiler_mut();
        transpiler.set_log(restore_log);
        transpiler.arena = prev_arena;
        if let Some(prev) = prev_macro_context {
            // `transformSync` created a fresh MacroContext for this parse and
            // stored it in `transpiler.macro_context`; the box behind its
            // `data` pointer is heap-owned and `MacroContext` has no `Drop`,
            // so overwriting it with `prev` would strand the box. Free it
            // explicitly before restoring the outer state.
            if let Some(new_ctx) = transpiler.macro_context.take() {
                new_ctx.deinit();
            }
            transpiler.macro_context = prev;
        }
    }
}

impl JSTranspiler {
    // ─── R-2 interior-mutability helpers ─────────────────────────────────────

    /// `*mut Log` to the resting-state `config.log`, projected through the
    /// `JsCell<Config>` (UnsafeCell-backed, so the write provenance is sound).
    #[inline]
    fn config_log_ptr(&self) -> *mut bun_ast::Log {
        // SAFETY: `as_ptr()` yields the `UnsafeCell` payload; `&raw mut` field
        // projection forms no intermediate reference.
        unsafe { &raw mut (*self.config.as_ptr()).log }
    }

    /// `&mut Transpiler` projection through `&self`.
    ///
    /// # Safety
    ///
    /// Caller must not hold another `&`/`&mut` to `self.transpiler` for the
    /// borrow's lifetime. `Transpiler::parse` may re-enter JS via macros; if
    /// that JS calls back into a `JSTranspiler` host-fn on *this same instance*
    /// the inner `Transpiler` is re-borrowed — a pre-existing hazard that R-2's
    /// outer-struct fix does not address. The R-2 invariant this upholds is
    /// that no `noalias &mut JSTranspiler` is live across that re-entry.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    unsafe fn transpiler_mut(&self) -> &mut Transpiler::Transpiler<'static> {
        // SAFETY: caller upholds the no-aliasing precondition documented on this
        // `unsafe fn`; `JsCell::get_mut` projects through `UnsafeCell`.
        unsafe { self.transpiler.get_mut() }
    }

    // ─────────────────────────────────────────────────────────────────────────

    fn get_parse_result(
        &self,
        arena: &'static Arena,
        code: &[u8],
        loader: Option<Loader>,
        macro_js_ctx: MacroJSCtx,
    ) -> Option<ParseResult<'static>> {
        let config = self.config.get();
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
            Some(ts) => ts.merge_jsx(self.transpiler.get().options.jsx.clone()),
            None => self.transpiler.get().options.jsx.clone(),
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

        // SAFETY: see `transpiler_mut` — `parse` may re-enter JS via macros.
        unsafe { self.transpiler_mut() }.parse(parse_options, None)
    }

    pub(crate) fn scan(
        &self,
        cx: &mut JsScope<'_>,
        code_arg: StringOrJsBytes<'_>,
        loader_arg: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        jsc::mark_binding();
        let global = cx.global();
        let code_holder = code_from_js(global, code_arg)?;
        let code = code_holder.slice();

        let loader: Option<Loader> = loader_from_js(global, loader_arg.to_js())?;

        let arena = Arena::new();
        let mut log = bun_ast::Log::init();
        // SAFETY: `arena` outlives every use through `self.transpiler` in this fn body;
        // `_restore` (declared after `arena`/`log`, so dropped first) restores
        // `prev_arena` and `&self.config.log` before either local drops.
        // `with_mut` borrow is closure-scoped; no JS re-entry inside.
        let arena_ref: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(&arena) };
        let prev_arena = self.transpiler.with_mut(|t| {
            let prev = t.arena;
            t.set_arena(arena_ref);
            t.set_log(&raw mut log);
            prev
        });
        let _restore = TranspilerStateGuard {
            transpiler: self.transpiler.as_ptr(),
            prev_arena,
            restore_log: self.config_log_ptr(),
            prev_macro_context: None,
        };

        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        let parse_result = self.get_parse_result(arena_ref, code, loader, MacroJSCtx::ZERO);
        let log_ref = self.transpiler.get().log_mut();
        let Some(mut parse_result) = parse_result else {
            if (log_ref.warnings + log_ref.errors) > 0 {
                return Err(global.throw_value(log_ref.to_js(global, format_args!("Parse error"))?));
            }
            return Err(global.throw(format_args!("Failed to parse")));
        };

        if (log_ref.warnings + log_ref.errors) > 0 {
            return Err(global.throw_value(log_ref.to_js(global, format_args!("Parse error"))?));
        }

        let exports_label = EncodedSlice::latin1(b"exports");
        let imports_label = EncodedSlice::latin1(b"imports");
        let named_imports_value = named_imports_to_js(
            global,
            parse_result.ast.import_records.as_slice(),
            self.config.get().trim_unused_imports.unwrap_or(false),
        )?;

        let named_exports_value = named_exports_to_js(global, &mut parse_result.ast.named_exports)?;

        JSValue::create_object2(
            global,
            &imports_label,
            &exports_label,
            named_imports_value,
            named_exports_value,
        )
    }

    pub(crate) fn transform(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        code_arg: StringOrJsBytes<'_>,
        loader_arg: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let js_thread = global.js_thread_of_caller();
        jsc::mark_binding();
        let code = match code_arg {
            StringOrJsBytes::Bytes(buffer) => {
                let bytes = Buffer::from_array_buffer(global, buffer.to_js())
                    .slice()
                    .to_vec();
                global.vm().report_extra_memory(bytes.len());
                StringOrBuffer::owned_isolated(bytes)
            }
            StringOrJsBytes::String(text) => StringOrBuffer::thread_isolated_string(global, text),
        };

        let loader: Option<Loader> = loader_from_js(global, loader_arg.to_js())?;

        let default_loader = self.config.get().default_loader;
        Ok(TransformTask::schedule(
            self,
            this_value.to_js(),
            code,
            &js_thread,
            loader.unwrap_or(default_loader),
        ))
    }

    pub(crate) fn transform_sync<'a>(
        &self,
        cx: &mut JsScope<'a>,
        code_arg: StringOrJsBytes<'a>,
        loader_or_context: JsLocal<'a>,
        context: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        jsc::mark_binding();

        let arena = Arena::new();
        let global = cx.global();
        let code_holder = code_from_js(global, code_arg)?;
        let code = code_holder.slice();

        let mut js_ctx_value: JSValue = JSValue::ZERO;
        let loader: Option<Loader> = 'brk: {
            let arg = loader_or_context.to_js();
            if arg.is_number() || arg.is_string() {
                break 'brk loader_from_js(global, arg)?;
            }

            if arg.is_object() {
                js_ctx_value = arg;
            }
            break 'brk None;
        };

        let context = context.to_js();
        if !context.is_undefined() {
            if context.is_object() {
                js_ctx_value = context;
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
        // (`prev_bundler = this.transpiler`) and restores it on exit. `Transpiler` is not
        // bitwise-copyable in Rust, so explicitly snapshot the fields the body mutates
        // (`allocator`, `log`, `macro_context`) and restore them via RAII guard.
        let mut log = bun_ast::Log::init();
        log.level = self.config.get().log.level;
        // SAFETY: `arena` outlives every use through `self.transpiler` in this fn body;
        // `_restore` (declared after `arena`/`log`, so dropped first) restores
        // `prev_arena`, `&self.config.log`, and `prev_macro_context` before either drops.
        // `with_mut` borrow is closure-scoped; no JS re-entry inside.
        let arena_ref: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(&arena) };
        let (prev_arena, prev_macro_context) = self.transpiler.with_mut(|t| {
            let prev_arena = t.arena;
            // `take()` both reads the prior value AND nulls it.
            let prev_mc = t.macro_context.take();
            t.set_arena(arena_ref);
            t.set_log(&raw mut log);
            (prev_arena, prev_mc)
        });
        let _restore = TranspilerStateGuard {
            transpiler: self.transpiler.as_ptr(),
            prev_arena,
            restore_log: self.config_log_ptr(),
            prev_macro_context: Some(prev_macro_context),
        };

        // `MacroJSCtx` carries the encoded `JSValue` bits (`#[repr(transparent)] i64`).
        let macro_js_ctx: MacroJSCtx = MacroJSCtx(js_ctx_value.0 as i64);
        let parse_result = self.get_parse_result(arena_ref, code, loader, macro_js_ctx);
        let log_ref = self.transpiler.get().log_mut();
        let Some(parse_result) = parse_result else {
            if (log_ref.warnings + log_ref.errors) > 0 {
                return Err(global.throw_value(log_ref.to_js(global, format_args!("Parse error"))?));
            }
            return Err(global.throw(format_args!("Failed to parse code")));
        };

        if (log_ref.warnings + log_ref.errors) > 0 {
            return Err(global.throw_value(log_ref.to_js(global, format_args!("Parse error"))?));
        }

        let mut buffer_writer = self.buffer_writer.replace(None).unwrap_or_else(|| {
            let mut writer = JSPrinter::BufferWriter::init();
            bun_core::handle_oom(writer.buffer.grow_if_needed(code.len()));
            writer
        });

        buffer_writer.reset();
        let mut printer = JSPrinter::BufferPrinter::init(buffer_writer);
        // SAFETY: see `transpiler_mut` — `print` does not re-enter JS.
        // Same per-call `arena` that `set_arena(&arena)` and `parse()` used.
        if let Err(err) = unsafe { self.transpiler_mut() }.print(
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
    pub(crate) fn scan_imports(
        &self,
        cx: &mut JsScope<'_>,
        code_arg: StringOrJsBytes<'_>,
        loader_arg: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let code_holder = code_from_js(global, code_arg)?;
        let code = code_holder.slice();

        let mut loader: Loader = self.config.get().default_loader;
        if let Some(l) = loader_from_js(global, loader_arg.to_js())? {
            loader = l;
        }

        if !loader.is_java_script_like() {
            return Err(global.throw_invalid_arguments(format_args!(
                "Only JavaScript-like files support this fast path",
            )));
        }

        let arena = Arena::new();
        let mut log = bun_ast::Log::init();
        // SAFETY: `arena` outlives every use through `self.transpiler` in this fn body;
        // `_restore` (declared after `arena`/`log`, so dropped first) restores
        // `prev_arena` and `&self.config.log` before either local drops.
        // `with_mut` borrow is closure-scoped; no JS re-entry inside.
        let prev_arena = self.transpiler.with_mut(|t| {
            let prev = t.arena;
            // SAFETY: `arena` outlives every use through `t` — `_restore` below
            // restores `prev_arena` before `arena` drops (reverse-decl order).
            t.set_arena(unsafe { bun_ptr::detach_lifetime_ref(&arena) });
            t.set_log(&raw mut log);
            prev
        });
        let _restore = TranspilerStateGuard {
            transpiler: self.transpiler.as_ptr(),
            prev_arena,
            restore_log: self.config_log_ptr(),
            prev_macro_context: None,
        };

        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        let source = bun_ast::Source::init_path_string(loader.stdin_name(), code);
        let jsx = match self.config.get().tsconfig.as_deref() {
            Some(ts) => ts.merge_jsx(self.transpiler.get().options.jsx.clone()),
            None => self.transpiler.get().options.jsx.clone(),
        };

        let mut opts = bun_js_parser::ParserOptions::init(jsx, loader);
        // SAFETY: see `transpiler_mut`. The `&mut Transpiler` is reborrowed
        // disjointly for `macro_context` (stored in `opts`) and `options.define`
        // (raw-addr read) below; both end when `opts` is consumed by `scan()`.
        let transpiler = unsafe { self.transpiler_mut() };
        if transpiler.macro_context.is_none() {
            let mc = JSAst::Macro::MacroContext::init(transpiler);
            transpiler.macro_context = Some(mc);
        }
        opts.macro_context = transpiler.macro_context.as_mut();

        // `options.define` is `Box<Define>` owned by the long-lived `Transpiler`;
        // the parser borrows it for the arena lifetime.
        let define = &*transpiler.options.define;

        // NOTE: spec calls `transpiler.resolver.caches.js.scan`. The
        // resolver-side `cache::JavaScript` is a fieldless shell with
        // no `scan` body; the real `scan` lives on `bun_bundler::cache::JavaScript`.
        // Both are stateless unit structs, so calling the bundler-crate one
        // directly is equivalent.
        // SAFETY: `scan_pass_result` JsCell — `scan()` does not re-enter JS.
        let scan_result = bun_bundler::cache::JavaScript::init().scan(
            &arena,
            unsafe { self.scan_pass_result.get_mut() },
            opts,
            define,
            &mut log,
            &source,
        );

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
                self.config.get().trim_unused_imports.unwrap_or(false),
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
