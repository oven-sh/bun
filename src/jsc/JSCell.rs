use core::marker::{PhantomData, PhantomPinned};

use crate::custom_getter_setter::CustomGetterSetter;
use crate::getter_setter::GetterSetter;
use crate::{JSGlobalObject, JSObject, JSValue};

/// Opaque FFI handle for `JSC::JSCell`.
#[repr(C)]
pub struct JSCell {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl JSCell {
    /// Statically cast a cell to a JSObject. Returns null for non-objects.
    /// Use `to_object` to mutate non-objects into objects.
    pub fn get_object(&self) -> Option<&JSObject> {
        // TODO(port): jsc.markMemberBinding(JSCell, @src()) — comptime binding marker, likely drop
        // SAFETY: FFI call; returned pointer (if non-null) borrows from `self`'s heap cell.
        unsafe { JSC__JSCell__getObject(self).as_ref() }
    }

    /// Convert a cell to a JSObject.
    ///
    /// Statically casts cells that are already objects, otherwise mutates them
    /// into objects.
    ///
    /// ## References
    /// - [ECMA-262 §7.1.18 ToObject](https://tc39.es/ecma262/#sec-toobject)
    pub fn to_object<'a>(&'a self, global: &'a JSGlobalObject) -> &'a JSObject {
        // TODO(port): jsc.markMemberBinding(JSCell, @src()) — comptime binding marker, likely drop
        // SAFETY: FFI call; C++ side never returns null for ToObject on a cell.
        unsafe { &*JSC__JSCell__toObject(self, global) }
    }

    pub fn get_type(&self) -> u8 {
        // TODO(port): jsc.markMemberBinding(JSCell, @src()) — comptime binding marker, likely drop
        // TODO(port): Zig wraps the extern result in @enumFromInt but the fn return type is `u8`;
        // likely intended to return `JSType` — verify in Phase B.
        // SAFETY: plain FFI getter.
        unsafe { JSC__JSCell__getType(self) }
    }

    pub fn to_js(&self) -> JSValue {
        JSValue::from_cell(self as *const JSCell)
    }

    pub fn get_getter_setter(&self) -> &GetterSetter {
        // TODO(b2-blocked): bun_jsc::JSValue::is_getter_setter (debug_assert dropped while JSValue.rs gated)
        // SAFETY: caller-asserted invariant — this cell's JSType is GetterSetter.
        unsafe { &*(self as *const JSCell as *const GetterSetter) }
    }

    pub fn get_custom_getter_setter(&self) -> &CustomGetterSetter {
        // TODO(b2-blocked): bun_jsc::JSValue::is_custom_getter_setter (debug_assert dropped while JSValue.rs gated)
        // SAFETY: caller-asserted invariant — this cell's JSType is CustomGetterSetter.
        unsafe { &*(self as *const JSCell as *const CustomGetterSetter) }
    }

    pub fn ensure_still_alive(&self) {
        core::hint::black_box(self as *const JSCell);
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSC__JSCell__getObject(this: *const JSCell) -> *mut JSObject;
    fn JSC__JSCell__toObject(this: *const JSCell, global: *const JSGlobalObject) -> *mut JSObject;
    // NOTE: this function always returns a JSType, but by using `u8` then
    // casting it via `@enumFromInt` we can ensure our `JSType` enum matches
    // WebKit's. This protects us from possible future breaking changes made
    // when upgrading WebKit.
    fn JSC__JSCell__getType(this: *const JSCell) -> u8;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSCell.zig (64 lines)
//   confidence: high
//   todos:      4
//   notes:      get_type: Zig had @enumFromInt with u8 return — verify intended JSType return; markMemberBinding markers dropped
// ──────────────────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════
// JsCell<T> — single-JS-thread interior mutability
// ════════════════════════════════════════════════════════════════════════════

/// `JsCell<T>` is a `#[repr(transparent)]` wrapper over `UnsafeCell<T>` that
/// hands out `&mut T` from `&self`. It is the load-bearing primitive that lets
/// `VirtualMachine::get()` / `JSGlobalObject::bun_vm()` return a *safe*
/// `&'static VirtualMachine` while still permitting field mutation.
///
/// ## Soundness model
///
/// Bun runs **one** `VirtualMachine` per JS thread. JavaScript is
/// single-threaded and reentrant: a host function may call back into JS, which
/// may call back into Rust, but always on the *same* OS thread. There is no
/// true concurrent aliasing — only stacked, same-thread reentrancy. The Zig
/// source models this with raw `*VirtualMachine` everywhere; `JsCell` is the
/// Rust spelling of that contract.
///
/// `get_mut()` is therefore *not* sound under arbitrary `Sync` semantics — the
/// `unsafe impl Sync` below is a lie to the type system that we discharge by
/// the thread-affinity invariant: a `JsCell` embedded in `VirtualMachine` (or
/// any JS-heap-adjacent struct) is only ever touched from its owning JS
/// thread. Cross-thread access goes through `ConcurrentTask` /
/// `enqueueTaskConcurrent`, which never hands out a `&JsCell`.
///
/// This is morally `Cell<T>` with a `get_mut`-from-`&self` escape hatch and
/// no `T: Copy` bound. It exists so ~10k `unsafe { &mut *vm_ptr }` blocks at
/// call sites collapse into one audited `unsafe` here.
#[repr(transparent)]
pub struct JsCell<T>(core::cell::UnsafeCell<T>);

// SAFETY: see type-level docs — `JsCell` is only dereferenced on the owning
// JS thread; the `Sync` impl exists so `&'static VirtualMachine` (which
// contains `JsCell` fields) satisfies `'static`-bound trait objects and
// `thread_local!` accessors without `T: Sync` cascading everywhere. It is NOT
// a license for cross-thread `get_mut()`.
unsafe impl<T> Sync for JsCell<T> {}
// SAFETY: same single-thread-owner invariant as `Sync` above.
unsafe impl<T> Send for JsCell<T> {}

impl<T> JsCell<T> {
    #[inline]
    pub const fn new(value: T) -> Self {
        Self(core::cell::UnsafeCell::new(value))
    }

    /// Shared-reference read. Caller must not hold a live `get_mut()` borrow
    /// across this call (single-JS-thread reentrancy makes overlap rare but
    /// possible — keep borrows short).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn get(&self) -> &T {
        // SAFETY: single-JS-thread invariant — see type docs.
        unsafe { &*self.0.get() }
    }

    /// Mutable-reference projection from `&self`. This is the whole point of
    /// `JsCell`: it lets `&'static VirtualMachine` mutate post-init fields
    /// without an `unsafe` block at every call site.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn get_mut(&self) -> &mut T {
        // SAFETY: single-JS-thread invariant — see type docs.
        unsafe { &mut *self.0.get() }
    }

    /// Overwrite the contained value.
    #[inline]
    pub fn set(&self, value: T) {
        // SAFETY: single-JS-thread invariant — see type docs.
        unsafe { *self.0.get() = value; }
    }

    /// Replace the contained value, returning the old one.
    #[inline]
    pub fn replace(&self, value: T) -> T {
        core::mem::replace(self.get_mut(), value)
    }

    /// Raw pointer to the inner `T` — for FFI / `addr_of!` paths that must
    /// not form a reference.
    #[inline]
    pub const fn as_ptr(&self) -> *mut T {
        self.0.get()
    }

    /// Consume the cell and return the inner value.
    #[inline]
    pub fn into_inner(self) -> T {
        self.0.into_inner()
    }
}

impl<T: Default> Default for JsCell<T> {
    #[inline]
    fn default() -> Self {
        Self::new(T::default())
    }
}

impl<T> From<T> for JsCell<T> {
    #[inline]
    fn from(value: T) -> Self {
        Self::new(value)
    }
}

impl<T: core::fmt::Debug> core::fmt::Debug for JsCell<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.get().fmt(f)
    }
}
