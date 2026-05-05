//! Runtime plugin host (JS-side `Bun.plugin()` resolve hooks). Moved from
//! `bundler/transpiler.zig` so `bundler/` is free of `JSValue`/`JSGlobalObject`.

use std::io::Write as _;

use bun_logger::{Loc, Log};
use bun_string::{strings, String as BunString};

use crate::{ErrorableString, JSGlobalObject, JSValue, JsResult};

// TODO(b2-blocked): bun_jsc::BunPluginTarget
// `BunPluginTarget` is `jsc.JSGlobalObject.BunPluginTarget` in Zig; the bun_jsc
// stub surface does not expose it yet. Local opaque alias so signatures land.
pub type BunPluginTarget = u8;

// TODO(b2-blocked): bun_resolver::fs::Path::init_with_namespace
// `bun_resolver::fs::Path` is currently a `()` stub. Alias it so the signature
// type-checks; the only call sites (`on_resolve`) are body-gated below.
pub use bun_resolver::fs::Path as FsPath;

pub type MacroJsCtx = JSValue;
// TODO(b2-blocked): bun_jsc::JSValue::ZERO
pub const DEFAULT_MACRO_JS_VALUE: JSValue = JSValue(0);

pub struct PluginRunner<'a> {
    pub global_object: &'a JSGlobalObject,
    // PORT NOTE: Zig had `allocator: std.mem.Allocator` — dropped; global mimalloc is used.
}

impl<'a> PluginRunner<'a> {
    pub fn extract_namespace(specifier: &[u8]) -> &[u8] {
        let Some(colon) = strings::index_of_char(specifier, b':') else {
            return b"";
        };
        let colon = colon as usize;
        // TODO(b2-blocked): bun_paths::is_sep_any — inlined (`/` or `\`) until exported.
        let is_sep_any = |c: u8| c == b'/' || c == b'\\';
        if cfg!(windows)
            && colon == 1
            && specifier.len() > 3
            && is_sep_any(specifier[2])
            && ((specifier[0] > b'a' && specifier[0] < b'z')
                || (specifier[0] > b'A' && specifier[0] < b'Z'))
        {
            return b"";
        }
        &specifier[0..colon]
    }

    pub fn could_be_plugin(specifier: &[u8]) -> bool {
        if let Some(last_dor) = strings::last_index_of_char(specifier, b'.') {
            let ext = &specifier[last_dor + 1..];
            // '.' followed by either a letter or a non-ascii character
            // maybe there are non-ascii file extensions?
            // we mostly want to cheaply rule out "../" and ".." and "./"
            if !ext.is_empty()
                && ((ext[0] >= b'a' && ext[0] <= b'z')
                    || (ext[0] >= b'A' && ext[0] <= b'Z')
                    || ext[0] > 127)
            {
                return true;
            }
        }
        !bun_paths::is_absolute(specifier) && strings::index_of_char(specifier, b':').is_some()
    }

    pub fn on_resolve(
        &mut self,
        specifier: &[u8],
        importer: &[u8],
        log: &mut Log,
        loc: Loc,
        target: BunPluginTarget,
    ) -> JsResult<Option<FsPath>> {
        #[cfg(any())]
        {
            let global = self.global_object;
            let namespace_slice = Self::extract_namespace(specifier);
            let namespace = if !namespace_slice.is_empty() && namespace_slice != b"file" {
                BunString::init(namespace_slice)
            } else {
                BunString::empty()
            };
            let Some(on_resolve_plugin) = global.run_on_resolve_plugins(
                namespace,
                BunString::init(specifier).substring(if namespace.length() > 0 {
                    namespace.length() + 1
                } else {
                    0
                }),
                BunString::init(importer),
                target,
            )?
            else {
                return Ok(None);
            };
            let Some(path_value) = on_resolve_plugin.get(global, "path")? else {
                return Ok(None);
            };
            if path_value.is_empty_or_undefined_or_null() {
                return Ok(None);
            }
            if !path_value.is_string() {
                log.add_error(None, loc, b"Expected \"path\" to be a string")
                    .expect("unreachable");
                return Ok(None);
            }

            let file_path = path_value.to_bun_string(global)?;

            if file_path.length() == 0 {
                log.add_error(
                    None,
                    loc,
                    b"Expected \"path\" to be a non-empty string in onResolve plugin",
                )
                .expect("unreachable");
                return Ok(None);
            } else if
            // TODO: validate this better
            file_path.eql_comptime(b".")
                || file_path.eql_comptime(b"..")
                || file_path.eql_comptime(b"...")
                || file_path.eql_comptime(b" ")
            {
                log.add_error(None, loc, b"Invalid file path from onResolve plugin")
                    .expect("unreachable");
                return Ok(None);
            }
            let mut static_namespace = true;
            let user_namespace: BunString = 'brk: {
                if let Some(namespace_value) = on_resolve_plugin.get(global, "namespace")? {
                    if !namespace_value.is_string() {
                        log.add_error(None, loc, b"Expected \"namespace\" to be a string")
                            .expect("unreachable");
                        return Ok(None);
                    }

                    let namespace_str = namespace_value.to_bun_string(global)?;
                    if namespace_str.length() == 0 {
                        break 'brk BunString::init(b"file");
                    }

                    if namespace_str.eql_comptime(b"file") {
                        break 'brk BunString::init(b"file");
                    }

                    if namespace_str.eql_comptime(b"bun") {
                        break 'brk BunString::init(b"bun");
                    }

                    if namespace_str.eql_comptime(b"node") {
                        break 'brk BunString::init(b"node");
                    }

                    static_namespace = false;

                    break 'brk namespace_str;
                }

                break 'brk BunString::init(b"file");
            };

            // PORT NOTE: Zig used std.fmt.allocPrint with this.allocator; we build into Vec<u8>.
            let mut path_buf: Vec<u8> = Vec::new();
            write!(&mut path_buf, "{}", file_path).expect("unreachable");

            if static_namespace {
                // TODO(port): Fs.Path.initWithNamespace ownership — Zig passed allocator-owned slice + borrowed byteSlice().
                return Ok(Some(FsPath::init_with_namespace(
                    path_buf,
                    user_namespace.byte_slice(),
                )));
            } else {
                let mut ns_buf: Vec<u8> = Vec::new();
                write!(&mut ns_buf, "{}", user_namespace).expect("unreachable");
                return Ok(Some(FsPath::init_with_namespace(path_buf, ns_buf)));
            }
        }
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::run_on_resolve_plugins
        // TODO(b2-blocked): bun_jsc::JSValue::get / is_string / is_empty_or_undefined_or_null / to_bun_string
        // TODO(b2-blocked): bun_resolver::fs::Path::init_with_namespace
        let _ = (specifier, importer, log, loc, target);
        unreachable!("b2-blocked: bun_jsc stub surface lacks JSGlobalObject/JSValue methods")
    }

    pub fn on_resolve_jsc(
        &self,
        namespace: BunString,
        specifier: BunString,
        importer: BunString,
        target: BunPluginTarget,
    ) -> JsResult<Option<ErrorableString>> {
        #[cfg(any())]
        {
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
            let Some(path_value) = on_resolve_plugin.get(global, "path")? else {
                return Ok(None);
            };
            if path_value.is_empty_or_undefined_or_null() {
                return Ok(None);
            }
            if !path_value.is_string() {
                return Ok(Some(ErrorableString::err(
                    bun_core::err!("JSErrorObject"),
                    BunString::static_(b"Expected \"path\" to be a string in onResolve plugin")
                        .to_error_instance(self.global_object),
                )));
            }

            let file_path = path_value.to_bun_string(global)?;

            if file_path.length() == 0 {
                return Ok(Some(ErrorableString::err(
                    bun_core::err!("JSErrorObject"),
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
                    bun_core::err!("JSErrorObject"),
                    BunString::static_(b"\"path\" is invalid in onResolve plugin")
                        .to_error_instance(self.global_object),
                )));
            }
            let mut static_namespace = true;
            let user_namespace: BunString = 'brk: {
                if let Some(namespace_value) = on_resolve_plugin.get(global, "namespace")? {
                    if !namespace_value.is_string() {
                        return Ok(Some(ErrorableString::err(
                            bun_core::err!("JSErrorObject"),
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
            let out_ = BunString::init(&combined_string);
            let jsval = match out_.to_js(self.global_object) {
                Ok(v) => v,
                Err(err) => {
                    return Ok(Some(ErrorableString::err(
                        err,
                        self.global_object
                            .try_take_exception()
                            .unwrap_or(JSValue::UNDEFINED),
                    )));
                }
            };
            let out = match jsval.to_bun_string(self.global_object) {
                Ok(v) => v,
                Err(err) => {
                    return Ok(Some(ErrorableString::err(
                        err,
                        self.global_object
                            .try_take_exception()
                            .unwrap_or(JSValue::UNDEFINED),
                    )));
                }
            };
            return Ok(Some(ErrorableString::ok(out)));
        }
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::run_on_resolve_plugins / try_take_exception
        // TODO(b2-blocked): bun_jsc::JSValue::get / is_object / is_string / to_bun_string / UNDEFINED
        // TODO(b2-blocked): bun_jsc::ErrorableString::{ok, err}
        // TODO(b2-blocked): bun_string::String::to_error_instance / to_js
        let _ = (namespace, specifier, importer, target);
        unreachable!("b2-blocked: bun_jsc stub surface lacks JSGlobalObject/JSValue methods")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/PluginRunner.zig (241 lines)
//   confidence: medium
//   todos:      2
//   notes:      Fs.Path.initWithNamespace ownership signature & ErrorableString::err arg type need confirming; allocator field dropped.
// ──────────────────────────────────────────────────────────────────────────
