use core::cell::Cell;
use core::marker::PhantomData;

use crate::{JSGlobalObject, JSValue, StrongCell};

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
///     this_value: JsRef, // = JsRef::empty()
///     connection: SomeConnection,
/// }
///
/// impl MyNativeObject {
///     pub fn init(global: &JSGlobalObject) -> Box<MyNativeObject> {
///         let this = MyNativeObject::new(Default::default());
///         let this_value = this.to_js(global);
///         // Start with strong ref - object has pending work (initialization)
///         this.this_value.set_strong(this_value, global);
///         this
///     }
///
///     fn update_reference_type(&self) {
///         if self.connection.is_active() {
///             // Keep object alive while connection is active
///             if self.this_value.is_not_empty() {
///                 self.this_value.upgrade(global);
///             }
///         } else {
///             // Allow GC when connection is idle
///             self.this_value.downgrade();
///         }
///     }
///
///     pub fn on_message(&self) {
///         // Safely retrieve the JSValue if still alive
///         let Some(this_value) = self.this_value.try_get() else { return };
///         // Use this_value...
///     }
///
///     pub fn finalize(&self) {
///         // Called when JS object is being garbage collected
///         self.this_value.finalize();
///         self.cleanup();
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
/// - **Strong**: Holds the value in a [`StrongCell`], which prevents garbage collection.
///   The JavaScript object will stay alive as long as this reference exists, and
///   this state is never empty (`try_get()` is `Some`).
///   Released by dropping the `JsRef`, or by `downgrade()`, `set_weak()` or `finalize()`.
///
/// - **Finalized**: The reference has been finalized (object was GC'd or explicitly cleaned up).
///   Indicates the JSValue is no longer valid. `try_get()` returns `None`.
///
/// # Key Methods
///
/// - `set_weak()` / `set_strong()`: Store a value in weak or strong mode
/// - `try_get()`: Safely retrieve the JSValue if still alive (returns `None` if finalized or empty)
/// - `upgrade()`: Convert weak → strong to prevent GC
/// - `downgrade()`: Convert strong → weak to allow GC (keeps the JSValue if still alive)
/// - `finalize()`: Mark as finalized and release resources (typically called from GC finalizer)
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
/// See ServerWebSocket, UDPSocket, JSMySQLConnection, and JSValkeyClient for examples.
///
/// `JsRef` is `!Send + !Sync` (transitively via `JSValue` and `StrongCell`): the
/// `StrongRootBlock` slot backing `StrongCell` hangs off the per-VM JSVMClientData
/// and must be dropped on the JS thread.
pub struct JsRef {
    /// `UNDEFINED` while empty, `ZERO` once finalized.
    value: Cell<JSValue>,
    /// Roots `value`. Has no slot unless strong.
    strong: StrongCell,
}

// Belt-and-suspenders: JSValue and StrongCell are already !Send/!Sync, but make it
// explicit so a future refactor of those types cannot accidentally make JsRef
// sendable.
const _: PhantomData<*const ()> = PhantomData;

impl JsRef {
    pub fn empty() -> Self {
        JsRef {
            value: Cell::new(JSValue::UNDEFINED),
            strong: StrongCell::default(),
        }
    }

    pub fn try_get(&self) -> Option<JSValue> {
        let value = self.value.get();
        (self.is_strong() || (self.is_not_empty() && value.is_live_cell())).then_some(value)
    }

    /// `try_get().unwrap_or(JSValue::UNDEFINED)`. Convenience for callers that
    /// previously stored a bare `JSValue` field and read it unconditionally —
    /// the `JsRef` wrapper was added for GC-safety, so `get()` recovers the
    /// original ergonomics.
    pub fn get(&self) -> JSValue {
        self.try_get().unwrap_or(JSValue::UNDEFINED)
    }

    pub fn set_weak(&self, value: JSValue) {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        self.value.set(value);
        self.strong.clear();
    }

    pub fn set_strong(&self, value: JSValue, global: &JSGlobalObject) {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        if !self.is_strong() {
            self.strong.acquire_slot(global, value);
        } else if self.value.get() != value {
            self.strong.set(global, value);
        }
        self.value.set(value);
    }

    pub fn upgrade(&self, global: &JSGlobalObject) {
        if self.is_strong() {
            return;
        }
        debug_assert!(self.is_not_empty());
        let value = self.value.get();
        if !self.is_finalized() && value.is_live_cell() {
            self.strong.acquire_slot(global, value);
        }
    }

    pub fn downgrade(&self) {
        self.strong.clear();
    }

    pub fn is_empty(&self) -> bool {
        self.value.get().is_empty_or_undefined_or_null()
    }

    pub fn is_finalized(&self) -> bool {
        self.value.get().is_empty()
    }

    pub fn is_not_empty(&self) -> bool {
        !self.is_empty()
    }

    /// Test whether this reference is a strong reference.
    pub fn is_strong(&self) -> bool {
        self.strong.has_slot()
    }

    pub fn finalize(&self) {
        self.value.set(JSValue::ZERO);
        self.strong.clear();
    }

    pub fn update(&self, global: &JSGlobalObject, value: JSValue) {
        debug_assert!(!self.is_finalized());
        if self.is_strong() {
            self.set_strong(value, global);
        } else if !self.is_finalized() {
            self.set_weak(value);
        }
    }

    /// Leaves `JsRef::empty()` behind.
    pub fn take(&self) -> JsRef {
        JsRef {
            value: Cell::new(self.value.replace(JSValue::UNDEFINED)),
            strong: self.strong.take(),
        }
    }
}

impl Default for JsRef {
    fn default() -> Self {
        JsRef::empty()
    }
}
