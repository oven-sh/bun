use core::marker::PhantomData;

use crate::bindgen::JsWrapper;
use crate::{JSGlobalObject, JSValue, JsCell, Strong, WrapperGuard};

/// Holds a reference to a JSValue with lifecycle management.
///
/// JsRef is used to safely maintain a reference to a JavaScript object from native code,
/// with explicit control over whether the reference keeps the object alive during garbage collection.
///
/// # Common Usage Pattern
///
/// JsRef is typically used in native objects that need to maintain a reference to their
/// corresponding JavaScript wrapper object. The reference can be upgraded to "strong" when
/// the native object has pending work or active connections, and downgraded to "weak" when idle:
///
/// ```ignore
/// struct MyNativeObject {
///     this_value: JsCell<JsRef>, // `thisValue: "this_value"` in the `.bind.ts` file
///     connection: SomeConnection,
/// }
///
/// impl MyNativeObject {
///     pub fn init(this_value: JsWrapper<'_, Self>, global: &JSGlobalObject) {
///         // Start with strong ref - object has pending work (initialization)
///         this_value.set_js_ref_strong(global);
///     }
///
///     fn update_reference_type(&self, global: &JSGlobalObject) {
///         if self.connection.is_active() {
///             // Keep object alive while connection is active
///             self.this_value.with_mut(|r| if r.is_not_empty() { r.upgrade(global) });
///         } else {
///             // Allow GC when connection is idle
///             self.this_value.with_mut(|r| r.downgrade());
///         }
///     }
///
///     pub fn on_message(&self) {
///         // Safely retrieve the JSValue if still alive
///         let Some(this_value) = self.this_value.try_get() else { return };
///         // Use this_value...
///     }
/// }
/// ```
///
/// # States
///
/// - **Weak**: Holds a JSValue directly. Does NOT prevent garbage collection.
///   The JSValue may become invalid if the object is collected.
///   Use `try_get()` to safely check if the value is still alive.
///
/// - **Strong**: Holds a [`Strong`] reference that prevents garbage collection.
///   The JavaScript object will stay alive as long as this reference exists, and a
///   `Strong` always holds a value, so this state is never empty (`try_get()` is `Some`).
///   Released by dropping/overwriting the `JsRef`.
///
/// - **Finalized**: The object was collected.
///   Indicates the JSValue is no longer valid. `try_get()` returns `None`.
///
/// # Key Methods
///
/// - `set_js_ref_weak()` / `set_js_ref_strong()`, on the object: the only ways to fill a JsRef
/// - `try_get()`: Safely retrieve the JSValue if still alive (returns `None` if finalized or empty)
/// - `upgrade()`: Convert weak → strong to prevent GC
/// - `downgrade()`: Convert strong → weak to allow GC (keeps the JSValue if still alive)
///
/// # When to Use Strong vs Weak
///
/// Use **strong** references when:
/// - The native object has active operations (network connections, pending requests, timers)
/// - You need to guarantee the JS object stays alive
/// - You'll call methods on the JS object from callbacks
///
/// Use **weak** references when:
/// - The native object is idle with no pending work
/// - The JS object should be GC-able if no other references exist
/// - You want to allow natural garbage collection
///
/// Common pattern: Start strong, downgrade to weak when idle, upgrade to strong when active.
/// See ServerWebSocket, UDPSocket and MySQLConnection for examples.
///
/// `JsRef` is `!Send + !Sync` (transitively via `JSValue` and `Strong`): the
/// `StrongRootBlock` slot backing `Strong` hangs off the per-VM JSVMClientData
/// and must be dropped on the JS thread.
pub enum JsRef {
    #[non_exhaustive]
    Weak(JSValue),
    #[non_exhaustive]
    Strong(Strong),
    Finalized,
}

// Belt-and-suspenders: JSValue and Strong are already !Send/!Sync, but make it
// explicit so a future refactor of those types cannot accidentally make JsRef
// sendable.
const _: PhantomData<*const ()> = PhantomData;

impl JsRef {
    pub fn empty() -> Self {
        JsRef::Weak(JSValue::UNDEFINED)
    }

    pub fn try_get(&self) -> Option<JSValue> {
        match self {
            JsRef::Weak(weak) => {
                if weak.is_empty_or_undefined_or_null() || !weak.is_live_cell() {
                    None
                } else {
                    Some(*weak)
                }
            }
            JsRef::Strong(strong) => Some(strong.get()),
            JsRef::Finalized => None,
        }
    }

    /// `try_get().unwrap_or(JSValue::UNDEFINED)`. Convenience for callers that
    /// previously stored a bare `JSValue` field and read it unconditionally —
    /// the `JsRef` wrapper was added for GC-safety, so `get()` recovers the
    /// original ergonomics.
    pub fn get(&self) -> JSValue {
        self.try_get().unwrap_or(JSValue::UNDEFINED)
    }

    fn set_strong(&mut self, value: JSValue, global: &JSGlobalObject) {
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
                if !weak.is_live_cell() {
                    return;
                }
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
                let value = strong.get();
                value.ensure_still_alive();
                // The old `Strong` is dropped by the assignment below; the
                // `strong` borrow ends at its last use above, permitting
                // reassignment of `*self`.
                *self = JsRef::Weak(value);
            }
            JsRef::Finalized => {}
        }
    }

    pub fn is_empty(&self) -> bool {
        match self {
            JsRef::Weak(weak) => weak.is_empty_or_undefined_or_null(),
            JsRef::Strong(_) => false,
            JsRef::Finalized => true,
        }
    }

    pub fn is_finalized(&self) -> bool {
        matches!(self, JsRef::Finalized)
    }

    pub fn is_not_empty(&self) -> bool {
        match self {
            JsRef::Weak(weak) => !weak.is_empty_or_undefined_or_null(),
            JsRef::Strong(_) => true,
            JsRef::Finalized => false,
        }
    }

    /// Test whether this reference is a strong reference.
    pub fn is_strong(&self) -> bool {
        matches!(self, JsRef::Strong(_))
    }
}

/// Generated for a class with `thisValue`. SAFETY: the object's finalizer calls `finalize_js_ref`.
pub unsafe trait HasJsRef: Sized {
    fn js_ref(&self) -> &JsCell<JsRef>;
    fn wrapped_by(object: JsWrapper<'_, Self>) -> &Self;

    #[doc(hidden)]
    fn finalize_js_ref(&self) {
        self.js_ref().set(JsRef::Finalized);
    }
}

impl<T: HasJsRef> WrapperGuard<'_, T> {
    pub fn set_js_ref_weak(&self) {
        T::js_ref(self).set(JsRef::Weak(self.to_js()));
    }

    pub fn set_js_ref_strong(&self, global: &JSGlobalObject) {
        T::js_ref(self).with_mut(|js_ref| js_ref.set_strong(self.to_js(), global));
    }
}

impl<'a, T: HasJsRef + 'a> JsWrapper<'a, T> {
    pub fn set_js_ref_weak(self) {
        T::wrapped_by(self).js_ref().set(JsRef::Weak(self.to_js()));
    }

    pub fn set_js_ref_strong(self, global: &JSGlobalObject) {
        (T::wrapped_by(self).js_ref()).with_mut(|js_ref| js_ref.set_strong(self.to_js(), global));
    }
}

impl Default for JsRef {
    fn default() -> Self {
        JsRef::empty()
    }
}

/// Forwarding accessors for the common `JsCell<JsRef>` field shape, so call
/// sites read `field.try_get()` / `field.get_or_undefined()` instead of the
/// double-step `field.get().try_get()` / `field.get().get()`.
pub trait JsCellRefExt {
    /// [`JsRef::try_get`] on the contained ref: the live `JSValue`, or `None`
    /// if empty/finalized.
    fn try_get(&self) -> Option<JSValue>;
    /// [`JsRef::get`] on the contained ref: `try_get().unwrap_or(UNDEFINED)`.
    fn get_or_undefined(&self) -> JSValue;
}

impl JsCellRefExt for crate::JsCell<JsRef> {
    #[inline]
    fn try_get(&self) -> Option<JSValue> {
        self.get().try_get()
    }

    #[inline]
    fn get_or_undefined(&self) -> JSValue {
        self.get().get()
    }
}
