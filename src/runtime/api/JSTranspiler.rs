//! `Bun.Transpiler` — single-file transform/scan over the JS parser.

use bun_alloc::ArenaVecExt as _;
use bun_collections::{ByteVecExt, VecExt};
use bun_options_types::{LoaderExt as _, TargetExt as _};
use std::io::Write as _;

use crate::node::{Encoding, StringOrBuffer};
use bun_alloc::{Arena, ArenaVec}; // bumpalo::Bump / bumpalo::collections::Vec re-exports
use bun_ast::Expr;
use bun_ast::Loader;
use bun_ast::{ImportRecord, ImportRecordFlags};
use bun_bundler::options::{self, PackagesOption, SourceMapOption};
use bun_bundler::transpiler::{MacroJSCtx, ParseOptions, ParseResult};
use bun_bundler::{self as Transpiler};
use bun_core::Error;
use bun_js_parser::lexer as JSLexer;
use bun_js_parser::parser::Runtime;
use bun_js_parser::parser::ScanPassResult;
use bun_js_parser::{self as JSAst};
use bun_js_printer as JSPrinter;
use bun_jsc::ZigStringJsc as _;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::zig_string::ZigString as JscZigString;
use bun_jsc::{
    self as jsc, ArgumentsSlice, CallFrame, ComptimeStringMapExt, JSArrayIterator, JSGlobalObject,
    JSPromise, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, JsCell, JsError, JsResult,
    LogJsc, StringJsc,
};
use bun_resolver::package_json::{MacroMap, PackageJSON};
use bun_resolver::tsconfig_json::TSConfigJSON;
// `bun_schema::api` → schema lives in `bun_options_types::schema::api`.
use bun_collections::ArrayHashMapExt;
use bun_core::{String as BunString, ZigString};
use bun_options_types::schema::api;

// TODO(port): `pub const js = jsc.Codegen.JSTranspiler;` and the toJS/fromJS/fromJSDirect
// aliases are wired by `#[bun_jsc::JsClass]` codegen — see PORTING.md §JSC types.

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `JsCell` (= `UnsafeCell` projector). The codegen
// shim still emits `this: &mut JSTranspiler` until Phase 1 lands — `&mut T`
// auto-derefs to `&T` so the impls below compile against either. `JsCell` is
// `#[repr(transparent)]`, so field offsets are unchanged.
#[bun_jsc::JsClass(name = "Transpiler")]
#[derive(bun_ptr::RefCounted)]
pub struct JSTranspiler {
    pub transpiler: JsCell<Transpiler::Transpiler<'static>>,
    /// Read-only after construction EXCEPT for `config.log`, which is the
    /// resting-state log that `transpiler.log: *mut Log` points at between
    /// host-fn calls. `JsCell` so a `*mut Log` can be projected from `&self`.
    pub config: JsCell<Config>,
    pub scan_pass_result: JsCell<ScanPassResult>,
    pub buffer_writer: JsCell<Option<JSPrinter::BufferWriter>>,
    pub log_level: bun_ast::Level,
    // TODO(port): non-AST crate keeps an arena field for bulk-freeing config strings.
    // Consider replacing with per-field Box ownership in Phase B.
    // Boxed so its address is stable across the move into `Box<JSTranspiler>` —
    // `transpiler.arena` holds a `&'static Arena` pointing into it.
    pub arena: Box<Arena>,
    // Intrusive refcount field for `bun_ptr::IntrusiveRc<JSTranspiler>`.
    // TODO(port): LIFETIMES.tsv classifies the consumer (`TransformTask.js_instance`) as
    // `Arc<JSTranspiler>`, but `bun.ptr.RefCount` is single-thread intrusive and `*JSTranspiler`
    // crosses FFI as `m_ctx`. Reconcile in Phase B (likely IntrusiveRc, not Arc).
    pub ref_count: bun_ptr::RefCount<JSTranspiler>,
}

fn default_transform_options() -> api::TransformOptions {
    let mut opts: api::TransformOptions = api::TransformOptions::default();
    opts.disable_hmr = true;
    opts.target = Some(api::Target::Browser);
    opts
}

pub struct Config {
    pub transform: api::TransformOptions,
    pub default_loader: Loader,
    pub macro_map: MacroMap,
    pub tsconfig: Option<Box<TSConfigJSON>>,
    pub tsconfig_buf: Box<[u8]>,
    pub macros_buf: Box<[u8]>,
    pub log: bun_ast::Log,
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
            transform: default_transform_options(),
            default_loader: Loader::Jsx,
            macro_map: MacroMap::default(),
            tsconfig: None,
            tsconfig_buf: Box::default(),
            macros_buf: Box::default(),
            log: bun_ast::Log::default(), // overwritten at construction
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

// ──────────────────────────────────────────────────────────────────────────
// `from_js` enum lookups for `Loader`/`Target`. The canonical port of
// `bundler_jsc/options_jsc.zig` lives in `bun_bundler_jsc::options_jsc` and
// carries the spec'd error semantics (throw `TypeError` on non-string / unknown
// loader). The earlier local shims here only did a bare `phf` lookup and
// silently returned `None` for unknown loaders, breaking
// `transpiler-utf16-loader.test.ts`.
// ──────────────────────────────────────────────────────────────────────────

use bun_bundler_jsc::options_jsc::{loader_from_js, target_from_js};

fn source_map_option_from_js(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<SourceMapOption>> {
    options::SOURCE_MAP_OPTION_MAP.from_js(global, value)
}

fn level_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<bun_ast::Level>> {
    bun_ast::Level::MAP.from_js(global, value)
}

/// Deep-clone a [`MacroMap`]. Zig's `=` on `StringArrayHashMap` is a struct copy
/// that shares the backing slice; Rust's keys are `Box<[u8]>` so an owned copy
/// is needed wherever the spec assigns by value.
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
    // PORT NOTE: out-param constructor kept as `&mut self` because `self` is a pre-initialized
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

                // SAFETY: `define_obj` is a non-null *mut JSObject (just returned by get_object()).
                let define_obj_ref = unsafe { &*define_obj };
                let mut define_iter =
                    JSPropertyIterator::init(global, define_obj_ref, PROP_ITER_OPTS)?;
                // `defer define_iter.deinit()` → Drop

                // `define_iter.i` is the property position, not a dense index of yielded
                // entries. With `skip_empty_name = true` (or a skipped property getter),
                // writing at `define_iter.i` would leave earlier slots uninitialized.
                // Use Vecs so the stored slice is always exactly what was appended.
                let mut names: Vec<Box<[u8]>> = Vec::new();
                let mut values: Vec<Box<[u8]>> = Vec::new();
                names.reserve_exact(define_iter.len);
                values.reserve_exact(define_iter.len);

                while let Some(prop) = define_iter.next()? {
                    let property_value = define_iter.value;
                    let value_type = property_value.js_type();

                    if !value_type.is_string_like() {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "define \"{}\" must be a JSON string",
                            prop
                        )));
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

                    let mut externals: Vec<Box<[u8]>> = Vec::with_capacity(count as usize);
                    let mut iter = external.array_iterator(global)?;
                    while let Some(entry) = iter.next()? {
                        if !entry.js_type().is_string_like() {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "external must be a string or string[]",
                            )));
                        }

                        let mut zig_str = ZigString::init(b"");
                        entry.to_zig_string(&mut zig_str, global)?;
                        if zig_str.len == 0 {
                            continue;
                        }
                        let mut buf = Vec::new();
                        write!(&mut buf, "{}", zig_str).expect("unreachable");
                        externals.push(buf.into_boxed_slice());
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
                let mut out = BunString::empty();
                // `defer out.deref()` → Drop on bun_core::String

                if kind.is_array() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "tsconfig must be a string or object",
                    )));
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
                self.macros_buf = out.to_owned_slice().into();
                let source =
                    bun_ast::Source::init_path_string(b"macros.json", &self.macros_buf[..]);
                // SAFETY: VirtualMachine::get() returns the live singleton on the JS thread.
                let vm = VirtualMachine::get().as_mut();
                let Ok(Some(json)) = vm.transpiler.resolver.caches.json.parse_json(
                    &mut self.log,
                    &source,
                    bun_resolver::tsconfig_json::JsonMode::Json,
                    false,
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
                            let str = value.get_zig_string(global)?;
                            if str.len == 0 {
                                continue;
                            }
                            // Spec uses `std.fmt.bufPrint` into the fixed spare capacity
                            // (sized from UTF-16 code-unit lengths) and throws on overflow.
                            // `write!` on a `Vec` would silently grow instead, so check the
                            // bound explicitly to preserve the spec's overflow throw.
                            let start = buf.len();
                            write!(&mut buf, "{}", str).ok();
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
                                // PERF(port): was putAssumeCapacity — profile in Phase B
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

                // SAFETY: `replace_obj` is non-null (just returned by get_object()).
                let replace_obj_ref = unsafe { &*replace_obj };
                let mut iter = JSPropertyIterator::init(global, replace_obj_ref, PROP_ITER_OPTS)?;
                // defer iter.deinit() → Drop

                if iter.len > 0 {
                    bun_core::handle_oom(replacements.ensure_unused_capacity(iter.len));

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

                        let key: Vec<u8> = key_.to_owned_slice();

                        if !JSLexer::is_identifier(&key) {
                            // allocator.free(key) → drop(key)
                            return Err(global.throw_invalid_arguments(format_args!(
                                "\"{}\" is not a valid ECMAScript identifier",
                                bstr::BStr::new(&key)
                            )));
                        }

                        // PERF(port): was getOrPutAssumeCapacity — profile in Phase B.
                        // PORT NOTE: reshaped — `StringArrayHashMap::get_or_put` is gated on
                        // `V: Default` upstream and `ReplaceableExport` has no Default. Compute
                        // the value first, then `put` (which upserts without needing a default
                        // slot). The Zig getOrPut left the slot uninitialized on the error path
                        // anyway, so this is strictly safer.
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
                                // errdefer slice.deinit() → Drop
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

            tree_shaking = Some(tree_shaking.unwrap_or(replacements.count() > 0));
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

// Legacy alias for backwards compatibility during migration

// Mimalloc gets unstable if we try to move this to a different thread
// threadlocal var transform_buffer: bun.MutableString = undefined;
// threadlocal var transform_buffer_loaded: bool = false;

// This is going to be hard to not leak
pub struct TransformTask<'a> {
    /// Created with `is_async=true` (JS-backed buffer protected); the
    /// [`bun_jsc::ThreadSafe`] guard unprotects on drop.
    pub input_code: bun_jsc::ThreadSafe<StringOrBuffer>,
    pub output_code: BunString,
    /// Bitwise copy of `js_instance.transpiler` (Zig: `= transpiler.transpiler`).
    /// Heap-owned fields (`Box<Define>`, resolver caches, …) are *shared* with
    /// `js_instance`, which is kept alive by the `IntrusiveRc` below for the
    /// task's lifetime. `ManuallyDrop` prevents double-free; the original owns.
    pub transpiler: core::mem::ManuallyDrop<Transpiler::Transpiler<'static>>,
    // TODO(port): LIFETIMES.tsv says Arc<JSTranspiler> — reconcile. JSTranspiler uses
    // single-thread intrusive `bun.ptr.RefCount` and crosses FFI as `m_ctx`, so per
    // PORTING.md §Pointers this must be IntrusiveRc, not Arc.
    pub js_instance: bun_ptr::IntrusiveRc<JSTranspiler>,
    pub log: bun_ast::Log,
    pub err: Option<Error>,
    pub macro_map: MacroMap,
    pub tsconfig: Option<&'a TSConfigJSON>,
    pub loader: Loader,
    pub global: &'a JSGlobalObject,
    pub replace_exports: bun_ast::runtime::ReplaceableExportMap,
}

pub type AsyncTransformTask<'a> =
    jsc::concurrent_promise_task::ConcurrentPromiseTask<'a, TransformTask<'a>>;
// Zig: `AsyncTransformTask.EventLoopTask` — same wrapper type at this tier.
pub type AsyncTransformEventLoopTask<'a> = AsyncTransformTask<'a>;

impl<'a> jsc::concurrent_promise_task::ConcurrentPromiseTaskContext for TransformTask<'a> {
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::AsyncTransformTask;
    fn run(&mut self) {
        TransformTask::run(self)
    }
    fn then(&mut self, promise: &mut JSPromise) -> Result<(), bun_jsc::JsTerminated> {
        TransformTask::then(self, promise)
    }
}

impl<'a> TransformTask<'a> {
    // `pub const new = bun.TrivialNew(@This())` → Box::new

    pub fn create(
        transpiler: &'a JSTranspiler,
        input_code: bun_jsc::ThreadSafe<StringOrBuffer>,
        global: &'a JSGlobalObject,
        loader: Loader,
    ) -> Box<AsyncTransformTask<'a>> {
        let config = transpiler.config.get();
        let mut log = bun_ast::Log::init();
        log.level = config.log.level;

        // SAFETY: bitwise struct copy mirroring Zig's by-value
        // `transform_task.transpiler = transpiler.transpiler`. Heap-owned fields
        // are shared with `js_instance` (kept alive via IntrusiveRc); the copy is
        // wrapped in `ManuallyDrop` so only the original frees them.
        let transpiler_copy = core::mem::ManuallyDrop::new(unsafe {
            core::ptr::read(transpiler.transpiler.as_ptr())
        });

        let mut transform_task = Box::new(TransformTask {
            input_code,
            output_code: BunString::empty(),
            transpiler: transpiler_copy,
            global,
            macro_map: clone_macro_map(&config.macro_map),
            tsconfig: config.tsconfig.as_deref(),
            log,
            err: None,
            loader,
            replace_exports: bun_ast::runtime::ReplaceableExportMap {
                entries: config.runtime.replace_exports.entries.clone().expect("OOM"),
            },
            // SAFETY: `transpiler` is the live `m_ctx` payload; `init_ref` bumps the
            // `Cell<u32>`-backed count (Zig: `transpiler.ref()`). `as_ctx_ptr`
            // yields `*mut Self` from `&Self` — signature-only; the only mutation
            // is to the `RefCount` field, which is interior-mutable.
            js_instance: unsafe { bun_ptr::IntrusiveRc::init_ref(transpiler.as_ctx_ptr()) },
        });

        // Zig: `transform_task.transpiler.linker.resolver = &transform_task.transpiler.resolver`
        // — re-point the linker's resolver backref into the heap-allocated copy.
        // Must happen AFTER the move into the Box so the address is stable.
        let resolver_ptr: *mut _ = &raw mut transform_task.transpiler.resolver;
        transform_task.transpiler.linker.resolver = resolver_ptr;
        transform_task
            .transpiler
            .set_log(&raw mut transform_task.log);
        // `set_arena(bun.default_allocator)` — Rust `Transpiler` carries an
        // `&Arena`, not a generic allocator. The work-thread `run()` immediately
        // overwrites it with the local arena, so leave the copied pointer as-is
        // here (it still points at `js_instance.arena`, which is kept alive).

        AsyncTransformTask::create_on_js_thread(global, transform_task)
    }

    pub fn run(&mut self) {
        let name = self.loader.stdin_name();
        let source = bun_ast::Source::init_path_string(name, self.input_code.slice());

        // PERF(port): was MimallocArena bulk-free — profile in Phase B.
        let arena = Arena::new();
        // defer arena.deinit() → Drop

        // TODO(port): ASTMemoryAllocator scope — typed_arena in AST crates; here we just
        // construct one and enter it. Model as RAII guard.
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::new(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        // SAFETY: `arena` outlives every use through `self.transpiler` in this fn body;
        // Transpiler<'static> forces the borrow to 'static, so launder through a raw ptr.
        self.transpiler
            .set_arena(unsafe { bun_ptr::detach_lifetime_ref(&arena) });
        self.transpiler.set_log(&raw mut self.log);
        // self.log.msgs.allocator = bun.default_allocator → no-op

        let jsx = match self.tsconfig {
            Some(ts) => ts
                .merge_jsx(self.transpiler.options.jsx.clone().into())
                .into(),
            None => self.transpiler.options.jsx.clone(),
        };

        let parse_options = ParseOptions {
            arena: &arena,
            macro_remappings: clone_macro_map(&self.macro_map),
            dirname_fd: bun_sys::Fd::INVALID,
            file_descriptor: None,
            loader: self.loader,
            jsx,
            path: source.path.clone(),
            virtual_source: Some(&source),
            replace_exports: self.replace_exports.entries.clone().expect("OOM"),
            experimental_decorators: self.tsconfig.map_or(false, |ts| ts.experimental_decorators),
            emit_decorator_metadata: self.tsconfig.map_or(false, |ts| ts.emit_decorator_metadata),
            macro_js_ctx: MacroJSCtx::ZERO,
            file_hash: None,
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
        let printed = match self.transpiler.print(
            parse_result,
            &mut printer,
            Transpiler::transpiler::PrintFormat::EsmAscii,
        ) {
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

        if self.log.has_any() || self.err.is_some() {
            let error_value: JsResult<JSValue> = 'brk: {
                if let Some(err) = self.err {
                    if !self.log.has_any() {
                        break 'brk bun_jsc::BuildMessage::create(
                            self.global,
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
            Err(e) => promise.reject(self.global, Ok(self.global.take_exception(e))),
        }
    }
}

// `Drop for TransformTask` is implicit:
//   log.deinit() → bun_ast::Log: Drop
//   input_code → ThreadSafe<StringOrBuffer>: unprotect + Drop
//   output_code.deref() → BunString: Drop
//   tsconfig is owned by JSTranspiler, not by TransformTask — JSTranspiler::drop handles it.
//   js_instance.deref() → IntrusiveRc::drop
//   bun.destroy(this) → Box drop by owner

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
            data: bun_ast::ExprData::ENumber(bun_ast::E::Number {
                value: value.as_number(),
            }),
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
        let zig_str = value.get_zig_string(global)?;
        let mut buf = Vec::new();
        write!(&mut buf, "{}", zig_str).expect("unreachable");
        // Zig allocPrint'd into the caller's arena. Bump-allocate so the bytes
        // live as long as the JSTranspiler arena that owns the resulting Expr;
        // `E::EString::init` erases the borrow to `'static` per the Phase-A
        // `Str` convention (see ast/E.rs).
        let data = arena.alloc_slice_copy(&buf);
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
    pub fn constructor(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<*mut JSTranspiler> {
        let arguments = callframe.arguments_old::<3>();

        // PORT NOTE: reshaped — Zig allocates `this` first with `transpiler = undefined` and
        // assigns it later. Rust cannot leave a non-POD field uninitialized in a live Box
        // (zeroed()/assume_init() on Transpiler is UB), so build `config` + `transpiler` on the
        // stack first, then move both into the Box.
        // TODO(port): in-place init — if Phase B needs the Box allocated up-front (e.g. stable
        // address for resolver backrefs), switch the field to `MaybeUninit<Transpiler>`.
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

        let config_arg = if arguments.len > 0 {
            arguments.ptr[0]
        } else {
            JSValue::UNDEFINED
        };
        config.from_js(global, config_arg, arena_ref)?;

        if global.has_exception() {
            return Err(bun_jsc::JsError::Thrown);
        }

        if (config.log.warnings + config.log.errors) > 0 {
            return Err(
                global.throw_value(config.log.to_js(global, "Failed to create transpiler")?)
            );
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
                    return Err(
                        global.throw_value(log.to_js(global, "Failed to create transpiler")?)
                    );
                }
                return Err(global.throw_error(err, "Error creating transpiler"));
            }
        };

        let this: Box<JSTranspiler> = Box::new(JSTranspiler {
            config: JsCell::new(config),
            arena,
            transpiler: JsCell::new(transpiler),
            scan_pass_result: JsCell::new(ScanPassResult::init()),
            buffer_writer: JsCell::new(None),
            log_level: bun_ast::Level::Err,
            ref_count: bun_ptr::RefCount::init(),
        });
        // errdefer past this point → `this: Box<_>` drops and runs Drop for JSTranspiler.

        // PORT NOTE: reshaped — Zig allocated `this` on the heap FIRST and passed `&this.config.log`
        // into `Transpiler::init`, giving a stable address. We built `config` on the stack and
        // moved it into the Box, so `transpiler.log` (a `*mut Log`) still points at the moved-from
        // stack slot. Re-point it at the heap-stable field now that the Box exists.
        // SAFETY: `this: Box<_>` is exclusively owned (init-time, before the JS
        // wrapper exists) so projecting `&mut`/`*mut` from the JsCells is trivially
        // alias-free.
        let config = unsafe { this.config.get_mut() };
        let transpiler = unsafe { this.transpiler.get_mut() };
        transpiler.set_log(&raw mut config.log);

        transpiler.options.no_macros = config.no_macros;
        transpiler.configure_linker_with_auto_jsx(false);
        transpiler.options.env.behavior = options::EnvBehavior::disable;
        if let Err(err) = transpiler.configure_defines() {
            let log = &mut config.log;
            if (log.warnings + log.errors) > 0 {
                return Err(global.throw_value(log.to_js(global, "Failed to load define")?));
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

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }
}

impl Drop for JSTranspiler {
    fn drop(&mut self) {
        // SAFETY: `transpiler.log` is a *mut Log set via `set_log` to a live Log.
        let log = self.transpiler.get().log;
        if !log.is_null() {
            unsafe { (*log).clear_and_free() };
        }
        // scan_pass_result.{named_imports,import_records,used_symbols}.deinit() → field Drop
        // buffer_writer.?.buffer.deinit() → Option<BufferWriter>: Drop
        // config.tsconfig.deinit() → Option<Box<TSConfigJSON>>: Drop
        // arena.deinit() → Arena: Drop
        // bun.destroy(this) → handled by Box owner / IntrusiveRc.
    }
}

/// RAII guard mirroring Zig's
/// `defer { setLog(&this.config.log); setAllocator(prev); arena.deinit(); }`
/// (and `transformSync`'s full-snapshot `defer { this.transpiler = prev_bundler; }`).
///
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
            transpiler.macro_context = prev;
        }
    }
}

impl JSTranspiler {
    // ─── R-2 interior-mutability helpers ─────────────────────────────────────

    /// `self`'s address as `*mut Self` for `IntrusiveRc::init_ref` and similar
    /// FFI ctx slots that spell the parameter `*mut`. The only mutation through
    /// this pointer goes to `ref_count` (`Cell<u32>`-backed) or `JsCell` fields,
    /// so no write provenance on the outer `JSTranspiler` is required.
    #[inline]
    fn as_ctx_ptr(&self) -> *mut Self {
        (self as *const Self).cast_mut()
    }

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
    /// the inner `Transpiler` is re-borrowed — a pre-existing spec-level hazard
    /// (Zig holds a raw `*Transpiler` across the same call) that R-2's
    /// outer-struct fix does not address. The R-2 invariant this upholds is
    /// that no `noalias &mut JSTranspiler` is live across that re-entry.
    #[inline]
    unsafe fn transpiler_mut(&self) -> &mut Transpiler::Transpiler<'static> {
        unsafe { self.transpiler.get_mut() }
    }

    // ─────────────────────────────────────────────────────────────────────────

    fn get_parse_result(
        &self,
        arena: &Arena,
        code: &[u8],
        loader: Option<Loader>,
        macro_js_ctx: MacroJSCtx,
    ) -> Option<ParseResult> {
        let config = self.config.get();
        let name = config.default_loader.stdin_name();

        // In REPL mode, wrap potential object literals in parentheses
        // If code starts with { and doesn't end with ; it might be an object literal
        // that would otherwise be parsed as a block statement
        //
        // Zig: `allocPrint(allocator, "({s})", .{code}) catch code` — allocated in the
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

        let source = bun_ast::Source::init_path_string(name, processed_code);

        let jsx = match config.tsconfig.as_deref() {
            Some(ts) => ts
                .merge_jsx(self.transpiler.get().options.jsx.clone().into())
                .into(),
            None => self.transpiler.get().options.jsx.clone(),
        };

        let parse_options = ParseOptions {
            arena: arena,
            macro_remappings: clone_macro_map(&config.macro_map),
            dirname_fd: bun_sys::Fd::INVALID,
            file_descriptor: None,
            loader: loader.unwrap_or(config.default_loader),
            jsx,
            path: source.path.clone(),
            virtual_source: Some(&source),
            replace_exports: config.runtime.replace_exports.entries.clone().expect("OOM"),
            macro_js_ctx,
            experimental_decorators: config
                .tsconfig
                .as_deref()
                .map_or(false, |ts| ts.experimental_decorators),
            emit_decorator_metadata: config
                .tsconfig
                .as_deref()
                .map_or(false, |ts| ts.emit_decorator_metadata),
            file_hash: None,
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

    #[bun_jsc::host_fn(method)]
    pub fn scan(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding();
        let arguments = callframe.arguments_old::<3>();
        // SAFETY: bun_vm() returns the live VM singleton on this thread.
        let vm = global.bun_vm();
        let mut args = ArgumentsSlice::init(vm, arguments.slice());
        // defer args.deinit() → Drop
        let Some(code_arg) = args.next() else {
            return Err(global.throw_invalid_argument_type("scan", "code", "string or Uint8Array"));
        };

        let Some(code_holder) = StringOrBuffer::from_js(global, code_arg)? else {
            return Err(global.throw_invalid_argument_type("scan", "code", "string or Uint8Array"));
        };
        // defer code_holder.deinit() → Drop
        let code = code_holder.slice();
        args.eat();

        let loader: Option<Loader> = 'brk: {
            if let Some(arg) = args.next() {
                args.eat();
                break 'brk loader_from_js(global, arg)?;
            }
            break 'brk None;
        };

        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }

        // PERF(port): was MimallocArena bulk-free — profile in Phase B
        let arena = Arena::new();
        let mut log = bun_ast::Log::init();
        // defer log.deinit() → Drop
        // SAFETY: `arena` outlives every use through `self.transpiler` in this fn body;
        // `_restore` (declared after `arena`/`log`, so dropped first) restores
        // `prev_arena` and `&self.config.log` before either local drops.
        // `with_mut` borrow is closure-scoped; no JS re-entry inside.
        let prev_arena = self.transpiler.with_mut(|t| {
            let prev = t.arena;
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

        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::new(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        let parse_result = self.get_parse_result(&arena, code, loader, MacroJSCtx::ZERO);
        let log_ref = self.transpiler.get().log_mut();
        let Some(mut parse_result) = parse_result else {
            if (log_ref.warnings + log_ref.errors) > 0 {
                return Err(global.throw_value(log_ref.to_js(global, "Parse error")?));
            }
            return Err(global.throw(format_args!("Failed to parse")));
        };

        if (log_ref.warnings + log_ref.errors) > 0 {
            return Err(global.throw_value(log_ref.to_js(global, "Parse error")?));
        }

        let exports_label = ZigString::static_(b"exports");
        let imports_label = ZigString::static_(b"imports");
        let named_imports_value = named_imports_to_js(
            global,
            parse_result.ast.import_records.slice(),
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

    #[bun_jsc::host_fn(method)]
    pub fn transform(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding();
        let arguments = callframe.arguments_old::<3>();
        // SAFETY: bun_vm() returns the live VM singleton on this thread.
        let vm = global.bun_vm();
        let mut args = ArgumentsSlice::init(vm, arguments.slice());
        // defer args.arena.deinit() → Drop
        let Some(code_arg) = args.next() else {
            return Err(global.throw_invalid_argument_type(
                "transform",
                "code",
                "string or Uint8Array",
            ));
        };

        let allow_string_object = true;
        let Some(code) = StringOrBuffer::from_js_with_encoding_maybe_async(
            global,
            code_arg,
            Encoding::Utf8,
            true,
            allow_string_object,
        )?
        else {
            return Err(global.throw_invalid_argument_type(
                "transform",
                "code",
                "string or Uint8Array",
            ));
        };
        // `errdefer code.deinitAndUnprotect()` — `from_js_with_encoding_maybe_async`
        // (is_async=true) already protected; adopt into a `ThreadSafe` so any
        // early-return drop unprotects. `TransformTask::create` takes the guard.
        let code = bun_jsc::ThreadSafe::adopt(code);

        args.eat();
        let loader: Option<Loader> = 'brk: {
            if let Some(arg) = args.next() {
                args.eat();
                break 'brk loader_from_js(global, arg)?;
            }
            break 'brk None;
        };

        let default_loader = self.config.get().default_loader;
        let mut task = TransformTask::create(self, code, global, loader.unwrap_or(default_loader));
        let promise = task.promise.value();
        task.schedule();
        // Ownership passes to the work pool / event loop; freed via
        // `ConcurrentPromiseTask::destroy` on the `.manual_deinit` path.
        let _ = bun_core::heap::into_raw(task);
        Ok(promise)
    }

    #[bun_jsc::host_fn(method)]
    pub fn transform_sync(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding();
        let arguments = callframe.arguments_old::<3>();

        // SAFETY: bun_vm() returns the live VM singleton on this thread.
        let vm = global.bun_vm();
        let mut args = ArgumentsSlice::init(vm, arguments.slice());
        // defer args.arena.deinit() → Drop
        let Some(code_arg) = args.next() else {
            return Err(global.throw_invalid_argument_type(
                "transformSync",
                "code",
                "string or Uint8Array",
            ));
        };

        // PERF(port): was MimallocArena bulk-free — profile in Phase B
        let arena = Arena::new();
        let Some(code_holder) = StringOrBuffer::from_js(global, code_arg)? else {
            return Err(global.throw_invalid_argument_type(
                "transformSync",
                "code",
                "string or Uint8Array",
            ));
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

        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::new(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        // PORT NOTE: spec snapshots the WHOLE `this.transpiler` by value
        // (`prev_bundler = this.transpiler`) and restores it on exit. `Transpiler` is not
        // bitwise-copyable in Rust, so explicitly snapshot the fields the body mutates
        // (`allocator`, `log`, `macro_context`) and restore them via RAII guard.
        let mut log = bun_ast::Log::init();
        log.level = self.config.get().log.level;
        // SAFETY: `arena` outlives every use through `self.transpiler` in this fn body;
        // `_restore` (declared after `arena`/`log`, so dropped first) restores
        // `prev_arena`, `&self.config.log`, and `prev_macro_context` before either drops.
        // `with_mut` borrow is closure-scoped; no JS re-entry inside.
        let (prev_arena, prev_macro_context) = self.transpiler.with_mut(|t| {
            let prev_arena = t.arena;
            // `take()` both reads the prior value AND nulls it (spec: `macro_context = null`).
            let prev_mc = t.macro_context.take();
            t.set_arena(unsafe { bun_ptr::detach_lifetime_ref(&arena) });
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
        let parse_result = self.get_parse_result(&arena, code, loader, macro_js_ctx);
        let log_ref = self.transpiler.get().log_mut();
        let Some(parse_result) = parse_result else {
            if (log_ref.warnings + log_ref.errors) > 0 {
                return Err(global.throw_value(log_ref.to_js(global, "Parse error")?));
            }
            return Err(global.throw(format_args!("Failed to parse code")));
        };

        if (log_ref.warnings + log_ref.errors) > 0 {
            return Err(global.throw_value(log_ref.to_js(global, "Parse error")?));
        }

        let mut buffer_writer = self.buffer_writer.replace(None).unwrap_or_else(|| {
            let mut writer = JSPrinter::BufferWriter::init();
            bun_core::handle_oom(writer.buffer.grow_if_needed(code.len()));
            // Zig: `writer.buffer.list.expandToCapacity()` — Vec<u8> can grow lazily; skip.
            writer
        });

        // defer { this.buffer_writer = buffer_writer } — only the print-error and tail
        // paths reach past this point; both write `Some(..)` back explicitly.

        buffer_writer.reset();
        let mut printer = JSPrinter::BufferPrinter::init(buffer_writer);
        // SAFETY: see `transpiler_mut` — `print` does not re-enter JS.
        if let Err(err) = unsafe { self.transpiler_mut() }.print(
            parse_result,
            &mut printer,
            Transpiler::transpiler::PrintFormat::EsmAscii,
        ) {
            self.buffer_writer.set(Some(printer.ctx));
            return Err(global.throw_error(err, "Failed to print code"));
        }

        // TODO: benchmark if pooling this way is faster or moving is faster
        buffer_writer = printer.ctx;
        let mut out = JscZigString::init(buffer_writer.written());
        out.set_output_encoding();

        let result = out.to_js(global);
        self.buffer_writer.set(Some(buffer_writer));
        Ok(result)
    }
}

fn named_exports_to_js(
    global: &JSGlobalObject,
    named_exports: &mut bun_ast::ast_result::NamedExports,
) -> JsResult<JSValue> {
    if named_exports.count() == 0 {
        return JSValue::create_empty_array(global, 0);
    }

    // PERF(port): was stack-fallback allocator — profile in Phase B
    // PORT NOTE: Zig sorted the map in-place via `StringArrayByIndexSorter` then iterated.
    // `StringArrayHashMap` in Rust has no in-place sort, so collect the keys, sort them
    // lexicographically (matching `strings.order`), then emit `BunString`s in that order.
    let mut keys: Vec<&[u8]> = Vec::with_capacity(named_exports.count());
    let mut named_exports_iter = named_exports.iterator();
    while let Some(entry) = named_exports_iter.next() {
        keys.push(&**entry.key_ptr);
    }
    keys.sort_unstable();

    let names: Vec<BunString> = keys.into_iter().map(BunString::from_bytes).collect();
    bun_jsc::bun_string_jsc::to_js_array(global, &names)
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
        let path = JscZigString::init(record.path.text.as_ref()).to_js(global);
        let kind = JscZigString::init(record.kind.label()).to_js(global);
        let entry = JSValue::create_object2(global, &path_label, &kind_label, path, kind)?;
        array.put_index(global, i, entry)?;
        i += 1;
    }

    Ok(array)
}

impl JSTranspiler {
    #[bun_jsc::host_fn(method)]
    pub fn scan_imports(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        // SAFETY: bun_vm() returns the live VM singleton on this thread.
        let vm = global.bun_vm();
        let mut args = ArgumentsSlice::init(vm, arguments.slice());
        // defer args.deinit() → Drop

        let Some(code_arg) = args.next() else {
            return Err(global.throw_invalid_argument_type(
                "scanImports",
                "code",
                "string or Uint8Array",
            ));
        };

        let code_holder = match StringOrBuffer::from_js(global, code_arg)? {
            Some(h) => h,
            None => {
                if !global.has_exception() {
                    return Err(global.throw_invalid_argument_type(
                        "scanImports",
                        "code",
                        "string or Uint8Array",
                    ));
                }
                return Ok(JSValue::ZERO);
            }
        };
        args.eat();
        // defer code_holder.deinit() → Drop
        let code = code_holder.slice();

        let mut loader: Loader = self.config.get().default_loader;
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

        // PERF(port): was MimallocArena bulk-free — profile in Phase B
        let arena = Arena::new();
        let mut log = bun_ast::Log::init();
        // defer log.deinit() → Drop
        // SAFETY: `arena` outlives every use through `self.transpiler` in this fn body;
        // `_restore` (declared after `arena`/`log`, so dropped first) restores
        // `prev_arena` and `&self.config.log` before either local drops.
        // `with_mut` borrow is closure-scoped; no JS re-entry inside.
        let prev_arena = self.transpiler.with_mut(|t| {
            let prev = t.arena;
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

        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::new(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        let source = bun_ast::Source::init_path_string(loader.stdin_name(), code);
        let jsx = match self.config.get().tsconfig.as_deref() {
            Some(ts) => ts
                .merge_jsx(self.transpiler.get().options.jsx.clone().into())
                .into(),
            None => self.transpiler.get().options.jsx.clone(),
        };

        let mut opts = bun_js_parser::ParserOptions::init(jsx.into(), loader);
        // SAFETY: see `transpiler_mut`. The `&mut Transpiler` is reborrowed
        // disjointly for `macro_context` (stored in `opts`) and `options.define`
        // (raw-addr read) below; both end when `opts` is consumed by `scan()`.
        let transpiler = unsafe { self.transpiler_mut() };
        if transpiler.macro_context.is_none() {
            let mc = JSAst::Macro::MacroContext::init(transpiler);
            transpiler.macro_context = Some(mc);
        }
        opts.macro_context = transpiler.macro_context.as_mut();

        // SAFETY: `options.define` is `Box<Define>` owned by the long-lived
        // `Transpiler`; the parser borrows it for the arena lifetime. Erase to
        // satisfy `JavaScript::scan`'s `&'a Define` param (Zig held `*const Define`).
        let define = unsafe { &*(&raw const *transpiler.options.define) };

        // PORT NOTE: spec calls `transpiler.resolver.caches.js.scan`. The
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

        // Zig: `defer this.scan_pass_result.reset()` covers every exit past this
        // point (including the catch arm and the `try namedImportsToJS` error
        // path). Compute the result, then reset unconditionally before returning.
        let result = (|| -> JsResult<JSValue> {
            if let Err(err) = scan_result {
                if (log.warnings + log.errors) > 0 {
                    return Err(global.throw_value(log.to_js(global, "Failed to scan imports")?));
                }
                return Err(global.throw_error(err, "Failed to scan imports"));
            }

            if (log.warnings + log.errors) > 0 {
                return Err(global.throw_value(log.to_js(global, "Failed to scan imports")?));
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
pub fn is_likely_object_literal(code: &[u8]) -> bool {
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

// ported from: src/runtime/api/JSTranspiler.zig
