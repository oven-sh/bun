use core::marker::PhantomData;

// PORT NOTE: JSRef.zig stores `jsc.Strong.Optional`, not `jsc.Strong`. The
// methods below (`get() -> Option`, `has()`, `try_swap()`) live on the
// Optional wrapper, so import it under the local name `Strong`.
use crate::strong::Optional as Strong;
use crate::{JSGlobalObject, JSValue};

pub enum JsRef {
    Weak(JSValue),
    Strong(Strong),
    Finalized,
}

const _: PhantomData<*const ()> = PhantomData;

impl JsRef {
    pub fn init_weak(value: JSValue) -> Self {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        JsRef::Weak(value)
    }

    pub fn init_strong(value: JSValue, global: &JSGlobalObject) -> Self {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        JsRef::Strong(Strong::create(value, global))
    }

    pub fn empty() -> Self {
        JsRef::Weak(JSValue::UNDEFINED)
    }

    pub fn try_get(&self) -> Option<JSValue> {
        match self {
            JsRef::Weak(weak) => {
                if weak.is_empty_or_undefined_or_null() {
                    None
                } else {
                    Some(*weak)
                }
            }
            JsRef::Strong(strong) => strong.get(),
            JsRef::Finalized => None,
        }
    }

    pub fn get(&self) -> JSValue {
        self.try_get().unwrap_or(JSValue::UNDEFINED)
    }

    pub fn set_weak(&mut self, value: JSValue) {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        match self {
            JsRef::Weak(_) => {}
            JsRef::Strong(_) => {
                // PORT NOTE: Zig calls `this.strong.deinit()` here. In Rust,
                // `Strong`'s `Drop` deallocates the HandleSlot when `*self` is
                // overwritten below, so the explicit call is elided.
            }
            JsRef::Finalized => {
                return;
            }
        }
        *self = JsRef::Weak(value);
    }

    pub fn set_strong(&mut self, value: JSValue, global: &JSGlobalObject) {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        if let JsRef::Strong(strong) = self {
            strong.set(global, value);
            return;
        }
        *self = JsRef::Strong(Strong::create(value, global));
    }

    pub fn upgrade(&mut self, global: &JSGlobalObject) {
        match self {
            JsRef::Weak(weak) => {
                debug_assert!(!weak.is_empty_or_undefined_or_null());
                let weak = *weak;
                *self = JsRef::Strong(Strong::create(weak, global));
            }
            JsRef::Strong(_) => {}
            JsRef::Finalized => {
                debug_assert!(false);
            }
        }
    }

    pub fn downgrade(&mut self) {
        match self {
            JsRef::Weak(_) => {}
            JsRef::Strong(strong) => {
                let value = strong.try_swap().unwrap_or(JSValue::UNDEFINED);
                value.ensure_still_alive();
                *self = JsRef::Weak(value);
            }
            JsRef::Finalized => {}
        }
    }

    pub fn is_empty(&self) -> bool {
        match self {
            JsRef::Weak(weak) => weak.is_empty_or_undefined_or_null(),
            JsRef::Strong(strong) => !strong.has(),
            JsRef::Finalized => true,
        }
    }

    pub fn is_not_empty(&self) -> bool {
        match self {
            JsRef::Weak(weak) => !weak.is_empty_or_undefined_or_null(),
            JsRef::Strong(strong) => strong.has(),
            JsRef::Finalized => false,
        }
    }

    /// Test whether this reference is a strong reference.
    pub fn is_strong(&self) -> bool {
        matches!(self, JsRef::Strong(_))
    }

    pub fn finalize(&mut self) {
        *self = JsRef::Finalized;
    }

    pub fn update(&mut self, global: &JSGlobalObject, value: JSValue) {
        match self {
            JsRef::Weak(weak) => {
                debug_assert!(!value.is_empty_or_undefined_or_null());
                *weak = value;
            }
            JsRef::Strong(strong) => {
                if strong.get() != Some(value) {
                    strong.set(global, value);
                }
            }
            JsRef::Finalized => {
                debug_assert!(false);
            }
        }
    }
}

impl Default for JsRef {
    fn default() -> Self {
        JsRef::empty()
    }
}

// ported from: src/jsc/JSRef.zig
