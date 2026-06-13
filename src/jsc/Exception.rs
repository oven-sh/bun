use crate::{BunStackTrace, JSGlobalObject, JSValue};

bun_opaque::opaque_ffi! {
    /// Opaque representation of a JavaScript exception
    pub struct Exception;
}

unsafe extern "C" {
    safe fn JSC__Exception__getStackTrace(
        this: &Exception,
        global: &JSGlobalObject,
        stack: &mut BunStackTrace,
    );
    safe fn JSC__Exception__asJSValue(this: &Exception) -> JSValue;
}

impl Exception {
    pub fn get_stack_trace(&self, global: &JSGlobalObject, stack: &mut BunStackTrace) {
        JSC__Exception__getStackTrace(self, global, stack);
    }

    pub fn value(&self) -> JSValue {
        JSC__Exception__asJSValue(self)
    }
}
