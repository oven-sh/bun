use crate::JSType;
use crate::custom_getter_setter::CustomGetterSetter;
use crate::getter_setter::GetterSetter;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `JSC::JSCell`.
    pub struct JSCell;
}

impl JSCell {
    #[track_caller]
    pub(crate) fn get_type(&self) -> JSType {
        crate::mark_member_binding("JSCell", core::panic::Location::caller());
        // `JSType` is a `#[repr(transparent)]` newtype over `u8`, so any byte
        // returned by the extern is a valid value (see the extern's NOTE).
        JSType(JSC__JSCell__getType(self))
    }

    pub(crate) fn get_getter_setter(&self) -> &GetterSetter {
        debug_assert!(self.get_type() == JSType::GetterSetter);
        // Caller-asserted invariant — this cell's JSType is GetterSetter.
        // `GetterSetter` is an `opaque_ffi!` ZST handle; `opaque_ref` is the
        // centralised non-null-ZST deref proof (`self` is non-null).
        GetterSetter::opaque_ref(std::ptr::from_ref::<JSCell>(self).cast::<GetterSetter>())
    }

    pub(crate) fn get_custom_getter_setter(&self) -> &CustomGetterSetter {
        debug_assert!(self.get_type() == JSType::CustomGetterSetter);
        // Caller-asserted invariant — this cell's JSType is CustomGetterSetter.
        // `CustomGetterSetter` is an `opaque_ffi!` ZST handle; see `get_getter_setter`.
        CustomGetterSetter::opaque_ref(
            std::ptr::from_ref::<JSCell>(self).cast::<CustomGetterSetter>(),
        )
    }
}

// `JSCell`/`JSGlobalObject` are opaque `UnsafeCell`-backed ZST handles, so
// `&T` is ABI-identical to a non-null `*const T` and C++ mutating cell state
// through it is interior mutation invisible to Rust.
unsafe extern "C" {
    // NOTE: this function always returns a JSType, but by using `u8` then
    // casting it via `@enumFromInt` we can ensure our `JSType` enum matches
    // WebKit's. This protects us from possible future breaking changes made
    // when upgrading WebKit.
    safe fn JSC__JSCell__getType(this: &JSCell) -> u8;
}

// ════════════════════════════════════════════════════════════════════════════
// JsCell<T> — single-JS-thread interior mutability
// ════════════════════════════════════════════════════════════════════════════

pub use bun_ptr::JsCell;
