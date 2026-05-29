//! Bake is Bun's toolkit for building client+server web applications. It
//! combines `Bun.build` and `Bun.serve`, providing a hot-reloading development
//! server, server components, and other integrations. Instead of taking the
//! role as a framework, Bake is tool for frameworks to build on top of.
#![allow(unexpected_cfgs)] // `bun_codegen_embed` is set via RUSTFLAGS (scripts/build/rust.ts) for release/CI builds.

use bun_alloc::ArenaVecExt as _;
use core::ptr::NonNull;

use bun_alloc::Arena; // = bumpalo::Bump
use bun_collections::ArrayHashMap;
use bun_core::Output;
use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult, ZigStringSlice};
// peechy batch 2 landed: `bun_options_types::schema::api` now provides
// {StringMap, LoaderMap, DotEnvBehavior, SourceMapMode, TransformOptions}.
// Alias as `bun_schema` so existing field paths resolve unchanged.
use bun_core::{ZStr, strings};
use bun_options_types::schema as bun_schema;
use bun_paths::{self as paths, PathBuffer};

// `jsc.API.JSBundler.Plugin` — opaque FFI handle for the C++ JSBundlerPlugin.
// Re-exported from `crate::api::js_bundler` so `SplitBundlerOptions.plugin`
// shares the same type the bundler pipeline uses.
pub(crate) use crate::api::js_bundler::Plugin;
use crate::api::js_bundler::js_bundler::PluginJscExt as _;

use super::{dev_server, framework_router};

// PORT NOTE: `pub use dev_server as DevServer` / `framework_router as
// FrameworkRouter` are already provided by the parent `mod.rs` (lines 349/369);
// re-exporting here triggers E0365 because `bake_body` is a private module.

/// `JSValue.getOptional(ZigString.Slice, ..)` — local shim until `bun_jsc`
/// grows a typed `get_optional`. Returns `None` for missing/null/undefined.
fn get_optional_slice(
    target: JSValue,
    global: &JSGlobalObject,
    property: &[u8],
) -> JsResult<Option<ZigStringSlice>> {
    match target.get(global, property)? {
        Some(v) if !v.is_undefined_or_null() => Ok(Some(v.to_slice(global)?)),
        _ => Ok(None),
    }
}

/// `JSValue.getBooleanStrict` — local shim.
fn get_boolean_strict(
    target: JSValue,
    global: &JSGlobalObject,
    property: &[u8],
) -> JsResult<Option<bool>> {
    match target.get(global, property)? {
        Some(v) if v.is_boolean() => Ok(Some(v.as_boolean())),
        _ => Ok(None),
    }
}

/// `JSValue.getBooleanLoose` — local shim until `bun_jsc` grows it.
fn get_boolean_loose(
    target: JSValue,
    global: &JSGlobalObject,
    property: &[u8],
) -> JsResult<Option<bool>> {
    match target.get(global, property)? {
        Some(v) if !v.is_undefined_or_null() => Ok(Some(v.to_boolean())),
        _ => Ok(None),
    }
}

/// `JSValue.getOptional(JSValue, ..)` — local shim: filters undefined/null.
fn get_optional_value(
    target: JSValue,
    global: &JSGlobalObject,
    property: &[u8],
) -> JsResult<Option<JSValue>> {
    match target.get(global, property)? {
        Some(v) if !v.is_undefined_or_null() => Ok(Some(v)),
        _ => Ok(None),
    }
}

/// `JSValue.getFunction` — local shim until `bun_jsc` grows it.
fn get_function(
    target: JSValue,
    global: &JSGlobalObject,
    property: &[u8],
) -> JsResult<Option<JSValue>> {
    match target.get(global, property)? {
        Some(v) if v.is_callable() => Ok(Some(v)),
        _ => Ok(None),
    }
}

use bun_bundler_jsc::source_map_mode_jsc::source_map_mode_from_js;

/// Convert a `bun_core::Error` into a thrown JS exception in a `JsResult`
/// context. Mirrors Zig `globalThis.throwError(err, msg)`.
#[inline]
fn throw_core_error(global: &JSGlobalObject, e: bun_core::Error, ctx: &'static str) -> JsError {
    global.throw_error(e, ctx)
}

/// Erase the `'bump` lifetime of an arena-backed slice. Arena-erasure
/// convention (see file-level TODO(port)): `UserOptions.arena` outlives every
/// borrower, so the bytes are valid for the program-relevant lifetime.
#[inline(always)]
pub(crate) fn arena_erase<T: ?Sized>(r: &T) -> &'static T {
    // SAFETY: arena-backed; UserOptions owns the bump and is dropped last.
    // PORTING.md sanctions this only inside the bake `from_js` self-referential
    // pattern — do NOT generalize.
    unsafe { bun_ptr::detach_ref(r) }
}

/// `arena.dupeZ(u8, bytes)` — copy `bytes` + trailing NUL into the bump arena.
/// Returns `&'static ZStr` per the file-level `'static` convention
/// (arena-backed; lifetime erased — see TODO(port) at top of file).
pub(crate) fn arena_dupe_z(arena: &Arena, bytes: &[u8]) -> &'static ZStr {
    let buf: &mut [u8] = arena.alloc_slice_fill_default(bytes.len() + 1);
    buf[..bytes.len()].copy_from_slice(bytes);
    buf[bytes.len()] = 0;
    // SAFETY: buf is NUL-terminated; arena outlives all borrowers per the
    // self-referential UserOptions pattern. Not `from_buf`: the `'static`
    // return type intentionally erases the arena lifetime; threading a real
    // `'bump` would replace this with `from_buf`.
    unsafe { ZStr::from_raw(buf.as_ptr(), bytes.len()) }
}

/// export default { app: ... };
pub(crate) const API_NAME: &str = "app";

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
            Plugin::destroy(p.as_ptr());
        }
    }
}

impl UserOptions {
    /// Currently, this function must run at the top of the event loop.
    // TODO(port): narrow error set
    pub fn from_js(config: JSValue, global: &JSGlobalObject) -> JsResult<UserOptions> {
        let arena = Arena::new();
        // errdefer arena.deinit() — handled by Drop

        let mut allocations = StringRefList::EMPTY;
        // errdefer allocations.free() — handled by Drop
        let mut bundler_options = SplitBundlerOptions::default();

        if !config.is_object() {
            // Allow users to do `export default { app: 'react' }` for convenience
            if config.is_string() {
                let bunstr = bun_core::OwnedString::new(config.to_bun_string(global)?);
                let utf8_string = bunstr.to_utf8();

                if strings::eql(utf8_string.slice(), b"react") {
                    let root = match bun_sys::getcwd_alloc() {
                        Ok(z) => arena_dupe_z(&arena, z.as_bytes()),
                        Err(e) => {
                            return Err(global.throw_error(
                                e.to_zig_err(),
                                "while querying current working directory",
                            ));
                        }
                    };

                    let framework = Framework::react(&arena)
                        .map_err(|e| throw_core_error(global, e, "Framework::react"))?;

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
            return Err(
                global.throw_invalid_arguments(format_args!("'{}' is not an object", API_NAME))
            );
        }

        if let Some(js_options) = get_optional_value(config, global, b"bundlerOptions")? {
            if let Some(server_options) = get_optional_value(js_options, global, b"server")? {
                bundler_options.server = BuildConfigSubset::from_js(global, server_options)?;
            }
            if let Some(client_options) = get_optional_value(js_options, global, b"client")? {
                bundler_options.client = BuildConfigSubset::from_js(global, client_options)?;
            }
            if let Some(ssr_options) = get_optional_value(js_options, global, b"ssr")? {
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
            &mut allocations,
            &mut bundler_options,
            &arena,
        )?;

        let root: &[u8] = if let Some(slice) = get_optional_slice(config, global, b"root")? {
            allocations.track(slice)
        } else {
            match bun_sys::getcwd_alloc() {
                Ok(z) => arena_dupe_z(&arena, z.as_bytes()).as_bytes(),
                Err(e) => {
                    return Err(global
                        .throw_error(e.to_zig_err(), "while querying current working directory"));
                }
            }
        };

        if let Some(plugin_array) = config.get(global, "plugins")? {
            bundler_options.parse_plugin_array(plugin_array, global)?;
        }

        let root_z = arena_dupe_z(&arena, root);

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
#[derive(Default)]
pub struct StringRefList {
    pub strings: Vec<ZigStringSlice>,
}

impl StringRefList {
    pub const EMPTY: StringRefList = StringRefList {
        strings: Vec::new(),
    };

    pub fn track(&mut self, str: ZigStringSlice) -> &'static [u8] {
        self.strings.push(str);
        let slice = self.strings.last().unwrap().slice();
        // SAFETY: (`Interned::assume` — Population B, holder-backed) the
        // `ZigStringSlice` is now owned by `self.strings` and lives exactly as
        // long as the `StringRefList`, which is owned by `UserOptions` and
        // dropped only when bake teardown runs (`UserOptions::deinit`). The
        // returned slice is stored only in `Framework` / `FileSystemRouterType`
        // / `ServerComponents` fields that are themselves owned by the same
        // `UserOptions`, so no read outlives the holder. NOT process-lifetime
        // — a real `'bump` lifetime should eventually be threaded here (see
        // file-level TODO(port)); `assume` makes the lie grep-able until then.
        unsafe { bun_ptr::Interned::assume(slice) }.as_bytes()
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
    // PORT NOTE: was `pub const EMPTY` — `ArrayHashMap::new()` (inside
    // `BuildConfigSubset`) is not `const fn`, so this is now a fn-backed
    // default. Callers updated to `SplitBundlerOptions::default()`.

    pub(crate) fn parse_plugin_array(
        &mut self,
        plugin_array: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        // Spec (bake.zig:149-150): create the Plugin and assign it to
        // `opts.plugin` BEFORE iterating, so `plugins: []` still leaves
        // `self.plugin = Some(_)`.
        let plugin: NonNull<Plugin> = match self.plugin {
            Some(p) => p,
            None => {
                let p = Plugin::create(global, bun_jsc::BunPluginTarget::Bun);
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

            if let Some(slice) = get_optional_slice(plugin_config, global, b"name")? {
                if slice.slice().is_empty() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Expected plugin to have a non-empty name"
                    )));
                }
                // slice dropped here (defer slice.deinit())
            } else {
                return Err(
                    global.throw_invalid_arguments(format_args!("Expected plugin to have a name"))
                );
            }

            let function = match get_function(plugin_config, global, b"setup")? {
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
                global.bun_vm().as_mut().wait_for_promise(promise);
                match promise.unwrap(global.vm(), bun_jsc::PromiseUnwrapMode::MarkHandled) {
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
    pub fn from_js(global: &JSGlobalObject, js_options: JSValue) -> JsResult<BuildConfigSubset> {
        let mut options = BuildConfigSubset::default();

        'brk: {
            let Some(val) = get_optional_value(js_options, global, b"sourcemap")? else {
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
            let Some(minify_options) = get_optional_value(js_options, global, b"minify")? else {
                break 'brk;
            };
            if minify_options.is_boolean() && minify_options.as_boolean() {
                options.minify_syntax = Some(minify_options.as_boolean());
                options.minify_identifiers = Some(minify_options.as_boolean());
                options.minify_whitespace = Some(minify_options.as_boolean());
                break 'brk;
            }

            if let Some(value) = get_boolean_loose(minify_options, global, b"whitespace")? {
                options.minify_whitespace = Some(value);
            }
            if let Some(value) = get_boolean_loose(minify_options, global, b"syntax")? {
                options.minify_syntax = Some(value);
            }
            if let Some(value) = get_boolean_loose(minify_options, global, b"identifiers")? {
                options.minify_identifiers = Some(value);
            }
        }

        Ok(options)
    }
}

impl Default for BuildConfigSubset {
    fn default() -> Self {
        // PORT NOTE: was `pub const DEFAULT` — `ArrayHashMap::new()` is not
        // `const fn`, so this lives behind `Default` instead.
        BuildConfigSubset {
            loader: None,
            ignore_dce_annotations: None,
            conditions: ArrayHashMap::new(),
            drop: ArrayHashMap::new(),
            env: bun_schema::api::DotEnvBehavior::_none,
            env_prefix: None,
            define: bun_schema::api::StringMap::EMPTY,
            source_map: bun_schema::api::SourceMapMode::External,

            minify_syntax: None,
            minify_identifiers: None,
            minify_whitespace: None,
        }
    }
}

pub struct Framework {
    pub is_built_in_react: bool,
    pub file_system_router_types: Vec<FileSystemRouterType>,
    // static_routers: &'static [&'static [u8]],
    pub server_components: Option<ServerComponents>,
    pub react_fast_refresh: Option<ReactFastRefresh>,
    pub built_in_modules: ArrayHashMap<&'static [u8], BuiltInModule>,
}

impl Default for Framework {
    fn default() -> Self {
        Self {
            is_built_in_react: false,
            file_system_router_types: Vec::new(),
            server_components: None,
            react_fast_refresh: None,
            built_in_modules: ArrayHashMap::new(),
        }
    }
}

impl Framework {
    pub fn react(arena: &Arena) -> Result<Framework, bun_core::Error> {
        // Cannot use .import because resolution must happen from the user's POV
        let built_in_values: &[BuiltInModule] = &[
            BuiltInModule::Code(
                bun_core::runtime_embed_file!(Src, "runtime/bake/bun-framework-react/client.tsx")
                    .as_bytes(),
            ),
            BuiltInModule::Code(
                bun_core::runtime_embed_file!(Src, "runtime/bake/bun-framework-react/server.tsx")
                    .as_bytes(),
            ),
            BuiltInModule::Code(
                bun_core::runtime_embed_file!(Src, "runtime/bake/bun-framework-react/ssr.tsx")
                    .as_bytes(),
            ),
        ];

        Ok(Framework {
            is_built_in_react: true,
            server_components: Some(ServerComponents {
                separate_ssr_graph: true,
                server_runtime_import: b"react-server-dom-bun/server",
                ..ServerComponents::default()
            }),
            react_fast_refresh: Some(ReactFastRefresh::default()),
            file_system_router_types: vec![FileSystemRouterType {
                root: b"pages",
                prefix: b"/",
                entry_client: Some(b"bun-framework-react/client.tsx"),
                entry_server: b"bun-framework-react/server.tsx",
                ignore_underscores: true,
                ignore_dirs: &[b"node_modules", b".git"],
                extensions: &[b".tsx", b".jsx"],
                style: framework_router::Style::NextjsPages,
                allow_layouts: true,
            }],
            // .static_routers = arena.alloc_slice_copy(&[b"public"]),
            built_in_modules: {
                // PORT NOTE: was `ArrayHashMap::from_entries(arena, keys, vals)`;
                // that constructor doesn't exist on the heap-backed
                // `ArrayHashMap` — build it imperatively. `bun.handleOom`.
                let keys: [&'static [u8]; 3] = [
                    b"bun-framework-react/client.tsx",
                    b"bun-framework-react/server.tsx",
                    b"bun-framework-react/ssr.tsx",
                ];
                let mut m: ArrayHashMap<&'static [u8], BuiltInModule> = ArrayHashMap::new();
                bun_core::handle_oom(m.ensure_total_capacity(keys.len()));
                for (k, v) in keys.iter().zip(built_in_values.iter()) {
                    m.put_assume_capacity(*k, *v);
                }
                let _ = arena; // arena param retained for API parity
                m
            },
        })
    }

    pub fn auto(
        arena: &Arena,
        resolver: &mut bun_resolver::Resolver,
        file_system_router_types: Vec<FileSystemRouterType>,
    ) -> Result<Framework, bun_core::Error> {
        let mut fw: Framework = Framework::none();

        if !file_system_router_types.is_empty() {
            fw = Self::react(arena)?;
            fw.file_system_router_types = file_system_router_types;
        }

        if let Some(rfr) = resolve_or_null(resolver, b"react-refresh/runtime") {
            fw.react_fast_refresh = Some(ReactFastRefresh { import_source: rfr });
        } else if resolve_or_null(resolver, b"react").is_some() {
            fw.react_fast_refresh = Some(ReactFastRefresh {
                import_source: b"react-refresh/runtime/index.js",
            });
            let react_refresh_code = BuiltInModule::Code(
                bun_core::runtime_embed_file!(Codegen, "node-fallbacks/react-refresh.js")
                    .as_bytes(),
            );
            let _ = arena;
            fw.built_in_modules.put(
                b"react-refresh/runtime/index.js" as &[u8],
                react_refresh_code,
            )?;
        }

        Ok(fw)
    }

    /// Unopinionated default. PORT NOTE: was `pub const NONE` —
    /// `ArrayHashMap::new()` is not `const fn`.
    pub fn none() -> Framework {
        Framework {
            is_built_in_react: false,
            file_system_router_types: Vec::new(),
            server_components: None,
            react_fast_refresh: None,
            built_in_modules: ArrayHashMap::new(),
        }
    }

    /// `Framework.clone()` — manual because `ArrayHashMap` exposes a
    /// fallible inherent `clone()` rather than `impl Clone`.
    pub fn clone(&self) -> Framework {
        Framework {
            is_built_in_react: self.is_built_in_react,
            file_system_router_types: self.file_system_router_types.clone(),
            server_components: self.server_components,
            react_fast_refresh: self.react_fast_refresh,
            built_in_modules: bun_core::handle_oom(self.built_in_modules.clone()),
        }
    }

    pub const REACT_INSTALL_COMMAND: &'static str = "bun i react@experimental react-dom@experimental react-server-dom-bun react-refresh@experimental";

    pub fn add_react_install_command_note(log: &mut bun_ast::Log) -> Result<(), bun_core::Error> {
        let clone_line_text = log.clone_line_text;
        log.add_msg(bun_ast::Msg {
            kind: bun_ast::Kind::Note,
            data: bun_ast::range_data(
                None,
                bun_ast::Range::NONE,
                // `range_data` takes `impl Into<Cow<'static, [u8]>>`;
                // `concat!` yields `&'static str` — go via `.as_bytes()`.
                concat!(
                    "Install the built in react integration with \"",
                    "bun i react@experimental react-dom@experimental react-server-dom-bun react-refresh@experimental",
                    "\""
                )
                .as_bytes(),
            )
            .clone_line_text(clone_line_text),
            ..Default::default()
        });
        Ok(())
    }

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

        for fsr in clone.file_system_router_types.iter_mut() {
            let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
            fsr.root = arena_erase(arena.alloc_slice_copy(paths::resolve_path::join_abs::<
                paths::platform::Auto,
            >(top_level_dir, fsr.root)));
            if let Some(entry_client) = &mut fsr.entry_client {
                self.resolve_helper(
                    client,
                    entry_client,
                    &mut had_errors,
                    b"client side entrypoint",
                );
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

        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
        let mut result = match r.resolve(top_level_dir, *path, bun_ast::ImportKind::Stmt) {
            Ok(res) => res,
            Err(err) => {
                Output::err(
                    err,
                    "Failed to resolve '{}' for framework ({})",
                    (bstr::BStr::new(path), bstr::BStr::new(desc)),
                );
                *had_errors = true;
                return;
            }
        };
        *path = result.path().unwrap().text;
    }

    fn from_js(
        opts: JSValue,
        global: &JSGlobalObject,
        refs: &mut StringRefList,
        bundler_options: &mut SplitBundlerOptions,
        arena: &Arena,
    ) -> JsResult<Framework> {
        if opts.is_string() {
            let str = bun_core::OwnedString::new(opts.to_bun_string(global)?);

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

            let str = bun_core::OwnedString::new(prop.to_bun_string(global)?);

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
                    let prop = match get_optional_value(sc, global, b"separateSSRGraph")? {
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
                    match get_optional_slice(sc, global, b"serverRuntimeImportSource")? {
                        Some(s) => s,
                        None => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "Missing 'framework.serverComponents.serverRuntimeImportSource'"
                            )));
                        }
                    },
                ),
                server_register_client_reference: if let Some(slice) =
                    get_optional_slice(sc, global, b"serverRegisterClientReferenceExport")?
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

                let path = match get_optional_string(file, global, b"import", refs, arena)? {
                    Some(p) => p,
                    None => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "'builtInModules[{}]' is missing 'import'",
                            i
                        )));
                    }
                };

                let value: BuiltInModule = if let Some(str) =
                    get_optional_string(file, global, b"path", refs, arena)?
                {
                    BuiltInModule::Import(str)
                } else if let Some(str) = get_optional_string(file, global, b"code", refs, arena)? {
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
            // PORT NOTE: reshaped alloc+index → Vec::push (owned; deep-cloned with Framework)
            let mut file_system_router_types = Vec::with_capacity(len as usize);

            let mut it = array.array_iterator(global)?;
            let mut i: usize = 0;
            // TODO(port): errdefer for (file_system_router_types[0..i]) |*fsr| fsr.style.deinit();
            // — Style should impl Drop; bumpalo Vec drop will handle this if so.
            while let Some(fsr_opts) = it.next()? {
                let root = match get_optional_string(fsr_opts, global, b"root", refs, arena)? {
                    Some(r) => r,
                    None => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "'fileSystemRouterTypes[{}]' is missing 'root'",
                            i
                        )));
                    }
                };
                let server_entry_point = match get_optional_string(
                    fsr_opts,
                    global,
                    b"serverEntryPoint",
                    refs,
                    arena,
                )? {
                    Some(s) => s,
                    None => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "'fileSystemRouterTypes[{}]' is missing 'serverEntryPoint'",
                            i
                        )));
                    }
                };
                let client_entry_point =
                    get_optional_string(fsr_opts, global, b"clientEntryPoint", refs, arena)?;
                let prefix =
                    get_optional_string(fsr_opts, global, b"prefix", refs, arena)?.unwrap_or(b"/");
                let ignore_underscores =
                    get_boolean_strict(fsr_opts, global, b"ignoreUnderscores")?.unwrap_or(false);
                let layouts = get_boolean_strict(fsr_opts, global, b"layouts")?.unwrap_or(false);

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

                let extensions: &'static [&'static [u8]] = if let Some(exts_js) =
                    fsr_opts.get(global, "extensions")?
                {
                    'exts: {
                        if exts_js.is_string() {
                            let str = exts_js.to_slice(global)?;
                            if str.slice() == b"*" {
                                break 'exts &[] as &[&[u8]];
                            }
                        } else if exts_js.is_array() {
                            let mut it_2 = exts_js.array_iterator(global)?;
                            let mut extensions =
                                bun_alloc::ArenaVec::<&'static [u8]>::with_capacity_in(
                                    exts_js.get_length(global)? as usize,
                                    arena,
                                );
                            while let Some(array_item) = it_2.next()? {
                                let slice = refs.track(array_item.to_slice(global)?);
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
                                    let mut v = bun_alloc::ArenaVec::<u8>::with_capacity_in(
                                        1 + slice.len(),
                                        arena,
                                    );
                                    v.push(b'.');
                                    v.extend_from_slice(slice);
                                    arena_erase(v.into_bump_slice())
                                });
                            }
                            break 'exts arena_erase(extensions.into_bump_slice());
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

                let ignore_dirs: &'static [&'static [u8]] = if let Some(exts_js) =
                    fsr_opts.get(global, "ignoreDirs")?
                {
                    'exts: {
                        if exts_js.is_array() {
                            let mut it_2 = array.array_iterator(global)?;
                            let mut dirs = bun_alloc::ArenaVec::<&'static [u8]>::with_capacity_in(
                                len as usize,
                                arena,
                            );
                            while let Some(array_item) = it_2.next()? {
                                dirs.push(refs.track(array_item.to_slice(global)?));
                            }
                            break 'exts arena_erase(dirs.into_bump_slice());
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

        if let Some(plugin_array) = get_optional_value(opts, global, b"plugins")? {
            bundler_options.parse_plugin_array(plugin_array, global)?;
        }

        Ok(framework)
    }

    pub(crate) fn as_bundler_view(&self) -> bun_bundler::bake_types::Framework {
        use bun_bundler::bake_types as bt;
        let mut built_in_modules = bun_collections::StringArrayHashMap::new();
        for (k, v) in self.built_in_modules.iter() {
            let bv = match *v {
                BuiltInModule::Import(p) => bt::BuiltInModule::Import(p.into()),
                BuiltInModule::Code(c) => bt::BuiltInModule::Code(c.into()),
            };
            bun_core::handle_oom(built_in_modules.put(k, bv));
        }
        let server_components = self
            .server_components
            .as_ref()
            .map(|sc| bt::ServerComponents {
                separate_ssr_graph: sc.separate_ssr_graph,
                server_runtime_import: sc.server_runtime_import.into(),
                server_register_client_reference: sc.server_register_client_reference.into(),
                server_register_server_reference: sc.server_register_server_reference.into(),
                client_register_server_reference: sc.client_register_server_reference.into(),
            });
        let react_fast_refresh = self
            .react_fast_refresh
            .as_ref()
            .map(|rfr| bt::ReactFastRefresh {
                import_source: rfr.import_source.into(),
            });
        bt::Framework::new(
            built_in_modules,
            server_components,
            react_fast_refresh,
            self.is_built_in_react,
        )
    }

    pub fn init_transpiler<'a>(
        &mut self,
        arena: &'a Arena,
        log: &mut bun_ast::Log,
        mode: Mode,
        renderer: Graph,
        out: &mut core::mem::MaybeUninit<bun_bundler::Transpiler<'a>>,
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

    pub fn init_transpiler_with_options<'a>(
        &mut self,
        arena: &'a Arena,
        log: &mut bun_ast::Log,
        mode: Mode,
        renderer: Graph,
        out: &mut core::mem::MaybeUninit<bun_bundler::Transpiler<'a>>,
        bundler_options: &BuildConfigSubset,
        source_map: bun_bundler::options::SourceMapOption,
        minify_whitespace: Option<bool>,
        minify_syntax: Option<bool>,
        minify_identifiers: Option<bool>,
    ) -> Result<(), bun_core::Error> {
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(arena);
        let _ast_scope = ast_memory_allocator.enter();

        let out: &mut bun_bundler::Transpiler = out.write(bun_bundler::Transpiler::init(
            arena,
            log,
            // TODO(port): std.mem.zeroes(TransformOptions) — verify all-zero is valid
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
        out.options.output_format = match mode {
            Mode::Development => bun_bundler::options::Format::InternalBakeDev,
            Mode::ProductionDynamic | Mode::ProductionStatic => bun_bundler::options::Format::Esm,
        };
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
        out.options.framework = Some(&*arena.alloc(self.as_bundler_view()));
        out.options.inline_entrypoint_import_meta_main = true;
        if let Some(ignore) = bundler_options.ignore_dce_annotations {
            out.options.ignore_dce_annotations = ignore;
        }

        out.options.source_map = source_map;
        if bundler_options.env != bun_schema::api::DotEnvBehavior::_none {
            out.options.env.behavior = bundler_options.env;
            out.options.env.prefix = bundler_options.env_prefix.unwrap_or(b"").into();
        }
        // Spec bake.zig:788 `out.resolver.opts = out.options` (struct copy). The
        // resolver crate carries a FORWARD_DECL subset of `BundleOptions`, so
        // re-project via the dedicated helper rather than `Clone`.
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

        if (bundler_options.define.keys.len() + bundler_options.drop.count()) > 0 {
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

            for drop_item in bundler_options.drop.keys() {
                if !drop_item.is_empty() {
                    let parsed = bun_bundler::defines::DefineData::parse(
                        drop_item, b"", true, true, log, arena,
                    )?;
                    out.options.define.insert(drop_item, parsed)?;
                }
            }
        }

        if mode != Mode::Development {
            // Hide information about the source repository, at the cost of debugging quality.
            out.options.entry_naming = b"_bun/[hash].[ext]".as_slice().into();
            out.options.chunk_naming = b"_bun/[hash].[ext]".as_slice().into();
            out.options.asset_naming = b"_bun/[hash].[ext]".as_slice().into();
        }

        // Spec bake.zig:821 — re-sync after define/naming mutations so the
        // resolver sees the final option set.
        out.sync_resolver_opts();
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

#[derive(Copy, Clone)]
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

#[derive(Copy, Clone)]
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
    let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
    match r.resolve(top_level_dir, path, bun_ast::ImportKind::Stmt) {
        // `path_const().text` is `&'static [u8]` already (`FilenameStore`-
        // backed; see note in `resolve_helper` above and `bun_ptr::Interned`).
        Ok(res) => Some(res.path_const().unwrap().text),
        Err(_) => {
            r.log_mut().reset();
            None
        }
    }
}

#[inline]
fn style_from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<framework_router::Style> {
    framework_router::Style::from_js(value, global)
}

fn get_optional_string(
    target: JSValue,
    global: &JSGlobalObject,
    property: &[u8],
    allocations: &mut StringRefList,
    arena: &Arena,
) -> JsResult<Option<&'static [u8]>> {
    let Some(value) = target.get(global, property)? else {
        return Ok(None);
    };
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    let str = bun_core::OwnedString::new(value.to_bun_string(global)?);
    let _ = arena; // TODO(port): arena param unused after to_utf8() drops allocator
    Ok(Some(allocations.track(str.to_utf8())))
}

// PORT NOTE: `HmrRuntime` is defined canonically in the parent `bake/mod.rs`
// (struct with `code: &'static ZStr` + `line_count`); re-export so callers
// using `bake_body::HmrRuntime` see the same nominal type.
pub(crate) use super::HmrRuntime;

fn hmr_runtime_init(code: &'static ZStr) -> HmrRuntime {
    HmrRuntime {
        code,
        line_count: u32::try_from(code.as_bytes().iter().filter(|&&b| b == b'\n').count()).unwrap(),
    }
}

#[inline(always)]
pub fn get_hmr_runtime(side: Side) -> HmrRuntime {
    use std::sync::OnceLock;
    fn nul_terminate(s: &'static str, cell: &'static OnceLock<Box<[u8]>>) -> &'static ZStr {
        let buf = cell.get_or_init(|| {
            let mut v = Vec::with_capacity(s.len() + 1);
            v.extend_from_slice(s.as_bytes());
            v.push(0);
            v.into_boxed_slice()
        });
        // SAFETY: buf is process-lifetime (`OnceLock` static), buf[len-1] == 0.
        ZStr::from_slice_with_nul(&buf[..])
    }
    static CLIENT: OnceLock<Box<[u8]>> = OnceLock::new();
    static SERVER: OnceLock<Box<[u8]>> = OnceLock::new();
    hmr_runtime_init(match side {
        Side::Client => nul_terminate(
            bun_core::runtime_embed_file!(CodegenEager, "bake.client.js"),
            &CLIENT,
        ),
        // server runtime is loaded once, so it is pointless to make this eager.
        Side::Server => nul_terminate(
            bun_core::runtime_embed_file!(Codegen, "bake.server.js"),
            &SERVER,
        ),
    })
}

pub(crate) use super::Mode;
pub(crate) use bun_bundler::bake_types::{Graph, Side};

pub(crate) fn add_import_meta_defines(
    define: &mut bun_bundler::options::Define,
    mode: Mode,
    side: Side,
) -> Result<(), bun_core::Error> {
    use bun_ast::E::EString;

    use bun_bundler::defines::DefineData;

    static MODE_DEVELOPMENT: EString = EString::from_static(b"development");
    static MODE_PRODUCTION: EString = EString::from_static(b"production");

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
            Mode::ProductionDynamic | Mode::ProductionStatic => &MODE_PRODUCTION,
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
pub struct PatternBuffer {
    pub bytes: PathBuffer,
    pub i: u32,
}

impl PatternBuffer {
    pub const EMPTY: PatternBuffer = PatternBuffer {
        bytes: PathBuffer::ZEROED, // TODO(port): Zig used `undefined`; uninit not const-safe
        i: core::mem::size_of::<PathBuffer>() as u32,
    };

    pub fn prepend(&mut self, chunk: &[u8]) {
        debug_assert!(self.i as usize >= chunk.len());
        self.i -= u32::try_from(chunk.len()).expect("int cast");
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
            framework_router::Part::Group(_) => {}
        }
    }

    pub fn slice(&self) -> &[u8] {
        &self.bytes[self.i as usize..]
    }

    fn slice_mut(&mut self) -> &mut [u8] {
        &mut self.bytes[self.i as usize..]
    }
}

pub fn print_warning() {
    // Silence this for the test suite
    if bun_core::env_var::BUN_DEV_SERVER_TEST_RUNNER
        .get()
        .is_none()
    {
        Output::warn(format_args!(
            "Be advised that Bun Bake is highly experimental, and its API\n\
             will have breaking changes. Join the <magenta>#bake<r> Discord\n\
             channel to help us find bugs: <blue>https://bun.com/discord<r>\n\
             \n"
        ));
        Output::flush();
    }
}

// ported from: src/bake/bake.zig
