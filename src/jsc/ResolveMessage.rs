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
    // PORT NOTE: Zig stored `allocator: std.mem.Allocator` here; dropped — fields own their
    // allocations and free on Drop / finalize.
    //
    // PORT NOTE: Zig stored `referrer: ?Fs.Path` and only ever read `.text`;
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
        err: bun_core::Error,
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
        // PORT NOTE: matching against interned bun_core::Error consts (Zig: `switch (err)`).
        if err == bun_core::err!("ModuleNotFound") {
            if referrer == b"bun:main" {
                write!(&mut out, "Module not found '{}'", BStr::new(specifier)).ok();
                return out;
            }
            if bun_resolver::is_package_path(specifier) && !strings::contains_char(specifier, b'/')
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
        if err == bun_core::err!("InvalidDataURL") {
            write!(
                &mut out,
                "Cannot resolve invalid data URL '{}' from '{}'",
                BStr::new(specifier),
                BStr::new(referrer),
            )
            .ok();
            return out;
        }
        if err == bun_core::err!("InvalidURL") {
            write!(
                &mut out,
                "Cannot resolve invalid URL '{}' from '{}'",
                BStr::new(specifier),
                BStr::new(referrer),
            )
            .ok();
            return out;
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

        // TODO(port): `toExternalValue` transfers ownership of `text` to JSC; ensure
        // `ZigString::to_external_value` consumes the Vec without double-free.
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

    /// Spec `ResolveMessage.create` (ResolveMessage.zig:166) — clone `msg` +
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

    #[crate::host_fn(getter)]
    pub fn get_message(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(ZigString::init(&this.msg.data.text).to_js(global))
    }

    #[crate::host_fn(getter)]
    pub fn get_level(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(ZigString::init(this.msg.kind.string()).to_js(global))
    }

    #[crate::host_fn(getter)]
    pub fn get_specifier(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match &this.msg.metadata {
            bun_ast::Metadata::Resolve(resolve) => {
                ZigString::init(resolve.specifier.slice(&this.msg.data.text)).to_js(global)
            }
            // Unreachable in practice (ResolveMessage is only constructed for
            // `.resolve` metadata) — Zig accessed the union arm unchecked.
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
            ZigString::init(referrer).to_js(global)
        } else {
            JSValue::NULL
        })
    }

    pub fn finalize(self: Box<Self>) {
        // Dropping the Box drops `msg` and the owned `referrer` buffer.
        drop(self);
    }
}

// ported from: src/jsc/ResolveMessage.zig
