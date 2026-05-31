use crate::custom_getter_setter::CustomGetterSetter;
use crate::getter_setter::GetterSetter;
use crate::{JSGlobalObject, JSObject, JSValue};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `JSC::JSCell`.
    pub struct JSCell;
}

impl JSCell {
    /// Statically cast a cell to a JSObject. Returns null for non-objects.
    /// Use `to_object` to mutate non-objects into objects.
    pub fn get_object(&self) -> Option<&JSObject> {
        // TODO(port): jsc.markMemberBinding(JSCell, @src()) — comptime binding marker, likely drop
        // `JSObject` is an `opaque_ffi!` ZST handle; `opaque_ref` is the
        // centralised non-null-ZST deref proof. Nullable per the C++ contract
        // (non-object cells return null).
        let p = JSC__JSCell__getObject(self);
        (!p.is_null()).then(|| JSObject::opaque_ref(p))
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
        // `JSObject` is an `opaque_ffi!` ZST handle; `opaque_ref` is the
        // centralised non-null deref proof (ToObject on a cell never returns null).
        JSObject::opaque_ref(JSC__JSCell__toObject(self, global))
    }

    pub fn get_type(&self) -> u8 {
        // TODO(port): jsc.markMemberBinding(JSCell, @src()) — comptime binding marker, likely drop
        // TODO(port): Zig wraps the extern result in @enumFromInt but the fn return type is `u8`;
        // likely intended to return `JSType` — verify.
        JSC__JSCell__getType(self)
    }

    pub fn to_js(&self) -> JSValue {
        JSValue::from_cell(std::ptr::from_ref::<JSCell>(self))
    }

    pub fn get_getter_setter(&self) -> &GetterSetter {
        // TODO(port): bun_jsc::JSValue::is_getter_setter (debug_assert dropped while JSValue.rs gated)
        // Caller-asserted invariant — this cell's JSType is GetterSetter.
        // `GetterSetter` is an `opaque_ffi!` ZST handle; `opaque_ref` is the
        // centralised non-null-ZST deref proof (`self` is non-null).
        GetterSetter::opaque_ref(std::ptr::from_ref::<JSCell>(self).cast::<GetterSetter>())
    }

    pub fn get_custom_getter_setter(&self) -> &CustomGetterSetter {
        // TODO(port): bun_jsc::JSValue::is_custom_getter_setter (debug_assert dropped while JSValue.rs gated)
        // Caller-asserted invariant — this cell's JSType is CustomGetterSetter.
        // `CustomGetterSetter` is an `opaque_ffi!` ZST handle; see `get_getter_setter`.
        CustomGetterSetter::opaque_ref(
            std::ptr::from_ref::<JSCell>(self).cast::<CustomGetterSetter>(),
        )
    }

    pub fn ensure_still_alive(&self) {
        core::hint::black_box(std::ptr::from_ref::<JSCell>(self));
    }
}

// TODO(port): move to jsc_sys
//
// `JSCell`/`JSGlobalObject` are opaque `UnsafeCell`-backed ZST handles, so
// `&T` is ABI-identical to a non-null `*const T` and C++ mutating cell state
// through it is interior mutation invisible to Rust.
unsafe extern "C" {
    safe fn JSC__JSCell__getObject(this: &JSCell) -> *mut JSObject;
    safe fn JSC__JSCell__toObject(this: &JSCell, global: &JSGlobalObject) -> *mut JSObject;
    // NOTE: this function always returns a JSType, but by using `u8` then
    // casting it via `@enumFromInt` we can ensure our `JSType` enum matches
    // WebKit's. This protects us from possible future breaking changes made
    // when upgrading WebKit.
    safe fn JSC__JSCell__getType(this: &JSCell) -> u8;
}

// ported from: src/jsc/JSCell.zig

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
/// `JsCell` is **not** `Send` or `Sync`: it inherits `UnsafeCell`'s auto
/// impls (`Send` iff `T: Send`, never `Sync`). A `JsCell` embedded in a
/// JS-heap-adjacent struct is only ever touched from its owning JS thread;
/// cross-thread access goes through `ConcurrentTask` /
/// `enqueueTaskConcurrent`, which never hands out a `&JsCell`.
///
/// This is morally `Cell<T>` with reference-projecting escape hatches and no
/// `T: Copy` bound. [`Self::with`] / [`Self::with_mut`] are the safe entry
/// points (the borrow is closure-scoped and cannot escape); [`Self::get`] /
/// [`Self::get_mut`] are `unsafe` and require the caller to uphold the
/// no-alias invariant explicitly.
#[repr(transparent)]
pub struct JsCell<T>(core::cell::UnsafeCell<T>);

impl<T> JsCell<T> {
    #[inline(always)]
    pub const fn new(value: T) -> Self {
        Self(core::cell::UnsafeCell::new(value))
    }

    /// Shared-reference projection from `&self`.
    ///
    /// # Safety
    ///
    /// Caller must guarantee that **no `&mut T`** to the contained value is
    /// live at any point during the lifetime of the returned borrow. The
    /// single-JS-thread invariant rules out *concurrent* aliasing, but
    /// same-thread *reentrancy* (host fn → JS → host fn) can still produce a
    /// `&mut T` (via [`Self::with_mut`] / [`Self::set`] / [`Self::replace`] /
    /// [`Self::get_mut`]) while this borrow is held. Keep the borrow short
    /// and do not hold it across any call that may reach back into code
    /// mutating this cell.
    ///
    /// Prefer [`Self::with`] when the read fits in a closure — its borrow
    /// cannot escape and the safety obligation is discharged at one audited
    /// site.
    #[inline(always)]
    pub unsafe fn get(&self) -> &T {
        // SAFETY: forwarded to caller — see fn-level contract.
        unsafe { &*self.0.get() }
    }

    /// Closure-scoped shared access. The `&T` cannot escape `f`, so the only
    /// way to violate the aliasing invariant is for `f` itself to re-enter a
    /// path that *mutates* this same cell — which the single-JS-thread model
    /// already forbids for the duration of a field read. This is the **safe**
    /// spelling of [`Self::get`]; use it whenever the read does not need to
    /// outlive a single expression.
    #[inline(always)]
    pub fn with<R>(&self, f: impl FnOnce(&T) -> R) -> R {
        // SAFETY: single-JS-thread invariant (see type docs); the `&T` is
        // confined to `f`'s frame and cannot be stored or returned.
        f(unsafe { &*self.0.get() })
    }

    /// Mutable-reference projection from `&self`.
    ///
    /// # Safety
    ///
    /// Caller must guarantee that **no other reference** (`&T` or `&mut T`) to
    /// the contained value is live for the lifetime of the returned borrow.
    /// The single-JS-thread invariant rules out *concurrent* aliasing, but
    /// same-thread *reentrancy* (host fn → JS → host fn) can still produce
    /// stacked `&mut T` if a borrow is held across a call that re-enters.
    /// Keep the borrow short and do not hold it across any call that may
    /// reach back into code touching this cell.
    ///
    /// Prefer [`Self::with_mut`] when the mutation fits in a closure — its
    /// borrow cannot escape and the safety obligation is discharged at one
    /// audited site.
    #[inline(always)]
    #[allow(clippy::mut_from_ref)]
    pub unsafe fn get_mut(&self) -> &mut T {
        // SAFETY: forwarded to caller — see fn-level contract.
        unsafe { &mut *self.0.get() }
    }

    /// Closure-scoped mutable access. The `&mut T` cannot escape `f`, so the
    /// only way to violate the aliasing invariant is for `f` itself to
    /// re-enter a path that touches this same cell — which the
    /// single-JS-thread model already forbids for the duration of a field
    /// mutation. This is the **safe** spelling of `get_mut`; use it whenever
    /// the mutation does not need to outlive a single expression.
    #[inline(always)]
    pub fn with_mut<R>(&self, f: impl FnOnce(&mut T) -> R) -> R {
        // SAFETY: single-JS-thread invariant (see type docs); the `&mut T`
        // is confined to `f`'s frame and cannot be stored or returned.
        f(unsafe { &mut *self.0.get() })
    }

    /// Overwrite the contained value.
    #[inline(always)]
    pub fn set(&self, value: T) {
        // Route through the single audited `with_mut` site rather than
        // open-coding a second raw `*self.0.get() = …` write here.
        self.with_mut(|slot| *slot = value);
    }

    /// Replace the contained value, returning the old one.
    #[inline(always)]
    pub fn replace(&self, value: T) -> T {
        // Route through the single audited `with_mut` site; the `&mut T` is
        // closure-scoped so no aliasing obligation leaks to this fn.
        self.with_mut(|slot| core::mem::replace(slot, value))
    }

    /// Raw pointer to the inner `T` — for FFI / `addr_of!` paths that must
    /// not form a reference.
    #[inline(always)]
    pub const fn as_ptr(&self) -> *mut T {
        self.0.get()
    }

    /// Consume the cell and return the inner value.
    #[inline(always)]
    pub fn into_inner(self) -> T {
        self.0.into_inner()
    }
}

impl<T: Default> Default for JsCell<T> {
    #[inline(always)]
    fn default() -> Self {
        Self::new(T::default())
    }
}

impl<T> From<T> for JsCell<T> {
    #[inline(always)]
    fn from(value: T) -> Self {
        Self::new(value)
    }
}

impl<T: core::fmt::Debug> core::fmt::Debug for JsCell<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.with(|value| value.fmt(f))
    }
}

#[cfg(test)]
mod tests {
    use super::JsCell;

    #[test]
    fn new_and_into_inner_round_trip() {
        let cell = JsCell::new(String::from("hello"));
        assert_eq!(cell.into_inner(), "hello");
    }

    #[test]
    fn with_reads_without_consuming() {
        let cell = JsCell::new(vec![1u32, 2, 3]);
        assert_eq!(cell.with(Vec::len), 3);
        assert_eq!(cell.with(|v| v[1]), 2);
    }

    #[test]
    fn with_mut_mutates_in_place() {
        let cell = JsCell::new(vec![1u32]);
        cell.with_mut(|v| v.push(2));
        assert_eq!(cell.with(|v| v.clone()), [1, 2]);
    }

    #[test]
    fn set_overwrites() {
        let cell = JsCell::new(1u32);
        cell.set(7);
        assert_eq!(cell.with(|v| *v), 7);
    }

    #[test]
    fn replace_returns_previous_value() {
        let cell = JsCell::new(String::from("old"));
        assert_eq!(cell.replace(String::from("new")), "old");
        assert_eq!(cell.with(|v| v.clone()), "new");
    }

    #[test]
    fn default_and_from() {
        assert_eq!(JsCell::<u64>::default().into_inner(), 0);
        assert_eq!(JsCell::from(5u64).into_inner(), 5);
    }

    #[test]
    fn as_ptr_points_at_payload() {
        let cell = JsCell::new(11u32);
        // SAFETY: `cell` is live and no other reference to its payload exists.
        assert_eq!(unsafe { *cell.as_ptr() }, 11);
    }

    #[test]
    fn get_and_get_mut_round_trip() {
        let cell = JsCell::new(3u32);
        // SAFETY: no other borrow of the payload is live.
        unsafe { *cell.get_mut() = 4 };
        // SAFETY: the `&mut` above has ended; no other borrow is live.
        assert_eq!(unsafe { *cell.get() }, 4);
    }

    #[test]
    fn debug_forwards_to_payload() {
        assert_eq!(format!("{:?}", JsCell::new(42u8)), "42");
    }

    #[test]
    fn send_follows_payload() {
        fn assert_send<T: Send>() {}
        // `JsCell<T>` inherits `UnsafeCell`'s auto impls: `Send` iff
        // `T: Send`, never `Sync`. There is no `unsafe impl` to widen that.
        assert_send::<JsCell<u8>>();
    }
}
