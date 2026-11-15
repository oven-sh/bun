use crate::{JSType, JSValue};

bun_opaque::sealed_handle! {
    /// Opaque FFI handle for `JSC::CustomGetterSetter`.
    pub struct CustomGetterSetter;
}

impl CustomGetterSetter {
    pub(crate) fn from_js(value: &JSValue) -> Option<&CustomGetterSetter> {
        // SAFETY: just checked.
        (value.js_type() == JSType::CustomGetterSetter)
            .then(|| unsafe { value.as_cell_unchecked() })
    }

    pub(crate) fn is_getter_null(&self) -> bool {
        JSC__CustomGetterSetter__isGetterNull(self)
    }

    pub(crate) fn is_setter_null(&self) -> bool {
        JSC__CustomGetterSetter__isSetterNull(self)
    }
}

unsafe extern "C" {
    safe fn JSC__CustomGetterSetter__isGetterNull(this: &CustomGetterSetter) -> bool;
    safe fn JSC__CustomGetterSetter__isSetterNull(this: &CustomGetterSetter) -> bool;
}
