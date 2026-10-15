//! This namespace is used to test binding generator

use core::sync::atomic::{AtomicUsize, Ordering};

use crate::bindgen::{
    self, BufferSource, IntoError as _, JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper,
    JsWrapperStrong, WithValue,
};
use crate::generated_bindgen::bindgen_test::{
    TestAnything, TestChoice, TestColor, TestCounterClass, TestCounterInternalFields as _,
    TestFailure, TestHolderClass, TestNames, TestOptions, TestOptionsEcho, TestOuter,
    TestTokenClass, TestValue,
};

// This example should be kept in sync with bindgen's documentation
pub fn add<'a>(heap: &JsHeap<'a>, a: i32, b: i32) -> bindgen::Result<'a, i32> {
    a.checked_add(b)
        .ok_or_else(|| heap.error(format_args!("Integer overflow while adding")))
}

pub fn required_and_optional_arg(a: bool, b: Option<usize>, c: i32, d: Option<u8>) -> i32 {
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

pub fn utf8_echo(text: &[u8]) -> &[u8] {
    text
}

pub fn utf8_echo_loose(text: &[u8]) -> &[u8] {
    text
}

pub fn utf8_optional(text: Option<&[u8]>) -> Option<&[u8]> {
    text
}

pub fn utf8_owned(text: bun_core::Utf8Bytes<'static>) -> bun_core::Utf8Bytes<'static> {
    text
}

pub fn string_echo(text: bun_core::String) -> bun_core::String {
    text
}

pub fn next_color(color: TestColor) -> TestColor {
    match color {
        TestColor::Red => TestColor::Green,
        TestColor::Green => TestColor::Blue,
        TestColor::Blue => TestColor::Red,
    }
}

pub fn options_echo<'a>(_: &JsHeap<'a>, options: TestOptions<'a>) -> TestOptionsEcho<'a> {
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

pub fn describe_value(value: TestValue<'_>) -> Vec<u8> {
    match value {
        TestValue::Number(number) => format!("number {number}").into_bytes(),
        TestValue::Flag(flag) => format!("flag {flag}").into_bytes(),
        TestValue::Text(text) => [b"text ", text].concat(),
        TestValue::List(list) => format!("list {list:?}").into_bytes(),
    }
}

pub fn describe_anything<'a>(cx: &mut JsScope<'a>, value: TestAnything<'a>) -> Vec<u8> {
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

pub fn describe_defaults(options: TestOuter<'_>) -> Vec<u8> {
    let inner = match options.inner {
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
    let counter = options.counter.is_some();
    format!("inner: {inner}; value: {value}; choice: {choice}; counter: {counter}").into_bytes()
}

pub fn overloaded_text_times(text: &[u8], times: u32) -> Vec<u8> {
    [b"text times ", text.repeat(times as usize).as_slice()].concat()
}

pub fn overloaded_text_upper(text: &[u8], upper: bool) -> Vec<u8> {
    let text = if upper {
        text.to_ascii_uppercase()
    } else {
        text.to_vec()
    };
    [b"text upper ", text.as_slice()].concat()
}

pub fn overloaded_two_numbers(a: f64, b: f64) -> Vec<u8> {
    format!("two numbers {a} {b}").into_bytes()
}

pub fn overloaded_number(number: f64) -> Vec<u8> {
    format!("number {number}").into_bytes()
}

pub fn overloaded_list(list: Vec<f64>) -> Vec<u8> {
    format!("list {:?}", list.into_boxed_slice()).into_bytes()
}

pub fn overloaded_counter<'a>(
    cx: &mut JsScope<'a>,
    counter: JsWrapper<'a, TestCounter>,
) -> Vec<u8> {
    let count = counter.with(&cx.payloads, |counter| counter.count);
    format!("counter {count}").into_bytes()
}

pub fn sum_array(numbers: Vec<i32>) -> f64 {
    numbers
        .into_iter()
        .fold(0.0, |sum, number| sum + f64::from(number))
}

pub fn range(length: u32) -> core::ops::Range<u32> {
    0..length
}

pub fn names(text: &[u8]) -> TestNames {
    let all: Vec<Vec<u8>> = words(text).map(<[u8]>::to_vec).collect();
    TestNames {
        first: all.first().cloned().unwrap_or_default(),
        nickname: all.get(1).cloned(),
        all,
    }
}

pub fn words(text: &[u8]) -> impl Iterator<Item = &[u8]> {
    bun_core::strings::tokenize(text, b" ")
}

fn sum(bytes: &[u8]) -> u32 {
    bytes.iter().map(|&byte| u32::from(byte)).sum()
}

pub fn sum_bytes(bytes: &[u8]) -> u32 {
    sum(bytes)
}

pub fn sum_bytes_optional(bytes: Option<&[u8]>) -> Option<u32> {
    bytes.map(sum)
}

pub fn sum_bytes_then_text(bytes: &[u8], text: &[u8]) -> u32 {
    sum(bytes) + sum(text)
}

pub fn sum_before_and_after_callback<'a>(
    cx: &mut JsScope<'a>,
    buffer: JsLocal<'a, BufferSource>,
    callback: JsLocal<'a>,
) -> bindgen::Result<'a, [u32; 2]> {
    let before = buffer.with_bytes(&cx.heap, sum);
    let Some(callback) = callback.as_callable() else {
        return Err(cx
            .heap
            .type_error(format_args!("callback must be a function")));
    };
    callback.call(cx, JsLocal::UNDEFINED, &[])?;
    Ok([before, buffer.with_bytes(&cx.heap, sum)])
}

pub fn with_value_echo<'a>(_: &JsHeap<'a>, text: WithValue<'a, &'a [u8]>) -> JsLocal<'a> {
    if text.converted.is_empty() {
        return JsLocal::UNDEFINED;
    }
    text.value
}

pub fn fail<'a>(
    heap: &JsHeap<'a>,
    how: TestFailure,
    value: JsLocal<'a>,
) -> bindgen::Result<'a, ()> {
    Err(match how {
        TestFailure::Type => heap.type_error(format_args!("a type error")),
        TestFailure::Range => heap.range_error(format_args!("a range error")),
        TestFailure::Plain => heap.error(format_args!("an error")),
        TestFailure::Syscall => {
            bun_sys::Error::from_code(bun_sys::E::ENOENT, bun_sys::Tag::open).into_error(heap)
        }
        TestFailure::Value => bindgen::Error::from_value(value),
    })
}

static ALIVE: AtomicUsize = AtomicUsize::new(0);

pub struct TestCounter {
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

impl TestCounterClass for TestCounter {
    type Error<'a> = bindgen::Error<'a>;

    fn constructor<'a>(heap: &JsHeap<'a>, start: i32) -> bindgen::Result<'a, Self> {
        if start < 0 {
            return Err(heap.range_error(format_args!("start must not be negative")));
        }
        Ok(Self::new(start))
    }

    fn count(&self) -> i32 {
        self.count
    }

    fn label(&self) -> impl AsRef<[u8]> {
        &self.label
    }

    fn set_label<'a>(&mut self, value: &'a [u8]) {
        self.label = value.to_vec();
    }

    fn tag<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        bindgen::to_js::array(heap, [self.count], bindgen::to_js::i32)
    }

    fn increment(&mut self, by: i32) -> i32 {
        self.count = self.count.wrapping_add(by);
        self.count
    }

    fn listen<'a>(&self, this: JsWrapper<'a, Self>, heap: &JsHeap<'a>, listener: JsLocal<'a>) {
        this.set_listener_field(heap, listener);
    }

    fn notify<'a>(this: JsWrapper<'a, Self>, cx: &mut JsScope<'a>) -> bindgen::Result<'a, i32> {
        if let Some(listener) = this.listener_field(&cx.heap).as_callable() {
            listener.call(cx, this.as_value(), &[])?;
        }
        Ok(this.with(&cx.payloads, |counter| counter.count))
    }

    fn plus<'a>(
        this: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        other: JsWrapper<'a, Self>,
    ) -> i32 {
        let other = other.with(&cx.payloads, |counter| counter.count);
        this.with(&cx.payloads, |counter| counter.count.wrapping_add(other))
    }

    fn starting<'a>(heap: &JsHeap<'a>, at: i32) -> JsWrapper<'a, Self> {
        Self::new(at).to_js(heap)
    }

    fn alive() -> usize {
        ALIVE.load(Ordering::SeqCst)
    }
}

pub struct TestHolder {
    counter: JsWrapperStrong<TestCounter>,
}

impl TestHolderClass for TestHolder {
    fn constructor<'a>(heap: &JsHeap<'a>, counter: JsWrapper<'a, TestCounter>) -> Self {
        TestHolder {
            counter: counter.to_strong(heap),
        }
    }

    fn counter<'a>(&self, heap: &JsHeap<'a>) -> JsWrapper<'a, TestCounter> {
        self.counter.get(heap)
    }

    fn increment_counter<'a>(this: JsWrapper<'a, Self>, cx: &mut JsScope<'a>) -> i32 {
        let counter = this.with(&cx.payloads, |holder| holder.counter.get(&cx.heap));
        counter.with_mut(&mut cx.payloads, |counter| counter.increment(1))
    }
}

pub struct TestToken {
    id: u32,
}

impl TestTokenClass for TestToken {
    fn id(&self) -> u32 {
        self.id
    }
}

pub fn make_token<'a>(heap: &JsHeap<'a>, id: u32) -> JsWrapper<'a, TestToken> {
    TestToken { id }.to_js(heap)
}
