use std::io::Write as _;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_logger as logger;
use bun_options_types::ImportKind;
use bun_str::{strings, String as BunString, ZigString};

#[bun_jsc::JsClass]
pub struct ResolveMessage {
    pub msg: logger::Msg,
    // PORT NOTE: Zig stored `allocator: std.mem.Allocator` here; dropped — fields own their
    // allocations and free on Drop / finalize.
    pub referrer: Option<bun_fs::Path>,
    pub logged: bool,
}

impl Default for ResolveMessage {
    fn default() -> Self {
        Self { msg: logger::Msg::default(), referrer: None, logged: false }
    }
}

impl ResolveMessage {
    #[bun_jsc::host_fn]
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut ResolveMessage> {
        global.throw("ResolveMessage is not constructable", format_args!(""))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_code(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match &this.msg.metadata {
            logger::Msg::Metadata::Resolve(resolve) => {
                let code: &'static [u8] = 'brk: {
                    let specifier = this.msg.metadata.resolve().specifier.slice(&this.msg.data.text);

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

                let atom = BunString::create_atom_ascii(code);
                Ok(atom.to_js(global))
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }

    // https://github.com/oven-sh/bun/issues/2375#issuecomment-2121530202
    #[bun_jsc::host_fn(getter)]
    pub fn get_column(this: &Self, _global: &JSGlobalObject) -> JSValue {
        if let Some(location) = &this.msg.data.location {
            return JSValue::js_number((location.column - 1).max(0));
        }

        JSValue::js_number(0_i32)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_line(this: &Self, _global: &JSGlobalObject) -> JSValue {
        if let Some(location) = &this.msg.data.location {
            return JSValue::js_number((location.line - 1).max(0));
        }

        JSValue::js_number(0_i32)
    }

    pub fn fmt(
        specifier: &[u8],
        referrer: &[u8],
        err: bun_core::Error,
        import_kind: ImportKind,
    ) -> Result<Vec<u8>, bun_alloc::AllocError> {
        use bstr::BStr;
        let mut out = Vec::new();
        if import_kind != ImportKind::RequireResolve && specifier.starts_with(b"node:") {
            // This matches Node.js exactly.
            write!(&mut out, "No such built-in module: {}", BStr::new(specifier)).ok();
            return Ok(out);
        }
        // PORT NOTE: matching against interned bun_core::Error consts (Zig: `switch (err)`).
        if err == bun_core::err!("ModuleNotFound") {
            if referrer == b"bun:main" {
                write!(&mut out, "Module not found '{}'", BStr::new(specifier)).ok();
                return Ok(out);
            }
            if bun_resolver::is_package_path(specifier)
                && strings::index_of_char(specifier, b'/').is_none()
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
            return Ok(out);
        }
        if err == bun_core::err!("InvalidDataURL") {
            write!(
                &mut out,
                "Cannot resolve invalid data URL '{}' from '{}'",
                BStr::new(specifier),
                BStr::new(referrer),
            )
            .ok();
            return Ok(out);
        }
        if err == bun_core::err!("InvalidURL") {
            write!(
                &mut out,
                "Cannot resolve invalid URL '{}' from '{}'",
                BStr::new(specifier),
                BStr::new(referrer),
            )
            .ok();
            return Ok(out);
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
        Ok(out)
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
        let mut str = ZigString::init(Box::leak(leaked));
        str.set_output_encoding();
        str.to_external_value(global)
    }

    #[bun_jsc::host_fn(method)]
    pub fn to_string(
        // this
        this: &mut Self,
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(this.to_string_fn(global))
    }

    #[bun_jsc::host_fn(method)]
    pub fn to_primitive(
        this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args_ = callframe.arguments_old(1);
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

    #[bun_jsc::host_fn(method)]
    pub fn to_json(
        this: &mut Self,
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let object = JSValue::create_empty_object(global, 7);
        object.put(global, ZigString::static_(b"name"), BunString::static_(b"ResolveMessage").to_js(global)?);
        object.put(global, ZigString::static_(b"position"), this.get_position(global));
        object.put(global, ZigString::static_(b"message"), this.get_message(global));
        object.put(global, ZigString::static_(b"level"), this.get_level(global));
        object.put(global, ZigString::static_(b"specifier"), this.get_specifier(global));
        object.put(global, ZigString::static_(b"importKind"), this.get_import_kind(global));
        object.put(global, ZigString::static_(b"referrer"), this.get_referrer(global));
        Ok(object)
    }

    pub fn create(
        global: &JSGlobalObject,
        msg: &logger::Msg,
        referrer: &[u8],
    ) -> Result<JSValue, bun_alloc::AllocError> {
        let resolve_error = Box::new(ResolveMessage {
            msg: msg.clone()?,
            referrer: Some(bun_fs::Path::init(Box::<[u8]>::from(referrer))),
            logged: false,
        });
        Ok(resolve_error.to_js(global))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_position(this: &Self, global: &JSGlobalObject) -> JSValue {
        bun_runtime::api::BuildMessage::generate_position_object(&this.msg, global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_message(this: &Self, global: &JSGlobalObject) -> JSValue {
        ZigString::init(&this.msg.data.text).to_js(global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_level(this: &Self, global: &JSGlobalObject) -> JSValue {
        ZigString::init(this.msg.kind.string()).to_js(global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_specifier(this: &Self, global: &JSGlobalObject) -> JSValue {
        ZigString::init(this.msg.metadata.resolve().specifier.slice(&this.msg.data.text)).to_js(global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_import_kind(this: &Self, global: &JSGlobalObject) -> JSValue {
        ZigString::init(this.msg.metadata.resolve().import_kind.label()).to_js(global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_referrer(this: &Self, global: &JSGlobalObject) -> JSValue {
        if let Some(referrer) = &this.referrer {
            ZigString::init(&referrer.text).to_js(global)
        } else {
            JSValue::NULL
        }
    }

    pub extern "C" fn finalize(this: *mut ResolveMessage) {
        // SAFETY: `this` was allocated via Box::new in `create` and ownership was
        // transferred to the JS wrapper; finalize is called exactly once on the
        // mutator thread during lazy sweep.
        // Dropping the Box drops `msg` (logger::Msg) and `referrer` (owns its text).
        // TODO(port): confirm bun_fs::Path owns `text` as Box<[u8]> so this frees it.
        unsafe {
            drop(Box::from_raw(this));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ResolveMessage.zig (249 lines)
//   confidence: medium
//   todos:      2
//   notes:      .classes.ts payload; metadata.resolve accessor and ZigString external-value ownership need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
