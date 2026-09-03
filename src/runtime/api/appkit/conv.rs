//! JavaScript values in, `bun_appkit` types out; `bun_appkit` errors in,
//! JavaScript exceptions out.

use bun_appkit::dynamic::{DynValue, Enc, Scalar, Signature};
use bun_appkit::{DynObject, Named, NsStr};
use bun_core::strings;
use bun_jsc::{ErrorCode, JSBigInt, JSGlobalObject, JSType, JSValue, JsError, JsResult, StringJsc};

use super::objc::{ObjCClass, ObjCObject, ObjCSelector};

/// A JavaScript string held alive so AppKit can read its characters in place.
pub(crate) struct JsStr(bun_core::String);

impl JsStr {
    /// `what` names the value in the TypeError when `value` is not a string.
    pub(crate) fn new(
        global: &JSGlobalObject,
        value: JSValue,
        what: core::fmt::Arguments<'_>,
    ) -> JsResult<JsStr> {
        if !value.is_string() {
            return Err(global.throw_invalid_arguments(format_args!("{what} must be a string")));
        }
        Ok(JsStr(bun_core::String::from_js(value, global)?))
    }

    pub(crate) fn ns(&self) -> NsStr<'_> {
        let s: &bun_core::String = &self.0;
        debug_assert!(!s.is_utf8(), "JsStr is always WTF-backed");
        if s.is_utf16() {
            NsStr::Utf16(s.utf16())
        } else {
            NsStr::Latin1(s.latin1())
        }
    }

    /// Transcodes once; a lone surrogate becomes U+FFFD.
    pub(crate) fn to_utf8(&self) -> Utf8 {
        Utf8(match self.ns() {
            NsStr::Utf16(w) => String::from_utf16_lossy(w),
            NsStr::Latin1(b) => b.iter().map(|&c| char::from(c)).collect(),
            NsStr::Utf8(s) => s.to_owned(),
        })
    }
}

/// A JavaScript string transcoded to UTF-8.
#[derive(Default)]
pub(crate) struct Utf8(String);

impl Utf8 {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn into_string(self) -> String {
        self.0
    }
}

impl core::ops::Deref for Utf8 {
    type Target = str;
    fn deref(&self) -> &str {
        self.as_str()
    }
}

impl core::fmt::Display for Utf8 {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.as_str())
    }
}

pub(crate) fn utf16_to_js(global: &JSGlobalObject, text: &[u16]) -> JsResult<JSValue> {
    bun_core::String::borrow_utf16(text).to_js(global)
}

pub(crate) fn str_to_js(global: &JSGlobalObject, text: &str) -> JsResult<JSValue> {
    bun_core::String::borrow_utf8(text.as_bytes()).to_js(global)
}

/// `null` (JavaScript's "reset") reads as `None`.
pub(crate) fn optional_string(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<JsStr>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if !value.is_string() {
        return Err(global.throw_invalid_arguments(format_args!("{what} must be a string or null")));
    }
    JsStr::new(global, value, what).map(Some)
}

pub(crate) fn number(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<f64> {
    if !value.is_number() {
        return Err(global.throw_invalid_arguments(format_args!("{what} must be a number")));
    }
    finite(global, value.as_number(), what)
}

/// `null` (JavaScript's "reset") reads as `None`.
pub(crate) fn optional_number(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<f64>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if !value.is_number() {
        return Err(global.throw_invalid_arguments(format_args!("{what} must be a number or null")));
    }
    finite(global, value.as_number(), what).map(Some)
}

fn finite(global: &JSGlobalObject, n: f64, what: core::fmt::Arguments<'_>) -> JsResult<f64> {
    if !n.is_finite() {
        return Err(global.throw_invalid_arguments(format_args!("{what} must be a finite number")));
    }
    Ok(n)
}

pub(crate) fn boolean(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<bool> {
    if !value.is_boolean() {
        return Err(global.throw_invalid_arguments(format_args!("{what} must be a boolean")));
    }
    Ok(value.as_boolean())
}

pub(crate) fn optional_boolean(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<bool>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if !value.is_boolean() {
        return Err(
            global.throw_invalid_arguments(format_args!("{what} must be a boolean or null"))
        );
    }
    Ok(Some(value.as_boolean()))
}

/// A string naming one of `T`'s variants; the TypeError lists them all.
pub(crate) fn one_of<T: Named>(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<T> {
    if value.is_string() {
        let name = JsStr::new(global, value, what)?.to_utf8();
        if let Some(v) = T::from_name(&name) {
            return Ok(v);
        }
    }
    let mut names = String::new();
    for (i, (name, _)) in T::ALL.iter().enumerate() {
        if i > 0 {
            names.push_str(if i + 1 == T::ALL.len() { " or " } else { ", " });
        }
        names.push('"');
        names.push_str(name);
        names.push('"');
    }
    Err(global.throw_invalid_arguments(format_args!("{what} must be {names}")))
}

/// An `Error` whose `name` is `name`, for failures scripts want to tell apart
/// with `instanceof`-free checks (`e.name === "GpuCompileError"`).
fn named_error(global: &JSGlobalObject, name: &'static str, err: &bun_appkit::Error) -> JsError {
    let instance = global.create_error_instance(format_args!("{err}"));
    match bun_core::String::static_(name).to_js(global) {
        Ok(name) => instance.put(global, b"name", name),
        Err(err) => return err,
    }
    global.throw_value(instance)
}

/// The JavaScript exception for a `bun_appkit` error: one code per kind of
/// refusal, as docs/runtime/objc.mdx lists them under Errors.
pub(crate) fn throw(global: &JSGlobalObject, err: bun_appkit::Error) -> JsError {
    use bun_appkit::Error as E;
    let coded = |code| global.err(code, format_args!("{err}")).throw();
    match err {
        E::Load(_) => coded(ErrorCode::OBJC_UNAVAILABLE),
        E::WrongThread
        | E::MainThreadOnly { .. }
        | E::CalledOnOtherThread { .. }
        | E::OtherThread(_) => coded(ErrorCode::OBJC_WRONG_THREAD),
        E::FunctionGone(_)
        | E::ObjectReleased
        | E::Consumed
        | E::NotInitialized
        | E::NoDisplay(_) => coded(ErrorCode::INVALID_STATE),
        E::NoClass(_) | E::NoProtocol(_) | E::NoSymbol(_) => coded(ErrorCode::OBJC_NOT_FOUND),
        E::Unrecognized { .. } => coded(ErrorCode::OBJC_UNRECOGNIZED_SELECTOR),
        E::ArgType { .. } => coded(ErrorCode::INVALID_ARG_TYPE),
        E::ArgCount { .. }
        | E::UnsupportedSignature { .. }
        | E::BlockSignature { .. }
        | E::NotAConstant(_)
        | E::NotAnObject(_)
        | E::ClassName(_)
        | E::RequiredMethods { .. }
        | E::NotASubclass { .. } => coded(ErrorCode::INVALID_ARG_VALUE),
        E::ReturnType { .. } => coded(ErrorCode::INVALID_RETURN_VALUE),
        E::OutOfBounds { .. }
        | E::IndexOutOfRange { .. }
        | E::InlineBytesTooLarge(_)
        | E::ZeroSize(_) => coded(ErrorCode::OUT_OF_RANGE),
        E::NoGpu => global.throw_type_error(format_args!("Metal is not available on this machine")),
        E::ShaderCompile { .. } | E::Pipeline { .. } => {
            named_error(global, "GpuCompileError", &err)
        }
        E::GpuExecution { .. } => named_error(global, "GpuExecutionError", &err),
        E::FrameState { .. }
        | E::NoPipeline
        | E::NoDrawable
        | E::TextureNotReadable
        | E::BufferNotAccessible
        | E::InvalidState(_) => coded(ErrorCode::INVALID_STATE),
        E::NoSuchFunction { .. } | E::Unsupported(_) => {
            global.throw_type_error(format_args!("{err}"))
        }
        E::Exception {
            name,
            reason,
            user_info,
            object,
        } => exception(global, &name, &reason, user_info.as_deref(), object),
    }
}

/// `ERR_OBJC_EXCEPTION`: `name` and `message` are the NSException's name and
/// reason, `userInfo` its `userInfo` printed, `exception` the thrown object.
fn exception(
    global: &JSGlobalObject,
    name: &str,
    reason: &str,
    user_info: Option<&str>,
    object: Option<DynObject>,
) -> JsError {
    let instance = global
        .err(ErrorCode::OBJC_EXCEPTION, format_args!("{reason}"))
        .to_js();
    let put = |key: &[u8], text: &str| {
        bun_core::String::clone_utf8(text.as_bytes())
            .to_js(global)
            .map(|value| instance.put(global, key, value))
    };
    if let Err(err) = put(b"name", name) {
        return err;
    }
    if let Some(user_info) = user_info
        && let Err(err) = put(b"userInfo", user_info)
    {
        return err;
    }
    if let Some(object) = object {
        instance.put(global, b"exception", ObjCObject::wrap(global, object));
    }
    global.throw_value(instance)
}

/// `Ok` or the JavaScript exception for the error.
pub(crate) fn check<T>(global: &JSGlobalObject, result: bun_appkit::Result<T>) -> JsResult<T> {
    result.map_err(|e| throw(global, e))
}

// ─────────────────────── the dynamic Objective-C bridge ──────────────────────

/// `value` itself, or the target of a `Proxy` (how `appkit.ts` dresses the
/// wrappers up for property-style sends).
pub(crate) fn through_proxy(value: JSValue) -> JSValue {
    if value.js_type() == JSType::ProxyObject {
        value.get_proxy_target()
    } else {
        value
    }
}

/// The `ObjCObject` wrapper `value` is or proxies.
pub(crate) fn objc_object<'a>(value: JSValue) -> Option<&'a ObjCObject> {
    through_proxy(value).as_class_ref::<ObjCObject>()
}

/// The `ObjCClass` wrapper `value` is or proxies.
pub(crate) fn objc_class<'a>(value: JSValue) -> Option<&'a ObjCClass> {
    through_proxy(value).as_class_ref::<ObjCClass>()
}

fn objc_selector<'a>(value: JSValue) -> Option<&'a ObjCSelector> {
    value.as_class_ref::<ObjCSelector>()
}

/// What kind of JavaScript value this is, for a message.
fn js_kind(value: JSValue) -> &'static str {
    if objc_object(value).is_some() {
        "an ObjCObject"
    } else if objc_class(value).is_some() {
        "an ObjCClass"
    } else if objc_selector(value).is_some() {
        "an ObjCSelector"
    } else if value.is_null() {
        "null"
    } else if value.is_undefined() {
        "undefined"
    } else if value.is_boolean() {
        "a boolean"
    } else if value.is_number() {
        "a number"
    } else if value.is_string() {
        "a string"
    } else if value.is_big_int() {
        "a bigint"
    } else if value.is_symbol() {
        "a symbol"
    } else if value.is_callable() {
        "a function"
    } else if value.is_array() {
        "an array"
    } else if value.is_date() {
        "a Date"
    } else {
        "an object"
    }
}

/// A plain `{}`: an ordinary object whose prototype is `Object.prototype`
/// or `null`, so class instances (a `View` passed where its `.native` was
/// meant) are refused rather than read as dictionaries.
fn is_plain_object(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    if !matches!(value.js_type(), JSType::Object | JSType::FinalObject) {
        return Ok(false);
    }
    let prototype = value.get_prototype(global)?;
    Ok(prototype.is_null() || prototype == global.object_prototype())
}

/// 2^53: integers up to this magnitude are exact as JavaScript numbers.
const SAFE_INTEGER_U64: u64 = 1 << 53;
const SAFE_INTEGER: f64 = SAFE_INTEGER_U64 as f64;

/// The Foundation object for a JavaScript value, the way `objc.ns()` and
/// `id`-typed arguments box: strings, numbers, booleans, bigints, `Date`s,
/// `ArrayBuffer`s and their views, arrays and plain objects (recursively;
/// `null` members become `NSNull`), wrappers as themselves. `None` for
/// `null` / `undefined`.
pub(crate) fn ns_value(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<DynObject>> {
    ns_value_at(global, value, what, 0)
}

fn ns_value_at(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
    depth: usize,
) -> JsResult<Option<DynObject>> {
    if depth > bun_appkit::dynamic::PLAIN_DEPTH {
        return Err(global
            .err(
                ErrorCode::INVALID_ARG_VALUE,
                format_args!(
                    "{what}: nested too deeply (or cyclic) to convert to a Foundation object"
                ),
            )
            .throw());
    }
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if let Some(o) = objc_object(value) {
        return check(global, o.object().try_clone()).map(Some);
    }
    if let Some(c) = objc_class(value) {
        return Ok(Some(c.class().to_object()));
    }
    let object = if value.is_string() {
        let s = JsStr::new(global, value, what)?;
        DynObject::string(s.ns())
    } else if value.is_number() {
        DynObject::number(value.as_number())
    } else if value.is_boolean() {
        DynObject::boolean(value.as_boolean())
    } else if value.is_big_int() {
        match JSBigInt::from_js(value) {
            Some(big) if value.is_big_int_in_int64_range(i64::MIN, i64::MAX) => {
                DynObject::integer(big.to_int64())
            }
            Some(_) if value.is_big_int_in_uint64_range(0, u64::MAX) => {
                DynObject::unsigned(value.to_uint64_no_truncate())
            }
            _ => {
                return Err(global
                    .err(
                        ErrorCode::INVALID_ARG_VALUE,
                        format_args!("{what}: bigint does not fit a 64-bit NSNumber"),
                    )
                    .throw());
            }
        }
    } else if value.is_date() {
        DynObject::date(value.get_unix_timestamp())
    } else if let Some(buffer) = value.as_array_buffer(global) {
        DynObject::data(buffer.byte_slice())
    } else if value.is_array() {
        let mut items = Vec::new();
        let mut iter = value.array_iterator(global)?;
        while let Some(item) = iter.next()? {
            items.push(match ns_value_at(global, item, what, depth + 1)? {
                Some(o) => o,
                None => check(global, DynObject::null())?,
            });
        }
        DynObject::array(&items)
    } else if is_plain_object(global, value)? {
        let Some(object) = value.get_object() else {
            return Ok(None);
        };
        let mut entries = Vec::new();
        let iter = bun_jsc::JSPropertyIterator::init(
            global,
            object,
            bun_jsc::PropertyIteratorOptions {
                skip_empty_name: false,
                include_value: true,
            },
        )?;
        while let Some((key, value)) = iter.next()? {
            // The iterator lends the name; `JsStr` takes a reference of its own.
            let key = JsStr((*key).clone());
            let key = check(global, DynObject::string(key.ns()))?;
            let value = match ns_value_at(global, value, what, depth + 1)? {
                Some(o) => o,
                None => check(global, DynObject::null())?,
            };
            entries.push((key, value));
        }
        DynObject::dictionary(&entries)
    } else {
        // An instance of some script class: say which, since what was meant
        // is usually a handle it carries (a bun:appkit view's `.native`).
        let constructor = match value.is_object() {
            true => value
                .get(global, "constructor")?
                .filter(|c| c.is_callable())
                .map(|c| c.get_name(global))
                .transpose()?
                .filter(|name| !name.is_empty()),
            false => None,
        };
        return Err(match constructor {
            Some(name) => global.throw_invalid_arguments(format_args!(
                "{what}: cannot convert a {name} to a Foundation object; pass an Objective-C handle (a bun:appkit view's or window's is its .native), a string, number, boolean, Date, ArrayBuffer, array or plain object"
            )),
            None => global.throw_invalid_arguments(format_args!(
                "{what}: cannot convert {} to a Foundation object",
                js_kind(value)
            )),
        });
    };
    check(global, object).map(Some)
}

/// Which value of a message is being converted, for the error.
#[derive(Clone, Copy)]
pub(crate) enum Slot {
    /// Argument `index` (from 0) of a message the script sends.
    Arg(usize),
    /// What a script method returns to its sender.
    Return,
}

pub(crate) struct SlotName<'a>(&'a str, Slot);

impl core::fmt::Display for SlotName<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self.1 {
            Slot::Arg(index) => write!(f, "{} argument {index}", self.0),
            Slot::Return => write!(f, "{} return value", self.0),
        }
    }
}

/// `ArgType` / `ReturnType`: the value in `slot` is not an `expected`.
fn wrong_type(method: &str, slot: Slot, expected: String, got: String) -> bun_appkit::Error {
    match slot {
        Slot::Arg(index) => bun_appkit::Error::ArgType {
            method: method.to_owned(),
            index,
            expected,
            got,
        },
        Slot::Return => bun_appkit::Error::ReturnType {
            method: method.to_owned(),
            expected,
            got,
        },
    }
}

/// Converts argument `index` of the message `sig` describes.
pub(crate) fn dyn_arg(
    global: &JSGlobalObject,
    sig: &Signature,
    index: usize,
    enc: &Enc,
    value: JSValue,
) -> JsResult<DynValue> {
    // A bare function stands in for a block whose type the bridge knows.
    if *enc == Enc::Block && value.is_callable() && objc_object(value).is_none() {
        let Some(types) = sig.block_types(index) else {
            return Err(throw(
                global,
                bun_appkit::Error::UnsupportedSignature {
                    method: sig.method().to_owned(),
                    what: format!(
                        "argument {index} is a block whose type the bridge does not know for this method; pass objc.block(fn, types) with the block's type encoding{}",
                        if bun_appkit::block::any_signature() {
                            String::new()
                        } else {
                            format!(" (one of {})", bun_appkit::block::compiled())
                        }
                    ),
                },
            ));
        };
        // The block's wrapper keeps the function; nothing but this call holds
        // the wrapper, so it goes once whatever the method did with the block
        // lets go of it.
        let wrapper = super::objc::block_wrapper(global, value, &types.to_string_lossy());
        let wrapper = check(
            global,
            wrapper.map_err(|err| match err {
                bun_appkit::Error::BlockSignature { types, what } => {
                    bun_appkit::Error::UnsupportedSignature {
                        method: sig.method().to_owned(),
                        what: format!(
                            "argument {index} takes a block of type {types}, which {what}"
                        ),
                    }
                }
                err => err,
            }),
        )?;
        return dyn_value(global, sig.method(), Slot::Arg(index), enc, wrapper);
    }
    dyn_value(global, sig.method(), Slot::Arg(index), enc, value)
}

/// Converts the value in `slot` of `method`, typed by the method's encoding
/// `enc` (never by the JavaScript value).
pub(crate) fn dyn_value(
    global: &JSGlobalObject,
    method: &str,
    slot: Slot,
    enc: &Enc,
    value: JSValue,
) -> JsResult<DynValue> {
    let what = SlotName(method, slot);
    let what = &what;
    let mismatch = || {
        throw(
            global,
            wrong_type(method, slot, enc.to_string(), js_kind(value).to_owned()),
        )
    };
    let unsupported = |what: &str| {
        throw(
            global,
            bun_appkit::Error::UnsupportedSignature {
                method: method.to_owned(),
                what: what.to_owned(),
            },
        )
    };
    // Text that will be handed over as a C string, so it cannot carry a NUL.
    let c_text = |text: JsStr| -> JsResult<String> {
        let text = text.to_utf8().into_string();
        if strings::contains_char(text.as_bytes(), 0) {
            return Err(throw(
                global,
                wrong_type(
                    method,
                    slot,
                    enc.to_string(),
                    "a string containing a NUL character".into(),
                ),
            ));
        }
        Ok(text)
    };
    let nil = value.is_undefined_or_null();
    Ok(match enc {
        Enc::Block | Enc::CFObject(_) if !matches!(enc, Enc::CFObject(t) if t.bridged().is_some()) => {
            if nil {
                DynValue::Nil
            } else if let Some(o) = objc_object(value) {
                DynValue::Object(check(global, o.object().try_clone())?)
            } else {
                return Err(mismatch());
            }
        }
        // A toll-free bridged CF type takes what its class takes.
        Enc::Object | Enc::CFObject(_) => {
            if nil {
                DynValue::Nil
            } else if let Some(o) = objc_object(value) {
                DynValue::Object(check(global, o.object().try_clone())?)
            } else if let Some(c) = objc_class(value) {
                DynValue::Class(c.class())
            } else if value.is_string() {
                let s = JsStr::new(global, value, format_args!("{what}"))?;
                DynValue::Object(check(global, DynObject::string(s.ns()))?)
            } else if value.is_boolean() {
                DynValue::Bool(value.as_boolean())
            } else if value.is_number() {
                DynValue::F64(value.as_number())
            } else {
                match ns_value(global, value, format_args!("{what}"))? {
                    Some(o) => DynValue::Object(o),
                    None => DynValue::Nil,
                }
            }
        }
        Enc::Class => {
            if nil {
                DynValue::Nil
            } else if let Some(c) = objc_class(value) {
                DynValue::Class(c.class())
            } else if let Some(o) = objc_object(value)
                && let Some(c) = o.object().as_class()
            {
                DynValue::Class(c)
            } else {
                return Err(mismatch());
            }
        }
        Enc::Sel => {
            if nil {
                DynValue::Nil
            } else if let Some(sel) = objc_selector(value) {
                DynValue::Sel(sel.name().to_owned())
            } else if value.is_string() {
                DynValue::Sel(c_text(JsStr::new(global, value, format_args!("{what}"))?)?)
            } else {
                return Err(mismatch());
            }
        }
        Enc::Bool if value.is_boolean() => DynValue::Bool(value.as_boolean()),
        Enc::Int { bits, signed } => {
            let (min, max): (i128, i128) = if *signed {
                (-(1i128 << (bits - 1)), (1i128 << (bits - 1)) - 1)
            } else {
                (0, (1i128 << bits) - 1)
            };
            let out_of_range = |got: &dyn core::fmt::Display| {
                throw(
                    global,
                    wrong_type(
                        method,
                        slot,
                        format!("{enc} from {min} to {max}"),
                        got.to_string(),
                    ),
                )
            };
            if value.is_number() {
                let n = value.as_number();
                if !n.is_finite() || n.fract() != 0.0 {
                    return Err(throw(
                        global,
                        wrong_type(method, slot, enc.to_string(), format!("{n}")),
                    ));
                }
                if (n as i128) < min || (n as i128) > max {
                    return Err(out_of_range(&n));
                }
                if n.abs() > SAFE_INTEGER {
                    return Err(throw(
                        global,
                        wrong_type(
                            method,
                            slot,
                            format!("{enc}; pass a bigint for values above 2^53"),
                            format!("{n}"),
                        ),
                    ));
                }
                if *signed {
                    DynValue::I64(n as i64)
                } else {
                    DynValue::U64(n as u64)
                }
            } else if value.is_big_int() {
                let Some(big) = JSBigInt::from_js(value) else {
                    return Err(mismatch());
                };
                if *signed {
                    if !value.is_big_int_in_int64_range(min as i64, max as i64) {
                        return Err(out_of_range(&"a bigint outside it"));
                    }
                    DynValue::I64(big.to_int64())
                } else {
                    if !value.is_big_int_in_uint64_range(0, max as u64) {
                        return Err(out_of_range(&"a bigint outside it"));
                    }
                    DynValue::U64(value.to_uint64_no_truncate())
                }
            } else {
                return Err(mismatch());
            }
        }
        Enc::F32 | Enc::F64 if value.is_number() => DynValue::F64(value.as_number()),
        Enc::CString => {
            if nil {
                DynValue::Nil
            } else if value.is_string() {
                DynValue::Str(c_text(JsStr::new(global, value, format_args!("{what}"))?)?)
            } else {
                return Err(mismatch());
            }
        }
        Enc::Out(_) if nil => DynValue::Nil,
        Enc::Out(pointee) => {
            let handle = objc_object(value).is_some() || objc_class(value).is_some();
            if handle || !value.is_object() {
                return Err(mismatch());
            }
            // Storage for ONE value: a typed array would be taken for a plain
            // `{}` and the callee handed 128 bytes, which is not what a
            // script lending memory means. Nothing says this parameter is a
            // C array; if it is one, the method must be called through bun:ffi.
            if value.as_array_buffer(global).is_some() {
                return Err(throw(
                    global,
                    wrong_type(
                        method,
                        slot,
                        format!(
                            "{}, storage for one value (objc.out() or {{}}); nothing declares this parameter a C array, so it cannot take a buffer",
                            enc.encoding()
                        ),
                        "an ArrayBuffer or typed array".to_owned(),
                    ),
                ));
            }
            // What `value` holds going in is the pointed-at storage's initial
            // contents; `send` puts what the method left there back.
            let initial = match value.get(global, "value")? {
                Some(initial) if !initial.is_undefined() => Some(Box::new(dyn_value(
                    global,
                    method,
                    slot,
                    &pointee.enc(),
                    initial,
                )?)),
                _ => None,
            };
            DynValue::Out(initial)
        }
        Enc::Buffer(_) | Enc::Pointer if nil => DynValue::Nil,
        // The storage of an ArrayBuffer or a view of one, for the length of
        // this send; `arguments_as` pins it meanwhile.
        Enc::Buffer(_) | Enc::Pointer
            if matches!(slot, Slot::Arg(_))
                && let Some(buffer) = value.as_array_buffer(global) =>
        {
            // The pin `arguments_as` takes stops a transfer, not a resize:
            // a resizable buffer shrunk by a callout the send reaches would
            // leave the callee writing into unmapped pages.
            if buffer.shared || buffer.resizable {
                let what = if buffer.shared {
                    "a SharedArrayBuffer"
                } else {
                    "a resizable ArrayBuffer"
                };
                return Err(throw(
                    global,
                    wrong_type(method, slot, enc.to_string(), what.into()),
                ));
            }
            DynValue::Bytes {
                address: buffer.ptr as usize,
                length: buffer.byte_len,
            }
        }
        // An address a pointer-typed result gave earlier, handed back.
        Enc::Pointer if matches!(slot, Slot::Arg(_)) && value.is_big_int() => {
            if !value.is_big_int_in_uint64_range(0, u64::MAX) {
                return Err(mismatch());
            }
            DynValue::Pointer(value.to_uint64_no_truncate() as usize)
        }
        Enc::Pointer => {
            return Err(unsupported(
                "a pointer here takes an ArrayBuffer, a typed array, a bigint address or null",
            ));
        }
        Enc::Struct(t) if value.is_object() => {
            // One member, converted as the scalar it is; `path` names it in
            // a message. An integer member takes a bigint too (an NSRange
            // location can be NSNotFound); its width is checked when written.
            let member = |scalar: Scalar, v: Option<JSValue>, path: &dyn core::fmt::Display| {
                let Some(v) = v else { return Err(mismatch()) };
                let misfit = |expected: String| {
                    throw(
                        global,
                        wrong_type(
                            method,
                            slot,
                            format!("{enc} with {path} {expected}"),
                            js_kind(v).to_owned(),
                        ),
                    )
                };
                Ok(match scalar {
                    Scalar::Bool if v.is_boolean() => DynValue::Bool(v.as_boolean()),
                    Scalar::Bool => return Err(misfit("a boolean".into())),
                    Scalar::F32 | Scalar::F64 => {
                        DynValue::F64(number(global, v, format_args!("{what}.{path}"))?)
                    }
                    Scalar::Int { signed, .. } if v.is_big_int() => {
                        if let (true, Some(big)) = (
                            signed && v.is_big_int_in_int64_range(i64::MIN, i64::MAX),
                            JSBigInt::from_js(v),
                        ) {
                            DynValue::I64(big.to_int64())
                        } else if !signed && v.is_big_int_in_uint64_range(0, u64::MAX) {
                            DynValue::U64(v.to_uint64_no_truncate())
                        } else {
                            return Err(misfit(format!(
                                "an integer, or a bigint up to {}",
                                if signed { i64::MAX as u64 } else { u64::MAX }
                            )));
                        }
                    }
                    Scalar::Int { signed, .. } => {
                        let n = number(global, v, format_args!("{what}.{path}"))?;
                        if n.fract() != 0.0 || n.abs() > SAFE_INTEGER || (!signed && n < 0.0) {
                            return Err(throw(
                                global,
                                wrong_type(
                                    method,
                                    slot,
                                    format!(
                                        "{enc} with {path} an integer from {} to 2^53, or a bigint",
                                        if signed { "-2^53" } else { "0" }
                                    ),
                                    format!("{path} {n}"),
                                ),
                            ));
                        }
                        if signed {
                            DynValue::I64(n as i64)
                        } else {
                            DynValue::U64(n as u64)
                        }
                    }
                })
            };
            let fields = t.fields.iter().map(|f| f.scalar);
            let values: Box<[DynValue]> = if value.is_array() {
                let got = value.get_length(global)? as usize;
                if got != t.fields.len() {
                    return Err(throw(
                        global,
                        wrong_type(
                            method,
                            slot,
                            format!("{enc}, {} of them", t.fields.len()),
                            format!("an array of {got}"),
                        ),
                    ));
                }
                let mut values = Vec::with_capacity(got);
                for (i, scalar) in fields.enumerate() {
                    values.push(member(
                        scalar,
                        Some(value.get_index(global, i as u32)?),
                        &format_args!("[{i}]"),
                    )?);
                }
                values.into()
            } else if let Some(names) = t.field_names() {
                // A CGRect also arrives as AppKit spells it: { origin, size }.
                let nested = if t.is_rect() {
                    match (value.get(global, "origin")?, value.get(global, "size")?) {
                        (Some(origin), Some(size)) if origin.is_object() && size.is_object() => {
                            Some([
                                (origin, "origin"),
                                (origin, "origin"),
                                (size, "size"),
                                (size, "size"),
                            ])
                        }
                        _ => None,
                    }
                } else {
                    None
                };
                let mut values = Vec::with_capacity(names.len());
                for (i, (scalar, name)) in fields.zip(names).enumerate() {
                    let value = match &nested {
                        Some(parts) => member(
                            scalar,
                            parts[i].0.get(global, name)?,
                            &format_args!("{}.{name}", parts[i].1),
                        )?,
                        None => member(scalar, value.get(global, name)?, &name)?,
                    };
                    values.push(value);
                }
                values.into()
            } else {
                return Err(mismatch());
            };
            DynValue::Struct(t, values)
        }
        Enc::Other(e) => {
            return Err(unsupported(&format!(
                "argument type {e} is not supported yet"
            )));
        }
        _ => return Err(mismatch()),
    })
}

/// A number when that is exact, else a bigint.
pub(super) fn i64_to_js(global: &JSGlobalObject, v: i64) -> JsResult<JSValue> {
    if v.unsigned_abs() <= SAFE_INTEGER_U64 {
        Ok(JSValue::js_number(v as f64))
    } else {
        JSValue::from_int64_no_truncate(global, v)
    }
}

pub(super) fn u64_to_js(global: &JSGlobalObject, v: u64) -> JsResult<JSValue> {
    if v <= SAFE_INTEGER_U64 {
        Ok(JSValue::js_number(v as f64))
    } else {
        JSValue::from_uint64_no_truncate(global, v)
    }
}

/// A message result for JavaScript. Objects are wrapped as they are; use
/// `objc.js()` to unpack Foundation values.
pub(crate) fn dyn_to_js(global: &JSGlobalObject, value: DynValue) -> JsResult<JSValue> {
    Ok(match value {
        DynValue::Nil => JSValue::NULL,
        DynValue::Void => JSValue::UNDEFINED,
        DynValue::Object(o) => ObjCObject::wrap(global, o),
        DynValue::Class(c) => ObjCClass::wrap(global, c),
        DynValue::Sel(name) | DynValue::Str(name) => str_to_js(global, &name)?,
        DynValue::Bool(b) => JSValue::js_boolean(b),
        DynValue::I64(v) => i64_to_js(global, v)?,
        DynValue::U64(v) => u64_to_js(global, v)?,
        DynValue::F64(v) => JSValue::js_number(v),
        DynValue::Struct(t, members) => {
            let values = members
                .into_vec()
                .into_iter()
                .map(|v| dyn_to_js(global, v))
                .collect::<JsResult<Vec<JSValue>>>()?;
            match t.field_names() {
                // `{ origin: { x, y }, size: { width, height } }`, as AppKit spells it.
                Some(names) if t.is_rect() => {
                    let object = JSValue::create_empty_object(global, 2);
                    let part = |range: core::ops::Range<usize>| {
                        let part = JSValue::create_empty_object(global, range.len());
                        for i in range {
                            part.put(global, names[i], values[i]);
                        }
                        part
                    };
                    object.put(global, b"origin", part(0..2));
                    object.put(global, b"size", part(2..4));
                    object
                }
                Some(names) => {
                    let object = JSValue::create_empty_object(global, names.len());
                    for (name, v) in names.iter().zip(values) {
                        object.put(global, *name, v);
                    }
                    object
                }
                None => JSValue::create_array_from_slice(global, &values)?,
            }
        }
        DynValue::Pointer(0) => JSValue::NULL,
        DynValue::Pointer(p) | DynValue::Bytes { address: p, .. } => {
            JSValue::from_uint64_no_truncate(global, p as u64)?
        }
        DynValue::Out(Some(value)) => dyn_to_js(global, *value)?,
        DynValue::Out(None) => JSValue::UNDEFINED,
    })
}
