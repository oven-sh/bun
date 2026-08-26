#[cfg(debug_assertions)]
use core::mem::ManuallyDrop;
#[cfg(debug_assertions)]
use core::ptr::NonNull;

use crate::JSValue;

#[cfg(debug_assertions)]
type Safety = Option<SafetyData>;
#[cfg(not(debug_assertions))]
type Safety = ();

#[cfg(debug_assertions)]
struct SafetyData {
    // Raw pointer (not Box) — this is a heap canary for UAF detection;
    // owning it via Box would change the semantics (Drop would recurse / hide UAF).
    // Backing allocation is `Box<ManuallyDrop<DeprecatedStrong>>` (repr(transparent))
    // so freeing does NOT run DeprecatedStrong::drop on the sentinel value; the
    // pointer is stored cast to the inner type for ergonomic field access.
    ptr: NonNull<DeprecatedStrong>,
}

/// GC root over `JSValueProtect`/`JSValueUnprotect`. `Drop` releases the
/// `init()` protect and, in debug builds, checks and frees the heap canary.
pub struct DeprecatedStrong {
    // Bare JSValue field is intentional — this *is* the GC-root
    // wrapper (uses JSValueProtect/Unprotect), so the §JSC "never store bare
    // JSValue on the heap" rule does not apply here.
    raw: JSValue,
    _safety: Safety,
}

impl DeprecatedStrong {
    pub fn init(value: JSValue) -> DeprecatedStrong {
        value.protect();
        #[cfg(debug_assertions)]
        let _safety: Safety = Some(SafetyData {
            // ManuallyDrop<T> is #[repr(transparent)], so the cast to
            // NonNull<DeprecatedStrong> is sound.
            ptr: bun_core::heap::into_raw_nn(Box::new(ManuallyDrop::new(DeprecatedStrong {
                raw: JSValue::from_encoded(0xAEBCFA),
                _safety: None,
            })))
            .cast::<DeprecatedStrong>(),
        });
        #[cfg(not(debug_assertions))]
        let _safety: Safety = ();
        DeprecatedStrong {
            raw: value,
            _safety,
        }
    }

    pub fn get(&self) -> JSValue {
        self.raw
    }
}

impl Drop for DeprecatedStrong {
    fn drop(&mut self) {
        self.raw.unprotect();
        #[cfg(debug_assertions)]
        if let Some(_safety) = &mut self._safety {
            // SAFETY: ptr was produced by heap::alloc in `init` and is freed only
            // here, once.
            unsafe {
                debug_assert!((*_safety.ptr.as_ptr()).raw.encoded() == 0xAEBCFA);
                (*_safety.ptr.as_ptr()).raw = JSValue::from_encoded(0xFFFFFF);
                // Free without running Drop on the sentinel (ManuallyDrop is repr(transparent)).
                drop(bun_core::heap::take(
                    _safety
                        .ptr
                        .as_ptr()
                        .cast::<ManuallyDrop<DeprecatedStrong>>(),
                ));
            }
        }
    }
}
