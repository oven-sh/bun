use core::marker::PhantomData;

// The methods used below (`get() -> Option`, `has()`, `try_swap()`) live on
// the Optional wrapper, so import it under the local name `Strong`.
use crate::strong::Optional as Strong;
use crate::weak::Weak;
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
/// - **Weak**: Holds a passive `JSC::Weak` handle registered against the
///   value's cell. Does NOT prevent garbage collection. `try_get()` returns
///   `None` from the moment GC reaps the referent — before the lazy sweep
///   runs the wrapper's destructor (which is what flips the ref to
///   `Finalized`) — so a deferred reader can never observe a dead cell.
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
/// `JsRef` is `!Send + !Sync` (transitively via `Weak` and `Strong`): the
/// `StrongRootBlock` slot backing `Strong` hangs off the per-VM JSVMClientData,
/// and the `JSC::Weak` handle backing `Weak` lives in the cell's `WeakSet`;
/// both must be created and dropped on the JS thread.
pub enum JsRef {
    Weak(Weak<()>),
    Strong(Strong),
    Finalized,
}

// Belt-and-suspenders: Weak and Strong are already !Send/!Sync, but make it
// explicit so a future refactor of those types cannot accidentally make JsRef
// sendable.
const _: PhantomData<*const ()> = PhantomData;

impl JsRef {
    pub fn init_weak(value: JSValue) -> Self {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        JsRef::Weak(Weak::create_passive(value))
    }

    pub fn init_strong(value: JSValue, global: &JSGlobalObject) -> Self {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        JsRef::Strong(Strong::create(value, global))
    }

    pub fn empty() -> Self {
        JsRef::Weak(Weak::default())
    }

    pub fn try_get(&self) -> Option<JSValue> {
        match self {
            JsRef::Weak(weak) => weak.get(),
            JsRef::Strong(strong) => strong.get(),
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

    pub fn set_weak(&mut self, value: JSValue) {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        if matches!(self, JsRef::Finalized) {
            return;
        }
        // Overwriting `*self` drops the prior variant (a `Strong`'s `Drop`
        // releases its block slot; a `Weak`'s `Drop` frees its handle).
        *self = JsRef::Weak(Weak::create_passive(value));
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
                // A reaped referent cannot be resurrected: stay `Weak` (dead)
                // so readers keep seeing `None`. This also makes an upgrade
                // that races wrapper collection a skip instead of a re-root
                // of a dead cell.
                if let Some(value) = weak.get() {
                    *self = JsRef::Strong(Strong::create(value, global));
                }
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
                // Register the weak handle while the `Strong` still roots the
                // referent, so there is no window in which the value is
                // unrooted; the old `Strong` is dropped by the assignment.
                let weak = match strong.get() {
                    Some(value) => Weak::create_passive(value),
                    None => Weak::default(),
                };
                *self = JsRef::Weak(weak);
            }
            JsRef::Finalized => {}
        }
    }

    pub fn is_empty(&self) -> bool {
        match self {
            JsRef::Weak(weak) => weak.get().is_none(),
            JsRef::Strong(strong) => !strong.has(),
            JsRef::Finalized => true,
        }
    }

    pub fn is_not_empty(&self) -> bool {
        match self {
            JsRef::Weak(weak) => weak.get().is_some(),
            JsRef::Strong(strong) => strong.has(),
            JsRef::Finalized => false,
        }
    }

    /// Test whether this reference is a strong reference.
    pub fn is_strong(&self) -> bool {
        matches!(self, JsRef::Strong(_))
    }

    pub fn finalize(&mut self) {
        // Overwriting `*self` drops the prior variant (releasing the `Strong`
        // block slot via its `Drop`), so no explicit deinit step is needed.
        // External `jsref.deinit()` callers become `*jsref = JsRef::empty()`.
        *self = JsRef::Finalized;
    }

    pub fn update(&mut self, global: &JSGlobalObject, value: JSValue) {
        match self {
            JsRef::Weak(_) => {
                debug_assert!(!value.is_empty_or_undefined_or_null());
                *self = JsRef::Weak(Weak::create_passive(value));
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

/// Non-registering sibling of [`JsRef`] for wrapper back-pointers that are
/// only read synchronously while the wrapper is rooted by the caller (the
/// receiver of a host fn, or a value just created / passed in on the JS
/// stack).
///
/// Holds the bare `JSValue` with no GC registration, so it costs nothing per
/// object — a [`JsRef::Weak`] allocates a `JSC::Weak` handle, and for
/// precise-allocated wrapper cells that means a `WeakBlock` in the cell's own
/// `WeakSet` (1 KB each), which is too heavy to pay on every `Request` /
/// `Response` construction. In exchange `try_get()` says nothing about
/// liveness: a read after the wrapper dies hands back a dangling value.
/// Deferred readers (event-loop callbacks, queued tasks, socket/timer
/// dispatch) must use [`JsRef`], whose weak read goes dead the moment GC
/// reaps the referent.
pub enum RawJsRef {
    Value(JSValue),
    Finalized,
}

impl RawJsRef {
    pub fn init(value: JSValue) -> Self {
        debug_assert!(!value.is_empty_or_undefined_or_null());
        RawJsRef::Value(value)
    }

    pub fn empty() -> Self {
        RawJsRef::Value(JSValue::UNDEFINED)
    }

    pub fn try_get(&self) -> Option<JSValue> {
        match self {
            RawJsRef::Value(value) => {
                if value.is_empty_or_undefined_or_null() {
                    None
                } else {
                    Some(*value)
                }
            }
            RawJsRef::Finalized => None,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.try_get().is_none()
    }

    pub fn finalize(&mut self) {
        *self = RawJsRef::Finalized;
    }
}

impl Default for RawJsRef {
    fn default() -> Self {
        RawJsRef::empty()
    }
}

/// Forwarding accessors for the common `JsCell<JsRef>` field shape, so call
/// sites read `field.try_get()` / `field.get_or_undefined()` instead of the
/// double-step `field.get().try_get()` / `field.get().get()`.
impl crate::JsCell<JsRef> {
    /// [`JsRef::try_get`] on the contained ref: the live `JSValue`, or `None`
    /// if empty/finalized.
    #[inline]
    pub fn try_get(&self) -> Option<JSValue> {
        self.get().try_get()
    }

    /// [`JsRef::get`] on the contained ref: `try_get().unwrap_or(UNDEFINED)`.
    #[inline]
    pub fn get_or_undefined(&self) -> JSValue {
        self.get().get()
    }
}
