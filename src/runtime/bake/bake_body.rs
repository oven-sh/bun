//! Bake is Bun's toolkit for building client+server web applications. It
//! combines `Bun.build` and `Bun.serve`, providing a hot-reloading development
//! server, server components, and other integrations. Instead of taking the
//! role as a framework, Bake is tool for frameworks to build on top of.
#![allow(unexpected_cfgs)] // `bun_codegen_embed` is set via RUSTFLAGS (scripts/build/rust.ts) for release/CI builds.

use core::ptr::NonNull;
use std::borrow::Cow;

use bun_alloc::Arena;
use bun_collections::StringArrayHashMap;
use bun_core::Output;
use bun_core::{ZBox, ZStr, strings};
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_options_types::schema as bun_schema;
use bun_paths::PathBuffer;

use crate::api::js_bundler::Plugin;
use crate::api::js_bundler::js_bundler::PluginJscExt as _;

// Note: parent `mod.rs` already declares `dev_server` / `framework_router`
// as sibling modules of this file; pull them in instead of re-declaring (which
// would duplicate the module tree and fail on `framework_router` having no
// matching filename).
use super::{
    BuildConfigSubset, BuiltInModule, FileSystemRouterType, Framework, ReactFastRefresh,
    ServerComponents, SplitBundlerOptions, dev_server, framework_router,
};

// Note: `pub use dev_server as DevServer` / `framework_router as
// FrameworkRouter` are already provided by the parent `mod.rs` (lines 349/369);
// re-exporting here triggers E0365 because `bake_body` is a private module.

use bun_bundler_jsc::source_map_mode_jsc::source_map_mode_from_js;

/// export default { app: ... };
const API_NAME: &str = "app";

/// Rust version of the TS definition 'Bake.Options' in 'bake.d.ts'
pub(crate) struct UserOptions {
    /// Backs the transpilers set up from these options.
    pub(crate) arena: Arena,

    pub(crate) root: ZBox,
    pub(crate) framework: Framework,
    pub(crate) bundler_options: SplitBundlerOptions,
}

impl Drop for UserOptions {
    fn drop(&mut self) {
        if let Some(p) = self.bundler_options.plugin {
            // `p` is the FFI handle returned by `Plugin::create` in
            // `parse_plugin_array`; `PluginJscExt::destroy` is its paired
            // (safe) destructor — it null-checks via `opaque_ref` and
            // unprotect()s the JSCell / tombstones the C++ object.
            Plugin::destroy(p.as_ptr());
        }
    }
}

impl UserOptions {
    /// Currently, this function must run at the top of the event loop.
    pub(crate) fn from_js(config: JSValue, global: &JSGlobalObject) -> JsResult<UserOptions> {
        let arena = Arena::new();
        let mut bundler_options = SplitBundlerOptions::default();

        if !config.is_object() {
            // Allow users to do `export default { app: 'react' }` for convenience
            if config.is_string() {
                let bunstr = config.to_bun_string(global)?;
                let utf8_string = bunstr.to_utf8();

                if strings::eql(utf8_string.slice(), b"react") {
                    let root = match bun_sys::getcwd_alloc() {
                        Ok(z) => z,
                        Err(e) => {
                            return Err(global.throw_error(
                                e.to_zig_err(),
                                "while querying current working directory",
                            ));
                        }
                    };

                    return Ok(UserOptions {
                        root,
                        framework: Framework::react(),
                        bundler_options,
                        arena,
                    });
                }
            }
            return Err(
                global.throw_invalid_arguments(format_args!("'{}' is not an object", API_NAME))
            );
        }

        if let Some(js_options) = config.get_optional::<JSValue>(global, "bundlerOptions")? {
            if let Some(server_options) = js_options.get_optional::<JSValue>(global, "server")? {
                bundler_options.server = BuildConfigSubset::from_js(global, server_options)?;
            }
            if let Some(client_options) = js_options.get_optional::<JSValue>(global, "client")? {
                bundler_options.client = BuildConfigSubset::from_js(global, client_options)?;
            }
            if let Some(ssr_options) = js_options.get_optional::<JSValue>(global, "ssr")? {
                bundler_options.ssr = BuildConfigSubset::from_js(global, ssr_options)?;
            }
        }

        let framework = Framework::from_js(
            match config.get(global, "framework")? {
                Some(v) => v,
                None => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "'{}' is missing 'framework'",
                        API_NAME
                    )));
                }
            },
            global,
            &mut bundler_options,
        )?;

        let root = if let Some(slice) = config.get_optional_slice(global, "root")? {
            ZBox::from_bytes(slice.slice())
        } else {
            match bun_sys::getcwd_alloc() {
                Ok(z) => z,
                Err(e) => {
                    return Err(global
                        .throw_error(e.to_zig_err(), "while querying current working directory"));
                }
            }
        };

        if let Some(plugin_array) = config.get(global, "plugins")? {
            bundler_options.parse_plugin_array(plugin_array, global)?;
        }

        Ok(UserOptions {
            root,
            framework,
            bundler_options,
            arena,
        })
    }
}

impl SplitBundlerOptions {
    fn parse_plugin_array(
        &mut self,
        plugin_array: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        // Create the Plugin and assign it to `opts.plugin` BEFORE iterating,
        // so `plugins: []` still leaves `self.plugin = Some(_)`.
        let plugin: NonNull<Plugin> = match self.plugin {
            Some(p) => p,
            None => {
                let p = Plugin::create(global, crate::api::js_bundler::BunPluginTarget::Bun);
                let p = NonNull::new(p)
                    .expect("JSBundlerPlugin__create returns a non-null protected JSCell");
                self.plugin = Some(p);
                p
            }
        };
        let empty_object = JSValue::create_empty_object(global, 0);

        let mut iter = plugin_array.array_iterator(global)?;
        while let Some(plugin_config) = iter.next()? {
            if !plugin_config.is_object() {
                return Err(
                    global.throw_invalid_arguments(format_args!("Expected plugin to be an object"))
                );
            }

            if let Some(slice) = plugin_config.get_optional_slice(global, "name")? {
                if slice.slice().is_empty() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Expected plugin to have a non-empty name"
                    )));
                }
            } else {
                return Err(
                    global.throw_invalid_arguments(format_args!("Expected plugin to have a name"))
                );
            }

            let function = match plugin_config.get_function(global, "setup")? {
                Some(f) => f,
                None => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Expected plugin to have a setup() function"
                    )));
                }
            };

            // `Plugin` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
            // deref. Handle held live in `self.plugin` (protected JSCell).
            let plugin_result = Plugin::opaque_mut(plugin.as_ptr()).add_plugin(
                function,
                empty_object,
                JSValue::NULL,
                false,
                true,
            )?;

            if let Some(promise) = plugin_result.as_any_promise() {
                promise.set_handled(global.vm());
                // TODO: remove this call, replace with a promise list that must
                // be resolved before the first bundle task can begin.
                // SAFETY: `bun_vm()` returns a non-null `*mut VirtualMachineRef`
                // live for the lifetime of the global object.
                global
                    .bun_vm()
                    .as_mut()
                    .wait_for_promise(promise)
                    .map_err(|stopped| stopped.throw(global))?;
                match promise.unwrap(global.vm(), bun_jsc::PromiseUnwrapMode::MarkHandled) {
                    bun_jsc::PromiseResult::Pending => unreachable!("wait_for_promise returned Ok"),
                    bun_jsc::PromiseResult::Fulfilled(_val) => {}
                    bun_jsc::PromiseResult::Rejected(err) => {
                        return Err(global.throw_value(err));
                    }
                }
            }
        }
        Ok(())
    }
}

impl BuildConfigSubset {
    pub(crate) fn from_js(
        global: &JSGlobalObject,
        js_options: JSValue,
    ) -> JsResult<BuildConfigSubset> {
        let mut options = BuildConfigSubset::default();

        'brk: {
            let Some(val) = js_options.get_optional::<JSValue>(global, "sourcemap")? else {
                break 'brk;
            };
            if let Some(sourcemap) = source_map_mode_from_js(global, val)? {
                options.source_map = sourcemap;
                break 'brk;
            }

            return Err(crate::node::validators::throw_err_invalid_arg_type(
                global,
                format_args!("sourcemap"),
                "\"inline\" | \"external\" | \"linked\"",
                val,
            ));
        }

        'brk: {
            let Some(minify_options) = js_options.get_optional::<JSValue>(global, "minify")? else {
                break 'brk;
            };
            if minify_options.is_boolean() && minify_options.as_boolean() {
                options.minify_syntax = Some(minify_options.as_boolean());
                options.minify_identifiers = Some(minify_options.as_boolean());
                options.minify_whitespace = Some(minify_options.as_boolean());
                break 'brk;
            }

            if let Some(value) = minify_options.get_boolean_loose(global, "whitespace")? {
                options.minify_whitespace = Some(value);
            }
            if let Some(value) = minify_options.get_boolean_loose(global, "syntax")? {
                options.minify_syntax = Some(value);
            }
            if let Some(value) = minify_options.get_boolean_loose(global, "identifiers")? {
                options.minify_identifiers = Some(value);
            }
        }

        Ok(options)
    }
}

impl Framework {
    /// Bun provides built-in support for using React as a framework.
    /// Depends on externally provided React
    ///
    /// $ bun i react@experimental react-dom@experimental react-refresh@experimental react-server-dom-bun
    pub(crate) fn react() -> Framework {
        // Cannot use .import because resolution must happen from the user's POV
        let built_in: [(&[u8], &[u8]); 3] = [
            (
                b"bun-framework-react/client.tsx",
                // Browser-side source: compressed in release builds.
                bun_zstd::embed_compressed!(src "runtime/bake/bun-framework-react/client.tsx"),
            ),
            (
                b"bun-framework-react/server.tsx",
                bun_core::runtime_embed_file!(Src, "runtime/bake/bun-framework-react/server.tsx")
                    .as_bytes(),
            ),
            (
                b"bun-framework-react/ssr.tsx",
                bun_core::runtime_embed_file!(Src, "runtime/bake/bun-framework-react/ssr.tsx")
                    .as_bytes(),
            ),
        ];
        let mut built_in_modules = StringArrayHashMap::new();
        for (path, code) in built_in {
            bun_core::handle_oom(built_in_modules.put(path, BuiltInModule::Code(code.into())));
        }

        Framework {
            is_built_in_react: true,
            server_components: Some(ServerComponents {
                separate_ssr_graph: true,
                ..ServerComponents::new(Cow::Borrowed(b"react-server-dom-bun/server"))
            }),
            react_fast_refresh: Some(ReactFastRefresh::default()),
            file_system_router_types: vec![FileSystemRouterType {
                root: Cow::Borrowed(b"pages"),
                prefix: Cow::Borrowed(b"/"),
                entry_client: Some(Cow::Borrowed(b"bun-framework-react/client.tsx")),
                entry_server: Cow::Borrowed(b"bun-framework-react/server.tsx"),
                ignore_underscores: true,
                ignore_dirs: literals(&[b"node_modules", b".git"]),
                extensions: literals(&[b".tsx", b".jsx"]),
                style: framework_router::Style::NextjsPages,
                allow_layouts: true,
            }],
            built_in_modules,
        }
    }

    /// Default that requires no packages or configuration.
    /// - If `react-refresh` is installed, enable react fast refresh with it.
    ///     - Otherwise, if `react` is installed, use a bundled copy of
    ///     react-refresh so that it still works.
    /// - If any file system router types are provided, configure using
    ///   the above react configuration.
    pub(crate) fn auto(
        resolver: &mut bun_resolver::Resolver,
        file_system_router_types: Vec<FileSystemRouterType>,
    ) -> Framework {
        let mut fw = Framework::default();

        if !file_system_router_types.is_empty() {
            fw = Self::react();
            fw.file_system_router_types = file_system_router_types;
        }

        if let Some(rfr) = resolve_or_null(resolver, b"react-refresh/runtime") {
            fw.react_fast_refresh = Some(ReactFastRefresh { import_source: rfr });
        } else if resolve_or_null(resolver, b"react").is_some() {
            fw.react_fast_refresh = Some(ReactFastRefresh {
                import_source: Cow::Borrowed(b"react-refresh/runtime/index.js"),
            });
            let react_refresh_code: &[u8] =
                bun_zstd::embed_compressed!(codegen "node-fallbacks/react-refresh.js");
            bun_core::handle_oom(fw.built_in_modules.put(
                b"react-refresh/runtime/index.js",
                BuiltInModule::Code(react_refresh_code.into()),
            ));
        }

        fw
    }

    fn from_js(
        opts: JSValue,
        global: &JSGlobalObject,
        bundler_options: &mut SplitBundlerOptions,
    ) -> JsResult<Framework> {
        if opts.is_string() {
            let str = opts.to_bun_string(global)?;

            // Deprecated
            if str.eq_ascii(b"react-server-components") {
                bun_core::warn!(
                    "deprecation notice: 'react-server-components' will be renamed to 'react'"
                );
                return Ok(Framework::react());
            }

            if str.eq_ascii(b"react") {
                return Ok(Framework::react());
            }
        }

        if !opts.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Framework must be an object")));
        }

        if opts.get(global, "serverEntryPoint")?.is_some() {
            bun_core::warn!(
                "deprecation notice: 'framework.serverEntryPoint' has been replaced with 'fileSystemRouterTypes[n].serverEntryPoint'"
            );
        }
        if opts.get(global, "clientEntryPoint")?.is_some() {
            bun_core::warn!(
                "deprecation notice: 'framework.clientEntryPoint' has been replaced with 'fileSystemRouterTypes[n].clientEntryPoint'"
            );
        }

        let react_fast_refresh: Option<ReactFastRefresh> = 'brk: {
            let Some(rfr) = opts.get(global, "reactFastRefresh")? else {
                break 'brk None;
            };

            if rfr == JSValue::TRUE {
                break 'brk Some(ReactFastRefresh::default());
            }
            if rfr == JSValue::FALSE || rfr.is_undefined_or_null() {
                break 'brk None;
            }

            if !rfr.is_object() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "'framework.reactFastRefresh' must be an object or 'true'"
                )));
            }

            let prop = match rfr.get(global, "importSource")? {
                Some(p) => p,
                None => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "'framework.reactFastRefresh' is missing 'importSource'"
                    )));
                }
            };

            let str = prop.to_bun_string(global)?;

            Some(ReactFastRefresh {
                import_source: Cow::Owned(str.into_utf8().into_vec()),
            })
        };
        let server_components: Option<ServerComponents> = 'sc: {
            let Some(sc) = opts.get(global, "serverComponents")? else {
                break 'sc None;
            };
            if sc == JSValue::FALSE || sc.is_undefined_or_null() {
                break 'sc None;
            }

            if !sc.is_object() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "'framework.serverComponents' must be an object or 'undefined'"
                )));
            }

            let separate_ssr_graph = 'brk: {
                // Intentionally not using a truthiness check
                let prop = match sc.get_optional::<JSValue>(global, "separateSSRGraph")? {
                    Some(p) => p,
                    None => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "Missing 'framework.serverComponents.separateSSRGraph'"
                        )));
                    }
                };
                if prop == JSValue::TRUE {
                    break 'brk true;
                }
                if prop == JSValue::FALSE {
                    break 'brk false;
                }
                return Err(global.throw_invalid_arguments(format_args!(
                    "'framework.serverComponents.separateSSRGraph' must be a boolean"
                )));
            };
            let Some(server_runtime_import) =
                get_optional_string(sc, global, b"serverRuntimeImportSource")?
            else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Missing 'framework.serverComponents.serverRuntimeImportSource'"
                )));
            };
            let mut server_components = ServerComponents {
                separate_ssr_graph,
                ..ServerComponents::new(server_runtime_import)
            };
            if let Some(name) =
                get_optional_string(sc, global, b"serverRegisterClientReferenceExport")?
            {
                server_components.server_register_client_reference = name;
            }
            Some(server_components)
        };
        let built_in_modules: StringArrayHashMap<BuiltInModule> = 'built_in_modules: {
            let Some(array) = opts.get_array(global, "builtInModules")? else {
                break 'built_in_modules StringArrayHashMap::new();
            };

            let len = array.get_length(global)?;
            let mut files: StringArrayHashMap<BuiltInModule> = StringArrayHashMap::new();
            bun_core::handle_oom(files.ensure_total_capacity(len as usize));

            let mut it = array.array_iterator(global)?;
            let mut i: usize = 0;
            while let Some(file) = it.next()? {
                if !file.is_object() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "'builtInModules[{}]' is not an object",
                        i
                    )));
                }

                let path = match file.get_optional_slice(global, b"import")? {
                    Some(p) => p,
                    None => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "'builtInModules[{}]' is missing 'import'",
                            i
                        )));
                    }
                };

                let value: BuiltInModule =
                    if let Some(str) = get_optional_string(file, global, b"path")? {
                        BuiltInModule::Import(str.into_owned().into())
                    } else if let Some(str) = get_optional_string(file, global, b"code")? {
                        BuiltInModule::Code(str.into_owned().into())
                    } else {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "'builtInModules[{}]' needs either 'path' or 'code'",
                            i
                        )));
                    };

                files.put_assume_capacity(path.slice(), value);
                i += 1;
            }

            files
        };
        let file_system_router_types: Vec<FileSystemRouterType> = 'brk: {
            let array: JSValue = match opts.get_array(global, "fileSystemRouterTypes")? {
                Some(a) => a,
                None => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Missing 'framework.fileSystemRouterTypes'"
                    )));
                }
            };
            let len = array.get_length(global)?;
            if len > 256 {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Framework can only define up to 256 file-system router types"
                )));
            }
            let mut file_system_router_types = Vec::with_capacity(len as usize);

            let mut it = array.array_iterator(global)?;
            let mut i: usize = 0;
            while let Some(fsr_opts) = it.next()? {
                let root = match get_optional_string(fsr_opts, global, b"root")? {
                    Some(r) => r,
                    None => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "'fileSystemRouterTypes[{}]' is missing 'root'",
                            i
                        )));
                    }
                };
                let server_entry_point =
                    match get_optional_string(fsr_opts, global, b"serverEntryPoint")? {
                        Some(s) => s,
                        None => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "'fileSystemRouterTypes[{}]' is missing 'serverEntryPoint'",
                                i
                            )));
                        }
                    };
                let client_entry_point =
                    get_optional_string(fsr_opts, global, b"clientEntryPoint")?;
                let prefix = get_optional_string(fsr_opts, global, b"prefix")?
                    .unwrap_or(Cow::Borrowed(b"/"));
                let ignore_underscores = fsr_opts
                    .get_boolean_strict(global, "ignoreUnderscores")?
                    .unwrap_or(false);
                let layouts = fsr_opts
                    .get_boolean_strict(global, "layouts")?
                    .unwrap_or(false);

                let style = style_from_js(
                    match fsr_opts.get(global, "style")? {
                        Some(s) => s,
                        None => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "'fileSystemRouterTypes[{}]' is missing 'style'",
                                i
                            )));
                        }
                    },
                    global,
                )?;
                // errdefer style.deinit() — handled by Style's Drop

                let extensions: Vec<Cow<'static, [u8]>> = if let Some(exts_js) =
                    fsr_opts.get(global, "extensions")?
                {
                    'exts: {
                        if exts_js.is_string() {
                            let str = exts_js.to_utf8(global)?;
                            if str.slice() == b"*" {
                                break 'exts Vec::new();
                            }
                        } else if exts_js.is_array() {
                            let mut it_2 = exts_js.array_iterator(global)?;
                            let mut extensions =
                                Vec::with_capacity(exts_js.get_length(global)? as usize);
                            while let Some(array_item) = it_2.next()? {
                                let mut slice = array_item.to_utf8(global)?.into_vec();
                                if slice == b"*" {
                                    return Err(global.throw_invalid_arguments(format_args!(
                                            "'extensions' cannot include \"*\" as an extension. Pass \"*\" instead of the array."
                                        )));
                                }

                                if slice.is_empty() {
                                    return Err(global.throw_invalid_arguments(format_args!(
                                        "'extensions' cannot include \"\" as an extension."
                                    )));
                                }

                                if slice[0] != b'.' {
                                    slice.insert(0, b'.');
                                }
                                extensions.push(Cow::Owned(slice));
                            }
                            break 'exts extensions;
                        }

                        return Err(global.throw_invalid_arguments(format_args!(
                            "'extensions' must be an array of strings or \"*\" for all extensions"
                        )));
                    }
                } else {
                    literals(&[
                        b".jsx", b".tsx", b".js", b".ts", b".cjs", b".cts", b".mjs", b".mts",
                    ])
                };

                let ignore_dirs: Vec<Cow<'static, [u8]>> =
                    if let Some(exts_js) = fsr_opts.get(global, "ignoreDirs")? {
                        'exts: {
                            if exts_js.is_array() {
                                let mut it_2 = array.array_iterator(global)?;
                                let mut dirs = Vec::with_capacity(len as usize);
                                while let Some(array_item) = it_2.next()? {
                                    dirs.push(Cow::Owned(array_item.to_utf8(global)?.into_vec()));
                                }
                                break 'exts dirs;
                            }

                            return Err(global.throw_invalid_arguments(format_args!(
                            "'ignoreDirs' must be an array of strings or \"*\" for all extensions"
                        )));
                        }
                    } else {
                        literals(&[b".git", b"node_modules"])
                    };

                file_system_router_types.push(FileSystemRouterType {
                    root,
                    prefix,
                    style,
                    entry_server: server_entry_point,
                    entry_client: client_entry_point,
                    ignore_underscores,
                    extensions,
                    ignore_dirs,
                    allow_layouts: layouts,
                });
                i += 1;
            }

            break 'brk file_system_router_types;
        };
        // errdefer for (file_system_router_types) |*fsr| fsr.style.deinit();
        // — Vec<FileSystemRouterType> drops contents on early return.

        let framework = Framework {
            is_built_in_react: false,
            file_system_router_types,
            react_fast_refresh,
            server_components,
            built_in_modules,
        };

        if let Some(plugin_array) = opts.get_optional::<JSValue>(global, "plugins")? {
            bundler_options.parse_plugin_array(plugin_array, global)?;
        }

        Ok(framework)
    }

    /// Returns the arena slot for the `bake_types::Framework` projection; caller must `drop_in_place` it.
    pub(crate) fn init_transpiler<'a>(
        &mut self,
        arena: &'a Arena,
        log: &mut bun_ast::Log,
        mode: Mode,
        renderer: Graph,
        out: &mut core::mem::MaybeUninit<bun_bundler::Transpiler<'a>>,
        bundler_options: &BuildConfigSubset,
    ) -> crate::Result<*mut bun_bundler::bake_types::Framework> {
        // `ASTMemoryAllocator::enter` returns an RAII `Scope` whose `Drop`
        // runs `exit()` at end-of-fn.
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(arena);
        let _ast_scope = ast_memory_allocator.enter();

        // The caller (`DevServer::init`) hands us an uninitialized slot, so
        // use `MaybeUninit::write` (no drop of prior bytes) then reborrow as
        // `&mut Transpiler` for the field assignments below.
        let out: &mut bun_bundler::Transpiler = out.write(bun_bundler::Transpiler::init(
            arena,
            log,
            // `TransformOptions::default()`: every `Option` is `None`, every
            // slice empty, every scalar zero/false.
            bun_schema::api::TransformOptions::default(),
            None,
        )?);

        out.options.target = match renderer {
            Graph::Client => bun_ast::Target::Browser,
            Graph::Server | Graph::Ssr => bun_ast::Target::Bun,
        };
        out.options.public_path = match renderer {
            Graph::Client => dev_server::CLIENT_PREFIX.as_bytes().into(),
            Graph::Server | Graph::Ssr => Box::default(),
        };
        out.options.entry_points = Box::default();
        out.options.log = log;
        out.options.output_format = mode.output_format();
        out.options.out_extensions = bun_collections::StringHashMap::new();
        out.options.hot_module_reloading = mode == Mode::Development;
        out.options.code_splitting = mode != Mode::Development;

        // force disable filesystem output, even though bundle_v2
        // is special cased to return before that code is reached.
        out.options.output_dir = Box::default();

        // framework configuration
        out.options.react_fast_refresh = mode == Mode::Development
            && renderer == Graph::Client
            && self.react_fast_refresh.is_some();
        out.options.server_components = self.server_components.is_some();

        out.options.conditions = bun_bundler::options::ESMConditions::init(
            out.options.target.default_conditions(),
            out.options.target.is_server_side(),
            &[],
        )?;
        if renderer == Graph::Server && self.server_components.is_some() {
            out.options.conditions.append_slice(&[b"react-server"])?;
        }
        if mode == Mode::Development {
            // Support `esm-env` package using this condition.
            out.options.conditions.append_slice(&[b"development"])?;
        }
        // Ensure "node" condition is included for server-side rendering
        // This helps with package.json imports field resolution
        if renderer == Graph::Server || renderer == Graph::Ssr {
            out.options.conditions.append_slice(&[b"node"])?;
        }

        out.options.production = mode != Mode::Development;
        out.options.tree_shaking = mode != Mode::Development;
        // The dev server never minifies.
        let minify = |option: Option<bool>| mode != Mode::Development && option.unwrap_or(true);
        out.options.minify_syntax = minify(bundler_options.minify_syntax);
        out.options.minify_identifiers = minify(bundler_options.minify_identifiers);
        out.options.minify_whitespace = minify(bundler_options.minify_whitespace);
        out.options.css_chunking = true;
        // The bundler crate (lower tier) carries a TYPE_ONLY projection
        // (`bake_types::Framework`); construct it here and give it arena
        // lifetime so `BundleOptions<'a>` can borrow it for the bundle pass.
        let framework_view: *mut bun_bundler::bake_types::Framework =
            arena.alloc(self.as_bundler_view());
        // SAFETY: `arena.alloc` returns a non-null, initialized pointer backed by `arena: &'a Arena`,
        // which outlives `out: &mut Transpiler<'a>`, so borrowing it as `&'a Framework` is sound.
        out.options.framework = Some(unsafe { &*framework_view });
        out.options.inline_entrypoint_import_meta_main = true;

        out.options.source_map = match mode {
            // Source maps must always be external, as DevServer special cases
            // the linking and part of the generation of these. It also relies
            // on source maps always being enabled.
            Mode::Development => bun_bundler::options::SourceMapOption::External,
            Mode::ProductionStatic => {
                bun_bundler::options::SourceMapOption::from_api(Some(bundler_options.source_map))
            }
        };
        if bundler_options.env != bun_schema::api::DotEnvBehavior::_none {
            out.options.env.behavior = bundler_options.env;
            out.options.env.prefix = bundler_options.env_prefix.clone().unwrap_or_default();
        }
        // The resolver crate carries a FORWARD_DECL subset of
        // `BundleOptions`, so re-project via the dedicated helper rather than
        // `Clone`.
        out.sync_resolver_opts();

        out.configure_linker();
        out.configure_defines()?;

        out.options.jsx.development = mode == Mode::Development;

        add_import_meta_defines(
            &mut out.options.define,
            mode,
            match renderer {
                Graph::Client => Side::Client,
                Graph::Server | Graph::Ssr => Side::Server,
            },
        )?;

        if !bundler_options.define.keys.is_empty() {
            debug_assert_eq!(
                bundler_options.define.keys.len(),
                bundler_options.define.values.len()
            );
            use bun_bundler::DefineDataExt;
            for (k, v) in bundler_options
                .define
                .keys
                .iter()
                .zip(bundler_options.define.values.iter())
            {
                let parsed =
                    bun_bundler::defines::DefineData::parse(k, v, false, false, log, arena)?;
                out.options.define.insert(k, parsed)?;
            }
        }

        if mode != Mode::Development {
            // Hide information about the source repository, at the cost of debugging quality.
            out.options.entry_naming = b"_bun/[hash].[ext]".as_slice().into();
            out.options.chunk_naming = b"_bun/[hash].[ext]".as_slice().into();
            out.options.asset_naming = b"_bun/[hash].[ext]".as_slice().into();
        }

        // Re-sync after define/naming mutations so the resolver sees the
        // final option set.
        out.sync_resolver_opts();
        Ok(framework_view)
    }
}

fn literals(list: &[&'static [u8]]) -> Vec<Cow<'static, [u8]>> {
    list.iter().copied().map(Cow::Borrowed).collect()
}

#[inline]
fn resolve_or_null(r: &mut bun_resolver::Resolver, path: &[u8]) -> Option<Cow<'static, [u8]>> {
    match super::resolve_path(r, path) {
        Ok(resolved) => Some(resolved),
        Err(_) => {
            r.log_mut().reset();
            None
        }
    }
}

/// Thin forwarding shim — the real impl lives on
/// `framework_router::Style::from_js`.
#[inline]
fn style_from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<framework_router::Style> {
    framework_router::Style::from_js(value, global)
}

fn get_optional_string(
    target: JSValue,
    global: &JSGlobalObject,
    property: &[u8],
) -> JsResult<Option<Cow<'static, [u8]>>> {
    Ok(target
        .get_optional_slice(global, property)?
        .map(|slice| Cow::Owned(slice.into_vec())))
}

// Note: `HmrRuntime` is defined canonically in the parent `bake/mod.rs`
// (struct with `code: &'static ZStr` + `line_count`); re-export so callers
// using `bake_body::HmrRuntime` see the same nominal type.
pub(crate) use super::HmrRuntime;

fn hmr_runtime_init(code: &'static ZStr) -> HmrRuntime {
    HmrRuntime {
        code,
        line_count: u32::try_from(strings::count_char(code.as_bytes(), b'\n')).unwrap(),
    }
}

#[inline(always)]
pub(crate) fn get_hmr_runtime(side: Side) -> HmrRuntime {
    // `runtime_embed_file!` returns `&'static str` (no NUL). Use a per-side
    // `OnceLock` holding the NUL-terminated copy — read once per process,
    // never freed. PORTING.md §Forbidden bans leaking for `&'static`; this is the
    // sanctioned process-lifetime-singleton pattern instead. (Under
    // `cfg(bun_codegen_embed)` the macro expands to `include_str!`, so this
    // costs one extra copy at first call; the cost is negligible vs. keeping
    // a per-call-site `#[cfg]` pair in sync.)
    use std::sync::OnceLock;
    fn nul_terminate(s: &'static [u8], cell: &'static OnceLock<Box<[u8]>>) -> &'static ZStr {
        let buf = cell.get_or_init(|| {
            let mut v = Vec::with_capacity(s.len() + 1);
            v.extend_from_slice(s);
            v.push(0);
            v.into_boxed_slice()
        });
        // SAFETY: buf is process-lifetime (`OnceLock` static), buf[len-1] == 0.
        ZStr::from_slice_with_nul(&buf[..])
    }
    static SERVER: OnceLock<Box<[u8]>> = OnceLock::new();
    hmr_runtime_init(match side {
        // Shipped to the browser, so release builds embed it compressed; the
        // bundler owns the one inflated (NUL-terminated) copy.
        Side::Client => {
            ZStr::from_slice_with_nul(bun_bundler::bake_types::bake_client_js_with_nul())
        }
        // server runtime is loaded once, so it is pointless to make this eager.
        Side::Server => nul_terminate(
            bun_core::runtime_embed_file!(Codegen, "bake.server.js").as_bytes(),
            &SERVER,
        ),
    })
}

// Note: `Mode`/`Side`/`Graph` are defined canonically in the parent
// `bake/mod.rs` (which itself re-exports `Side`/`Graph` from
// `bun_bundler::bake_types`). Re-export here so `bake_body::Mode` ≡
// `crate::bake::Mode` and downstream callers (production.rs, build_command.rs,
// IncrementalGraph.rs) see one nominal type.
pub(crate) use super::Mode;
pub(crate) use bun_bundler::bake_types::{Graph, Side};

pub(crate) fn add_import_meta_defines(
    define: &mut bun_bundler::options::Define,
    mode: Mode,
    side: Side,
) -> crate::Result<()> {
    use bun_ast::E::EString;

    use bun_bundler::defines::DefineData;

    static MODE_DEVELOPMENT: EString = EString::from_static(b"development");
    static MODE_PRODUCTION: EString = EString::from_static(b"production");

    // The following are from Vite: https://vitejs.dev/guide/env-and-mode
    // Note that it is not currently possible to have mixed
    // modes (production + hmr dev server)
    // TODO: BASE_URL
    // NOTE: `HTMLBundle::on_plugins_resolved` (the `Bun.serve` path without the
    // HMR dev server) mirrors this key list; add new keys in both places.
    define.insert(
        b"import.meta.env.DEV",
        DefineData::init_boolean(mode == Mode::Development),
    )?;
    define.insert(
        b"import.meta.env.PROD",
        DefineData::init_boolean(mode != Mode::Development),
    )?;
    define.insert(
        b"import.meta.env.MODE",
        DefineData::init_static_string(match mode {
            Mode::Development => &MODE_DEVELOPMENT,
            Mode::ProductionStatic => &MODE_PRODUCTION,
        }),
    )?;
    define.insert(
        b"import.meta.env.SSR",
        DefineData::init_boolean(side == Side::Server),
    )?;

    // To indicate a static build, `STATIC` is set to true then.
    define.insert(
        b"import.meta.env.STATIC",
        DefineData::init_boolean(mode == Mode::ProductionStatic),
    )?;

    Ok(())
}

/// Stack-allocated structure that is written to from end to start.
/// Used as a staging area for building pattern strings.
pub(crate) struct PatternBuffer {
    pub(crate) bytes: PathBuffer,
    // On Windows MAX_PATH_BYTES = 32767*3+1 = 98302
    // (> u16::MAX), so u32 is required; u16 would truncate the initial index
    // to 32766 and `slice()` would return ~64 KiB of trailing zero bytes.
    pub(crate) i: u32,
}

impl PatternBuffer {
    pub(crate) const EMPTY: PatternBuffer = PatternBuffer {
        bytes: PathBuffer::ZEROED,
        i: core::mem::size_of::<PathBuffer>() as u32,
    };

    pub(crate) fn prepend(&mut self, chunk: &[u8]) {
        debug_assert!(self.i as usize >= chunk.len());
        self.i -= u32::try_from(chunk.len()).expect("int cast");
        self.slice_mut()[..chunk.len()].copy_from_slice(chunk);
    }

    pub(crate) fn prepend_part(&mut self, part: framework_router::Part) {
        match part {
            framework_router::Part::Text(text) => {
                debug_assert!(text.is_empty() || text[0] != b'/');
                self.prepend(text);
                self.prepend(b"/");
            }
            framework_router::Part::Param(name)
            | framework_router::Part::CatchAll(name)
            | framework_router::Part::CatchAllOptional(name) => {
                self.prepend(name);
                self.prepend(b"/:");
            }
            framework_router::Part::Group(_) => {}
        }
    }

    pub(crate) fn slice(&self) -> &[u8] {
        &self.bytes[self.i as usize..]
    }

    fn slice_mut(&mut self) -> &mut [u8] {
        &mut self.bytes[self.i as usize..]
    }
}

pub(crate) fn print_warning() {
    // Silence this for the test suite
    if bun_core::env_var::BUN_DEV_SERVER_TEST_RUNNER
        .get()
        .is_none()
    {
        bun_core::warn!(
            "Be advised that Bun Bake is highly experimental, and its API\n\
             will have breaking changes. Join the <magenta>#bake<r> Discord\n\
             channel to help us find bugs: <blue>https://bun.com/discord<r>\n\
             \n"
        );
        Output::flush();
    }
}
