//! `Bun.Transpiler` — single-file transform/scan over the JS parser.

/// `.classes.ts` payload (Arena + Transpiler + Config) — re-export from the
/// un-gated body so callers see `crate::api::js_transpiler::JSTranspiler`.
pub use _jsc_gated::JSTranspiler;
pub use _jsc_gated::{AsyncTransformTask, AsyncTransformEventLoopTask, Config, TransformTask};

/// Heuristic used by the REPL: returns true if `code` starts with `{` (after
/// whitespace) and doesn't end with `;` — i.e. should be wrapped in `()` to
/// parse as an object literal rather than a block statement. Mirrors Node.js.
pub fn is_likely_object_literal(code: &[u8]) -> bool {
    let mut start: usize = 0;
    while start < code.len()
        && matches!(code[start], b' ' | b'\t' | b'\n' | b'\r')
    {
        start += 1;
    }
    if start >= code.len() || code[start] != b'{' {
        return false;
    }
    let mut end: usize = code.len();
    while end > 0 && matches!(code[end - 1], b' ' | b'\t' | b'\n' | b'\r') {
        end -= 1;
    }
    !(end > 0 && code[end - 1] == b';')
}

mod _jsc_gated {
use std::io::Write as _;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_bundler::options::{self, Loader, PackagesOption, SourceMapOption, Target};
use bun_bundler::{self as Transpiler};
use bun_bundler::transpiler::{MacroJSCtx, ParseResult, ParseOptions};
use bun_core::Error;
use bun_jsc::{
    self as jsc, ArgumentsSlice, CallFrame, JSArrayIterator, JSGlobalObject, JSPromise,
    JSPropertyIterator, JSPropertyIteratorOptions, JSValue, JsError, JsResult, LogJsc, StringJsc,
    ComptimeStringMapExt,
};
use bun_jsc::zig_string::ZigString as JscZigString;
use bun_jsc::virtual_machine::VirtualMachine;
use crate::node::{Encoding, StringOrBuffer};
use bun_js_parser::runtime::Runtime;
use bun_js_parser::parser::ScanPassResult;
use bun_js_parser::ast::{self as JSAst, Expr};
use bun_js_parser::lexer as JSLexer;
use bun_js_printer as JSPrinter;
use bun_logger as logger;
use bun_options_types::{ImportRecord, ImportRecordFlags};
use bun_resolver::package_json::{MacroMap, PackageJSON};
use bun_resolver::tsconfig_json::TSConfigJSON;
// `bun_schema::api` → schema lives in `bun_options_types::schema::api`.
use bun_options_types::schema::api;
use bun_str::{String as BunString, ZigString};
use bun_collections::ArrayHashMapExt;

// TODO(port): `pub const js = jsc.Codegen.JSTranspiler;` and the toJS/fromJS/fromJSDirect
// aliases are wired by `#[bun_jsc::JsClass]` codegen — see PORTING.md §JSC types.

#[bun_jsc::JsClass(name = "Transpiler")]
pub struct JSTranspiler {
    pub transpiler: Transpiler::Transpiler<'static>,
    pub config: Config,
    pub scan_pass_result: ScanPassResult,
    pub buffer_writer: Option<JSPrinter::BufferWriter>,
    pub log_level: logger::Level,
    // TODO(port): non-AST crate keeps an arena field for bulk-freeing config strings.
    // Consider replacing with per-field Box ownership in Phase B.
    // Boxed so its address is stable across the move into `Box<JSTranspiler>` —
    // `transpiler.allocator` holds a `&'static Arena` pointing into it.
    pub arena: Box<Arena>,
    // Intrusive refcount field for `bun_ptr::IntrusiveRc<JSTranspiler>`.
    // TODO(port): LIFETIMES.tsv classifies the consumer (`TransformTask.js_instance`) as
    // `Arc<JSTranspiler>`, but `bun.ptr.RefCount` is single-thread intrusive and `*JSTranspiler`
    // crosses FFI as `m_ctx`. Reconcile in Phase B (likely IntrusiveRc, not Arc).
    pub ref_count: bun_ptr::RefCount<JSTranspiler>,
}

// `pub const ref/deref` from RefCount mixin → provided by `bun_ptr::IntrusiveRc<Self>`.
impl bun_ptr::RefCounted for JSTranspiler {
    type DestructorCtx = ();
    unsafe fn get_ref_count(this: *mut Self) -> *mut bun_ptr::RefCount<Self> {
        // SAFETY: caller contract — `this` points to a live Self.
        unsafe { &raw mut (*this).ref_count }
    }
    unsafe fn destructor(this: *mut Self, _ctx: ()) {
        // SAFETY: last ref dropped; allocated via Box in constructor().
        drop(unsafe { Box::from_raw(this) });
    }
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
            transform: default_transform_options(),
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

// ──────────────────────────────────────────────────────────────────────────
// Local shims for upstream `from_js` enum lookups (live in lower-tier crates
// without jsc dep). These bridge `phf::Map` → JS string lookup via the
// `ComptimeStringMapExt` extension trait from bun_jsc.
// ──────────────────────────────────────────────────────────────────────────

fn loader_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Loader>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    Loader::NAMES.from_js(global, value)
}

fn target_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Target>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    Target::MAP.from_js(global, value)
}

fn source_map_option_from_js(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<SourceMapOption>> {
    options::SOURCE_MAP_OPTION_MAP.from_js(global, value)
}

fn packages_option_from_js(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<PackagesOption>> {
    options::PACKAGES_OPTION_MAP.from_js(global, value)
}

fn level_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<logger::Level>> {
    logger::Level::MAP.from_js(global, value)
}

/// Deep-clone a [`MacroMap`]. Zig's `=` on `StringArrayHashMap` is a struct copy
/// that shares the backing slice; Rust's keys are `Box<[u8]>` so an owned copy
/// is needed wherever the spec assigns by value.
fn clone_macro_map(src: &MacroMap) -> MacroMap {
    let mut out = MacroMap::default();
    let _ = out.ensure_unused_capacity(src.count());
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
            return Err(global.throw_invalid_arguments("Expected an object"));
        }

        if let Some(define) = object.get_truthy(global, "define")? {
            'define: {
                if define.is_undefined_or_null() {
                    break 'define;
                }

                let Some(define_obj) = define.get_object() else {
                    return Err(
                        global.throw_invalid_arguments("define must be an object"),
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
                    let mut i: usize = 0;
                    while let Some(entry) = iter.next()? {
                        if !entry.js_type().is_string_like() {
                            return Err(global.throw_invalid_arguments(
                                "external must be a string or string[]",
                            ));
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
                    return Err(global.throw_invalid_arguments(
                        "external must be a string or string[]",
                    ));
                }
            }
        }

        if let Some(loader) = object.get(global, "loader")? {
            if let Some(resolved) = loader_from_js(global, loader)? {
                if !resolved.is_java_script_like() {
                    return Err(global.throw_invalid_arguments(
                        "only JavaScript-like loaders supported for now",
                    ));
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
                // `defer out.deref()` → Drop on bun_str::String

                if kind.is_array() {
                    return Err(global.throw_invalid_arguments(
                        "tsconfig must be a string or object",
                    ));
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
                let vm = unsafe { &mut *VirtualMachine::get() };
                if let Ok(Some(parsed_tsconfig)) = TSConfigJSON::parse(
                    &mut self.log,
                    &logger::Source::init_path_string(b"tsconfig.json", &self.tsconfig_buf[..]),
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
                        global.throw_invalid_arguments("macro must be an object"),
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
                    logger::Source::init_path_string(b"macros.json", &self.macros_buf[..]);
                // SAFETY: VirtualMachine::get() returns the live singleton on the JS thread.
                let vm = unsafe { &mut *VirtualMachine::get() };
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
                return Err(global.throw_invalid_arguments(
                    "Expected minify to be a boolean or an object",
                ));
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
                    return Err(global.throw_invalid_arguments(
                        "sourcemap must be one of \"inline\", \"linked\", \"external\", or \"none\"",
                    ));
                }
            }
        }

        if let Some(packages_value) = object.get(global, "packages")? {
            if let Some(packages) = packages_option_from_js(global, packages_value)? {
                self.transform.packages = Some(PackagesOption::to_api(Some(packages)));
            }
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
                    global.throw_invalid_arguments("exports must be an object"),
                );
            }

            let mut replacements = Runtime::ReplaceableExportMap::default();
            // errdefer replacements.clearAndFree(allocator) → Drop on error path

            if let Some(eliminate) = exports.get_truthy(global, "eliminate")? {
                if !eliminate.js_type().is_array() {
                    return Err(global.throw_invalid_arguments(
                        "exports.eliminate must be an array",
                    ));
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
                    let _ = replacements.ensure_unused_capacity(string_count as usize);
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
                                return Err(global.throw_invalid_arguments(
                                    "Error reading exports.eliminate. TODO: utf-16",
                                ));
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
                                    Runtime::ReplaceableExport::Delete,
                                );
                            }
                        }
                    }
                }
            }

            if let Some(replace) = exports.get_truthy(global, "replace")? {
                let Some(replace_obj) = replace.get_object() else {
                    return Err(
                        global.throw_invalid_arguments("replace must be an object"),
                    );
                };

                // SAFETY: `replace_obj` is non-null (just returned by get_object()).
                let replace_obj_ref = unsafe { &*replace_obj };
                let mut iter =
                    JSPropertyIterator::init(global, replace_obj_ref, PROP_ITER_OPTS)?;
                // defer iter.deinit() → Drop

                if iter.len > 0 {
                    let _ = replacements.ensure_unused_capacity(iter.len);

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
                                .put(&key, Runtime::ReplaceableExport::Replace(expr))
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
                                        Runtime::ReplaceableExport::Inject {
                                            name: replacement_name.into(),
                                            value: to_replace,
                                        },
                                    )
                                    .map_err(|_| bun_jsc::JsError::OutOfMemory)?;
                                continue;
                            }
                        }

                        return Err(global.throw_invalid_arguments(
                            "exports.replace values can only be string, null, undefined, number or boolean",
                        ));
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
                return Err(global.throw_invalid_arguments(
                    "logLevel must be one of \"verbose\", \"debug\", \"info\", \"warn\", or \"error\"",
                ));
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
    pub transpiler: Transpiler::Transpiler<'static>,
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
    pub replace_exports: Runtime::ReplaceableExportMap,
}

// TODO(port): `jsc::ConcurrentPromiseTask` is currently a non-generic stub_ty in
// src/jsc/event_loop.rs. When the real generic lands, restore
// `ConcurrentPromiseTask<TransformTask<'a>>` and its `EventLoopTask` assoc type.
pub type AsyncTransformTask = jsc::ConcurrentPromiseTask;
pub type AsyncTransformEventLoopTask = jsc::ConcurrentPromiseTask;

impl<'a> TransformTask<'a> {
    // `pub const new = bun.TrivialNew(@This())` → Box::new

    pub fn create(
        transpiler: &'a mut JSTranspiler,
        input_code: StringOrBuffer,
        global: &'a JSGlobalObject,
        loader: Loader,
    ) -> Box<AsyncTransformTask> {
        // TODO(port): `Transpiler` is not `Clone`; Zig copied the struct by-value.
        // Restore once `bun_bundler::Transpiler` derives Clone (or expose a
        // `dup()` helper). Same for `MacroMap` / `ReplaceableExportMap`.
        let _ = (transpiler, input_code, global, loader);
        todo!("blocked_on: bun_bundler::Transpiler::clone")
    }

    pub fn run(&mut self) {
        let name = self.loader.stdin_name();
        let source = logger::Source::init_path_string(name, self.input_code.slice());

        // PERF(port): was MimallocArena bulk-free — profile in Phase B.
        let arena = Arena::new();
        // defer arena.deinit() → Drop

        // TODO(port): ASTMemoryAllocator scope — typed_arena in AST crates; here we just
        // construct one and enter it. Model as RAII guard.
        let mut ast_memory_allocator = JSAst::ASTMemoryAllocator::new(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        // SAFETY: `arena` outlives every use through `self.transpiler` in this fn body;
        // Transpiler<'static> forces the borrow to 'static, so launder through a raw ptr.
        self.transpiler
            .set_allocator(unsafe { &*(&arena as *const Arena) });
        self.transpiler.set_log(&mut self.log);
        // self.log.msgs.allocator = bun.default_allocator → no-op

        // TODO(port): `bun_resolver::TSConfigJSON::merge_jsx` and
        // `bun_bundler::options_impl::jsx::Pragma` are currently distinct nominal
        // types. Reconcile in Phase B once the bundler re-exports the resolver's
        // Pragma (or vice versa).
        let jsx = self.transpiler.options.jsx.clone();
        let _ = self.tsconfig; // merge_jsx blocked — see above.

        let parse_options = ParseOptions {
            allocator: &arena,
            macro_remappings: MacroMap::default(), // TODO(port): blocked_on MacroMap::clone
            dirname_fd: bun_sys::Fd::INVALID,
            file_descriptor: None,
            loader: self.loader,
            jsx,
            path: source.path.clone(),
            virtual_source: Some(&source),
            replace_exports: Default::default(), // TODO(port): blocked_on ReplaceableExportMap::clone
            experimental_decorators: self.tsconfig.map_or(false, |ts| ts.experimental_decorators),
            emit_decorator_metadata: self.tsconfig.map_or(false, |ts| ts.emit_decorator_metadata),
            macro_js_ctx: core::ptr::null_mut(),
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
        let printed = match self
            .transpiler
            .print(parse_result, &mut printer, Transpiler::transpiler::PrintFormat::EsmAscii)
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

        if self.log.has_any() || self.err.is_some() {
            let error_value: JsResult<JSValue> = 'brk: {
                if let Some(err) = self.err {
                    if !self.log.has_any() {
                        // TODO(port): runtime::api::BuildMessage::create — see api.rs stub.
                        let _ = err;
                        todo!("blocked_on: bun_runtime::api::BuildMessage::create");
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

impl<'a> Drop for TransformTask<'a> {
    fn drop(&mut self) {
        // log.deinit() → logger::Log: Drop
        let mut input_code = core::mem::take(&mut self.input_code);
        input_code.deinit_and_unprotect();
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
    arena: &Arena,
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
        let zig_str = value.get_zig_string(global)?;
        let mut buf = Vec::new();
        write!(&mut buf, "{}", zig_str).expect("unreachable");
        // Zig allocPrint'd into the caller's arena. Bump-allocate so the bytes
        // live as long as the JSTranspiler arena that owns the resulting Expr;
        // `E::EString::init` erases the borrow to `'static` per the Phase-A
        // `Str` convention (see ast/E.rs).
        let data = arena.alloc_slice_copy(&buf);
        return Ok(Some(Expr::init(
            JSAst::E::EString::init(data),
            logger::Loc::EMPTY,
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
        log: logger::Log::init(),
        ..Default::default()
    };
    let arena = Box::new(Arena::new());
    // SAFETY: `arena` is heap-allocated and moved (as a Box) into `Box<JSTranspiler>` below;
    // its address is stable for the lifetime of the JSTranspiler. `Transpiler<'static>` forces
    // the borrow to 'static, so launder through a raw ptr.
    let arena_ref: &'static Arena = unsafe { &*(arena.as_ref() as *const Arena) };

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
            global.throw_value(config.log.to_js(global, "Failed to create transpiler")?),
        );
    }

    // SAFETY: VirtualMachine::get() returns the live singleton on the JS thread.
    let vm = unsafe { &mut *VirtualMachine::get() };
    let transpiler = match Transpiler::Transpiler::init(
        arena_ref,
        &mut config.log,
        config.transform.clone(),
        Some(vm.transpiler.env),
    ) {
        Ok(t) => t,
        Err(err) => {
            let log = &mut config.log;
            if (log.warnings + log.errors) > 0 {
                return Err(
                    global.throw_value(log.to_js(global, "Failed to create transpiler")?),
                );
            }
            return Err(global.throw_error(err, "Error creating transpiler"));
        }
    };

    let mut this: Box<JSTranspiler> = Box::new(JSTranspiler {
        config,
        arena,
        transpiler,
        scan_pass_result: ScanPassResult::init(),
        buffer_writer: None,
        log_level: logger::Level::Err,
        ref_count: bun_ptr::RefCount::init(),
    });
    // errdefer past this point → `this: Box<_>` drops and runs Drop for JSTranspiler.

    // PORT NOTE: reshaped for borrowck — split-borrow `config` and `transpiler` from the Box.
    let config = &this.config;
    let transpiler = &mut this.transpiler;
    transpiler.options.no_macros = config.no_macros;
    transpiler.configure_linker_with_auto_jsx(false);
    transpiler.options.env.behavior = options::EnvBehavior::disable;
    if let Err(err) = transpiler.configure_defines() {
        let log = &mut this.config.log;
        if (log.warnings + log.errors) > 0 {
            return Err(global.throw_value(log.to_js(global, "Failed to load define")?));
        }
        return Err(global.throw_error(err, "Failed to load define"));
    }

    if config.macro_map.count() > 0 {
        // TODO(port): `MacroMap` (StringArrayHashMap<StringArrayHashMap<&[u8]>>) is not
        // Clone — Zig copied it by-value. Once StringArrayHashMap derives Clone restore:
        //   transpiler.options.macro_remap = config.macro_map.clone();
        todo!("blocked_on: bun_collections::StringArrayHashMap::clone");
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

    pub fn finalize(this: *mut JSTranspiler) {
        // SAFETY: called by JSC codegen on the mutator thread with the m_ctx payload.
        unsafe { <JSTranspiler as bun_ptr::AnyRefCounted>::rc_deref_with_context(this, ()) };
    }
}

impl Drop for JSTranspiler {
    fn drop(&mut self) {
        // SAFETY: `transpiler.log` is a *mut Log set via `set_log` to a live Log.
        if !self.transpiler.log.is_null() {
            unsafe { (*self.transpiler.log).clear_and_free() };
        }
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

        let source = logger::Source::init_path_string(name, &processed_code[..]);

        // TODO(port): `merge_jsx` Pragma type mismatch — see TransformTask::run.
        let jsx = self.transpiler.options.jsx.clone();
        let _ = &self.config.tsconfig;

        let parse_options = ParseOptions {
            allocator: arena,
            macro_remappings: MacroMap::default(), // TODO(port): blocked_on MacroMap::clone
            dirname_fd: bun_sys::Fd::INVALID,
            file_descriptor: None,
            loader: loader.unwrap_or(self.config.default_loader),
            jsx,
            path: source.path.clone(),
            virtual_source: Some(&source),
            replace_exports: Default::default(), // TODO(port): blocked_on ReplaceableExportMap::clone
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

        self.transpiler.parse(parse_options, None)
    }

    #[bun_jsc::host_fn(method)]
    pub fn scan(&mut self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding();
        let arguments = callframe.arguments_old::<3>();
        // SAFETY: bun_vm() returns the live VM singleton on this thread.
        let vm = unsafe { &*global.bun_vm() };
        let mut args = ArgumentsSlice::init(vm, arguments.slice());
        // defer args.deinit() → Drop
        let Some(code_arg) = args.next() else {
            return Err(global.throw_invalid_argument_type("scan", "code", "string or Uint8Array"));
        };

        let Some(code_holder) = StringOrBuffer::from_js(global, code_arg)?
        else {
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
        let prev_allocator = self.transpiler.allocator;
        // SAFETY: `arena` outlives every use through `self.transpiler` in this fn body;
        // allocator is restored to `prev_allocator` before return.
        self.transpiler
            .set_allocator(unsafe { &*(&arena as *const Arena) });
        let mut log = logger::Log::init();
        // defer log.deinit() → Drop
        self.transpiler.set_log(&mut log);
        // TODO(port): errdefer — restore log/allocator on every exit. Phase B: scopeguard
        // captures &mut self; borrowck conflict with body. For now, restore at tail only.

        let mut ast_memory_allocator = JSAst::ASTMemoryAllocator::new(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        let parse_result =
            self.get_parse_result(&arena, code, loader, core::ptr::null_mut());
        // SAFETY: `transpiler.log` was just set to `&mut log` above.
        let log_ref = unsafe { &mut *self.transpiler.log };
        let Some(mut parse_result) = parse_result else {
            if (log_ref.warnings + log_ref.errors) > 0 {
                return Err(global.throw_value(log_ref.to_js(global, "Parse error")?));
            }
            return Err(global.throw("Failed to parse"));
        };

        if (log_ref.warnings + log_ref.errors) > 0 {
            return Err(global.throw_value(log_ref.to_js(global, "Parse error")?));
        }

        let exports_label = ZigString::static_(b"exports");
        let imports_label = ZigString::static_(b"imports");
        let named_imports_value = named_imports_to_js(
            global,
            parse_result.ast.import_records.slice(),
            self.config.trim_unused_imports.unwrap_or(false),
        )?;

        let named_exports_value = named_exports_to_js(global, &mut parse_result.ast.named_exports)?;

        // Restore log/allocator before returning.
        self.transpiler.set_log(&mut self.config.log);
        self.transpiler.allocator = prev_allocator;

        JSValue::create_object2(
            global,
            &imports_label,
            &exports_label,
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
        jsc::mark_binding();
        let arguments = callframe.arguments_old::<3>();
        // SAFETY: bun_vm() returns the live VM singleton on this thread.
        let vm = unsafe { &*global.bun_vm() };
        let mut args = ArgumentsSlice::init(vm, arguments.slice());
        // defer args.arena.deinit() → Drop
        let Some(code_arg) = args.next() else {
            return Err(
                global.throw_invalid_argument_type("transform", "code", "string or Uint8Array"),
            );
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
            return Err(
                global.throw_invalid_argument_type("transform", "code", "string or Uint8Array"),
            );
        };
        // errdefer code.deinitAndUnprotect() — TransformTask takes ownership; on early error
        // before that, Drop on `code` runs deinit_and_unprotect.
        // TODO(port): ensure StringOrBuffer::drop calls deinit_and_unprotect.

        args.eat();
        let loader: Option<Loader> = 'brk: {
            if let Some(arg) = args.next() {
                args.eat();
                break 'brk loader_from_js(global, arg)?;
            }
            break 'brk None;
        };

        let _task = TransformTask::create(
            self,
            code,
            global,
            loader.unwrap_or(self.config.default_loader),
        );
        // TODO(port): ConcurrentPromiseTask is a stub — `schedule()` / `.promise` not yet wired.
        todo!("blocked_on: bun_jsc::ConcurrentPromiseTask::schedule")
    }

    #[bun_jsc::host_fn(method)]
    pub fn transform_sync(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding();
        let arguments = callframe.arguments_old::<3>();

        // SAFETY: bun_vm() returns the live VM singleton on this thread.
        let vm = unsafe { &*global.bun_vm() };
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

        let mut ast_memory_allocator = JSAst::ASTMemoryAllocator::new(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        // TODO(port): `Transpiler` is not Clone; Zig copied it by-value to restore on exit.
        // For now, save/restore only allocator + log.
        let prev_allocator = self.transpiler.allocator;
        // SAFETY: `arena` outlives every use through `self.transpiler` in this fn body;
        // allocator is restored to `prev_allocator` before return.
        self.transpiler
            .set_allocator(unsafe { &*(&arena as *const Arena) });
        self.transpiler.macro_context = None;
        let mut log = logger::Log::init();
        log.level = self.config.log.level;
        self.transpiler.set_log(&mut log);

        // TODO(port): errdefer — scopeguard captures &mut self; borrowck conflict with body.
        // Phase B: restructure restore into explicit assignment at every return.

        // MacroJSCtx is `*mut ()` cycle-break placeholder; thread the JSValue
        // through once the bundler accepts it directly.
        let _ = js_ctx_value;
        let parse_result = self.get_parse_result(&arena, code, loader, core::ptr::null_mut());
        // SAFETY: `transpiler.log` was just set to `&mut log` above.
        let log_ref = unsafe { &mut *self.transpiler.log };
        let Some(parse_result) = parse_result else {
            if (log_ref.warnings + log_ref.errors) > 0 {
                return Err(global.throw_value(log_ref.to_js(global, "Parse error")?));
            }
            return Err(global.throw("Failed to parse code"));
        };

        if (log_ref.warnings + log_ref.errors) > 0 {
            return Err(global.throw_value(log_ref.to_js(global, "Parse error")?));
        }

        let mut buffer_writer = self.buffer_writer.take().unwrap_or_else(|| {
            let mut writer = JSPrinter::BufferWriter::init();
            let _ = writer.buffer.grow_if_needed(code.len());
            // Zig: `writer.buffer.list.expandToCapacity()` — Vec<u8> can grow lazily; skip.
            writer
        });

        // defer { this.buffer_writer = buffer_writer } — handled below at every exit
        // TODO(port): restore buffer_writer to self on early returns too.

        buffer_writer.reset();
        let mut printer = JSPrinter::BufferPrinter::init(buffer_writer);
        if let Err(err) = self
            .transpiler
            .print(parse_result, &mut printer, Transpiler::transpiler::PrintFormat::EsmAscii)
        {
            self.buffer_writer = Some(printer.ctx);
            return Err(global.throw_error(err, "Failed to print code"));
        }

        // TODO: benchmark if pooling this way is faster or moving is faster
        buffer_writer = printer.ctx;
        let mut out = JscZigString::init(buffer_writer.written());
        out.set_output_encoding();

        let result = out.to_js(global);
        self.buffer_writer = Some(buffer_writer);
        // Restore log/allocator.
        self.transpiler.set_log(&mut self.config.log);
        self.transpiler.allocator = prev_allocator;
        Ok(result)
    }
}

fn named_exports_to_js(
    global: &JSGlobalObject,
    named_exports: &mut JSAst::ast::NamedExports,
) -> JsResult<JSValue> {
    if named_exports.count() == 0 {
        return JSValue::create_empty_array(global, 0);
    }

    // PERF(port): was stack-fallback allocator — profile in Phase B
    let mut names: Vec<BunString> = Vec::with_capacity(named_exports.count());
    // TODO(port): Zig sorted in-place via `StringArrayByIndexSorter`; `StringArrayHashMap`
    // lacks `.sort`. Iterate unsorted for now and sort the output Vec instead.
    let mut named_exports_iter = named_exports.iterator();
    while let Some(entry) = named_exports_iter.next() {
        names.push(BunString::from_bytes(&**entry.key_ptr));
    }
    // TODO(port): `bun_str::String::to_js_array` — use the free fn in bun_jsc.
    bun_string_to_js_array(global, &names)
}

/// Local shim for `bun.String.toJSArray` — `bun_jsc::bun_string_jsc` (the inline
/// module re-exported at the crate root) does not yet expose `to_js_array`.
// TODO(port): drop once `bun_jsc::bun_string_jsc::to_js_array` is re-exported.
fn bun_string_to_js_array(global: &JSGlobalObject, array: &[BunString]) -> JsResult<JSValue> {
    unsafe extern "C" {
        fn BunString__createArray(
            global_object: *mut JSGlobalObject,
            ptr: *const BunString,
            len: usize,
        ) -> JSValue;
    }
    // SAFETY: ptr/len from a live slice; `global` borrowed for the call duration.
    let v = unsafe { BunString__createArray(global.as_ptr(), array.as_ptr(), array.len()) };
    if global.has_exception() { Err(JsError::Thrown) } else { Ok(v) }
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
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        // SAFETY: bun_vm() returns the live VM singleton on this thread.
        let vm = unsafe { &*global.bun_vm() };
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

        let mut loader: Loader = self.config.default_loader;
        if let Some(arg) = args.next() {
            if let Some(l) = loader_from_js(global, arg)? {
                loader = l;
            }
            args.eat();
        }

        if !loader.is_java_script_like() {
            return Err(global.throw_invalid_arguments(
                "Only JavaScript-like files support this fast path",
            ));
        }

        // PERF(port): was MimallocArena bulk-free — profile in Phase B
        let arena = Arena::new();
        let prev_allocator = self.transpiler.allocator;
        let mut ast_memory_allocator = JSAst::ASTMemoryAllocator::new(&arena);
        let _ast_scope = ast_memory_allocator.enter();

        // SAFETY: `arena` outlives every use through `self.transpiler` in this fn body;
        // allocator is restored to `prev_allocator` before return.
        self.transpiler
            .set_allocator(unsafe { &*(&arena as *const Arena) });
        let mut log = logger::Log::init();
        // defer log.deinit() → Drop
        self.transpiler.set_log(&mut log);
        // TODO(port): errdefer — restore log/allocator on every exit; Phase B scopeguard.

        let source = logger::Source::init_path_string(loader.stdin_name(), code);
        // TODO(port): `merge_jsx` Pragma type mismatch — see TransformTask::run.
        let _ = &self.config.tsconfig;
        let _ = source;
        let _ = prev_allocator;

        // TODO(port): `bun_resolver::cache::JavaScript::scan` and
        // `bun_js_parser::Parser::Options::init` are not yet wired in Phase A.
        let _ = (&mut self.scan_pass_result, &mut log);
        todo!("blocked_on: bun_resolver::cache::JavaScript::scan");

        #[allow(unreachable_code)]
        {
            if (log.warnings + log.errors) > 0 {
                return Err(global.throw_value(log.to_js(global, "Failed to scan imports")?));
            }

            let named_imports_value = named_imports_to_js(
                global,
                self.scan_pass_result.import_records.as_slice(),
                self.config.trim_unused_imports.unwrap_or(false),
            )?;
            self.scan_pass_result.reset();
            self.transpiler.set_log(&mut self.config.log);
            self.transpiler.allocator = prev_allocator;
            Ok(named_imports_value)
        }
    }
}

#[allow(dead_code)]
const _: fn() = || {
    // keep PackageJSON import live for Phase-B `parse_macros_json` wiring
    let _ = core::mem::size_of::<PackageJSON>();
};

} // mod _jsc_gated

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/JSTranspiler.zig (1228 lines)
//   confidence: medium
//   todos:      30+
//   notes:      LIFETIMES.tsv lists Arc<JSTranspiler> but ported as IntrusiveRc per §Pointers (reconcile); several `defer`/restore blocks need scopeguard borrowck reshaping; arena field retained in non-AST crate. Multiple upstream blockers: Transpiler/MacroMap not Clone, ConcurrentPromiseTask stub, JSValue::create_object2 missing, jsx::Pragma type split between resolver/bundler.
// ──────────────────────────────────────────────────────────────────────────
