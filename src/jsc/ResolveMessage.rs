use std::borrow::Cow;
use std::cell::Cell;
use std::io::Write as _;

use bun_ast::ImportKind;
use bun_core::strings;

use crate::bindgen::{JsLocal, JsScope};
use crate::build_message::LogKindJsc as _;
use crate::bun_string_jsc;
use crate::{JSGlobalObject, JSValue, JsClass, JsResult, StringJsc as _};

pub struct ResolveMessage {
    pub msg: bun_ast::Msg,
    // Note: fields own their allocations and free on Drop / finalize.
    //
    // Note: only the referrer path's `.text` is ever read;
    // store the duped text directly so we don't pull in `bun_paths::fs::Path`
    // (which is lifetime-parameterised over its backing buffer).
    pub(crate) referrer: Box<[u8]>,
    pub(crate) logged: Cell<bool>,
}

/// `ImportKind.label()` — the canonical table lives in
/// `bun_ast::ImportKind::label`, but
/// `bun_ast::MetadataResolve.import_kind` is the type-only `bun_ast::ImportKind`.
/// Replicate the table here verbatim.
fn import_kind_label(kind: ImportKind) -> &'static [u8] {
    match kind {
        ImportKind::EntryPointRun => b"entry-point-run",
        ImportKind::EntryPointBuild => b"entry-point-build",
        ImportKind::Stmt => b"import-statement",
        ImportKind::Require => b"require-call",
        ImportKind::Dynamic => b"dynamic-import",
        ImportKind::RequireResolve => b"require-resolve",
        ImportKind::At => b"import-rule",
        ImportKind::AtConditional => b"",
        ImportKind::Url => b"url-token",
        ImportKind::Composes => b"composes",
        ImportKind::Internal => b"internal",
        ImportKind::HtmlManifest => b"html_manifest",
    }
}

/// Host-agnostic bare-specifier check for Node ESM error shaping. Must not vary by host:
/// relative, separator-led, and ASCII-letter drive forms are path-like; everything else is a
/// package. Unlike `bun_paths::is_absolute`, the drive byte must be alphabetic.
fn is_bare_esm_specifier(s: &[u8]) -> bool {
    let is_sep = |b: u8| b == b'/' || b == b'\\';
    match s {
        [] | [b'.'] | [b'.', b'.'] => return false,
        [b, ..] if is_sep(*b) => return false,
        [b'.', b, ..] if is_sep(*b) => return false,
        [b'.', b'.', b, ..] if is_sep(*b) => return false,
        [d, b':', b, ..] if d.is_ascii_alphabetic() && is_sep(*b) => return false,
        _ => {}
    }
    true
}

/// First path segment of a bare specifier ("@scope/name" keeps two),
/// matching Node's ERR_MODULE_NOT_FOUND "Cannot find package '<name>'".
fn esm_package_name(specifier: &[u8]) -> &[u8] {
    let slash_after = |from: usize| {
        bun_core::strings::index_of_char_usize(&specifier[from..], b'/')
            .map_or(specifier.len(), |i| from + i)
    };
    let mut end = slash_after(0);
    if specifier.starts_with(b"@") && end < specifier.len() {
        end = slash_after(end + 1);
    }
    &specifier[..end]
}

impl ResolveMessage {
    pub fn get_code(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        match &self.msg.metadata {
            bun_ast::Metadata::Resolve(resolve) => {
                let code: &'static [u8] = 'brk: {
                    let specifier = resolve.specifier.slice(&self.msg.data.text);

                    break 'brk match resolve.import_kind {
                        // Match Node.js error codes. CommonJS is historic
                        // before they started prefixing with 'ERR_'
                        ImportKind::Require => {
                            if specifier.starts_with(b"node:") {
                                break 'brk b"ERR_UNKNOWN_BUILTIN_MODULE";
                            } else {
                                break 'brk b"MODULE_NOT_FOUND";
                            }
                        }
                        // require resolve does not have the UNKNOWN_BUILTIN_MODULE error code
                        ImportKind::RequireResolve => b"MODULE_NOT_FOUND",
                        ImportKind::Stmt | ImportKind::Dynamic => {
                            if specifier.starts_with(b"node:") {
                                break 'brk b"ERR_UNKNOWN_BUILTIN_MODULE";
                            } else {
                                break 'brk b"ERR_MODULE_NOT_FOUND";
                            }
                        }

                        ImportKind::HtmlManifest
                        | ImportKind::EntryPointRun
                        | ImportKind::EntryPointBuild
                        | ImportKind::At
                        | ImportKind::AtConditional
                        | ImportKind::Url
                        | ImportKind::Internal
                        | ImportKind::Composes => b"RESOLVE_ERROR",
                    };
                };

                bun_core::String::create_atom(code).into_js(cx.global())
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }

    // https://github.com/oven-sh/bun/issues/2375#issuecomment-2121530202
    pub fn get_column(&self) -> i32 {
        match &self.msg.data.location {
            Some(location) => (location.column - 1).max(0),
            None => 0,
        }
    }

    pub fn get_line(&self) -> i32 {
        match &self.msg.data.location {
            Some(location) => (location.line - 1).max(0),
            None => 0,
        }
    }

    pub fn fmt(
        specifier: &[u8],
        referrer: &[u8],
        err: crate::CrateError,
        import_kind: ImportKind,
    ) -> Vec<u8> {
        use bstr::BStr;
        let mut out = Vec::new();
        if import_kind != ImportKind::RequireResolve && specifier.starts_with(b"node:") {
            // This matches Node.js exactly.
            let _ = write!(
                &mut out,
                "No such built-in module: {}",
                BStr::new(specifier)
            );
            return out;
        }
        // The same logical error can arrive nested (e.g. via
        // `CrateError::Resolver(resolver::Error::ModuleNotFound)`), so dispatch
        // on the tag string rather than structural equality.
        match err.name() {
            "ModuleNotFound" => {
                if referrer == b"bun:main" {
                    let _ = write!(&mut out, "Module not found '{}'", BStr::new(specifier));
                    return out;
                }
                if bun_resolver::is_package_path(specifier)
                    && !strings::contains_char(specifier, b'/')
                {
                    let _ = write!(
                        &mut out,
                        "Cannot find package '{}' from '{}'",
                        BStr::new(specifier),
                        BStr::new(referrer),
                    );
                } else {
                    let _ = write!(
                        &mut out,
                        "Cannot find module '{}' from '{}'",
                        BStr::new(specifier),
                        BStr::new(referrer),
                    );
                }
                return out;
            }
            "InvalidDataURL" => {
                let _ = write!(
                    &mut out,
                    "Cannot resolve invalid data URL '{}' from '{}'",
                    BStr::new(specifier),
                    BStr::new(referrer),
                );
                return out;
            }
            "InvalidURL" => {
                let _ = write!(
                    &mut out,
                    "Cannot resolve invalid URL '{}' from '{}'",
                    BStr::new(specifier),
                    BStr::new(referrer),
                );
                return out;
            }
            _ => {}
        }
        // else
        if bun_resolver::is_package_path(specifier) {
            let _ = write!(
                &mut out,
                "{} while resolving package '{}' from '{}'",
                err.name(),
                BStr::new(specifier),
                BStr::new(referrer),
            );
        } else {
            let _ = write!(
                &mut out,
                "{} while resolving '{}' from '{}'",
                err.name(),
                BStr::new(specifier),
                BStr::new(referrer),
            );
        }
        out
    }

    pub(crate) fn to_string_fn(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        // Keep `String(err)` consistent with `err.message`/`err.stack`, which
        // route through `node_message()` for the reshaped module-not-found
        // cases.
        let mut text = Vec::new();
        write!(
            &mut text,
            "ResolveMessage: {}",
            bstr::BStr::new(&self.get_message())
        )
        .expect("infallible: in-memory write");
        bun_string_jsc::owned_utf8_into_js(global, text)
    }

    pub fn to_string(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.to_string_fn(cx.global())
    }

    pub fn to_primitive(&self, cx: &mut JsScope<'_>, hint: JsLocal<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        let hint = hint.to_js();
        if !hint.is_string() {
            return Ok(JSValue::NULL);
        }

        let str = hint.to_bun_string(global)?;
        if str.eq_ascii(b"default") || str.eq_ascii(b"string") {
            return self.to_string_fn(global);
        }

        Ok(JSValue::NULL)
    }

    pub fn to_json(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        let utf8 = |bytes: &[u8]| bun_string_jsc::create_utf8_for_js(global, bytes);
        let object = JSValue::create_empty_object(global, 7);
        object.put(
            global,
            b"name",
            bun_core::String::static_("ResolveMessage").to_js(global)?,
        );
        object.put(
            global,
            b"position",
            crate::BuildMessage::generate_position_object(&self.msg, global)?,
        );
        object.put(global, b"message", utf8(&self.get_message())?);
        object.put(global, b"level", self.msg.kind.to_js(global)?);
        object.put(global, b"specifier", utf8(self.get_specifier())?);
        object.put(global, b"importKind", self.import_kind_to_js(global)?);
        object.put(global, b"referrer", utf8(&self.referrer)?);
        Ok(object)
    }

    pub fn create(
        global: &JSGlobalObject,
        msg: &bun_ast::Msg,
        referrer: &[u8],
    ) -> JsResult<JSValue> {
        let resolve_error = ResolveMessage {
            msg: msg.clone(),
            referrer: Box::<[u8]>::from(referrer),
            logged: Cell::new(false),
        };
        Ok(resolve_error.to_js(global))
    }

    pub fn get_position(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        crate::BuildMessage::generate_position_object(&self.msg, cx.global())
    }

    /// Module-not-found for a runtime import kind whose `.message` /
    /// `.requireStack` should match Node.js. Returns `(import_kind, specifier,
    /// usable_referrer)`; `None` keeps the original Bun-formatted text.
    fn node_error_shape(&self) -> Option<(ImportKind, &[u8], Option<&[u8]>)> {
        let bun_ast::Metadata::Resolve(resolve) = &self.msg.metadata else {
            return None;
        };
        match resolve.import_kind {
            ImportKind::Require
            | ImportKind::RequireResolve
            | ImportKind::Stmt
            | ImportKind::Dynamic => {}
            _ => return None,
        }
        // Fallback paths tag every CrateError as `ModuleNotFound`, so gate on
        // the formatted text rather than `resolve.err` to leave InvalidURL /
        // InvalidDataURL / ENAMETOOLONG messages untouched.
        let text: &[u8] = &self.msg.data.text;
        if !(text.starts_with(b"Cannot find module '")
            || text.starts_with(b"Cannot find package '"))
        {
            return None;
        }
        // `require.resolve('node:missing')` is a plain MODULE_NOT_FOUND in
        // Node; every other kind reports ERR_UNKNOWN_BUILTIN_MODULE instead.
        let specifier = resolve.specifier.slice(&self.msg.data.text);
        if specifier.starts_with(b"node:") && resolve.import_kind != ImportKind::RequireResolve {
            return None;
        }
        let referrer = Some(&*self.referrer).filter(|r| !r.is_empty() && *r != b"bun:main");
        Some((resolve.import_kind, specifier, referrer))
    }

    /// Node's message for a module-not-found error, or `None` when the
    /// original text should be kept.
    fn node_message(&self) -> Option<Vec<u8>> {
        use bstr::BStr;
        let (kind, specifier, referrer) = self.node_error_shape()?;
        let mut out = Vec::new();
        match kind {
            ImportKind::Require | ImportKind::RequireResolve => {
                let _ = write!(&mut out, "Cannot find module '{}'", BStr::new(specifier));
                if let Some(referrer) = referrer {
                    let _ = write!(&mut out, "\nRequire stack:\n- {}", BStr::new(referrer));
                }
            }
            ImportKind::Stmt | ImportKind::Dynamic => {
                let referrer = referrer?;
                if is_bare_esm_specifier(specifier) {
                    let _ = write!(
                        &mut out,
                        "Cannot find package '{}' imported from {}",
                        BStr::new(esm_package_name(specifier)),
                        BStr::new(referrer),
                    );
                } else {
                    let _ = write!(
                        &mut out,
                        "Cannot find module '{}' imported from {}",
                        BStr::new(specifier),
                        BStr::new(referrer),
                    );
                }
            }
            _ => return None,
        }
        Some(out)
    }

    pub fn get_message(&self) -> Cow<'_, [u8]> {
        match self.node_message() {
            Some(text) => Cow::Owned(text),
            None => Cow::Borrowed(&self.msg.data.text),
        }
    }

    // Node: MODULE_NOT_FOUND errors carry `requireStack` (the chain of
    // requiring files; Bun tracks only the direct referrer). CJS kinds only.
    pub fn get_require_stack(&self) -> Option<impl Iterator<Item = &[u8]>> {
        let (kind, _, referrer) = self.node_error_shape()?;
        matches!(kind, ImportKind::Require | ImportKind::RequireResolve)
            .then(|| referrer.into_iter())
    }

    // A synthesized `name: message` header; Bun does not capture JS frames at
    // module-resolution time, so there are no `at ...` lines.
    pub fn get_stack(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"ResolveMessage: ");
        out.extend_from_slice(&self.get_message());
        out
    }

    pub fn get_level(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.msg.kind.to_js(cx.global())
    }

    pub fn get_specifier(&self) -> &[u8] {
        match &self.msg.metadata {
            bun_ast::Metadata::Resolve(resolve) => resolve.specifier.slice(&self.msg.data.text),
            // Unreachable in practice (ResolveMessage is only constructed for
            // `.resolve` metadata).
            _ => b"",
        }
    }

    pub fn get_import_kind(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.import_kind_to_js(cx.global())
    }

    fn import_kind_to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match &self.msg.metadata {
            bun_ast::Metadata::Resolve(resolve) => {
                bun_core::String::static_(import_kind_label(resolve.import_kind)).to_js(global)?
            }
            _ => JSValue::js_empty_string(global),
        })
    }

    pub fn get_referrer(&self) -> &[u8] {
        &self.referrer
    }
}
