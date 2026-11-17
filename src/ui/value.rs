//! JS values of what the library reports.

use bun_jsc::{JSGlobalObject, JSValue, JsResult};

use crate::abi::Rect;
use crate::protocol::{List, Maybe, Point, Size, Text};

pub trait IntoJs {
    fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue>;
}

/// `object!(global, { "name": value, .. })` is a `JSValue`, in a function that returns a `JsResult`.
#[macro_export]
macro_rules! object {
    ($global:expr, { $($name:literal: $value:expr),* $(,)? }) => {{
        let object = bun_jsc::JSValue::create_empty_object($global, [$($name),*].len());
        $(object.put($global, $name.as_bytes(), $crate::value::IntoJs::into_js($value, $global)?);)*
        object
    }};
}

macro_rules! into_js {
    ($($type:ty => |$it:ident, $global:pat_param| $body:expr;)*) => {$(
        impl IntoJs for $type {
            fn into_js(self, $global: &JSGlobalObject) -> JsResult<JSValue> {
                let $it = self;
                $body
            }
        }
    )*};
}

into_js! {
    JSValue => |it, _| Ok(it);
    bool => |it, _| Ok(JSValue::js_boolean(it));
    u8 => |it, _| Ok(JSValue::js_number_from_int32(it.into()));
    i32 => |it, _| Ok(JSValue::js_number_from_int32(it));
    u32 => |it, _| Ok(JSValue::js_number_from_uint64(it.into()));
    u64 => |it, _| Ok(JSValue::js_number_from_uint64(it));
    f32 => |it, global| f64::from(it).into_js(global);
    f64 => |it, _| Ok(number(it));
    &str => |it, global| bun_jsc::bun_string_jsc::create_utf8_for_js(global, it.as_bytes());
    &[u8] => |it, global| bun_jsc::bun_string_jsc::create_utf8_for_js(global, it);
    String => |it, global| it.as_str().into_js(global);
    Text => |it, global| (*it).into_js(global);
    &Text => |it, global| (**it).into_js(global);
    Point => |it, global| Ok(object!(global, { "x": it.x, "y": it.y }));
    Size => |it, global| Ok(object!(global, { "width": it.width, "height": it.height }));
    Rect => |it, global| Ok(object!(global, { "x": it.x, "y": it.y, "width": it.width, "height": it.height }));
}

fn number(it: f64) -> JSValue {
    match it as i32 {
        whole if f64::from(whole) == it => JSValue::js_number_from_int32(whole),
        _ => JSValue::js_number(JSValue::purify_nan(it)),
    }
}

pub fn finite(it: f64) -> f32 {
    if it.is_finite() { it as f32 } else { 0. }
}

/// With the digits that it has: 1.1, and not 1.100000023841858.
pub fn decimal(it: f32) -> f64 {
    (f64::from(it) * 1e5).round() / 1e5
}

impl<T: IntoJs> IntoJs for Option<T> {
    fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.map_or(Ok(JSValue::NULL), |it| it.into_js(global))
    }
}

impl<T: IntoJs> IntoJs for Maybe<T> {
    fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.get().into_js(global)
    }
}

impl<T: IntoJs, const N: usize> IntoJs for [T; N] {
    fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        JSValue::create_array_from_iter(global, self.into_iter(), |it| it.into_js(global))
    }
}

impl<T: IntoJs> IntoJs for Vec<T> {
    fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        JSValue::create_array_from_iter(global, self.into_iter(), |it| it.into_js(global))
    }
}

impl<T: IntoJs> IntoJs for List<T> {
    fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.into_vec().into_js(global)
    }
}

/// `undefined` for `None`.
pub fn or_undefined(it: Option<impl IntoJs>, global: &JSGlobalObject) -> JsResult<JSValue> {
    it.map_or(Ok(JSValue::UNDEFINED), |it| it.into_js(global))
}
