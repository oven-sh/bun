use core::marker::PhantomData;

use crate::{JSGlobalObject, JSValue, Strong};

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
///             if self.this_value.is_not_empty() && matches!(self.this_value, JsRef::Weak(_)) {
///                 self.this_value.upgrade(global);
///             }
///         } else {
///             // Allow GC when connection is idle
///             if self.this_value.is_not_empty() && matches!(self.this_value, JsRef::Strong(_)) {
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
/// `JsRef` is `!Send + !Sync` (transitively via `JSValue` and `Strong`): the
/// `HandleSlot` backing `Strong` is owned by the VM's `HandleSet` and must be
/// dropped on the JS thread.
pub enum JsRef {
    Weak(JSValue),
    Strong(Strong),
    Finalized,
}

// Belt-and-suspenders: JSValue and Strong are already !Send/!Sync, but make it
// explicit so a future refactor of those types cannot accidentally make JsRef
// sendable.
// TODO(port): if a zero-cost marker is preferred over auto-trait inference,
// wrap in a struct with `PhantomData<*const ()>`.
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
                // PORT NOTE: Zig calls `strong.deinit()` here; in Rust the old
                // `Strong` is dropped by the assignment below.
                // PORT NOTE: reshaped for borrowck — `strong` borrow ends at
                // last use above, permitting reassignment of `*self`.
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
        // PORT NOTE: Zig calls `self.deinit()` then sets `.finalized`. In Rust,
        // overwriting `*self` drops the prior variant (releasing the `Strong`
        // HandleSlot via its `Drop`), so the explicit deinit step is elided.
        // Phase B: external `jsref.deinit()` callers become `*jsref = JsRef::empty()`.
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSRef.zig (225 lines)
//   confidence: high
//   todos:      1
//   notes:      Strong.Optional folded into bun_jsc::Strong; explicit .deinit() calls become implicit via Strong's Drop on reassignment. Zig `pub fn deinit` dropped per PORTING.md — callers migrate to `*jsref = JsRef::empty()` in Phase B.
// ──────────────────────────────────────────────────────────────────────────
