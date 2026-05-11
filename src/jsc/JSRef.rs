use core::marker::PhantomData;

use bun_jsc_types::JsRefState;
use crate::strong;
use crate::{JSGlobalObject, JSValue};

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
///         this.this_value = JsRef::init_strong(this_value, global);
///         this
///     }
///
///     fn update_reference_type(&mut self) {
///         if self.connection.is_active() {
///             // Keep object alive while connection is active
///             if self.this_value.is_not_empty() && self.this_value.is_weak() {
///                 self.this_value.upgrade(global);
///             }
///         } else {
///             // Allow GC when connection is idle
///             if self.this_value.is_not_empty() && self.this_value.is_strong() {
///                 self.this_value.downgrade();
///             }
///         }
///     }
///
///     pub fn on_message(&mut self) {
///         // Safely retrieve the JSValue if still alive
///         let Some(this_value) = self.this_value.try_get() else { return };
///         // Use this_value...
///     }
///
///     pub fn finalize(&mut self) {
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
/// - **Strong**: Holds a Strong reference that prevents garbage collection.
///   The JavaScript object will stay alive as long as this reference exists.
///   Released by dropping/overwriting the `JsRef`, or by `finalize()`.
///
/// - **Finalized**: The reference has been finalized (object was GC'd or explicitly cleaned up).
///   Indicates the JSValue is no longer valid. `try_get()` returns `None`.
///
/// # Key Methods
///
/// - `init_weak()` / `init_strong()`: Create a new JsRef in weak or strong mode
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
/// See ServerWebSocket, UDPSocket, MySQLConnection, and ValkeyClient for examples.
///
/// `JsRef` is `!Send + !Sync` (transitively via the encoded JS value state):
/// the `HandleSlot` backing a strong state is owned by the VM's `HandleSet`
/// and must be dropped on the JS thread.
pub struct JsRef {
    state: JsRefState,
}

// Belt-and-suspenders: JsRefState is already !Send/!Sync through its encoded
// JS value payload, but make the marker explicit so a future refactor of that
// sidecar state cannot accidentally make JsRef sendable.
// TODO(port): if a zero-cost marker is preferred over auto-trait inference,
// wrap in a struct with `PhantomData<*const ()>`.
const _: PhantomData<*const ()> = PhantomData;

impl JsRef {
    #[inline]
    fn from_state(state: JsRefState) -> Self {
        Self { state }
    }

    fn destroy_strong_if_present(&mut self) {
        let Some(handle) = self.state.take_strong_handle() else { return };
        // SAFETY: a strong handle stored in JsRef was allocated by
        // `strong::init_handle` and is consumed exactly once here.
        unsafe { strong::destroy_handle(handle) };
    }

    pub fn init_weak(value: JSValue) -> Self {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        Self::from_state(JsRefState::weak(value.encoded_value()))
    }

    pub fn init_strong(value: JSValue, global: &JSGlobalObject) -> Self {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        Self::from_state(JsRefState::strong(strong::init_handle(global, value)))
    }

    pub fn empty() -> Self {
        Self::from_state(JsRefState::empty())
    }

    pub fn try_get(&self) -> Option<JSValue> {
        match self.state {
            JsRefState::Weak(weak) => {
                if weak.is_empty_or_undefined_or_null() {
                    None
                } else {
                    Some(JSValue::from_encoded_value(weak))
                }
            }
            JsRefState::Strong(strong) => {
                let handle = strong.get()?;
                let value = strong::get_handle(handle);
                if value.is_empty() {
                    None
                } else {
                    Some(value)
                }
            }
            JsRefState::Finalized => None,
        }
    }

    /// `try_get().unwrap_or(JSValue::UNDEFINED)`. Convenience for callers that
    /// previously stored a bare `JSValue` field (Zig `this.js_value`) and read
    /// it unconditionally — the `JsRef` wrapper was added on the Rust side for
    /// GC-safety, so `get()` recovers the original ergonomics.
    pub fn get(&self) -> JSValue {
        self.try_get().unwrap_or(JSValue::UNDEFINED)
    }

    pub fn set_weak(&mut self, value: JSValue) {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        match self.state {
            JsRefState::Weak(_) => {}
            JsRefState::Strong(_) => {
                // PORT NOTE: Zig calls `this.strong.deinit()` here. In Rust,
                // `JsRef` owns the inert strong handle and explicitly destroys
                // it before overwriting the state below.
                self.destroy_strong_if_present();
            }
            JsRefState::Finalized => {
                return;
            }
        }
        self.state = JsRefState::weak(value.encoded_value());
    }

    pub fn set_strong(&mut self, value: JSValue, global: &JSGlobalObject) {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        if let JsRefState::Strong(strong) = &mut self.state {
            let Some(handle) = strong.get() else {
                strong.set(strong::init_handle(global, value));
                return;
            };
            strong::set_handle(handle, global, value);
        } else {
            self.state = JsRefState::strong(strong::init_handle(global, value));
        }
    }

    pub fn upgrade(&mut self, global: &JSGlobalObject) {
        match self.state {
            JsRefState::Weak(weak) => {
                let weak = JSValue::from_encoded_value(weak);
                debug_assert!(!weak.is_empty_or_undefined_or_null());
                self.state = JsRefState::strong(strong::init_handle(global, weak));
            }
            JsRefState::Strong(_) => {}
            JsRefState::Finalized => {
                debug_assert!(false);
            }
        }
    }

    pub fn downgrade(&mut self) {
        match self.state {
            JsRefState::Weak(_) => {}
            JsRefState::Strong(_) => {
                let value = if let Some(handle) = self.state.take_strong_handle() {
                    let value = strong::get_handle(handle);
                    let value = if value.is_empty() {
                        JSValue::UNDEFINED
                    } else {
                        strong::clear_handle(handle);
                        value
                    };
                    // SAFETY: a strong handle stored in JsRef was allocated by
                    // `strong::init_handle` and is consumed exactly once here.
                    unsafe { strong::destroy_handle(handle) };
                    value
                } else {
                    JSValue::UNDEFINED
                };
                value.ensure_still_alive();
                // PORT NOTE: Zig calls `strong.deinit()` here. `JsRef` owns
                // the inert sidecar handle and destroys it before storing the
                // weak encoded value.
                self.state = JsRefState::weak(value.encoded_value());
            }
            JsRefState::Finalized => {}
        }
    }

    pub fn is_empty(&self) -> bool {
        match self.state {
            JsRefState::Weak(weak) => weak.is_empty_or_undefined_or_null(),
            JsRefState::Strong(strong) => {
                let Some(handle) = strong.get() else { return true };
                strong::get_handle(handle).is_empty()
            }
            JsRefState::Finalized => true,
        }
    }

    pub fn is_not_empty(&self) -> bool {
        match self.state {
            JsRefState::Weak(weak) => !weak.is_empty_or_undefined_or_null(),
            JsRefState::Strong(strong) => {
                let Some(handle) = strong.get() else { return false };
                !strong::get_handle(handle).is_empty()
            }
            JsRefState::Finalized => false,
        }
    }

    pub fn is_weak(&self) -> bool {
        self.state.is_weak()
    }

    /// Test whether this reference is a strong reference.
    pub fn is_strong(&self) -> bool {
        self.state.is_strong()
    }

    pub fn is_finalized(&self) -> bool {
        self.state.is_finalized()
    }

    pub fn finalize(&mut self) {
        // PORT NOTE: Zig calls `self.deinit()` then sets `.finalized`. In Rust,
        // `JsRef` owns the inert strong handle and explicitly destroys it
        // before setting `.finalized`.
        // Phase B: external `jsref.deinit()` callers become `*jsref = JsRef::empty()`.
        self.destroy_strong_if_present();
        self.state = JsRefState::finalized();
    }

    pub fn update(&mut self, global: &JSGlobalObject, value: JSValue) {
        match &mut self.state {
            JsRefState::Weak(weak) => {
                debug_assert!(!value.is_empty_or_undefined_or_null());
                *weak = value.encoded_value();
            }
            JsRefState::Strong(strong) => {
                let Some(handle) = strong.get() else {
                    if !value.is_empty() {
                        strong.set(strong::init_handle(global, value));
                    }
                    return;
                };
                if strong::get_handle(handle) != value {
                    strong::set_handle(handle, global, value);
                }
            }
            JsRefState::Finalized => {
                debug_assert!(false);
            }
        }
    }
}

impl Drop for JsRef {
    fn drop(&mut self) {
        self.destroy_strong_if_present();
    }
}

impl Default for JsRef {
    fn default() -> Self {
        JsRef::empty()
    }
}

// ported from: src/jsc/JSRef.zig
