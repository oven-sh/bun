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
    pub(crate) referrer: Option<Box<[u8]>>,
    pub(crate) logged: Cell<bool>,
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

    pub(crate) fn to_string_fn(&self, global: &JSGlobalObject) -> JSValue {
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
        Ok(crate::BuildMessage::generate_position_object(
            &this.msg, global,
        ))
    }

    #[crate::host_fn(getter)]
    pub fn get_message(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(ZigString::init_utf8(&this.msg.data.text).to_js(global))
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
        "\"{name}\" has a \"{script}\" script which may have been blocked. If you trust this \
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

/// Byte-scan `<pkg_dir>/package.json` for a `preinstall`/`install`/`postinstall`
/// key in `"scripts"`, or a sibling `binding.gyp`. Used only for the UX hint
/// above, so a full JSON parse is avoided.
#[cold]
fn first_lifecycle_script(pkg_dir: &[u8]) -> Option<&'static str> {
    let mut buf = bun_paths::path_buffer_pool::get();

    let manifest = bun_paths::resolve_path::join_string_buf::<bun_paths::platform::Auto>(
        buf.as_mut_slice(),
        &[pkg_dir, b"package.json"],
    );
    if let Ok(bytes) = bun_sys::File::read_from(bun_sys::Fd::cwd(), manifest)
        && let Some(scripts_at) = strings::index_of(&bytes, b"\"scripts\"")
    {
        // Bound to the `"scripts"` object so a sibling key like
        // `"dependencies": { "install": "..." }` cannot match.
        let after = &bytes[scripts_at + b"\"scripts\"".len()..];
        let end = end_of_flat_json_object(after);
        let scripts = &after[..end];
        for (hook, key) in [
            ("preinstall", b"\"preinstall\"" as &[u8]),
            ("install", b"\"install\""),
            ("postinstall", b"\"postinstall\""),
        ] {
            if strings::contains(scripts, key) {
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
