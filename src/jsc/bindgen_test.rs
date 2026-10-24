//! This namespace is used to test binding generator

use core::cell::{Cell, RefCell};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicI32, AtomicUsize, Ordering};

use crate::bindgen::{
    self, BufferSource, Callable, IntoError as _, JsBytes, JsHeap, JsLocal, JsPayload as _,
    JsScope, JsStructure, JsWrapper, PinnedBytes, StringOrJsBytes,
};
use crate::generated_bindgen::bindgen_test::{
    Bun__BindgenTest__doubled, TestAbsence, TestAnything, TestBare, TestBareOptions, TestBracket,
    TestChoice, TestColor, TestColorOrRest, TestFailure, TestFlag, TestHandle, TestNames,
    TestNodeOptions, TestObjectOrRest, TestOptions, TestOptionsEcho, TestOtherAsNullOptions,
    TestOuter, TestTextOrBytes, TestValue, js_TestCounter, js_TestError, js_TestMemberFunctions,
    js_TestNonFinal, js_TestNote, js_TestRefCounted, js_TestRefCountedNote,
};
use crate::{JSGlobalObject, JSString, JSValue, JsClass, JsResult};
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

fn copy_of(text: &bun_core::String) -> bun_core::String {
    if text.is_utf16() {
        bun_core::String::clone_utf16(text.utf16())
    } else {
        bun_core::String::clone_latin1(text.latin1())
    }
}

pub(crate) fn string_view_echo(text: &bun_core::StringView<'_>) -> bun_core::String {
    copy_of(text)
}

pub(crate) fn string_or_object_view_echo(
    text: Option<bun_core::StringView<'_>>,
) -> Option<bun_core::String> {
    text.map(|text| copy_of(&text))
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

pub(crate) fn describe_anything(value: TestAnything<'_>) -> Vec<u8> {
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
        TestAnything::Counter(counter) => format!("counter {}", counter.count.get()).into_bytes(),
        TestAnything::Token(token) => format!("token {}", token.id).into_bytes(),
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
    format!("inner: {inner}; value: {value}; choice: {choice}; rest: {rest}").into_bytes()
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

pub(crate) fn overloaded_counter(counter: &TestCounter) -> Vec<u8> {
    format!("counter {}", counter.count.get()).into_bytes()
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
    count: Cell<i32>,
    label: RefCell<Vec<u8>>,
}

impl TestCounter {
    fn new(count: i32) -> Self {
        ALIVE.fetch_add(1, Ordering::SeqCst);
        TestCounter {
            count: Cell::new(count),
            label: RefCell::default(),
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
        self.count.get()
    }

    pub(crate) fn get_label(&self) -> Vec<u8> {
        self.label.borrow().clone()
    }

    pub(crate) fn set_label(&self, value: &[u8]) {
        *self.label.borrow_mut() = value.to_vec();
    }

    pub(crate) fn get_tag<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        bindgen::to_js::array(heap, [self.count.get()], bindgen::to_js::i32)
    }

    pub(crate) fn get_same_tag<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        self.get_tag(heap)
    }

    pub(crate) fn increment(&self, by: i32) -> i32 {
        self.count.set(self.count.get().wrapping_add(by));
        self.count.get()
    }

    pub(crate) fn add_length(&self, text: &[u8], times: i32) -> i32 {
        self.increment((text.len() as i32).wrapping_mul(times))
    }

    pub(crate) fn add_number(&self, by: i32) -> i32 {
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
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> bindgen::Result<'a, i32> {
        if let Some(listener) = js_TestCounter::listener_get_cached(this_value.to_js())
            && let Some(listener) = JsLocal::new(&cx.heap, listener).as_callable()
        {
            listener.call(cx, this_value.as_value(), &[])?;
        }
        Ok(self.count.get())
    }

    pub(crate) fn plus(&self, other: &Self) -> i32 {
        self.count.get().wrapping_add(other.count.get())
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

pub(crate) struct TestMutates {
    count: i32,
    label: Vec<u8>,
}

impl TestMutates {
    pub(crate) fn constructor(count: i32) -> Self {
        TestMutates {
            count,
            label: Vec::new(),
        }
    }

    pub(crate) fn get_count(&self) -> i32 {
        self.count
    }

    pub(crate) fn get_label(&self) -> impl AsRef<[u8]> {
        &self.label
    }

    pub(crate) fn set_label(&mut self, value: &[u8]) {
        self.label = value.to_vec();
    }

    pub(crate) fn increment(&mut self, by: i32) -> i32 {
        self.count = self.count.wrapping_add(by);
        self.count
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

pub(crate) struct TestNote {
    size: usize,
}

impl TestNote {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: JsStructure<'a, Self>,
        text: JsLocal<'a>,
        size: usize,
    ) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        if text.is_undefined() {
            return Err(heap.type_error(format_args!("text is required")));
        }
        let this_value = structure.create(heap, Self { size });
        // SAFETY: storing a value runs no JavaScript.
        js_TestNote::text_set_cached(this_value.to_js(), unsafe { heap.global() }, text.to_js());
        Ok(this_value)
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.size
    }

    /// One more than `estimated_size`, to tell which of the two a heap snapshot reads.
    pub(crate) fn memory_cost(&self) -> usize {
        self.size + 1
    }
}

#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct TestRefCountedNote {
    ref_count: Cell<u32>,
    size: usize,
}

impl TestRefCountedNote {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: JsStructure<'a, Self>,
        text: JsLocal<'a>,
        size: usize,
    ) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        if text.is_undefined() {
            return Err(heap.type_error(format_args!("text is required")));
        }
        let ref_count = Cell::new(1);
        let this_value = structure.create(heap, RefPtr::new(Self { ref_count, size }));
        // SAFETY: storing a value runs no JavaScript.
        let global = unsafe { heap.global() };
        js_TestRefCountedNote::text_set_cached(this_value.to_js(), global, text.to_js());
        Ok(this_value)
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.size
    }
}

pub(crate) struct TestBoundThis {
    value: i32,
    labels: Cell<u32>,
}

impl TestBoundThis {
    pub(crate) fn constructor(value: i32) -> Self {
        Self {
            value,
            labels: Cell::new(0),
        }
    }

    pub(crate) fn get_value(&self) -> i32 {
        self.value
    }

    pub(crate) fn get_label(&self) -> bun_core::String {
        self.labels.set(self.labels.get() + 1);
        let label = format!("label {} of {}", self.labels.get(), self.value);
        bun_core::String::clone_utf8(label.as_bytes())
    }

    pub(crate) fn plus(&self, other: i32) -> i32 {
        self.value.wrapping_add(other)
    }
}

#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct TestNonFinal {
    ref_count: Cell<u32>,
    value: i32,
}

pub(crate) trait TestNonFinalExt {
    fn constructor(value: i32) -> *mut Self;
    fn get_value(&self) -> i32;
    fn doubled<'a>(heap: &JsHeap<'a>, value: i32) -> JsLocal<'a>;
}

impl TestNonFinalExt for TestNonFinal {
    fn constructor(value: i32) -> *mut Self {
        let ref_count = Cell::new(1);
        RefPtr::new(Self { ref_count, value }).into_raw()
    }

    fn get_value(&self) -> i32 {
        self.value
    }

    fn doubled<'a>(heap: &JsHeap<'a>, value: i32) -> JsLocal<'a> {
        let ref_count = Cell::new(1);
        // SAFETY: making the object runs no JavaScript.
        JsLocal::new(
            heap,
            Self { ref_count, value }.to_js(unsafe { heap.global() }),
        )
    }
}

impl JsClass for TestNonFinal {
    fn to_js(mut self, global: &JSGlobalObject) -> JSValue {
        self.value = self.value.wrapping_mul(2);
        js_TestNonFinal::to_js(RefPtr::new(self).into_raw(), global)
    }

    fn from_js(value: JSValue) -> Option<*mut Self> {
        js_TestNonFinal::from_js(value).map(NonNull::as_ptr)
    }

    fn from_js_direct(value: JSValue) -> Option<*mut Self> {
        js_TestNonFinal::from_js_direct(value).map(NonNull::as_ptr)
    }
}

pub(crate) fn token_id_from_js(token: JsLocal<'_>) -> Option<u32> {
    Some(token.to_js().as_class_ref::<TestToken>()?.id)
}

pub(crate) fn is_note_from_js_direct(note: JsLocal<'_>) -> bool {
    let note = note.to_js();
    note.is_cell()
        && (note.as_direct::<TestNote>().is_some()
            || note.as_direct::<TestRefCountedNote>().is_some())
}

pub(crate) fn error_constructor<'a>(cx: &mut JsScope<'a>) -> JsLocal<'a> {
    let constructor = js_TestError::get_constructor(cx.global());
    JsLocal::new(&cx.heap, constructor)
}

pub(crate) fn after_first<'a>(
    heap: &JsHeap<'a>,
    _: JsLocal<'a>,
    rest: &'a [JsLocal<'a>],
) -> bindgen::Result<'a, JsLocal<'a>> {
    bindgen::to_js::array(heap, rest.iter().copied(), bindgen::to_js::any)
}

pub(crate) fn this_and_callee<'a>(
    heap: &JsHeap<'a>,
    this_value: JsLocal<'a>,
    callee: JsLocal<'a>,
    value: JsLocal<'a>,
) -> bindgen::Result<'a, JsLocal<'a>> {
    bindgen::to_js::array(heap, [this_value, callee, value], bindgen::to_js::any)
}

pub(crate) fn doubled(value: i32) -> i32 {
    value.wrapping_mul(2)
}

pub(crate) fn make_doubled(cx: &mut JsScope<'_>) -> JSValue {
    crate::JSFunction::create(
        cx.global(),
        "doubled",
        Bun__BindgenTest__doubled,
        1,
        Default::default(),
    )
}

static PROMISE_CONTEXT: AtomicI32 = AtomicI32::new(42);

pub(crate) fn promise_ptr_context(_: &JsHeap<'_>) -> JSValue {
    JSValue::from_ptr_address(PROMISE_CONTEXT.as_ptr() as usize)
}

pub(crate) fn read_promise_ptr(context: *mut AtomicI32) -> i32 {
    // SAFETY: `promise_ptr_context` made it of a static.
    unsafe { &*context }.load(Ordering::Relaxed)
}

pub(crate) fn make_native_promise_context(cx: &mut JsScope<'_>) -> JSValue {
    unsafe extern "C" {
        safe fn Bun__NativePromiseContext__create(
            global: &JSGlobalObject,
            ctx: *mut core::ffi::c_void,
            tag: u8,
            held: JSValue,
        ) -> JSValue;
    }
    // Only the destructor of a cell that still has its pointer reads the tag, and the test takes the pointer.
    Bun__NativePromiseContext__create(
        cx.global(),
        PROMISE_CONTEXT.as_ptr().cast(),
        0,
        JSValue::ZERO,
    )
}

pub(crate) fn read_native_promise_context(context: Option<NonNull<AtomicI32>>) -> Option<i32> {
    // SAFETY: `make_native_promise_context` made the cell of a static.
    context.map(|context| unsafe { context.as_ref() }.load(Ordering::Relaxed))
}

pub(crate) fn primes() -> [u32; 3] {
    [2, 3, 5]
}

pub(crate) fn increment(value: i32) -> i32 {
    value.wrapping_add(1)
}

pub(crate) fn decrement(value: i32) -> i32 {
    value.wrapping_sub(1)
}

pub(crate) fn negate_number(value: f64) -> f64 {
    -value
}

pub(crate) fn negate_flag(value: bool) -> bool {
    !value
}

pub(crate) fn node_options_size(options: &TestNodeOptions) -> Option<u32> {
    options.size.filter(|_| !options.flag)
}

pub(crate) fn bare_options_size(options: &TestBareOptions) -> Option<u32> {
    options.size
}

pub(crate) fn time_value(time: f64) -> f64 {
    time
}

pub(crate) fn text_if_passed(text: Option<&[u8]>) -> &[u8] {
    text.unwrap_or(b"none")
}

pub(crate) fn is_passed(_: JsLocal<'_>, second: Option<JsLocal<'_>>) -> bool {
    second.is_some()
}

pub(crate) fn length_with_value<'a>(
    heap: &JsHeap<'a>,
    (text, value): (&[u8], JsLocal<'a>),
) -> bindgen::Result<'a, JsLocal<'a>> {
    let length = bindgen::to_js::usize(heap, text.len())?;
    bindgen::to_js::array(heap, [length, value], bindgen::to_js::any)
}

pub(crate) fn counter_with_value<'a>(
    _: &JsHeap<'a>,
    (counter, value): (&TestCounter, JsLocal<'a>),
) -> JsLocal<'a> {
    counter.count.set(counter.count.get() + 1);
    value
}

pub(crate) fn kept_string(text: bun_core::String) -> bun_core::String {
    text
}

pub(crate) fn bracket_echo(bracket: TestBracket) -> TestBracket {
    bracket
}

pub(crate) fn describe_handle(value: TestHandle<'_>) -> Vec<u8> {
    match value {
        TestHandle::Missing => b"missing".to_vec(),
        TestHandle::Nothing => b"nothing".to_vec(),
        TestHandle::Callback(_) => b"callback".to_vec(),
        TestHandle::List(_) => b"list".to_vec(),
        TestHandle::Point(point) => format!("point {}", point.x).into_bytes(),
        TestHandle::Text(text) => [b"text ", text].concat(),
    }
}

pub(crate) fn is_object(value: TestObjectOrRest<'_>) -> bool {
    matches!(value, TestObjectOrRest::Object(_))
}

pub(crate) fn object_echo<'a>(
    _: &JsHeap<'a>,
    value: JsLocal<'a, crate::JSObject>,
) -> JsLocal<'a, crate::JSObject> {
    value
}

pub(crate) fn absence_echo(value: TestAbsence) -> TestAbsence {
    value
}

pub(crate) fn present_arguments(
    number: Option<f64>,
    text: Option<&[u8]>,
    callback: Option<JsLocal<'_, Callable>>,
    object: Option<JsLocal<'_, crate::JSObject>>,
    numbers: Option<Vec<f64>>,
    counter: Option<&TestCounter>,
    options: Option<&TestOtherAsNullOptions<'_>>,
) -> Vec<bun_core::String> {
    let members = options.map(|options| (options.size, options.callback));
    let (size, callback_member) = members.unwrap_or((None, None));
    [
        ("number", number.is_some()),
        ("text", text.is_some()),
        ("callback", callback.is_some()),
        ("object", object.is_some()),
        ("numbers", numbers.map(drop).is_some()),
        ("counter", counter.is_some()),
        ("options", members.is_some()),
        ("options.size", size.is_some()),
        ("options.callback", callback_member.is_some()),
    ]
    .into_iter()
    .filter(|(_, is_present)| *is_present)
    .map(|(name, _)| bun_core::String::static_(name))
    .collect()
}

pub(crate) fn callback_or_delay_callback(
    this_value: JsLocal<'_>,
    callee: JsLocal<'_>,
    callback: JsLocal<'_, Callable>,
) -> Vec<u8> {
    format!(
        "callback, this is undefined: {}, given itself: {}",
        this_value.is_undefined(),
        callee.to_js() == callback.to_js()
    )
    .into_bytes()
}

pub(crate) fn callback_or_delay_delay(
    this_value: JsLocal<'_>,
    _: JsLocal<'_>,
    delay: f64,
) -> Vec<u8> {
    format!(
        "delay {delay}, this is undefined: {}",
        this_value.is_undefined()
    )
    .into_bytes()
}

pub(crate) fn finite_later(cx: &mut JsScope<'_>, value: f64) -> JsResult<JSValue> {
    let global = cx.global();
    if !value.is_finite() {
        return Err(global.throw_invalid_arguments(format_args!("value must be finite")));
    }
    Ok(crate::JSPromise::resolved_promise_value(
        global,
        JSValue::js_number(value),
    ))
}

pub(crate) struct TestReadOnly;

impl TestReadOnly {
    pub(crate) fn constructor() -> Self {
        Self
    }

    pub(crate) fn answer(&self) -> i32 {
        42
    }

    pub(crate) fn dispose(&self) {}
}

#[derive(Default)]
pub(crate) struct TestMemberFunctions {
    call_count: Cell<u32>,
}

impl TestMemberFunctions {
    pub(crate) fn constructor() -> Self {
        Self::default()
    }

    pub(crate) fn twice(&self, n: i32) -> i32 {
        self.call_count.set(self.call_count.get() + 1);
        n * 2
    }

    pub(crate) fn run<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        n: JsLocal<'a>,
        fail: bool,
    ) -> JsResult<JSValue> {
        js_TestMemberFunctions::run_in_cpp(this_value.to_js(), cx.global(), n.to_js(), fail)
    }

    pub(crate) fn set_note<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        _: &JsHeap<'a>,
        value: JsLocal<'a>,
    ) -> JSValue {
        js_TestMemberFunctions::set_note_in_cpp(this_value.to_js(), value.to_js());
        js_TestMemberFunctions::note_in_cpp(this_value.to_js())
    }

    pub(crate) fn fail<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> JsResult<()> {
        js_TestMemberFunctions::fail_in_cpp(this_value.to_js(), cx.global())
    }

    pub(crate) fn promise<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> JSValue {
        js_TestMemberFunctions::promise_in_cpp(this_value.to_js(), cx.global())
    }

    pub(crate) fn call_count(&self) -> u32 {
        self.call_count.get()
    }

    pub(crate) fn sum(&self, bytes: &[u8]) -> u32 {
        bytes.iter().map(|&byte| u32::from(byte)).sum()
    }

    pub(crate) fn fail_in_rust<'a>(&self, heap: &JsHeap<'a>) -> Result<(), bindgen::Error<'a>> {
        Err(heap.range_error(format_args!("thrown in Rust")))
    }
}

pub(crate) struct TestError {
    code: i32,
}

static ERROR_LEVEL: AtomicI32 = AtomicI32::new(0);

impl TestError {
    pub(crate) fn constructor(code: i32) -> Self {
        Self { code }
    }

    pub(crate) fn call<'a>(heap: &JsHeap<'a>, codes: &[JsLocal<'a>]) -> JsWrapper<'a, Self> {
        let code = codes.iter().map(|code| code.to_js().to_int32()).sum();
        Self { code }.into_js(heap)
    }

    pub(crate) fn get_code(&self) -> i32 {
        self.code
    }

    pub(crate) fn get_non_configurable_code(&self) -> i32 {
        self.code
    }

    pub(crate) fn get_enumerable_code(&self) -> i32 {
        self.code
    }

    pub(crate) fn describe(&self) -> Vec<u8> {
        format!("error {}", self.code).into_bytes()
    }

    pub(crate) fn count_arguments(&self, args: &[JsLocal<'_>]) -> usize {
        args.len()
    }

    pub(crate) fn get_message(&self) -> Vec<u8> {
        self.describe()
    }

    pub(crate) fn get_detail<'a>(&self, _: JsWrapper<'a, Self>, heap: &JsHeap<'a>) -> JsLocal<'a> {
        JsLocal::new(heap, JSValue::js_number_from_int32(self.code))
    }

    pub(crate) fn set_detail<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        value: JsLocal<'a>,
    ) {
        let doubled = JSValue::js_number(value.to_js().as_number() * 2.0);
        // SAFETY: storing a value runs no JavaScript.
        js_TestError::detail_set_cached(this_value.to_js(), unsafe { heap.global() }, doubled);
    }

    pub(crate) fn get_level() -> i32 {
        ERROR_LEVEL.load(Ordering::SeqCst)
    }

    pub(crate) fn set_level(value: i32) {
        ERROR_LEVEL.store(value, Ordering::SeqCst);
    }
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
