//! The Bake config: one type for both `bun index.html` (no config) and `bun ./app.ts` (an `app` export).

use bun_alloc::Arena;
use bun_core::{ZBox, strings};
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

mod bundler;
mod defaults;
mod framework;
pub(crate) mod plugins;
mod transpiler;

pub(crate) use bundler::{BuildConfigSubset, SplitBundlerOptions};
pub(crate) use framework::{FileSystemRouterType, Framework, ReactFastRefresh, ServerComponents};

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
        self.bundler_options.destroy_plugin();
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

        match Self::parse_framework_root_and_plugins(config, global, &mut bundler_options) {
            Ok((framework, root)) => Ok(UserOptions {
                root,
                framework,
                bundler_options,
                arena,
            }),
            Err(err) => {
                // `UserOptions` was never built, so its `Drop` will not free the plugin.
                bundler_options.destroy_plugin();
                Err(err)
            }
        }
    }

    fn parse_framework_root_and_plugins(
        config: JSValue,
        global: &JSGlobalObject,
        bundler_options: &mut SplitBundlerOptions,
    ) -> JsResult<(Framework, ZBox)> {
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
            bundler_options,
        )?;

        let root = if let Some(slice) = config.get_optional_slice(global, "root")? {
            // Make the root absolute because the dev server strips it off absolute file paths.
            match framework::resolve_dir_option(slice.slice()) {
                Some(root) => ZBox::from_vec(root),
                None => {
                    return Err(global
                        .throw_invalid_arguments(format_args!("'{}.root' is too long", API_NAME)));
                }
            }
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

        Ok((framework, root))
    }
}
