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
    // A leading URL scheme (`[A-Za-z][A-Za-z0-9+.-]*:`) is URL-like, not a
    // package: Node reports those as scheme/URL errors, never "Cannot find
    // package 'file:'". `':://x'` stays a package — ':' cannot start a scheme
    // (Node says "Cannot find package '::'").
    if s[0].is_ascii_alphabetic() {
        for (i, &b) in s.iter().enumerate() {
            match b {
                b':' if i > 0 => return false,
                b if b.is_ascii_alphanumeric() || b == b'+' || b == b'.' || b == b'-' => {}
                _ => break,
            }
        }
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

/// Best-effort range of `specifier` inside the composed message (the
/// Node-shaped texts don't always embed the specifier verbatim; `.specifier`
/// then reads as empty).
fn specifier_range_in(text: &[u8], specifier: &[u8]) -> bun_ast::BabyString {
    if specifier.is_empty() || specifier.len() > u16::MAX as usize {
        return bun_ast::BabyString::new(0, 0);
    }
    match strings::index_of(text, specifier) {
        Some(off) if off <= u16::MAX as usize => {
            bun_ast::BabyString::new(off as u16, specifier.len() as u16)
        }
        _ => bun_ast::BabyString::new(0, 0),
    }
}

/// `code`, `err.name`, and the uncaught-printer display name for the
/// Node-shaped resolve error tags (message text is preformatted by the
/// resolver capture / specifier prechecks and passed through untouched).
fn node_tag_info(
    err: bun_ast::Error,
    kind: ImportKind,
) -> Option<(&'static [u8], &'static [u8], &'static [u8])> {
    use bun_ast::Error as E;
    Some(match err {
        E::PackagePathNotExported => (
            b"ERR_PACKAGE_PATH_NOT_EXPORTED",
            b"Error",
            b"Error [ERR_PACKAGE_PATH_NOT_EXPORTED]",
        ),
        E::PackageImportNotDefined => (
            b"ERR_PACKAGE_IMPORT_NOT_DEFINED",
            b"TypeError",
            b"TypeError [ERR_PACKAGE_IMPORT_NOT_DEFINED]",
        ),
        E::InvalidPackageTarget => (
            b"ERR_INVALID_PACKAGE_TARGET",
            b"Error",
            b"Error [ERR_INVALID_PACKAGE_TARGET]",
        ),
        E::InvalidPackageConfig => (
            b"ERR_INVALID_PACKAGE_CONFIG",
            b"Error",
            b"Error [ERR_INVALID_PACKAGE_CONFIG]",
        ),
        E::InvalidModuleSpecifier => (
            b"ERR_INVALID_MODULE_SPECIFIER",
            b"TypeError",
            b"TypeError [ERR_INVALID_MODULE_SPECIFIER]",
        ),
        E::UnsupportedDirImport => (
            b"ERR_UNSUPPORTED_DIR_IMPORT",
            b"Error",
            b"Error [ERR_UNSUPPORTED_DIR_IMPORT]",
        ),
        E::UnsupportedEsmUrlScheme => (
            b"ERR_UNSUPPORTED_ESM_URL_SCHEME",
            b"Error",
            b"Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]",
        ),
        E::UnknownModuleFormat => (
            b"ERR_UNKNOWN_MODULE_FORMAT",
            b"RangeError",
            b"RangeError [ERR_UNKNOWN_MODULE_FORMAT]",
        ),
        // require() spells this the historic un-prefixed way and prints as a
        // plain Error.
        E::ModuleNotFoundNode => match kind {
            ImportKind::Require | ImportKind::RequireResolve => {
                (b"MODULE_NOT_FOUND", b"Error", b"Error")
            }
            _ => (
                b"ERR_MODULE_NOT_FOUND",
                b"Error",
                b"Error [ERR_MODULE_NOT_FOUND]",
            ),
        },
        _ => return None,
    })
}

impl ResolveMessage {
    /// The `(code, name, display)` triple when this error carries one of the
    /// Node-shaped resolve tags.
    pub(crate) fn node_tag(&self) -> Option<(&'static [u8], &'static [u8], &'static [u8])> {
        let bun_ast::Metadata::Resolve(resolve) = &self.msg.metadata else {
            return None;
        };
        node_tag_info(resolve.err, resolve.import_kind)
    }

    // `#[JsClass]` emits `ResolveMessageClass__construct` calling this.
    pub fn constructor(
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<*mut ResolveMessage> {
        Err(global.throw_illegal_constructor())
    }

    #[crate::host_fn(getter)]
    pub fn get_code(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some((code, ..)) = this.node_tag() {
            let atom = bun_core::String::create_atom(code);
            return atom.to_js(global);
        }
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
        // Keep `String(err)` consistent with `err.message`/`err.stack`, which
        // route through `node_message()` for the reshaped module-not-found
        // cases.
        let node_message = self.node_message();
        let message: &[u8] = node_message.as_deref().unwrap_or(&self.msg.data.text);
        if write!(
            &mut text,
            "{}: {}",
            bstr::BStr::new(self.node_display_name().unwrap_or(b"ResolveMessage")),
            bstr::BStr::new(message)
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
        let args = callframe.arguments();
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
            bun_core::String::static_str(this.js_name()).to_js(global)?,
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
        // Preformatted Node-shaped tags keep their text verbatim.
        if node_tag_info(resolve.err, resolve.import_kind).is_some() {
            return None;
        }
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

    /// Whether this is Node's ERR_UNKNOWN_BUILTIN_MODULE (`require('node:x')`
    /// / `import('node:x')` for a builtin that doesn't exist).
    fn is_unknown_builtin(&self) -> bool {
        let bun_ast::Metadata::Resolve(resolve) = &self.msg.metadata else {
            return false;
        };
        matches!(
            resolve.import_kind,
            ImportKind::Require | ImportKind::Stmt | ImportKind::Dynamic
        ) && self
            .msg
            .data
            .text
            .starts_with(b"No such built-in module:")
    }

    /// `err.name` — Node throws module-resolution failures as plain `Error`.
    pub(crate) fn js_name(&self) -> &'static [u8] {
        if let Some((_, name, _)) = self.node_tag() {
            return name;
        }
        if self.node_display_name().is_some() {
            b"Error"
        } else {
            b"ResolveMessage"
        }
    }

    /// The `<name>` used by `toString()` / `.stack`, or `None` when the error
    /// keeps Bun's ResolveMessage rendering. Node renders the code in brackets
    /// for its `E()`-constructed errors (`Error [ERR_MODULE_NOT_FOUND]: ...`),
    /// while CJS MODULE_NOT_FOUND is a plain `Error: ...`.
    pub(crate) fn node_display_name(&self) -> Option<&'static [u8]> {
        if let Some((.., display)) = self.node_tag() {
            return Some(display);
        }
        if self.is_unknown_builtin() {
            return Some(b"Error [ERR_UNKNOWN_BUILTIN_MODULE]");
        }
        match self.node_error_shape() {
            Some((ImportKind::Require | ImportKind::RequireResolve, ..)) => Some(b"Error"),
            Some((ImportKind::Stmt | ImportKind::Dynamic, ..)) => {
                Some(b"Error [ERR_MODULE_NOT_FOUND]")
            }
            _ => None,
        }
    }

    #[crate::host_fn(getter)]
    pub fn get_name(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(ZigString::init(this.js_name()).to_js(global))
    }

    /// Node's message for a module-not-found error, or `None` when the
    /// original text should be kept.
    pub(crate) fn node_message(&self) -> Option<Vec<u8>> {
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
        out.extend_from_slice(this.node_display_name().unwrap_or(b"ResolveMessage"));
        out.extend_from_slice(b": ");
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

    /// Assemble the final Node-shaped `Msg` from a resolver capture: splice
    /// the referrer clause (whose wording depends on the error and import
    /// kind) into the captured message head.
    pub fn msg_from_node_module_error(
        err: &bun_resolver::NodeModuleError,
        import_kind: ImportKind,
        specifier: &[u8],
        referrer: &[u8],
    ) -> bun_ast::Msg {
        use bstr::BStr;
        use bun_resolver::NodeModuleErrorKind as K;
        let is_esm = matches!(import_kind, ImportKind::Stmt | ImportKind::Dynamic);
        let include_referrer =
            !referrer.is_empty() && referrer != b"bun:main" && (is_esm || err.referrer_in_require);
        let mut text = Vec::with_capacity(err.head.len() + referrer.len() + 32);
        text.extend_from_slice(&err.head[..err.insert_at]);
        if include_referrer {
            match err.kind {
                K::InvalidPackageConfig => {
                    let _ = write!(
                        &mut text,
                        " while importing \"{}\" from {}",
                        BStr::new(specifier),
                        BStr::new(referrer)
                    );
                }
                K::InvalidPackageConfigStructure => {
                    // Node passes the importer as a file URL in this shape.
                    let _ = write!(&mut text, " while importing file://{}", BStr::new(referrer));
                }
                _ => {
                    let _ = write!(&mut text, " imported from {}", BStr::new(referrer));
                }
            }
        }
        text.extend_from_slice(&err.head[err.insert_at..]);
        let tag = match err.kind {
            K::PackagePathNotExported => bun_ast::Error::PackagePathNotExported,
            K::PackageImportNotDefined => bun_ast::Error::PackageImportNotDefined,
            K::InvalidPackageTarget => bun_ast::Error::InvalidPackageTarget,
            K::InvalidPackageConfig | K::InvalidPackageConfigStructure => {
                bun_ast::Error::InvalidPackageConfig
            }
            K::InvalidModuleSpecifier => bun_ast::Error::InvalidModuleSpecifier,
            K::ModuleNotFound => bun_ast::Error::ModuleNotFoundNode,
            K::UnsupportedDirImport => bun_ast::Error::UnsupportedDirImport,
        };
        let specifier_range = specifier_range_in(&text, specifier);
        bun_ast::Msg {
            data: bun_ast::range_data(None, bun_ast::Range::NONE, text),
            metadata: bun_ast::Metadata::Resolve(bun_ast::MetadataResolve {
                specifier: specifier_range,
                import_kind,
                err: tag,
            }),
            ..Default::default()
        }
    }

    /// Node's fail-fast specifier checks for the default ESM loader:
    /// unsupported URL schemes (ERR_UNSUPPORTED_ESM_URL_SCHEME) and `data:`
    /// MIME types no loader accepts (ERR_UNKNOWN_MODULE_FORMAT). Returns the
    /// Node-shaped `Msg` when the specifier can never load, `None` otherwise.
    pub fn esm_specifier_precheck(
        specifier: &[u8],
        import_kind: ImportKind,
    ) -> Option<bun_ast::Msg> {
        use bstr::BStr;
        if !matches!(import_kind, ImportKind::Stmt | ImportKind::Dynamic) {
            return None;
        }
        let make = |text: Vec<u8>, err: bun_ast::Error| {
            let specifier_range = specifier_range_in(&text, specifier);
            bun_ast::Msg {
                data: bun_ast::range_data(None, bun_ast::Range::NONE, text),
                metadata: bun_ast::Metadata::Resolve(bun_ast::MetadataResolve {
                    specifier: specifier_range,
                    import_kind,
                    err,
                }),
                ..Default::default()
            }
        };
        if let Some(rest) = specifier.strip_prefix(b"data:".as_slice()) {
            // Mirrors Node's mimeToFormat: only JS, JSON, and Wasm MIME
            // types have a module format (Bun additionally derives the JSON
            // flavor from the same categories).
            // Comma-less data: URLs aren't data URLs at all; leave them to
            // the resolver's invalid-data-URL error.
            let Some(comma) = strings::index_of_char(rest, b',') else {
                return None;
            };
            let mut mime = &rest[..comma as usize];
            if let Some(stripped) = mime.strip_suffix(b";base64".as_slice()) {
                mime = stripped;
            }
            use bun_http_types::MimeType::Category;
            let category = bun_http_types::MimeType::MimeType::init(mime, false, None).category;
            if matches!(
                category,
                Category::Javascript | Category::Json | Category::Wasm
            ) {
                return None;
            }
            let mut text = Vec::new();
            let _ = write!(
                &mut text,
                "Unknown module format: {} for URL {}",
                BStr::new(mime),
                BStr::new(specifier)
            );
            return Some(make(text, bun_ast::Error::UnknownModuleFormat));
        }
        // A URL scheme (RFC 3986: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
        // followed by ":"). Single-letter schemes are skipped so Windows
        // drive paths (`C:\x`) keep resolving as paths.
        if specifier.first().is_some_and(u8::is_ascii_alphabetic) {
            let mut scheme_len = 0usize;
            for (i, &b) in specifier.iter().enumerate() {
                if b == b':' && i >= 2 {
                    scheme_len = i;
                    break;
                }
                if !(b.is_ascii_alphanumeric() || b == b'+' || b == b'.' || b == b'-') {
                    break;
                }
            }
            if scheme_len >= 2 {
                let scheme = &specifier[..scheme_len];
                // Schemes Bun's runtime loader accepts: Node's file/data plus
                // Bun's blob:, bun:, node:, and macro: namespaces.
                const SUPPORTED: [&[u8]; 6] =
                    [b"file", b"data", b"node", b"bun", b"blob", b"macro"];
                if !SUPPORTED.iter().any(|s| *s == scheme) {
                    // Node's network-import check lists "file and data" for
                    // http(s); the general check lists "file, data, and node".
                    let listed: &str = if scheme == b"http" || scheme == b"https" {
                        "file and data"
                    } else {
                        "file, data, and node"
                    };
                    let mut text = Vec::new();
                    let _ = write!(
                        &mut text,
                        "Only URLs with a scheme in: {} are supported by the default ESM loader. Received protocol '{}:'",
                        listed,
                        BStr::new(scheme)
                    );
                    return Some(make(text, bun_ast::Error::UnsupportedEsmUrlScheme));
                }
            }
        }
        None
    }
}
