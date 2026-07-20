use std::cell::Cell;
use std::io::Write as _;

use bun_ast::ImportKind;
use bun_core::strings;

use crate::zig_string::ZigString;
use crate::{
    CallFrame, JSGlobalObject, JSValue, JsClass, JsResult, StringJsc as _, ZigStringJsc as _,
};

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`. `msg` and
// `referrer` are read-only after construction; only `logged` is mutated
// post-wrap (by `VirtualMachine::print_error_like_object` via the JSCell ptr),
// so it gets `Cell<bool>`.
#[crate::JsClass]
pub struct ResolveMessage {
    pub msg: bun_ast::Msg,
    // Note: fields own their allocations and free on Drop / finalize.
    //
    // Note: only the referrer path's `.text` is ever read;
    // store the duped text directly so we don't pull in `bun_paths::fs::Path`
    // (which is lifetime-parameterised over its backing buffer).
    pub referrer: Option<Box<[u8]>>,
    pub logged: Cell<bool>,
}

impl Default for ResolveMessage {
    fn default() -> Self {
        Self {
            msg: bun_ast::Msg::default(),
            referrer: None,
            logged: Cell::new(false),
        }
    }
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

/// Host-agnostic bare-specifier check for Node ESM error shaping. Node
/// classifies specifiers platform-independently (URL-based), so this must not
/// vary by host: relative (`./`, `../`, `.`, `..`), separator-led (`/`, `\`),
/// and ASCII-letter drive forms (`C:/`, `C:\`) are path-like; everything else
/// is a package. Unlike host-native `bun_paths::is_absolute`, the drive byte
/// must be alphabetic — its Windows arm accepts any byte before `:`, which
/// made `:://x` classify as a module on Windows but a package on POSIX
/// (Node says "Cannot find package '::'" on both).
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
        specifier[from..]
            .iter()
            .position(|&b| b == b'/')
            .map_or(specifier.len(), |i| from + i)
    };
    let mut end = slash_after(0);
    if specifier.starts_with(b"@") && end < specifier.len() {
        end = slash_after(end + 1);
    }
    &specifier[..end]
}

impl ResolveMessage {
    // `#[JsClass]` emits `ResolveMessageClass__construct` calling this.
    pub fn constructor(
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<*mut ResolveMessage> {
        Err(global.throw_illegal_constructor("ResolveMessage"))
    }

    #[crate::host_fn(getter)]
    pub fn get_code(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match &this.msg.metadata {
            bun_ast::Metadata::Resolve(resolve) => {
                let code: &'static [u8] = 'brk: {
                    let specifier = resolve.specifier.slice(&this.msg.data.text);

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

                let atom = bun_core::String::create_atom(code);
                // `defer atom.deref()` — `String` derefs on Drop.
                atom.to_js(global)
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }

    // https://github.com/oven-sh/bun/issues/2375#issuecomment-2121530202
    #[crate::host_fn(getter)]
    pub fn get_column(this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(location) = &this.msg.data.location {
            return Ok(JSValue::from((location.column - 1).max(0)));
        }

        Ok(JSValue::from(0_i32))
    }

    #[crate::host_fn(getter)]
    pub fn get_line(this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(location) = &this.msg.data.location {
            return Ok(JSValue::from((location.line - 1).max(0)));
        }

        Ok(JSValue::from(0_i32))
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
            write!(
                &mut out,
                "No such built-in module: {}",
                BStr::new(specifier)
            )
            .ok();
            return out;
        }
        // The same logical error can arrive nested (e.g. via
        // `CrateError::Resolver(resolver::Error::ModuleNotFound)`), so dispatch
        // on the tag string rather than structural equality.
        match err.name() {
            "ModuleNotFound" => {
                if referrer == b"bun:main" {
                    write!(&mut out, "Module not found '{}'", BStr::new(specifier)).ok();
                    return out;
                }
                if bun_resolver::is_package_path(specifier)
                    && !strings::contains_char(specifier, b'/')
                {
                    write!(
                        &mut out,
                        "Cannot find package '{}' from '{}'",
                        BStr::new(specifier),
                        BStr::new(referrer),
                    )
                    .ok();
                } else {
                    write!(
                        &mut out,
                        "Cannot find module '{}' from '{}'",
                        BStr::new(specifier),
                        BStr::new(referrer),
                    )
                    .ok();
                }
                return out;
            }
            "InvalidDataURL" => {
                write!(
                    &mut out,
                    "Cannot resolve invalid data URL '{}' from '{}'",
                    BStr::new(specifier),
                    BStr::new(referrer),
                )
                .ok();
                return out;
            }
            "InvalidURL" => {
                write!(
                    &mut out,
                    "Cannot resolve invalid URL '{}' from '{}'",
                    BStr::new(specifier),
                    BStr::new(referrer),
                )
                .ok();
                return out;
            }
            _ => {}
        }
        // else
        if bun_resolver::is_package_path(specifier) {
            write!(
                &mut out,
                "{} while resolving package '{}' from '{}'",
                err.name(),
                BStr::new(specifier),
                BStr::new(referrer),
            )
            .ok();
        } else {
            write!(
                &mut out,
                "{} while resolving '{}' from '{}'",
                err.name(),
                BStr::new(specifier),
                BStr::new(referrer),
            )
            .ok();
        }
        out
    }

    pub fn to_string_fn(&self, global: &JSGlobalObject) -> JSValue {
        let mut text = Vec::new();
        if write!(
            &mut text,
            "ResolveMessage: {}",
            bstr::BStr::new(&self.msg.data.text)
        )
        .is_err()
        {
            return global.throw_out_of_memory_value();
        }
        let mut str = ZigString::init(&text);
        str.set_output_encoding();
        if str.is_utf8() {
            let out = str.to_js(global);
            drop(text);
            return out;
        }

        // `to_external_value` transfers ownership of `text` to JSC: the Box is
        // leaked here (single transfer via `heap::release`) and freed exactly
        // once by JSC's external-string finalizer with the global allocator.
        let leaked = text.into_boxed_slice();
        let mut str = ZigString::init(bun_core::heap::release(leaked));
        str.set_output_encoding();
        str.to_external_value(global)
    }

    #[crate::host_fn(method)]
    pub fn to_string(
        // this
        this: &Self,
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(this.to_string_fn(global))
    }

    #[crate::host_fn(method)]
    pub fn to_primitive(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_ = callframe.arguments_old::<1>();
        let args = &args_.ptr[0..args_.len];
        if !args.is_empty() {
            if !args[0].is_string() {
                return Ok(JSValue::NULL);
            }

            let str = args[0].get_zig_string(global)?;
            if str.eql_comptime(b"default") || str.eql_comptime(b"string") {
                return Ok(this.to_string_fn(global));
            }
        }

        Ok(JSValue::NULL)
    }

    #[crate::host_fn(method)]
    pub fn to_json(this: &Self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        let object = JSValue::create_empty_object(global, 7);
        object.put(
            global,
            b"name",
            bun_core::String::static_str(b"ResolveMessage").to_js(global)?,
        );
        object.put(global, b"position", Self::get_position(this, global)?);
        object.put(global, b"message", Self::get_message(this, global)?);
        object.put(global, b"level", Self::get_level(this, global)?);
        object.put(global, b"specifier", Self::get_specifier(this, global)?);
        object.put(global, b"importKind", Self::get_import_kind(this, global)?);
        object.put(global, b"referrer", Self::get_referrer(this, global)?);
        Ok(object)
    }

    /// Clone `msg` +
    /// dupe `referrer` into a fresh heap-allocated `ResolveMessage` and wrap it
    /// in its JSC cell. `JsClass::to_js` boxes `self` and calls the C++-side
    /// `ResolveMessage__create(global, ptr)`; the resulting `m_ctx` is freed by
    /// the macro-emitted `ResolveMessageClass__finalize` on lazy sweep.
    pub fn create(
        global: &JSGlobalObject,
        msg: &bun_ast::Msg,
        referrer: &[u8],
    ) -> JsResult<JSValue> {
        let resolve_error = ResolveMessage {
            msg: msg.clone(),
            referrer: Some(Box::<[u8]>::from(referrer)),
            logged: Cell::new(false),
        };
        Ok(resolve_error.to_js(global))
    }

    #[crate::host_fn(getter)]
    pub fn get_position(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(crate::BuildMessage::generate_position_object(
            &this.msg, global,
        ))
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
        let referrer = self
            .referrer
            .as_deref()
            .filter(|r| !r.is_empty() && *r != b"bun:main");
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
                write!(&mut out, "Cannot find module '{}'", BStr::new(specifier)).ok();
                if let Some(referrer) = referrer {
                    write!(&mut out, "\nRequire stack:\n- {}", BStr::new(referrer)).ok();
                }
            }
            ImportKind::Stmt | ImportKind::Dynamic => {
                let referrer = referrer?;
                if is_bare_esm_specifier(specifier) {
                    write!(
                        &mut out,
                        "Cannot find package '{}' imported from {}",
                        BStr::new(esm_package_name(specifier)),
                        BStr::new(referrer),
                    )
                    .ok();
                } else {
                    write!(
                        &mut out,
                        "Cannot find module '{}' imported from {}",
                        BStr::new(specifier),
                        BStr::new(referrer),
                    )
                    .ok();
                }
            }
            _ => return None,
        }
        Some(out)
    }

    #[crate::host_fn(getter)]
    pub fn get_message(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(text) = this.node_message() {
            return Ok(ZigString::init_utf8(&text).to_js(global));
        }
        Ok(ZigString::init_utf8(&this.msg.data.text).to_js(global))
    }

    // Node: MODULE_NOT_FOUND errors carry `requireStack` (the chain of
    // requiring files; Bun tracks only the direct referrer). CJS kinds only.
    #[crate::host_fn(getter)]
    pub fn get_require_stack(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let Some((kind, _, referrer)) = this.node_error_shape() else {
            return Ok(JSValue::UNDEFINED);
        };
        if !matches!(kind, ImportKind::Require | ImportKind::RequireResolve) {
            return Ok(JSValue::UNDEFINED);
        }
        let mut entries: Vec<&[u8]> = Vec::new();
        if let Some(r) = referrer {
            entries.push(r);
        }
        JSValue::create_array_from_iter(global, entries.iter().copied(), |r| {
            Ok(ZigString::init_utf8(r).to_js(global))
        })
    }

    // A synthesized `name: message` header; Bun does not capture JS frames at
    // module-resolution time, so there are no `at ...` lines.
    #[crate::host_fn(getter)]
    pub fn get_stack(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let mut out = Vec::new();
        out.extend_from_slice(b"ResolveMessage: ");
        match this.node_message() {
            Some(text) => out.extend_from_slice(&text),
            None => out.extend_from_slice(&this.msg.data.text),
        }
        Ok(ZigString::init_utf8(&out).to_js(global))
    }

    #[crate::host_fn(getter)]
    pub fn get_level(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(ZigString::init(this.msg.kind.string()).to_js(global))
    }

    #[crate::host_fn(getter)]
    pub fn get_specifier(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match &this.msg.metadata {
            bun_ast::Metadata::Resolve(resolve) => {
                ZigString::init_utf8(resolve.specifier.slice(&this.msg.data.text)).to_js(global)
            }
            // Unreachable in practice (ResolveMessage is only constructed for
            // `.resolve` metadata).
            _ => ZigString::init(b"").to_js(global),
        })
    }

    #[crate::host_fn(getter)]
    pub fn get_import_kind(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match &this.msg.metadata {
            bun_ast::Metadata::Resolve(resolve) => {
                ZigString::init(import_kind_label(resolve.import_kind)).to_js(global)
            }
            _ => ZigString::init(b"").to_js(global),
        })
    }

    #[crate::host_fn(getter)]
    pub fn get_referrer(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(if let Some(referrer) = &this.referrer {
            ZigString::init_utf8(referrer).to_js(global)
        } else {
            JSValue::NULL
        })
    }

    pub fn finalize(self: Box<Self>) {
        // Dropping the Box drops `msg` and the owned `referrer` buffer.
        drop(self);
    }
}
