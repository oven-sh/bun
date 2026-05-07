//! Runtime plugin host (JS-side `Bun.plugin()` resolve hooks). Moved from
//! `bundler/transpiler.zig` so `bundler/` is free of `JSValue`/`JSGlobalObject`.

use std::io::Write as _;

use bun_logger::{Loc, Log};
use bun_string::{strings, String as BunString};

use crate::{ErrorableString, JSGlobalObject, JSValue, JsResult};
use bun_jsc::{BunPluginTarget, StringJsc};

pub use bun_resolver::fs::Path as FsPath;

pub type MacroJsCtx = JSValue;
pub const DEFAULT_MACRO_JS_VALUE: JSValue = JSValue::ZERO;

pub struct PluginRunner<'a> {
    pub global_object: &'a JSGlobalObject,
    // PORT NOTE: Zig had `allocator: std.mem.Allocator` — dropped; global mimalloc is used.
}

impl<'a> PluginRunner<'a> {
    /// Spec PluginRunner.zig:14 — canonical body lives in
    /// `bun_bundler::transpiler::PluginRunner` (lower tier, pure byte parsing).
    #[inline]
    pub fn extract_namespace(specifier: &[u8]) -> &[u8] {
        bun_bundler::transpiler::PluginRunner::extract_namespace(specifier)
    }

    /// Spec PluginRunner.zig:22 — canonical body lives in
    /// `bun_bundler::transpiler::PluginRunner` (lower tier, pure byte parsing).
    #[inline]
    pub fn could_be_plugin(specifier: &[u8]) -> bool {
        bun_bundler::transpiler::PluginRunner::could_be_plugin(specifier)
    }

    // `on_resolve` (the `Log`-reporting variant, PluginRunner.zig:34) is wired
    // as the `bun_bundler::transpiler::PluginRunner.on_resolve` dispatch slot
    // by `bun_jsc::Bun__onDidAppendPlugin`; no inherent method here.

    pub fn on_resolve_jsc(
        &self,
        namespace: BunString,
        specifier: BunString,
        importer: BunString,
        target: BunPluginTarget,
    ) -> JsResult<Option<ErrorableString>> {
        let global = self.global_object;
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
                    .to_error_instance(self.global_object),
            )));
        }

        let file_path = path_value.to_bun_string(global)?;

        if file_path.length() == 0 {
            return Ok(Some(ErrorableString::err(
                bun_core::err!(JSErrorObject),
                BunString::static_(
                    b"Expected \"path\" to be a non-empty string in onResolve plugin",
                )
                .to_error_instance(self.global_object),
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
                    .to_error_instance(self.global_object),
            )));
        }
        let mut static_namespace = true;
        let user_namespace: BunString = 'brk: {
            if let Some(namespace_value) = on_resolve_plugin.get(global, b"namespace")? {
                if !namespace_value.is_string() {
                    return Ok(Some(ErrorableString::err(
                        bun_core::err!(JSErrorObject),
                        BunString::static_(b"Expected \"namespace\" to be a string")
                            .to_error_instance(self.global_object),
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
        let jsval = match out_.to_js(self.global_object) {
            Ok(v) => v,
            Err(_err) => {
                return Ok(Some(ErrorableString::err(
                    bun_core::err!(JSError),
                    self.global_object
                        .try_take_exception()
                        .unwrap_or(JSValue::UNDEFINED),
                )));
            }
        };
        let out = match jsval.to_bun_string(self.global_object) {
            Ok(v) => v,
            Err(_err) => {
                return Ok(Some(ErrorableString::err(
                    bun_core::err!(JSError),
                    self.global_object
                        .try_take_exception()
                        .unwrap_or(JSValue::UNDEFINED),
                )));
            }
        };
        Ok(Some(ErrorableString::ok(out)))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/PluginRunner.zig (241 lines)
//   confidence: medium
//   todos:      2
//   notes:      Fs.Path.initWithNamespace ownership signature & ErrorableString::err arg type need confirming; allocator field dropped.
// ──────────────────────────────────────────────────────────────────────────
