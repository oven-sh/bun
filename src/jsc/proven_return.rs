use core::marker::PhantomData;

use self::return_kind::{
    Boolean, Instance, Int32, Nullable, Number, Optional, Promise, String, Undefined,
};
use crate::host_fn::IntoHostFnReturn;
use crate::{
    AbortSignal, CommonString, FetchHeaders, JSGlobalObject, JSPromise, JSString, JSValue, JsClass,
    JsResult, StringJsc as _,
};

mod sealed {
    pub trait Sealed {}
    pub trait SealedReturn {}
}

pub trait ReturnKind: sealed::Sealed {
    fn matches(value: JSValue) -> bool;
}

/// `value` is a wrapper of this native class or of a subclass. Compiled code trusts the answer without a test.
pub trait InstanceClass {
    fn is_instance(value: JSValue) -> bool;
}

pub mod return_kind {
    pub struct String;
    pub struct Number;
    pub struct Int32;
    pub struct Boolean;
    pub struct Undefined;
    pub struct Promise;
    pub struct Nullable<K>(core::marker::PhantomData<K>);
    /// `K | undefined`.
    pub struct Optional<K>(core::marker::PhantomData<K>);
    pub struct Instance<T>(core::marker::PhantomData<fn() -> T>);
}

macro_rules! impl_return_kind {
    ($($kind:ident: $predicate:ident),+ $(,)?) => {$(
        impl sealed::Sealed for $kind {}
        impl ReturnKind for $kind {
            #[inline]
            fn matches(value: JSValue) -> bool {
                value.$predicate()
            }
        }
    )+};
}

impl_return_kind!(
    String: is_string_literal,
    Number: is_number,
    Int32: is_int32,
    Boolean: is_boolean,
    Undefined: is_undefined,
);

impl sealed::Sealed for Promise {}
impl ReturnKind for Promise {
    #[inline]
    fn matches(value: JSValue) -> bool {
        value.as_promise().is_some()
    }
}

impl<K: ReturnKind> sealed::Sealed for Nullable<K> {}
impl<K: ReturnKind> ReturnKind for Nullable<K> {
    #[inline]
    fn matches(value: JSValue) -> bool {
        value.is_null() || K::matches(value)
    }
}

impl<K: ReturnKind> sealed::Sealed for Optional<K> {}
impl<K: ReturnKind> ReturnKind for Optional<K> {
    #[inline]
    fn matches(value: JSValue) -> bool {
        value.is_undefined() || K::matches(value)
    }
}

impl<T: InstanceClass> sealed::Sealed for Instance<T> {}
impl<T: InstanceClass> ReturnKind for Instance<T> {
    #[inline]
    fn matches(value: JSValue) -> bool {
        value.is_cell() && T::is_instance(value)
    }
}

impl<T: JsClass> InstanceClass for T {
    #[inline]
    fn is_instance(value: JSValue) -> bool {
        T::is_wrapper(value)
    }
}

impl InstanceClass for FetchHeaders {
    #[inline]
    fn is_instance(value: JSValue) -> bool {
        FetchHeaders::cast(value).is_some()
    }
}

impl InstanceClass for AbortSignal {
    #[inline]
    fn is_instance(value: JSValue) -> bool {
        AbortSignal::from_js(value).is_some()
    }
}

#[repr(transparent)]
pub struct Proven<K: ReturnKind> {
    value: JSValue,
    kind: PhantomData<K>,
}

pub type ProvenString = Proven<String>;

impl<K: ReturnKind> Clone for Proven<K> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

impl<K: ReturnKind> Copy for Proven<K> {}

/// A Rust return type that always converts to a JavaScript value of kind `K`.
///
/// `JSValue` implements no `ProvenReturn`, so a native getter or method whose class definition
/// declares a type cannot return one:
///
/// ```compile_fail
/// use bun_jsc::JSValue;
/// use bun_jsc::proven_return::{proven_return, return_kind};
///
/// proven_return::<return_kind::String, _>(JSValue::UNDEFINED);
/// ```
///
/// The trait is sealed, so no other file can declare that a type of its own proves a kind:
///
/// ```compile_fail
/// use bun_jsc::host_fn::IntoHostFnReturn;
/// use bun_jsc::proven_return::{ProvenReturn, return_kind};
/// use bun_jsc::{JSValue, JsResult};
///
/// struct Unchecked(JSValue);
/// impl IntoHostFnReturn for Unchecked {
///     fn into_host_fn_return(self) -> JsResult<JSValue> {
///         Ok(self.0)
///     }
/// }
/// impl ProvenReturn<return_kind::String> for Unchecked {}
/// ```
pub trait ProvenReturn<K: ReturnKind>: IntoHostFnReturn + sealed::SealedReturn {}

#[inline(always)]
pub fn proven_return<K: ReturnKind, R: ProvenReturn<K>>(value: R) -> R {
    value
}

impl<K: ReturnKind> Proven<K> {
    #[inline]
    pub fn try_new(value: JSValue) -> Option<Self> {
        K::matches(value).then(|| Self::by_construction(value))
    }

    #[track_caller]
    #[inline]
    pub fn expect(value: JSValue) -> Self {
        if (cfg!(debug_assertions) || bun_core::env::ENABLE_ASAN) && !K::matches(value) {
            panic!(
                "a native getter or method returned a value that is not a {}",
                core::any::type_name::<K>()
            );
        }
        Self::by_construction(value)
    }

    #[inline]
    pub fn value(self) -> JSValue {
        self.value
    }

    #[inline]
    pub fn nullable(self) -> Proven<Nullable<K>> {
        Proven::by_construction(self.value)
    }

    #[inline]
    fn by_construction(value: JSValue) -> Self {
        debug_assert!(K::matches(value));
        Self {
            value,
            kind: PhantomData,
        }
    }
}

impl<K: ReturnKind> Proven<Nullable<K>> {
    #[inline]
    pub fn null() -> Self {
        Self::by_construction(JSValue::NULL)
    }

    #[inline]
    pub fn from_option(value: Option<Proven<K>>) -> Self {
        match value {
            Some(proven) => proven.nullable(),
            None => Self::null(),
        }
    }
}

impl Proven<String> {
    #[inline]
    pub fn from_string(string: &bun_core::String, global: &JSGlobalObject) -> JsResult<Self> {
        string.to_js(global).map(Self::by_construction)
    }

    #[inline]
    pub fn from_common_string(string: CommonString, global: &JSGlobalObject) -> Self {
        Self::by_construction(string.to_js(global))
    }

    #[inline]
    pub fn from_js_string(string: &JSString) -> Self {
        Self::by_construction(string.to_js())
    }

    #[inline]
    pub fn empty(global: &JSGlobalObject) -> Self {
        Self::by_construction(JSValue::js_empty_string(global))
    }
}

impl Proven<Promise> {
    #[inline]
    pub fn from_promise(promise: &JSPromise) -> Self {
        Self::by_construction(promise.to_js())
    }
}

impl Proven<Undefined> {
    #[inline]
    pub fn undefined() -> Self {
        Self::by_construction(JSValue::UNDEFINED)
    }
}

impl Proven<Instance<FetchHeaders>> {
    #[inline]
    pub fn from_headers(headers: &mut FetchHeaders, global: &JSGlobalObject) -> Self {
        Self::by_construction(headers.to_js(global))
    }
}

impl Proven<Instance<AbortSignal>> {
    #[inline]
    pub fn from_signal(signal: &AbortSignal, global: &JSGlobalObject) -> Self {
        Self::by_construction(signal.to_js(global))
    }

    #[inline]
    pub fn create(global: &JSGlobalObject) -> Self {
        Self::by_construction(AbortSignal::create(global))
    }
}

impl<T: JsClass> Proven<Instance<T>> {
    #[track_caller]
    #[inline]
    pub fn from_native(native: T, global: &JSGlobalObject) -> Self {
        Self::expect(native.to_js(global))
    }
}

impl<K: ReturnKind> IntoHostFnReturn for Proven<K> {
    #[inline]
    fn into_host_fn_return(self) -> JsResult<JSValue> {
        Ok(self.value)
    }
}

impl<K: ReturnKind> IntoHostFnReturn for JsResult<Proven<K>> {
    #[inline]
    fn into_host_fn_return(self) -> JsResult<JSValue> {
        self.map(Proven::value)
    }
}

impl<K: ReturnKind> sealed::SealedReturn for Proven<K> {}
impl<K: ReturnKind> sealed::SealedReturn for JsResult<Proven<K>> {}
impl<K: ReturnKind> ProvenReturn<K> for Proven<K> {}
impl<K: ReturnKind> ProvenReturn<K> for JsResult<Proven<K>> {}
impl ProvenReturn<Number> for Proven<Int32> {}
impl ProvenReturn<Number> for JsResult<Proven<Int32>> {}

/// `None` is `undefined`.
impl<R: IntoHostFnReturn> IntoHostFnReturn for Option<R> {
    #[inline]
    fn into_host_fn_return(self) -> JsResult<JSValue> {
        match self {
            Some(value) => value.into_host_fn_return(),
            None => Ok(JSValue::UNDEFINED),
        }
    }
}

impl<R: IntoHostFnReturn> IntoHostFnReturn for JsResult<Option<R>> {
    #[inline]
    fn into_host_fn_return(self) -> JsResult<JSValue> {
        self?.into_host_fn_return()
    }
}

impl<R: sealed::SealedReturn> sealed::SealedReturn for Option<R> {}
impl<R: sealed::SealedReturn> sealed::SealedReturn for JsResult<Option<R>> {}
impl<K: ReturnKind, R: ProvenReturn<K>> ProvenReturn<Optional<K>> for Option<R> {}
impl<K: ReturnKind, R: ProvenReturn<K>> ProvenReturn<Optional<K>> for JsResult<Option<R>> {}

macro_rules! impl_native_return {
    ($native:ty, $convert:expr, $($kind:ident),+) => {
        impl IntoHostFnReturn for $native {
            #[inline]
            fn into_host_fn_return(self) -> JsResult<JSValue> {
                Ok(self).map($convert)
            }
        }
        impl IntoHostFnReturn for JsResult<$native> {
            #[inline]
            fn into_host_fn_return(self) -> JsResult<JSValue> {
                self.map($convert)
            }
        }
        impl sealed::SealedReturn for $native {}
        impl sealed::SealedReturn for JsResult<$native> {}
        $(
            impl ProvenReturn<$kind> for $native {}
            impl ProvenReturn<$kind> for JsResult<$native> {}
        )+
    };
}

impl_native_return!(bool, JSValue::js_boolean, Boolean);
impl_native_return!(i32, JSValue::js_number_from_int32, Int32, Number);
impl_native_return!(u16, |value| JSValue::js_number_from_int32(i32::from(value)), Int32, Number);
impl_native_return!(u8, |value| JSValue::js_number_from_int32(i32::from(value)), Int32, Number);
impl_native_return!(i16, |value| JSValue::js_number_from_int32(i32::from(value)), Int32, Number);
impl_native_return!(i8, |value| JSValue::js_number_from_int32(i32::from(value)), Int32, Number);
impl_native_return!(u32, JSValue::from, Number);
impl_native_return!(f64, |value| JSValue::js_number(JSValue::purify_nan(value)), Number);
impl_native_return!((), |()| JSValue::UNDEFINED, Undefined);

const _: () = {
    fn proves<K: ReturnKind, R: ProvenReturn<K>>() {}
    #[allow(dead_code)]
    fn table() {
        proves::<Boolean, bool>();
        proves::<Boolean, JsResult<bool>>();
        proves::<Int32, u16>();
        proves::<Number, u16>();
        proves::<Number, f64>();
        proves::<Number, Proven<Int32>>();
        proves::<Undefined, ()>();
        proves::<Optional<Int32>, Option<u16>>();
        proves::<Optional<String>, JsResult<Option<Proven<String>>>>();
        proves::<String, JsResult<Proven<String>>>();
        proves::<Nullable<Instance<FetchHeaders>>, Proven<Nullable<Instance<FetchHeaders>>>>();
    }
};

#[cfg(test)]
mod tests {
    use super::*;

    fn accepts<K: ReturnKind>(value: JSValue) -> bool {
        Proven::<K>::try_new(value).is_some()
    }

    #[test]
    fn try_new_accepts_matching_immediates() {
        assert!(accepts::<Boolean>(JSValue::TRUE));
        assert!(accepts::<Int32>(JSValue::js_number_from_int32(7)));
        assert!(accepts::<Number>(JSValue::js_number_from_int32(7)));
        assert!(accepts::<Number>(JSValue::js_double_number(0.5)));
        assert!(accepts::<Nullable<Boolean>>(JSValue::NULL));
        assert!(accepts::<Undefined>(JSValue::UNDEFINED));
        assert!(accepts::<Optional<Boolean>>(JSValue::UNDEFINED));
        assert!(accepts::<Optional<Boolean>>(JSValue::TRUE));
        assert!(!accepts::<Optional<Boolean>>(JSValue::NULL));
    }

    #[test]
    fn try_new_rejects_empty_value() {
        assert!(!accepts::<String>(JSValue::ZERO));
        assert!(!accepts::<Number>(JSValue::ZERO));
        assert!(!accepts::<Int32>(JSValue::ZERO));
        assert!(!accepts::<Boolean>(JSValue::ZERO));
        assert!(!accepts::<Undefined>(JSValue::ZERO));
        assert!(!accepts::<Promise>(JSValue::ZERO));
        assert!(!accepts::<Nullable<Boolean>>(JSValue::ZERO));
        assert!(!accepts::<Instance<FetchHeaders>>(JSValue::ZERO));
    }

    #[test]
    fn try_new_rejects_other_kinds() {
        assert!(!accepts::<Int32>(JSValue::js_double_number(0.5)));
        assert!(!accepts::<Nullable<Boolean>>(JSValue::UNDEFINED));
        assert!(!accepts::<String>(JSValue::TRUE));
        assert!(!accepts::<Promise>(JSValue::TRUE));
        assert!(!accepts::<Instance<FetchHeaders>>(JSValue::TRUE));
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic]
    fn expect_panics_on_other_kind() {
        Proven::<Boolean>::expect(JSValue::NULL);
    }
}
