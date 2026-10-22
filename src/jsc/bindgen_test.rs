//! This namespace is used to test binding generator

use core::cell::{Cell, RefCell};
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::bindgen::{
    self, BufferSource, Callable, IntoError as _, JsBytes, JsHeap, JsLocal, JsPayload as _,
    JsScope, JsWrapper, JsWrapperStrong, PinnedBytes, StringOrJsBytes,
};
use crate::generated_bindgen::bindgen_test::{
    TestAnything, TestBare, TestChoice, TestColor, TestColorOrRest, TestFailure, TestFlag,
    TestNames, TestOptions, TestOptionsEcho, TestOuter, TestTextOrBytes, TestValue, js_TestCounter,
    js_TestRefCounted,
};
use crate::{JSString, JSValue, JsResult};
use bun_ptr::{AsCtxPtr as _, RefPtr};

// This example should be kept in sync with bindgen's documentation
pub(crate) fn add<'a>(heap: &JsHeap<'a>, a: i32, b: i32) -> bindgen::Result<'a, i32> {
    a.checked_add(b)
        .ok_or_else(|| heap.error(format_args!("Integer overflow while adding")))
}

pub(crate) fn required_and_optional_arg(a: bool, b: Option<usize>, c: i32, d: Option<u8>) -> i32 {
    let Some(b_nonnull) = b else {
        return 123456i32
            .wrapping_add(c)
            .wrapping_add(i32::from(d.unwrap_or(0)));
    };
    let inner: usize = b_nonnull
        .wrapping_add(c.unsigned_abs() as usize)
        .wrapping_mul(usize::from(d.unwrap_or(1)));
    // @truncate usize -> u53 (low 53 bits), widen to isize, then @truncate -> i32.
    let as_u53: u64 = (inner as u64) & ((1u64 << 53) - 1);
    let mut math_result: i32 = (as_u53 as isize) as i32;
    if a {
        math_result = -math_result;
    }
    math_result
}

pub(crate) fn utf8_echo(text: &[u8]) -> &[u8] {
    text
}

pub(crate) fn utf8_echo_loose(text: &[u8]) -> &[u8] {
    text
}

pub(crate) fn utf8_optional(text: Option<&[u8]>) -> Option<&[u8]> {
    text
}

pub(crate) fn utf8_owned(text: bun_core::Utf8Bytes<'static>) -> bun_core::Utf8Bytes<'static> {
    text
}

pub(crate) fn string_echo(text: &bun_core::String) -> bun_core::String {
    text.clone()
}

pub(crate) fn string_length(text: &bun_core::String) -> usize {
    text.length()
}

pub(crate) fn expected_by_node(text: &bun_core::String, data: Option<&[u8]>, flag: bool) -> usize {
    text.length() + data.map_or(0, <[u8]>::len) + usize::from(flag)
}

pub(crate) fn expected_message(data: &[u8], options: &TestFlag, more: &TestFlag) -> usize {
    data.len() + usize::from(options.flag) + usize::from(more.flag)
}

pub(crate) fn next_color(color: TestColor) -> TestColor {
    match color {
        TestColor::Red => TestColor::Green,
        TestColor::Green => TestColor::Blue,
        TestColor::Blue => TestColor::Red,
    }
}

pub(crate) fn options_echo<'a>(_: &JsHeap<'a>, options: &TestOptions<'a>) -> TestOptionsEcho<'a> {
    TestOptionsEcho {
        count: options.count,
        flag: options.flag,
        name: options.name.map(<[u8]>::to_vec),
        color: options.color,
        ratio: options.ratio,
        payload: options.payload,
        renamed: options.renamed,
    }
}

pub(crate) fn describe_value(value: TestValue<'_>) -> Vec<u8> {
    match value {
        TestValue::Number(number) => format!("number {number}").into_bytes(),
        TestValue::Flag(flag) => format!("flag {flag}").into_bytes(),
        TestValue::Text(text) => [b"text ", text].concat(),
        TestValue::List(list) => format!("list {list:?}").into_bytes(),
    }
}

pub(crate) fn describe_anything<'a>(cx: &mut JsScope<'a>, value: TestAnything<'a>) -> Vec<u8> {
    match value {
        TestAnything::Nothing => b"nothing".to_vec(),
        TestAnything::Flag(flag) => format!("flag {flag}").into_bytes(),
        TestAnything::Integer(integer) => format!("integer {integer}").into_bytes(),
        TestAnything::Text(text) => format!("text {text}").into_bytes(),
        TestAnything::Bytes(buffer) => {
            // SAFETY: `buffer` holds a ref on it, and nothing else borrows it here.
            let buffer: crate::ArrayBuffer = unsafe { (*buffer.get()).as_array_buffer() };
            format!("bytes {}", buffer.byte_slice().len()).into_bytes()
        }
        TestAnything::Blob(_) => b"blob".to_vec(),
        TestAnything::Counter(counter) => {
            let count = counter.with(&cx.payloads, |counter| counter.count);
            format!("counter {count}").into_bytes()
        }
        TestAnything::Token(token) => {
            let id = token.with(&cx.payloads, |token| token.id);
            format!("token {id}").into_bytes()
        }
        TestAnything::List(list) => format!("list {list:?}").into_bytes(),
        TestAnything::Options(options) => format!("options {}", options.count).into_bytes(),
    }
}

pub(crate) fn describe_defaults<'a>(heap: &JsHeap<'a>, options: &TestOuter<'a>) -> Vec<u8> {
    let inner = match &options.inner {
        Some(inner) => {
            let name = bstr::BStr::new(inner.name);
            format!("a={} b={} name={name}", inner.a, inner.b)
        }
        None => "none".to_owned(),
    };
    let value = if options.value.is_undefined() {
        "undefined"
    } else {
        "given"
    };
    let choice = match options.choice {
        TestChoice::None => "none".to_owned(),
        TestChoice::Flag(flag) => flag.to_string(),
    };
    let rest = match options.rest {
        TestColorOrRest::Color(color) => format!("{color:?}"),
        TestColorOrRest::Bytes(bytes) => bytes.with_bytes(heap, |bytes| format!("{bytes:?}")),
        TestColorOrRest::Rest(rest) if rest.is_undefined() => "undefined".to_owned(),
        TestColorOrRest::Rest(_) => "given".to_owned(),
    };
    let counter = options.counter.is_some();
    format!("inner: {inner}; value: {value}; choice: {choice}; rest: {rest}; counter: {counter}")
        .into_bytes()
}

pub(crate) fn overloaded_text_times(text: &[u8], times: u32) -> Vec<u8> {
    [b"text times ", text.repeat(times as usize).as_slice()].concat()
}

pub(crate) fn overloaded_text_upper(text: &[u8], upper: bool) -> Vec<u8> {
    let text = if upper {
        text.to_ascii_uppercase()
    } else {
        text.to_vec()
    };
    [b"text upper ", text.as_slice()].concat()
}

pub(crate) fn overloaded_two_numbers(a: f64, b: f64) -> Vec<u8> {
    format!("two numbers {a} {b}").into_bytes()
}

pub(crate) fn overloaded_number(number: f64) -> Vec<u8> {
    format!("number {number}").into_bytes()
}

pub(crate) fn overloaded_list(list: Vec<f64>) -> Vec<u8> {
    format!("list {:?}", list.into_boxed_slice()).into_bytes()
}

pub(crate) fn overloaded_counter<'a>(
    cx: &mut JsScope<'a>,
    counter: JsWrapper<'a, TestCounter>,
) -> Vec<u8> {
    let count = counter.with(&cx.payloads, |counter| counter.count);
    format!("counter {count}").into_bytes()
}

pub(crate) fn sum_array(numbers: Vec<i32>) -> f64 {
    numbers
        .into_iter()
        .fold(0.0, |sum, number| sum + f64::from(number))
}

pub(crate) fn range(length: u32) -> core::ops::Range<u32> {
    0..length
}

pub(crate) fn names(text: &[u8]) -> TestNames {
    let all: Vec<Vec<u8>> = words(text).map(<[u8]>::to_vec).collect();
    TestNames {
        first: all.first().cloned().unwrap_or_default(),
        nickname: all.get(1).cloned(),
        all,
    }
}

pub(crate) fn bare(id: u32) -> TestBare {
    TestBare { id, label: None }
}

pub(crate) fn date_of(time: f64) -> f64 {
    time
}

pub(crate) fn latin1<'a>(heap: &JsHeap<'a>, bytes: &[u8]) -> JsLocal<'a, JSString> {
    heap.create_latin1_string(bytes)
}

pub(crate) fn text_or_bytes<'a>(
    heap: &JsHeap<'a>,
    text: &[u8],
    r#as: u8,
) -> bindgen::Result<'a, TestTextOrBytes<'a>> {
    Ok(match r#as {
        0 => TestTextOrBytes::Text(text.to_vec()),
        1 => TestTextOrBytes::Bytes(heap.create_uint8_array(text)?),
        _ => TestTextOrBytes::Nothing,
    })
}

pub(crate) fn positions(text: &[u8]) -> impl Iterator<Item = (&[u8], usize)> {
    words(text).zip(0..)
}

pub(crate) fn words(text: &[u8]) -> impl Iterator<Item = &[u8]> {
    bun_core::strings::tokenize(text, b" ")
}

fn sum(bytes: &[u8]) -> u32 {
    bytes.iter().map(|&byte| u32::from(byte)).sum()
}

pub(crate) fn sum_bytes(bytes: &[u8]) -> u32 {
    sum(bytes)
}

pub(crate) fn sum_bytes_then_text(bytes: &[u8], text: &[u8]) -> u32 {
    sum(bytes) + sum(text)
}

pub(crate) fn fill_buffer<'a>(
    heap: &JsHeap<'a>,
    buffer: JsLocal<'a, BufferSource>,
    value: u8,
) -> usize {
    // SAFETY: no other argument has bytes.
    unsafe {
        buffer.with_bytes_mut(heap, |bytes| {
            bytes.fill(value);
            bytes.len()
        })
    }
}

pub(crate) fn sum_bytes_if_any(bytes: Option<&[u8]>, _: &[u8]) -> i32 {
    bytes.map_or(-1, |bytes| sum(bytes) as i32)
}

pub(crate) fn string_or_object_echo(text: &bun_core::String) -> bun_core::String {
    text.clone()
}

pub(crate) fn sum_before_and_after_callback<'a>(
    cx: &mut JsScope<'a>,
    buffer: JsLocal<'a, BufferSource>,
    callback: JsLocal<'a, Callable>,
) -> bindgen::Result<'a, [u32; 2]> {
    let before = buffer.with_bytes(&cx.heap, sum);
    callback.call(cx, JsLocal::UNDEFINED, &[])?;
    Ok([before, buffer.with_bytes(&cx.heap, sum)])
}

pub(crate) fn bytes_of(data: &[u8]) -> Vec<u8> {
    data.to_vec()
}

pub(crate) fn bytes_of_then(data: &[u8], _: f64) -> Vec<u8> {
    data.to_vec()
}

pub(crate) fn bytes_of_then_copied(data: Vec<u8>, _: f64) -> Vec<u8> {
    data
}

pub(crate) fn call_or<'a>(
    cx: &mut JsScope<'a>,
    callback: Option<JsLocal<'a, Callable>>,
    fallback: JsLocal<'a>,
) -> bindgen::Result<'a, JsLocal<'a>> {
    match callback {
        Some(callback) => Ok(callback.call(cx, JsLocal::UNDEFINED, &[])?),
        None => Ok(fallback),
    }
}

pub(crate) fn bytes_before_and_after_callback<'a>(
    cx: &mut JsScope<'a>,
    data: JsBytes<'a>,
    callback: JsLocal<'a, Callable>,
) -> bindgen::Result<'a, [Vec<u8>; 2]> {
    let before = data.get(&cx.heap).to_vec();
    callback.call(cx, JsLocal::UNDEFINED, &[])?;
    Ok([before, data.get(&cx.heap).to_vec()])
}

pub(crate) fn pinned_bytes_after_callback<'a>(
    cx: &mut JsScope<'a>,
    data: PinnedBytes,
    callback: JsLocal<'a, Callable>,
) -> bindgen::Result<'a, Vec<u8>> {
    callback.call(cx, JsLocal::UNDEFINED, &[])?;
    let (bytes, data) = std::thread::scope(|scope| {
        scope
            .spawn(move || (data.to_vec(), data))
            .join()
            .expect("the thread does not panic")
    });
    drop(data);
    Ok(bytes)
}

pub(crate) fn string_as_is_or_bytes<'a>(heap: &JsHeap<'a>, data: StringOrJsBytes<'a>) -> Vec<u8> {
    match data {
        StringOrJsBytes::Bytes(bytes) => [&[0], bytes.get(heap)].concat(),
        StringOrJsBytes::String(text) if text.is_8bit() => [&[1], text.latin1()].concat(),
        StringOrJsBytes::String(text) => [&[2], bytemuck::cast_slice(text.utf16())].concat(),
    }
}

pub(crate) fn string_as_is_or_bytes_if_any<'a>(
    heap: &JsHeap<'a>,
    data: Option<StringOrJsBytes<'a>>,
) -> Option<Vec<u8>> {
    data.map(|data| string_as_is_or_bytes(heap, data))
}

pub(crate) fn present_unless_empty_string(
    number: Option<f64>,
    value: Option<JsLocal<'_>>,
) -> [bool; 2] {
    [number.is_some(), value.is_some()]
}

pub(crate) fn bytes_of_are_same_memory(data: &[u8], again: &[u8]) -> bool {
    core::ptr::eq(data, again)
}

pub(crate) fn as_big_int(value: u64) -> u64 {
    value
}

pub(crate) fn fail<'a>(
    heap: &JsHeap<'a>,
    how: TestFailure,
    value: JsLocal<'a>,
) -> bindgen::Result<'a, ()> {
    Err(match how {
        TestFailure::Type => heap.type_error(format_args!("a type error")),
        TestFailure::Range => heap.range_error(format_args!("a range error")),
        TestFailure::Plain => heap.error(format_args!("an error")),
        TestFailure::Code => heap.error_with_code(
            crate::ErrorCode::INVALID_ARG_VALUE,
            format_args!("an error with a code"),
        ),
        TestFailure::OutOfMemory => bun_alloc::AllocError.into(),
        TestFailure::Syscall => {
            bun_sys::Error::from_code(bun_sys::E::ENOENT, bun_sys::Tag::open).into_error(heap)
        }
        TestFailure::Value => bindgen::Error::from_value(value),
    })
}

static ALIVE: AtomicUsize = AtomicUsize::new(0);

pub(crate) struct TestCounter {
    count: i32,
    label: Vec<u8>,
}

impl TestCounter {
    fn new(count: i32) -> Self {
        ALIVE.fetch_add(1, Ordering::SeqCst);
        TestCounter {
            count,
            label: Vec::new(),
        }
    }
}

impl Drop for TestCounter {
    fn drop(&mut self) {
        ALIVE.fetch_sub(1, Ordering::SeqCst);
    }
}

impl TestCounter {
    pub(crate) fn constructor<'a>(heap: &JsHeap<'a>, start: i32) -> bindgen::Result<'a, Self> {
        if start < 0 {
            return Err(heap.range_error(format_args!("start must not be negative")));
        }
        Ok(Self::new(start))
    }

    pub(crate) fn get_count(&self) -> i32 {
        self.count
    }

    pub(crate) fn get_label(&self) -> impl AsRef<[u8]> {
        &self.label
    }

    pub(crate) fn set_label<'a>(&mut self, value: &'a [u8]) {
        self.label = value.to_vec();
    }

    pub(crate) fn get_tag<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        bindgen::to_js::array(heap, [self.count], bindgen::to_js::i32)
    }

    pub(crate) fn get_same_tag<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        self.get_tag(heap)
    }

    pub(crate) fn increment(&mut self, by: i32) -> i32 {
        self.count = self.count.wrapping_add(by);
        self.count
    }

    pub(crate) fn add_length<'a>(&mut self, text: &'a [u8], times: i32) -> i32 {
        self.increment((text.len() as i32).wrapping_mul(times))
    }

    pub(crate) fn add_number(&mut self, by: i32) -> i32 {
        self.increment(by)
    }

    pub(crate) fn forget_tag<'a>(&self, this_value: JsWrapper<'a, Self>, heap: &JsHeap<'a>) {
        // SAFETY: storing a value runs no JavaScript.
        js_TestCounter::tag_set_cached(this_value.to_js(), unsafe { heap.global() }, JSValue::ZERO);
    }

    pub(crate) fn listen<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        listener: JsLocal<'a>,
    ) {
        // SAFETY: storing a value runs no JavaScript.
        js_TestCounter::listener_set_cached(
            this_value.to_js(),
            unsafe { heap.global() },
            listener.to_js(),
        );
    }

    pub(crate) fn notify<'a>(
        this: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> bindgen::Result<'a, i32> {
        if let Some(listener) = js_TestCounter::listener_get_cached(this.to_js())
            && let Some(listener) = JsLocal::new(&cx.heap, listener).as_callable()
        {
            listener.call(cx, this.as_value(), &[])?;
        }
        Ok(this.with(&cx.payloads, |counter| counter.count))
    }

    pub(crate) fn plus<'a>(
        this: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        other: JsWrapper<'a, Self>,
    ) -> i32 {
        let other = other.with(&cx.payloads, |counter| counter.count);
        this.with(&cx.payloads, |counter| counter.count.wrapping_add(other))
    }

    pub(crate) fn starting<'a>(heap: &JsHeap<'a>, at: i32) -> JsWrapper<'a, Self> {
        Self::new(at).into_js(heap)
    }

    pub(crate) fn alive() -> usize {
        ALIVE.load(Ordering::SeqCst)
    }

    pub(crate) fn get_static_count() -> usize {
        Self::alive()
    }

    pub(crate) fn get_limit<'a>(heap: &JsHeap<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        Err(heap.range_error(format_args!("there is no limit")))
    }
}

pub(crate) struct TestHolder {
    counter: JsWrapperStrong<TestCounter>,
}

impl TestHolder {
    pub(crate) fn constructor<'a>(heap: &JsHeap<'a>, counter: JsWrapper<'a, TestCounter>) -> Self {
        TestHolder {
            counter: counter.to_strong(heap),
        }
    }

    pub(crate) fn get_counter<'a>(&self, heap: &JsHeap<'a>) -> JsWrapper<'a, TestCounter> {
        self.counter.get(heap)
    }

    pub(crate) fn increment_counter<'a>(this: JsWrapper<'a, Self>, cx: &mut JsScope<'a>) -> i32 {
        let counter = this.with(&cx.payloads, |holder| holder.counter.get(&cx.heap));
        counter.with_mut(&mut cx.payloads, |counter| counter.increment(1))
    }
}

static REF_COUNTED_ALIVE: AtomicUsize = AtomicUsize::new(0);
thread_local! {
    static KEPT: RefCell<Option<RefPtr<TestRefCounted>>> = const { RefCell::new(None) };
}

/// `TestRefCounted`, declared in `bindgen_test.bind.ts`.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct TestRefCounted {
    ref_count: Cell<u32>,
    value: Cell<i32>,
    finalized: Cell<bool>,
}

impl Drop for TestRefCounted {
    fn drop(&mut self) {
        REF_COUNTED_ALIVE.fetch_sub(1, Ordering::SeqCst);
    }
}

impl TestRefCounted {
    pub(crate) fn finalize(&self) {
        self.finalized.set(true);
    }

    pub(crate) fn constructor(value: i32) -> *mut Self {
        REF_COUNTED_ALIVE.fetch_add(1, Ordering::SeqCst);
        bun_core::heap::into_raw(Box::new(TestRefCounted {
            ref_count: Cell::new(1),
            value: Cell::new(value),
            finalized: Cell::new(false),
        }))
    }

    pub(crate) fn get_value(&self) -> i32 {
        self.value.get()
    }

    pub(crate) fn set_value(&self, value: i32) {
        self.value.set(value);
    }

    pub(crate) fn get_listener(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        js_TestRefCounted::listener_get_cached(this_value.to_js()).unwrap_or(JSValue::UNDEFINED)
    }

    pub(crate) fn set_listener(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
    ) {
        js_TestRefCounted::listener_set_cached(this_value.to_js(), cx.global(), value.to_js());
    }

    pub(crate) fn notify(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<i32> {
        if let Some(listener) = js_TestRefCounted::listener_get_cached(this_value.to_js())
            && listener.is_callable()
        {
            listener.call(cx.global(), this_value.to_js(), &[])?;
        }
        Ok(self.value.get())
    }

    pub(crate) fn keep(&self) {
        // SAFETY: `self` is live.
        KEPT.set(Some(unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }));
    }

    pub(crate) fn dispose(&self) {
        self.value.set(-1);
    }

    pub(crate) fn or_undefined<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
    ) -> Option<JsWrapper<'a, Self>> {
        (self.value.get() >= 0).then_some(this_value)
    }

    pub(crate) fn is_same(&self, other: Option<&Self>) -> bool {
        other.is_some_and(|other| core::ptr::eq(self, other))
    }

    pub(crate) fn kept() -> Vec<i32> {
        KEPT.with_borrow(|kept| match kept {
            Some(kept) => vec![kept.value.get(), i32::from(kept.finalized.get())],
            None => Vec::new(),
        })
    }

    pub(crate) fn release() {
        KEPT.set(None);
    }

    pub(crate) fn alive() -> usize {
        REF_COUNTED_ALIVE.load(Ordering::SeqCst)
    }

    pub(crate) fn value_from_js(object: JsLocal<'_>) -> Option<i32> {
        Some(object.to_js().as_class_ref::<Self>()?.value.get())
    }
}

pub(crate) struct TestToken {
    id: u32,
}

impl TestToken {
    pub(crate) fn get_id(&self) -> u32 {
        self.id
    }
}

pub(crate) fn make_token<'a>(heap: &JsHeap<'a>, id: u32) -> JsWrapper<'a, TestToken> {
    TestToken { id }.into_js(heap)
}

pub(crate) fn integer_or_big_int(value: u32) -> u32 {
    value
}

pub(crate) fn loose_integer(value: u16) -> u16 {
    value
}

pub(crate) fn loose_integer_or_big_int(value: u16) -> u16 {
    value
}

pub(crate) fn loose_double_or_big_int(value: f64) -> f64 {
    value
}

pub(crate) fn wide_integer_or_big_int(value: u64) -> String {
    value.to_string()
}
