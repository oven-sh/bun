use core::cell::Cell;

use crate::bindgen::JsLocal;
use crate::host_fn::from_js_host_call_generic;
use crate::{JSGlobalObject, JSObject, JSValue, JsResult};

/// Runtime flag set passed to [`JSPropertyIterator::init`].
///
/// `Default` is `own_properties_only = true`,
/// `observable = true`, `only_non_index_properties = false`,
/// `include_symbols = false`.
// Runtime flags (not const generics) because the branches gate per-property work, not a
// hot inner loop, and the monomorphization fan-out would be 64 instantiations. Profile
// if hot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JSPropertyIteratorOptions {
    pub skip_empty_name: bool,
    pub include_value: bool,
    pub own_properties_only: bool,
    pub observable: bool,
    pub only_non_index_properties: bool,
    /// Also yield Symbol-keyed properties. The yielded name is the symbol's
    /// description, not a property key, so this is only for callers that
    /// count or display properties. Off by default, like `Object.keys`.
    pub include_symbols: bool,
}

impl JSPropertyIteratorOptions {
    /// Shorthand for the most common call-site shape; the remaining
    /// options take the [`Default`] values.
    pub const fn new(skip_empty_name: bool, include_value: bool) -> Self {
        Self {
            skip_empty_name,
            include_value,
            own_properties_only: true,
            observable: true,
            only_non_index_properties: false,
            include_symbols: false,
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
            include_symbols: false,
        }
    }
}

/// Two-field shorthand of [`JSPropertyIteratorOptions`]; the remaining options
/// take the default values via the `From` conversion.
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

pub struct JSPropertyIterator<'a> {
    pub len: usize,
    /// Index of the property last yielded by `next()`.
    pub(crate) i: Cell<u32>,
    iter_i: Cell<u32>,
    /// `None` if and only if `object` has no properties (i.e. `len == 0`)
    impl_: Option<OwnedJSPropertyIteratorImpl>,

    pub(crate) global_object: &'a JSGlobalObject,
    object: JsLocal<'a, JSObject>,
    options: JSPropertyIteratorOptions,
}

impl<'a> JSPropertyIterator<'a> {
    pub(crate) fn get_longest_property_name(&self) -> usize {
        if let Some(iter) = &self.impl_ {
            Bun__JSPropertyIterator__getLongestPropertyName(iter, self.global_object, &self.object)
        } else {
            0
        }
    }

    pub fn init(
        global_object: &'a JSGlobalObject,
        object: &JSObject,
        options: impl Into<JSPropertyIteratorOptions>,
    ) -> JsResult<Self> {
        let options = options.into();
        let mut len: usize = 0;
        object.to_js().ensure_still_alive();
        let impl_ = JSPropertyIteratorImpl::init(
            global_object,
            object,
            &mut len,
            options.own_properties_only,
            options.only_non_index_properties,
            options.include_symbols,
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
            i: Cell::new(0),
            iter_i: Cell::new(0),
            impl_,
            global_object,
            object: object.to_local(global_object),
            options,
        })
    }

    /// The name borrows the C++ iterator's storage (no ref) and is valid until
    /// `self` drops, hence `&self`: a yielded name may be held across later
    /// calls. The value is `JSValue::ZERO` unless `options.include_value`.
    pub fn next(&self) -> JsResult<Option<(bun_core::StringView<'_>, JSValue)>> {
        loop {
            let i: usize = self.iter_i.get() as usize;
            if i >= self.len {
                self.i.set(self.iter_i.get());
                return Ok(None);
            }

            self.i.set(self.iter_i.get());
            self.iter_i.set(self.iter_i.get() + 1);
            let mut name = bun_core::StringView::DEAD;
            let mut value = JSValue::ZERO;
            let iter = self
                .impl_
                .as_deref()
                .expect("len > 0 implies impl_ is Some");
            if self.options.include_value {
                let object = &*self.object;
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
                value = current;
            } else {
                // Exception check is unnecessary here because it won't throw.
                Bun__JSPropertyIterator__getName(iter, &mut name, i);
            }

            if name.is_dead() {
                continue;
            }

            if self.options.skip_empty_name && name.is_empty() {
                continue;
            }

            return Ok(Some((name, value)));
        }
    }
}

// Nomicon opaque-FFI pattern: !Send + !Sync + !Unpin
bun_opaque::sealed_handle! { struct JSPropertyIteratorImpl; }

// SAFETY: only `Bun__JSPropertyIterator__create` makes one.
bun_opaque::owned_handle! {
    struct OwnedJSPropertyIteratorImpl(JSPropertyIteratorImpl) => unsafe Bun__JSPropertyIterator__deinit;
}

impl JSPropertyIteratorImpl {
    fn init(
        global_object: &JSGlobalObject,
        object: &JSObject,
        count: &mut usize,
        own_properties_only: bool,
        only_non_index_properties: bool,
        include_symbols: bool,
    ) -> JsResult<Option<OwnedJSPropertyIteratorImpl>> {
        // may return null without an exception
        from_js_host_call_generic(global_object, || {
            Bun__JSPropertyIterator__create(
                global_object,
                object.to_js(),
                count,
                own_properties_only,
                only_non_index_properties,
                include_symbols,
            )
        })
    }

    fn get_name_and_value<'i>(
        iter: &'i JSPropertyIteratorImpl,
        global_object: &JSGlobalObject,
        object: &JSObject,
        property_name: &mut bun_core::StringView<'i>,
        i: usize,
    ) -> JsResult<JSValue> {
        // The FFI may return `.zero` without throwing, so the non-generic
        // `from_js_host_call` — which treats empty as thrown — is wrong here;
        // `from_js_host_call_generic` checks the exception scope instead.
        from_js_host_call_generic(global_object, || {
            Bun__JSPropertyIterator__getNameAndValue(iter, global_object, object, property_name, i)
        })
    }

    fn get_name_and_value_non_observable<'i>(
        iter: &'i JSPropertyIteratorImpl,
        global_object: &JSGlobalObject,
        object: &JSObject,
        property_name: &mut bun_core::StringView<'i>,
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

// safe fn: `JSPropertyIteratorImpl`/`JSGlobalObject`/`JSObject` are opaque
// ZST handles (`&` is ABI-identical to non-null `*const`);
// `StringView` is a 24-byte out-param the C++ side fills in-place (borrowed, +0); remaining
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
        include_symbols: bool,
    ) -> Option<OwnedJSPropertyIteratorImpl>;
    safe fn Bun__JSPropertyIterator__getNameAndValue<'i>(
        iter: &'i JSPropertyIteratorImpl,
        global_object: &JSGlobalObject,
        object: &JSObject,
        property_name: &mut bun_core::StringView<'i>,
        i: usize,
    ) -> JSValue;
    safe fn Bun__JSPropertyIterator__getNameAndValueNonObservable<'i>(
        iter: &'i JSPropertyIteratorImpl,
        global_object: &JSGlobalObject,
        object: &JSObject,
        property_name: &mut bun_core::StringView<'i>,
        i: usize,
    ) -> JSValue;
    safe fn Bun__JSPropertyIterator__getName<'i>(
        iter: &'i JSPropertyIteratorImpl,
        property_name: &mut bun_core::StringView<'i>,
        i: usize,
    );
    fn Bun__JSPropertyIterator__deinit(iter: *mut JSPropertyIteratorImpl);
    safe fn Bun__JSPropertyIterator__getLongestPropertyName(
        iter: &JSPropertyIteratorImpl,
        global_object: &JSGlobalObject,
        object: &JSObject,
    ) -> usize;
}
