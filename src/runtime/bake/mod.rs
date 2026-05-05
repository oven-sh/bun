//! Bake is Bun's toolkit for building client+server web applications. It
//! combines `Bun.build` and `Bun.serve`, providing a hot-reloading development
//! server, server components, and other integrations. Instead of taking the
//! role as a framework, Bake is tool for frameworks to build on top of.

use core::ptr::NonNull;

use bun_alloc::Arena; // = bumpalo::Bump
use bun_collections::ArrayHashMap;
use bun_core::Output;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, ZigString, ZigStringSlice};
use bun_logger as logger;
use bun_paths::{self as paths, PathBuffer};
use bun_str::{strings, ZStr};

// TODO(port): verify crate path for jsc.API.JSBundler.Plugin
use bun_runtime::api::js_bundler::Plugin;

pub mod production;
pub mod dev_server;
pub mod framework_router;

pub use dev_server as DevServer;
pub use framework_router as FrameworkRouter;

/// export default { app: ... };
pub const API_NAME: &str = "app";

// TODO(port): lifetime — many `&'static [u8]` fields below are actually backed
// by `UserOptions.arena` (bumpalo::Bump) or `UserOptions.allocations`
// (StringRefList). Phase A uses `&'static` to avoid struct lifetime params per
// PORTING.md; Phase B should thread `'bump` or introduce `ArenaStr`.

/// Zig version of the TS definition 'Bake.Options' in 'bake.d.ts'
pub struct UserOptions {
    /// This arena contains some miscellaneous allocations at startup
    pub arena: Arena,
    pub allocations: StringRefList,

    pub root: &'static ZStr, // TODO(port): arena-owned, self-referential with .arena
    pub framework: Framework,
    pub bundler_options: SplitBundlerOptions,
}

impl Drop for UserOptions {
    fn drop(&mut self) {
        // arena: dropped by Bump's Drop
        // allocations: dropped by StringRefList's Drop
        if let Some(p) = self.bundler_options.plugin {
            // SAFETY: Plugin is FFI-owned; deinit is the destructor for the
            // pointer returned by Plugin::create.
            unsafe { p.as_ref().deinit() };
        }
    }
}

impl UserOptions {
    /// Currently, this function must run at the top of the event loop.
    // TODO(port): narrow error set
    pub fn from_js(config: JSValue, global: &JSGlobalObject) -> Result<UserOptions, bun_core::Error> {
        let arena = Arena::new();
        // errdefer arena.deinit() — handled by Drop

        let mut allocations = StringRefList::EMPTY;
        // errdefer allocations.free() — handled by Drop
        let mut bundler_options = SplitBundlerOptions::EMPTY;

        if !config.is_object() {
            // Allow users to do `export default { app: 'react' }` for convenience
            if config.is_string() {
                let bunstr = config.to_bun_string(global)?;
                let utf8_string = bunstr.to_utf8();

                if strings::eql(utf8_string.byte_slice(), b"react") {
                    let root = match bun_core::getcwd_alloc(&arena) {
                        Ok(r) => r,
                        Err(e) if e == bun_core::err!("OutOfMemory") => {
                            return Err(global.throw_out_of_memory().into());
                        }
                        Err(e) => {
                            return Err(global
                                .throw_error(e, "while querying current working directory")
                                .into());
                        }
                    };

                    let framework = Framework::react(&arena)?;

                    return Ok(UserOptions {
                        // TODO(port): self-referential — `root`/`framework` borrow `arena`
                        root,
                        framework,
                        bundler_options,
                        allocations,
                        arena,
                    });
                }
            }
            return Err(global
                .throw_invalid_arguments(format_args!("'{}' is not an object", API_NAME))
                .into());
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
                    return Err(global
                        .throw_invalid_arguments(format_args!(
                            "'{}' is missing 'framework'",
                            API_NAME
                        ))
                        .into());
                }
            },
            global,
            &mut allocations,
            &mut bundler_options,
            &arena,
        )?;

        let root: &[u8] = if let Some(slice) = config.get_optional::<ZigStringSlice>(global, "root")? {
            allocations.track(slice)
        } else {
            match bun_core::getcwd_alloc(&arena) {
                Ok(r) => r.as_bytes(),
                Err(e) if e == bun_core::err!("OutOfMemory") => {
                    return Err(global.throw_out_of_memory().into());
                }
                Err(e) => {
                    return Err(global
                        .throw_error(e, "while querying current working directory")
                        .into());
                }
            }
        };

        if let Some(plugin_array) = config.get(global, "plugins")? {
            bundler_options.parse_plugin_array(plugin_array, global)?;
        }

        // TODO(port): bumpalo dupeZ equivalent — alloc NUL-terminated copy
        let root_z = bun_alloc::dupe_z(&arena, root);

        Ok(UserOptions {
            root: root_z,
            framework,
            bundler_options,
            allocations,
            arena,
        })
    }
}

/// Each string stores its allocator since some may hold reference counts to JSC
pub struct StringRefList {
    pub strings: Vec<ZigStringSlice>,
}

impl StringRefList {
    pub const EMPTY: StringRefList = StringRefList { strings: Vec::new() };

    pub fn track(&mut self, str: ZigStringSlice) -> &'static [u8] {
        // TODO(port): lifetime — returned slice lives as long as `self`
        let slice = str.slice();
        self.strings.push(str);
        // SAFETY: slice points into ZigStringSlice storage now owned by self.strings;
        // valid until StringRefList is dropped. Phase B should return `&'a [u8]`.
        unsafe { core::mem::transmute::<&[u8], &'static [u8]>(slice) }
    }
}

#[derive(Default)]
pub struct SplitBundlerOptions {
    pub plugin: Option<NonNull<Plugin>>,
    pub client: BuildConfigSubset,
    pub server: BuildConfigSubset,
    pub ssr: BuildConfigSubset,
}

impl SplitBundlerOptions {
    pub const EMPTY: SplitBundlerOptions = SplitBundlerOptions {
        plugin: None,
        client: BuildConfigSubset::DEFAULT,
        server: BuildConfigSubset::DEFAULT,
        ssr: BuildConfigSubset::DEFAULT,
    };

    pub fn parse_plugin_array(
        &mut self,
        plugin_array: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        let plugin = match self.plugin {
            Some(p) => p,
            None => Plugin::create(global, bun_options::Target::Bun::Bun),
        };
        self.plugin = Some(plugin);
        let empty_object = JSValue::create_empty_object(global, 0);

        let mut iter = plugin_array.array_iterator(global)?;
        while let Some(plugin_config) = iter.next()? {
            if !plugin_config.is_object() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Expected plugin to be an object"
                )));
            }

            if let Some(slice) = plugin_config.get_optional::<ZigStringSlice>(global, "name")? {
                if slice.len() == 0 {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Expected plugin to have a non-empty name"
                    )));
                }
                // slice dropped here (defer slice.deinit())
            } else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Expected plugin to have a name"
                )));
            }

            let function = match plugin_config.get_function(global, "setup")? {
                Some(f) => f,
                None => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Expected plugin to have a setup() function"
                    )));
                }
            };
            // SAFETY: plugin is a valid NonNull<Plugin> created above or earlier.
            let plugin_result =
                unsafe { plugin.as_ref() }.add_plugin(function, empty_object, JSValue::NULL, false, true)?;
            if let Some(promise) = plugin_result.as_any_promise() {
                promise.set_handled(global.vm());
                // TODO: remove this call, replace with a promise list that must
                // be resolved before the first bundle task can begin.
                global.bun_vm().wait_for_promise(promise);
                match promise.unwrap(global.vm(), bun_jsc::PromiseUnwrap::MarkHandled) {
                    bun_jsc::PromiseResult::Pending => unreachable!(),
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

pub struct BuildConfigSubset {
    pub loader: Option<bun_schema::api::LoaderMap>,
    pub ignore_dce_annotations: Option<bool>,
    pub conditions: ArrayHashMap<&'static [u8], ()>,
    pub drop: ArrayHashMap<&'static [u8], ()>,
    pub env: bun_schema::api::DotEnvBehavior,
    pub env_prefix: Option<&'static [u8]>,
    pub define: bun_schema::api::StringMap,
    pub source_map: bun_schema::api::SourceMapMode,

    pub minify_syntax: Option<bool>,
    pub minify_identifiers: Option<bool>,
    pub minify_whitespace: Option<bool>,
}

impl BuildConfigSubset {
    // TODO(port): const Default — schema types may not be const-constructible
    pub const DEFAULT: BuildConfigSubset = BuildConfigSubset {
        loader: None,
        ignore_dce_annotations: None,
        conditions: ArrayHashMap::new(),
        drop: ArrayHashMap::new(),
        env: bun_schema::api::DotEnvBehavior::None,
        env_prefix: None,
        define: bun_schema::api::StringMap::EMPTY,
        source_map: bun_schema::api::SourceMapMode::External,

        minify_syntax: None,
        minify_identifiers: None,
        minify_whitespace: None,
    };

    pub fn from_js(global: &JSGlobalObject, js_options: JSValue) -> JsResult<BuildConfigSubset> {
        let mut options = BuildConfigSubset::DEFAULT;

        'brk: {
            let Some(val) = js_options.get_optional::<JSValue>(global, "sourcemap")? else {
                break 'brk;
            };
            if let Some(sourcemap) = bun_schema::api::SourceMapMode::from_js(global, val)? {
                options.source_map = sourcemap;
                break 'brk;
            }

            return Err(bun_jsc::node::validators::throw_err_invalid_arg_type(
                global,
                "sourcemap",
                format_args!(""),
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

impl Default for BuildConfigSubset {
    fn default() -> Self {
        Self::DEFAULT
    }
}

/// A "Framework" in our eyes is simply set of bundler options that a framework
/// author would set in order to integrate the framework with the application.
/// Since many fields have default values which may point to static memory, this
/// structure is always arena-allocated, usually owned by the arena in `UserOptions`
///
/// Full documentation on these fields is located in the TypeScript definitions.
#[derive(Clone)]
pub struct Framework {
    pub is_built_in_react: bool,
    pub file_system_router_types: &'static [FileSystemRouterType], // TODO(port): arena-owned
    // static_routers: &'static [&'static [u8]],
    pub server_components: Option<ServerComponents>,
    pub react_fast_refresh: Option<ReactFastRefresh>,
    pub built_in_modules: ArrayHashMap<&'static [u8], BuiltInModule>,
}

impl Framework {
    /// Bun provides built-in support for using React as a framework.
    /// Depends on externally provided React
    ///
    /// $ bun i react@experimental react-dom@experimental react-refresh@experimental react-server-dom-bun
    pub fn react(arena: &Arena) -> Result<Framework, bun_core::Error> {
        // TODO(port): cfg! keeps both branches in typeck; include_bytes! may
        // fail if files absent. Phase B: split with #[cfg(feature = "codegen_embed")].
        let built_in_values: &[BuiltInModule] = if cfg!(feature = "codegen_embed") {
            &[
                BuiltInModule::Code(include_bytes!("./bun-framework-react/client.tsx")),
                BuiltInModule::Code(include_bytes!("./bun-framework-react/server.tsx")),
                BuiltInModule::Code(include_bytes!("./bun-framework-react/ssr.tsx")),
            ]
        } else {
            &[
                // Cannot use .import because resolution must happen from the user's POV
                BuiltInModule::Code(bun_core::runtime_embed_file(
                    bun_core::EmbedKind::Src,
                    "bake/bun-framework-react/client.tsx",
                )),
                BuiltInModule::Code(bun_core::runtime_embed_file(
                    bun_core::EmbedKind::Src,
                    "bake/bun-framework-react/server.tsx",
                )),
                BuiltInModule::Code(bun_core::runtime_embed_file(
                    bun_core::EmbedKind::Src,
                    "bake/bun-framework-react/ssr.tsx",
                )),
            ]
        };

        Ok(Framework {
            is_built_in_react: true,
            server_components: Some(ServerComponents {
                separate_ssr_graph: true,
                server_runtime_import: b"react-server-dom-bun/server",
                ..ServerComponents::default()
            }),
            react_fast_refresh: Some(ReactFastRefresh::default()),
            file_system_router_types: arena.alloc_slice_copy(&[FileSystemRouterType {
                root: b"pages",
                prefix: b"/",
                entry_client: Some(b"bun-framework-react/client.tsx"),
                entry_server: b"bun-framework-react/server.tsx",
                ignore_underscores: true,
                ignore_dirs: &[b"node_modules", b".git"],
                extensions: &[b".tsx", b".jsx"],
                style: framework_router::Style::NextjsPages,
                allow_layouts: true,
            }]),
            // .static_routers = arena.alloc_slice_copy(&[b"public"]),
            built_in_modules: ArrayHashMap::from_entries(
                arena,
                &[
                    b"bun-framework-react/client.tsx" as &[u8],
                    b"bun-framework-react/server.tsx",
                    b"bun-framework-react/ssr.tsx",
                ],
                built_in_values,
            )
            .unwrap_or_oom(), // bun.handleOom
        })
    }

    /// Default that requires no packages or configuration.
    /// - If `react-refresh` is installed, enable react fast refresh with it.
    ///     - Otherwise, if `react` is installed, use a bundled copy of
    ///     react-refresh so that it still works.
    /// - If any file system router types are provided, configure using
    ///   the above react configuration.
    /// The provided allocator is not stored.
    pub fn auto(
        arena: &Arena,
        resolver: &mut bun_resolver::Resolver,
        file_system_router_types: &'static [FileSystemRouterType],
    ) -> Result<Framework, bun_core::Error> {
        let mut fw: Framework = Framework::NONE;

        if !file_system_router_types.is_empty() {
            fw = Self::react(arena)?;
            // PERF(port): was arena bulk-free — arena.free is no-op on bumpalo
            fw.file_system_router_types = file_system_router_types;
        }

        if let Some(rfr) = resolve_or_null(resolver, b"react-refresh/runtime") {
            fw.react_fast_refresh = Some(ReactFastRefresh { import_source: rfr });
        } else if resolve_or_null(resolver, b"react").is_some() {
            fw.react_fast_refresh = Some(ReactFastRefresh {
                import_source: b"react-refresh/runtime/index.js",
            });
            fw.built_in_modules.put(
                arena,
                b"react-refresh/runtime/index.js",
                if cfg!(feature = "codegen_embed") {
                    // TODO(port): @embedFile path resolution differs from include_bytes!
                    BuiltInModule::Code(include_bytes!("node-fallbacks/react-refresh.js"))
                } else {
                    BuiltInModule::Code(bun_core::runtime_embed_file(
                        bun_core::EmbedKind::Codegen,
                        "node-fallbacks/react-refresh.js",
                    ))
                },
            )?;
        }

        Ok(fw)
    }

    /// Unopiniated default.
    pub const NONE: Framework = Framework {
        is_built_in_react: false,
        file_system_router_types: &[],
        server_components: None,
        react_fast_refresh: None,
        built_in_modules: ArrayHashMap::new(),
    };

    pub const REACT_INSTALL_COMMAND: &'static str =
        "bun i react@experimental react-dom@experimental react-server-dom-bun react-refresh@experimental";

    pub fn add_react_install_command_note(log: &mut logger::Log) -> Result<(), bun_core::Error> {
        log.add_msg(logger::Msg {
            kind: logger::Kind::Note,
            data: logger::range_data(
                None,
                logger::Range::NONE,
                concat!(
                    "Install the built in react integration with \"",
                    "bun i react@experimental react-dom@experimental react-server-dom-bun react-refresh@experimental",
                    "\""
                ),
            )
            .clone_line_text(log.clone_line_text, log.msgs_allocator())?,
        })?;
        Ok(())
    }

    /// Given a Framework configuration, this returns another one with all paths resolved.
    /// New memory allocated into provided arena.
    ///
    /// All resolution errors will happen before returning error.ModuleNotFound
    /// Errors written into `r.log`
    pub fn resolve(
        &self,
        server: &mut bun_resolver::Resolver,
        client: &mut bun_resolver::Resolver,
        arena: &Arena,
    ) -> Result<Framework, bun_core::Error> {
        let mut clone = self.clone();
        let mut had_errors: bool = false;

        if let Some(react_fast_refresh) = &mut clone.react_fast_refresh {
            self.resolve_helper(
                client,
                &mut react_fast_refresh.import_source,
                &mut had_errors,
                b"react refresh runtime",
            );
        }

        if let Some(sc) = &mut clone.server_components {
            self.resolve_helper(
                server,
                &mut sc.server_runtime_import,
                &mut had_errors,
                b"server components runtime",
            );
            // self.resolve_helper(client, &mut sc.client_runtime_import, &mut had_errors);
        }

        // TODO(port): mutating through &'static [T] — Phase B needs &'bump mut [T]
        for fsr in clone.file_system_router_types_mut() {
            fsr.root = arena.alloc_slice_copy(paths::join_abs(
                server.fs.top_level_dir,
                paths::Style::Auto,
                fsr.root,
            ));
            if let Some(entry_client) = &mut fsr.entry_client {
                self.resolve_helper(client, entry_client, &mut had_errors, b"client side entrypoint");
            }
            self.resolve_helper(
                client,
                &mut fsr.entry_server,
                &mut had_errors,
                b"server side entrypoint",
            );
        }

        if had_errors {
            return Err(bun_core::err!("ModuleNotFound"));
        }

        Ok(clone)
    }

    #[inline]
    fn resolve_helper(
        &self,
        r: &mut bun_resolver::Resolver,
        path: &mut &'static [u8],
        had_errors: &mut bool,
        desc: &[u8],
    ) {
        if let Some(module) = self.built_in_modules.get(path) {
            match module {
                BuiltInModule::Import(p) => *path = p,
                BuiltInModule::Code(_) => {}
            }
            return;
        }

        let mut result = match r.resolve(r.fs.top_level_dir, *path, bun_options_types::ImportKind::Stmt) {
            Ok(res) => res,
            Err(err) => {
                Output::err(
                    err,
                    format_args!(
                        "Failed to resolve '{}' for framework ({})",
                        bstr::BStr::new(path),
                        bstr::BStr::new(desc)
                    ),
                );
                *had_errors = true;
                return;
            }
        };
        *path = result.path().unwrap().text;
    }

    // TODO(port): helper to get &mut [FileSystemRouterType] from arena-backed slice
    fn file_system_router_types_mut(&mut self) -> &mut [FileSystemRouterType] {
        // SAFETY: Phase B must make this field properly mutable / arena-backed
        unsafe {
            core::slice::from_raw_parts_mut(
                self.file_system_router_types.as_ptr() as *mut FileSystemRouterType,
                self.file_system_router_types.len(),
            )
        }
    }

    fn from_js(
        opts: JSValue,
        global: &JSGlobalObject,
        refs: &mut StringRefList,
        bundler_options: &mut SplitBundlerOptions,
        arena: &Arena,
    ) -> JsResult<Framework> {
        if opts.is_string() {
            let str = opts.to_bun_string(global)?;

            // Deprecated
            if str.eql_comptime("react-server-components") {
                Output::warn(format_args!(
                    "deprecation notice: 'react-server-components' will be renamed to 'react'"
                ));
                return Ok(Framework::react(arena)?);
            }

            if str.eql_comptime("react") {
                return Ok(Framework::react(arena)?);
            }
        }

        if !opts.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Framework must be an object")));
        }

        if opts.get(global, "serverEntryPoint")?.is_some() {
            Output::warn(format_args!(
                "deprecation notice: 'framework.serverEntryPoint' has been replaced with 'fileSystemRouterTypes[n].serverEntryPoint'"
            ));
        }
        if opts.get(global, "clientEntryPoint")?.is_some() {
            Output::warn(format_args!(
                "deprecation notice: 'framework.clientEntryPoint' has been replaced with 'fileSystemRouterTypes[n].clientEntryPoint'"
            ));
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
                import_source: refs.track(str.to_utf8()),
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

            Some(ServerComponents {
                separate_ssr_graph: 'brk: {
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
                },
                server_runtime_import: refs.track(
                    match sc.get_optional::<ZigStringSlice>(global, "serverRuntimeImportSource")? {
                        Some(s) => s,
                        None => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "Missing 'framework.serverComponents.serverRuntimeImportSource'"
                            )));
                        }
                    },
                ),
                server_register_client_reference: if let Some(slice) =
                    sc.get_optional::<ZigStringSlice>(global, "serverRegisterClientReferenceExport")?
                {
                    refs.track(slice)
                } else {
                    b"registerClientReference"
                },
                ..ServerComponents::default()
            })
        };
        let built_in_modules: ArrayHashMap<&'static [u8], BuiltInModule> = 'built_in_modules: {
            let Some(array) = opts.get_array(global, "builtInModules")? else {
                break 'built_in_modules ArrayHashMap::new();
            };

            let len = array.get_length(global)?;
            let mut files: ArrayHashMap<&'static [u8], BuiltInModule> = ArrayHashMap::new();
            files.ensure_total_capacity(arena, len)?;

            let mut it = array.array_iterator(global)?;
            let mut i: usize = 0;
            while let Some(file) = it.next()? {
                if !file.is_object() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "'builtInModules[{}]' is not an object",
                        i
                    )));
                }

                let path = match get_optional_string(file, global, "import", refs, arena)? {
                    Some(p) => p,
                    None => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "'builtInModules[{}]' is missing 'import'",
                            i
                        )));
                    }
                };

                let value: BuiltInModule =
                    if let Some(str) = get_optional_string(file, global, "path", refs, arena)? {
                        BuiltInModule::Import(str)
                    } else if let Some(str) = get_optional_string(file, global, "code", refs, arena)? {
                        BuiltInModule::Code(str)
                    } else {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "'builtInModules[{}]' needs either 'path' or 'code'",
                            i
                        )));
                    };

                // PERF(port): was assume_capacity
                files.put_assume_capacity(path, value);
                i += 1;
            }

            files
        };
        let file_system_router_types: &'static [FileSystemRouterType] = 'brk: {
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
            // PORT NOTE: reshaped alloc+index → bumpalo Vec::push
            let mut file_system_router_types =
                bumpalo::collections::Vec::with_capacity_in(len, arena);

            let mut it = array.array_iterator(global)?;
            let mut i: usize = 0;
            // TODO(port): errdefer for (file_system_router_types[0..i]) |*fsr| fsr.style.deinit();
            // — Style should impl Drop; bumpalo Vec drop will handle this if so.
            while let Some(fsr_opts) = it.next()? {
                let root = match get_optional_string(fsr_opts, global, "root", refs, arena)? {
                    Some(r) => r,
                    None => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "'fileSystemRouterTypes[{}]' is missing 'root'",
                            i
                        )));
                    }
                };
                let server_entry_point =
                    match get_optional_string(fsr_opts, global, "serverEntryPoint", refs, arena)? {
                        Some(s) => s,
                        None => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "'fileSystemRouterTypes[{}]' is missing 'serverEntryPoint'",
                                i
                            )));
                        }
                    };
                let client_entry_point =
                    get_optional_string(fsr_opts, global, "clientEntryPoint", refs, arena)?;
                let prefix =
                    get_optional_string(fsr_opts, global, "prefix", refs, arena)?.unwrap_or(b"/");
                let ignore_underscores = fsr_opts
                    .get_boolean_strict(global, "ignoreUnderscores")?
                    .unwrap_or(false);
                let layouts = fsr_opts
                    .get_boolean_strict(global, "layouts")?
                    .unwrap_or(false);

                let style = framework_router::Style::from_js(
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

                let extensions: &'static [&'static [u8]] =
                    if let Some(exts_js) = fsr_opts.get(global, "extensions")? {
                        'exts: {
                            if exts_js.is_string() {
                                let str = exts_js.to_slice(global, arena)?;
                                if str.slice() == b"*" {
                                    break 'exts &[] as &[&[u8]];
                                }
                            } else if exts_js.is_array() {
                                let mut it_2 = exts_js.array_iterator(global)?;
                                let mut extensions = bumpalo::collections::Vec::with_capacity_in(
                                    exts_js.get_length(global)?,
                                    arena,
                                );
                                while let Some(array_item) = it_2.next()? {
                                    let slice = refs.track(array_item.to_slice(global, arena)?);
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

                                    extensions.push(if slice[0] == b'.' {
                                        slice
                                    } else {
                                        // PERF(port): std.mem.concat into arena
                                        let mut v = bumpalo::collections::Vec::with_capacity_in(
                                            1 + slice.len(),
                                            arena,
                                        );
                                        v.push(b'.');
                                        v.extend_from_slice(slice);
                                        v.into_bump_slice()
                                    });
                                }
                                break 'exts extensions.into_bump_slice();
                            }

                            return Err(global.throw_invalid_arguments(format_args!(
                                "'extensions' must be an array of strings or \"*\" for all extensions"
                            )));
                        }
                    } else {
                        &[
                            b".jsx", b".tsx", b".js", b".ts", b".cjs", b".cts", b".mjs", b".mts",
                        ]
                    };

                let ignore_dirs: &'static [&'static [u8]] =
                    if let Some(exts_js) = fsr_opts.get(global, "ignoreDirs")? {
                        'exts: {
                            if exts_js.is_array() {
                                let mut it_2 = array.array_iterator(global)?;
                                let mut dirs =
                                    bumpalo::collections::Vec::with_capacity_in(len, arena);
                                while let Some(array_item) = it_2.next()? {
                                    dirs.push(refs.track(array_item.to_slice(global, arena)?));
                                }
                                break 'exts dirs.into_bump_slice();
                            }

                            return Err(global.throw_invalid_arguments(format_args!(
                                "'ignoreDirs' must be an array of strings or \"*\" for all extensions"
                            )));
                        }
                    } else {
                        &[b".git", b"node_modules"]
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

            break 'brk file_system_router_types.into_bump_slice();
        };
        // TODO(port): errdefer for (file_system_router_types) |*fsr| fsr.style.deinit();
        // — handled by Style's Drop if it impls Drop; bump slices don't drop contents.

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

    pub fn init_transpiler(
        &mut self,
        arena: &Arena,
        log: &mut logger::Log,
        mode: Mode,
        renderer: Graph,
        out: &mut bun_bundler::Transpiler,
        bundler_options: &BuildConfigSubset,
    ) -> Result<(), bun_core::Error> {
        let source_map: bun_bundler::options::SourceMapOption = match mode {
            // Source maps must always be external, as DevServer special cases
            // the linking and part of the generation of these. It also relies
            // on source maps always being enabled.
            Mode::Development => bun_bundler::options::SourceMapOption::External,
            // TODO: follow user configuration
            _ => bun_bundler::options::SourceMapOption::None,
        };

        self.init_transpiler_with_options(
            arena,
            log,
            mode,
            renderer,
            out,
            bundler_options,
            source_map,
            None,
            None,
            None,
        )
    }

    pub fn init_transpiler_with_options(
        &mut self,
        arena: &Arena,
        log: &mut logger::Log,
        mode: Mode,
        renderer: Graph,
        out: &mut bun_bundler::Transpiler,
        bundler_options: &BuildConfigSubset,
        source_map: bun_bundler::options::SourceMapOption,
        minify_whitespace: Option<bool>,
        minify_syntax: Option<bool>,
        minify_identifiers: Option<bool>,
    ) -> Result<(), bun_core::Error> {
        use bun_js_parser as ast;

        // TODO(port): ASTMemoryAllocator scope — typed_arena pattern in bun_js_parser
        let mut ast_memory_allocator = ast::ASTMemoryAllocator::new_without_stack(arena);
        let mut ast_scope = ast::ASTMemoryAllocatorScope {
            previous: ast::Stmt::data_store_memory_allocator(),
            current: &mut ast_memory_allocator,
        };
        ast_scope.enter();
        let _guard = scopeguard::guard((), |_| ast_scope.exit());

        *out = bun_bundler::Transpiler::init(
            arena,
            log,
            // TODO(port): std.mem.zeroes(TransformOptions) — verify all-zero is valid
            bun_schema::api::TransformOptions::default(),
            None,
        )?;

        out.options.target = match renderer {
            Graph::Client => bun_bundler::options::Target::Browser,
            Graph::Server | Graph::Ssr => bun_bundler::options::Target::Bun,
        };
        out.options.public_path = match renderer {
            Graph::Client => dev_server::CLIENT_PREFIX,
            Graph::Server | Graph::Ssr => b"",
        };
        out.options.entry_points = &[];
        out.options.log = log;
        out.options.output_format = match mode {
            Mode::Development => bun_bundler::options::OutputFormat::InternalBakeDev,
            Mode::ProductionDynamic | Mode::ProductionStatic => {
                bun_bundler::options::OutputFormat::Esm
            }
        };
        out.options.out_extensions = bun_collections::StringHashMap::new();
        out.options.hot_module_reloading = mode == Mode::Development;
        out.options.code_splitting = mode != Mode::Development;

        // force disable filesystem output, even though bundle_v2
        // is special cased to return before that code is reached.
        out.options.output_dir = b"";

        // framework configuration
        out.options.react_fast_refresh =
            mode == Mode::Development && renderer == Graph::Client && self.react_fast_refresh.is_some();
        out.options.server_components = self.server_components.is_some();

        out.options.conditions = bun_bundler::options::ESMConditions::init(
            arena,
            out.options.target.default_conditions(),
            out.options.target.is_server_side(),
            bundler_options.conditions.keys(),
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
        out.options.minify_syntax = minify_syntax.unwrap_or(mode != Mode::Development);
        out.options.minify_identifiers = minify_identifiers.unwrap_or(mode != Mode::Development);
        out.options.minify_whitespace = minify_whitespace.unwrap_or(mode != Mode::Development);
        out.options.css_chunking = true;
        out.options.framework = self;
        out.options.inline_entrypoint_import_meta_main = true;
        if let Some(ignore) = bundler_options.ignore_dce_annotations {
            out.options.ignore_dce_annotations = ignore;
        }

        out.options.source_map = source_map;
        if bundler_options.env != bun_schema::api::DotEnvBehavior::None {
            out.options.env.behavior = bundler_options.env;
            out.options.env.prefix = bundler_options.env_prefix.unwrap_or(b"");
        }
        out.resolver.opts = out.options.clone();

        out.configure_linker();
        out.configure_defines()?;

        out.options.jsx.development = mode == Mode::Development;

        add_import_meta_defines(
            arena,
            out.options.define,
            mode,
            match renderer {
                Graph::Client => Side::Client,
                Graph::Server | Graph::Ssr => Side::Server,
            },
        )?;

        if (bundler_options.define.keys.len() + bundler_options.drop.count()) > 0 {
            debug_assert_eq!(
                bundler_options.define.keys.len(),
                bundler_options.define.values.len()
            );
            for (k, v) in bundler_options
                .define
                .keys
                .iter()
                .zip(bundler_options.define.values.iter())
            {
                let parsed =
                    bun_bundler::options::define::Data::parse(k, v, false, false, log, arena)?;
                out.options.define.insert(arena, k, parsed)?;
            }

            for drop_item in bundler_options.drop.keys() {
                if !drop_item.is_empty() {
                    let parsed = bun_bundler::options::define::Data::parse(
                        drop_item, b"", true, true, log, arena,
                    )?;
                    out.options.define.insert(arena, drop_item, parsed)?;
                }
            }
        }

        if mode != Mode::Development {
            // Hide information about the source repository, at the cost of debugging quality.
            out.options.entry_naming = b"_bun/[hash].[ext]";
            out.options.chunk_naming = b"_bun/[hash].[ext]";
            out.options.asset_naming = b"_bun/[hash].[ext]";
        }

        out.resolver.opts = out.options.clone();
        Ok(())
    }
}

#[derive(Clone)]
pub struct FileSystemRouterType {
    pub root: &'static [u8],
    pub prefix: &'static [u8],
    pub entry_server: &'static [u8],
    pub entry_client: Option<&'static [u8]>,
    pub ignore_underscores: bool,
    pub ignore_dirs: &'static [&'static [u8]],
    pub extensions: &'static [&'static [u8]],
    pub style: framework_router::Style,
    pub allow_layouts: bool,
}

#[derive(Clone, Copy)]
pub enum BuiltInModule {
    Import(&'static [u8]),
    Code(&'static [u8]),
}

#[derive(Clone)]
pub struct ServerComponents {
    pub separate_ssr_graph: bool,
    pub server_runtime_import: &'static [u8],
    // pub client_runtime_import: &'static [u8],
    pub server_register_client_reference: &'static [u8],
    pub server_register_server_reference: &'static [u8],
    pub client_register_server_reference: &'static [u8],
}

impl Default for ServerComponents {
    fn default() -> Self {
        Self {
            separate_ssr_graph: false,
            server_runtime_import: b"",
            server_register_client_reference: b"registerClientReference",
            server_register_server_reference: b"registerServerReference",
            client_register_server_reference: b"registerServerReference",
        }
    }
}

#[derive(Clone)]
pub struct ReactFastRefresh {
    pub import_source: &'static [u8],
}

impl Default for ReactFastRefresh {
    fn default() -> Self {
        Self {
            import_source: b"react-refresh/runtime",
        }
    }
}

#[inline]
fn resolve_or_null(r: &mut bun_resolver::Resolver, path: &[u8]) -> Option<&'static [u8]> {
    match r.resolve(r.fs.top_level_dir, path, bun_options_types::ImportKind::Stmt) {
        Ok(res) => Some(res.path_const().unwrap().text),
        Err(_) => {
            r.log.reset();
            None
        }
    }
}

fn get_optional_string(
    target: JSValue,
    global: &JSGlobalObject,
    property: &[u8],
    allocations: &mut StringRefList,
    arena: &Arena,
) -> Result<Option<&'static [u8]>, bun_core::Error> {
    let Some(value) = target.get(global, property)? else {
        return Ok(None);
    };
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    let str = value.to_bun_string(global)?;
    let _ = arena; // TODO(port): arena param unused after to_utf8() drops allocator
    Ok(Some(allocations.track(str.to_utf8())))
}

pub struct HmrRuntime {
    pub code: &'static ZStr,
    /// The number of lines in the HMR runtime. This is used for sourcemap
    /// generation, where the first n lines are skipped. In release, these
    /// are always precalculated.
    pub line_count: u32,
}

impl HmrRuntime {
    pub fn init(code: &'static ZStr) -> HmrRuntime {
        HmrRuntime {
            code,
            line_count: u32::try_from(
                code.as_bytes().iter().filter(|&&b| b == b'\n').count(),
            )
            .unwrap(),
        }
    }
}

#[inline(always)]
pub fn get_hmr_runtime(side: Side) -> HmrRuntime {
    // TODO(port): cfg! keeps both branches; include_bytes! needs files present.
    // Phase B: split with #[cfg(feature = "codegen_embed")] and ensure NUL-terminated.
    if cfg!(feature = "codegen_embed") {
        match side {
            // TODO(port): @embedFile yields [:0]const u8; include_bytes! lacks NUL
            Side::Client => HmrRuntime::init(
                // SAFETY: codegen emits NUL-terminated bytes (see TODO above — verify in Phase B)
                unsafe { ZStr::from_bytes_unchecked(include_bytes!("bake-codegen/bake.client.js")) },
            ),
            Side::Server => HmrRuntime::init(
                // SAFETY: codegen emits NUL-terminated bytes (see TODO above — verify in Phase B)
                unsafe { ZStr::from_bytes_unchecked(include_bytes!("bake-codegen/bake.server.js")) },
            ),
        }
    } else {
        HmrRuntime::init(match side {
            Side::Client => bun_core::runtime_embed_file_z(
                bun_core::EmbedKind::CodegenEager,
                "bake.client.js",
            ),
            // server runtime is loaded once, so it is pointless to make this eager.
            Side::Server => {
                bun_core::runtime_embed_file_z(bun_core::EmbedKind::Codegen, "bake.server.js")
            }
        })
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Mode {
    Development,
    ProductionDynamic,
    ProductionStatic,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Side {
    Client = 0,
    Server = 1,
}

impl Side {
    pub fn graph(self) -> Graph {
        match self {
            Side::Client => Graph::Client,
            Side::Server => Graph::Server,
        }
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Graph {
    Client = 0,
    Server = 1,
    /// Only used when Framework has .server_components.separate_ssr_graph set
    Ssr = 2,
}

pub fn add_import_meta_defines(
    arena: &Arena,
    define: &mut bun_bundler::options::Define,
    mode: Mode,
    side: Side,
) -> Result<(), bun_core::Error> {
    use bun_bundler::options::define::Data as DefineData;

    // The following are from Vite: https://vitejs.dev/guide/env-and-mode
    // Note that it is not currently possible to have mixed
    // modes (production + hmr dev server)
    // TODO: BASE_URL
    define.insert(
        arena,
        b"import.meta.env.DEV",
        DefineData::init_boolean(mode == Mode::Development),
    )?;
    define.insert(
        arena,
        b"import.meta.env.PROD",
        DefineData::init_boolean(mode != Mode::Development),
    )?;
    define.insert(
        arena,
        b"import.meta.env.MODE",
        DefineData::init_static_string(match mode {
            Mode::Development => &bun_bundler::options::define::StaticString {
                data: b"development",
            },
            Mode::ProductionDynamic | Mode::ProductionStatic => {
                &bun_bundler::options::define::StaticString {
                    data: b"production",
                }
            }
        }),
    )?;
    define.insert(
        arena,
        b"import.meta.env.SSR",
        DefineData::init_boolean(side == Side::Server),
    )?;

    // To indicate a static build, `STATIC` is set to true then.
    define.insert(
        arena,
        b"import.meta.env.STATIC",
        DefineData::init_boolean(mode == Mode::ProductionStatic),
    )?;

    Ok(())
}

// TODO(port): logger::Source const construction — verify Path::init_for_kit_built_in is const fn
pub static SERVER_VIRTUAL_SOURCE: logger::Source = logger::Source {
    path: bun_fs::Path::init_for_kit_built_in("bun", "bake/server"),
    contents: b"", // Virtual
    index: bun_js_parser::Index::BAKE_SERVER_DATA,
};

pub static CLIENT_VIRTUAL_SOURCE: logger::Source = logger::Source {
    path: bun_fs::Path::init_for_kit_built_in("bun", "bake/client"),
    contents: b"", // Virtual
    index: bun_js_parser::Index::BAKE_CLIENT_DATA,
};

/// Stack-allocated structure that is written to from end to start.
/// Used as a staging area for building pattern strings.
pub struct PatternBuffer {
    pub bytes: PathBuffer,
    // Zig: std.math.IntFittingRange(0, @sizeOf(bun.PathBuffer)) — smallest int
    // fitting MAX_PATH_BYTES. u16 covers all platforms (max ~32768).
    pub i: u16,
}

impl PatternBuffer {
    pub const EMPTY: PatternBuffer = PatternBuffer {
        bytes: PathBuffer::ZEROED, // TODO(port): Zig used `undefined`; uninit not const-safe
        i: core::mem::size_of::<PathBuffer>() as u16,
    };

    pub fn prepend(&mut self, chunk: &[u8]) {
        debug_assert!(self.i as usize >= chunk.len());
        self.i -= u16::try_from(chunk.len()).unwrap();
        self.slice_mut()[..chunk.len()].copy_from_slice(chunk);
    }

    pub fn prepend_part(&mut self, part: framework_router::Part) {
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
            framework_router::Part::Group => {}
        }
    }

    pub fn slice(&self) -> &[u8] {
        &self.bytes.as_slice()[self.i as usize..]
    }

    fn slice_mut(&mut self) -> &mut [u8] {
        &mut self.bytes.as_mut_slice()[self.i as usize..]
    }
}

pub fn print_warning() {
    // Silence this for the test suite
    if bun_core::env_var::BUN_DEV_SERVER_TEST_RUNNER.get().is_none() {
        Output::warn(format_args!(
            "Be advised that Bun Bake is highly experimental, and its API\n\
             will have breaking changes. Join the <magenta>#bake<r> Discord\n\
             channel to help us find bugs: <blue>https://bun.com/discord<r>\n\
             \n"
        ));
        Output::flush();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/bake.zig (1008 lines)
//   confidence: medium
//   todos:      22
//   notes:      `&'static [u8]` fields are arena/StringRefList-backed (self-referential with UserOptions.arena); Phase B must thread `'bump` lifetimes. include_bytes!/cfg! branches need #[cfg] split. Heavy bun_jsc usage may need *_jsc crate split.
// ──────────────────────────────────────────────────────────────────────────
