//! Per-graph bundler settings (client, server, SSR) and the shared plugin.

use crate::api::js_bundler::Plugin;
use crate::api::js_bundler::js_bundler::PluginJscExt as _;
use crate::bake::jsc;
use bun_bundler_jsc::source_map_mode_jsc::source_map_mode_from_js;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use core::ptr::NonNull;
use std::collections::VecDeque;

/// `bake.SplitBundlerOptions` — per-graph bundler config + shared plugin.
#[derive(Default)]
pub(crate) struct SplitBundlerOptions {
    /// FFI: `jsc.API.JSBundler.Plugin` (`JSBundlerPlugin__create`); deinit
    /// goes through the C++ side. See LIFETIMES.tsv.
    pub(crate) plugin: Option<NonNull<jsc::Plugin>>,
    /// What `run_plugin_setups` has yet to call, in the order of the plugins. The order in which
    /// they finish decides which plugin sees a module first, so each one waits for the promise of
    /// the one before it.
    pub(crate) plugin_setups: VecDeque<PluginSetup>,
    /// The promise of the `setup()` call that is under way. `plugin` is complete, and a bundle
    /// may start, once this is `None` and `plugin_setups` is empty.
    pub(crate) pending_plugin_setup: Option<bun_jsc::Strong>,
    pub(crate) client: BuildConfigSubset,
    pub(crate) server: BuildConfigSubset,
    pub(crate) ssr: BuildConfigSubset,
}

pub(crate) struct PluginSetup {
    function: bun_jsc::Strong,
    /// `build.config`: one object for the plugins of one array.
    config: bun_jsc::Strong,
}

pub(crate) struct BuildConfigSubset {
    pub(crate) env: bun_options_types::schema::api::DotEnvBehavior,
    pub(crate) env_prefix: Option<Box<[u8]>>,
    pub(crate) define: bun_options_types::schema::api::StringMap,
    pub(crate) source_map: bun_options_types::schema::api::SourceMapMode,

    pub(crate) minify_syntax: Option<bool>,
    pub(crate) minify_identifiers: Option<bool>,
    pub(crate) minify_whitespace: Option<bool>,
}

impl Default for BuildConfigSubset {
    fn default() -> Self {
        use bun_options_types::schema::api;
        BuildConfigSubset {
            env: api::DotEnvBehavior::_none,
            env_prefix: None,
            define: api::StringMap::EMPTY,
            source_map: api::SourceMapMode::External,

            minify_syntax: None,
            minify_identifiers: None,
            minify_whitespace: None,
        }
    }
}

impl SplitBundlerOptions {
    /// `PluginJscExt::destroy` is the paired destructor of `Plugin::create`
    /// in `parse_plugin_array`: it unprotects the JSCell.
    pub(crate) fn destroy_plugin(&mut self) {
        self.plugin_setups.clear();
        self.pending_plugin_setup = None;
        if let Some(p) = self.plugin.take() {
            Plugin::destroy(p.as_ptr());
        }
    }

    pub(super) fn parse_plugin_array(
        &mut self,
        plugin_array: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        // Create the Plugin and assign it to `opts.plugin` BEFORE iterating,
        // so `plugins: []` still leaves `self.plugin = Some(_)`.
        if self.plugin.is_none() {
            let p = Plugin::create(global, crate::api::js_bundler::BunPluginTarget::Bun);
            self.plugin = Some(
                NonNull::new(p)
                    .expect("JSBundlerPlugin__create returns a non-null protected JSCell"),
            );
        }

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
            self.plugin_setups.push_back(PluginSetup {
                function: bun_jsc::Strong::create(function, global),
                config: bun_jsc::Strong::create(empty_object, global),
            });
        }
        self.run_plugin_setups(global)
    }

    /// Calls the `setup` functions in turn, up to one that returns a pending promise. It never
    /// waits: the caller does, and calls this again once it has cleared `pending_plugin_setup`.
    pub(crate) fn run_plugin_setups(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        while self.pending_plugin_setup.is_none() {
            let Some(setup) = self.plugin_setups.pop_front() else {
                break;
            };
            let plugin = self.plugin.expect("parse_plugin_array created it");
            // `Plugin` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
            // deref. Handle held live in `self.plugin` (protected JSCell).
            let plugin_result = Plugin::opaque_mut(plugin.as_ptr()).add_plugin(
                setup.function.get(),
                setup.config.get(),
                JSValue::NULL,
                false,
                true,
            )?;

            if let Some(promise) = plugin_result.as_any_promise() {
                promise.set_handled(global.vm());
                match promise.unwrap(global.vm(), bun_jsc::PromiseUnwrapMode::MarkHandled) {
                    bun_jsc::PromiseResult::Pending => {
                        self.pending_plugin_setup =
                            Some(bun_jsc::Strong::create(plugin_result, global));
                    }
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
