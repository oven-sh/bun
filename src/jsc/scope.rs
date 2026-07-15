//! Branded-scope layer over the raw JSC FFI ("rusty_jsc" prototype).
//!
//! Zero runtime cost: `Scope` is a `&JSGlobalObject` wrapper, `Local` is
//! `repr(transparent)` over `JSValue`, and every guarantee below is enforced
//! purely at compile time. The soundness contract for stack-held values is
//! identical to raw `JSValue` today — JSC's conservative scanner roots
//! anything live in stack memory or registers.
//!
//! Two guarantees the raw `JSValue` API cannot express:
//!
//! 1. **No heap escape without rooting.** A [`Local<'s>`] cannot be stored
//!    anywhere that outlives its scope. Persisting requires the explicit,
//!    owning [`Scope::persist`] → [`Strong`].
//! 2. **Re-entry into user JavaScript is an effect.** Every operation that
//!    can run user JS (coercions, property gets, calls) takes
//!    `&mut Scope<'s>`, so it cannot overlap a borrow handed out from
//!    `&Scope<'s>` (e.g. [`Local::array_buffer_bytes`]). The "R-2" comment
//!    convention becomes a borrow-checker error.
//!
//! Not enforced (same status quo as raw `JSValue`): copying a `Local` into a
//! within-scope heap container (`Vec<Local>`, `Box<Local>`) leaves it
//! invisible to the conservative scanner. Accumulate through
//! `MarkedArgumentBuffer` or `Strong` instead — that rooting cost is paid
//! only where rooting is actually needed.
//!
//! A `Local` cannot leave its scope:
//!
//! ```compile_fail
//! use bun_jsc::scope::{Local, Scope};
//! fn escape(global: &bun_jsc::JSGlobalObject) -> Local<'static> {
//!     Scope::with(global, |scope| scope.undefined())
//! }
//! ```
//!
//! Holding a view into the JS heap across a call that can re-enter user JS
//! (which could detach the buffer) is rejected:
//!
//! ```compile_fail,E0502
//! use bun_jsc::scope::{Local, Scope};
//! fn hazard<'s>(
//!     scope: &mut Scope<'s>,
//!     ab: Local<'s>,
//!     cb: Local<'s>,
//! ) -> bun_jsc::JsResult<u8> {
//!     let undef = scope.undefined();
//!     let bytes = ab.array_buffer_bytes(scope).unwrap();
//!     cb.call(scope, undef, &[])?; // user JS could detach `ab`
//!     Ok(bytes[0])
//! }
//! ```

use core::marker::PhantomData;
use core::ops::Deref;

use crate::{ArrayBuffer, JSGlobalObject, JSValue, JsResult, Strong};

/// Capability token for one JS entry frame. A newtype over
/// `&JSGlobalObject` — construction compiles to nothing.
///
/// Holding `&Scope<'s>` proves the current thread is the JS thread and that
/// stack-held `Local<'s>` values are conservatively scanned. The brand
/// lifetime is invariant and issued fresh per [`Scope::with`], so locals from
/// different scopes never unify.
pub struct Scope<'s> {
    global: &'s JSGlobalObject,
    _brand: PhantomData<*mut &'s ()>,
}

impl<'s> Scope<'s> {
    /// Enter a scope. The higher-ranked closure lifetime is the brand: no
    /// `Local` created inside can escape through the return value.
    #[inline(always)]
    pub fn with<R>(global: &JSGlobalObject, f: impl for<'t> FnOnce(&mut Scope<'t>) -> R) -> R {
        f(&mut Scope {
            global,
            _brand: PhantomData,
        })
    }

    /// Migration escape hatch: the unscoped global for pre-scope APIs.
    /// Anything done through it is outside this module's guarantees.
    #[inline(always)]
    pub fn unscoped_global(&self) -> &'s JSGlobalObject {
        self.global
    }

    /// Brand a raw `JSValue` obtained from unmigrated code. Free.
    #[inline(always)]
    pub fn local(&self, raw: JSValue) -> Local<'s> {
        debug_assert!(
            !raw.is_empty(),
            "JSValue::ZERO is not a value; propagate Err(JsError::Thrown) instead"
        );
        Local {
            raw,
            _brand: PhantomData,
        }
    }

    #[inline(always)]
    pub fn undefined(&self) -> Local<'s> {
        Local {
            raw: JSValue::UNDEFINED,
            _brand: PhantomData,
        }
    }

    /// The only way a value outlives its scope: an owning GC root.
    pub fn persist(&self, value: Local<'s>) -> Strong {
        Strong::create(value.raw, self.global)
    }

    /// Re-enter a `Strong` into this scope. The returned `Local` is valid for
    /// `'s` only while rooted — keep the `Strong` alive or on the stack.
    #[inline(always)]
    pub fn open(&self, strong: &Strong) -> Local<'s> {
        self.local(strong.get())
    }
}

/// A JS value branded by its scope. `Copy`, `!Send`, `repr(transparent)`
/// over `JSValue` — zero representation cost. Cannot be stored anywhere that
/// outlives its scope; see the module docs.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub struct Local<'s> {
    raw: JSValue,
    _brand: PhantomData<*mut &'s ()>,
}

impl<'s> Local<'s> {
    /// Escape hatch to unmigrated APIs taking raw `JSValue`. The raw copy
    /// re-opens the hazards this type exists to prevent.
    #[inline(always)]
    pub fn raw(self) -> JSValue {
        self.raw
    }

    // ── Effect-free reads: cannot run JS, cannot throw. ──────────────────

    #[inline(always)]
    pub fn is_string(self) -> bool {
        self.raw.is_string()
    }

    #[inline(always)]
    pub fn is_number(self) -> bool {
        self.raw.is_number()
    }

    #[inline(always)]
    pub fn is_callable(self) -> bool {
        self.raw.is_callable()
    }

    // ── Operations that can re-enter user JavaScript. ────────────────────
    // `&mut Scope` is the effect: it conflicts with any outstanding borrow
    // derived from `&Scope` (heap views), which is exactly the R-2 hazard.

    /// ECMA `ToNumber`; may run `valueOf`/`toString` on user objects.
    #[inline(always)]
    pub fn to_number(self, scope: &mut Scope<'s>) -> JsResult<f64> {
        self.raw.to_number(scope.global)
    }

    /// Property get; may run getters and Proxy traps.
    #[inline(always)]
    pub fn get(
        self,
        scope: &mut Scope<'s>,
        property: impl AsRef<[u8]>,
    ) -> JsResult<Option<Local<'s>>> {
        Ok(self.raw.get(scope.global, property)?.map(|v| scope.local(v)))
    }

    /// Call this value as a function.
    #[inline(always)]
    pub fn call(
        self,
        scope: &mut Scope<'s>,
        this_value: Local<'s>,
        args: &[Local<'s>],
    ) -> JsResult<Local<'s>> {
        // SAFETY: `Local` is `repr(transparent)` over `JSValue`.
        let raw_args: &[JSValue] =
            unsafe { core::slice::from_raw_parts(args.as_ptr().cast::<JSValue>(), args.len()) };
        let v = self.raw.call(scope.global, this_value.raw, raw_args)?;
        Ok(scope.local(v))
    }

    // ── Borrowed views into the JS heap. ─────────────────────────────────

    /// Bytes of an `ArrayBuffer` / typed-array view. The returned guard
    /// keeps a `JSValue` copy on the caller's stack (so the cell stays
    /// conservatively rooted) and borrows the scope shared, so nothing that
    /// can run user JS — and detach or resize the buffer — can be called
    /// while it lives. Same cost as `as_array_buffer` + `byte_slice` today.
    #[inline(always)]
    pub fn array_buffer_bytes<'a>(self, scope: &'a Scope<'s>) -> Option<ArrayBufferBytes<'a, 's>> {
        let ab = self.raw.as_array_buffer(scope.global)?;
        Some(ArrayBufferBytes {
            ab,
            _no_reentry: PhantomData,
        })
    }
}

/// Guard for [`Local::array_buffer_bytes`]. Holds the `ArrayBuffer`
/// descriptor (including its `JSValue`, keeping the cell stack-rooted) and a
/// shared borrow of the scope (excluding user-JS re-entry).
pub struct ArrayBufferBytes<'a, 's> {
    ab: ArrayBuffer,
    _no_reentry: PhantomData<&'a Scope<'s>>,
}

impl Deref for ArrayBufferBytes<'_, '_> {
    type Target = [u8];

    #[inline(always)]
    fn deref(&self) -> &[u8] {
        self.ab.byte_slice()
    }
}

/// Positive control for the `compile_fail` doctests above: the same
/// operations, correctly ordered, pass the borrow checker.
#[allow(dead_code)]
fn positive_control<'s>(scope: &mut Scope<'s>, ab: Local<'s>, cb: Local<'s>) -> JsResult<u8> {
    let first = {
        let bytes = ab.array_buffer_bytes(scope);
        bytes.as_deref().and_then(|b| b.first().copied()).unwrap_or(0)
    };
    let undef = scope.undefined();
    cb.call(scope, undef, &[])?;
    let strong = scope.persist(ab);
    let _reopened = scope.open(&strong);
    Ok(first)
}
