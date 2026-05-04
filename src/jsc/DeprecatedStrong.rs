use core::ptr::NonNull;

use crate::JSValue;

// PORT NOTE: This file is a Zig file-level struct. In Zig it is referenced as
// `jsc.Strong.Deprecated` (see bottom-of-file alias `const Strong = jsc.Strong.Deprecated`).
// Ported here as `DeprecatedStrong`.
//
// PORT NOTE: `pub fn deinit` is intentionally KEPT as an inherent method instead of
// `impl Drop`. This type exposes manual `ref()`/`unref()` (JSValueProtect-based
// refcounting) whose teardown path overlaps `deinit`; an automatic `Drop` would
// double-`unprotect` after a final `unref`. The Zig is explicitly manual and
// deprecated — preserve that contract. Phase B may revisit once all callers are
// audited.
// TODO(port): revisit Drop vs explicit deinit once call sites are ported.

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
            // SAFETY: Box::into_raw never returns null.
            ptr: unsafe {
                NonNull::new_unchecked(Box::into_raw(Box::new(DeprecatedStrong {
                    raw: JSValue::from_encoded(0xAEBCFA),
                    safety: None,
                })))
            },
            ref_count: 1,
        });
        #[cfg(not(debug_assertions))]
        let safety: Safety = ();
        DeprecatedStrong { raw: value, safety }
    }

    pub fn deinit(&mut self) {
        self.raw.unprotect();
        #[cfg(debug_assertions)]
        if let Some(safety) = &mut self.safety {
            // SAFETY: ptr was produced by Box::into_raw in `init` and has not been freed
            // (ref_count == 1 asserted below).
            unsafe {
                debug_assert!((*safety.ptr.as_ptr()).raw.encoded() == 0xAEBCFA);
                (*safety.ptr.as_ptr()).raw = JSValue::from_encoded(0xFFFFFF);
                debug_assert!(safety.ref_count == 1);
                drop(Box::from_raw(safety.ptr.as_ptr()));
            }
        }
    }

    pub fn get(&self) -> JSValue {
        self.raw
    }

    pub fn swap(&mut self, next: JSValue) -> JSValue {
        let prev = self.raw;
        self.deinit();
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
                    drop(Box::from_raw(safety.ptr.as_ptr()));
                }
                return;
            }
            safety.ref_count -= 1;
        }
    }
}

pub struct Optional {
    backing: DeprecatedStrong,
}

impl Optional {
    pub const EMPTY: Optional = Optional::init_non_cell(None);

    pub const fn init_non_cell(non_cell: Option<JSValue>) -> Optional {
        // PORT NOTE: reshaped — Zig calls Strong.initNonCell(non_cell orelse .zero);
        // that fn debug_asserts !is_cell() which is non-const, so inline the field
        // init here to keep `EMPTY` a const.
        let v = match non_cell {
            Some(v) => v,
            None => JSValue::ZERO,
        };
        Optional { backing: DeprecatedStrong { raw: v, safety: SAFETY_NONE } }
    }

    pub fn init(value: Option<JSValue>) -> Optional {
        Optional { backing: DeprecatedStrong::init(value.unwrap_or(JSValue::ZERO)) }
    }

    pub fn deinit(&mut self) {
        self.backing.deinit();
    }

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
//   notes:      deinit kept explicit (not Drop) due to ref/unref overlap; ci_assert→debug_assertions proxy; assumes JSValue::{from_encoded,encoded,protect,unprotect,is_cell,is_empty,ZERO}
// ──────────────────────────────────────────────────────────────────────────
