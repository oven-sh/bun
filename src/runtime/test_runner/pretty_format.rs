//! A port of pretty-format, for the snapshots of suites written for Jest and Vitest, and snapshot serializers.
//! Bun's own snapshot format is `bun_jsc::console_object::Formatter::is_snapshot`.

use core::ffi::c_void;

use bun_core::fmt as bun_fmt;
use bun_core::strings;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::console_object;
use bun_jsc::{self as jsc, JSGlobalObject, JSType, JSValue, JsClass as _, JsError, JsResult, StringJsc as _};

use super::expect;
use super::snapshot::Format as SnapshotFormat;
use crate::generated_bindgen::expect::{
    js_ExpectAny, js_ExpectArrayContaining, js_ExpectCloseTo, js_ExpectCustomAsymmetricMatcher,
    js_ExpectMatcherUtils, js_ExpectObjectContaining, js_ExpectStringContaining,
    js_ExpectStringMatching,
};
use crate::generated_bindgen::pretty_format as generated;

#[derive(Default)]
pub(crate) struct JestPrettyFormat {}

pub(crate) struct Formatter<'a> {
    pub(crate) global_this: &'a JSGlobalObject,
    pub(crate) indent: u32,
    pub(crate) snapshot_format: SnapshotFormat,
    ancestors: ObjectList,
    copied: usize,
    print_basic_prototype: bool,
    print_function_name: bool,
    serializers: Option<JSValue>,
    config: Option<JSValue>,
    /// Print the way Vitest's `inspect()` does: one line, single quotes, unsorted unquoted keys, function names.
    pub(crate) is_inline: bool,
    pub(crate) depth: u32,
    pub(crate) max_depth: u32,
    pub(crate) max_width: u32,
    call_to_json: bool,
    items: u32,
    /// Vitest's `_outputLengthPerDepth`. Only tracked when `is_inline`.
    output_at_depth: [usize; 12],
}

impl<'a> Formatter<'a> {
    #[optimize(size)]
    pub(crate) fn new(global: &'a JSGlobalObject, snapshot_format: SnapshotFormat) -> Self {
        Self {
            global_this: global,
            indent: 0,
            snapshot_format,
            ancestors: ObjectList::default(),
            copied: 0,
            print_basic_prototype: false,
            print_function_name: false,
            serializers: None,
            config: None,
            is_inline: false,
            depth: 0,
            max_depth: u32::MAX,
            max_width: u32::MAX,
            call_to_json: true,
            items: 0,
            output_at_depth: [0; 12],
        }
    }
}

/// Must match `SnapshotKind` in SnapshotFormat.cpp.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    Object,
    Arguments,
    List,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Date,
    Error,
    RegExp,
    /// A non-callable whose `Symbol.toStringTag` says Function. Real functions are printed before `Kind::of`.
    Function,
    Symbol,
    Promise,
}

impl Kind {
    fn of(global: &JSGlobalObject, object: JSValue) -> JsResult<Kind> {
        unsafe extern "C" {
            safe fn SnapshotFormat__kindOf(global: &JSGlobalObject, object: JSValue) -> u8;
        }
        const KINDS: [Kind; 13] = [
            Kind::Object,
            Kind::Arguments,
            Kind::List,
            Kind::Map,
            Kind::Set,
            Kind::WeakMap,
            Kind::WeakSet,
            Kind::Date,
            Kind::Error,
            Kind::RegExp,
            Kind::Function,
            Kind::Symbol,
            Kind::Promise,
        ];
        let kind = jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__kindOf(global, object))?;
        Ok(KINDS[usize::from(kind)])
    }
}

fn for_each_sorted_property(
    global: &JSGlobalObject,
    object: JSValue,
    format: SnapshotFormat,
    each: &mut dyn FnMut(JSValue, JSValue) -> JsResult<()>,
) -> JsResult<()> {
    for_each_property(global, object, format, true, u32::MAX, each)
}

/// Past `max_width` properties, calls `each` once with an empty key and the number left over.
fn for_each_property(
    global: &JSGlobalObject,
    object: JSValue,
    format: SnapshotFormat,
    is_sorted: bool,
    max_width: u32,
    each: &mut dyn FnMut(JSValue, JSValue) -> JsResult<()>,
) -> JsResult<()> {
    type Each<'a> = &'a mut dyn FnMut(JSValue, JSValue) -> JsResult<()>;
    unsafe extern "C" {
        safe fn SnapshotFormat__forEachProperty(
            global: &JSGlobalObject,
            object: JSValue,
            is_for_vitest: bool,
            is_sorted: bool,
            max_width: u32,
            each: *mut c_void,
            call: extern "C" fn(*mut c_void, JSValue, JSValue) -> bool,
        );
    }
    extern "C" fn call(each: *mut c_void, key: JSValue, value: JSValue) -> bool {
        // SAFETY: `each` is the `Each` below, which outlives the walk.
        (unsafe { &mut *each.cast::<Each<'_>>() })(key, value).is_ok()
    }
    let mut each: Each<'_> = each;
    jsc::host_fn::from_js_host_call_generic(global, || {
        let is_for_vitest = format == SnapshotFormat::Vitest;
        SnapshotFormat__forEachProperty(global, object, is_for_vitest, is_sorted, max_width, (&raw mut each).cast::<c_void>(), call)
    })
}

fn has_index(global: &JSGlobalObject, value: JSValue, index: u32) -> JsResult<bool> {
    unsafe extern "C" {
        safe fn SnapshotFormat__hasIndex(global: &JSGlobalObject, value: JSValue, index: u32) -> bool;
    }
    jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__hasIndex(global, value, index))
}

/// Iteration count of `for (let i = 0; i < value.length; i++)`.
fn length_of(global: &JSGlobalObject, value: JSValue) -> JsResult<u32> {
    unsafe extern "C" {
        safe fn SnapshotFormat__lengthOf(global: &JSGlobalObject, value: JSValue) -> u32;
    }
    jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__lengthOf(global, value))
}

/// `Number(value)`, so a BigInt converts instead of throwing.
pub(crate) fn to_number(global: &JSGlobalObject, value: JSValue) -> JsResult<f64> {
    unsafe extern "C" {
        safe fn SnapshotFormat__toNumber(global: &JSGlobalObject, value: JSValue) -> f64;
    }
    jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__toNumber(global, value))
}

/// `Array.isArray(value)`, which sees through a Proxy.
fn is_array(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    unsafe extern "C" {
        safe fn SnapshotFormat__isArray(global: &JSGlobalObject, value: JSValue) -> bool;
    }
    jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__isArray(global, value))
}

/// `value[name]` as JS does it: primitives work, null and undefined throw, `Object.prototype` is searched.
pub(crate) fn member(global: &JSGlobalObject, value: JSValue, name: &'static str) -> JsResult<JSValue> {
    unsafe extern "C" {
        fn SnapshotFormat__get(global: &JSGlobalObject, value: JSValue, name: *const u8, length: usize) -> JSValue;
    }
    // SAFETY: `name` is ASCII that outlives the call.
    jsc::host_fn::from_js_host_call(global, || unsafe { SnapshotFormat__get(global, value, name.as_ptr(), name.len()) })
}

fn item(global: &JSGlobalObject, value: JSValue, index: u32) -> JsResult<JSValue> {
    unsafe extern "C" {
        safe fn SnapshotFormat__getIndex(global: &JSGlobalObject, value: JSValue, index: u32) -> JSValue;
    }
    jsc::host_fn::from_js_host_call(global, || SnapshotFormat__getIndex(global, value, index))
}

pub(crate) fn member_by_value(global: &JSGlobalObject, value: JSValue, key: JSValue) -> JsResult<JSValue> {
    unsafe extern "C" {
        safe fn SnapshotFormat__getByValue(global: &JSGlobalObject, value: JSValue, key: JSValue) -> JSValue;
    }
    jsc::host_fn::from_js_host_call(global, || SnapshotFormat__getByValue(global, value, key))
}

fn has_member(global: &JSGlobalObject, value: JSValue, key: JSValue) -> JsResult<bool> {
    unsafe extern "C" {
        safe fn SnapshotFormat__hasByValue(global: &JSGlobalObject, value: JSValue, key: JSValue) -> bool;
    }
    jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__hasByValue(global, value, key))
}

/// putDirect, so only for objects the printer itself created.
fn define(global: &JSGlobalObject, object: JSValue, key: JSValue, value: JSValue) -> JsResult<()> {
    unsafe extern "C" {
        safe fn SnapshotFormat__define(global: &JSGlobalObject, object: JSValue, key: JSValue, value: JSValue);
    }
    jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__define(global, object, key, value))
}

/// Jest's and Vitest's `expect.stringMatching()` stores `new RegExp(sample)`. Bun stores the argument as given.
fn to_reg_exp(global: &JSGlobalObject, pattern: JSValue) -> JsResult<JSValue> {
    unsafe extern "C" {
        safe fn SnapshotFormat__toRegExp(global: &JSGlobalObject, pattern: JSValue) -> JSValue;
    }
    jsc::host_fn::from_js_host_call(global, || SnapshotFormat__toRegExp(global, pattern))
}

pub(crate) fn is_object_but_no_array(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    Ok(value.is_object() && !value.is_callable() && !is_array(global, value)?)
}

/// jest-snapshot's `deepMerge` and Vitest's `deepMergeSnapshot`. `source` is the property matchers.
#[cold]
#[optimize(size)]
fn deep_merge(global: &JSGlobalObject, target: JSValue, source: JSValue, format: SnapshotFormat) -> JsResult<JSValue> {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return Err(global.throw_stack_overflow());
    }
    if is_array(global, target)? && is_array(global, source)? {
        return deep_merge_array(global, target, source, format);
    }
    if !is_object_but_no_array(global, target)? || !is_object_but_no_array(global, source)? {
        return Ok(target);
    }
    let merged = JSValue::create_empty_object(global, 0);
    for_each_sorted_property(global, target, format, &mut |key, value| define(global, merged, key, value))?;
    for_each_member_of_source(global, source, format, &mut |key, from_source| {
        let is_matcher = || Ok::<bool, JsError>(expect::Expect::is_asymmetric_matcher(from_source) || member(global, from_source, "$$typeof")?.to_boolean());
        let value = if is_object_but_no_array(global, from_source)? && !is_matcher()? {
            if has_member(global, target, key)? {
                deep_merge(global, member_by_value(global, target, key)?, from_source, format)?
            } else {
                from_source
            }
        } else if is_array(global, from_source)? {
            deep_merge_array(global, member_by_value(global, target, key)?, from_source, format)?
        } else {
            from_source
        };
        define(global, merged, key, value)
    })?;
    Ok(merged)
}

/// Bun's asymmetric matchers are native, so this reports the properties Jest's and Vitest's matcher objects have.
fn for_each_member_of_source(
    global: &JSGlobalObject,
    source: JSValue,
    format: SnapshotFormat,
    each: &mut dyn FnMut(JSValue, JSValue) -> JsResult<()>,
) -> JsResult<()> {
    if let Some((sample, inverse, precision)) = members_of_matcher(global, source)? {
        let key = |name: &'static str| bun_core::String::static_(name).to_js(global);
        each(key("$$typeof")?, JSValue::symbol_for(global, b"jest.asymmetricMatcher"))?;
        each(key("inverse")?, JSValue::from(inverse))?;
        if let Some(precision) = precision {
            each(key("precision")?, precision)?;
        }
        return each(key("sample")?, sample);
    }
    for_each_sorted_property(global, source, format, &mut |key, value| if key.is_string() { each(key, value) } else { Ok(()) })
}

/// Returns `(sample, inverse, precision)`. Only `closeTo()` has a precision.
fn members_of_matcher(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<(JSValue, bool, Option<JSValue>)>> {
    if value.js_type() != JSType::DOMWrapper {
        return Ok(None);
    }
    let found = |sample: Option<JSValue>, flags: expect::Flags| Some((sample.unwrap_or(JSValue::UNDEFINED), flags.not(), None));
    Ok(if let Some(matcher) = value.as_class_ref::<expect::ExpectArrayContaining>() {
        found(js_ExpectArrayContaining::array_value_get_cached(value), matcher.flags)
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectObjectContaining>() {
        found(js_ExpectObjectContaining::object_value_get_cached(value), matcher.flags)
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringContaining>() {
        found(js_ExpectStringContaining::string_value_get_cached(value), matcher.flags)
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringMatching>() {
        let sample = js_ExpectStringMatching::test_value_get_cached(value).map(|sample| to_reg_exp(global, sample)).transpose()?;
        found(sample, matcher.flags)
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectCloseTo>() {
        found(js_ExpectCloseTo::number_value_get_cached(value), matcher.flags)
            .map(|(sample, inverse, _)| (sample, inverse, js_ExpectCloseTo::digits_value_get_cached(value)))
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectCustomAsymmetricMatcher>() {
        found(js_ExpectCustomAsymmetricMatcher::captured_args_get_cached(value), matcher.flags)
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectAny>() {
        found(js_ExpectAny::constructor_value_get_cached(value), matcher.flags)
    } else if let Some(matcher) = value.as_class_ref::<expect::ExpectAnything>() {
        found(None, matcher.flags)
    } else {
        None
    })
}

/// The plain object a matcher is in Jest and Vitest, minus `$$typeof`, which `JSON.stringify()` drops anyway.
pub(crate) fn matcher_as_object(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<JSValue>> {
    let Some((sample, inverse, precision)) = members_of_matcher(global, value)? else { return Ok(None) };
    let object = JSValue::create_empty_object(global, 3);
    object.put(global, b"sample", sample);
    object.put(global, b"inverse", JSValue::from(inverse));
    if let Some(precision) = precision {
        object.put(global, b"precision", precision);
    }
    Ok(Some(object))
}

pub(crate) fn write_name_of_matcher(global: &JSGlobalObject, value: JSValue, out: &mut Vec<u8>) -> JsResult<bool> {
    if value.js_type() != JSType::DOMWrapper {
        return Ok(false);
    }
    let name = |flags: expect::Flags, is: &'static str, is_not: &'static str| if flags.not() { is_not } else { is };
    out.extend_from_slice(
        if let Some(matcher) = value.as_class_ref::<expect::ExpectArrayContaining>() {
            name(matcher.flags, "ArrayContaining", "ArrayNotContaining")
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectObjectContaining>() {
            name(matcher.flags, "ObjectContaining", "ObjectNotContaining")
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringContaining>() {
            name(matcher.flags, "StringContaining", "StringNotContaining")
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringMatching>() {
            name(matcher.flags, "StringMatching", "StringNotMatching")
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectCloseTo>() {
            name(matcher.flags, "NumberCloseTo", "NumberNotCloseTo")
        } else if value.as_class_ref::<expect::ExpectAny>().is_some() {
            "Any"
        } else if value.as_class_ref::<expect::ExpectAnything>().is_some() {
            "Anything"
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectCustomAsymmetricMatcher>() {
            let Some(matcher_fn) = js_ExpectCustomAsymmetricMatcher::matcher_fn_get_cached(value) else { return Ok(false) };
            if matcher.flags.not() {
                out.extend_from_slice(b"not.");
            }
            out.extend_from_slice(matcher_fn.get_name(global)?.to_utf8().slice());
            return Ok(true);
        } else {
            return Ok(false);
        }
        .as_bytes(),
    );
    Ok(true)
}

#[optimize(size)]
fn deep_merge_array(global: &JSGlobalObject, target: JSValue, source: JSValue, format: SnapshotFormat) -> JsResult<JSValue> {
    let is_vitest = format == SnapshotFormat::Vitest;
    let merged = JSValue::create_empty_array(global, 0)?;
    // Vitest declares `target = []` and `source = []`, so undefined means empty.
    let has_target = !(is_vitest && target.is_undefined());
    if has_target {
        for i in 0..length_of(global, target)? {
            merged.put_index(global, i, item(global, target, i)?)?;
        }
    }
    if is_vitest && source.is_undefined() {
        return Ok(merged);
    }
    if is_vitest && !is_array(global, source)? {
        return Err(global.throw_type_error(format_args!("source.forEach is not a function")));
    }
    for i in 0..length_of(global, source)? {
        // Vitest's `forEach()` skips holes. Jest's `entries()` doesn't.
        if is_vitest && !has_index(global, source, i)? {
            continue;
        }
        let from_source = item(global, source, i)?;
        let from_target = if has_target { item(global, target, i)? } else { JSValue::UNDEFINED };
        let value = if is_array(global, from_target)? && (is_vitest || is_array(global, from_source)?) {
            deep_merge_array(global, from_target, from_source, format)?
        } else if is_object_but_no_array(global, from_target)? && (is_vitest || !is_any_or_anything(from_source)) {
            deep_merge(global, from_target, from_source, format)?
        } else {
            from_source
        };
        merged.put_index(global, i, value)?;
    }
    Ok(merged)
}

fn is_any_or_anything(value: JSValue) -> bool {
    value.as_class_ref::<expect::ExpectAny>().is_some() || value.as_class_ref::<expect::ExpectAnything>().is_some()
}

fn is_text(global: &JSGlobalObject, value: JSValue, text: &[u8]) -> JsResult<bool> {
    Ok(value.is_string_literal() && value.to_bun_string(global)?.eq_ascii(text))
}

fn call(global: &JSGlobalObject, function: JSValue, this: JSValue, name: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
    if !function.is_callable() {
        return Err(global.throw_type_error(format_args!("{name} is not a function")));
    }
    function.call(global, this, arguments)
}

fn call_method(global: &JSGlobalObject, object: JSValue, name: &'static str, arguments: &[JSValue]) -> JsResult<JSValue> {
    call(global, member(global, object, name)?, object, name, arguments)
}

fn first_truthy(global: &JSGlobalObject, object: JSValue, names: &[&'static str]) -> JsResult<Option<JSValue>> {
    for name in names {
        let value = member(global, object, name)?;
        if value.to_boolean() {
            return Ok(Some(value));
        }
    }
    Ok(None)
}

/// Returns false without iterating unless `method` is the built-in `Map#entries` or `Set#values`.
/// Past `max_width` items, calls `each` once with an empty `first`.
fn for_each_of_collection(
    global: &JSGlobalObject,
    collection: JSValue,
    method: JSValue,
    max_width: u32,
    each: &mut dyn FnMut(JSValue, JSValue) -> JsResult<()>,
) -> JsResult<bool> {
    type Each<'a> = &'a mut dyn FnMut(JSValue, JSValue) -> JsResult<()>;
    unsafe extern "C" {
        safe fn SnapshotFormat__forEachOfCollection(
            global: &JSGlobalObject,
            collection: JSValue,
            method: JSValue,
            max_width: u32,
            each: *mut c_void,
            call: extern "C" fn(*mut c_void, JSValue, JSValue) -> bool,
        ) -> bool;
    }
    extern "C" fn call(each: *mut c_void, first: JSValue, second: JSValue) -> bool {
        // SAFETY: `each` is the `Each` below, which outlives the walk.
        (unsafe { &mut *each.cast::<Each<'_>>() })(first, second).is_ok()
    }
    let mut each: Each<'_> = each;
    jsc::host_fn::from_js_host_call_generic(global, || {
        SnapshotFormat__forEachOfCollection(global, collection, method, max_width, (&raw mut each).cast::<c_void>(), call)
    })
}

fn write_string(global: &JSGlobalObject, out: &mut Vec<u8>, value: JSValue) -> JsResult<()> {
    out.extend_from_slice(value.to_js_string_view(global)?.to_utf8().slice());
    Ok(())
}

pub(crate) fn write_number(out: &mut Vec<u8>, number: f64) {
    if number.is_finite() {
        let mut buf = [0u8; 124];
        out.extend_from_slice(bun_fmt::FormatDouble::dtoa(&mut buf, number));
    } else {
        out.extend_from_slice(if number.is_nan() {
            b"NaN"
        } else if number > 0.0 {
            b"Infinity"
        } else {
            b"-Infinity"
        });
    }
}

fn write_rest(out: &mut Vec<u8>, rest: Option<f64>) {
    out.extend_from_slice("\u{2026}".as_bytes());
    if let Some(rest) = rest {
        out.push(b'(');
        write_number(out, rest);
        out.push(b')');
    }
}

pub(crate) fn is_unquotable_key(key: &[u8]) -> bool {
    key != b"__proto__"
        && key.first().is_some_and(|first| !first.is_ascii_digit())
        && key.iter().all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
}

/// `value.startsWith("__vitest_") && /__vitest_\d+__/.test(value)`
fn is_hidden_by_vitest(text: &[u8]) -> bool {
    if !text.starts_with(b"__vitest_") {
        return false;
    }
    let mut rest = text;
    while let Some(i) = strings::index_of(rest, b"__vitest_") {
        rest = &rest[i + b"__vitest_".len()..];
        let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
        if digits > 0 && rest[digits..].starts_with(b"__") {
            return true;
        }
    }
    false
}

fn write_printed_by_plugin(global: &JSGlobalObject, out: &mut Vec<u8>, printed: JSValue) -> JsResult<()> {
    if !printed.is_string_literal() {
        return Err(global.throw_type_error(format_args!(
            "A snapshot serializer must return a string, received {}",
            printed.js_type_string(global),
        )));
    }
    write_string(global, out, printed)
}

/// Backed by a JS array so the GC keeps the objects alive. The on-stack `Formatter` roots the array itself.
#[derive(Copy, Clone, Default)]
struct ObjectList {
    array: Option<JSValue>,
    len: u32,
}

impl ObjectList {
    fn includes(self, value: JSValue) -> bool {
        unsafe extern "C" {
            safe fn SnapshotFormat__includes(list: JSValue, length: u32, value: JSValue) -> bool;
        }
        self.array.is_some_and(|array| SnapshotFormat__includes(array, self.len, value))
    }

    fn push(&mut self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        let array = match self.array {
            Some(array) => array,
            None => *self.array.insert(JSValue::create_empty_array(global, 0)?),
        };
        array.put_index(global, self.len, value)?;
        self.len += 1;
        Ok(())
    }

    fn pop(&mut self) {
        self.len -= 1;
    }

    fn to_js_array(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let copy = JSValue::create_empty_array(global, 0)?;
        if let Some(array) = self.array {
            for i in 0..self.len {
                copy.put_index(global, i, array.get_index(global, i)?)?;
            }
        }
        Ok(copy)
    }
}

struct CountedWriter<'a> {
    writer: &'a mut Vec<u8>,
    length: &'a core::cell::Cell<usize>,
}

impl bun_io::Write for CountedWriter<'_> {
    fn write_all(&mut self, buf: &[u8]) -> bun_io::Result<()> {
        self.length.set(self.length.get() + buf.len());
        self.writer.extend_from_slice(buf);
        Ok(())
    }
}

struct ExpectedText<'a> {
    rest: &'a [u8],
    differs: &'a core::cell::Cell<bool>,
}

impl bun_io::Write for ExpectedText<'_> {
    fn write_all(&mut self, buf: &[u8]) -> bun_io::Result<()> {
        match self.rest.strip_prefix(buf) {
            Some(rest) => self.rest = rest,
            None => self.differs.set(true),
        }
        Ok(())
    }
}

impl JestPrettyFormat {
    /// Prints Bun's own snapshot format.
    fn bun_formatter(global: &JSGlobalObject) -> console_object::Formatter<'_> {
        let mut formatter = console_object::Formatter::new_snapshot(global);
        formatter.snapshot.printer = Some(Self::print_in_bun_snapshot);
        formatter
    }

    pub(crate) fn print_in_diff(global: &JSGlobalObject, value: JSValue, out: &mut Vec<u8>) -> JsResult<()> {
        let length = core::cell::Cell::new(0);
        let mut formatter = Self::bun_formatter(global);
        formatter.snapshot.output_length = Some(&length);
        formatter.format_value::<false>(value, &mut CountedWriter { writer: out, length: &length })
    }

    /// Returns false if Bun's own format should print `value`.
    fn print_in_bun_snapshot(
        formatter: &mut console_object::Formatter<'_>,
        writer: &mut dyn bun_io::Write,
        tag: &mut console_object::TagPayload,
        value: JSValue,
    ) -> JsResult<bool> {
        use console_object::TagPayload as Tag;
        let global = formatter.global_this;
        if !tag.is_primitive() && let Some(length) = formatter.snapshot.output_length {
            // Vitest's `maxOutputLength`. A React fiber or `window` would print hundreds of megabytes.
            if length.get() > 1_000_000 {
                let _ = writer.write_all(if matches!(tag, Tag::Array) { b"[Array]" } else { b"[Object]" });
                return Ok(true);
            }
            // Where another value holds the global object, it prints as `console.log` prints it there. It holds `process.env`.
            if formatter.indent > 0 && matches!(value.js_type(), JSType::GlobalObject | JSType::GlobalProxy) {
                let global_object = if value.js_type() == JSType::GlobalProxy { value.get_proxy_target() } else { value };
                if global_object == global.to_js_value() {
                    *tag = Tag::GlobalObject;
                    return Ok(false);
                }
            }
            if value == formatter.snapshot.dispatcher {
                let _ = writer.write_fmt(format_args!("[{}]", value.get_class_name(global)?));
                return Ok(true);
            }
            // In a failure message the walk of the Object arm prints what `toEqual` reads of an event.
            if matches!(tag, Tag::Event) {
                let dispatcher = match value.get(global, "target") {
                    Ok(target) => target.unwrap_or(JSValue::ZERO),
                    Err(JsError::Thrown) if global.clear_exception_except_termination() => JSValue::ZERO,
                    Err(error) => return Err(error),
                };
                let outer = core::mem::replace(&mut formatter.snapshot.dispatcher, dispatcher);
                let event = console_object::TagResult { tag: Tag::Object, cell: JSType::Event };
                let printed = formatter.format::<false>(event, writer, value, global);
                formatter.snapshot.dispatcher = outer;
                return printed.map(|()| true);
            }
        }
        if matches!(tag, Tag::JSX)
            && value.get_own_truthy(global, "$$typeof")? == Some(JSValue::symbol_for(global, b"react.transitional.element"))
        {
            // Older versions printed it as a plain object, along with the fiber in its `_owner`.
            match formatter.snapshot.like_older_bun {
                Some(_) => *tag = Tag::Object,
                None => formatter.snapshot.same_as_older_bun = false,
            }
        }
        if formatter.snapshot.serializers.is_some() {
            let mut serializing = Formatter::new(global, SnapshotFormat::Bun);
            serializing.indent = formatter.indent;
            serializing.serializers = formatter.snapshot.serializers;
            serializing.config = formatter.snapshot.config;
            let mut printed = Vec::new();
            let is_printed = serializing.print_with_serializer_in_bun_snapshot(&mut printed, value);
            formatter.snapshot.config = serializing.config;
            let _ = writer.write_all(&printed);
            if is_printed? {
                return Ok(true);
            }
        }
        if let Some(differs) = formatter.snapshot.like_older_bun {
            formatter.failed |= differs.get();
        } else if matches!(tag, Tag::Object | Tag::Array | Tag::JSON) {
            match super::dom_format::print_in_bun_snapshot(formatter, writer, value) {
                Ok(false) => {}
                printed => {
                    formatter.snapshot.same_as_older_bun = false;
                    return printed;
                }
            }
        }
        Ok(false)
    }

    /// True if `saved` is what older versions of Bun wrote for `value`, so their snapshots still pass.
    /// They printed DOM nodes as plain objects, accessors as `[native code]`, and non-enumerable properties.
    #[cold]
    pub(crate) fn did_older_bun_print(global: &JSGlobalObject, value: JSValue, saved: &[u8]) -> JsResult<bool> {
        let differs = core::cell::Cell::new(false);
        let mut expected = ExpectedText { rest: saved, differs: &differs };
        let mut formatter = Self::bun_formatter(global);
        formatter.snapshot.like_older_bun = Some(&differs);
        formatter.format_value::<false>(value, &mut expected)?;
        Ok(!differs.get() && expected.rest.is_empty())
    }

    /// Returns true if an older Bun would have printed the same text, so `did_older_bun_print` can be skipped.
    #[inline(never)]
    #[optimize(size)]
    pub(crate) fn print_snapshot(
        global: &JSGlobalObject,
        value: JSValue,
        property_matchers: Option<JSValue>,
        out: &mut Vec<u8>,
        format: SnapshotFormat,
    ) -> JsResult<bool> {
        let serializers = Self::serializers(global)?;
        if !format.is_pretty_format() {
            let mut formatter = Self::bun_formatter(global);
            formatter.snapshot.serializers = serializers;
            formatter.format_value::<false>(value, out)?;
            return Ok(formatter.snapshot.same_as_older_bun && serializers.is_none());
        }
        let mut formatter = Formatter::new(global, format);
        formatter.serializers = serializers;

        let value = match property_matchers {
            Some(properties) => deep_merge(global, value, properties, format)?,
            None => value,
        };

        // jest-snapshot's `addExtraLineBreaks(normalizeNewlines(format(value)))`.
        let mut printed = Vec::new();
        formatter.print_like_pretty_format(&mut printed, value, false)?;
        let multiline = strings::index_of_any(&printed, b"\r\n").is_some();
        if multiline {
            out.push(b'\n');
        }
        let mut rest = printed.as_slice();
        while let Some(i) = strings::index_of_char_usize(rest, b'\r') {
            out.extend_from_slice(&rest[..i]);
            out.push(b'\n');
            rest = &rest[i + 1 + usize::from(rest.get(i + 1) == Some(&b'\n'))..];
        }
        out.extend_from_slice(rest);
        if multiline {
            out.push(b'\n');
        }
        Ok(false)
    }
}

/// How Vitest prints values in `test.each()` titles.
impl JestPrettyFormat {
    /// Vitest's `taskTitleValueFormatTruncate`.
    pub(crate) const TRUNCATE: usize = 40;

    #[cold]
    #[inline(never)]
    #[optimize(size)]
    pub(crate) fn inspect(global: &JSGlobalObject, value: JSValue, out: &mut Vec<u8>) -> JsResult<()> {
        unsafe extern "C" {
            safe fn SnapshotFormat__isShortenedByWidth(global: &JSGlobalObject, value: JSValue) -> bool;
        }
        const MAX_LENGTH: usize = 10_000;
        let fits = |printed: &[u8]| strings::element_length_utf8_into_utf16(printed) <= Self::TRUNCATE;

        let mut printed = Vec::new();
        Self::stringify(global, value, &mut printed, None, u32::MAX, Self::TRUNCATE)?;
        if fits(&printed) {
            out.extend_from_slice(&printed);
            return Ok(());
        }
        if value.is_string_literal() {
            let string = value.to_bun_string(global)?;
            let mut end = Self::TRUNCATE - 2;
            if (0xD800..=0xDBFF).contains(&string.char_at(end - 1)) {
                end -= 1;
            }
            out.push(b'\'');
            out.extend_from_slice(string.substring_with_len(0, end).to_utf8().slice());
            out.extend_from_slice("\u{2026}'".as_bytes());
            return Ok(());
        }
        // Vitest's asymmetric matchers are plain objects, so they truncate like one.
        if members_of_matcher(global, value)?.is_some()
            || jsc::host_fn::from_js_host_call_generic(global, || SnapshotFormat__isShortenedByWidth(global, value))?
        {
            let (mut fitting, mut too_wide) = (0, Self::TRUNCATE as u32);
            while fitting + 1 < too_wide {
                let width = (fitting + too_wide) / 2;
                Self::stringify(global, value, &mut printed, Some(1), width, MAX_LENGTH)?;
                if fits(&printed) {
                    fitting = width;
                } else {
                    too_wide = width;
                }
            }
            Self::stringify(global, value, &mut printed, Some(1), fitting, MAX_LENGTH)?;
        } else {
            Self::stringify(global, value, &mut printed, Some(0), u32::MAX, MAX_LENGTH)?;
        }
        out.extend_from_slice(&printed);
        Ok(())
    }

    /// Vitest's `stringify()`. As there, `max_depth_option` overrides the halved depth, so those retries are no-ops.
    #[optimize(size)]
    fn stringify(
        global: &JSGlobalObject,
        value: JSValue,
        printed: &mut Vec<u8>,
        max_depth_option: Option<u32>,
        max_width: u32,
        max_length: usize,
    ) -> JsResult<()> {
        let mut max_depth = 10;
        loop {
            let mut print = |call_to_json: bool| {
                printed.clear();
                let mut formatter = Formatter::new(global, SnapshotFormat::Vitest);
                formatter.is_inline = true;
                formatter.max_depth = max_depth_option.unwrap_or(max_depth);
                formatter.max_width = max_width;
                formatter.call_to_json = call_to_json;
                formatter.print_like_pretty_format(printed, value, false)
            };
            match print(true) {
                // Vitest retries once with `callToJSON: false`, whatever was thrown.
                Err(JsError::Thrown) if global.clear_exception_except_termination() => print(false)?,
                result => result?,
            }
            if max_depth <= 1 || strings::element_length_utf8_into_utf16(printed) < max_length {
                return Ok(());
            }
            max_depth /= 2;
        }
    }
}

/// Bytes copied between buffers count against the same limit as the output, which bounds nested re-copying.
pub(crate) fn count_copied(global: &JSGlobalObject, copied: &mut usize, bytes: usize) -> JsResult<()> {
    *copied = copied.saturating_add(bytes);
    check_length(global, *copied)
}

/// The limit is V8's maximum string length, where pretty-format fails with a `RangeError` too.
pub(crate) fn check_length(global: &JSGlobalObject, length: usize) -> JsResult<()> {
    const MAX_LENGTH: usize = (1 << 29) - 24;
    if length > MAX_LENGTH {
        return Err(global.throw_value(global.create_range_error_instance(format_args!("The value is too large to print in a snapshot"))));
    }
    Ok(())
}

/// Indentation makes the output quadratic in depth. pretty-format overflows Node's stack before 2,400 levels anyway.
pub(crate) const MAX_INDENT: u32 = 4096;

/// A port of pretty-format with jest-snapshot's options and plugins.
impl Formatter<'_> {
    fn new_line(&self, out: &mut Vec<u8>) {
        if self.is_inline {
            out.push(b' ');
            return;
        }
        out.push(b'\n');
        out.resize(out.len() + self.indent as usize * 2, b' ');
    }

    /// `min` has no trailing comma, so inline mode writes the comma before every item but the first.
    fn start_item(&mut self, out: &mut Vec<u8>) {
        if self.is_inline && self.items > 0 {
            out.push(b',');
        }
        self.items += 1;
        self.new_line(out);
    }

    fn end_item(&self, out: &mut Vec<u8>) {
        if !self.is_inline {
            out.push(b',');
        }
    }

    fn is_at_max_depth(&self) -> bool {
        self.depth >= self.max_depth
    }

    fn deeper<R>(&mut self, print: impl FnOnce(&mut Self) -> R) -> R {
        self.depth += 1;
        let result = print(self);
        self.depth -= 1;
        result
    }

    fn print_indented(
        &mut self,
        out: &mut Vec<u8>,
        print_items: &mut dyn FnMut(&mut Self, &mut Vec<u8>) -> JsResult<()>,
    ) -> JsResult<()> {
        let empty = out.len();
        let items_of_outer = core::mem::take(&mut self.items);
        self.indent += 1;
        let result = print_items(self, out);
        self.indent -= 1;
        self.items = items_of_outer;
        if out.len() != empty {
            self.new_line(out);
        }
        result
    }

    fn print_child(&mut self, out: &mut Vec<u8>, value: JSValue) -> JsResult<()> {
        self.print_like_pretty_format(out, value, false)
    }

    pub(crate) fn count_copied(&mut self, bytes: usize) -> JsResult<()> {
        count_copied(self.global_this, &mut self.copied, bytes)
    }

    pub(crate) fn check_length(&self, length: usize) -> JsResult<()> {
        check_length(self.global_this, length)
    }

    /// Returns false if no serializer claimed `value`.
    #[cold]
    #[inline(never)]
    fn print_with_serializer_in_bun_snapshot(&mut self, out: &mut Vec<u8>, value: JSValue) -> JsResult<bool> {
        if self.indent > 0 {
            return self.print_with_serializer(out, value);
        }
        out.push(b'\n');
        let is_printed = self.print_with_serializer(out, value)?;
        if strings::contains_char(&out[1..], b'\n') {
            out.push(b'\n');
        } else {
            out.remove(0);
        }
        Ok(is_printed)
    }

    #[inline(never)]
    pub(crate) fn print_like_pretty_format(
        &mut self,
        out: &mut Vec<u8>,
        value: JSValue,
        has_called_to_json: bool,
    ) -> JsResult<()> {
        let global = self.global_this;
        if self.indent > MAX_INDENT || !bun_core::StackCheck::init().is_safe_to_recurse() {
            return Err(global.throw_stack_overflow());
        }
        self.check_length(out.len())?;
        if self.serializers.is_some() && self.print_with_serializer(out, value)? {
            return Ok(());
        }

        let start = out.len();
        if value.is_empty_or_undefined_or_null() {
            out.extend_from_slice(if value.is_null() { b"null" } else { b"undefined" });
        } else if value.is_boolean() {
            out.extend_from_slice(if value.to_boolean() { b"true" } else { b"false" });
        } else if value.is_number() {
            let number = value.as_number();
            if number == 0.0 && number.is_sign_negative() {
                out.push(b'-');
            }
            write_number(out, number);
        } else if value.is_string_literal() {
            let quote = if self.is_inline { b'\'' } else { b'"' };
            out.push(quote);
            write_string(global, out, value)?;
            out.push(quote);
        } else if value.is_big_int() {
            write_string(global, out, value)?;
            out.push(b'n');
        } else if value.is_symbol() {
            out.extend_from_slice(b"Symbol(");
            out.extend_from_slice(value.get_description(global).to_utf8().slice());
            out.push(b')');
        } else if !value.is_object() {
            out.extend_from_slice(b"[native code]");
        } else {
            self.print_object_like_pretty_format(out, value, has_called_to_json)?;
        }
        if self.is_inline
            && let Some(output) = self.output_at_depth.get_mut(self.depth as usize)
        {
            // Vitest's `maxOutputLength`.
            *output += strings::element_length_utf8_into_utf16(&out[start..]);
            if *output > 1_000_000 {
                self.max_depth = 0;
            }
        }
        Ok(())
    }

    /// jest-snapshot's plugins, in its order. Every read, call and conversion mirrors the JS so bad input fails alike.
    fn print_with_plugin(&mut self, out: &mut Vec<u8>, value: JSValue) -> JsResult<bool> {
        let global = self.global_this;
        let type_of = member(global, value, "$$typeof")?;
        let is = |name: &'static [u8]| type_of.is_symbol() && type_of == JSValue::symbol_for(global, name);
        if is(b"react.test.json") {
            return self.print_react_test_json(out, value).map(|()| true);
        }
        if !value.is_callable() && (is(b"react.element") || is(b"react.transitional.element")) {
            return self.print_react_element(out, value, is(b"react.element")).map(|()| true);
        }
        if super::dom_format::print_in_snapshot(self, out, value)? || self.print_immutable(out, value)? {
            return Ok(true);
        }
        if value.js_type() == JSType::DOMWrapper && self.print_asymmetric_matcher_like_pretty_format(out, value)? {
            return Ok(true);
        }
        if is(b"jest.asymmetricMatcher") {
            return self.print_foreign_asymmetric_matcher(out, value).map(|()| true);
        }
        if !self.is_inline && member(global, value, "_isMockFunction")?.to_boolean() {
            return self.print_mock_function(out, value).map(|()| true);
        }
        Ok(false)
    }

    fn print_function(&self, out: &mut Vec<u8>, function: JSValue) -> JsResult<()> {
        if !self.is_inline && !self.print_function_name {
            out.extend_from_slice(b"[Function]");
            return Ok(());
        }
        out.extend_from_slice(b"[Function ");
        match first_truthy(self.global_this, function, &["name"])? {
            Some(name) => write_string(self.global_this, out, name)?,
            None => out.extend_from_slice(b"anonymous"),
        }
        out.push(b']');
        Ok(())
    }

    fn print_object_like_pretty_format(
        &mut self,
        out: &mut Vec<u8>,
        value: JSValue,
        has_called_to_json: bool,
    ) -> JsResult<()> {
        let global = self.global_this;
        if self.print_with_plugin(out, value)? {
            return Ok(());
        }
        if value.is_callable() {
            return self.print_function(out, value);
        }

        let kind = Kind::of(global, value)?;
        match kind {
            Kind::WeakMap => out.extend_from_slice(b"WeakMap {}"),
            Kind::WeakSet => out.extend_from_slice(b"WeakSet {}"),
            Kind::Function => self.print_function(out, value)?,
            Kind::Promise if self.snapshot_format == SnapshotFormat::Jest => out.extend_from_slice(b"Promise {}"),
            Kind::Symbol => {
                // `String(value).replace(/^Symbol\((.*)\)(.*)$/, "Symbol($1)")`
                let text = value.to_bun_string(global)?;
                let text = text.to_utf8();
                let text = text.slice();
                let end = if text.starts_with(b"Symbol(") && !strings::contains_char(text, b'\n') {
                    strings::last_index_of_char(text, b')').map_or(text.len(), |i| i + 1)
                } else {
                    text.len()
                };
                out.extend_from_slice(&text[..end]);
            }
            Kind::Date => {
                let mut buf = [0u8; 64];
                out.extend_from_slice(value.to_iso_string(global, &mut buf).unwrap_or(b"Date { NaN }"));
            }
            Kind::Error => {
                // `Error.prototype.toString.call(value)`
                let name = member(global, value, "name")?;
                let message = member(global, value, "message")?;
                out.push(b'[');
                let start = out.len();
                if name.is_undefined() {
                    out.extend_from_slice(b"Error");
                } else {
                    write_string(global, out, name)?;
                }
                if !message.is_undefined() {
                    let name_end = out.len();
                    out.extend_from_slice(b": ");
                    write_string(global, out, message)?;
                    if out.len() == name_end + 2 {
                        out.truncate(name_end);
                    } else if name_end == start {
                        out.drain(start..start + 2);
                    }
                }
                out.push(b']');
            }
            Kind::RegExp => {
                let mut text = vec![b'/'];
                write_string(global, &mut text, member(global, value, "source")?)?;
                text.push(b'/');
                write_string(global, &mut text, member(global, value, "flags")?)?;
                let mut rest = text.as_slice();
                // pretty-format's `escapeRegex` option.
                while !self.is_inline
                    && let Some(i) = strings::index_of_any(rest, b"$()*+.?[\\]^{|}")
                {
                    out.extend_from_slice(&rest[..i]);
                    out.extend_from_slice(&[b'\\', rest[i]]);
                    rest = &rest[i + 1..];
                }
                out.extend_from_slice(rest);
            }
            _ => {
                if self.ancestors.includes(value) {
                    out.extend_from_slice(b"[Circular]");
                    return Ok(());
                }
                self.ancestors.push(global, value)?;
                let result = self.deeper(|this| this.print_complex_value(out, value, kind, has_called_to_json));
                self.ancestors.pop();
                return result;
            }
        }
        Ok(())
    }

    fn print_complex_value(
        &mut self,
        out: &mut Vec<u8>,
        value: JSValue,
        kind: Kind,
        has_called_to_json: bool,
    ) -> JsResult<()> {
        let global = self.global_this;
        let hit_max_depth = self.depth > self.max_depth;
        // Only Bun gives these a `toJSON()`. Node doesn't.
        let is_bun_extension = matches!(value.get_class_info_name(), Some(b"Headers" | b"FormData" | b"URLSearchParams"));
        if self.call_to_json && !hit_max_depth && !has_called_to_json && !is_bun_extension {
            let to_json = member(global, value, "toJSON")?;
            if to_json.is_callable() {
                let json = to_json.call(global, value, &[])?;
                return self.print_like_pretty_format(out, json, true);
            }
        }

        match kind {
            Kind::Arguments if hit_max_depth => out.extend_from_slice(b"[Arguments]"),
            Kind::Arguments => {
                out.extend_from_slice(if self.is_inline { b"[" } else { b"Arguments [" });
                self.print_list_items(out, value)?;
                out.push(b']');
            }
            Kind::List => {
                let name = member(global, member(global, value, "constructor")?, "name")?;
                if hit_max_depth {
                    out.push(b'[');
                    write_string(global, out, name)?;
                    out.push(b']');
                    return Ok(());
                }
                if self.print_basic_prototype || !is_text(global, name, b"Array")? {
                    write_string(global, out, name)?;
                    out.push(b' ');
                }
                out.push(b'[');
                self.print_list_items(out, value)?;
                out.push(b']');
            }
            Kind::Map if hit_max_depth => out.extend_from_slice(b"[Map]"),
            Kind::Map => {
                out.extend_from_slice(b"Map {");
                self.print_iterated(out, value, "entries", Some(b" => "), true)?;
                out.push(b'}');
            }
            Kind::Set if hit_max_depth => out.extend_from_slice(b"[Set]"),
            Kind::Set => {
                out.extend_from_slice(b"Set {");
                self.print_iterated(out, value, "values", None, true)?;
                out.push(b'}');
            }
            _ if hit_max_depth || matches!(value.js_type(), JSType::GlobalProxy | JSType::GlobalObject) => {
                out.push(b'[');
                self.write_constructor_name(out, value, b"")?;
                out.truncate(out.len() - 1);
                out.push(b']');
            }
            _ => {
                self.write_constructor_name(out, value, b"Object")?;
                out.push(b'{');
                self.print_object_properties(out, value)?;
                out.push(b'}');
            }
        }
        Ok(())
    }

    fn write_constructor_name(&mut self, out: &mut Vec<u8>, value: JSValue, basic: &[u8]) -> JsResult<()> {
        let global = self.global_this;
        let start = out.len();
        let constructor = member(global, value, "constructor")?;
        match if constructor.is_callable() { first_truthy(global, constructor, &["name"])? } else { None } {
            Some(name) => write_string(global, out, name)?,
            None => out.extend_from_slice(b"Object"),
        }
        if &out[start..] == basic && !self.print_basic_prototype {
            out.truncate(start);
        } else {
            out.push(b' ');
        }
        Ok(())
    }

    fn print_list_items(&mut self, out: &mut Vec<u8>, list: JSValue) -> JsResult<()> {
        use std::io::Write as _;
        let global = self.global_this;
        self.print_indented(out, &mut |this, out| {
            if matches!(list.js_type(), JSType::ArrayBuffer | JSType::DataView) {
                let Some(buffer) = list.as_array_buffer(global) else { return Ok(()) };
                let bytes = buffer.byte_slice();
                for (i, byte) in bytes.iter().enumerate() {
                    this.start_item(out);
                    if i == this.max_width as usize {
                        write_rest(out, Some((bytes.len() - i) as f64));
                        break;
                    }
                    let _ = write!(out, "{}", *byte as i8);
                    this.end_item(out);
                }
                return Ok(());
            }
            let length = length_of(global, list)?;
            for i in 0..length {
                this.check_length(out.len())?;
                this.start_item(out);
                if i == this.max_width {
                    write_rest(out, Some(f64::from(length - i)));
                    break;
                }
                let value = if list.is_object() { item(global, list, i)? } else { JSValue::UNDEFINED };
                if !value.is_undefined() || has_index(global, list, i)? {
                    this.print_child(out, value)?;
                }
                this.end_item(out);
            }
            Ok(())
        })
    }

    /// `has_size`: Vitest passes `collection.size` for a Map or Set, so the ellipsis can say how many items are left.
    fn print_iterated(
        &mut self,
        out: &mut Vec<u8>,
        collection: JSValue,
        method: &'static str,
        separator: Option<&[u8]>,
        has_size: bool,
    ) -> JsResult<()> {
        let global = self.global_this;
        let function = member(global, collection, method)?;
        let max_width = self.max_width;
        let rest = if has_size && self.snapshot_format == SnapshotFormat::Vitest {
            Some(member(global, collection, "size")?).filter(|size| size.is_number()).map(|size| size.as_number() - f64::from(max_width))
        } else {
            None
        };
        self.print_indented(out, &mut |this, out| {
            let is_done = for_each_of_collection(global, collection, function, max_width, &mut |first, second| {
                this.start_item(out);
                if first.is_empty() {
                    write_rest(out, rest);
                    return Ok(());
                }
                this.print_child(out, first)?;
                if let Some(separator) = separator {
                    out.extend_from_slice(separator);
                    this.print_child(out, second)?;
                }
                this.end_item(out);
                Ok(())
            })?;
            if is_done {
                return Ok(());
            }
            let iterator = call(global, function, collection, method, &[])?;
            loop {
                let current = call_method(global, iterator, "next", &[])?;
                if member(global, current, "done")?.to_boolean() {
                    return Ok(());
                }
                this.check_length(out.len())?;
                this.start_item(out);
                if this.items - 1 == max_width {
                    write_rest(out, rest);
                    return Ok(());
                }
                let value = member(global, current, "value")?;
                match separator {
                    Some(separator) => {
                        this.print_child(out, item(global, value, 0)?)?;
                        out.extend_from_slice(separator);
                        this.print_child(out, item(global, value, 1)?)?;
                    }
                    None => this.print_child(out, value)?,
                }
                this.end_item(out);
            }
        })
    }

    fn print_object_properties(&mut self, out: &mut Vec<u8>, object: JSValue) -> JsResult<()> {
        let global = self.global_this;
        self.print_indented(out, &mut |this, out| {
            for_each_property(global, object, this.snapshot_format, !this.is_inline, this.max_width, &mut |key, value| {
                this.start_item(out);
                if key.is_empty() {
                    write_rest(out, Some(value.as_number()));
                    return Ok(());
                }
                if this.is_inline && key.is_string() && is_unquotable_key(key.to_bun_string(global)?.to_utf8().slice()) {
                    write_string(global, out, key)?;
                } else {
                    this.print_child(out, key)?;
                }
                out.extend_from_slice(b": ");
                this.print_child(out, value)?;
                this.end_item(out);
                Ok(())
            })
        })
    }

    #[optimize(size)]
    fn print_mock_function(&mut self, out: &mut Vec<u8>, mock_function: JSValue) -> JsResult<()> {
        let global = self.global_this;
        let is_vitest = self.snapshot_format == SnapshotFormat::Vitest;
        let name = call_method(global, mock_function, "getMockName", &[])?;
        out.extend_from_slice(b"[MockFunction");
        if !is_text(global, name, if is_vitest { b"vi.fn()" } else { b"jest.fn()" })? {
            out.push(b' ');
            write_string(global, out, name)?;
        }
        out.push(b']');

        let calls = member(global, member(global, mock_function, "mock")?, "calls")?;
        let length = member(global, calls, "length")?;
        // Vitest: `length !== 0`. Jest: `length > 0`.
        let has_calls = if is_vitest { !length.is_number() || length.as_number() != 0.0 } else { to_number(global, length)? > 0.0 };
        if !has_calls {
            return Ok(());
        }
        out.extend_from_slice(b" {");
        self.print_indented(out, &mut |this, out| {
            this.new_line(out);
            out.extend_from_slice(b"\"calls\": ");
            this.print_child(out, calls)?;
            out.push(b',');
            this.new_line(out);
            out.extend_from_slice(b"\"results\": ");
            this.print_child(out, member(global, member(global, mock_function, "mock")?, "results")?)?;
            out.push(b',');
            Ok(())
        })?;
        out.push(b'}');
        Ok(())
    }

    #[optimize(size)]
    fn print_asymmetric_matcher_like_pretty_format(&mut self, out: &mut Vec<u8>, value: JSValue) -> JsResult<bool> {
        use std::io::Write as _;
        let global = self.global_this;
        let name = |flags: expect::Flags, is: &'static str, is_not: &'static str| -> &'static [u8] {
            (if flags.not() { is_not } else { is }).as_bytes()
        };
        if let Some(matcher) = value.as_class_ref::<expect::ExpectArrayContaining>() {
            let Some(sample) = js_ExpectArrayContaining::array_value_get_cached(value) else { return Ok(false) };
            if self.is_at_max_depth() {
                out.extend_from_slice(name(matcher.flags, "[ArrayContaining]", "[ArrayNotContaining]"));
                return Ok(true);
            }
            out.extend_from_slice(name(matcher.flags, "ArrayContaining [", "ArrayNotContaining ["));
            self.deeper(|this| this.print_list_items(out, sample))?;
            out.push(b']');
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectObjectContaining>() {
            let Some(sample) = js_ExpectObjectContaining::object_value_get_cached(value) else { return Ok(false) };
            if self.is_at_max_depth() {
                out.extend_from_slice(name(matcher.flags, "[ObjectContaining]", "[ObjectNotContaining]"));
                return Ok(true);
            }
            out.extend_from_slice(name(matcher.flags, "ObjectContaining {", "ObjectNotContaining {"));
            self.deeper(|this| this.print_object_properties(out, sample))?;
            out.push(b'}');
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringContaining>() {
            let Some(sample) = js_ExpectStringContaining::string_value_get_cached(value) else { return Ok(false) };
            out.extend_from_slice(name(matcher.flags, "StringContaining ", "StringNotContaining "));
            self.print_child(out, sample)?;
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectStringMatching>() {
            let Some(sample) = js_ExpectStringMatching::test_value_get_cached(value) else { return Ok(false) };
            out.extend_from_slice(name(matcher.flags, "StringMatching ", "StringNotMatching "));
            self.print_child(out, to_reg_exp(global, sample)?)?;
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectCloseTo>() {
            let (Some(number), Some(digits)) =
                (js_ExpectCloseTo::number_value_get_cached(value), js_ExpectCloseTo::digits_value_get_cached(value))
            else {
                return Ok(false);
            };
            out.extend_from_slice(name(matcher.flags, "NumberCloseTo ", "NumberNotCloseTo "));
            write_string(global, out, number)?;
            let digits = digits.to_int32();
            let _ = write!(out, " ({} digit{})", digits, if digits == 1 { "" } else { "s" });
        } else if let Some(matcher) = value.as_class_ref::<expect::ExpectCustomAsymmetricMatcher>() {
            let (Some(arguments), Some(matcher_fn)) =
                (js_ExpectCustomAsymmetricMatcher::captured_args_get_cached(value), js_ExpectCustomAsymmetricMatcher::matcher_fn_get_cached(value))
            else {
                return Ok(false);
            };
            if matcher.flags.not() {
                out.extend_from_slice(b"not.");
            }
            out.extend_from_slice(matcher_fn.get_name(global)?.to_utf8().slice());
            out.push(b'<');
            let mut iter = arguments.array_iterator(global)?;
            while let Some(argument) = iter.next()? {
                if iter.i > 1 {
                    out.extend_from_slice(b", ");
                }
                if self.snapshot_format == SnapshotFormat::Vitest {
                    let outer = (
                        core::mem::take(&mut self.indent),
                        core::mem::replace(&mut self.print_basic_prototype, true),
                        core::mem::replace(&mut self.print_function_name, true),
                        core::mem::take(&mut self.is_inline),
                        core::mem::replace(&mut self.max_depth, u32::MAX),
                        core::mem::replace(&mut self.max_width, u32::MAX),
                    );
                    let result = self.print_child(out, argument);
                    (
                        self.indent,
                        self.print_basic_prototype,
                        self.print_function_name,
                        self.is_inline,
                        self.max_depth,
                        self.max_width,
                    ) = outer;
                    result?;
                } else {
                    out.extend_from_slice(argument.to_bun_string(global)?.to_utf8().slice());
                }
            }
            out.push(b'>');
        } else if value.as_class_ref::<expect::ExpectAny>().is_some() {
            let Some(constructor) = js_ExpectAny::constructor_value_get_cached(value) else { return Ok(false) };
            out.extend_from_slice(b"Any<");
            let name = constructor.get_class_name(global)?;
            let name = name.to_utf8();
            out.extend_from_slice(if name.slice().is_empty() { b"<anonymous>" } else { name.slice() });
            out.push(b'>');
        } else if value.as_class_ref::<expect::ExpectAnything>().is_some() {
            out.extend_from_slice(b"Anything");
        } else {
            return Ok(false);
        }
        Ok(true)
    }

    #[cold]
    #[optimize(size)]
    fn print_foreign_asymmetric_matcher(&mut self, out: &mut Vec<u8>, matcher: JSValue) -> JsResult<()> {
        let global = self.global_this;
        let name = call_method(global, matcher, "toString", &[])?;
        let is_one_of = |names: &[&str]| -> JsResult<bool> {
            for known in names {
                if is_text(global, name, known.as_bytes())? {
                    return Ok(true);
                }
            }
            Ok(false)
        };
        let is_list = is_one_of(&["ArrayContaining", "ArrayNotContaining"])?;
        if (is_list || is_one_of(&["ObjectContaining", "ObjectNotContaining"])?) && self.is_at_max_depth() {
            out.push(b'[');
            write_string(global, out, name)?;
            out.push(b']');
        } else if is_list {
            write_string(global, out, name)?;
            out.extend_from_slice(b" [");
            let sample = member(global, matcher, "sample")?;
            self.deeper(|this| this.print_list_items(out, sample))?;
            out.push(b']');
        } else if is_one_of(&["ObjectContaining", "ObjectNotContaining"])? {
            write_string(global, out, name)?;
            out.extend_from_slice(b" {");
            let sample = member(global, matcher, "sample")?;
            self.deeper(|this| this.print_object_properties(out, sample))?;
            out.push(b'}');
        } else if is_one_of(&["StringMatching", "StringNotMatching", "StringContaining", "StringNotContaining"])? {
            write_string(global, out, name)?;
            out.push(b' ');
            self.print_child(out, member(global, matcher, "sample")?)?;
        } else {
            let to_asymmetric_matcher = member(global, matcher, "toAsymmetricMatcher")?;
            if !to_asymmetric_matcher.is_callable() {
                let class = member(global, member(global, matcher, "constructor")?, "name")?.to_bun_string(global)?;
                return Err(global.throw_type_error(format_args!(
                    "Asymmetric matcher {class} does not implement toAsymmetricMatcher()"
                )));
            }
            write_printed_by_plugin(global, out, to_asymmetric_matcher.call(global, matcher, &[])?)?;
        }
        Ok(())
    }

    fn print_immutable(&mut self, out: &mut Vec<u8>, value: JSValue) -> JsResult<bool> {
        let global = self.global_this;
        let is_true = |name: &'static str| Ok::<bool, JsError>(member(global, value, name)? == JSValue::TRUE);
        if !is_true("@@__IMMUTABLE_ITERABLE__@@")? && !is_true("@@__IMMUTABLE_RECORD__@@")? {
            return Ok(false);
        }
        let has = |names: &[&'static str]| Ok::<bool, JsError>(first_truthy(global, value, names)?.is_some());
        let (name, keyed, listed): (&[u8], bool, bool) = if has(&["@@__IMMUTABLE_MAP__@@"])? {
            (if has(&["@@__IMMUTABLE_ORDERED__@@"])? { b"OrderedMap" } else { b"Map" }, true, true)
        } else if has(&["@@__IMMUTABLE_LIST__@@"])? {
            (b"List", false, true)
        } else if has(&["@@__IMMUTABLE_SET__@@"])? {
            (if has(&["@@__IMMUTABLE_ORDERED__@@"])? { b"OrderedSet" } else { b"Set" }, false, true)
        } else if has(&["@@__IMMUTABLE_STACK__@@"])? {
            (b"Stack", false, true)
        } else if !has(&["@@__IMMUTABLE_SEQ__@@"])? {
            return self.print_immutable_record(out, value).map(|()| true);
        } else if has(&["@@__IMMUTABLE_KEYED__@@"])? {
            (b"Seq", true, has(&["_iter", "_object"])?)
        } else {
            (b"Seq", false, has(&["_iter", "_array", "_collection", "_iterable"])?)
        };

        if self.is_at_max_depth() {
            out.extend_from_slice(b"[Immutable.");
            out.extend_from_slice(name);
            out.push(b']');
            return Ok(true);
        }
        out.extend_from_slice(b"Immutable.");
        out.extend_from_slice(name);
        out.extend_from_slice(if keyed { b" {" } else { b" [" });
        if !listed {
            out.extend_from_slice("\u{2026}".as_bytes());
        } else if keyed {
            self.deeper(|this| this.print_iterated(out, value, "entries", Some(b": "), false))?;
        } else {
            self.deeper(|this| this.print_iterated(out, value, "values", None, false))?;
        }
        out.push(if keyed { b'}' } else { b']' });
        Ok(true)
    }

    #[optimize(size)]
    fn print_immutable_record(&mut self, out: &mut Vec<u8>, record: JSValue) -> JsResult<()> {
        let global = self.global_this;
        let is_leaf = self.is_at_max_depth();
        out.extend_from_slice(if is_leaf { b"[Immutable." } else { b"Immutable." });
        match first_truthy(global, record, &["_name"])? {
            Some(name) => write_string(global, out, name)?,
            None => out.extend_from_slice(b"Record"),
        }
        if is_leaf {
            out.push(b']');
            return Ok(());
        }
        out.extend_from_slice(b" {");
        self.depth += 1;
        let result = self.print_indented(out, &mut |this, out| {
            let mut i = 0;
            // The plugin re-reads `_keys` and its length on every iteration, so don't hoist them.
            while i < length_of(global, member(global, record, "_keys")?)? {
                let key = item(global, member(global, record, "_keys")?, i)?;
                i += 1;
                let value = call_method(global, record, "get", &[key])?;
                this.check_length(out.len())?;
                this.start_item(out);
                if i - 1 == this.max_width {
                    write_rest(out, None);
                    break;
                }
                this.print_child(out, key)?;
                out.extend_from_slice(b": ");
                this.print_child(out, value)?;
                this.end_item(out);
            }
            Ok(())
        });
        self.depth -= 1;
        result?;
        out.push(b'}');
        Ok(())
    }

    #[optimize(size)]
    fn print_markup(
        &mut self,
        out: &mut Vec<u8>,
        tag: &[u8],
        props: Option<JSValue>,
        skip_children_prop: bool,
        children: Option<JSValue>,
    ) -> JsResult<()> {
        let global = self.global_this;
        out.push(b'<');
        out.extend_from_slice(tag);

        let after_tag = out.len();
        self.indent += 1;
        let printed_props = props.map_or(Ok(()), |props| {
            for_each_sorted_property(global, props, self.snapshot_format, &mut |key, value| {
                if !key.is_string() || value.is_undefined() {
                    return Ok(());
                }
                let key = key.to_bun_string(global)?;
                if skip_children_prop && key.eq_ascii(b"children") {
                    return Ok(());
                }
                if self.snapshot_format == SnapshotFormat::Vitest
                    && value.is_string_literal()
                    && is_hidden_by_vitest(value.to_bun_string(global)?.to_utf8().slice())
                {
                    return Ok(());
                }
                self.new_line(out);
                out.extend_from_slice(key.to_utf8().slice());
                out.push(b'=');
                // Print it on its own line inside the braces, then drop that line break if it fit on one line.
                let braces = !value.is_string_literal();
                let open = out.len() + 1;
                self.indent += 1;
                if braces {
                    out.push(b'{');
                    self.new_line(out);
                }
                let start = out.len();
                let result = self.print_child(out, value);
                self.indent -= 1;
                result?;
                if braces {
                    if strings::contains_char(&out[start..], b'\n') {
                        self.new_line(out);
                    } else {
                        out.drain(open..start);
                    }
                    out.push(b'}');
                }
                Ok(())
            })
        });
        self.indent -= 1;
        printed_props?;
        let has_props = out.len() != after_tag;
        if has_props {
            self.new_line(out);
        }

        let end_of_open_tag = out.len();
        out.push(b'>');
        if let Some(children) = children {
            self.indent += 1;
            let result = if skip_children_prop {
                self.print_flattened_children(out, children)
            } else {
                self.print_mapped_children(out, children)
            };
            self.indent -= 1;
            result?;
        }
        if out.len() == end_of_open_tag + 1 {
            out.truncate(end_of_open_tag);
            out.extend_from_slice(if has_props && !self.is_inline { b"/>" } else { b" />" });
            return Ok(());
        }
        self.new_line(out);
        out.extend_from_slice(b"</");
        out.extend_from_slice(tag);
        out.push(b'>');
        Ok(())
    }

    fn print_flattened_children(&mut self, out: &mut Vec<u8>, child: JSValue) -> JsResult<()> {
        let global = self.global_this;
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            return Err(global.throw_stack_overflow());
        }
        if is_array(global, child)? {
            for i in 0..length_of(global, child)? {
                self.print_flattened_children(out, item(global, child, i)?)?;
            }
            return Ok(());
        }
        if child.is_undefined_or_null() || child == JSValue::FALSE || (child.is_string_literal() && !child.to_boolean()) {
            return Ok(());
        }
        self.print_markup_child(out, child)
    }

    /// pretty-format's `printChildren(children)`, which calls `children.map()` and so skips holes.
    fn print_mapped_children(&mut self, out: &mut Vec<u8>, children: JSValue) -> JsResult<()> {
        let global = self.global_this;
        if !is_array(global, children)? {
            return Err(global.throw_type_error(format_args!("children.map is not a function")));
        }
        for i in 0..length_of(global, children)? {
            if has_index(global, children, i)? {
                self.print_markup_child(out, item(global, children, i)?)?;
            }
        }
        Ok(())
    }

    fn print_markup_child(&mut self, out: &mut Vec<u8>, child: JSValue) -> JsResult<()> {
        let global = self.global_this;
        self.check_length(out.len())?;
        self.new_line(out);
        if !child.is_string_literal() {
            return self.print_child(out, child);
        }
        let text = child.to_bun_string(global)?;
        let text = text.to_utf8();
        let mut rest = text.slice();
        while let Some(i) = strings::index_of_any(rest, b"<>") {
            out.extend_from_slice(&rest[..i]);
            out.extend_from_slice(if rest[i] == b'<' { b"&lt;" } else { b"&gt;" });
            rest = &rest[i + 1..];
        }
        out.extend_from_slice(rest);
        Ok(())
    }

    fn print_react_test_json(&mut self, out: &mut Vec<u8>, object: JSValue) -> JsResult<()> {
        let global = self.global_this;
        let tag = member(global, object, "type")?.to_bun_string(global)?;
        if self.is_at_max_depth() {
            Self::print_markup_as_leaf(out, tag.to_utf8().slice());
            return Ok(());
        }
        let props = Some(member(global, object, "props")?).filter(|props| props.to_boolean());
        let children = Some(member(global, object, "children")?).filter(|children| children.to_boolean());
        self.deeper(|this| this.print_markup(out, tag.to_utf8().slice(), props, false, children))
    }

    /// `legacy` means React 18 or older.
    fn print_react_element(&mut self, out: &mut Vec<u8>, element: JSValue, legacy: bool) -> JsResult<()> {
        let global = self.global_this;
        let tag = Self::react_type_name(global, member(global, element, "type")?, legacy)?;
        if self.is_at_max_depth() {
            Self::print_markup_as_leaf(out, &tag);
            return Ok(());
        }
        let props = member(global, element, "props")?;
        let children = if props.is_undefined_or_null() { None } else { Some(member(global, props, "children")?) };
        self.deeper(|this| this.print_markup(out, &tag, Some(props), true, children))
    }

    fn print_markup_as_leaf(out: &mut Vec<u8>, tag: &[u8]) {
        out.push(b'<');
        out.extend_from_slice(tag);
        out.extend_from_slice(" \u{2026} />".as_bytes());
    }

    fn react_type_name(global: &JSGlobalObject, type_: JSValue, legacy: bool) -> JsResult<Vec<u8>> {
        let text = |value: JSValue| -> JsResult<Vec<u8>> { Ok(value.to_bun_string(global)?.to_owned_slice()) };
        let wrapped = |wrapper: &str, name: Option<JSValue>| -> JsResult<Vec<u8>> {
            let mut wrapped = wrapper.as_bytes().to_vec();
            if let Some(name) = name {
                wrapped.push(b'(');
                wrapped.extend_from_slice(&text(name)?);
                wrapped.push(b')');
            }
            Ok(wrapped)
        };
        if type_.is_string_literal() {
            return text(type_);
        }
        if type_.is_callable() {
            return first_truthy(global, type_, &["displayName", "name"])?.map_or_else(|| Ok(b"Unknown".to_vec()), text);
        }
        let is = |symbol: JSValue, name: &'static [u8]| symbol.is_symbol() && symbol == JSValue::symbol_for(global, name);
        if is(type_, b"react.fragment") {
            return Ok(b"React.Fragment".to_vec());
        }
        if is(type_, b"react.suspense") {
            return Ok(b"React.Suspense".to_vec());
        }
        if type_.is_object() {
            let kind = member(global, type_, "$$typeof")?;
            if is(kind, if legacy { b"react.provider" } else { b"react.context" }) {
                return Ok(b"Context.Provider".to_vec());
            }
            if is(kind, if legacy { b"react.context" } else { b"react.consumer" }) {
                return Ok(b"Context.Consumer".to_vec());
            }
            if is(kind, b"react.forward_ref") {
                if let Some(name) = first_truthy(global, type_, &["displayName"])? {
                    return text(name);
                }
                return wrapped("ForwardRef", first_truthy(global, member(global, type_, "render")?, &["displayName", "name"])?);
            }
            if is(kind, b"react.memo") {
                let name = match first_truthy(global, type_, &["displayName"])? {
                    Some(name) => Some(name),
                    None => first_truthy(global, member(global, type_, "type")?, &["displayName", "name"])?,
                };
                return wrapped("Memo", name);
            }
        }
        Ok(b"UNDEFINED".to_vec())
    }
}

impl JestPrettyFormat {
    pub(crate) fn add_snapshot_serializer(global: &JSGlobalObject, plugin: JSValue) -> JsResult<()> {
        let is_function = |name: &str| Ok::<bool, JsError>(plugin.get(global, name)?.is_some_and(|value| value.is_callable()));
        if !plugin.is_object() || !is_function("test")? || !(is_function("serialize")? || is_function("print")?) {
            return Err(global.throw_invalid_argument_type_value(
                "serializer",
                "object with a test() and a serialize() or print() function",
                plugin,
            ));
        }

        let utils_value = expect::ExpectMatcherUtils::singleton(global);
        let Some(utils) = expect::ExpectMatcherUtils::from_js(utils_value) else { return Ok(()) };
        // SAFETY: `utils_value` is on the stack and owns the payload.
        let utils = unsafe { &*utils };

        let is_of_file = expect::Expect::is_called_by_test_file(global);
        let serializers = JSValue::create_empty_array(global, 0)?;
        serializers.push(global, plugin)?;
        if let Some(registered) = Self::serializers(global)? {
            let mut iter = registered.array_iterator(global)?;
            while let Some(earlier) = iter.next()? {
                // A shared helper that every test file calls would otherwise register its serializer once per file.
                if !is_of_file && earlier == plugin && utils.serializers_of_file.get().get(iter.i as usize - 1) == Some(&false) {
                    return Ok(());
                }
                serializers.push(global, earlier)?;
            }
        }
        js_ExpectMatcherUtils::snapshot_serializers_set_cached(utils_value, global, serializers);
        utils.serializers_of_file.with_mut(|of_file| of_file.insert(0, is_of_file));
        Ok(())
    }

    /// Most recently added first. Drops the ones an earlier test file registered itself.
    #[optimize(size)]
    fn serializers(global: &JSGlobalObject) -> JsResult<Option<JSValue>> {
        let utils_value = expect::ExpectMatcherUtils::singleton(global);
        let Some(utils) = expect::ExpectMatcherUtils::from_js(utils_value) else { return Ok(None) };
        // SAFETY: `utils_value` is on the stack and owns the payload.
        let utils = unsafe { &*utils };
        let file = super::jest::Jest::file_generation(global);
        let is_same_file = utils.serializers_file.replace(file) == file;
        let Some(serializers) = js_ExpectMatcherUtils::snapshot_serializers_get_cached(utils_value) else {
            return Ok(None);
        };
        if is_same_file || !utils.serializers_of_file.get().contains(&true) {
            return Ok(Some(serializers));
        }

        let of_file = utils.serializers_of_file.replace(Vec::new());
        let kept = JSValue::create_empty_array(global, 0)?;
        let mut count = 0;
        let mut iter = serializers.array_iterator(global)?;
        for is_of_file in of_file {
            let Some(serializer) = iter.next()? else { break };
            if !is_of_file {
                kept.put_index(global, count, serializer)?;
                count += 1;
            }
        }
        utils.serializers_of_file.set(vec![false; count as usize]);
        if count == 0 {
            js_ExpectMatcherUtils::snapshot_serializers_set_cached(utils_value, global, JSValue::ZERO);
            return Ok(None);
        }
        js_ExpectMatcherUtils::snapshot_serializers_set_cached(utils_value, global, kept);
        Ok(Some(kept))
    }

    pub(crate) fn printer(
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
        config: JsLocal<'_>,
        indentation: JsLocal<'_>,
        _depth: JsLocal<'_>,
        refs: JsLocal<'_>,
        has_called_to_json: bool,
    ) -> JsResult<JSValue> {
        Self::print_for_serializer(cx.global(), value.to_js(), config.to_js(), indentation.to_js(), refs.to_js(), has_called_to_json)
    }

    /// `call_serializer` binds `config`, `indentation` and `refs`.
    pub(crate) fn print_child(
        cx: &mut JsScope<'_>,
        config: JsLocal<'_>,
        indentation: JsLocal<'_>,
        refs: JsLocal<'_>,
        value: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        Self::print_for_serializer(cx.global(), value.to_js(), config.to_js(), indentation.to_js(), refs.to_js(), false)
    }

    /// `call_serializer` binds `indentation`.
    #[optimize(size)]
    pub(crate) fn indent(cx: &mut JsScope<'_>, indentation: JsLocal<'_>, text: JsLocal<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        let indentation = indentation.to_js().to_bun_string(global)?.to_owned_slice();
        let mut indented = indentation.clone();
        indent_lines(&mut indented, text.to_js().to_bun_string(global)?.to_utf8().slice(), &indentation);
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, &indented)
    }

    #[optimize(size)]
    fn print_for_serializer(
        global: &JSGlobalObject,
        value: JSValue,
        config: JSValue,
        indentation: JSValue,
        refs: JSValue,
        has_called_to_json: bool,
    ) -> JsResult<JSValue> {
        let mut formatter = Formatter::new(global, SnapshotFormat::Jest);
        if config.is_object() {
            formatter.config = Some(config);
            if first_truthy(global, config, &["printShadowRoot"])?.is_some() {
                formatter.snapshot_format = SnapshotFormat::Vitest;
            }
            formatter.serializers = config.get(global, "plugins")?.filter(|plugins| plugins.is_array());
        }
        if refs.is_array() {
            let mut iter = refs.array_iterator(global)?;
            while let Some(ancestor) = iter.next()? {
                formatter.ancestors.push(global, ancestor)?;
            }
        }
        let indentation = if indentation.is_string() { indentation.to_bun_string(global)?.to_owned_slice() } else { Vec::new() };
        let is_levels = indentation.len() % 2 == 0 && indentation.iter().all(|byte| *byte == b' ');
        if is_levels {
            formatter.indent = (indentation.len() / 2) as u32;
        }

        let mut printed = Vec::new();
        formatter.print_like_pretty_format(&mut printed, value, has_called_to_json)?;
        if !is_levels {
            let mut indented = Vec::new();
            indent_lines(&mut indented, &printed, &indentation);
            printed = indented;
        }
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, &printed)
    }
}

fn indent_lines(out: &mut Vec<u8>, text: &[u8], indentation: &[u8]) {
    let mut rest = text;
    while let Some(i) = strings::index_of_char_usize(rest, b'\n') {
        out.extend_from_slice(&rest[..=i]);
        out.extend_from_slice(indentation);
        rest = &rest[i + 1..];
    }
    out.extend_from_slice(rest);
}

impl Formatter<'_> {
    #[cold]
    #[inline(never)]
    fn print_with_serializer(&mut self, out: &mut Vec<u8>, value: JSValue) -> JsResult<bool> {
        let global = self.global_this;
        let Some(serializers) = self.serializers else { return Ok(false) };
        let mut iter = serializers.array_iterator(global)?;
        while let Some(plugin) = iter.next()? {
            if !plugin.is_object() {
                continue;
            }
            let Some(test) = plugin.get(global, "test")?.filter(|test| test.is_callable()) else { continue };
            if !test.call(global, plugin, &[value])?.to_boolean() {
                continue;
            }
            let printed = self.call_serializer(plugin, value)?;
            write_printed_by_plugin(global, out, printed)?;
            return Ok(true);
        }
        Ok(false)
    }

    #[optimize(size)]
    fn call_serializer(&mut self, plugin: JSValue, value: JSValue) -> JsResult<JSValue> {
        let global = self.global_this;
        let text = |text: &'static str| bun_core::String::static_(text).to_js(global);
        let spaces = |levels: u32| bun_jsc::bun_string_jsc::create_utf8_for_js(global, &vec![b' '; levels as usize * 2]);

        let config = if let Some(config) = self.config {
            config
        } else {
            let no_color = JSValue::create_empty_object(global, 2);
            no_color.put(global, b"close", text("")?);
            no_color.put(global, b"open", text("")?);
            let colors = JSValue::create_empty_object(global, 5);
            for name in [&b"comment"[..], b"content", b"prop", b"tag", b"value"] {
                colors.put(global, name, no_color);
            }
            let config = JSValue::create_empty_object(global, 14);
            config.put(global, b"callToJSON", JSValue::TRUE);
            config.put(global, b"colors", colors);
            config.put(global, b"compareKeys", JSValue::UNDEFINED);
            config.put(global, b"escapeRegex", JSValue::TRUE);
            config.put(global, b"escapeString", JSValue::FALSE);
            config.put(global, b"indent", text("  ")?);
            config.put(global, b"maxDepth", JSValue::js_number(f64::INFINITY));
            config.put(global, b"maxWidth", JSValue::js_number(f64::INFINITY));
            config.put(global, b"min", JSValue::FALSE);
            config.put(global, b"plugins", self.serializers.unwrap_or(JSValue::UNDEFINED));
            config.put(global, b"printBasicPrototype", JSValue::FALSE);
            config.put(global, b"printFunctionName", JSValue::FALSE);
            config.put(global, b"spacingInner", text("\n")?);
            config.put(global, b"spacingOuter", text("\n")?);
            if self.snapshot_format == SnapshotFormat::Vitest {
                config.put(global, b"printShadowRoot", JSValue::TRUE);
            }
            self.config = Some(config);
            config
        };
        let indentation = spaces(self.indent)?;
        let refs = self.ancestors.to_js_array(global)?;

        if let Some(serialize) = plugin.get(global, "serialize")?.filter(|serialize| serialize.is_callable()) {
            let depth = JSValue::js_number(f64::from(self.ancestors.len));
            let printer = jsc::JSFunction::create(global, "printer", generated::Bun__JestPrettyFormat__printer, 6, Default::default());
            return serialize.call(global, plugin, &[value, config, indentation, depth, refs, printer]);
        }

        let Some(print) = plugin.get(global, "print")?.filter(|print| print.is_callable()) else {
            return Ok(JSValue::UNDEFINED);
        };
        let print_child = jsc::JSFunction::create(global, "print", generated::Bun__JestPrettyFormat__printChild, 1, Default::default()).bind(
            global,
            JSValue::UNDEFINED,
            &bun_core::String::static_("print"),
            1.0,
            &[config, indentation, refs],
        )?;
        let indent = jsc::JSFunction::create(global, "indent", generated::Bun__JestPrettyFormat__indent, 1, Default::default()).bind(
            global,
            JSValue::UNDEFINED,
            &bun_core::String::static_("indent"),
            1.0,
            &[spaces(self.indent + 1)?],
        )?;
        let options = JSValue::create_empty_object(global, 3);
        options.put(global, b"edgeSpacing", text("\n")?);
        options.put(global, b"min", JSValue::FALSE);
        options.put(global, b"spacing", text("\n")?);
        let colors = config.get(global, "colors")?.unwrap_or(JSValue::UNDEFINED);
        print.call(global, plugin, &[value, print_child, indent, options, colors])
    }
}
