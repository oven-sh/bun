use core::mem::ManuallyDrop;
use core::ptr::NonNull;

use crate::JSValue;

// PORT NOTE: This file is a Zig file-level struct. In Zig it is referenced as
// `jsc.Strong.Deprecated` (see bottom-of-file alias `const Strong = jsc.Strong.Deprecated`).
// Ported here as `DeprecatedStrong`.
//
// PORT NOTE: Zig `deinit` → `impl Drop`. The manual `ref()`/`unref()` path
// overlaps teardown; to avoid Drop double-`unprotect`ing after a final `unref`,
// `unref()` zeroes `raw` and clears `safety` when it frees (debug builds), so
// Drop becomes a no-op (`unprotect` on ZERO is a no-op; `safety == None` skips
// the canary free).
// TODO(port): release builds have no ref_count, so a caller that does the final
// `unref()` and then lets Drop fire would double-unprotect — audit call sites
// in Phase B (Zig contract: ref/unref pairs are balanced, deinit is the release).

// `enable_safety = bun.Environment.ci_assert`
// TODO(port): map `Environment.ci_assert` to the correct cfg; using debug_assertions as proxy.
#[cfg(debug_assertions)]
macro_rules! enable_safety { () => { true }; }
#[cfg(not(debug_assertions))]
macro_rules! enable_safety { () => { false }; }

#[cfg(debug_assertions)]
type Safety = Option<SafetyData>;
#[cfg(not(debug_assertions))]
type Safety = ();

#[cfg(debug_assertions)]
struct SafetyData {
    // PORT NOTE: raw pointer (not Box) — this is a heap canary for UAF detection;
    // owning it via Box would change the semantics (Drop would recurse / hide UAF).
    // Backing allocation is `Box<ManuallyDrop<DeprecatedStrong>>` (repr(transparent))
    // so freeing does NOT run DeprecatedStrong::drop on the sentinel value; the
    // pointer is stored cast to the inner type for ergonomic field access.
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
    safety: Safety,
}

impl DeprecatedStrong {
    pub fn init_non_cell(non_cell: JSValue) -> DeprecatedStrong {
        debug_assert!(!non_cell.is_cell());
        DeprecatedStrong { raw: non_cell, safety: SAFETY_NONE }
    }

    pub fn init(value: JSValue) -> DeprecatedStrong {
        value.protect();
        #[cfg(debug_assertions)]
        let safety: Safety = Some(SafetyData {
            // SAFETY: Box::into_raw never returns null. ManuallyDrop<T> is
            // #[repr(transparent)], so the cast to *mut DeprecatedStrong is sound.
            ptr: unsafe {
                NonNull::new_unchecked(
                    Box::into_raw(Box::new(ManuallyDrop::new(DeprecatedStrong {
                        raw: JSValue::from_encoded(0xAEBCFA),
                        safety: None,
                    })))
                    .cast::<DeprecatedStrong>(),
                )
            },
            ref_count: 1,
        });
        #[cfg(not(debug_assertions))]
        let safety: Safety = ();
        DeprecatedStrong { raw: value, safety }
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
        if let Some(safety) = &mut self.safety {
            safety.ref_count += 1;
        }
    }

    pub fn unref(&mut self) {
        self.raw.unprotect();
        #[cfg(debug_assertions)]
        if let Some(safety) = &mut self.safety {
            if safety.ref_count == 1 {
                // SAFETY: ptr was produced by Box::into_raw in `init` and not yet freed.
                unsafe {
                    debug_assert!((*safety.ptr.as_ptr()).raw.encoded() == 0xAEBCFA);
                    (*safety.ptr.as_ptr()).raw = JSValue::from_encoded(0xFFFFFF);
                    // Free without running Drop on the sentinel (ManuallyDrop is repr(transparent)).
                    drop(Box::from_raw(
                        safety.ptr.as_ptr().cast::<ManuallyDrop<DeprecatedStrong>>(),
                    ));
                }
                // Neutralize so Drop is a no-op (see top-of-file PORT NOTE).
                self.safety = None;
                self.raw = JSValue::ZERO;
                return;
            }
            safety.ref_count -= 1;
        }
    }
}

impl Drop for DeprecatedStrong {
    fn drop(&mut self) {
        self.raw.unprotect();
        #[cfg(debug_assertions)]
        if let Some(safety) = &mut self.safety {
            // SAFETY: ptr was produced by Box::into_raw in `init` and has not been freed
            // (ref_count == 1 asserted below).
            unsafe {
                debug_assert!((*safety.ptr.as_ptr()).raw.encoded() == 0xAEBCFA);
                (*safety.ptr.as_ptr()).raw = JSValue::from_encoded(0xFFFFFF);
                debug_assert!(safety.ref_count == 1);
                // Free without running Drop on the sentinel (ManuallyDrop is repr(transparent)).
                drop(Box::from_raw(
                    safety.ptr.as_ptr().cast::<ManuallyDrop<DeprecatedStrong>>(),
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
    pub const EMPTY: Optional =
        Optional { backing: DeprecatedStrong { raw: JSValue::ZERO, safety: SAFETY_NONE } };

    pub fn init_non_cell(non_cell: Option<JSValue>) -> Optional {
        Optional { backing: DeprecatedStrong::init_non_cell(non_cell.unwrap_or(JSValue::ZERO)) }
    }

    pub fn init(value: Option<JSValue>) -> Optional {
        Optional { backing: DeprecatedStrong::init(value.unwrap_or(JSValue::ZERO)) }
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
        Optional { backing: self.backing.dupe() }
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
#[allow(unused_macros)]
use enable_safety as _;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/DeprecatedStrong.zig (95 lines)
//   confidence: medium
//   todos:      2
//   notes:      deinit→Drop (unref zeroes self in debug to neutralize Drop; release-mode ref/unref+Drop overlap needs Phase-B audit); ci_assert→debug_assertions proxy; assumes JSValue::{from_encoded,encoded,protect,unprotect,is_cell,is_empty,ZERO}
// ──────────────────────────────────────────────────────────────────────────
