use bun_jsc::{JSGlobalObject, JSValue, JsResult};

pub(crate) type CallbackGetterFn = extern "C" fn(JSValue) -> JSValue;
pub(crate) type CallbackSetterFn = extern "C" fn(JSValue, JSValue);

#[derive(Copy, Clone)]
pub struct CallbackWrapper {
    get_fn: CallbackGetterFn,
    set_fn: CallbackSetterFn,
    // PORT NOTE: bare JSValue field is sound here — this wrapper is a by-value stack helper
    // (Zig methods take `self: @This()`, not `*@This()`); never heap-stored.
    pub container: JSValue,
}

impl CallbackWrapper {
    #[inline]
    pub const fn new(
        getter: CallbackGetterFn,
        setter: CallbackSetterFn,
        container: JSValue,
    ) -> Self {
        Self {
            get_fn: getter,
            set_fn: setter,
            container,
        }
    }

    #[inline]
    pub fn get(self) -> Option<JSValue> {
        let res = (self.get_fn)(self.container);
        if res.is_empty_or_undefined_or_null() {
            return None;
        }
        Some(res)
    }

    #[inline]
    pub fn set(self, value: JSValue) {
        (self.set_fn)(self.container, value);
    }

    #[inline]
    pub fn call(
        self,
        global_object: &JSGlobalObject,
        args: &[JSValue],
    ) -> JsResult<Option<JSValue>> {
        // PORT NOTE: codegen.zig's `callback.call(globalObject, args)` predates the
        // 3-arg JSValue.call signature and is dead Zig (never instantiated). The intent
        // is `callWithGlobalThis`; the JS exception is propagated rather than swallowed.
        if let Some(callback) = self.get() {
            return Ok(Some(callback.call_with_global_this(global_object, args)?));
        }
        Ok(None)
    }
}

// ported from: src/jsc/codegen.zig
