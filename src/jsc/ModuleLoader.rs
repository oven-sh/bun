//! Port of src/jsc/ModuleLoader.zig

use core::ffi::c_void;

use bun_alloc::ArenaAllocator;
use bun_bundler::analyze_transpiled_module;
use bun_bundler::options::{self, ModuleType};
use bun_bundler::Transpiler;
use bun_core::{analytics, Environment, FeatureFlags, Output};
use bun_jsc::{
    self as jsc, ErrorableResolvedSource, JSGlobalObject, JSInternalPromise, JSValue,
    ResolvedSource, VirtualMachine,
};
use bun_js_parser::{self as js_ast, js_printer, Runtime};
use bun_logger as logger;
use bun_paths::{self, PathBuffer};
use bun_resolve_builtins::HardcodedModule;
use bun_resolver::fs as Fs;
use bun_resolver::node_fallbacks;
use bun_resolver::package_json::{MacroMap as MacroRemap, PackageJSON};
use bun_schema::api;
use bun_str::{self as bun_str, strings, String, ZigString};
use bun_sys::{self, Fd as FD};
use bun_transpiler::{EntryPoints::MacroEntryPoint, ParseResult, PluginRunner};
use bun_watcher::Watcher;

use crate::node_module_module;
use crate::runtime_transpiler_store::{dump_source, dump_source_string, set_break_point_on_first_line};

// Re-exports (thin re-exports from the original Zig file).
pub use bun_resolver::node_fallbacks as node_fallbacks_mod;
pub use crate::async_module::AsyncModule;
pub use crate::runtime_transpiler_store::RuntimeTranspilerStore;
pub use bun_resolve_builtins::HardcodedModule as HardcodedModuleReexport;
// TODO(port): the Zig file re-exports `node_fallbacks`, `AsyncModule`,
// `RuntimeTranspilerStore`, and `HardcodedModule` as `pub const`s. Phase B
// should reconcile the canonical re-export names above with downstream users.

bun_output::declare_scope!(ModuleLoader, hidden);

pub struct ModuleLoader {
    pub transpile_source_code_arena: Option<Box<ArenaAllocator>>,
    pub eval_source: Option<Box<logger::Source>>,
}

impl Default for ModuleLoader {
    fn default() -> Self {
        Self {
            transpile_source_code_arena: None,
            eval_source: None,
        }
    }
}

// Zig's `comptime { _ = Bun__transpileVirtualModule; ... }` force-reference block — drop.

pub static mut IS_ALLOWED_TO_USE_INTERNAL_TESTING_APIS: bool = false;
// TODO(port): Zig used a plain mutable global; Phase B may want AtomicBool.

impl ModuleLoader {
    /// This must be called after calling transpileSourceCode
    pub fn reset_arena(&mut self, jsc_vm: &mut VirtualMachine) {
        debug_assert!(core::ptr::eq(&jsc_vm.module_loader, self));
        if let Some(arena) = self.transpile_source_code_arena.as_mut() {
            if jsc_vm.smol {
                let _ = arena.reset(ArenaResetMode::FreeAll);
            } else {
                let _ = arena.reset(ArenaResetMode::RetainWithLimit(8 * 1024 * 1024));
            }
        }
        // TODO(port): ArenaResetMode variants — match bun_alloc::ArenaAllocator API in Phase B.
    }
}

// TODO(port): placeholder for ArenaAllocator reset mode; replace with bun_alloc type.
pub enum ArenaResetMode {
    FreeAll,
    RetainWithLimit(usize),
}

pub fn resolve_embedded_file<'a>(
    vm: &mut VirtualMachine,
    path_buf: &'a mut PathBuffer,
    input_path: &[u8],
    extname: &[u8],
) -> Option<&'a [u8]> {
    if input_path.is_empty() {
        return None;
    }
    let graph = vm.standalone_module_graph.as_mut()?;
    let file = graph.find(input_path)?;

    #[cfg(target_os = "linux")]
    {
        // TODO: use /proc/fd/12346 instead! Avoid the copy!
    }

    // atomically write to a tmpfile and then move it to the final destination
    let tmpname_buf = bun_paths::path_buffer_pool().get();
    let Ok(tmpfilename) =
        bun_resolver::fs::FileSystem::tmpname(extname, &mut *tmpname_buf, bun_wyhash::hash(file.name))
    else {
        return None;
    };

    let Ok(tmpdir_std) = bun_resolver::fs::FileSystem::instance().tmpdir() else {
        return None;
    };
    let tmpdir: FD = FD::from_std_dir(tmpdir_std);

    // First we open the tmpfile, to avoid any other work in the event of failure.
    let Ok(tmpfile) = bun_sys::Tmpfile::create(tmpdir, tmpfilename).unwrap_result() else {
        return None;
    };
    // TODO(port): `defer tmpfile.fd.close()` — wrap in a guard so the fd closes on every return path below.
    let _close_guard = scopeguard::guard(tmpfile.fd, |fd| fd.close());

    match bun_runtime::node::fs::NodeFS::write_file_with_path_buffer(
        &mut *tmpname_buf, // not used
        bun_runtime::node::fs::WriteFileOptions {
            data: bun_runtime::node::fs::WriteFileData::EncodedSlice(
                ZigString::Slice::from_utf8_never_free(file.contents),
            ),
            dirfd: tmpdir,
            file: bun_runtime::node::fs::FileArg::Fd(tmpfile.fd),
            encoding: bun_runtime::node::fs::Encoding::Buffer,
            ..Default::default()
        },
    ) {
        bun_sys::Result::Err(_) => {
            return None;
        }
        _ => {}
    }
    // TODO(port): WriteFileOptions / WriteFileData / FileArg names guessed — fix in Phase B.

    Some(bun_paths::join_abs_string_buf(
        bun_resolver::fs::FileSystem::RealFS::tmpdir_path(),
        path_buf,
        &[tmpfilename],
        bun_paths::Platform::Auto,
    ))
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__getDefaultLoader(global: &JSGlobalObject, str: &String) -> api::Loader {
    let jsc_vm = global.bun_vm();
    let filename = str.to_utf8();
    let loader = jsc_vm
        .transpiler
        .options
        .loader(Fs::PathName::init(filename.slice()).ext)
        .to_api();
    if loader == api::Loader::File {
        return api::Loader::Js;
    }
    loader
}

/// Dumps the module source to a file in /tmp/bun-debug-src/{filepath}
///
/// This can technically fail if concurrent access across processes happens, or permission issues.
/// Errors here should always be ignored.
#[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum FetchFlags {
    Transpile,
    PrintSource,
    PrintSourceAndClone,
}

impl FetchFlags {
    pub const fn disable_transpiling(self) -> bool {
        !matches!(self, FetchFlags::Transpile)
    }
}

pub fn transpile_source_code<const FLAGS: FetchFlags>(
    jsc_vm: &mut VirtualMachine,
    specifier: &[u8],
    referrer: &[u8],
    input_specifier: String,
    path: Fs::Path,
    loader: options::Loader,
    module_type: options::ModuleType,
    log: &mut logger::Log,
    virtual_source: Option<&logger::Source>,
    promise_ptr: Option<&mut Option<*mut JSInternalPromise>>,
    source_code_printer: &mut js_printer::BufferPrinter,
    global_object: Option<&JSGlobalObject>,
) -> Result<ResolvedSource, bun_core::Error> {
    // TODO(port): narrow error set
    const DISABLE_TRANSPILYING: bool = FLAGS.disable_transpiling();

    if DISABLE_TRANSPILYING {
        if !(loader.is_java_script_like()
            || loader == options::Loader::Toml
            || loader == options::Loader::Yaml
            || loader == options::Loader::Json5
            || loader == options::Loader::Text
            || loader == options::Loader::Json
            || loader == options::Loader::Jsonc)
        {
            // Don't print "export default <file path>"
            return Ok(ResolvedSource {
                allocator: None,
                source_code: String::empty(),
                specifier: input_specifier,
                source_url: input_specifier.create_if_different(path.text),
                ..Default::default()
            });
        }
    }

    use options::Loader as L;
    match loader {
        L::Js | L::Jsx | L::Ts | L::Tsx | L::Json | L::Jsonc | L::Toml | L::Yaml | L::Json5
        | L::Text | L::Md => {
            // Ensure that if there was an ASTMemoryAllocator in use, it's not used anymore.
            let mut ast_scope = js_ast::ASTMemoryAllocator::Scope::default();
            ast_scope.enter();
            let _ast_scope_guard = scopeguard::guard((), |_| ast_scope.exit());
            // TODO(port): ASTMemoryAllocator::Scope enter/exit API — verify in Phase B.

            jsc_vm.transpiled_count += 1;
            jsc_vm.transpiler.reset_store();
            let hash = Watcher::get_hash(path.text);
            let is_main = jsc_vm.main.len() == path.text.len()
                && jsc_vm.main_hash == hash
                && strings::eql_long(&jsc_vm.main, path.text, false);

            let mut arena_: Option<Box<ArenaAllocator>> = 'brk: {
                // Attempt to reuse the Arena from the parser when we can
                // This code is potentially re-entrant, so only one Arena can be reused at a time
                // That's why we have to check if the Arena is null
                //
                // Using an Arena here is a significant memory optimization when loading many files
                if let Some(shared) = jsc_vm.module_loader.transpile_source_code_arena.take() {
                    break 'brk Some(shared);
                }

                // we must allocate the arena so that the pointer it points to is always valid.
                let arena = Box::new(ArenaAllocator::init());
                Some(arena)
            };

            let mut give_back_arena = true;
            // PORT NOTE: `defer { if give_back_arena ... }` — implemented with scopeguard.
            let arena_guard = scopeguard::guard(
                (&mut arena_, &mut give_back_arena, &mut *jsc_vm),
                |(arena_, give_back_arena, jsc_vm)| {
                    if *give_back_arena {
                        if jsc_vm.module_loader.transpile_source_code_arena.is_none() {
                            // when .print_source is used
                            // caller is responsible for freeing the arena
                            if FLAGS != FetchFlags::PrintSource {
                                if jsc_vm.smol {
                                    let _ = arena_.as_mut().unwrap().reset(ArenaResetMode::FreeAll);
                                } else {
                                    let _ = arena_
                                        .as_mut()
                                        .unwrap()
                                        .reset(ArenaResetMode::RetainWithLimit(8 * 1024 * 1024));
                                }
                            }
                            jsc_vm.module_loader.transpile_source_code_arena = arena_.take();
                        } else {
                            // arena_.?.deinit(); allocator.destroy(arena_.?);
                            drop(arena_.take());
                        }
                    }
                },
            );
            // TODO(port): the scopeguard above captures &mut jsc_vm and &mut arena_ which
            // overlap with later borrows — Phase B will need to restructure (e.g. inline
            // the cleanup at each return site or use a small RAII type owning the arena).
            // PORT NOTE: reshaped for borrowck — kept logic identical to Zig defer.
            let _ = arena_guard; // suppress unused warning in draft

            let arena = arena_.as_mut().unwrap();
            let allocator = arena.allocator();
            // TODO(port): `allocator` is a `&dyn bun_alloc::Allocator` — Phase B wires actual type.

            let mut fd: Option<FD> = None;
            let mut package_json: Option<*mut PackageJSON> = None;
            // TODO(port): lifetime — package_json is a back-reference into watcher list / resolver cache.

            if let Some(index) = jsc_vm.bun_watcher.index_of(hash) {
                fd = jsc_vm.bun_watcher.watchlist().items_fd()[index].unwrap_valid();
                package_json = jsc_vm.bun_watcher.watchlist().items_package_json()[index];
                // TODO(port): MultiArrayList .items(.field) accessor names — fix in Phase B.
            }

            let mut cache = jsc::RuntimeTranspilerCache {
                output_code_allocator: allocator,
                sourcemap_allocator: (), // bun.default_allocator → delete
                esm_record_allocator: (), // bun.default_allocator → delete
                ..Default::default()
            };
            // TODO(port): RuntimeTranspilerCache field set — match real struct in Phase B.

            let old = jsc_vm.transpiler.log;
            jsc_vm.transpiler.log = log;
            jsc_vm.transpiler.linker.log = log;
            jsc_vm.transpiler.resolver.log = log;
            if let Some(pm) = jsc_vm.transpiler.resolver.package_manager.as_mut() {
                pm.log = log;
            }

            let _restore_log = scopeguard::guard((), |_| {
                jsc_vm.transpiler.log = old;
                jsc_vm.transpiler.linker.log = old;
                jsc_vm.transpiler.resolver.log = old;
                if let Some(pm) = jsc_vm.transpiler.resolver.package_manager.as_mut() {
                    pm.log = old;
                }
            });
            // TODO(port): overlapping &mut borrows — Phase B restructure.

            // this should be a cheap lookup because 24 bytes == 8 * 3 so it's read 3 machine words
            let is_node_override = specifier.starts_with(node_fallbacks::IMPORT_PATH);

            let macro_remappings = if jsc_vm.macro_mode
                || !jsc_vm.has_any_macro_remappings
                || is_node_override
            {
                MacroRemap::default()
            } else {
                jsc_vm.transpiler.options.macro_remap.clone()
            };

            let mut fallback_source: logger::Source;
            // PORT NOTE: Zig left this `undefined`; we leave it uninitialized via late init below.

            // Usually, we want to close the input file automatically.
            //
            // If we're re-using the file descriptor from the fs watcher
            // Do not close it because that will break the kqueue-based watcher
            //
            let mut should_close_input_file_fd = fd.is_none();

            // We don't want cjs wrappers around non-js files
            let module_type_only_for_wrappables = match loader {
                L::Js | L::Jsx | L::Ts | L::Tsx => module_type,
                _ => ModuleType::Unknown,
            };

            let mut input_file_fd: FD = FD::invalid();
            let mut parse_options = Transpiler::ParseOptions {
                allocator,
                path,
                loader,
                dirname_fd: FD::invalid(),
                file_descriptor: fd,
                file_fd_ptr: &mut input_file_fd,
                file_hash: hash,
                macro_remappings,
                jsx: jsc_vm.transpiler.options.jsx,
                emit_decorator_metadata: jsc_vm.transpiler.options.emit_decorator_metadata,
                experimental_decorators: jsc_vm.transpiler.options.experimental_decorators,
                virtual_source,
                dont_bundle_twice: true,
                allow_commonjs: true,
                module_type: module_type_only_for_wrappables,
                inject_jest_globals: jsc_vm.transpiler.options.rewrite_jest_for_tests,
                keep_json_and_toml_as_one_statement: true,
                allow_bytecode_cache: true,
                set_breakpoint_on_first_line: is_main
                    && jsc_vm.debugger.is_some()
                    && jsc_vm.debugger.as_ref().unwrap().set_breakpoint_on_first_line
                    && set_break_point_on_first_line(),
                runtime_transpiler_cache: if !DISABLE_TRANSPILYING
                    && !jsc::RuntimeTranspilerCache::is_disabled()
                {
                    Some(&mut cache)
                } else {
                    None
                },
                remove_cjs_module_wrapper: is_main && jsc_vm.module_loader.eval_source.is_some(),
                ..Default::default()
            };
            // TODO(port): Transpiler::ParseOptions field names/types — verify in Phase B.

            let _close_input_fd = scopeguard::guard((), |_| {
                if should_close_input_file_fd && input_file_fd != FD::invalid() {
                    input_file_fd.close();
                    input_file_fd = FD::invalid();
                }
            });
            // TODO(port): overlapping &mut input_file_fd borrow — Phase B restructure.

            if is_node_override {
                if let Some(code) = node_fallbacks::contents_from_path(specifier) {
                    let fallback_path = Fs::Path::init_with_namespace(specifier, b"node");
                    fallback_source = logger::Source {
                        path: fallback_path,
                        contents: code,
                        ..Default::default()
                    };
                    parse_options.virtual_source = Some(&fallback_source);
                }
            }

            // PORT NOTE: Zig `switch (bool) { inline else => |return_file_only| ... }` — runtime
            // bool dispatched to a comptime bool. We dispatch to const-generic here.
            let return_file_only = DISABLE_TRANSPILYING || (loader == L::Json);
            let parsed = if return_file_only {
                jsc_vm
                    .transpiler
                    .parse_maybe_return_file_only::<true>(parse_options, None)
            } else {
                jsc_vm
                    .transpiler
                    .parse_maybe_return_file_only::<false>(parse_options, None)
            };
            // PERF(port): was comptime bool dispatch — profile in Phase B.

            let mut parse_result: ParseResult = match parsed {
                Some(r) => r,
                None => {
                    if !DISABLE_TRANSPILYING {
                        if jsc_vm.is_watcher_enabled() {
                            if input_file_fd.is_valid() {
                                if !is_node_override
                                    && bun_paths::is_absolute(path.text)
                                    && !strings::contains(path.text, b"node_modules")
                                {
                                    should_close_input_file_fd = false;
                                    let _ = jsc_vm.bun_watcher.add_file(
                                        input_file_fd,
                                        path.text,
                                        hash,
                                        loader,
                                        FD::invalid(),
                                        package_json,
                                        true,
                                    );
                                }
                            }
                        }
                    }

                    give_back_arena = false;
                    return Err(bun_core::err!("ParseError"));
                }
            };

            let source = &parse_result.source;

            if parse_result.loader == L::Wasm {
                return transpile_source_code::<FLAGS>(
                    jsc_vm,
                    specifier,
                    referrer,
                    input_specifier,
                    path,
                    L::Wasm,
                    ModuleType::Unknown, // cjs/esm don't make sense for wasm
                    log,
                    Some(&parse_result.source),
                    promise_ptr,
                    source_code_printer,
                    global_object,
                );
            }

            if !DISABLE_TRANSPILYING {
                if jsc_vm.is_watcher_enabled() {
                    if input_file_fd.is_valid() {
                        if !is_node_override
                            && bun_paths::is_absolute(path.text)
                            && !strings::contains(path.text, b"node_modules")
                        {
                            should_close_input_file_fd = false;
                            let _ = jsc_vm.bun_watcher.add_file(
                                input_file_fd,
                                path.text,
                                hash,
                                loader,
                                FD::invalid(),
                                package_json,
                                true,
                            );
                        }
                    }
                }
            }

            if jsc_vm.transpiler.log.errors > 0 {
                give_back_arena = false;
                return Err(bun_core::err!("ParseError"));
            }

            if loader == L::Json {
                return Ok(ResolvedSource {
                    allocator: None,
                    source_code: String::clone_utf8(source.contents),
                    specifier: input_specifier,
                    source_url: input_specifier.create_if_different(path.text),
                    tag: ResolvedSource::Tag::JsonForObjectLoader,
                    ..Default::default()
                });
            }

            if DISABLE_TRANSPILYING {
                return Ok(ResolvedSource {
                    allocator: None,
                    source_code: match FLAGS {
                        FetchFlags::PrintSourceAndClone => {
                            String::init(Box::<[u8]>::from(source.contents))
                            // TODO(port): String::init over owned bytes — verify API.
                        }
                        FetchFlags::PrintSource => String::init(source.contents),
                        _ => unreachable!(), // @compileError("unreachable")
                    },
                    specifier: input_specifier,
                    source_url: input_specifier.create_if_different(path.text),
                    ..Default::default()
                });
            }

            if loader == L::Json
                || loader == L::Jsonc
                || loader == L::Toml
                || loader == L::Yaml
                || loader == L::Json5
            {
                if parse_result.empty {
                    return Ok(ResolvedSource {
                        allocator: None,
                        specifier: input_specifier,
                        source_url: input_specifier.create_if_different(path.text),
                        jsvalue_for_export: JSValue::create_empty_object(jsc_vm.global, 0),
                        tag: ResolvedSource::Tag::ExportsObject,
                        ..Default::default()
                    });
                }

                let global = global_object.unwrap_or(jsc_vm.global);
                let jsvalue = parse_result
                    .ast
                    .parts
                    .at(0)
                    .stmts[0]
                    .data
                    .s_expr()
                    .value
                    .to_js(allocator, global)
                    .unwrap_or_else(|e| {
                        panic!("Unexpected JS error: {}", e.name())
                    });
                // TODO(port): `.data.s_expr` union access — verify accessor name in Phase B.

                return Ok(ResolvedSource {
                    allocator: None,
                    specifier: input_specifier,
                    source_url: input_specifier.create_if_different(path.text),
                    jsvalue_for_export: jsvalue,
                    tag: ResolvedSource::Tag::ExportsObject,
                    ..Default::default()
                });
            }

            if parse_result.already_bundled != AlreadyBundled::None {
                let bytecode_slice = parse_result.already_bundled.bytecode_slice();
                return Ok(ResolvedSource {
                    allocator: None,
                    source_code: String::clone_latin1(source.contents),
                    specifier: input_specifier,
                    source_url: input_specifier.create_if_different(path.text),
                    already_bundled: true,
                    bytecode_cache: if !bytecode_slice.is_empty() {
                        Some(bytecode_slice.as_ptr())
                    } else {
                        None
                    },
                    bytecode_cache_size: bytecode_slice.len(),
                    is_commonjs_module: parse_result.already_bundled.is_common_js(),
                    ..Default::default()
                });
            }
            // TODO(port): AlreadyBundled enum — placeholder; replace with bun_transpiler type.

            if parse_result.empty {
                let was_cjs = (loader == L::Js || loader == L::Ts) && {
                    let ext = bun_paths::extension(source.path.text);
                    // TODO(port): std.fs.path.extension equivalent — using bun_paths::extension.
                    ext == b".cjs" || ext == b".cts"
                };
                if was_cjs {
                    return Ok(ResolvedSource {
                        allocator: None,
                        source_code: String::static_(b"(function(){})"),
                        specifier: input_specifier,
                        source_url: input_specifier.create_if_different(path.text),
                        is_commonjs_module: true,
                        tag: ResolvedSource::Tag::Javascript,
                        ..Default::default()
                    });
                }
            }

            if let Some(entry) = cache.entry.as_mut() {
                // TODO(port): Zig wrapped `entry.sourcemap` as a borrowed `std.ArrayList(u8)`
                // via `@constCast` (no copy). Phase B: have `put_mappings` accept `&[u8]` /
                // `Vec<u8>` directly so no wrapper or copy is needed here.
                let _ = jsc_vm.source_mappings.put_mappings(
                    source,
                    entry.sourcemap,
                );

                if Environment::ALLOW_ASSERT {
                    dump_source_string(jsc_vm, specifier, entry.output_code.byte_slice());
                }

                let module_info: Option<*mut analyze_transpiled_module::ModuleInfoDeserialized> =
                    if jsc_vm.use_isolation_source_provider_cache()
                        && entry.metadata.module_type != ModuleType::Cjs
                        && !entry.esm_record.is_empty()
                    {
                        analyze_transpiled_module::ModuleInfoDeserialized::create_from_cached_record(
                            entry.esm_record,
                        )
                    } else {
                        None
                    };

                return Ok(ResolvedSource {
                    allocator: None,
                    source_code: match &entry.output_code {
                        OutputCode::String(s) => *s,
                        OutputCode::Utf8(_) => {
                            let result = String::clone_utf8(entry.output_code.utf8());
                            // cache.output_code_allocator.free(entry.output_code.utf8); — arena-owned, drop.
                            entry.output_code.set_utf8(b"");
                            result
                        }
                    },
                    // TODO(port): OutputCode enum variants — placeholder names.
                    specifier: input_specifier,
                    source_url: input_specifier.create_if_different(path.text),
                    is_commonjs_module: entry.metadata.module_type == ModuleType::Cjs,
                    module_info: module_info.map(|p| p as *mut c_void),
                    tag: 'brk: {
                        if entry.metadata.module_type == ModuleType::Cjs && source.path.is_file() {
                            let actual_package_json: Option<*mut PackageJSON> = package_json
                                .or_else(|| {
                                    // this should already be cached virtually always so it's fine to do this
                                    let dir_info = jsc_vm
                                        .transpiler
                                        .resolver
                                        .read_dir_info(source.path.name.dir)
                                        .ok()
                                        .flatten()?;
                                    dir_info
                                        .package_json
                                        .or(dir_info.enclosing_package_json)
                                });
                            let Some(actual_package_json) = actual_package_json else {
                                break 'brk ResolvedSource::Tag::Javascript;
                            };

                            // SAFETY: package_json points into resolver cache; alive for this call.
                            if unsafe { (*actual_package_json).module_type } == ModuleType::Esm {
                                break 'brk ResolvedSource::Tag::PackageJsonTypeModule;
                            }
                        }

                        ResolvedSource::Tag::Javascript
                    },
                    ..Default::default()
                });
            }

            let start_count = jsc_vm.transpiler.linker.import_counter;

            // We _must_ link because:
            // - node_modules bundle won't be properly
            jsc_vm.transpiler.linker.link(
                path,
                &mut parse_result,
                jsc_vm.origin,
                LinkPathFormat::AbsolutePath,
                false,
                true,
            )?;
            // TODO(port): LinkPathFormat enum — placeholder; match bun_bundler::linker.

            if parse_result.pending_imports.len() > 0 {
                if promise_ptr.is_none() {
                    return Err(bun_core::err!("UnexpectedPendingResolution"));
                }

                if source.contents_is_recycled {
                    // this shared buffer is about to become owned by the AsyncModule struct
                    jsc_vm
                        .transpiler
                        .resolver
                        .caches
                        .fs
                        .reset_shared_buffer(jsc_vm.transpiler.resolver.caches.fs.shared_buffer());
                }

                jsc_vm.modules.enqueue(
                    global_object.unwrap(),
                    AsyncModuleEnqueueArgs {
                        parse_result,
                        path,
                        loader,
                        fd,
                        package_json,
                        hash,
                        promise_ptr,
                        specifier,
                        referrer,
                        arena: arena_.take().unwrap(),
                    },
                );
                // TODO(port): AsyncModuleEnqueueArgs — placeholder struct; match modules.enqueue signature.
                give_back_arena = false;
                return Err(bun_core::err!("AsyncModule"));
            }

            if !jsc_vm.macro_mode {
                jsc_vm.resolved_count += jsc_vm.transpiler.linker.import_counter - start_count;
            }
            jsc_vm.transpiler.linker.import_counter = 0;

            let is_commonjs_module = parse_result.ast.has_commonjs_export_names
                || parse_result.ast.exports_kind == ExportsKind::Cjs;
            // TODO(port): ExportsKind enum — placeholder; from bun_js_parser.

            let module_info: Option<*mut analyze_transpiled_module::ModuleInfo> = if jsc_vm
                .use_isolation_source_provider_cache()
                && !is_commonjs_module
                && loader.is_java_script_like()
            {
                analyze_transpiled_module::ModuleInfo::create(loader.is_type_script()).ok()
            } else {
                None
            };
            let _module_info_guard = scopeguard::guard(module_info, |mi| {
                if let Some(mi) = mi {
                    // SAFETY: created above; not yet handed off.
                    unsafe { (*mi).destroy() };
                }
            });
            // PORT NOTE: errdefer if (module_info) |mi| mi.destroy();
            if let Some(mi) = module_info {
                // SAFETY: just created.
                unsafe {
                    (*mi).flags.has_tla = !parse_result.ast.top_level_await_keyword.is_empty();
                }
            }

            let mut printer = *source_code_printer;
            printer.ctx.reset();
            let _restore_printer = scopeguard::guard((), |_| {
                *source_code_printer = printer;
            });
            // TODO(port): BufferPrinter is large; Zig copied by value. Phase B may want &mut directly.

            let _ = {
                let mut mapper = jsc_vm.source_map_handler(&mut printer);
                jsc_vm.transpiler.print_with_source_map(
                    parse_result,
                    &mut printer,
                    PrintFormat::EsmAscii,
                    mapper.get(),
                    module_info,
                )?
                // TODO(port): PrintFormat enum — placeholder.
            };

            if Environment::DUMP_SOURCE {
                dump_source(jsc_vm, specifier, &mut printer);
            }

            let _set_has_loaded = scopeguard::guard((), |_| {
                if is_main {
                    jsc_vm.has_loaded = true;
                }
            });

            // Disarm errdefer for module_info — success path takes ownership.
            let module_info = scopeguard::ScopeGuard::into_inner(_module_info_guard);
            let module_info_deserialized: Option<*mut c_void> = module_info
                // SAFETY: mi was created above and just disarmed from the errdefer guard;
                // pointer is still valid and uniquely owned on this success path.
                .map(|mi| unsafe { (*mi).as_deserialized() } as *mut c_void);

            if jsc_vm.is_watcher_enabled() {
                let mut resolved_source = jsc_vm.ref_counted_resolved_source(
                    printer.ctx.written(),
                    input_specifier,
                    path.text,
                    None,
                    false,
                );
                resolved_source.is_commonjs_module = is_commonjs_module;
                resolved_source.module_info = module_info_deserialized;
                return Ok(resolved_source);
            }

            // Pass along package.json type "module" if set.
            let tag: ResolvedSource::Tag = match loader {
                L::Json | L::Jsonc => ResolvedSource::Tag::JsonForObjectLoader,
                L::Js | L::Jsx | L::Ts | L::Tsx => {
                    let module_type_ = if let Some(pkg) = package_json {
                        // SAFETY: package_json points into resolver/watcher cache.
                        unsafe { (*pkg).module_type }
                    } else {
                        module_type
                    };
                    match module_type_ {
                        ModuleType::Esm => ResolvedSource::Tag::PackageJsonTypeModule,
                        ModuleType::Cjs => ResolvedSource::Tag::PackageJsonTypeCommonjs,
                        _ => ResolvedSource::Tag::Javascript,
                    }
                }
                _ => ResolvedSource::Tag::Javascript,
            };

            return Ok(ResolvedSource {
                allocator: None,
                source_code: {
                    let written = printer.ctx.get_written();
                    let result = cache.output_code.unwrap_or_else(|| String::clone_latin1(written));

                    if written.len() > 1024 * 1024 * 2 || jsc_vm.smol {
                        printer.ctx.buffer.deinit();
                        // TODO(port): buffer.deinit() — likely becomes drop/clear in Phase B.
                    }

                    result
                },
                specifier: input_specifier,
                source_url: input_specifier.create_if_different(path.text),
                is_commonjs_module,
                module_info: module_info_deserialized,
                tag,
                ..Default::default()
            });
        }
        // provideFetch() should be called
        L::Napi => unreachable!(),
        // .wasm => {
        //     jsc_vm.transpiled_count += 1;
        //     var fd: ?FD = null;
        //
        //     var allocator = if (jsc_vm.has_loaded) jsc_vm.arena.allocator() else jsc_vm.allocator;
        //
        //     const hash = http.Watcher.getHash(path.text);
        //     if (jsc_vm.watcher) |watcher| {
        //         if (watcher.indexOf(hash)) |index| {
        //             const _fd = watcher.watchlist().items(.fd)[index];
        //             fd = if (_fd > 0) _fd else null;
        //         }
        //     }
        //
        //     var parse_options = Transpiler.ParseOptions{
        //         .allocator = allocator,
        //         .path = path,
        //         .loader = loader,
        //         .dirname_fd = 0,
        //         .file_descriptor = fd,
        //         .file_hash = hash,
        //         .macro_remappings = MacroRemap{},
        //         .jsx = jsc_vm.transpiler.options.jsx,
        //     };
        //
        //     var parse_result = jsc_vm.transpiler.parse(
        //         parse_options,
        //         null,
        //     ) orelse {
        //         return error.ParseError;
        //     };
        //
        //     return ResolvedSource{
        //         .allocator = if (jsc_vm.has_loaded) &jsc_vm.allocator else null,
        //         .source_code = ZigString.init(jsc_vm.allocator.dupe(u8, source.contents) catch unreachable),
        //         .specifier = ZigString.init(specifier),
        //         .source_url = input_specifier.createIfDifferent(path.text),
        //         .tag = ResolvedSource.Tag.wasm,
        //     };
        // },
        L::Wasm => {
            if referrer == b"undefined" && strings::eql_long(&jsc_vm.main, path.text, true) {
                if let Some(source) = virtual_source {
                    if let Some(global_this) = global_object {
                        // attempt to avoid reading the WASM file twice.
                        let decoded = jsc::DecodedJSValue {
                            u: jsc::DecodedJSValueU {
                                ptr: global_this as *const _ as *mut c_void,
                            },
                        };
                        // TODO(port): DecodedJSValue layout — verify in Phase B.
                        let global_value = decoded.encode();
                        global_value.put(
                            global_this,
                            ZigString::static_(b"wasmSourceBytes"),
                            jsc::ArrayBuffer::create(global_this, source.contents, jsc::TypedArrayType::Uint8Array)?,
                        );
                    }
                }
                return Ok(ResolvedSource {
                    allocator: None,
                    source_code: String::static_(include_bytes!("../js/wasi-runner.js")),
                    // TODO(port): @embedFile — Phase B confirm path resolution at build time.
                    specifier: input_specifier,
                    source_url: input_specifier.create_if_different(path.text),
                    tag: ResolvedSource::Tag::Esm,
                    ..Default::default()
                });
            }

            return transpile_source_code::<FLAGS>(
                jsc_vm,
                specifier,
                referrer,
                input_specifier,
                path,
                L::File,
                ModuleType::Unknown, // cjs/esm don't make sense for wasm
                log,
                virtual_source,
                promise_ptr,
                source_code_printer,
                global_object,
            );
        }

        L::SqliteEmbedded | L::Sqlite => {
            let sqlite_module_source_code_string: &'static [u8] = 'brk: {
                if jsc_vm.hot_reload == HotReloadMode::Hot {
                    break 'brk b"// Generated code\n\
import {Database} from 'bun:sqlite';\n\
const {path} = import.meta;\n\
\n\
// Don't reload the database if it's already loaded\n\
const registry = (globalThis[Symbol.for(\"bun:sqlite:hot\")] ??= new Map());\n\
\n\
export let db = registry.get(path);\n\
export const __esModule = true;\n\
if (!db) {\n\
   // Load the database\n\
   db = new Database(path);\n\
   registry.set(path, db);\n\
}\n\
\n\
export default db;";
                }
                // TODO(port): HotReloadMode enum — placeholder.

                b"// Generated code\n\
import {Database} from 'bun:sqlite';\n\
export const db = new Database(import.meta.path);\n\
\n\
export const __esModule = true;\n\
export default db;"
            };

            return Ok(ResolvedSource {
                allocator: None,
                source_code: String::clone_utf8(sqlite_module_source_code_string),
                specifier: input_specifier,
                source_url: input_specifier.create_if_different(path.text),
                tag: ResolvedSource::Tag::Esm,
                ..Default::default()
            });
        }

        L::Html => {
            if FLAGS.disable_transpiling() {
                return Ok(ResolvedSource {
                    allocator: None,
                    source_code: String::empty(),
                    specifier: input_specifier,
                    source_url: input_specifier.create_if_different(path.text),
                    tag: ResolvedSource::Tag::Esm,
                    ..Default::default()
                });
            }

            if global_object.is_none() {
                return Err(bun_core::err!("NotSupported"));
            }

            let html_bundle = jsc::api::HTMLBundle::init(global_object.unwrap(), path.text)?;
            return Ok(ResolvedSource {
                allocator: Some(&jsc_vm.allocator),
                // TODO(port): ResolvedSource.allocator field type — verify in Phase B.
                jsvalue_for_export: html_bundle.to_js(global_object.unwrap()),
                specifier: input_specifier,
                source_url: input_specifier.create_if_different(path.text),
                tag: ResolvedSource::Tag::ExportDefaultObject,
                ..Default::default()
            });
        }

        _ => {
            if FLAGS.disable_transpiling() {
                return Ok(ResolvedSource {
                    allocator: None,
                    source_code: String::empty(),
                    specifier: input_specifier,
                    source_url: input_specifier.create_if_different(path.text),
                    tag: ResolvedSource::Tag::Esm,
                    ..Default::default()
                });
            }

            if virtual_source.is_none() {
                'auto_watch: {
                    if jsc_vm.is_watcher_enabled() {
                        if bun_paths::is_absolute(path.text)
                            && !strings::contains(path.text, b"node_modules")
                        {
                            let input_fd: FD = 'brk: {
                                // kqueue watchers need a file descriptor to receive event notifications on it.
                                if Watcher::REQUIRES_FILE_DESCRIPTORS {
                                    let Ok(posix_path) = bun_sys::to_posix_path(path.text) else {
                                        break 'auto_watch;
                                    };
                                    // TODO(port): std.posix.toPosixPath equivalent — verify bun_sys helper.
                                    match bun_sys::open(&posix_path, Watcher::WATCH_OPEN_FLAGS, 0) {
                                        bun_sys::Result::Err(_) => break 'auto_watch,
                                        bun_sys::Result::Ok(fd) => break 'brk fd,
                                    }
                                } else {
                                    // Otherwise, don't even bother opening it.
                                    break 'brk FD::invalid();
                                }
                            };
                            let hash = Watcher::get_hash(path.text);
                            match jsc_vm.bun_watcher.add_file(
                                input_fd,
                                path.text,
                                hash,
                                loader,
                                FD::invalid(),
                                None,
                                true,
                            ) {
                                bun_sys::Result::Err(_) => {
                                    #[cfg(target_os = "macos")]
                                    {
                                        // If any error occurs and we just
                                        // opened the file descriptor to
                                        // receive event notifications on
                                        // it, we should close it.
                                        if input_fd.is_valid() {
                                            input_fd.close();
                                        }
                                    }

                                    // we don't consider it a failure if we cannot watch the file
                                    // they didn't open the file
                                }
                                bun_sys::Result::Ok(_) => {}
                            }
                        }
                    }
                }
            }

            let value = 'brk: {
                if !jsc_vm.origin.is_empty() {
                    let mut buf = bun_str::MutableString::init2048();
                    // PORT NOTE: bun.handleOom dropped — Rust alloc aborts on OOM.
                    let mut writer = buf.writer();
                    jsc::api::Bun::get_public_path(specifier, jsc_vm.origin, &mut writer);
                    break 'brk String::create_utf8_for_js(global_object.unwrap(), buf.slice())?;
                }

                String::create_utf8_for_js(global_object.unwrap(), path.text)?
            };

            return Ok(ResolvedSource {
                allocator: None,
                jsvalue_for_export: value,
                specifier: input_specifier,
                source_url: input_specifier.create_if_different(path.text),
                tag: ResolvedSource::Tag::ExportDefaultObject,
                ..Default::default()
            });
        }
    }
}

// TODO(port): placeholder types referenced above; remove once real crate types exist.
#[allow(dead_code)]
struct AlreadyBundled;
#[allow(dead_code)]
struct OutputCode;
#[allow(dead_code)]
struct LinkPathFormat;
#[allow(dead_code)]
struct AsyncModuleEnqueueArgs;
#[allow(dead_code)]
struct ExportsKind;
#[allow(dead_code)]
struct PrintFormat;
#[allow(dead_code)]
struct HotReloadMode;

#[unsafe(no_mangle)]
pub extern "C" fn Bun__resolveAndFetchBuiltinModule(
    jsc_vm: &mut VirtualMachine,
    specifier: &mut String,
    ret: &mut ErrorableResolvedSource,
) -> bool {
    jsc::mark_binding(core::panic::Location::caller());
    let mut log = logger::Log::init();
    // Drop frees.
    let _ = &mut log;

    let Some(alias) =
        HardcodedModule::Alias::BUN_ALIASES.get_with_eql(*specifier, String::eql_comptime)
    else {
        return false;
    };
    // TODO(port): ComptimeStringMap.getWithEql custom comparator — phf custom hasher.
    let Some(hardcoded) = HardcodedModule::MAP.get(alias.path) else {
        debug_assert!(false);
        return false;
    };
    let Some(resolved) = get_hardcoded_module(jsc_vm, *specifier, hardcoded) else {
        return false;
    };
    *ret = ErrorableResolvedSource::ok(resolved);
    true
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__fetchBuiltinModule(
    jsc_vm: &mut VirtualMachine,
    global_object: &JSGlobalObject,
    specifier: &mut String,
    referrer: &mut String,
    ret: &mut ErrorableResolvedSource,
) -> bool {
    jsc::mark_binding(core::panic::Location::caller());
    let mut log = logger::Log::init();
    // Drop frees.

    match fetch_builtin_module(jsc_vm, *specifier) {
        Err(err) => {
            if err == bun_core::err!("AsyncModule") {
                unreachable!();
            }
            VirtualMachine::process_fetch_log(global_object, *specifier, *referrer, &mut log, ret, err);
            return true;
        }
        Ok(Some(builtin)) => {
            *ret = ErrorableResolvedSource::ok(builtin);
            return true;
        }
        Ok(None) => {
            return false;
        }
    }
}

const ALWAYS_SYNC_MODULES: &[&[u8]] = &[b"reflect-metadata"];

#[unsafe(no_mangle)]
pub extern "C" fn Bun__transpileFile(
    jsc_vm: &mut VirtualMachine,
    global_object: &JSGlobalObject,
    specifier_ptr: &mut String,
    referrer: &mut String,
    type_attribute: Option<&String>,
    ret: &mut ErrorableResolvedSource,
    allow_promise: bool,
    is_commonjs_require: bool,
    _force_loader_type: api::Loader,
) -> *mut c_void {
    jsc::mark_binding(core::panic::Location::caller());
    let force_loader_type: options::Loader::Optional = options::Loader::Optional::from_api(_force_loader_type);
    // TODO(port): options::Loader::Optional — verify type path in Phase B.
    let mut log = logger::Log::init();

    let _specifier = specifier_ptr.to_utf8();
    let referrer_slice = referrer.to_utf8();

    let mut type_attribute_str: Option<&[u8]> = None;
    if let Some(attribute) = type_attribute {
        if let Some(attr_utf8) = attribute.as_utf8() {
            type_attribute_str = Some(attr_utf8);
        }
    }

    let mut virtual_source_to_use: Option<logger::Source> = None;
    let mut blob_to_deinit: Option<jsc::WebCore::Blob> = None;
    let mut lr = match options::get_loader_and_virtual_source(
        _specifier.slice(),
        jsc_vm,
        &mut virtual_source_to_use,
        &mut blob_to_deinit,
        type_attribute_str,
    ) {
        Ok(lr) => lr,
        Err(_) => {
            *ret = ErrorableResolvedSource::err(
                bun_core::err!("JSErrorObject"),
                global_object
                    .err(jsc::ErrorCode::MODULE_NOT_FOUND, "Blob not found", ())
                    .to_js(),
            );
            // TODO(port): globalObject.ERR(.CODE, fmt, args) helper — verify Rust API.
            return core::ptr::null_mut();
        }
    };
    // PORT NOTE: `defer if (blob_to_deinit) |*blob| blob.deinit();` — Drop handles this.

    if let Some(loader_type) = force_loader_type.unwrap() {
        #[cold]
        fn cold() {}
        cold();
        debug_assert!(!is_commonjs_require);
        lr.loader = Some(loader_type);
    } else if is_commonjs_require && jsc_vm.has_mutated_built_in_extensions > 0 {
        #[cold]
        fn cold() {}
        cold();
        if let Some(entry) =
            node_module_module::find_longest_registered_extension(jsc_vm, _specifier.slice())
        {
            match entry {
                node_module_module::ExtensionEntry::Loader(loader) => {
                    lr.loader = Some(loader);
                }
                node_module_module::ExtensionEntry::Custom(strong) => {
                    *ret = ErrorableResolvedSource::ok(ResolvedSource {
                        allocator: None,
                        source_code: String::empty(),
                        specifier: String::empty(),
                        source_url: String::empty(),
                        cjs_custom_extension_index: strong.get(),
                        tag: ResolvedSource::Tag::CommonJsCustomExtension,
                        ..Default::default()
                    });
                    return core::ptr::null_mut();
                }
            }
            // TODO(port): ExtensionEntry enum variants — placeholder names.
        }
    }

    let module_type: options::ModuleType = 'brk: {
        let ext = lr.path.name.ext;
        // regular expression /.[cm][jt]s$/
        if ext.len() == b".cjs".len() {
            if strings::eql_comptime_ignore_len(ext, b".cjs") {
                break 'brk ModuleType::Cjs;
            }
            if strings::eql_comptime_ignore_len(ext, b".mjs") {
                break 'brk ModuleType::Esm;
            }
            if strings::eql_comptime_ignore_len(ext, b".cts") {
                break 'brk ModuleType::Cjs;
            }
            if strings::eql_comptime_ignore_len(ext, b".mts") {
                break 'brk ModuleType::Esm;
            }
        }
        // regular expression /.[jt]s$/
        if ext.len() == b".ts".len() {
            if strings::eql_comptime_ignore_len(ext, b".js")
                || strings::eql_comptime_ignore_len(ext, b".ts")
            {
                // Use the package.json module type if it exists
                break 'brk if let Some(pkg) = lr.package_json {
                    // SAFETY: package_json from resolver cache.
                    unsafe { (*pkg).module_type }
                } else {
                    ModuleType::Unknown
                };
            }
        }
        // For JSX TSX and other extensions, let the file contents.
        ModuleType::Unknown
    };

    let pkg_name: Option<&[u8]> = if let Some(pkg) = lr.package_json {
        // SAFETY: package_json from resolver cache.
        let name = unsafe { &(*pkg).name };
        if !name.is_empty() {
            Some(name)
        } else {
            None
        }
    } else {
        None
    };

    // We only run the transpiler concurrently when we can.
    // Today, that's:
    //
    //   Import Statements (import 'foo')
    //   Import Expressions (import('foo'))
    //
    'transpile_async: {
        if FeatureFlags::CONCURRENT_TRANSPILER {
            let concurrent_loader = lr.loader.unwrap_or(options::Loader::File);
            if blob_to_deinit.is_none()
                && allow_promise
                && (jsc_vm.has_loaded || jsc_vm.is_in_preload)
                && concurrent_loader.is_java_script_like()
                && !lr.is_main
                // Plugins make this complicated,
                // TODO: allow running concurrently when no onLoad handlers match a plugin.
                && jsc_vm.plugin_runner.is_none()
                && jsc_vm.transpiler_store.enabled
            {
                // This absolutely disgusting hack is a workaround in cases
                // where an async import is made to a CJS file with side
                // effects that other modules depend on, without incurring
                // the cost of transpiling/loading CJS modules synchronously.
                //
                // The cause of this comes from the fact that we immediately
                // and synchronously evaluate CJS modules after they've been
                // transpiled, but transpiling (which, for async imports,
                // happens in a thread pool), can resolve in whatever order.
                // This messes up module execution order.
                //
                // This is only _really_ important for
                // import("some-polyfill") cases, the most impactful of
                // which is `reflect-metadata`. People could also use
                // require or just preload their polyfills, but they aren't
                // doing this. This hack makes important polyfills work without
                // incurring the cost of transpiling/loading CJS modules
                // synchronously. The proper fix is to evaluate CJS modules
                // at the same time as ES modules. This is blocked by the
                // fact that we need exports from CJS modules and our parser
                // doesn't record them.
                if let Some(pkg_name_) = pkg_name {
                    for always_sync_specifier in ALWAYS_SYNC_MODULES {
                        if pkg_name_ == *always_sync_specifier {
                            break 'transpile_async;
                        }
                    }
                    // PERF(port): was `inline for` — profile in Phase B.
                }

                // TODO: check if the resolved source must be transpiled synchronously
                return jsc_vm.transpiler_store.transpile(
                    jsc_vm,
                    global_object,
                    specifier_ptr.dupe_ref(),
                    lr.path,
                    referrer.dupe_ref(),
                    concurrent_loader,
                    lr.package_json,
                ) as *mut c_void;
            }
        }
    }

    let synchronous_loader: options::Loader = match lr.loader {
        Some(l) => l,
        None => 'loader: {
            if jsc_vm.has_loaded || jsc_vm.is_in_preload {
                // Extensionless files in this context are treated as the JS loader
                if lr.path.name.ext.is_empty() {
                    break 'loader options::Loader::Tsx;
                }

                // Unknown extensions are to be treated as file loader
                if is_commonjs_require {
                    if jsc_vm.commonjs_custom_extensions.entries.len() > 0
                        && jsc_vm.has_mutated_built_in_extensions == 0
                    {
                        #[cold]
                        fn cold() {}
                        cold();
                        if let Some(entry) =
                            node_module_module::find_longest_registered_extension(jsc_vm, lr.path.text)
                        {
                            match entry {
                                node_module_module::ExtensionEntry::Loader(loader) => {
                                    break 'loader loader
                                }
                                node_module_module::ExtensionEntry::Custom(strong) => {
                                    *ret = ErrorableResolvedSource::ok(ResolvedSource {
                                        allocator: None,
                                        source_code: String::empty(),
                                        specifier: String::empty(),
                                        source_url: String::empty(),
                                        cjs_custom_extension_index: strong.get(),
                                        tag: ResolvedSource::Tag::CommonJsCustomExtension,
                                        ..Default::default()
                                    });
                                    return core::ptr::null_mut();
                                }
                            }
                        }
                    }

                    // For Node.js compatibility, requiring a file with an
                    // unknown extension will be treated as a JS file
                    break 'loader options::Loader::Ts;
                }

                // For ESM, Bun treats unknown extensions as file loader
                break 'loader options::Loader::File;
            } else {
                // Unless it's potentially the main module
                // This is important so that "bun run ./foo-i-have-no-extension" works
                options::Loader::Tsx
            }
        }
    };
    // PORT NOTE: reshaped from `lr.loader orelse loader: { ... }` to match+labeled-block so
    // the inner `return null` targets the outer extern fn, not a closure.

    if Environment::ALLOW_ASSERT {
        bun_output::scoped_log!(
            ModuleLoader,
            "transpile({}, {}, sync)",
            bstr::BStr::new(lr.specifier),
            <&'static str>::from(synchronous_loader)
        );
    }

    let _reset_arena = scopeguard::guard((), |_| {
        jsc_vm.module_loader.reset_arena(jsc_vm);
    });
    // TODO(port): overlapping &mut jsc_vm borrow — Phase B restructure.

    let mut promise: Option<*mut JSInternalPromise> = None;
    let result = transpile_source_code::<{ FetchFlags::Transpile }>(
        jsc_vm,
        lr.specifier,
        referrer_slice.slice(),
        *specifier_ptr,
        lr.path,
        synchronous_loader,
        module_type,
        &mut log,
        lr.virtual_source,
        if allow_promise { Some(&mut promise) } else { None },
        VirtualMachine::source_code_printer().unwrap(),
        Some(global_object),
    );
    match result {
        Ok(resolved) => {
            *ret = ErrorableResolvedSource::ok(resolved);
        }
        Err(err) => {
            if err == bun_core::err!("AsyncModule") {
                debug_assert!(promise.is_some());
                return promise.map_or(core::ptr::null_mut(), |p| p as *mut c_void);
            } else if err == bun_core::err!("PluginError") {
                return core::ptr::null_mut();
            } else if err == bun_core::err!("JSError") {
                *ret = ErrorableResolvedSource::err(
                    bun_core::err!("JSError"),
                    global_object.take_error(bun_core::err!("JSError")),
                );
                return core::ptr::null_mut();
            } else {
                VirtualMachine::process_fetch_log(
                    global_object,
                    *specifier_ptr,
                    *referrer,
                    &mut log,
                    ret,
                    err,
                );
                return core::ptr::null_mut();
            }
        }
    }
    promise.map_or(core::ptr::null_mut(), |p| p as *mut c_void)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__runVirtualModule(
    global_object: &JSGlobalObject,
    specifier_ptr: &String,
) -> JSValue {
    jsc::mark_binding(core::panic::Location::caller());
    if global_object.bun_vm().plugin_runner.is_none() {
        return JSValue::ZERO;
    }

    let specifier_slice = specifier_ptr.to_utf8();
    let specifier = specifier_slice.slice();

    if !PluginRunner::could_be_plugin(specifier) {
        return JSValue::ZERO;
    }

    let namespace = PluginRunner::extract_namespace(specifier);
    let after_namespace = if namespace.is_empty() {
        specifier
    } else {
        &specifier[(namespace.len() + 1).min(specifier.len())..]
    };

    match global_object.run_on_load_plugins(
        String::init(namespace),
        String::init(after_namespace),
        jsc::Target::Bun,
    ) {
        Err(_) => JSValue::ZERO,
        Ok(None) => JSValue::ZERO,
        Ok(Some(v)) => v,
    }
    // TODO(port): jsc::Target::Bun — verify enum name/path.
}

fn get_hardcoded_module(
    jsc_vm: &mut VirtualMachine,
    specifier: String,
    hardcoded: HardcodedModule,
) -> Option<ResolvedSource> {
    analytics::Features::builtin_modules().insert(hardcoded);
    match hardcoded {
        HardcodedModule::BunMain => {
            if jsc_vm.entry_point.generated {
                Some(ResolvedSource {
                    allocator: None,
                    source_code: String::clone_utf8(&jsc_vm.entry_point.contents),
                    specifier,
                    source_url: specifier,
                    tag: ResolvedSource::Tag::Esm,
                    source_code_needs_deref: true,
                    ..Default::default()
                })
            } else {
                None
            }
        }
        HardcodedModule::BunInternalForTesting => {
            if !cfg!(debug_assertions) {
                // SAFETY: single-threaded read of a process-global flag.
                if unsafe { !IS_ALLOWED_TO_USE_INTERNAL_TESTING_APIS } {
                    return None;
                }
            }
            Some(js_synthetic_module(
                ResolvedSource::Tag::BunInternalForTesting,
                specifier,
            ))
        }
        HardcodedModule::BunWrap => Some(ResolvedSource {
            allocator: None,
            source_code: String::init(Runtime::Runtime::source_code()),
            specifier,
            source_url: specifier,
            ..Default::default()
        }),
        other => {
            // Zig: `inline else => |tag| jsSyntheticModule(@field(ResolvedSource.Tag, @tagName(tag)), specifier)`
            // Map HardcodedModule variant → ResolvedSource::Tag of the same name.
            Some(js_synthetic_module(
                ResolvedSource::Tag::from_hardcoded_module(other),
                specifier,
            ))
            // TODO(port): ResolvedSource::Tag::from_hardcoded_module — needs a generated
            // mapping table (HardcodedModule tag name → ResolvedSource::Tag). Phase B
            // should add this to the codegen that already produces both enums.
        }
    }
}

pub fn fetch_builtin_module(
    jsc_vm: &mut VirtualMachine,
    specifier: String,
) -> Result<Option<ResolvedSource>, bun_core::Error> {
    // TODO(port): narrow error set
    if let Some(hardcoded) = HardcodedModule::MAP.get_with_eql(specifier, String::eql_comptime) {
        // TODO(port): phf custom hasher for getWithEql.
        return Ok(get_hardcoded_module(jsc_vm, specifier, hardcoded));
    }

    if specifier.has_prefix_comptime(js_ast::Macro::NAMESPACE_WITH_COLON) {
        let spec = specifier.to_utf8();
        if let Some(entry) = jsc_vm
            .macro_entry_points
            .get(MacroEntryPoint::generate_id_from_specifier(spec.slice()))
        {
            return Ok(Some(ResolvedSource {
                allocator: None,
                source_code: String::clone_utf8(&entry.source.contents),
                specifier,
                source_url: specifier.dupe_ref(),
                ..Default::default()
            }));
        }
    } else if let Some(graph) = jsc_vm.standalone_module_graph.as_mut() {
        let specifier_utf8 = specifier.to_utf8();
        if let Some(file) = graph.files.get_ptr(specifier_utf8.slice()) {
            if file.loader == options::Loader::Sqlite
                || file.loader == options::Loader::SqliteEmbedded
            {
                const CODE: &[u8] = b"/* Generated code */\n\
import {Database} from 'bun:sqlite';\n\
import {readFileSync} from 'node:fs';\n\
export const db = new Database(readFileSync(import.meta.path));\n\
\n\
export const __esModule = true;\n\
export default db;";
                return Ok(Some(ResolvedSource {
                    allocator: None,
                    source_code: String::static_(CODE),
                    specifier,
                    source_url: specifier.dupe_ref(),
                    source_code_needs_deref: false,
                    ..Default::default()
                }));
            }

            return Ok(Some(ResolvedSource {
                allocator: None,
                source_code: file.to_wtf_string(),
                specifier,
                source_url: specifier.dupe_ref(),
                // bytecode_origin_path is the path used when generating bytecode; must match for cache hits
                bytecode_origin_path: if !file.bytecode_origin_path.is_empty() {
                    String::from_bytes(&file.bytecode_origin_path)
                } else {
                    String::empty()
                },
                source_code_needs_deref: false,
                bytecode_cache: if !file.bytecode.is_empty() {
                    Some(file.bytecode.as_ptr())
                } else {
                    None
                },
                bytecode_cache_size: file.bytecode.len(),
                module_info: if !file.module_info.is_empty() {
                    analyze_transpiled_module::ModuleInfoDeserialized::create_from_cached_record(
                        &file.module_info,
                    )
                    .map(|p| p as *mut c_void)
                } else {
                    None
                },
                is_commonjs_module: file.module_format == ModuleFormat::Cjs,
                // TODO(port): ModuleFormat enum — placeholder.
                ..Default::default()
            }));
        }
    }

    Ok(None)
}

// TODO(port): placeholder; from standalone_module_graph.
#[allow(dead_code)]
struct ModuleFormat;

#[unsafe(no_mangle)]
extern "C" fn Bun__transpileVirtualModule(
    global_object: &JSGlobalObject,
    specifier_ptr: &String,
    referrer_ptr: &String,
    source_code: &mut ZigString,
    loader_: api::Loader,
    ret: &mut ErrorableResolvedSource,
) -> bool {
    jsc::mark_binding(core::panic::Location::caller());
    let jsc_vm = global_object.bun_vm();
    // Plugin runner is not required for virtual modules created via build.module()
    // bun.assert(jsc_vm.plugin_runner != null);

    let specifier_slice = specifier_ptr.to_utf8();
    let specifier = specifier_slice.slice();
    let source_code_slice = source_code.to_slice();
    let referrer_slice = referrer_ptr.to_utf8();

    let virtual_source = logger::Source::init_path_string(specifier, source_code_slice.slice());
    let mut log = logger::Log::init();
    let path = Fs::Path::init(specifier);

    let loader = if loader_ != api::Loader::None {
        options::Loader::from_api(loader_)
    } else {
        jsc_vm
            .transpiler
            .options
            .loaders
            .get(path.name.ext)
            .copied()
            .unwrap_or_else(|| {
                if strings::eql_long(specifier, &jsc_vm.main, true) {
                    options::Loader::Js
                } else {
                    options::Loader::File
                }
            })
    };

    let _reset_arena = scopeguard::guard((), |_| {
        jsc_vm.module_loader.reset_arena(jsc_vm);
    });
    // TODO(port): overlapping &mut jsc_vm borrow — Phase B restructure.

    let result = transpile_source_code::<{ FetchFlags::Transpile }>(
        jsc_vm,
        specifier_slice.slice(),
        referrer_slice.slice(),
        *specifier_ptr,
        path,
        loader,
        ModuleType::Unknown,
        &mut log,
        Some(&virtual_source),
        None,
        VirtualMachine::source_code_printer().unwrap(),
        Some(global_object),
    );
    match result {
        Ok(resolved) => {
            *ret = ErrorableResolvedSource::ok(resolved);
        }
        Err(err) => {
            if err == bun_core::err!("PluginError") {
                return true;
            } else if err == bun_core::err!("JSError") {
                *ret = ErrorableResolvedSource::err(
                    bun_core::err!("JSError"),
                    global_object.take_error(bun_core::err!("JSError")),
                );
                return true;
            } else {
                VirtualMachine::process_fetch_log(
                    global_object,
                    *specifier_ptr,
                    *referrer_ptr,
                    &mut log,
                    ret,
                    err,
                );
                return true;
            }
        }
    }
    analytics::Features::virtual_modules_inc(1);
    // TODO(port): analytics.Features.virtual_modules += 1 — verify counter API.
    true
}

#[inline]
fn js_synthetic_module(name: ResolvedSource::Tag, specifier: String) -> ResolvedSource {
    ResolvedSource {
        allocator: None,
        source_code: String::empty(),
        specifier,
        source_url: String::static_(<&'static str>::from(name).as_bytes()),
        tag: name,
        source_code_needs_deref: false,
        ..Default::default()
    }
}

/// Support embedded .node files
#[unsafe(no_mangle)]
extern "C" fn Bun__resolveEmbeddedNodeFile(vm: &mut VirtualMachine, in_out_str: &mut String) -> bool {
    if vm.standalone_module_graph.is_none() {
        return false;
    }

    let input_path = in_out_str.to_utf8();
    let mut path_buf = bun_paths::path_buffer_pool().get();
    let Some(result) = resolve_embedded_file(vm, &mut *path_buf, input_path.slice(), b"node") else {
        return false;
    };
    *in_out_str = String::clone_utf8(result);
    true
}

#[unsafe(no_mangle)]
extern "C" fn ModuleLoader__isBuiltin(data: *const u8, len: usize) -> bool {
    // SAFETY: caller (C++) guarantees data points to len valid bytes.
    let str = unsafe { core::slice::from_raw_parts(data, len) };
    HardcodedModule::Alias::BUN_ALIASES.get(str).is_some()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ModuleLoader.zig (1396 lines)
//   confidence: medium
//   todos:      47
//   notes:      Heavy defer/scopeguard usage with overlapping &mut borrows on jsc_vm needs Phase B restructuring; many cross-crate placeholder types (ParseOptions, RuntimeTranspilerCache, ExtensionEntry, ResolvedSource::Tag mapping); put_mappings signature needs `&[u8]` to avoid copy.
// ──────────────────────────────────────────────────────────────────────────
