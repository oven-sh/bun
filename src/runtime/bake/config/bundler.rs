//! Per-graph bundler settings (client, server, SSR) and the shared plugin.

use crate::api::js_bundler::Plugin;
use crate::api::js_bundler::js_bundler::PluginJscExt as _;
use crate::bake::jsc;
use crate::generated_bindgen::server::{
    BakeMinify, BakePlugin, BakeSourceMap, BuildConfigSubsetOptions,
};
use bun_jsc::bindgen::JsLocal;
use bun_jsc::{JSGlobalObject, JSObject, JSValue, JsResult};
use bun_options_types::schema::api::SourceMapMode;
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
            let Some(plugin_config) = JsLocal::<JSObject>::from_js(global, plugin_config) else {
                return Err(
                    global.throw_invalid_arguments(format_args!("Expected plugin to be an object"))
                );
            };
            let plugin_config = BakePlugin::new(plugin_config);

            if let Some(slice) = plugin_config.name(global)? {
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

            let function = match plugin_config.setup(global)? {
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
                function.to_js(),
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
    pub(crate) fn from_js(js_options: BuildConfigSubsetOptions) -> BuildConfigSubset {
        let mut options = BuildConfigSubset::default();

        if let Some(sourcemap) = js_options.sourcemap {
            options.source_map = match sourcemap {
                BakeSourceMap::None => SourceMapMode::None,
                BakeSourceMap::Inline => SourceMapMode::Inline,
                BakeSourceMap::External => SourceMapMode::External,
                BakeSourceMap::Linked => SourceMapMode::Linked,
            };
        }

        match js_options.minify {
            Some(BakeMinify::All(true)) => {
                options.minify_syntax = Some(true);
                options.minify_identifiers = Some(true);
                options.minify_whitespace = Some(true);
            }
            Some(BakeMinify::Parts(parts)) => {
                options.minify_whitespace = parts.whitespace;
                options.minify_syntax = parts.syntax;
                options.minify_identifiers = parts.identifiers;
            }
            Some(BakeMinify::All(false) | BakeMinify::Other) | None => {}
        }

        options
    }
}
