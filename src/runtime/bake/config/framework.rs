//! `Framework`: what a framework (or the config-less default) tells Bake, and how it is read from JS.

use super::SplitBundlerOptions;
use crate::bake::{BuiltInModule, router};
use bun_collections::StringArrayHashMap;
use bun_core::Utf8Bytes;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use std::borrow::Cow;

/// `bake.Framework.ServerComponents`.
///
/// Here and below, `Borrowed` is a literal or a path the resolver interned, `Shared` a JS string.
pub(crate) struct ServerComponents {
    pub(crate) separate_ssr_graph: bool,
    /// REQUIRED — `fromJS` throws if `serverRuntimeImportSource` is absent.
    pub(crate) server_runtime_import: Utf8Bytes<'static>,
    pub(crate) server_register_client_reference: Utf8Bytes<'static>,
    pub(crate) server_register_server_reference: Utf8Bytes<'static>,
    pub(crate) client_register_server_reference: Utf8Bytes<'static>,
}

impl ServerComponents {
    pub(crate) fn new(separate_ssr_graph: bool, server_runtime_import: Utf8Bytes<'static>) -> Self {
        Self {
            separate_ssr_graph,
            server_runtime_import,
            server_register_client_reference: Utf8Bytes::Borrowed(b"registerClientReference"),
            server_register_server_reference: Utf8Bytes::Borrowed(b"registerServerReference"),
            client_register_server_reference: Utf8Bytes::Borrowed(b"registerServerReference"),
        }
    }
}

pub(crate) struct ReactFastRefresh {
    pub(crate) import_source: Utf8Bytes<'static>,
}

impl Default for ReactFastRefresh {
    fn default() -> Self {
        Self {
            import_source: Utf8Bytes::Borrowed(b"react-refresh/runtime"),
        }
    }
}

pub(crate) struct FileSystemRouterType {
    pub(crate) root: Utf8Bytes<'static>,
    pub(crate) prefix: Utf8Bytes<'static>,
    pub(crate) entry_client: Option<Utf8Bytes<'static>>,
    /// REQUIRED — `fromJS` throws if missing; `Framework.resolve`
    /// dereferences unconditionally.
    pub(crate) entry_server: Utf8Bytes<'static>,
    pub(crate) ignore_underscores: bool,
    pub(crate) ignore_dirs: Vec<Utf8Bytes<'static>>,
    pub(crate) extensions: Vec<Utf8Bytes<'static>>,
    pub(crate) style: router::Style,
    pub(crate) allow_layouts: bool,
    /// `clientPages`: the page and layout files also run in the browser. The dev server adds them to
    /// the client graph, and the client entry gets them from `route` of `bun:bake/client`, to hydrate
    /// the server's HTML. Not with server components.
    pub(crate) client_pages: bool,
    /// `clientPages.serverExports`: the exports of a page that run on the server only. The browser
    /// build of a page drops them, and the imports that only they use.
    pub(crate) server_exports: Vec<Utf8Bytes<'static>>,
}

/// A "Framework" is simply a set of bundler options that a framework author
/// would set in order to integrate with the application.
#[derive(Default)]
pub(crate) struct Framework {
    pub(crate) is_built_in_react: bool,
    /// Owned `Vec` so `resolve()` can take `&mut` and rewrite entries in
    /// place; freed by `Vec::drop`.
    pub(crate) file_system_router_types: Vec<FileSystemRouterType>,
    pub(crate) server_components: Option<ServerComponents>,
    pub(crate) react_fast_refresh: Option<ReactFastRefresh>,
    pub(crate) built_in_modules: bun_collections::StringArrayHashMap<BuiltInModule>,
}

pub(super) fn resolve_path(
    r: &mut bun_resolver::Resolver,
    path: &[u8],
) -> Result<Utf8Bytes<'static>, bun_resolver::Error> {
    let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir();
    let result = r.resolve(top_level_dir, path, bun_ast::ImportKind::Stmt)?;
    // No path: disabled, by a "browser" map for example.
    let text = result
        .path_const()
        .ok_or(bun_resolver::Error::ModuleNotFound)?
        .text;
    // `text` is typed `'static`, but is `path` for an external or `data:` result.
    Ok(match bun_resolver::fs::as_interned_path(text) {
        Some(interned) => Utf8Bytes::Borrowed(interned),
        None => Utf8Bytes::Owned(text.to_vec()),
    })
}

impl Framework {
    /// Project the runtime-side `bake::Framework` into the bundler crate's
    /// TYPE_ONLY view (`bun_bundler::bake_types::Framework`). The bundler is a
    /// lower-tier crate and cannot name `bun_runtime::bake::Framework`; this is
    /// the value `init_transpiler` arena-allocates and hands to
    /// `out.options.framework`.
    pub(in crate::bake) fn as_bundler_view(&self) -> bun_bundler::bake_types::Framework {
        use bun_bundler::bake_types as bt;
        let built_in_modules = bun_core::handle_oom(self.built_in_modules.clone());
        let server_components = self
            .server_components
            .as_ref()
            .map(|sc| bt::ServerComponents {
                separate_ssr_graph: sc.separate_ssr_graph,
                server_runtime_import: sc.server_runtime_import.as_ref().into(),
                server_register_client_reference: sc
                    .server_register_client_reference
                    .as_ref()
                    .into(),
                server_register_server_reference: sc
                    .server_register_server_reference
                    .as_ref()
                    .into(),
                client_register_server_reference: sc
                    .client_register_server_reference
                    .as_ref()
                    .into(),
            });
        let react_fast_refresh = self
            .react_fast_refresh
            .as_ref()
            .map(|rfr| bt::ReactFastRefresh {
                import_source: rfr.import_source.as_ref().into(),
            });
        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir();
        let client_page_dirs = self
            .file_system_router_types
            .iter()
            .filter(|fsr| fsr.client_pages)
            .map(|fsr| bt::ClientPageDir {
                dir: Box::<[u8]>::from(bun_paths::resolve_path::join_abs::<
                    bun_paths::platform::Auto,
                >(top_level_dir, &fsr.root)),
                server_exports: fsr
                    .server_exports
                    .iter()
                    .map(|name| Box::<[u8]>::from(name.as_ref()))
                    .collect(),
            })
            .collect();
        bt::Framework::new(
            built_in_modules,
            server_components,
            react_fast_refresh,
            client_page_dirs,
        )
    }

    /// Resolves built-in module
    /// specifiers and entry points against the resolvers, in place. Errors written into `r.log`.
    pub(crate) fn resolve(
        &mut self,
        server: &mut bun_resolver::Resolver,
        client: &mut bun_resolver::Resolver,
    ) -> crate::Result<()> {
        let mut had_errors = false;

        if let Some(rfr) = &mut self.react_fast_refresh {
            Self::resolve_helper(
                &self.built_in_modules,
                client,
                &mut rfr.import_source,
                &mut had_errors,
                b"react refresh runtime",
            );
        }
        if let Some(sc) = &mut self.server_components {
            Self::resolve_helper(
                &self.built_in_modules,
                server,
                &mut sc.server_runtime_import,
                &mut had_errors,
                b"server components runtime",
            );
        }
        for (i, fsr) in self.file_system_router_types.iter_mut().enumerate() {
            match resolve_dir_option(&fsr.root) {
                Some(root) => fsr.root = Utf8Bytes::Owned(root),
                None => {
                    bun_core::Output::err(
                        "ENAMETOOLONG",
                        "Failed to resolve 'fileSystemRouterTypes[{}].root' for framework",
                        (i,),
                    );
                    had_errors = true;
                }
            }
            if let Some(entry_client) = &mut fsr.entry_client {
                Self::resolve_helper(
                    &self.built_in_modules,
                    client,
                    entry_client,
                    &mut had_errors,
                    b"client side entrypoint",
                );
            }
            Self::resolve_helper(
                &self.built_in_modules,
                client,
                &mut fsr.entry_server,
                &mut had_errors,
                b"server side entrypoint",
            );
        }

        if had_errors {
            return Err(crate::Error::ModuleNotFound);
        }
        Ok(())
    }

    fn resolve_helper(
        built_in_modules: &bun_collections::StringArrayHashMap<BuiltInModule>,
        r: &mut bun_resolver::Resolver,
        path: &mut Utf8Bytes<'static>,
        had_errors: &mut bool,
        desc: &[u8],
    ) {
        if let Some(module) = built_in_modules.get(path) {
            if let BuiltInModule::Import(p) = module {
                *path = Utf8Bytes::Owned(p.to_vec());
            }
            return;
        }
        match resolve_path(r, path) {
            Ok(resolved) => *path = resolved,
            Err(err) => {
                // This routes through `Output::err` (stderr), not
                // `r.log`. The "Errors written into r.log" doc on `Framework.resolve`
                // refers to entries the resolver itself pushed; this top-level
                // "Failed to resolve" line goes to the terminal.
                bun_core::Output::err(
                    err,
                    "Failed to resolve '{s}' for framework ({s})",
                    (bstr::BStr::new(path), bstr::BStr::new(desc)),
                );
                *had_errors = true;
            }
        }
    }
}

/// Joins a directory option onto the working directory.
/// Returns `None` if the result is too long for `Resolver::read_dir_info`.
pub(crate) fn resolve_dir_option(dir: &[u8]) -> Option<Vec<u8>> {
    let mut buf = bun_paths::path_buffer_pool::get();
    let resolved = bun_paths::resolve_path::join_abs_string_buf_checked::<bun_paths::platform::Auto>(
        bun_resolver::fs::FileSystem::get().top_level_dir(),
        &mut buf[..bun_paths::MAX_PATH_BYTES - 1],
        &[dir],
    )?;
    Some(bun_paths::string_paths::without_trailing_slash_windows_path(resolved).to_vec())
}

impl Framework {
    pub(crate) fn from_js(
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
                import_source: str.into_utf8(),
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
                sc.get_optional_slice(global, b"serverRuntimeImportSource")?
            else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Missing 'framework.serverComponents.serverRuntimeImportSource'"
                )));
            };
            let mut server_components =
                ServerComponents::new(separate_ssr_graph, server_runtime_import);
            if let Some(name) =
                sc.get_optional_slice(global, b"serverRegisterClientReferenceExport")?
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
                    if let Some(str) = file.get_optional_slice(global, b"path")? {
                        BuiltInModule::Import(Cow::Owned(str.into_vec()))
                    } else if let Some(str) = file.get_optional_slice(global, b"code")? {
                        BuiltInModule::Code(Cow::Owned(str.into_vec()))
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
                let root = match fsr_opts.get_optional_slice(global, b"root")? {
                    Some(r) => r,
                    None => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "'fileSystemRouterTypes[{}]' is missing 'root'",
                            i
                        )));
                    }
                };
                let server_entry_point =
                    match fsr_opts.get_optional_slice(global, b"serverEntryPoint")? {
                        Some(s) => s,
                        None => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "'fileSystemRouterTypes[{}]' is missing 'serverEntryPoint'",
                                i
                            )));
                        }
                    };
                let client_entry_point =
                    fsr_opts.get_optional_slice(global, b"clientEntryPoint")?;
                let prefix = fsr_opts
                    .get_optional_slice(global, b"prefix")?
                    .unwrap_or(Utf8Bytes::Borrowed(b"/"));
                let ignore_underscores = fsr_opts
                    .get_boolean_strict(global, "ignoreUnderscores")?
                    .unwrap_or(false);
                let layouts = fsr_opts
                    .get_boolean_strict(global, "layouts")?
                    .unwrap_or(false);
                // `clientPages: true`, or `clientPages: { serverExports: [...] }`.
                let (client_pages, server_exports) = match fsr_opts.get(global, "clientPages")? {
                    None => (false, Vec::new()),
                    Some(v) if v.is_boolean() => (v.as_boolean(), Vec::new()),
                    Some(v) if v.is_object() => {
                        let not_a_list = || {
                            global.throw_invalid_arguments(format_args!(
                                "'fileSystemRouterTypes[{}].clientPages.serverExports' must be an array of export names",
                                i
                            ))
                        };
                        let list = match v.get(global, "serverExports")? {
                            Some(list) if list.is_array() => list,
                            _ => return Err(not_a_list()),
                        };
                        let mut names = Vec::new();
                        let mut it_2 = list.array_iterator(global)?;
                        while let Some(item) = it_2.next()? {
                            if !item.is_string() {
                                return Err(not_a_list());
                            }
                            names.push(item.to_utf8(global)?);
                        }
                        (true, names)
                    }
                    Some(_) => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "'fileSystemRouterTypes[{}].clientPages' must be a boolean or an object",
                            i
                        )));
                    }
                };
                // The client entry point is what loads the pages in the browser.
                if client_pages && client_entry_point.is_none() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "'fileSystemRouterTypes[{}].clientPages' needs a 'clientEntryPoint'",
                        i
                    )));
                }

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

                let extensions = if let Some(exts_js) = fsr_opts.get(global, "extensions")? {
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
                                let slice = array_item.to_utf8(global)?;
                                if slice.slice() == b"*" {
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
                                    Utf8Bytes::Owned([b".", slice.slice()].concat())
                                });
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

                let ignore_dirs = if let Some(dirs_js) = fsr_opts.get(global, "ignoreDirs")? {
                    'exts: {
                        if dirs_js.is_array() {
                            let mut it_2 = dirs_js.array_iterator(global)?;
                            let mut dirs = Vec::with_capacity(dirs_js.get_length(global)? as usize);
                            while let Some(array_item) = it_2.next()? {
                                dirs.push(array_item.to_utf8(global)?);
                            }
                            break 'exts dirs;
                        }

                        return Err(global.throw_invalid_arguments(format_args!(
                            "'ignoreDirs' must be an array of strings"
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
                    client_pages,
                    server_exports,
                });
                i += 1;
            }

            break 'brk file_system_router_types;
        };
        // errdefer for (file_system_router_types) |*fsr| fsr.style.deinit();
        // — Vec<FileSystemRouterType> drops contents on early return.

        // With server components, the client graph gets the client components of a page, not the page.
        if server_components.is_some()
            && file_system_router_types.iter().any(|fsr| fsr.client_pages)
        {
            return Err(global.throw_invalid_arguments(format_args!(
                "'fileSystemRouterTypes[n].clientPages' cannot be used with 'serverComponents'"
            )));
        }

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
}

pub(super) fn literals(list: &[&'static [u8]]) -> Vec<Utf8Bytes<'static>> {
    list.iter().copied().map(Utf8Bytes::Borrowed).collect()
}

/// Thin forwarding shim — the real impl lives on
/// `router::Style::from_js`.
#[inline]
fn style_from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<router::Style> {
    router::Style::from_js(value, global)
}
