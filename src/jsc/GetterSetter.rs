use crate::{JSType, JSValue};

bun_opaque::sealed_handle! { pub struct GetterSetter; }

impl GetterSetter {
    pub(crate) fn from_js(value: &JSValue) -> Option<&GetterSetter> {
        // SAFETY: just checked.
        (value.js_type() == JSType::GetterSetter).then(|| unsafe { value.as_cell_unchecked() })
    }

    pub(crate) fn is_getter_null(&self) -> bool {
        JSC__GetterSetter__isGetterNull(self)
    }

    pub(crate) fn is_setter_null(&self) -> bool {
        JSC__GetterSetter__isSetterNull(self)
    }
}

unsafe extern "C" {
    safe fn JSC__GetterSetter__isGetterNull(this: &GetterSetter) -> bool;
    safe fn JSC__GetterSetter__isSetterNull(this: &GetterSetter) -> bool;
}
