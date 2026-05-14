use core::ptr::NonNull;

use crate::host_fn::from_js_host_call_generic;
use crate::{JSGlobalObject, JSObject, JSValue, JsResult};
use bun_core as bstr;

/// Comptime config struct in Zig (`JSPropertyIterator.zig:1-7`); ported as a runtime
/// flag set passed to [`JSPropertyIterator::init`].
///
/// `Default` mirrors the Zig field defaults: `own_properties_only = true`,
/// `observable = true`, `only_non_index_properties = false`.
// PERF(port): was comptime monomorphization (`fn JSPropertyIterator(comptime options) type`).
// Demoted to runtime flags because the branches gate per-property work, not a hot inner
// loop, and the monomorphization fan-out would be 32 instantiations. Profile in Phase B.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JSPropertyIteratorOptions {
    pub skip_empty_name: bool,
    pub include_value: bool,
    pub own_properties_only: bool,
    pub observable: bool,
    pub only_non_index_properties: bool,
}

impl JSPropertyIteratorOptions {
    /// Shorthand matching the Zig spec's most common call-site shape
    /// `.{ .skip_empty_name = …, .include_value = … }`; the remaining three options
    /// take the Zig struct defaults.
    pub const fn new(skip_empty_name: bool, include_value: bool) -> Self {
        Self {
            skip_empty_name,
            include_value,
            own_properties_only: true,
            observable: true,
            only_non_index_properties: false,
        }
    }
}

impl Default for JSPropertyIteratorOptions {
    #[inline]
    fn default() -> Self {
        Self {
            skip_empty_name: false,
            include_value: false,
            own_properties_only: true,
            observable: true,
            only_non_index_properties: false,
        }
    }
}

/// Two-field shorthand of [`JSPropertyIteratorOptions`]; the remaining three options
/// take the Zig struct defaults via the `From` conversion.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PropertyIteratorOptions {
    pub skip_empty_name: bool,
    pub include_value: bool,
}

impl From<PropertyIteratorOptions> for JSPropertyIteratorOptions {
    #[inline]
    fn from(o: PropertyIteratorOptions) -> Self {
        Self::new(o.skip_empty_name, o.include_value)
    }
}

/// Conversion shim so [`JSPropertyIterator::init`]'s `object` argument accepts the
/// same operand shapes Zig callers use (`*JSObject`, `&JSObject`).
pub trait IntoIterObject {
    fn into_iter_object(self) -> *mut JSObject;
}
impl IntoIterObject for *mut JSObject {
    #[inline]
    fn into_iter_object(self) -> *mut JSObject {
        self
    }
}
impl IntoIterObject for *const JSObject {
    #[inline]
    fn into_iter_object(self) -> *mut JSObject {
        self.cast_mut()
    }
}
impl IntoIterObject for NonNull<JSObject> {
    #[inline]
    fn into_iter_object(self) -> *mut JSObject {
        self.as_ptr()
    }
}
impl IntoIterObject for &JSObject {
    #[inline]
    fn into_iter_object(self) -> *mut JSObject {
        std::ptr::from_ref::<JSObject>(self).cast_mut()
    }
}
impl IntoIterObject for &mut JSObject {
    #[inline]
    fn into_iter_object(self) -> *mut JSObject {
        std::ptr::from_mut::<JSObject>(self)
    }
}

pub struct JSPropertyIterator<'a> {
    pub len: usize,
    pub i: u32,
    pub iter_i: u32,
    /// null if and only if `object` has no properties (i.e. `len == 0`)
    pub impl_: Option<NonNull<JSPropertyIteratorImpl>>,

    pub global_object: &'a JSGlobalObject,
    pub object: *mut JSObject,
    /// Current property value being yielded (only meaningful when
    /// `options.include_value` is set).
    // PORT NOTE: bare JSValue field is sound because this struct is stack-only (`'a` borrow);
    // conservative stack scan keeps it alive. Do NOT box this struct.
    pub value: JSValue,

    options: JSPropertyIteratorOptions,
}

impl<'a> JSPropertyIterator<'a> {
    pub fn get_longest_property_name(&self) -> usize {
        if let Some(iter) = self.impl_ {
            // `JSPropertyIteratorImpl`/`JSObject` are opaque ZST handles;
            // `opaque_mut`/`opaque_ref` are the centralised zero-byte deref proofs.
            Bun__JSPropertyIterator__getLongestPropertyName(
                JSPropertyIteratorImpl::opaque_mut(iter.as_ptr()),
                self.global_object,
                JSObject::opaque_ref(self.object),
            )
        } else {
            0
        }
    }

    /// `object` should be a `JSC::JSObject`. Non-objects will be runtime converted.
    pub fn init(
        global_object: &'a JSGlobalObject,
        object: impl IntoIterObject,
        options: impl Into<JSPropertyIteratorOptions>,
    ) -> JsResult<Self> {
        let options = options.into();
        let object = object.into_iter_object();
        let mut len: usize = 0;
        JSValue::from_cell(object).ensure_still_alive();
        let impl_ = JSPropertyIteratorImpl::init(
            global_object,
            object,
            &mut len,
            options.own_properties_only,
            options.only_non_index_properties,
        )?;
        if cfg!(debug_assertions) {
            if len > 0 {
                debug_assert!(impl_.is_some());
            } else {
                debug_assert!(impl_.is_none());
            }
        }

        Ok(Self {
            len,
            i: 0,
            iter_i: 0,
            impl_,
            global_object,
            object,
            value: JSValue::ZERO,
            options,
        })
    }

    pub fn reset(&mut self) {
        self.iter_i = 0;
        self.i = 0;
    }

    /// The bun.String returned has not incremented its reference count.
    pub fn next(&mut self) -> JsResult<Option<bstr::String>> {
        // Reuse stack space.
        loop {
            let i: usize = self.iter_i as usize;
            if i >= self.len {
                self.i = self.iter_i;
                return Ok(None);
            }

            self.i = self.iter_i;
            self.iter_i += 1;
            let mut name = bstr::String::DEAD;
            if self.options.include_value {
                let iter = self.impl_.expect("len > 0 implies impl_ is Some").as_ptr();
                // `JSPropertyIteratorImpl`/`JSObject` are opaque ZST handles;
                // `opaque_mut`/`opaque_ref` are the centralised zero-byte deref proofs.
                let iter = JSPropertyIteratorImpl::opaque_mut(iter);
                let object = JSObject::opaque_ref(self.object);
                let current: JSValue = if self.options.observable {
                    JSPropertyIteratorImpl::get_name_and_value(
                        iter,
                        self.global_object,
                        object,
                        &mut name,
                        i,
                    )?
                } else {
                    JSPropertyIteratorImpl::get_name_and_value_non_observable(
                        iter,
                        self.global_object,
                        object,
                        &mut name,
                        i,
                    )?
                };
                if current.is_empty() {
                    continue;
                }
                current.ensure_still_alive();
                self.value = current;
            } else {
                // Exception check is unnecessary here because it won't throw.
                let iter = self.impl_.expect("len > 0 implies impl_ is Some").as_ptr();
                // `iter` is a live FFI handle owned by `self`; `JSPropertyIteratorImpl`
                // is an opaque ZST handle so `opaque_mut` is the centralised proof.
                Bun__JSPropertyIterator__getName(
                    JSPropertyIteratorImpl::opaque_mut(iter),
                    &mut name,
                    i,
                );
            }

            if name.is_dead() {
                continue;
            }

            if self.options.skip_empty_name && name.is_empty() {
                continue;
            }

            return Ok(Some(name));
        }
    }
}

impl<'a> Drop for JSPropertyIterator<'a> {
    fn drop(&mut self) {
        if let Some(impl_) = self.impl_ {
            // SAFETY: `impl_` was returned by Bun__JSPropertyIterator__create and has not been
            // freed (we only free here, once).
            unsafe { Bun__JSPropertyIterator__deinit(impl_.as_ptr()) };
        }
        // Zig: `this.* = undefined;` — no-op in Rust.
    }
}

// Nomicon opaque-FFI pattern: !Send + !Sync + !Unpin
bun_opaque::opaque_ffi! { pub struct JSPropertyIteratorImpl; }

impl JSPropertyIteratorImpl {
    pub fn init(
        global_object: &JSGlobalObject,
        object: *mut JSObject,
        count: &mut usize,
        own_properties_only: bool,
        only_non_index_properties: bool,
    ) -> JsResult<Option<NonNull<JSPropertyIteratorImpl>>> {
        // may return null without an exception
        let raw = from_js_host_call_generic(global_object, || {
            Bun__JSPropertyIterator__create(
                global_object,
                JSValue::from_cell(object),
                count,
                own_properties_only,
                only_non_index_properties,
            )
        })?;
        Ok(NonNull::new(raw))
    }

    pub fn get_name_and_value(
        iter: &mut JSPropertyIteratorImpl,
        global_object: &JSGlobalObject,
        object: &JSObject,
        property_name: &mut bstr::String,
        i: usize,
    ) -> JsResult<JSValue> {
        // PORT NOTE: Zig wrapped this in a manual `TopExceptionScope.init/deinit` +
        // `returnIfException`; that is exactly `from_js_host_call_generic`'s contract
        // (the FFI may return `.zero` without throwing, so the non-generic
        // `from_js_host_call` — which treats empty as thrown — is wrong here).
        from_js_host_call_generic(global_object, || {
            Bun__JSPropertyIterator__getNameAndValue(iter, global_object, object, property_name, i)
        })
    }

    pub fn get_name_and_value_non_observable(
        iter: &mut JSPropertyIteratorImpl,
        global_object: &JSGlobalObject,
        object: &JSObject,
        property_name: &mut bstr::String,
        i: usize,
    ) -> JsResult<JSValue> {
        from_js_host_call_generic(global_object, || {
            Bun__JSPropertyIterator__getNameAndValueNonObservable(
                iter,
                global_object,
                object,
                property_name,
                i,
            )
        })
    }
}

// safe fn: `JSPropertyIteratorImpl`/`JSGlobalObject`/`JSObject` are `opaque_ffi!`
// ZST handles (`&`/`&mut` are ABI-identical to non-null `*const`/`*mut`);
// `bstr::String` is a `#[repr(C)]` out-param the C++ side fills in-place; remaining
// args are by-value scalars. Only `deinit` (frees the allocation) keeps a raw
// `*mut` and stays `unsafe`.
unsafe extern "C" {
    /// may return null without an exception
    safe fn Bun__JSPropertyIterator__create(
        global_object: &JSGlobalObject,
        encoded_value: JSValue,
        count: &mut usize,
        own_properties_only: bool,
        only_non_index_properties: bool,
    ) -> *mut JSPropertyIteratorImpl;
    safe fn Bun__JSPropertyIterator__getNameAndValue(
        iter: &mut JSPropertyIteratorImpl,
        global_object: &JSGlobalObject,
        object: &JSObject,
        property_name: &mut bstr::String,
        i: usize,
    ) -> JSValue;
    safe fn Bun__JSPropertyIterator__getNameAndValueNonObservable(
        iter: &mut JSPropertyIteratorImpl,
        global_object: &JSGlobalObject,
        object: &JSObject,
        property_name: &mut bstr::String,
        i: usize,
    ) -> JSValue;
    safe fn Bun__JSPropertyIterator__getName(
        iter: &mut JSPropertyIteratorImpl,
        property_name: &mut bstr::String,
        i: usize,
    );
    fn Bun__JSPropertyIterator__deinit(iter: *mut JSPropertyIteratorImpl);
    safe fn Bun__JSPropertyIterator__getLongestPropertyName(
        iter: &mut JSPropertyIteratorImpl,
        global_object: &JSGlobalObject,
        object: &JSObject,
    ) -> usize;
}

// ported from: src/jsc/JSPropertyIterator.zig
