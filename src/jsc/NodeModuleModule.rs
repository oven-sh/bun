use crate::{
    self as jsc, ErrorableString, JSArray, JSGlobalObject, JSValue, JsError, JsResult, StringJsc,
    Strong, VirtualMachineRef as VirtualMachine,
};
use bun_alloc::Arena;
use bun_ast::Loader;
use bun_bundler::options::DEFAULT_LOADERS;
use bun_bundler::transpiler::{MacroJSCtx, ParseOptions, Transpiler};
use bun_core::{OwnedString, String as BunString, strings};
use bun_js_printer as JSPrinter;
use bun_options_types::LoaderExt as _;
use bun_options_types::schema::api;
use bun_resolver::package_json::MacroMap as MacroRemap;

// `bun.schema.api.Loader` — bindgen-emitted schema enum.
// Mirrored as a transparent `u8` because the schema enum is *open*
// and the FFI caller may hand us discriminants outside
// the closed Rust `api::Loader` set; transmuting an unknown tag would be UB.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) struct ApiLoader(pub u8);
impl ApiLoader {
    /// `_none = 254`.
    pub(crate) const NONE: Self = Self(api::Loader::_none as u8);

    /// Reconstruct the closed schema enum. Only valid when `self != NONE` is
    /// already established and the C++ caller honoured the `BunLoaderType`
    /// contract (headers-handwritten.h keeps the discriminants in sync).
    fn to_schema(self) -> api::Loader {
        debug_assert_ne!(self, Self::NONE);
        // C++ caller passes a valid `BunLoaderType` discriminant per
        // headers-handwritten.h; `from_raw` maps unknowns to `_none`.
        api::Loader::from_raw(self.0)
    }
}

// The C++ caller (NodeModuleModule.cpp
// `jsFunctionFindPath`) does the CallFrame → (BunString, JSArray*) extraction itself and
// invokes this with the coerced args directly — there is no CallFrame here.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn NodeModuleModule__findPath(
    global: &JSGlobalObject,
    request_bun_str: BunString,
    paths_maybe: *mut JSArray,
) -> JSValue {
    // `JSArray` is an `opaque_ffi!` ZST handle; `opaque_ref` is the centralised
    // non-null-ZST deref proof. Nullable per the C++ caller contract.
    let paths_maybe: Option<&JSArray> =
        (!paths_maybe.is_null()).then(|| JSArray::opaque_ref(paths_maybe));
    jsc::host_fn::to_js_host_call(global, || find_path(global, request_bun_str, paths_maybe))
}

// https://github.com/nodejs/node/blob/40ef9d541ed79470977f90eb445c291b95ab75a0/lib/internal/modules/cjs/loader.js#L666
fn find_path(
    global: &JSGlobalObject,
    request_bun_str: BunString,
    paths_maybe: Option<&JSArray>,
) -> JsResult<JSValue> {
    let request_slice = request_bun_str.to_utf8();
    let request = request_slice.slice();

    let absolute_request = bun_paths::is_absolute(request);
    if !absolute_request && paths_maybe.is_none() {
        return Ok(JSValue::FALSE);
    }

    // for each path
    let mut found = if let Some(paths) = paths_maybe {
        'found: {
            let mut iter = paths.iterator(global)?;
            while let Some(path) = iter.next()? {
                // `OwnedString` releases the +1 from `from_js` on drop.
                let cur_path = OwnedString::new(BunString::from_js(path, global)?);

                if let Some(found) = find_path_inner(request_bun_str, cur_path.get(), global) {
                    break 'found Some(found);
                }
            }

            break 'found None;
        }
    } else {
        find_path_inner(request_bun_str, BunString::static_(b""), global)
    };

    if let Some(str) = found.as_mut() {
        return str.transfer_to_js(global);
    }

    Ok(JSValue::FALSE)
}

fn find_path_inner(
    request: BunString,
    cur_path: BunString,
    global: &JSGlobalObject,
) -> Option<BunString> {
    // SAFETY: zero-init is the documented `ErrorableString` "empty" state; the
    // callee fully overwrites it on both ok/err paths.
    let mut errorable: ErrorableString = unsafe { bun_core::ffi::zeroed_unchecked() };
    // `bun_core::String` is `Copy` — passing by value makes no refcount change.
    match VirtualMachine::resolve_maybe_needs_trailing_slash::<true>(
        &mut errorable,
        global,
        request,
        cur_path,
        None,
        false,
        true,
    ) {
        Ok(()) => {}
        Err(JsError::Thrown) => {
            // TODO sus — clears the pending exception here.
            global.clear_exception();
            return None;
        }
        Err(_) => return None,
    }
    errorable.unwrap().ok()
}

pub fn _stat(path: &[u8]) -> i32 {
    // PERF: `exists_at_type`
    // takes a `&ZStr`, so we copy into a NUL-terminated heap buffer here.
    let zpath = bun_core::ZBox::from_bytes(path);
    match bun_sys::exists_at_type(bun_sys::Fd::cwd(), &zpath) {
        Ok(bun_sys::ExistsAtType::File) => 0, // Returns 0 for files.
        Ok(bun_sys::ExistsAtType::Directory) => 1, // Returns 1 for directories.
        Err(_) => -1, // Returns a negative integer for any other kind of strings.
    }
}

// The C++ caller (NodeModuleModule.cpp `jsFunctionStripTypeScriptTypes`)
// validates the arguments Node-style and passes plain coerced data.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn NodeModuleModule__stripTypeScriptTypes(
    global: &JSGlobalObject,
    code: BunString,
    transform_mode: bool,
    source_map: bool,
    source_url: BunString,
) -> JSValue {
    jsc::host_fn::to_js_host_call(global, || {
        strip_typescript_types(global, code, transform_mode, source_map, source_url)
    })
}

/// `module.stripTypeScriptTypes(code, options)`: transpile a TypeScript
/// source string with Bun's transpiler.
///
/// In `'strip'` mode (`transform_mode == false`), TypeScript syntax with
/// runtime semantics (enums, instantiated namespaces, parameter properties,
/// `import =`, `export =`) throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, and an
/// identifier-named `module` declaration throws in both modes, matching
/// Node's amaro/swc contract. Unlike Node, the output is re-printed from the
/// AST rather than blanked in place, so original line/column positions are
/// not preserved and comments are dropped.
fn strip_typescript_types(
    global: &JSGlobalObject,
    code: BunString,
    transform_mode: bool,
    source_map: bool,
    source_url: BunString,
) -> JsResult<JSValue> {
    let mut log = bun_ast::Log::init();
    let arena = Arena::new();
    // SAFETY: `arena` outlives every use through `transpiler` in this fn body;
    // `Transpiler<'static>` forces the borrow to 'static, so launder through a
    // raw ptr (same pattern as JSTranspiler / TransformTask).
    let arena_ref: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(&arena) };

    // SAFETY: VirtualMachine::get() returns the live singleton on the JS thread.
    let vm = crate::virtual_machine::VirtualMachine::get().as_mut();

    let transform = api::TransformOptions {
        // `using` / `await using` are only kept verbatim (not lowered) when
        // targeting Bun; JavaScriptCore implements them natively.
        target: Some(api::Target::Bun),
        ..Default::default()
    };
    let mut transpiler =
        match Transpiler::init(arena_ref, &raw mut log, transform, Some(vm.transpiler.env)) {
            Ok(t) => t,
            Err(err) => return Err(global.throw_error(err, "Failed to create transpiler")),
        };
    // `parse()` lazily allocates `macro_context`, whose `data` pointer is
    // only freed by an explicit `deinit()`; this one-shot transpiler must
    // reclaim it on every return path (mirrors `TransformTask::run`).
    let _macro_ctx_guard =
        scopeguard::guard(core::ptr::addr_of_mut!(transpiler.macro_context), |slot| {
            // SAFETY: `slot` points at the stack-owned `transpiler`, which is
            // still alive when this guard drops (declared after it), and the
            // parser's `&mut MacroContext` borrow ended with `parse()`.
            if let Some(ctx) = unsafe { (*slot).take() } {
                ctx.deinit();
            }
        });
    // `LoadAllWithoutInlining` skips the implicit `process.env.NODE_ENV` /
    // `process.env.BUN_ENV` / `process.browser` defines, so `process.env.*`
    // reads survive the transform verbatim.
    transpiler.options.env.behavior = api::DotEnvBehavior::LoadAllWithoutInlining;
    transpiler.options.env.disable_default_env_files = true;
    if let Err(err) = transpiler.configure_defines() {
        return Err(global.throw_error(err, "Failed to configure transpiler"));
    }
    // A plain type-stripping transform: no macros, no dead-code elimination,
    // no import trimming (Node keeps value imports even when only used as
    // types), no minification.
    transpiler.options.no_macros = true;
    transpiler.options.dead_code_elimination = false;
    transpiler.options.tree_shaking = false;
    transpiler.options.trim_unused_imports = Some(false);
    transpiler.options.inlining = false;
    transpiler.options.minify_whitespace = false;
    transpiler.options.minify_syntax = false;
    transpiler.options.minify_identifiers = false;
    transpiler.options.auto_import_jsx = false;
    transpiler.options.transform_only = false;
    transpiler.options.hot_module_reloading = false;
    transpiler.options.react_fast_refresh = false;

    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();

    // Borrowed view; must stay alive until printing finishes because the
    // arena-allocated `Source` (and AST string slices) point into it.
    let code_utf8 = code.to_utf8();
    let source: &bun_ast::Source = arena_ref.alloc(bun_ast::Source::init_path_string(
        Loader::Ts.stdin_name(),
        code_utf8.slice(),
    ));

    let parse_options = ParseOptions {
        arena: arena_ref,
        macro_remappings: MacroRemap::default(),
        dirname_fd: bun_sys::Fd::INVALID,
        file_descriptor: None,
        loader: Loader::Ts,
        jsx: transpiler.options.jsx.clone(),
        path: source.path,
        virtual_source: Some(source),
        replace_exports: Default::default(),
        experimental_decorators: false,
        emit_decorator_metadata: false,
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

    let parse_result = transpiler.parse(parse_options, None);

    if log.errors > 0 {
        // Node maps parser errors to ERR_INVALID_TYPESCRIPT_SYNTAX (a
        // SyntaxError); the message text comes from Bun's parser.
        let text: &[u8] = log
            .msgs
            .iter()
            .find(|m| matches!(m.kind, bun_ast::Kind::Err))
            .map(|m| m.data.text.as_ref())
            .unwrap_or(b"Failed to parse TypeScript");
        return Err(jsc::ErrorCode::ERR_INVALID_TYPESCRIPT_SYNTAX
            .throw(global, format_args!("{}", String::from_utf8_lossy(text))));
    }
    let Some(parse_result) = parse_result else {
        return Err(jsc::ErrorCode::ERR_INVALID_TYPESCRIPT_SYNTAX
            .throw(global, format_args!("Failed to parse TypeScript")));
    };

    // amaro rejects the `module` keyword in both modes.
    if parse_result.ast.uses_ts_module_keyword {
        return Err(jsc::ErrorCode::ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.throw(
            global,
            format_args!("`module` keyword is not supported. Use `namespace` instead."),
        ));
    }
    if !transform_mode {
        if let Some(kind) = parse_result.ast.ts_runtime_syntax {
            let what = match kind {
                bun_ast::TsRuntimeSyntax::Enum => "TypeScript enum",
                bun_ast::TsRuntimeSyntax::Namespace => "TypeScript namespace declaration",
                bun_ast::TsRuntimeSyntax::ParameterProperty => "TypeScript parameter property",
                bun_ast::TsRuntimeSyntax::ImportEquals => "TypeScript import equals declaration",
                bun_ast::TsRuntimeSyntax::ExportAssignment => "TypeScript export assignment",
            };
            return Err(jsc::ErrorCode::ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.throw(
                global,
                format_args!("{what} is not supported in strip-only mode"),
            ));
        }
    }

    let was_empty = parse_result.empty;
    let mut printer = JSPrinter::BufferPrinter::init(JSPrinter::BufferWriter::init());
    let mut map_vlq = bun_core::MutableString::init_empty();
    if !was_empty {
        if source_map {
            let mut capture = VlqCapture { vlq: &mut map_vlq };
            let handler = JSPrinter::SourceMapHandler::for_(&mut capture);
            if let Err(err) = transpiler.print_with_source_map(
                &arena,
                parse_result,
                &mut printer,
                JSPrinter::Format::EsmAscii,
                handler,
                None,
            ) {
                return Err(global.throw_error(err, "Failed to print code"));
            }
        } else if let Err(err) = transpiler.print(
            &arena,
            parse_result,
            &mut printer,
            JSPrinter::Format::EsmAscii,
        ) {
            return Err(global.throw_error(err, "Failed to print code"));
        }
    }
    let printed: &[u8] = printer.ctx.written();

    let source_url_utf8 = source_url.to_utf8();
    let mut out: Vec<u8> = Vec::with_capacity(printed.len() + 64);
    out.extend_from_slice(printed);
    if source_map {
        // Node's shape: {"version":3,"sources":[<sourceUrl>],"names":[],
        // "mappings":"..."}; an empty input produces "sources":[].
        let mut json = bun_core::MutableString::init_empty();
        bun_core::handle_oom(json.append(b"{\"version\":3,\"sources\":["));
        if !was_empty {
            bun_core::handle_oom(bun_core::quote_for_json(
                source_url_utf8.slice(),
                &mut json,
                true,
            ));
        }
        bun_core::handle_oom(json.append(b"],\"names\":[],\"mappings\":"));
        bun_core::handle_oom(bun_core::quote_for_json(
            map_vlq.list.as_slice(),
            &mut json,
            true,
        ));
        bun_core::handle_oom(json.append(b"}"));

        out.extend_from_slice(b"\n\n//# sourceMappingURL=data:application/json;base64,");
        let json_bytes = json.list.as_slice();
        let old_len = out.len();
        out.resize(old_len + bun_base64::encode_len(json_bytes), 0);
        let written = bun_base64::encode(&mut out[old_len..], json_bytes);
        out.truncate(old_len + written);
    } else if !source_url_utf8.slice().is_empty() {
        out.extend_from_slice(b"\n\n//# sourceURL=");
        out.extend_from_slice(source_url_utf8.slice());
    }

    let mut result = BunString::clone_utf8(&out);
    result.transfer_to_js(global)
}

struct VlqCapture<'m> {
    vlq: &'m mut bun_core::MutableString,
}

impl JSPrinter::OnSourceMapChunk for VlqCapture<'_> {
    fn on_source_map_chunk(
        &mut self,
        chunk: bun_sourcemap::Chunk,
        _source: &bun_ast::Source,
    ) -> Result<(), bun_core::Error> {
        // Target is Bun, so `chunk.buffer` holds an InternalSourceMap blob;
        // re-encode it to a standard VLQ "mappings" string. An empty buffer
        // (source-map feature flag disabled) yields empty mappings.
        if !chunk.buffer.list.is_empty() {
            let ism = bun_sourcemap::InternalSourceMap {
                data: chunk.buffer.list.as_ptr(),
            };
            ism.append_vlq_to(self.vlq);
        }
        Ok(())
    }
}

pub enum CustomLoader {
    Loader(Loader),
    Custom(Strong),
}

impl Default for CustomLoader {
    /// Placeholder for `StringArrayHashMap::get_or_put` — overwritten
    /// immediately when `!found_existing`.
    fn default() -> Self {
        CustomLoader::Loader(Loader::default())
    }
}

// `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle; remaining
// params are by-value `JSValue`/scalars → `safe fn`.
unsafe extern "C" {
    pub safe fn JSCommonJSExtensions__appendFunction(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> u32;
    pub safe fn JSCommonJSExtensions__setFunction(
        global: &JSGlobalObject,
        index: u32,
        value: JSValue,
    );
    /// Returns the index of the last value, which must have it's references updated to `index`
    pub safe fn JSCommonJSExtensions__swapRemove(global: &JSGlobalObject, index: u32) -> u32;
}

// Memory management is complicated because JSValues are stored in gc-visitable
// WriteBarriers in C++ but the hash map for extensions is in Rust for flexibility.
fn on_require_extension_modify(
    global: &JSGlobalObject,
    str: &[u8],
    loader: ApiLoader,
    value: JSValue,
) -> Result<(), bun_alloc::AllocError> {
    // global; we are on the JS thread so a `&mut` view is sound for this scope.
    let vm = global.bun_vm().as_mut();
    let is_built_in = DEFAULT_LOADERS.get(str).is_some();

    let gop = vm.commonjs_custom_extensions.get_or_put(str)?;
    if !gop.found_existing {
        // `gop.key_ptr` already owns a duped `Box<[u8]>` (StringArrayHashMap
        // boxes the key on insert).
        if is_built_in {
            vm.has_mutated_built_in_extensions += 1;
        }

        *gop.value_ptr = if loader != ApiLoader::NONE {
            CustomLoader::Loader(Loader::from_api(loader.to_schema()))
        } else {
            CustomLoader::Custom(Strong::create(value, global))
        };
    } else if loader != ApiLoader::NONE {
        // Replacing with a built-in loader: drop any held Strong via assignment.
        *gop.value_ptr = CustomLoader::Loader(Loader::from_api(loader.to_schema()));
    } else {
        match gop.value_ptr {
            CustomLoader::Loader(_) => {
                *gop.value_ptr = CustomLoader::Custom(Strong::create(value, global));
            }
            CustomLoader::Custom(strong) => strong.set(global, value),
        }
    }

    // PERF: the resolver's
    // `extra_cjs_extensions` is owned `Box<[Box<[u8]>]>`, so we clone the keys.
    vm.transpiler.resolver.opts.extra_cjs_extensions = vm
        .commonjs_custom_extensions
        .keys()
        .to_vec()
        .into_boxed_slice();
    Ok(())
}

fn on_require_extension_modify_non_function(
    global: &JSGlobalObject,
    str: &[u8],
) -> Result<(), bun_alloc::AllocError> {
    // SAFETY: see `on_require_extension_modify`.
    let vm = global.bun_vm().as_mut();
    let is_built_in = DEFAULT_LOADERS.get(str).is_some();

    if let Some(prev) = vm.commonjs_custom_extensions.fetch_swap_remove(str) {
        // `prev.key: Box<[u8]>` — freed on drop.
        if is_built_in {
            vm.has_mutated_built_in_extensions -= 1;
        }
        // `prev.value` drops here, releasing any held `Strong`.
        drop(prev);
    }

    // PERF: see `on_require_extension_modify`.
    vm.transpiler.resolver.opts.extra_cjs_extensions = vm
        .commonjs_custom_extensions
        .keys()
        .to_vec()
        .into_boxed_slice();
    Ok(())
}

pub fn find_longest_registered_extension<'a>(
    vm: &'a VirtualMachine,
    filename: &[u8],
) -> Option<&'a CustomLoader> {
    let basename = bun_paths::basename(filename);
    let mut next: usize = 0;
    while let Some(i) = strings::index_of_char_pos(basename, b'.', next) {
        next = i + 1;
        if i == 0 {
            continue;
        }
        let ext = &basename[i..];
        if let Some(value) = vm.commonjs_custom_extensions.get(ext) {
            return Some(value);
        }
    }
    None
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn NodeModuleModule__onRequireExtensionModify(
    global: &JSGlobalObject,
    str: &BunString,
    loader: ApiLoader,
    value: JSValue,
) {
    let str_slice = str.to_utf8();
    if on_require_extension_modify(global, str_slice.slice(), loader, value).is_err() {
        bun_core::out_of_memory();
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn NodeModuleModule__onRequireExtensionModifyNonFunction(
    global: &JSGlobalObject,
    str: &BunString,
) {
    let str_slice = str.to_utf8();
    if on_require_extension_modify_non_function(global, str_slice.slice()).is_err() {
        bun_core::out_of_memory();
    }
}
