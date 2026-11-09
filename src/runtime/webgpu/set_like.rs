use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, Callable, JsHeap, JsLocal, JsScope, JsWrapper};

use super::{Bun__WebGPU__createSet, Bun__WebGPU__createSetIterator};
use crate::generated_bindgen::webgpu::{js_GPUSupportedFeatures, js_WGSLLanguageFeatures};

/// An interface that is a `readonly setlike<DOMString>`. What it has never changes, so only its iterators need a `Set`,
/// which the `set` internal field holds.
macro_rules! set_like {
    ($Name:ident, $js:ident) => {
        pub(crate) struct $Name {
            /// In the order of iteration, without duplicates.
            values: Box<[bun_core::String]>,
        }

        impl $Name {
            pub(super) fn new(values: Vec<bun_core::String>) -> Self {
                Self {
                    values: values.into_boxed_slice(),
                }
            }

            pub(crate) fn get_size(&self) -> u32 {
                self.values.len() as u32
            }

            pub(crate) fn has(&self, value: &bun_core::String) -> bool {
                self.values.iter().any(|other| other.eql(value))
            }

            fn iterator<'a>(
                &self,
                this_value: JsWrapper<'a, Self>,
                heap: &JsHeap<'a>,
                entries: bool,
            ) -> JSValue {
                // SAFETY: a `Set` of strings and its iterator are made without running JavaScript.
                let global = unsafe { heap.global() };
                let set = $js::set_get_cached(this_value.to_js()).unwrap_or_else(|| {
                    // SAFETY: the strings outlive the call. Adding a string to a new `Set` does not throw.
                    let set = unsafe {
                        Bun__WebGPU__createSet(
                            global.as_mut_ptr(),
                            self.values.as_ptr(),
                            self.values.len(),
                        )
                    };
                    $js::set_set_cached(this_value.to_js(), global, set);
                    set
                });
                // SAFETY: `set` is the `Set` made above.
                unsafe { Bun__WebGPU__createSetIterator(global.as_mut_ptr(), set, entries) }
            }

            pub(crate) fn entries<'a>(
                &self,
                this_value: JsWrapper<'a, Self>,
                heap: &JsHeap<'a>,
            ) -> JSValue {
                self.iterator(this_value, heap, true)
            }

            pub(crate) fn keys<'a>(
                &self,
                this_value: JsWrapper<'a, Self>,
                heap: &JsHeap<'a>,
            ) -> JSValue {
                self.iterator(this_value, heap, false)
            }

            pub(crate) fn values<'a>(
                &self,
                this_value: JsWrapper<'a, Self>,
                heap: &JsHeap<'a>,
            ) -> JSValue {
                self.iterator(this_value, heap, false)
            }

            pub(crate) fn for_each<'a>(
                &self,
                this_value: JsWrapper<'a, Self>,
                cx: &mut JsScope<'a>,
                callback: JsLocal<'a, Callable>,
                this_arg: JsLocal<'a>,
            ) -> bindgen::Result<'a, ()> {
                for value in &self.values {
                    let value = bindgen::to_js::string(&cx.heap, value.clone())?;
                    let set = JsLocal::new(&cx.heap, this_value.to_js());
                    callback.call(cx, this_arg, &[value, value, set])?;
                }
                Ok(())
            }
        }
    };
}

set_like!(GPUSupportedFeatures, js_GPUSupportedFeatures);
set_like!(WGSLLanguageFeatures, js_WGSLLanguageFeatures);
