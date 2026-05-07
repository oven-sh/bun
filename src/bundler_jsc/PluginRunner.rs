//! Runtime plugin host (JS-side `Bun.plugin()` resolve hooks). Moved from
//! `bundler/transpiler.zig` so `bundler/` is free of `JSValue`/`JSGlobalObject`.

use std::io::Write as _;

use bun_string::String as BunString;

use crate::{ErrorableString, JSGlobalObject, JSValue, JsResult};
use bun_jsc::{BunPluginTarget, StringJsc};

pub use bun_resolver::fs::Path as FsPath;

/// Spec `PluginRunner.zig:MacroJSCtx` — re-export of the canonical newtype
/// (defined at the lowest tier that stores it, `bun_js_parser::Macro`).
pub use bun_bundler::transpiler::MacroJSCtx as MacroJsCtx;
pub const DEFAULT_MACRO_JS_VALUE: MacroJsCtx = MacroJsCtx::ZERO;

/// Spec `PluginRunner.zig:PluginRunner` — re-export of the canonical struct.
/// `extract_namespace` / `could_be_plugin` live there (pure byte parsing); the
/// `on_resolve` body is wired as a dispatch slot by
/// `bun_jsc::Bun__onDidAppendPlugin`; `on_resolve_jsc` (below) is a free fn
/// because it only reads the global, not the runner record.
pub use bun_bundler::transpiler::PluginRunner;

/// Spec PluginRunner.zig:14 — re-export for callers that named this module.
#[inline]
pub fn extract_namespace(specifier: &[u8]) -> &[u8] {
    PluginRunner::extract_namespace(specifier)
}

/// Spec PluginRunner.zig:22 — re-export for callers that named this module.
#[inline]
pub fn could_be_plugin(specifier: &[u8]) -> bool {
    PluginRunner::could_be_plugin(specifier)
}

// `on_resolve` (the `Log`-reporting variant, PluginRunner.zig:34) is wired as
// the `bun_bundler::transpiler::PluginRunner.on_resolve` dispatch slot by
// `bun_jsc::Bun__onDidAppendPlugin`; no body here.

/// Spec PluginRunner.zig:121 `onResolveJSC`.
pub fn on_resolve_jsc(
    global: &JSGlobalObject,
    namespace: BunString,
    specifier: BunString,
    importer: BunString,
    target: BunPluginTarget,
) -> JsResult<Option<ErrorableString>> {
    let Some(on_resolve_plugin) = global.run_on_resolve_plugins(
                if namespace.length() > 0 && !namespace.eql_comptime(b"file") {
                    namespace
                } else {
                    BunString::static_(b"")
                },
                specifier,
                importer,
                target,
            )?
        else {
            return Ok(None);
        };
        if !on_resolve_plugin.is_object() {
            return Ok(None);
        }
        let Some(path_value) = on_resolve_plugin.get(global, b"path")? else {
            return Ok(None);
        };
        if path_value.is_empty_or_undefined_or_null() {
            return Ok(None);
        }
        if !path_value.is_string() {
            return Ok(Some(ErrorableString::err(
                bun_core::err!(JSErrorObject),
                BunString::static_(b"Expected \"path\" to be a string in onResolve plugin")
                    .to_error_instance(global),
            )));
        }

        let file_path = path_value.to_bun_string(global)?;

        if file_path.length() == 0 {
            return Ok(Some(ErrorableString::err(
                bun_core::err!(JSErrorObject),
                BunString::static_(
                    b"Expected \"path\" to be a non-empty string in onResolve plugin",
                )
                .to_error_instance(global),
            )));
        } else if
        // TODO: validate this better
        file_path.eql_comptime(b".")
            || file_path.eql_comptime(b"..")
            || file_path.eql_comptime(b"...")
            || file_path.eql_comptime(b" ")
        {
            return Ok(Some(ErrorableString::err(
                bun_core::err!(JSErrorObject),
                BunString::static_(b"\"path\" is invalid in onResolve plugin")
                    .to_error_instance(global),
            )));
        }
        let mut static_namespace = true;
        let user_namespace: BunString = 'brk: {
            if let Some(namespace_value) = on_resolve_plugin.get(global, b"namespace")? {
                if !namespace_value.is_string() {
                    return Ok(Some(ErrorableString::err(
                        bun_core::err!(JSErrorObject),
                        BunString::static_(b"Expected \"namespace\" to be a string")
                            .to_error_instance(global),
                    )));
                }

                let namespace_str = namespace_value.to_bun_string(global)?;
                if namespace_str.length() == 0 {
                    break 'brk BunString::static_(b"file");
                }

                if namespace_str.eql_comptime(b"file") {
                    break 'brk BunString::static_(b"file");
                }

                if namespace_str.eql_comptime(b"bun") {
                    break 'brk BunString::static_(b"bun");
                }

                if namespace_str.eql_comptime(b"node") {
                    break 'brk BunString::static_(b"node");
                }

                static_namespace = false;

                break 'brk namespace_str;
            }

            break 'brk BunString::static_(b"file");
        };
        let _ = static_namespace;

        // Our super slow way of cloning the string into memory owned by jsc
        let mut combined_string: Vec<u8> = Vec::new();
        write!(&mut combined_string, "{}:{}", user_namespace, file_path).expect("unreachable");
    let out_ = BunString::borrow_utf8(&combined_string);
    let jsval = match out_.to_js(global) {
        Ok(v) => v,
        Err(_err) => {
            return Ok(Some(ErrorableString::err(
                bun_core::err!(JSError),
                global.try_take_exception().unwrap_or(JSValue::UNDEFINED),
            )));
        }
    };
    let out = match jsval.to_bun_string(global) {
        Ok(v) => v,
        Err(_err) => {
            return Ok(Some(ErrorableString::err(
                bun_core::err!(JSError),
                global.try_take_exception().unwrap_or(JSValue::UNDEFINED),
            )));
        }
    };
    Ok(Some(ErrorableString::ok(out)))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/PluginRunner.zig (241 lines)
//   confidence: medium
//   todos:      2
//   notes:      Fs.Path.initWithNamespace ownership signature & ErrorableString::err arg type need confirming; allocator field dropped.
// ──────────────────────────────────────────────────────────────────────────
