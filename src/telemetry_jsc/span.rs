use bun_jsc::bindgen::{JsHeap, JsLocal, JsPayload, JsScope, JsWrapper, StrongWrapper};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    EncodedSliceJsc, JSArray, JSArrayIterator, JSGlobalObject, JSObject, JSString, JSValue,
    JsResult, WrapperGuard,
};
use bun_ptr::JsCell;
use bun_telemetry::{Record, SpanData, StatusCode};

use crate::context::{self, Binding, Bound, Context};
use crate::engine;
use crate::generated_bindgen::telemetry::{LinkInit, StatusInit, StatusInput, js_Span as js};
use crate::native;
use crate::outcome::{Outcome, Thrown};
use crate::state::VmState;
use crate::trace_state::TraceState;
use crate::values::{self, EntryAttributes};

/// The fields of the object: `name`, unless the record has it, the binding that `enter()` `displaced` (`null` for
/// none), and the `context` that `spanContext()` returns.
pub struct Span(JsCell<SpanData>);

impl Span {
    #[inline]
    pub(crate) fn create(
        global: &JSGlobalObject,
        data: SpanData,
        name: Option<JSValue>,
    ) -> JSValue {
        let span = Span(JsCell::new(data)).into_js_wrapper(global).to_js();
        if let Some(name) = name {
            js::name_set_cached(span, global, name);
        }
        span
    }

    pub(crate) fn create_held(global: &JSGlobalObject, data: SpanData) -> StrongWrapper<Span> {
        StrongWrapper::new(Span(JsCell::new(data)).into_js_wrapper(global), global)
    }

    /// For a value that [`create`](Self::create) returned.
    #[inline]
    pub(crate) fn of(span: &JSValue) -> WrapperGuard<'_, Span> {
        js::from_js(span).expect("a Span")
    }

    #[inline]
    pub(crate) fn data(&self) -> &SpanData {
        self.0.get()
    }

    /// For a span that native code made.
    pub(crate) fn hand_to_script(span: JSValue) {
        if let Some(span) = span.as_class_ref::<Span>() {
            span.0.with_mut(|data| {
                data.stub.ctx.flags = data.stub.ctx.flags.with_handed_to_script();
            });
        }
    }

    /// Does nothing unless the span is recording. `f` runs no JavaScript.
    #[inline]
    pub(crate) fn record(&self, f: impl FnOnce(&mut Record)) {
        let grown = self.0.with_mut(|data| {
            data.record_mut(VmState::take_record).map_or(0, |record| {
                let before = record.capacity();
                f(record);
                record.capacity() - before
            })
        });
        // A span that is never ended holds it until it is collected.
        if grown >= 1024 {
            VirtualMachine::get()
                .jsc_vm()
                .deprecated_report_extra_memory(grown);
        }
    }

    #[inline]
    #[optimize(speed)]
    pub(crate) fn put_attribute(
        &self,
        global: &JSGlobalObject,
        key: JSValue,
        value: JSValue,
    ) -> JsResult<()> {
        if !self.is_recording() || !key.is_string_literal() {
            return Ok(());
        }
        let key = key.to_js_string_view(global)?;
        let key = key.to_utf8();
        if key.is_empty() {
            return Ok(());
        }
        values::with_attribute_value(global, value, |value| {
            self.record(|r| r.set_attribute(&key, value));
        })
    }

    #[optimize(speed)]
    pub(crate) fn put_attributes(
        &self,
        global: &JSGlobalObject,
        attributes: JSValue,
    ) -> JsResult<()> {
        if !self.is_recording() {
            return Ok(());
        }
        values::for_each_attribute(global, attributes, |key, value| {
            self.record(|r| r.set_attribute(key, value));
        })
    }

    fn put_link(&self, global: &JSGlobalObject, link: &LinkInit<'_>) -> JsResult<()> {
        let Some(context) = link.context.as_ref().filter(|_| self.is_recording()) else {
            return Ok(());
        };
        let Some(mut linked) = context.ids() else {
            return Ok(());
        };
        if context.is_remote == Some(true) {
            linked.flags = linked.flags.with_remote();
        }
        let trace_state = values::trace_state_header(global, context.trace_state.to_js())?;
        let attributes = link.attributes.map(JsLocal::to_js);
        let attributes = EntryAttributes::of_link(global, attributes)?;
        self.record(|r| {
            attributes.write(r.begin_link(&linked, &trace_state));
        });
        Ok(())
    }

    pub(crate) fn put_links(&self, global: &JSGlobalObject, links: JSValue) -> JsResult<()> {
        if !self.is_recording() {
            return Ok(());
        }
        let mut links = JSArrayIterator::init(links, global)?;
        while let Some(link) = links.next()? {
            LinkInit::from_js(global, link, |link| self.put_link(global, &link))?;
        }
        Ok(())
    }

    fn put_status(
        &self,
        global: &JSGlobalObject,
        code: StatusCode,
        message: JSValue,
    ) -> JsResult<()> {
        if !self.is_recording() || code == StatusCode::Unset {
            return Ok(());
        }
        let message = if code == StatusCode::Error && !message.is_undefined_or_null() {
            message.to_utf8(global)?
        } else {
            bun_core::Utf8Bytes::EMPTY
        };
        self.record(|r| r.set_status(code, &message));
        Ok(())
    }

    pub(crate) fn fail_in_passing(&self, global: &JSGlobalObject, error: JSValue) {
        self.record(|r| Thrown(global, error).record(r));
    }

    /// An exception may be pending.
    #[inline]
    #[optimize(speed)]
    pub(crate) fn finish(&self, global: &JSGlobalObject, this_value: JSValue, end_ns: u64) {
        if self.get_ended() {
            return;
        }
        if !self.is_recording() {
            return self.0.with_mut(SpanData::discard);
        }
        if let Some(name) = js::name_get_cached(this_value) {
            let name = engine::borrow_string(name);
            return (self.0).with_mut(|data| native::end(data, &name.to_utf8(), end_ns));
        }
        if self.data().stub.ctx.flags.handed_to_script() {
            js::name_set_cached(this_value, global, self.recorded_name(global));
        }
        self.0.with_mut(|data| native::end(data, b"", end_ns));
    }

    fn recorded_name(&self, global: &JSGlobalObject) -> JSValue {
        let mut name = Vec::new();
        if let Some(record) = self.data().record() {
            record.append_name(&mut name);
        }
        bun_core::EncodedSlice::utf8(&name).to_js(global)
    }

    /// As `AsyncLocalStorage.prototype.enterWith()`, keeping the other values of `under`. No span
    /// that is active has displaced `span`.
    #[optimize(speed)]
    pub(crate) fn enter_under(global: &JSGlobalObject, span: JSValue, under: Option<JSValue>) {
        if js::displaced_get_cached(span).is_some() {
            return;
        }
        let displaced = context::active_binding(global);
        js::displaced_set_cached(span, global, displaced.unwrap_or(JSValue::NULL));
        let binding = Context::bind_new_span(global, span, under.or(displaced), Bound::UntilEnded);
        engine::set_active_binding(global, binding);
    }

    #[inline]
    pub(crate) fn has_entered(span: JSValue) -> bool {
        js::displaced_get_cached(span).is_some()
    }

    #[inline]
    pub(crate) fn displaced_if_ended(span: JSValue) -> Option<JSValue> {
        js::displaced_get_cached(span).filter(|_| Span::of(&span).get_ended())
    }

    fn leave(global: &JSGlobalObject, span: JSValue) {
        if let Some(displaced) = js::displaced_take_cached(span, global) {
            engine::set_active_binding(global, Some(displaced).filter(|b| !b.is_null()));
        }
    }
}

/// What the members with `capability: "heap"` call allocates, resolves ropes and reads elements that are there.
#[inline(always)]
pub(crate) fn global_of<'h>(heap: &'h JsHeap<'_>) -> &'h JSGlobalObject {
    // SAFETY: none of that runs JavaScript.
    unsafe { heap.global() }
}

fn hex<'a, const N: usize>(heap: &JsHeap<'a>, id: &[u8]) -> JsLocal<'a, JSString> {
    let mut text = [0u8; N];
    bun_core::fmt::bytes_to_hex_lower(id, &mut text);
    heap.create_latin1_string(&text)
}

type This<'a> = JsWrapper<'a, Span>;

impl Span {
    pub(crate) fn set_attribute<'a>(
        &self,
        this_value: This<'a>,
        heap: &JsHeap<'a>,
        key: JsLocal<'a>,
        value: JsLocal<'a>,
    ) -> JsResult<This<'a>> {
        self.put_attribute(global_of(heap), key.to_js(), value.to_js())?;
        Ok(this_value)
    }

    pub(crate) fn set_one<'a>(
        &self,
        this_value: This<'a>,
        heap: &JsHeap<'a>,
        key: JsLocal<'a, JSString>,
        value: JsLocal<'a>,
    ) -> JsResult<This<'a>> {
        self.set_attribute(this_value, heap, key.as_value(), value)
    }

    pub(crate) fn set_attributes<'a>(
        &self,
        this_value: This<'a>,
        cx: &mut JsScope<'a>,
        attributes: Option<JsLocal<'a, JSObject>>,
    ) -> JsResult<This<'a>> {
        if let Some(attributes) = attributes {
            self.put_attributes(cx.global(), attributes.to_js())?;
        }
        Ok(this_value)
    }

    pub(crate) fn add_event<'a>(
        &self,
        this_value: This<'a>,
        cx: &mut JsScope<'a>,
        name: &[u8],
        attributes_or_time: JsLocal<'a>,
        time: JsLocal<'a>,
    ) -> JsResult<This<'a>> {
        if !self.is_recording() {
            return Ok(this_value);
        }
        let (global, second) = (cx.global(), attributes_or_time.to_js());
        let (attributes, time) = if values::is_time_input(second) {
            (None, second)
        } else {
            (Some(second).filter(|a| a.is_object()), time.to_js())
        };
        let attributes = EntryAttributes::of_event(global, attributes)?;
        let time = values::time_input(global, time);
        self.record(|r| attributes.write(r.begin_event(name, time)));
        Ok(this_value)
    }

    pub(crate) fn add_link<'a>(
        &self,
        this_value: This<'a>,
        cx: &mut JsScope<'a>,
        link: &LinkInit<'a>,
    ) -> JsResult<This<'a>> {
        self.put_link(cx.global(), link)?;
        Ok(this_value)
    }

    pub(crate) fn add_links<'a>(
        &self,
        this_value: This<'a>,
        cx: &mut JsScope<'a>,
        links: Option<JsLocal<'a, JSArray>>,
    ) -> JsResult<This<'a>> {
        if let Some(links) = links {
            self.put_links(cx.global(), links.to_js())?;
        }
        Ok(this_value)
    }

    #[allow(clippy::needless_pass_by_value, reason = "as the schema passes it")]
    pub(crate) fn set_status<'a>(
        &self,
        this_value: This<'a>,
        cx: &mut JsScope<'a>,
        status: StatusInput<'a>,
        message: JsLocal<'a>,
    ) -> JsResult<This<'a>> {
        let (code, message) = match status {
            StatusInput::Code(code) => (StatusCode::from_api(code as u8), message),
            StatusInput::Name(b"ok") => (StatusCode::Ok, message),
            StatusInput::Name(b"error") => (StatusCode::Error, message),
            StatusInput::Status(StatusInit { code, message }) => {
                (StatusCode::from_api(code.unwrap_or(0.0) as u8), message)
            }
            StatusInput::Name(_) | StatusInput::Ignored(_) => (StatusCode::Unset, message),
        };
        self.put_status(cx.global(), code, message.to_js())?;
        Ok(this_value)
    }

    pub(crate) fn fail<'a>(
        &self,
        this_value: This<'a>,
        cx: &mut JsScope<'a>,
        error: JsLocal<'a>,
    ) -> JsResult<This<'a>> {
        if self.is_recording() {
            let description = engine::describe_error(cx.global(), error.to_js())?;
            self.record(|r| description.record(r));
        }
        Ok(this_value)
    }

    pub(crate) fn ok<'a>(&self, this_value: This<'a>) -> This<'a> {
        self.record(|r| r.set_status(StatusCode::Ok, b""));
        this_value
    }

    pub(crate) fn update_name<'a>(
        &self,
        this_value: This<'a>,
        cx: &mut JsScope<'a>,
        name: JsLocal<'a>,
    ) -> JsResult<This<'a>> {
        if self.is_recording() {
            let global = cx.global();
            let name = name.to_js().to_js_string(global)?.to_js();
            js::name_set_cached(this_value.to_js(), global, name);
        }
        Ok(this_value)
    }

    pub(crate) fn record_exception<'a>(
        &self,
        this_value: This<'a>,
        cx: &mut JsScope<'a>,
        exception: JsLocal<'a>,
        time: JsLocal<'a>,
    ) -> JsResult<This<'a>> {
        if self.is_recording() {
            let global = cx.global();
            let description = engine::describe_error(global, exception.to_js())?;
            let time = values::time_input(global, time.to_js());
            self.record(|r| description.with(|e| r.add_exception(e, time)));
        }
        Ok(this_value)
    }

    #[inline]
    pub(crate) fn is_recording(&self) -> bool {
        self.data().is_recording()
    }

    pub(crate) fn end<'a>(
        &self,
        this_value: This<'a>,
        heap: &JsHeap<'a>,
        end_time: Option<JsLocal<'a>>,
    ) {
        let global = global_of(heap);
        let end_ns = end_time.map_or(0, |time| values::time_input(global, time.to_js()));
        self.finish(global, this_value.to_js(), end_ns);
    }

    pub(crate) fn span_context<'a>(&self, this_value: This<'a>, heap: &JsHeap<'a>) -> JSValue {
        if let Some(context) = js::context_get_cached(this_value.to_js()) {
            return context;
        }
        let global = global_of(heap);
        let context = JSValue::create_empty_object(global, 5);
        context.put(global, "traceId", self.get_trace_id(heap).to_js());
        context.put(global, "spanId", self.get_span_id(heap).to_js());
        let flags = JSValue::js_number_from_int32(self.get_trace_flags().into());
        context.put(global, "traceFlags", flags);
        if self.get_is_remote() {
            context.put(global, "isRemote", JSValue::TRUE);
        }
        if !self.data().trace_state().is_empty() {
            let trace_state = TraceState::new(self.data().trace_state());
            context.put(global, "traceState", trace_state.into_js(heap).to_js());
        }
        js::context_set_cached(this_value.to_js(), global, context);
        context
    }

    pub(crate) fn enter<'a>(&self, this_value: This<'a>, heap: &JsHeap<'a>) -> This<'a> {
        let (global, span) = (global_of(heap), this_value.to_js());
        let mut above = Binding::of(&context::active_binding(global)).span();
        if above == Some(span) {
            return this_value;
        }
        // One that displaced this span, which has left since, must not lead back to it.
        while let Some(current) = above {
            above = Binding::of(&js::displaced_get_cached(current).filter(|b| !b.is_null())).span();
            if above == Some(span) && js::displaced_get_cached(span).is_none() {
                js::displaced_set_cached(current, global, JSValue::NULL);
                break;
            }
        }
        Span::enter_under(global, span, None);
        this_value
    }

    pub(crate) fn exit<'a>(&self, this_value: This<'a>, heap: &JsHeap<'a>) -> This<'a> {
        Span::leave(global_of(heap), this_value.to_js());
        this_value
    }

    pub(crate) fn dispose<'a>(&self, this_value: This<'a>, heap: &JsHeap<'a>) {
        Span::leave(global_of(heap), this_value.to_js());
        self.end(this_value, heap, None);
    }

    pub(crate) fn get_trace_id<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
        hex::<32>(heap, &self.data().stub.ctx.trace_id.0)
    }

    pub(crate) fn get_span_id<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
        hex::<16>(heap, &self.data().stub.ctx.span_id.0)
    }

    pub(crate) fn get_parent_span_id<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> Option<JsLocal<'a, JSString>> {
        let parent = self.data().stub.parent;
        parent.is_valid().then(|| hex::<16>(heap, &parent.0))
    }

    pub(crate) fn get_trace_flags(&self) -> u8 {
        self.data().stub.ctx.flags.w3c()
    }

    pub(crate) fn get_is_remote(&self) -> bool {
        self.data().stub.ctx.flags.remote()
    }

    pub(crate) fn get_name<'a>(&self, this_value: This<'a>, heap: &JsHeap<'a>) -> JSValue {
        js::name_get_cached(this_value.to_js())
            .unwrap_or_else(|| self.recorded_name(global_of(heap)))
    }

    pub(crate) fn get_kind(&self) -> u8 {
        self.data().stub.kind.to_api()
    }

    #[inline]
    pub(crate) fn get_ended(&self) -> bool {
        self.data().stub.ctx.flags.ended()
    }
}
