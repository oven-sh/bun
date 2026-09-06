#[cfg(debug_assertions)]
use core::mem::ManuallyDrop;
#[cfg(debug_assertions)]
use core::ptr::NonNull;

use crate::JSValue;

// Refcount contract (load-bearing): `ref()`/`unref()` calls must be balanced
// in pairs; Drop is the release for the `init()` protect. In debug builds a
// final `unref()` (ref_count 1 → 0) additionally frees the canary, zeroes
// `raw`, and clears `_safety` so a subsequent Drop is a no-op. Release builds
// have no ref_count, so an unref-used-as-release followed by Drop would
// double-unprotect — callers must never use `unref()` as the release.
// (Audited 2026-06: the only user is test_runner/Collection.rs, which uses
// `init` + Drop and never calls `ref`/`unref`.)

#[cfg(debug_assertions)]
macro_rules! enable_safety {
    () => {
        true
    };
}
#[cfg(not(debug_assertions))]
macro_rules! enable_safety {
    () => {
        false
    };
}

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
    ref_count: u32,
}

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
            ref_count: 1,
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

    pub fn unref(&mut self) {
        self.raw.unprotect();
        #[cfg(debug_assertions)]
        if let Some(_safety) = &mut self._safety {
            if _safety.ref_count == 1 {
                // SAFETY: ptr was produced by heap::alloc in `init` and not yet freed.
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
                // Neutralize so Drop is a no-op (see top-of-file refcount contract).
                self._safety = None;
                self.raw = JSValue::ZERO;
                return;
            }
            _safety.ref_count -= 1;
        }
    }
}

impl Drop for DeprecatedStrong {
    fn drop(&mut self) {
        self.raw.unprotect();
        #[cfg(debug_assertions)]
        if let Some(_safety) = &mut self._safety {
            // SAFETY: ptr was produced by heap::alloc in `init` and has not been freed
            // (ref_count == 1 asserted below).
            unsafe {
                debug_assert!((*_safety.ptr.as_ptr()).raw.encoded() == 0xAEBCFA);
                (*_safety.ptr.as_ptr()).raw = JSValue::from_encoded(0xFFFFFF);
                debug_assert!(_safety.ref_count == 1);
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

// suppress unused warning in release builds
const _: bool = enable_safety!();
