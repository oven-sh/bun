use crate::{JSGlobalObject, JSValue, ZigStackTrace};

bun_opaque::opaque_ffi! {
    /// Opaque representation of a JavaScript exception
    pub struct Exception;
}

unsafe extern "C" {
    safe fn JSC__Exception__getStackTrace(
        this: &Exception,
        global: &JSGlobalObject,
        stack: &mut ZigStackTrace,
    );
    safe fn JSC__Exception__asJSValue(this: &Exception) -> JSValue;
}

impl Exception {
    pub(crate) fn get_stack_trace(&self, global: &JSGlobalObject, stack: &mut ZigStackTrace) {
        JSC__Exception__getStackTrace(self, global, stack);
    }

    pub(crate) fn value(&self) -> JSValue {
        JSC__Exception__asJSValue(self)
    }
}
