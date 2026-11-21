//! `process.binding("http_parser").HTTPParser`

use core::cell::Cell;

use bun_http1::message::{
    Eof, Event, Lenient, MessageKind, MessageParser, ParseError, is_http1_method, method_names,
};
use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope, JsWrapper, to_js};
use bun_jsc::{
    ArrayBuffer, BuiltinName, ErrorCode, JSGlobalObject, JSString, JSType, JSValue, JsCell,
    JsError, JsResult, PinnedArrayBuffer,
};

use crate::generated_bindgen::node_http_parser::js_HTTPParser as js;

unsafe extern "C" {
    safe fn uv_hrtime() -> u64;
}

const REQUEST: i32 = 1;
const RESPONSE: i32 = 2;

/// The index of the property that holds a callback.
#[derive(Clone, Copy)]
enum Callback {
    MessageBegin,
    Headers,
    HeadersComplete,
    Body,
    MessageComplete,
    Execute,
    Timeout,
}

/// What `kOnHeadersComplete` can return: <https://github.com/nodejs/llhttp/blob/v9.4.4/src/llhttp/http.ts#L1164-L1171>
mod after_head {
    pub(super) const BODY: i32 = 0;
    pub(super) const NO_BODY: i32 = 1;
    pub(super) const UPGRADE: i32 = 2;
    pub(super) const PAUSE: i32 = 21;
}

#[derive(Default)]
#[expect(clippy::large_enum_variant, reason = "saves an allocation per request")]
enum State {
    #[default]
    New,
    Initialized(MessageParser),
    /// Input is ignored.
    Removed,
    Closed,
}

#[derive(Default)]
pub(crate) struct HTTPParser {
    state: JsCell<State>,
    /// Counts the times that `state` was set.
    generation: Cell<u64>,
    has_flushed: Cell<bool>,
    is_head_complete: Cell<bool>,
    /// When the current message started, or 0 between messages.
    start_time: Cell<u64>,
}

impl HTTPParser {
    pub(crate) fn constructor() -> Self {
        Self::default()
    }

    pub(crate) fn call() {}

    pub(crate) fn ignore(&self) {}

    pub(crate) fn close(&self) {
        self.set_state(State::Closed);
    }

    pub(crate) fn remove<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> JsResult<()> {
        if !matches!(self.state.get(), State::Initialized(_)) {
            return Ok(());
        }
        self.set_state(State::Removed);
        self.update_connections(this_value.to_js(), cx.global())
    }

    pub(crate) fn initialize<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        (r#type, type_value): (i32, JsLocal<'a>),
        _resource: JsLocal<'a>,
        max_header_size: Option<f64>,
        lenient_flags: Option<f64>,
        connections: JsLocal<'a>,
    ) -> JsResult<()> {
        if self.is_closed() {
            return Ok(());
        }
        let global = cx.global();
        let kind = match r#type {
            REQUEST => MessageKind::Request,
            RESPONSE => MessageKind::Response,
            _ => return Err(global.throw_invalid_argument_value(b"type", type_value.to_js())),
        };
        let (this_value, connections) = (this_value.to_js(), connections.to_js());
        if !js::set_connections(this_value, global, connections).as_boolean() {
            return Ok(());
        }

        let max_header_size = match max_header_size.unwrap_or(0.0) as u64 {
            0 => bun_http::max_http_header_size() as u64,
            size => size,
        };
        let lenient_flags = lenient_flags
            .filter(|&flags| f64::from(flags as i32) == flags)
            .map_or(0, |flags| flags as i32 as u32);
        self.set_state(State::Initialized(MessageParser::new(
            kind,
            Lenient::from_bits_truncate(lenient_flags),
            max_header_size.min(JSString::MAX_LENGTH as u64),
        )));
        self.has_flushed.set(false);
        self.is_head_complete.set(false);

        if connections.is_undefined_or_null() {
            return Ok(());
        }
        // So that a connection that sends nothing expires.
        self.start_time.set(uv_hrtime());
        self.update_connections(this_value, global)
    }

    fn set_state(&self, state: State) {
        self.state.set(state);
        self.generation.update(|generation| generation + 1);
    }

    fn is_closed(&self) -> bool {
        matches!(self.state.get(), State::Closed)
    }

    /// `f` runs no JavaScript and does not throw.
    fn with_parser<R>(&self, f: impl FnOnce(&mut MessageParser) -> R) -> Option<R> {
        self.state.with_mut(|state| match state {
            State::Initialized(parser) => Some(f(parser)),
            _ => None,
        })
    }

    fn update_connections(&self, this_value: JSValue, global: &JSGlobalObject) -> JsResult<()> {
        let is_listed = !matches!(self.state.get(), State::Removed);
        let is_active = is_listed && self.start_time.get() != 0;
        js::update_connections(this_value, global, is_listed, is_active)
    }

    pub(crate) fn execute<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        input: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let (this_value, global) = (this_value.to_js(), cx.global());
        let input = match input.to_js().as_array_buffer(global) {
            Some(view) if view.typed_array_type != JSType::ArrayBuffer => view,
            _ => return Ok(JSValue::UNDEFINED),
        };
        let lasting_error = match self.state.get() {
            State::New => return Err(throw_not_initialized(global)),
            State::Initialized(parser) => parser.error(),
            State::Removed => return Ok(JSValue::js_number_from_uint64(input.byte_len as u64)),
            State::Closed => return Ok(JSValue::UNDEFINED),
        };
        if js::input_get_cached(this_value).is_some() {
            return Err(
                global.throw_type_error(format_args!("HTTPParser.execute is not reentrant"))
            );
        }
        if let Some(error) = lasting_error {
            return Ok(self.report(global, error, input.byte_len));
        }

        js::input_set_cached(this_value, global, input.value);
        let result = self.driver(this_value, global).read(input);
        js::input_set_cached(this_value, global, JSValue::ZERO);
        result
    }

    pub(crate) fn finish<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        if let State::New = self.state.get() {
            return Err(throw_not_initialized(global));
        }
        let eof = self.with_parser(MessageParser::finish);
        match eof.unwrap_or(Eof::Ignored) {
            Eof::Ignored => Ok(JSValue::UNDEFINED),
            Eof::CutsMessageShort if self.is_upgrade() => Ok(JSValue::UNDEFINED),
            Eof::CutsMessageShort => Ok(create_error(global, ParseError::UnexpectedEof, 0)),
            Eof::CompletesMessage => {
                let driver = self.driver(this_value.to_js(), global);
                match driver.on_message_complete(&ArrayBuffer::default()) {
                    Err(Interrupt::Thrown(error)) => Err(error),
                    Ok(()) | Err(Interrupt::Replaced) => Ok(JSValue::UNDEFINED),
                }
            }
        }
    }

    fn is_upgrade(&self) -> bool {
        matches!(self.state.get(), State::Initialized(parser) if parser.is_upgrade())
    }

    /// No error where another protocol may have started: <https://github.com/nodejs/node/blob/v26.12.1/src/node_http_parser.cc#L909>
    fn report(&self, global: &JSGlobalObject, error: ParseError, bytes_parsed: usize) -> JSValue {
        if self.is_upgrade() {
            return JSValue::js_number_from_uint64(bytes_parsed as u64);
        }
        create_error(global, error, bytes_parsed)
    }

    fn driver<'a>(&'a self, this_value: JSValue, global: &'a JSGlobalObject) -> Driver<'a> {
        Driver {
            this: self,
            this_value,
            global,
            generation: self.generation.get(),
        }
    }

    pub(crate) fn pause(&self) {
        self.with_parser(MessageParser::pause);
    }

    pub(crate) fn resume(&self) {
        self.with_parser(MessageParser::resume);
    }

    pub(crate) fn get_current_buffer<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> JsResult<JSValue> {
        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }
        let global = cx.global();
        let input = js::input_get_cached(this_value.to_js())
            .and_then(|input| input.as_array_buffer(global))
            .unwrap_or_default();
        ArrayBuffer::create_buffer(global, input.slice())
    }

    pub(crate) fn duration(&self) -> Option<f64> {
        if self.is_closed() {
            return None;
        }
        Some(match self.start_time.get() {
            0 => 0.0,
            start_time => (uv_hrtime() - start_time) as f64 / 1e6,
        })
    }

    pub(crate) fn headers_completed(&self) -> Option<bool> {
        (!self.is_closed()).then(|| self.is_head_complete.get())
    }

    pub(crate) fn is_idle(&self) -> bool {
        !self.is_closed() && self.start_time.get() == 0
    }

    pub(crate) fn is_expired(&self, headers_deadline: u64, request_deadline: u64) -> bool {
        let start_time = self.start_time.get();
        !self.is_closed()
            && (start_time < request_deadline
                || (start_time < headers_deadline && !self.is_head_complete.get()))
    }
}

fn throw_not_initialized(global: &JSGlobalObject) -> JsError {
    let message = format_args!("HTTPParser is not initialized");
    global.err(ErrorCode::INVALID_STATE, message).throw()
}

fn create_error(global: &JSGlobalObject, error: ParseError, bytes_parsed: usize) -> JSValue {
    let heap = JsHeap::from_global(global);
    let object = global.create_error_instance(format_args!("Parse Error"));
    object.put(
        global,
        b"bytesParsed",
        JSValue::js_number_from_uint64(bytes_parsed as u64),
    );
    for (key, text) in [("code", error.code()), ("reason", error.reason())] {
        let text = heap.create_latin1_string(text.as_bytes());
        object.put(global, key.as_bytes(), text.to_js());
    }
    object
}

enum Interrupt {
    Thrown(JsError),
    /// By `initialize()`, `remove()` or `close()`.
    Replaced,
}

impl From<JsError> for Interrupt {
    fn from(error: JsError) -> Self {
        Self::Thrown(error)
    }
}

/// One call of `execute()` or `finish()`. No borrow of the parser or of the input lasts while JavaScript runs.
struct Driver<'a> {
    this: &'a HTTPParser,
    this_value: JSValue,
    global: &'a JSGlobalObject,
    generation: u64,
}

impl Driver<'_> {
    /// `input` says where the bytes are until JavaScript runs.
    fn read(&self, mut input: ArrayBuffer) -> JsResult<JSValue> {
        let mut pinned = None;
        // An empty view can look detached.
        if input.shared || input.is_detached() {
            self.pin(&mut input, &mut pinned)?;
        }
        let interrupt = loop {
            let event = match self.with_parser(|parser| parser.advance(input.slice())) {
                Ok(event) => event,
                Err(interrupt) => break interrupt,
            };
            match self.handle(event, &mut input, &mut pinned) {
                Ok(None) => {}
                Ok(Some(result)) => return Ok(result),
                Err(interrupt) => {
                    let error = match event {
                        Event::MessageBegin => ParseError::MessageBeginCallback,
                        Event::HeadComplete => ParseError::HeadCompleteCallback,
                        Event::MessageComplete => ParseError::MessageCompleteCallback,
                        _ => ParseError::Callback,
                    };
                    let _ = self.with_parser(|parser| parser.abort(&[], error));
                    break interrupt;
                }
            }
        };
        match interrupt {
            Interrupt::Thrown(error) => Err(error),
            Interrupt::Replaced => Ok(JSValue::js_number_from_uint64(input.byte_len as u64)),
        }
    }

    /// Returns what `execute()` returns, if the read is over.
    #[inline(always)]
    fn handle(
        &self,
        event: Event,
        input: &mut ArrayBuffer,
        pinned: &mut Option<PinnedArrayBuffer>,
    ) -> Result<Option<JSValue>, Interrupt> {
        let is_over = matches!(
            event,
            Event::Done(_) | Event::DoneInBody(_) | Event::Failed(..)
        );
        if !is_over && pinned.is_none() {
            self.pin(input, pinned)?;
        }
        match event {
            Event::MessageBegin => self.on_message_begin()?,
            Event::FieldLimitNeeded => self.read_field_limit()?,
            Event::FieldsFull => self.flush(input)?,
            Event::HeadComplete => return self.on_head_complete(input),
            Event::Body(range) => self.on_body(self.create_buffer(input.slice().get(range))?)?,
            Event::MessageComplete => self.on_message_complete(input)?,
            Event::Done(consumed) => {
                return Ok(Some(JSValue::js_number_from_uint64(consumed as u64)));
            }
            Event::DoneInBody(start) => {
                self.on_body(self.create_buffer(input.slice().get(start..))?)?;
                return Ok(Some(JSValue::js_number_from_uint64(input.byte_len as u64)));
            }
            Event::Failed(error, consumed) => {
                return Ok(Some(self.this.report(self.global, error, consumed)));
            }
        }
        Ok(None)
    }

    /// Keeps the bytes of `input`, or a copy that replaces it, where they are whatever JavaScript does.
    #[inline(never)]
    fn pin(&self, input: &mut ArrayBuffer, pinned: &mut Option<PinnedArrayBuffer>) -> JsResult<()> {
        let global = self.global;
        let value = if !input.is_detached() && (input.shared || input.can_be_freed_while_pinned()) {
            ArrayBuffer::create_buffer(global, input.slice())?
        } else {
            input.value
        };
        if value.materialize_array_buffer_view_buffer() {
            *pinned = PinnedArrayBuffer::pin(global, value);
        }
        *input = **pinned
            .as_ref()
            .ok_or_else(|| global.throw_out_of_memory())?;
        if input.is_detached() {
            return Err(global.throw_type_error(format_args!("Buffer is detached")));
        }
        js::input_set_cached(self.this_value, global, value);
        Ok(())
    }

    /// `f` runs no JavaScript and does not throw.
    fn with_parser<R>(&self, f: impl FnOnce(&mut MessageParser) -> R) -> Result<R, Interrupt> {
        self.check_generation()?;
        self.this.with_parser(f).ok_or(Interrupt::Replaced)
    }

    /// Not to be read once JavaScript has run, which a throw can cause.
    fn parser(&self) -> Result<&MessageParser, Interrupt> {
        self.check_generation()?;
        match self.this.state.get() {
            State::Initialized(parser) => Ok(parser),
            _ => Err(Interrupt::Replaced),
        }
    }

    fn check_generation(&self) -> Result<(), Interrupt> {
        if self.this.generation.get() != self.generation {
            return Err(Interrupt::Replaced);
        }
        Ok(())
    }

    fn callback(&self, callback: Callback) -> Result<Option<JSValue>, Interrupt> {
        let value = self.this_value.get_index(self.global, callback as u32)?;
        self.check_generation()?;
        Ok(value.is_callable().then_some(value))
    }

    fn call(&self, callback: JSValue, arguments: &[JSValue]) -> Result<JSValue, Interrupt> {
        let result = callback.call_for_running_script(self.global, self.this_value, arguments)?;
        self.check_generation()?;
        Ok(result)
    }

    #[inline(never)]
    fn on_message_begin(&self) -> Result<(), Interrupt> {
        self.this.is_head_complete.set(false);
        self.this.start_time.set(uv_hrtime());
        self.this.update_connections(self.this_value, self.global)?;
        if let Some(callback) = self.callback(Callback::MessageBegin)? {
            self.call(callback, &[])?;
        }
        Ok(())
    }

    /// For requests. `node:_http_common` truncates a response: <https://github.com/nodejs/node/blob/v26.12.1/src/node_http_parser.cc#L1072-L1101>
    #[inline(never)]
    fn read_field_limit(&self) -> Result<(), Interrupt> {
        let names_and_values = self
            .this_value
            .fast_get(self.global, BuiltinName::maxHeaderPairs)?
            .and_then(JSValue::get_number);
        match names_and_values {
            Some(max) if max > 0.0 => {
                self.with_parser(|parser| parser.set_max_fields((max / 2.0) as u64))
            }
            _ => Ok(()),
        }
    }

    /// Returns what `execute()` returns, if the callback ends the read.
    #[inline(never)]
    fn on_head_complete(&self, input: &ArrayBuffer) -> Result<Option<JSValue>, Interrupt> {
        self.this.is_head_complete.set(true);
        let Some(callback) = self.callback(Callback::HeadersComplete)? else {
            return Ok(None);
        };
        let (headers, url) = if self.this.has_flushed.get() {
            self.flush(input)?;
            (JSValue::UNDEFINED, JSValue::UNDEFINED)
        } else {
            self.create_headers_and_url(input, JSValue::UNDEFINED)?
        };
        let arguments = self.with_parser(|parser| {
            parser.clear_fields();
            let number = |number: u16| JSValue::js_number_from_int32(number.into());
            let (method, status_code, status_text) = match parser.kind() {
                MessageKind::Request => (
                    number(parser.method().into()),
                    JSValue::UNDEFINED,
                    JSValue::UNDEFINED,
                ),
                MessageKind::Response => (
                    JSValue::UNDEFINED,
                    number(parser.status_code()),
                    self.create_string(parser.start_line_text(input.slice())),
                ),
            };
            let (major_version, minor_version) = parser.version();
            [
                number(major_version.into()),
                number(minor_version.into()),
                headers,
                method,
                url,
                status_code,
                status_text,
                JSValue::js_boolean(parser.is_upgrade()),
                JSValue::js_boolean(parser.should_keep_alive()),
            ]
        })?;
        let answer = self
            .call(callback, &arguments)?
            .coerce_to_i32(self.global)?;

        let error = match answer {
            after_head::BODY => return Ok(None),
            after_head::NO_BODY => {
                return self.with_parser(MessageParser::skip_body).map(|()| None);
            }
            after_head::UPGRADE => {
                return self
                    .with_parser(MessageParser::switch_protocol)
                    .map(|()| None);
            }
            after_head::PAUSE => ParseError::PausedAfterHead,
            _ => ParseError::HeadCompleteCallback,
        };
        let consumed = self.with_parser(|parser| parser.abort(input.slice(), error))?;
        Ok(Some(self.this.report(self.global, error, consumed)))
    }

    #[inline(never)]
    fn on_body(&self, body: JSValue) -> Result<(), Interrupt> {
        if let Some(callback) = self.callback(Callback::Body)? {
            self.call(callback, &[body])?;
        }
        Ok(())
    }

    #[inline(never)]
    fn on_message_complete(&self, input: &ArrayBuffer) -> Result<(), Interrupt> {
        self.this.start_time.set(0);
        self.this.update_connections(self.this_value, self.global)?;
        if self.parser()?.fields(input.slice()).len() > 0 {
            self.flush(input)?;
        }
        if let Some(callback) = self.callback(Callback::MessageComplete)? {
            self.call(callback, &[])?;
        }
        Ok(())
    }

    fn flush(&self, input: &ArrayBuffer) -> Result<(), Interrupt> {
        let Some(callback) = self.callback(Callback::Headers)? else {
            return Ok(());
        };
        let (headers, url) =
            self.create_headers_and_url(input, JSValue::js_empty_string(self.global))?;
        self.call(callback, &[headers, url])?;
        self.this.has_flushed.set(true);
        self.with_parser(MessageParser::clear_url)
    }

    fn create_headers_and_url(
        &self,
        input: &ArrayBuffer,
        url_of_response: JSValue,
    ) -> Result<(JSValue, JSValue), Interrupt> {
        let (parser, input) = (self.parser()?, input.slice());
        let fields = parser.fields(input);
        let headers = JSValue::create_empty_array(self.global, 2 * fields.len())?;
        for (index, (name, value)) in (0..).step_by(2).zip(fields) {
            headers.put_index(self.global, index, self.create_string(name))?;
            headers.put_index(self.global, index + 1, self.create_string(value))?;
        }
        let url = match parser.kind() {
            MessageKind::Request => self.create_string(parser.start_line_text(input)),
            MessageKind::Response => url_of_response,
        };
        Ok((headers, url))
    }

    fn create_buffer(&self, bytes: Option<&[u8]>) -> JsResult<JSValue> {
        ArrayBuffer::create_buffer(self.global, bytes.unwrap_or_default())
    }

    fn create_string(&self, latin1: &[u8]) -> JSValue {
        JsHeap::from_global(self.global)
            .create_latin1_string(latin1)
            .to_js()
    }
}

fn create_method_names(
    global: &JSGlobalObject,
    includes: impl Fn(u8) -> bool,
) -> JsResult<JSValue> {
    let methods = (0..).zip(method_names());
    let names = methods.filter_map(|(method, name)| includes(method).then_some(name));
    JsHeap::from_global(global)
        .create_array(names, to_js::utf8)
        .map(JsLocal::to_js)
        .map_err(|error| error.into_js_error(global))
}

// HOST_EXPORT(Bun__HTTPParser__createMethods, jsc)
pub(crate) fn create_methods(global: &JSGlobalObject) -> JsResult<JSValue> {
    create_method_names(global, is_http1_method)
}

// HOST_EXPORT(Bun__HTTPParser__createAllMethods, jsc)
pub(crate) fn create_all_methods(global: &JSGlobalObject) -> JsResult<JSValue> {
    create_method_names(global, |_| true)
}

// HOST_EXPORT(Bun__HTTPParser__createConstructor, jsc)
pub(crate) fn create_constructor(global: &JSGlobalObject) -> JSValue {
    let lenient = |flags: Lenient| flags.bits() as i32;
    let constructor = js::get_constructor(global);
    for (name, value) in [
        ("REQUEST", REQUEST),
        ("RESPONSE", RESPONSE),
        ("kOnMessageBegin", Callback::MessageBegin as i32),
        ("kOnHeaders", Callback::Headers as i32),
        ("kOnHeadersComplete", Callback::HeadersComplete as i32),
        ("kOnBody", Callback::Body as i32),
        ("kOnMessageComplete", Callback::MessageComplete as i32),
        ("kOnExecute", Callback::Execute as i32),
        ("kOnTimeout", Callback::Timeout as i32),
        ("kLenientNone", lenient(Lenient::empty())),
        ("kLenientHeaders", lenient(Lenient::HEADERS)),
        ("kLenientChunkedLength", lenient(Lenient::CHUNKED_LENGTH)),
        ("kLenientKeepAlive", lenient(Lenient::KEEP_ALIVE)),
        (
            "kLenientTransferEncoding",
            lenient(Lenient::TRANSFER_ENCODING),
        ),
        ("kLenientVersion", lenient(Lenient::VERSION)),
        ("kLenientDataAfterClose", lenient(Lenient::DATA_AFTER_CLOSE)),
        (
            "kLenientOptionalLFAfterCR",
            lenient(Lenient::OPTIONAL_LF_AFTER_CR),
        ),
        (
            "kLenientOptionalCRLFAfterChunk",
            lenient(Lenient::OPTIONAL_CRLF_AFTER_CHUNK),
        ),
        (
            "kLenientOptionalCRBeforeLF",
            lenient(Lenient::OPTIONAL_CR_BEFORE_LF),
        ),
        (
            "kLenientSpacesAfterChunkSize",
            lenient(Lenient::SPACES_AFTER_CHUNK_SIZE),
        ),
        (
            "kLenientHeaderValueRelaxed",
            lenient(Lenient::HEADER_VALUE_RELAXED),
        ),
        (
            "kLenientAll",
            lenient(Lenient::all() - Lenient::HEADER_VALUE_RELAXED),
        ),
    ] {
        let value = JSValue::js_number_from_int32(value);
        constructor.put(global, name.as_bytes(), value);
    }
    constructor
}
