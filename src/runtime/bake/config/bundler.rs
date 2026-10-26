//! Per-graph bundler settings (client, server, SSR) and the shared plugin.

use crate::api::js_bundler::Plugin;
use crate::api::js_bundler::js_bundler::PluginJscExt as _;
use crate::bake::jsc;
use bun_bundler_jsc::source_map_mode_jsc::source_map_mode_from_js;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use core::ptr::NonNull;

/// `bake.SplitBundlerOptions` — per-graph bundler config + shared plugin.
#[derive(Default)]
pub(crate) struct SplitBundlerOptions {
    /// FFI: `jsc.API.JSBundler.Plugin` (`JSBundlerPlugin__create`); deinit
    /// goes through the C++ side. See LIFETIMES.tsv.
    pub(crate) plugin: Option<NonNull<jsc::Plugin>>,
    pub(crate) client: BuildConfigSubset,
    pub(crate) server: BuildConfigSubset,
    pub(crate) ssr: BuildConfigSubset,
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
