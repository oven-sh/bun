//! The concrete JSC-aware plugin-resolve hook.
//!
//! LAYERING: the static byte helpers (`extract_namespace` / `could_be_plugin`)
//! live in `bun_bundler::transpiler::PluginRunner` (JSC-free, lowest tier).
//! The stateful struct lives here because its only field is a typed
//! `*mut JSGlobalObject`. `bun_bundler::Linker` references it through
//! `*mut dyn PluginResolver`, so the linker stays JSC-free without
//! type-erasing to `*mut c_void` or duplicating the body behind a fn-ptr.

use std::io::Write as _;

use bun_bundler::transpiler::{BunPluginTarget, PluginResolver};
use bun_core::{OwnedString, String as BunString};
use bun_paths::fs::Path as FsPath;

use crate::JSGlobalObject;
use bun_ptr::BackRef;

pub struct PluginRunner {
    pub global_object: BackRef<JSGlobalObject>,
}

// Re-export the JSC-free static helpers so callers in this crate can keep
// writing `PluginRunner::could_be_plugin(...)` without naming `bun_bundler`.
impl PluginRunner {
    /// Borrow the JS global stored by `Bun__onDidAppendPlugin`.
    ///
    /// SAFETY (invariant): `global_object` is the live `*mut JSGlobalObject`
    /// installed by `Bun__onDidAppendPlugin`; the VM (and its global) outlives
    /// every `Linker::link` call that reaches plugin hooks. Never null.
    #[inline]
    fn global(&self) -> &JSGlobalObject {
        self.global_object.get()
    }

    #[inline]
    pub fn extract_namespace(specifier: &[u8]) -> &[u8] {
        bun_bundler::transpiler::PluginRunner::extract_namespace(specifier)
    }
    #[inline]
    pub fn could_be_plugin(specifier: &[u8]) -> bool {
        bun_bundler::transpiler::PluginRunner::could_be_plugin(specifier)
    }
}

impl PluginResolver for PluginRunner {
    fn on_resolve(
        &self,
        specifier: &[u8],
        importer: &[u8],
        log: &mut bun_ast::Log,
        loc: bun_ast::Loc,
        target: BunPluginTarget,
    ) -> bun_bundler::Result<Option<FsPath<'static>>> {
        let global = self.global();
        let js_err = |e: crate::JsError| {
            bun_bundler::Error::Js(match e {
                crate::JsError::Thrown => bun_core::JsError::Thrown,
                crate::JsError::OutOfMemory => bun_core::JsError::OutOfMemory,
                crate::JsError::Terminated => bun_core::JsError::Terminated,
            })
        };

        let namespace_slice = Self::extract_namespace(specifier);
        let namespace = if !namespace_slice.is_empty() && namespace_slice != b"file" {
            BunString::init(namespace_slice)
        } else {
            BunString::empty()
        };
        let Some(on_resolve_plugin) = global
            .run_on_resolve_plugins(
                namespace,
                BunString::init(specifier).substring(if namespace.length() > 0 {
                    namespace.length() + 1
                } else {
                    0
                }),
                BunString::init(importer),
                target,
            )
            .map_err(js_err)?
        else {
            return Ok(None);
        };
        let Some(path_value) = on_resolve_plugin.get(global, "path").map_err(js_err)? else {
            return Ok(None);
        };
        if path_value.is_empty_or_undefined_or_null() {
            return Ok(None);
        }
        if !path_value.is_string() {
            log.add_error(None, loc, b"Expected \"path\" to be a string");
            return Ok(None);
        }

        // `bun_core::String`
        // is `Copy` (no `Drop`), so RAII-wrap the +1 WTF ref across every
        // remaining `?` / early-return.
        let file_path = OwnedString::new(path_value.to_bun_string(global).map_err(js_err)?);

        if file_path.length() == 0 {
            log.add_error(
                None,
                loc,
                b"Expected \"path\" to be a non-empty string in onResolve plugin",
            );
            return Ok(None);
        } else if
        // TODO: validate this better
        file_path.eql_comptime(b".")
            || file_path.eql_comptime(b"..")
            || file_path.eql_comptime(b"...")
            || file_path.eql_comptime(b" ")
        {
            log.add_error(None, loc, b"Invalid file path from onResolve plugin");
            return Ok(None);
        }
        let mut static_namespace = true;
        let user_namespace: BunString = 'brk: {
            if let Some(namespace_value) =
                on_resolve_plugin.get(global, "namespace").map_err(js_err)?
            {
                if !namespace_value.is_string() {
                    log.add_error(None, loc, b"Expected \"namespace\" to be a string");
                    return Ok(None);
                }

                let namespace_str = namespace_value.to_bun_string(global).map_err(js_err)?;
                if namespace_str.length() == 0 {
                    namespace_str.deref();
                    break 'brk BunString::init(b"file");
                }

                if namespace_str.eql_comptime(b"file") {
                    namespace_str.deref();
                    break 'brk BunString::init(b"file");
                }

                if namespace_str.eql_comptime(b"bun") {
                    namespace_str.deref();
                    break 'brk BunString::init(b"bun");
                }

                if namespace_str.eql_comptime(b"node") {
                    namespace_str.deref();
                    break 'brk BunString::init(b"node");
                }

                static_namespace = false;

                break 'brk namespace_str;
            }

            break 'brk BunString::init(b"file");
        };
        let user_namespace = OwnedString::new(user_namespace);

        // `FsPath<'static>` borrows, so the formatted buffer is leaked to
        // model the caller-owns-forever contract (these are
        // never freed — the linker arena owns them for the build).
        // PERF: profile if hot.
        let mut path_buf: Vec<u8> = Vec::new();
        write!(&mut path_buf, "{}", file_path).expect("unreachable");
        let path_static: &'static [u8] = path_buf.leak();

        if static_namespace {
            // `byte_slice()` borrows `&self`; re-match to recover the
            // `'static` literal so the result typechecks as `FsPath<'static>`
            // without an extra alloc.
            let ns: &'static [u8] = if user_namespace.eql_comptime(b"bun") {
                b"bun"
            } else if user_namespace.eql_comptime(b"node") {
                b"node"
            } else {
                b"file"
            };
            Ok(Some(FsPath::init_with_namespace(path_static, ns)))
        } else {
            let mut ns_buf: Vec<u8> = Vec::new();
            write!(&mut ns_buf, "{}", user_namespace).expect("unreachable");
            let ns_static: &'static [u8] = ns_buf.leak();
            Ok(Some(FsPath::init_with_namespace(path_static, ns_static)))
        }
    }
}
