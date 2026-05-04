use std::io::Write as _;

use bun_alloc::AllocError;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_logger as logger;
use bun_str::ZigString;

#[bun_jsc::JsClass] // codegen: JSBuildMessage (toJS / fromJS / fromJSDirect wired by derive)
pub struct BuildMessage {
    pub msg: logger::Msg,
    // resolve_result: Resolver.Result,
    // PORT NOTE: `allocator: std.mem.Allocator` field dropped — global mimalloc.
    pub logged: bool,
}

impl Default for BuildMessage {
    fn default() -> Self {
        Self { msg: logger::Msg::default(), logged: false }
    }
}

impl BuildMessage {
    #[bun_jsc::host_fn]
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut BuildMessage> {
        global.throw("BuildMessage is not constructable", format_args!(""))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_notes(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let notes = &self.msg.notes;
        let array = JSValue::create_empty_array(global, notes.len())?;
        for (i, note) in notes.iter().enumerate() {
            let cloned = note.clone()?;
            array.put_index(
                global,
                u32::try_from(i).unwrap(),
                BuildMessage::create(global, logger::Msg { data: cloned, kind: logger::Kind::Note, ..Default::default() })?,
            )?;
        }

        Ok(array)
    }

    pub fn to_string_fn(&mut self, global: &JSGlobalObject) -> JSValue {
        // std.fmt.allocPrint → write! into Vec<u8>; Rust aborts on OOM so the
        // `catch { throwOutOfMemoryValue }` branch is unreachable here.
        let mut text: Vec<u8> = Vec::new();
        write!(&mut text, "BuildMessage: {}", bstr::BStr::new(&self.msg.data.text)).unwrap();

        let mut str = ZigString::init(&text);
        str.set_output_encoding();
        if str.is_utf8() {
            let out = str.to_js(global);
            // default_allocator.free(text) → `text` drops at scope end.
            return out;
        }

        // toExternalValue: JSC takes ownership of the backing buffer and frees it later.
        // TODO(port): ZigString::to_external_value must adopt `text`'s allocation; leak it here so
        // the external-string finalizer (mimalloc-backed) can free it.
        let leaked: &'static mut [u8] = Box::leak(text.into_boxed_slice());
        let mut str = ZigString::init(leaked);
        str.set_output_encoding();
        str.to_external_value(global)
    }

    pub fn create(
        global: &JSGlobalObject,
        msg: logger::Msg,
        // resolve_result: *const Resolver.Result,
    ) -> Result<JSValue, AllocError> {
        let build_error = Box::new(BuildMessage {
            msg: msg.clone()?,
            // resolve_result: resolve_result.*,
            logged: false,
        });

        Ok(build_error.to_js(global))
    }

    #[bun_jsc::host_fn(method)]
    pub fn to_string(
        &mut self,
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(self.to_string_fn(global))
    }

    #[bun_jsc::host_fn(method)]
    pub fn to_primitive(
        &mut self,
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
                return Ok(self.to_string_fn(global));
            }
        }

        Ok(JSValue::NULL)
    }

    #[bun_jsc::host_fn(method)]
    pub fn to_json(
        &mut self,
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let object = JSValue::create_empty_object(global, 4);
        object.put(global, ZigString::static_str(b"name"), bun_str::String::static_str(b"BuildMessage").to_js(global)?);
        object.put(global, ZigString::static_str(b"position"), self.get_position(global));
        object.put(global, ZigString::static_str(b"message"), self.get_message(global));
        object.put(global, ZigString::static_str(b"level"), self.get_level(global));
        Ok(object)
    }

    pub fn generate_position_object(msg: &logger::Msg, global: &JSGlobalObject) -> JSValue {
        let Some(location) = &msg.data.location else { return JSValue::NULL; };
        let object = JSValue::create_empty_object(global, 7);

        object.put(
            global,
            ZigString::static_str(b"lineText"),
            ZigString::init(location.line_text.as_deref().unwrap_or(b"")).to_js(global),
        );
        object.put(
            global,
            ZigString::static_str(b"file"),
            ZigString::init(&location.file).to_js(global),
        );
        object.put(
            global,
            ZigString::static_str(b"namespace"),
            ZigString::init(&location.namespace).to_js(global),
        );
        object.put(
            global,
            ZigString::static_str(b"line"),
            JSValue::js_number(location.line),
        );
        object.put(
            global,
            ZigString::static_str(b"column"),
            JSValue::js_number(location.column),
        );
        object.put(
            global,
            ZigString::static_str(b"length"),
            JSValue::js_number(location.length),
        );
        object.put(
            global,
            ZigString::static_str(b"offset"),
            JSValue::js_number(location.offset),
        );

        object
    }

    // https://github.com/oven-sh/bun/issues/2375#issuecomment-2121530202
    #[bun_jsc::host_fn(getter)]
    pub fn get_column(&self, _global: &JSGlobalObject) -> JSValue {
        if let Some(location) = &self.msg.data.location {
            return JSValue::js_number((location.column - 1).max(0));
        }

        JSValue::js_number(0i32)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_line(&self, _global: &JSGlobalObject) -> JSValue {
        if let Some(location) = &self.msg.data.location {
            return JSValue::js_number((location.line - 1).max(0));
        }

        JSValue::js_number(0i32)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_position(&self, global: &JSGlobalObject) -> JSValue {
        BuildMessage::generate_position_object(&self.msg, global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_message(&self, global: &JSGlobalObject) -> JSValue {
        ZigString::init(&self.msg.data.text).to_js(global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_level(&self, global: &JSGlobalObject) -> JSValue {
        ZigString::init(self.msg.kind.string()).to_js(global)
    }

    pub fn finalize(this: *mut BuildMessage) {
        // SAFETY: `this` was allocated via Box::new in `create` and handed to the
        // C++ JSCell wrapper as m_ctx; finalize is called exactly once on the
        // mutator thread during lazy sweep. Dropping the Box runs `msg`'s Drop.
        unsafe { drop(Box::from_raw(this)); }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/BuildMessage.zig (203 lines)
//   confidence: medium
//   todos:      1
//   notes:      .classes.ts m_ctx payload; allocator field dropped; to_string_fn external-value path leaks Vec for JSC finalizer to free
// ──────────────────────────────────────────────────────────────────────────
