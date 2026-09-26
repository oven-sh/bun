use std::cell::Cell;
use std::io::Write as _;

use bun_ast::ImportKind;
use bun_core::strings;

use crate::build_message::LogKindJsc as _;
use crate::bun_string_jsc;
use crate::{CallFrame, JSGlobalObject, JSValue, JsClass, JsResult, StringJsc as _};

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
    pub(crate) referrer: Option<Box<[u8]>>,
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
    // `#[JsClass]` emits `ResolveMessageClass__construct` calling this.
    pub fn constructor(
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<*mut ResolveMessage> {
        Err(global.throw_illegal_constructor())
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

                bun_core::String::create_atom(code).into_js(global)
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
        let node_message = self.node_message();
        let message: &[u8] = node_message.as_deref().unwrap_or(&self.msg.data.text);
        let mut text = Vec::new();
        write!(&mut text, "ResolveMessage: {}", bstr::BStr::new(message))
            .expect("infallible: in-memory write");
        bun_string_jsc::owned_utf8_into_js(global, text)
    }

    #[crate::host_fn(method)]
    pub fn to_string(
        // this
        this: &Self,
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.to_string_fn(global)
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

            let str = args[0].to_bun_string(global)?;
            if str.eq_ascii(b"default") || str.eq_ascii(b"string") {
                return this.to_string_fn(global);
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
            bun_core::String::static_("ResolveMessage").to_js(global)?,
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
        let mut cloned = msg.clone();
        if let bun_ast::Metadata::Resolve(resolve) = &cloned.metadata
            && resolve.err == bun_ast::Error::ModuleNotFound
            && let Some(note) = blocked_lifecycle_script_note(referrer)
        {
            let mut notes = cloned.notes.into_vec();
            notes.push(note);
            cloned.notes = notes.into_boxed_slice();
        }
        let resolve_error = ResolveMessage {
            msg: cloned,
            referrer: Some(Box::<[u8]>::from(referrer)),
            logged: Cell::new(false),
        };
        Ok(resolve_error.to_js(global))
    }

    #[crate::host_fn(getter)]
    pub fn get_position(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        crate::BuildMessage::generate_position_object(&this.msg, global)
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

    #[crate::host_fn(getter)]
    pub fn get_message(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(text) = this.node_message() {
            return bun_string_jsc::create_utf8_for_js(global, &text);
        }
        bun_string_jsc::create_utf8_for_js(global, &this.msg.data.text)
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
            bun_string_jsc::create_utf8_for_js(global, r)
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
        bun_string_jsc::create_utf8_for_js(global, &out)
    }

    #[crate::host_fn(getter)]
    pub fn get_level(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.msg.kind.to_js(global)
    }

    #[crate::host_fn(getter)]
    pub fn get_specifier(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match &this.msg.metadata {
            bun_ast::Metadata::Resolve(resolve) => bun_string_jsc::create_utf8_for_js(
                global,
                resolve.specifier.slice(&this.msg.data.text),
            )?,
            // Unreachable in practice (ResolveMessage is only constructed for
            // `.resolve` metadata).
            _ => JSValue::js_empty_string(global),
        })
    }

    #[crate::host_fn(getter)]
    pub fn get_import_kind(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match &this.msg.metadata {
            bun_ast::Metadata::Resolve(resolve) => {
                bun_core::String::static_(import_kind_label(resolve.import_kind)).to_js(global)?
            }
            _ => JSValue::js_empty_string(global),
        })
    }

    #[crate::host_fn(getter)]
    pub fn get_referrer(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(if let Some(referrer) = &this.referrer {
            bun_string_jsc::create_utf8_for_js(global, referrer)?
        } else {
            JSValue::NULL
        })
    }
}

/// If `referrer` sits inside `node_modules/<pkg>/` and `<pkg>` has a lifecycle
/// script that Bun may have blocked, return a `bun pm trust <pkg>` hint.
/// <https://github.com/oven-sh/bun/issues/12890>
#[cold]
fn blocked_lifecycle_script_note(referrer: &[u8]) -> Option<bun_ast::Data> {
    let (pkg_name, pkg_dir) = enclosing_node_modules_package(referrer)?;
    let script = first_lifecycle_script(pkg_dir)?;

    let mut text = Vec::new();
    write!(
        &mut text,
        "The \"{script}\" script for \"{name}\" may have been blocked. If you trust this \
         package, run `bun pm trust {name}` and try again.",
        name = bstr::BStr::new(&pkg_name),
    )
    .ok()?;
    Some(bun_ast::range_data(None, bun_ast::Range::NONE, text))
}

/// `(package_name, package_dir)` of the deepest `node_modules/<name>` that
/// `referrer` sits inside. `package_dir` is a prefix of `referrer`.
#[cold]
fn enclosing_node_modules_package(referrer: &[u8]) -> Option<(Vec<u8>, &[u8])> {
    let nm_start = strings::last_index_of(referrer, bun_paths::NODE_MODULES_NEEDLE)?;
    let name_start = nm_start + bun_paths::NODE_MODULES_NEEDLE.len();
    let rest = referrer.get(name_start..)?;
    let next_sep = |bytes: &[u8]| bytes.iter().position(|&c| bun_paths::is_sep_any(c));
    let name_len = if rest.first() == Some(&b'@') {
        let scope_end = next_sep(rest)?;
        let pkg_end = next_sep(rest.get(scope_end + 1..)?)?;
        scope_end + 1 + pkg_end
    } else {
        next_sep(rest)?
    };
    if name_len == 0 || rest[..name_len].starts_with(b".") {
        return None;
    }
    let mut name = rest[..name_len].to_vec();
    for b in &mut name {
        if *b == b'\\' {
            *b = b'/';
        }
    }
    Some((name, &referrer[..name_start + name_len]))
}

/// Byte-scan `<pkg_dir>/package.json` for any `bun_install` lifecycle hook key
/// inside `"scripts"`, or a sibling `binding.gyp`. Used only for the UX hint
/// above, so a full JSON parse is avoided.
#[cold]
fn first_lifecycle_script(pkg_dir: &[u8]) -> Option<&'static str> {
    let mut buf = bun_paths::path_buffer_pool::get();

    let manifest = bun_paths::resolve_path::join_string_buf::<bun_paths::platform::Auto>(
        buf.as_mut_slice(),
        &[pkg_dir, b"package.json"],
    );
    if let Ok(bytes) = bun_sys::File::read_from(bun_sys::Fd::cwd(), manifest)
        && let Some(after) = find_json_key(&bytes, b"\"scripts\"")
    {
        // Bound to the `"scripts"` object so a sibling key like
        // `"dependencies": { "install": "..." }` cannot match.
        let scripts = &after[..end_of_flat_json_object(after)];
        // Only the install-family: `Scripts::get_script_entries` gates
        // `NAMES[3..]` (preprepare/prepare/postprepare) on `ResolutionTag`
        // and never enqueues them for registry packages, so including them
        // would false-positive on the ubiquitous `"prepare":"husky install"`.
        for hook in &bun_install::lockfile::Scripts::NAMES[..3] {
            if find_json_key(scripts, format!("\"{hook}\"").as_bytes()).is_some() {
                return Some(hook);
            }
        }
    }

    let gyp = bun_paths::resolve_path::join_string_buf::<bun_paths::platform::Auto>(
        buf.as_mut_slice(),
        &[pkg_dir, b"binding.gyp"],
    );
    if bun_sys::exists(gyp) {
        return Some("install");
    }

    None
}

/// Find `key` (including its surrounding quotes) used as a JSON object key in
/// `bytes`: i.e. followed by optional JSON whitespace and then `:`. Returns the
/// slice starting after the `:`. Skips occurrences that are string values
/// (`"files":["scripts"]`) rather than keys.
#[cold]
fn find_json_key<'a>(bytes: &'a [u8], key: &[u8]) -> Option<&'a [u8]> {
    let mut rest = bytes;
    loop {
        let at = strings::index_of(rest, key)?;
        let after = &rest[at + key.len()..];
        let trimmed = after
            .iter()
            .position(|&b| !matches!(b, b' ' | b'\t' | b'\r' | b'\n'))
            .unwrap_or(after.len());
        if after.get(trimmed) == Some(&b':') {
            return Some(&after[trimmed + 1..]);
        }
        rest = &rest[at + key.len()..];
    }
}

/// Offset of the first `}` that is not inside a JSON string. No brace nesting
/// is tracked (sufficient for `"scripts"`, which is `Record<string, string>`).
#[cold]
fn end_of_flat_json_object(bytes: &[u8]) -> usize {
    let mut in_string = false;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' if in_string => i += 1,
            b'"' => in_string = !in_string,
            b'}' if !in_string => return i,
            _ => {}
        }
        i += 1;
    }
    bytes.len()
}
