//! Where each member of `fetch(input, init)` and `new Request(input, init)` comes from, and how the members they share are read.

use core::ptr::NonNull;

use bun_jsc::{
    AbortSignalRef, BuiltinName, CommonString, JSGlobalObject, JSValue, JsError, JsResult,
};

use crate::webcore::response::HeadersRef;
use crate::webcore::{AbortSignal, FetchHeaders, Request};

/// `init` wins over `input`, which is at most one of `request` and `object`. A URL is neither.
#[derive(Clone, Copy)]
pub(crate) struct InitSources<'a> {
    /// `init`, if it's an object.
    pub(crate) init: Option<JSValue>,
    /// `input`, if it's a Request that nothing has tampered with. Its fields are read, not its getters.
    pub(crate) request: Option<&'a Request>,
    /// `input`, if it's any other object. It's read like `init`.
    pub(crate) object: Option<JSValue>,
}

impl<'a> InitSources<'a> {
    /// Reads one member. `from_js` returns `None` for an object that doesn't decide it.
    #[inline]
    pub(crate) fn member<T>(
        &self,
        mut from_js: impl FnMut(JSValue) -> JsResult<Option<T>>,
        from_request: impl FnOnce(&'a Request) -> JsResult<Option<T>>,
    ) -> JsResult<Option<T>> {
        if let Some(init) = self.init
            && let Some(value) = from_js(init)?
        {
            return Ok(Some(value));
        }
        if let Some(request) = self.request {
            return from_request(request);
        }
        self.object.map_or(Ok(None), from_js)
    }

    /// [`Self::member`] for one that `request` doesn't decide.
    #[inline]
    pub(crate) fn object_member<T>(
        &self,
        from_js: impl FnMut(JSValue) -> JsResult<Option<T>>,
    ) -> JsResult<Option<T>> {
        self.member(from_js, |_| Ok(None))
    }

    /// Reads an option of Bun's, which a Request doesn't carry. `parse` returns `None` for a value that doesn't decide it.
    #[inline]
    pub(crate) fn option<T>(
        &self,
        global: &JSGlobalObject,
        key: CommonString,
        mut parse: impl FnMut(JSValue) -> JsResult<Option<T>>,
    ) -> JsResult<Option<T>> {
        self.object_member(|object| match object.get_common_string(global, key)? {
            Some(value) => parse(value),
            None => Ok(None),
        })
    }
}

/// `true`, `false` or a number, which is how Bun's on/off options are written.
pub(crate) fn flag(value: JSValue) -> Option<bool> {
    if value.is_boolean() {
        Some(value.as_boolean())
    } else if value.is_number() {
        Some(value.to_int32() != 0)
    } else {
        None
    }
}

/// The `signal` member (WebIDL `AbortSignal?`): present unless undefined, and `null` detaches the input's signal.
pub(crate) fn signal_member(
    global: &JSGlobalObject,
    object: JSValue,
    not_a_signal: impl FnOnce() -> JsError,
) -> JsResult<Option<Option<AbortSignalRef>>> {
    let Some(value) = object.fast_get(global, BuiltinName::signal)? else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(Some(None));
    }
    match AbortSignal::ref_from_js(value) {
        Some(signal) => Ok(Some(Some(signal))),
        None => Err(not_a_signal()),
    }
}

/// A `headers` member that has fields.
pub(crate) enum HeadersInit {
    /// The caller's own `Headers`, which whoever passed the value keeps alive.
    Borrowed(NonNull<FetchHeaders>),
    /// Made from a record or a sequence of pairs.
    Created(HeadersRef),
}

impl HeadersInit {
    /// Returns `None` if `value` has no fields.
    pub(crate) fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Self>> {
        let Some(headers) = FetchHeaders::cast_as_init(value) else {
            return Ok(HeadersRef::create_from_js(global, value)?.map(Self::Created));
        };
        let is_empty = bun_opaque::opaque_deref_mut(headers.as_ptr()).is_empty();
        Ok((!is_empty).then_some(Self::Borrowed(headers)))
    }

    pub(crate) fn get(&self) -> &mut FetchHeaders {
        bun_opaque::opaque_deref_mut(match self {
            Self::Borrowed(headers) => headers.as_ptr(),
            Self::Created(headers) => headers.as_ptr(),
        })
    }
}
