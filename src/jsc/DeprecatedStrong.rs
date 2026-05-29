#[cfg(debug_assertions)]
use core::mem::ManuallyDrop;
#[cfg(debug_assertions)]
use core::ptr::NonNull;

use crate::JSValue;

// Zig: `enable_safety = bun.Environment.ci_assert`.
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
    ptr: NonNull<DeprecatedStrong>,
    // PORT NOTE: `gpa: std.mem.Allocator` dropped — global mimalloc.
    ref_count: u32,
}

#[cfg(debug_assertions)]
const SAFETY_NONE: Safety = None;
#[cfg(not(debug_assertions))]
const SAFETY_NONE: Safety = ();

pub struct DeprecatedStrong {
    // PORT NOTE: bare JSValue field is intentional — this *is* the GC-root
    // wrapper (uses JSValueProtect/Unprotect), so the §JSC "never store bare
    // JSValue on the heap" rule does not apply here.
    raw: JSValue,
    _safety: Safety,
}

impl DeprecatedStrong {
    pub fn init_non_cell(non_cell: JSValue) -> DeprecatedStrong {
        debug_assert!(!non_cell.is_cell());
        DeprecatedStrong {
            raw: non_cell,
            _safety: SAFETY_NONE,
        }
    }

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

    pub fn swap(&mut self, next: JSValue) -> JSValue {
        let prev = self.raw;
        // PORT NOTE: `*self = ...` drops the old value in place (runs Drop),
        // matching Zig's explicit `this.deinit(); this.* = .init(next);`.
        *self = Self::init(next);
        prev
    }

    pub fn dupe(&self) -> DeprecatedStrong {
        Self::init(self.get())
    }

    pub fn r#ref(&mut self) {
        self.raw.protect();
        #[cfg(debug_assertions)]
        if let Some(_safety) = &mut self._safety {
            _safety.ref_count += 1;
        }
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
                // Neutralize so Drop is a no-op (see top-of-file PORT NOTE).
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

pub struct Optional {
    backing: DeprecatedStrong,
}

impl Optional {
    // PORT NOTE: Zig `pub const empty = .initNonCell(null)` — inlined as a struct
    // literal so it can be `const` (init_non_cell debug_asserts, which is non-const).
    pub const EMPTY: Optional = Optional {
        backing: DeprecatedStrong {
            raw: JSValue::ZERO,
            _safety: SAFETY_NONE,
        },
    };

    pub fn init_non_cell(non_cell: Option<JSValue>) -> Optional {
        Optional {
            backing: DeprecatedStrong::init_non_cell(non_cell.unwrap_or(JSValue::ZERO)),
        }
    }

    pub fn init(value: Option<JSValue>) -> Optional {
        Optional {
            backing: DeprecatedStrong::init(value.unwrap_or(JSValue::ZERO)),
        }
    }

    // PORT NOTE: Zig `deinit` dropped — `backing: DeprecatedStrong` is dropped
    // automatically (its Drop impl runs `unprotect` + canary free).

    pub fn get(&self) -> Option<JSValue> {
        let result = self.backing.get();
        if result.is_empty() {
            return None;
        }
        Some(result)
    }

    pub fn swap(&mut self, next: Option<JSValue>) -> Option<JSValue> {
        let result = self.backing.swap(next.unwrap_or(JSValue::ZERO));
        if result.is_empty() {
            return None;
        }
        Some(result)
    }

    pub fn dupe(&self) -> Optional {
        Optional {
            backing: self.backing.dupe(),
        }
    }

    pub fn has(&self) -> bool {
        !self.backing.get().is_empty()
    }

    pub fn r#ref(&mut self) {
        self.backing.r#ref();
    }

    pub fn unref(&mut self) {
        self.backing.unref();
    }
}

// suppress unused warning in release builds
const _: bool = enable_safety!();

// ported from: src/jsc/DeprecatedStrong.zig
