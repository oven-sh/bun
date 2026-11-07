use core::cell::Cell;
use std::io::Write as _;

use crate::bindgen::{JsLocal, JsScope};
use crate::bun_string_jsc;
use crate::{JSGlobalObject, JSValue, JsClass, JsResult, StringJsc as _};

/// `.level` of a `BuildMessage` / `ResolveMessage`.
pub(crate) trait LogKindJsc {
    fn to_js(self, global: &JSGlobalObject) -> JsResult<JSValue>;
}

impl LogKindJsc for bun_ast::Kind {
    fn to_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            bun_ast::Kind::Err => Ok(global.common_strings().error()),
            bun_ast::Kind::Verbose => Ok(crate::CommonString::FetchOptionVerbose.to_js(global)),
            kind => bun_core::String::static_(kind.string()).to_js(global),
        }
    }
}

pub struct BuildMessage {
    pub msg: bun_ast::Msg,
    // resolve_result: Resolver.Result,
    pub(crate) logged: Cell<bool>,
}

unsafe extern "C" {
    fn Bun__createLoaderSyntaxError(
        global: &JSGlobalObject,
        message: *const u8,
        message_length: usize,
        source_url: *const u8,
        source_url_length: usize,
        line: u32,
        column: u32,
        stack: *const u8,
        stack_length: usize,
        first: JSValue,
        all: JSValue,
    ) -> JSValue;
    safe fn Bun__loaderSyntaxErrorDiagnostic(
        global: &JSGlobalObject,
        value: JSValue,
        index: u32,
    ) -> JSValue;
}

/// The diagnostics of the module loader's `SyntaxError`, borrowed from this holder, which keeps the error alive.
pub struct LoadDiagnostics<'a> {
    global: &'a JSGlobalObject,
    error: JSValue,
}

impl LoadDiagnostics<'_> {
    fn get(&self, index: u32) -> Option<&bun_ast::Msg> {
        let cell = Bun__loaderSyntaxErrorDiagnostic(self.global, self.error, index);
        if cell.is_empty() {
            return None;
        }
        // The error holds the wrappers under a private name, so they live as long as the error does.
        match cell.as_class_ref::<BuildMessage>() {
            Some(build) => Some(&build.msg),
            None => cell
                .as_class_ref::<crate::ResolveMessage>()
                .map(|resolve| &resolve.msg),
        }
    }

    /// In log order.
    pub fn iter(&self) -> impl Iterator<Item = &bun_ast::Msg> + '_ {
        (0u32..).map_while(|index| self.get(index))
    }
}

impl Drop for LoadDiagnostics<'_> {
    fn drop(&mut self) {
        self.error.ensure_still_alive();
    }
}

impl BuildMessage {
    /// The diagnostics of `value`, when it is the `SyntaxError` of [`Self::to_syntax_error`].
    pub fn load_diagnostics(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> Option<LoadDiagnostics<'_>> {
        if !value.is_cell() || value.js_type() != crate::JSType::ErrorInstance {
            return None;
        }
        let diagnostics = LoadDiagnostics {
            global,
            error: value,
        };
        diagnostics.get(0)?;
        Some(diagnostics)
    }

    /// Whether `msg`, the first error of a log, is a syntax error: it has a line, and it is not a stack overflow.
    pub(crate) fn is_syntax_error(msg: &bun_ast::Msg) -> bool {
        !matches!(msg.metadata, bun_ast::Metadata::Resolve(_))
            && msg
                .data
                .location
                .as_ref()
                .is_some_and(|location| location.line > 0)
            && &*msg.data.text != b"Maximum call stack size exceeded"
    }

    /// The loader's `SyntaxError` for this diagnostic. `all` is `ZERO`, or an array of the wrappers that it keeps.
    pub(crate) fn to_syntax_error(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        all: JSValue,
    ) -> JsResult<JSValue> {
        let text: &[u8] = &self.msg.data.text;
        let location = self
            .msg
            .data
            .location
            .as_ref()
            .expect("a diagnostic that is_syntax_error accepts has a location");
        let file: &[u8] = &location.file;
        let line = location.line.max(0) as u32;
        let column = location.column.max(0) as u32;

        // The frame has the form of a JavaScriptCore parse error from `require()`, which the error printer reads back.
        let mut stack = Vec::with_capacity(text.len() + file.len() + 56);
        stack.extend_from_slice(b"SyntaxError: ");
        stack.extend_from_slice(text);
        stack.extend_from_slice(b"\n    at <parse> (");
        stack.extend_from_slice(file);
        write!(&mut stack, ":{line}").expect("infallible: in-memory write");
        if column > 0 {
            write!(&mut stack, ":{column}").expect("infallible: in-memory write");
        }
        stack.push(b')');

        crate::host_fn::from_js_host_call(global, || {
            // SAFETY: C++ copies the three byte ranges before it returns.
            unsafe {
                Bun__createLoaderSyntaxError(
                    global,
                    text.as_ptr(),
                    text.len(),
                    file.as_ptr(),
                    file.len(),
                    line,
                    column,
                    stack.as_ptr(),
                    stack.len(),
                    this_value,
                    all,
                )
            }
        })
    }

    pub fn get_notes(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        JSValue::create_array_from_iter(global, self.msg.notes.iter(), |note| {
            BuildMessage::create(
                global,
                bun_ast::Msg {
                    data: note.clone(),
                    kind: bun_ast::Kind::Note,
                    ..Default::default()
                },
            )
        })
    }

    pub(crate) fn to_string_fn(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let mut text = Vec::new();
        write!(
            &mut text,
            "BuildMessage: {}",
            bstr::BStr::new(&self.msg.data.text)
        )
        .expect("infallible: in-memory write");
        bun_string_jsc::owned_utf8_into_js(global, text)
    }

    pub fn create(
        global: &JSGlobalObject,
        msg: bun_ast::Msg,
        // resolve_result: *const Resolver.Result,
    ) -> JsResult<JSValue> {
        let build_error = BuildMessage {
            msg,
            // resolve_result: resolve_result.*,
            logged: Cell::new(false),
        };

        Ok(build_error.to_js(global))
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
        let object = JSValue::create_empty_object(global, 4);
        object.put(
            global,
            b"name",
            bun_core::String::static_("BuildMessage").to_js(global)?,
        );
        object.put(
            global,
            b"position",
            Self::generate_position_object(&self.msg, global)?,
        );
        object.put(
            global,
            b"message",
            bun_string_jsc::create_utf8_for_js(global, &self.msg.data.text)?,
        );
        object.put(global, b"level", self.msg.kind.to_js(global)?);
        Ok(object)
    }

    pub(crate) fn generate_position_object(
        msg: &bun_ast::Msg,
        global: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let Some(location) = &msg.data.location else {
            return Ok(JSValue::NULL);
        };
        let object = JSValue::create_empty_object(global, 7);

        object.put(
            global,
            b"lineText",
            bun_string_jsc::create_utf8_for_js(
                global,
                location.line_text.as_deref().unwrap_or(b""),
            )?,
        );
        object.put(
            global,
            b"file",
            bun_string_jsc::create_utf8_for_js(global, &location.file)?,
        );
        object.put(
            global,
            b"namespace",
            bun_string_jsc::create_utf8_for_js(global, &location.namespace)?,
        );
        object.put(global, b"line", JSValue::from(location.line));
        object.put(global, b"column", JSValue::from(location.column));
        object.put(global, b"length", JSValue::from(location.length));
        object.put(global, b"offset", JSValue::from(location.offset));

        Ok(object)
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

    pub fn get_position(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        BuildMessage::generate_position_object(&self.msg, cx.global())
    }

    pub fn get_message(&self) -> &[u8] {
        &self.msg.data.text
    }

    pub fn get_level(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.msg.kind.to_js(cx.global())
    }
}
