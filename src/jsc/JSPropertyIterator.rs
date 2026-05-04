use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JSObject, JSValue, JsResult, TopExceptionScope};
use bun_str as bstr;

#[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy)]
// TODO(port): adt_const_params is unstable; Phase B may split into 5 `const bool` generics if needed.
pub struct JSPropertyIteratorOptions {
    pub skip_empty_name: bool,
    pub include_value: bool,
    pub own_properties_only: bool,
    pub observable: bool,
    pub only_non_index_properties: bool,
}

impl JSPropertyIteratorOptions {
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

pub struct JSPropertyIterator<'a, const OPTIONS: JSPropertyIteratorOptions> {
    pub len: usize,
    pub i: u32,
    pub iter_i: u32,
    /// null if and only if `object` has no properties (i.e. `len == 0`)
    pub impl_: Option<NonNull<JSPropertyIteratorImpl>>,

    pub global_object: &'a JSGlobalObject,
    pub object: &'a JSObject,
    // current property being yielded
    // PORT NOTE: bare JSValue field is sound because this struct is stack-only (`'a` borrow);
    // conservative stack scan keeps it alive. Do NOT box this struct.
    pub value: JSValue,
}

impl<'a, const OPTIONS: JSPropertyIteratorOptions> JSPropertyIterator<'a, OPTIONS> {
    pub fn get_longest_property_name(&self) -> usize {
        if let Some(iter) = self.impl_ {
            // SAFETY: `iter` is a live FFI handle (freed in Drop); global_object/object are
            // GC-borrowed for `'a`.
            unsafe {
                JSPropertyIteratorImpl::get_longest_property_name(
                    iter.as_ptr(),
                    self.global_object,
                    self.object,
                )
            }
        } else {
            0
        }
    }

    /// `object` should be a `JSC::JSObject`. Non-objects will be runtime converted.
    pub fn init(global_object: &'a JSGlobalObject, object: &'a JSObject) -> JsResult<Self> {
        let mut len: usize = 0;
        object.ensure_still_alive();
        let impl_ = JSPropertyIteratorImpl::init(
            global_object,
            object,
            &mut len,
            OPTIONS.own_properties_only,
            OPTIONS.only_non_index_properties,
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
            if OPTIONS.include_value {
                // SAFETY: `len > 0` here (checked above), so `impl_` is Some per init() invariant.
                let iter = unsafe { self.impl_.unwrap_unchecked() }.as_ptr();
                let current: JSValue = if OPTIONS.observable {
                    JSPropertyIteratorImpl::get_name_and_value(
                        iter,
                        self.global_object,
                        self.object,
                        &mut name,
                        i,
                    )?
                } else {
                    JSPropertyIteratorImpl::get_name_and_value_non_observable(
                        iter,
                        self.global_object,
                        self.object,
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
                // SAFETY: `len > 0` here, so `impl_` is Some per init() invariant.
                let iter = unsafe { self.impl_.unwrap_unchecked() }.as_ptr();
                // SAFETY: `iter` is a live FFI handle; `name` is a valid out-param.
                unsafe { JSPropertyIteratorImpl::get_name(iter, &mut name, i) };
            }

            if name.tag == bstr::Tag::Dead {
                continue;
            }

            if OPTIONS.skip_empty_name {
                if name.is_empty() {
                    continue;
                }
            }

            return Ok(Some(name));
        }
    }
}

impl<'a, const OPTIONS: JSPropertyIteratorOptions> Drop for JSPropertyIterator<'a, OPTIONS> {
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
#[repr(C)]
pub struct JSPropertyIteratorImpl {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

impl JSPropertyIteratorImpl {
    pub fn init(
        global_object: &JSGlobalObject,
        object: &JSObject,
        count: &mut usize,
        own_properties_only: bool,
        only_non_index_properties: bool,
    ) -> JsResult<Option<NonNull<JSPropertyIteratorImpl>>> {
        // TODO(port): Zig used `bun.jsc.fromJSHostCallGeneric(globalObject, @src(), fn, args)`
        // which wraps the raw extern call with exception-scope plumbing + source location.
        // Phase B should route through `bun_jsc::from_js_host_call_generic!` (or equivalent).
        let raw = unsafe {
            // SAFETY: global_object is a live VM global; object is a live JSObject (caller
            // ensure_still_alive'd it); count is a valid out-param.
            Bun__JSPropertyIterator__create(
                global_object,
                object.to_js(),
                count,
                own_properties_only,
                only_non_index_properties,
            )
        };
        // may return null without an exception
        if global_object.has_exception() {
            return Err(bun_jsc::JsError::Thrown);
        }
        Ok(NonNull::new(raw))
    }

    pub fn get_name_and_value(
        iter: *mut JSPropertyIteratorImpl,
        global_object: &JSGlobalObject,
        object: &JSObject,
        property_name: &mut bstr::String,
        i: usize,
    ) -> JsResult<JSValue> {
        // PORT NOTE: reshaped out-param ctor `scope.init(global, @src())` → value-returning new();
        // `defer scope.deinit()` → Drop.
        let scope = TopExceptionScope::new(global_object);
        // SAFETY: iter is a live FFI handle owned by the JSPropertyIterator; object is GC-borrowed;
        // property_name is a valid out-param.
        let value = unsafe {
            Bun__JSPropertyIterator__getNameAndValue(iter, global_object, object, property_name, i)
        };
        scope.return_if_exception()?;
        Ok(value)
    }

    pub fn get_name_and_value_non_observable(
        iter: *mut JSPropertyIteratorImpl,
        global_object: &JSGlobalObject,
        object: &JSObject,
        property_name: &mut bstr::String,
        i: usize,
    ) -> JsResult<JSValue> {
        let scope = TopExceptionScope::new(global_object);
        // SAFETY: same as get_name_and_value.
        let value = unsafe {
            Bun__JSPropertyIterator__getNameAndValueNonObservable(
                iter,
                global_object,
                object,
                property_name,
                i,
            )
        };
        scope.return_if_exception()?;
        Ok(value)
    }

    #[inline]
    pub unsafe fn get_name(
        iter: *mut JSPropertyIteratorImpl,
        property_name: &mut bstr::String,
        i: usize,
    ) {
        Bun__JSPropertyIterator__getName(iter, property_name, i)
    }

    #[inline]
    pub unsafe fn get_longest_property_name(
        iter: *mut JSPropertyIteratorImpl,
        global_object: &JSGlobalObject,
        object: &JSObject,
    ) -> usize {
        Bun__JSPropertyIterator__getLongestPropertyName(iter, global_object, object)
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    /// may return null without an exception
    fn Bun__JSPropertyIterator__create(
        global_object: *const JSGlobalObject,
        encoded_value: JSValue,
        count: *mut usize,
        own_properties_only: bool,
        only_non_index_properties: bool,
    ) -> *mut JSPropertyIteratorImpl;
    fn Bun__JSPropertyIterator__getNameAndValue(
        iter: *mut JSPropertyIteratorImpl,
        global_object: *const JSGlobalObject,
        object: *const JSObject,
        property_name: *mut bstr::String,
        i: usize,
    ) -> JSValue;
    fn Bun__JSPropertyIterator__getNameAndValueNonObservable(
        iter: *mut JSPropertyIteratorImpl,
        global_object: *const JSGlobalObject,
        object: *const JSObject,
        property_name: *mut bstr::String,
        i: usize,
    ) -> JSValue;
    fn Bun__JSPropertyIterator__getName(
        iter: *mut JSPropertyIteratorImpl,
        property_name: *mut bstr::String,
        i: usize,
    );
    fn Bun__JSPropertyIterator__deinit(iter: *mut JSPropertyIteratorImpl);
    fn Bun__JSPropertyIterator__getLongestPropertyName(
        iter: *mut JSPropertyIteratorImpl,
        global_object: *const JSGlobalObject,
        object: *const JSObject,
    ) -> usize;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSPropertyIterator.zig (153 lines)
//   confidence: medium
//   todos:      3
//   notes:      const-generic struct param needs adt_const_params OR split into 5 bool generics; fromJSHostCallGeneric wrapper stubbed inline
// ──────────────────────────────────────────────────────────────────────────
