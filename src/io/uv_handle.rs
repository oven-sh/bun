//! Typed registration/recovery pairing for libuv handles: an owning wrapper
//! around a heap-allocated `uv_*_t` plus its userdata, whose `extern "C"`
//! callback trampolines are generated once per `(handle, userdata)` pair.
//!
//! The libuv callback shape is "store a `T` behind the handle's `void* data`
//! word, get the handle back in an `extern "C"` callback, cast `data` to
//! `&mut T`". Every consumer used to restate the "this `void*` is really my
//! struct" invariant at both the registration site and inside each callback.
//! [`UvHandle<H, T>`] carries that invariant in its type parameters: the
//! allocation, the `data` stamp, the callback, and the `uv_close`-time
//! reclamation are all monomorphised over the same `(H, T)`, so a wrong-type
//! recovery is unrepresentable.
//!
//! The remaining `unsafe` for this callback shape is the pair of trampolines
//! (`event` and `on_close`) plus the `uv_close` FFI call that arms the second
//! one.
//!
//! Bounded cost: each callback dispatch re-reads the `data` word and panics
//! if it is null (a callback fired on a handle that was never
//! [`arm`](UvHandle::arm)ed) instead of dereferencing it.

use core::ptr::NonNull;

use bun_sys::windows::libuv as uv;
use bun_sys::windows::libuv::UvHandle as RawUvHandle;

/// One heap allocation holding the libuv handle and its typed userdata. The
/// handle's `data` word points back at the whole `Slot` so the trampolines
/// recover it with full-allocation provenance regardless of which (possibly
/// field-narrowed) handle pointer libuv hands them.
#[repr(C)]
struct Slot<H, T> {
    handle: H,
    data: T,
}

/// The callback half of a [`UvHandle<H, T>`] registration. Implemented by a
/// (typically zero-sized) marker type; `Data` must equal the wrapper's `T`
/// for [`UvHandle::arm`] to accept it, which is what makes a wrong-type
/// recovery a compile error:
///
/// ```compile_fail
/// use bun_io::uv_handle::{UvCallback, UvHandle};
/// use bun_sys::windows::libuv as uv;
///
/// struct Tick;
/// impl UvCallback<uv::Timer> for Tick {
///     type Data = u32;
///     fn on_event(_data: &mut u32, _handle: &mut uv::Timer) {}
/// }
///
/// // The handle owns a `String`, but `Tick` recovers a `u32`:
/// // error[E0271]: type mismatch resolving `<Tick as UvCallback<Timer>>::Data == String`
/// let mut h: UvHandle<uv::Timer, String> = UvHandle::new(String::new());
/// let _ = h.arm::<Tick>();
/// ```
pub trait UvCallback<H> {
    /// The userdata type this callback recovers. Must match the `T` of the
    /// [`UvHandle<H, T>`] it is armed on.
    type Data;

    /// The handler body. `data` and `handle` are disjoint borrows of the same
    /// heap allocation, so the handler can both mutate its state and re-arm /
    /// stop the handle.
    fn on_event(data: &mut Self::Data, handle: &mut H);
}

/// Owning wrapper for a heap-allocated libuv handle and its typed userdata.
///
/// * [`new`](Self::new) allocates the slot with the handle zeroed (libuv
///   requires `memset(0)` before `uv_*_init`).
/// * [`handle_mut`](Self::handle_mut) exposes the raw handle for the
///   per-type `uv_*_init` / `uv_*_start` calls. The handle's `data` word is
///   reserved for the wrapper's back-pointer; do not overwrite it.
/// * [`arm`](Self::arm) is the registration half: it stamps the back-pointer
///   and yields the `extern "C"` trampoline monomorphised over this
///   wrapper's `(H, T)`.
/// * [`close`](Self::close) (and `Drop`) is the teardown half: the slot is
///   freed by the `uv_close` callback, never while libuv still references it.
///
/// # Non-re-entrancy contract
///
/// Owning a `UvHandle<H, T>` asserts that no borrow returned by
/// [`data`](Self::data) / [`data_mut`](Self::data_mut) /
/// [`handle_mut`](Self::handle_mut) is held across a call that can dispatch
/// this handle's callbacks (`uv_run` / `Loop::tick`). The event trampoline
/// materialises `&mut T` from the slot back-pointer; a wrapper-side borrow
/// live at that moment would alias it. This is the same contract every libuv
/// userdata consumer (and `ExtSlot<T>` on the uWS side) relies on: the loop
/// is only driven from the event-loop driver, with no handle borrows on the
/// stack. Consumers that need to reach the userdata *during* a callback get
/// it from the callback's own `&mut T` parameter, not from the wrapper.
pub struct UvHandle<H: RawUvHandle + bun_core::Zeroable, T> {
    /// Owned heap slot. Held as a raw pointer (not `Box`) because libuv keeps
    /// an aliasing `*mut H` into the same allocation from `uv_*_init` until
    /// the `uv_close` callback fires; ownership is only re-materialised as a
    /// `Box` inside `on_close` once libuv has dropped its reference.
    slot: NonNull<Slot<H, T>>,
}

impl<H: RawUvHandle + bun_core::Zeroable, T> UvHandle<H, T> {
    /// Heap-allocate a zeroed `H` alongside `data`. The handle is **not**
    /// initialised; call the per-type `uv_*_init` through
    /// [`handle_mut`](Self::handle_mut) before arming/starting it.
    pub fn new(data: T) -> Self {
        let slot = Box::new(Slot {
            // `H: Zeroable` asserts the all-zero bit pattern is a valid `H`
            // (libuv expects callers to `memset(0)` before `uv_*_init`).
            handle: bun_core::ffi::zeroed(),
            data,
        });
        Self {
            slot: NonNull::from(Box::leak(slot)),
        }
    }

    /// The raw handle, for `uv_*_init` / `uv_*_start` / `uv_*_stop` calls.
    #[inline]
    pub fn handle_mut(&mut self) -> &mut H {
        &mut self.slot_mut().handle
    }

    /// Shared access to the userdata.
    #[inline]
    pub fn data(&self) -> &T {
        &self.slot_ref().data
    }

    /// Exclusive access to the userdata.
    #[inline]
    pub fn data_mut(&mut self) -> &mut T {
        &mut self.slot_mut().data
    }

    /// The registration half of the pairing: stamp the handle's `data` word
    /// with the back-pointer to this wrapper's slot and return the
    /// `extern "C"` trampoline for `C`, monomorphised over this wrapper's
    /// `(H, T)`. Pass the result to the per-type `uv_*_start` alongside
    /// [`handle_mut`](Self::handle_mut).
    ///
    /// Call this **after** the per-type `uv_*_init` (some init wrappers zero
    /// the whole struct, which would wipe an earlier stamp).
    ///
    /// Taking `&mut self` ties the requested trampoline to an actual
    /// allocation of the same `(H, T)`; the `Data = T` bound is what rejects
    /// a callback that would recover a different userdata type.
    #[inline]
    pub fn arm<C: UvCallback<H, Data = T>>(&mut self) -> unsafe extern "C" fn(*mut H) {
        let back = self.slot.as_ptr();
        self.slot_mut().handle.set_data(back.cast());
        Self::event::<C>
    }

    /// The libuv event trampoline for this `(H, T, C)`.
    ///
    /// This is the single recovery `unsafe` for the libuv callback shape.
    unsafe extern "C" fn event<C: UvCallback<H, Data = T>>(handle: *mut H) {
        // SAFETY: type-pairing proof. This trampoline is only obtainable from
        // `UvHandle::<H, T>::arm`, which requires a live `&mut UvHandle<H, T>`
        // and stamps the handle's `data` word with the back-pointer to that
        // wrapper's `Slot<H, T>` before returning it — so the `data` word read
        // here is either that back-pointer (carrying whole-`Slot` provenance,
        // preserved through the store/load) or null if the handle was never
        // armed, which the `expect` turns into a panic instead of a deref.
        // The slot stays allocated until the `uv_close` callback fires
        // (`close`/`Drop` never free it directly), and libuv dispatches
        // callbacks on the single loop thread, so no other Rust borrow of the
        // slot is live here.
        let slot = unsafe {
            let data = (*handle.cast::<uv::uv_handle_t>()).data;
            NonNull::new(data.cast::<Slot<H, T>>())
                .expect("UvHandle callback fired on a handle that was never armed")
                .as_mut()
        };
        C::on_event(&mut slot.data, &mut slot.handle);
    }

    /// The `uv_close` trampoline: reclaims the `Box<Slot<H, T>>` once libuv
    /// guarantees it will never touch the handle again.
    unsafe extern "C" fn on_close(handle: *mut uv::uv_handle_t) {
        // SAFETY: this trampoline is only ever installed by `Drop` below,
        // which re-stamps the `data` word with the wrapper's own slot pointer
        // and then relinquishes the wrapper without freeing. libuv invokes
        // the close callback exactly once, after which it holds no reference
        // to the handle, so re-materialising and dropping the `Box` here is
        // the sole free of the allocation.
        let slot = unsafe {
            let data = (*handle).data;
            Box::from_raw(data.cast::<Slot<H, T>>())
        };
        drop(slot);
    }

    /// Hand the handle to `uv_close`; the slot is freed by the `uv_close`
    /// trampoline on the next loop turn. Equivalent to `drop(self)` —
    /// provided so teardown reads as an action at call sites.
    #[inline]
    pub fn close(self) {
        drop(self);
    }

    /// Reborrow the owned slot. Centralises the aliasing argument the
    /// accessors share instead of repeating it per field.
    #[inline(always)]
    fn slot_ref(&self) -> &Slot<H, T> {
        // SAFETY: `self.slot` is the wrapper's owned allocation, live from
        // `new` until the close trampoline reclaims it (which can only happen
        // after the wrapper — and therefore every borrow derived from it — is
        // gone). The wrapper is `!Send`/`!Sync` and libuv only mutates the
        // handle from inside `uv_run` on the loop thread, never concurrently
        // with Rust code holding this borrow.
        unsafe { self.slot.as_ref() }
    }

    /// Exclusive reborrow of the owned slot. See [`Self::slot_ref`].
    #[inline(always)]
    fn slot_mut(&mut self) -> &mut Slot<H, T> {
        // SAFETY: as `slot_ref`, plus `&mut self` guarantees no other borrow
        // derived from the wrapper is live.
        unsafe { self.slot.as_mut() }
    }
}

impl<H: RawUvHandle + bun_core::Zeroable, T> Drop for UvHandle<H, T> {
    fn drop(&mut self) {
        let back = self.slot.as_ptr();
        let slot = self.slot_mut();
        // `uv_*_init` stamps `handle.type` with a non-zero `uv_handle_type`;
        // a still-zeroed type means libuv has never seen this handle, so
        // there is nothing to close and the slot can be freed directly.
        // SAFETY: `as_handle` is the `UvHandle` trait's prefix cast over the
        // slot's own live `handle` field; reading the POD `type_` field
        // through it is in-bounds.
        let initialised = unsafe { (*slot.handle.as_handle()).type_ } != uv::HandleType::Unknown;
        if initialised {
            // Transfer ownership of the slot to the close callback through
            // the `data` word (re-stamped here in case the handle was never
            // armed). `uv_close` aborts on a second close, but `self.slot` is
            // unique to this wrapper and `Drop` runs at most once.
            slot.handle.set_data(back.cast());
            // SAFETY: the handle was initialised on a loop (checked above) and
            // is not yet closing (this is the only place the wrapper closes
            // it); `on_close::<H, T>` frees the matching `Slot<H, T>` via the
            // `data` word stamped above.
            unsafe { uv::uv_close(slot.handle.as_handle_mut(), Some(Self::on_close)) };
        } else {
            // SAFETY: libuv never saw the handle, so the wrapper is the sole
            // owner of the allocation `new` leaked; reclaim and drop it.
            drop(unsafe { Box::from_raw(back) });
        }
    }
}
