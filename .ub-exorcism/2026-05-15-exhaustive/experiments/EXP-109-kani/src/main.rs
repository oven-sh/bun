//! Kani proof-obligation harness for EXP-109 post-fix invariant.
//!
//! AUDIT REFERENCE: §EXP-109 in UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md
//!   — Compiled.js_function: JSValue (bare) → Strong<JSValue> (post-fix)
//!
//! WHAT THIS PROVES (over a mock model of JSC's protected-set GC):
//!
//!   For every reachable program state where:
//!     1. A Strong<T> wrapper S exists in scope, holding a value v
//!     2. The mock garbage collector has run any non-deterministic number
//!        of cycles, each potentially evicting non-rooted values
//!   Then: S.get() returns Some(v) — i.e. the value Strong promised to
//!         protect is still live.
//!
//! WHAT THIS DOES NOT PROVE:
//!   - That JSC's actual implementation of the protected-set GC respects
//!     the same invariant (Kani cannot reach into C++).
//!   - That every code path in Bun's bun:ffi correctly uses the new
//!     Strong<JSValue> wrapper (that's a per-call-site SAFETY review).
//!
//! WHAT THIS DOES PROVE:
//!   - The ABSTRACT contract Strong<T> must uphold to make the EXP-109 fix
//!     work — namely that protect-on-construction + unprotect-on-drop +
//!     "GC only collects values not in the protected set" gives a sound
//!     liveness guarantee that bare JSValue does NOT have.
//!
//! This is sufficient for the Phase-5 PROVE operator: it pins the
//! pre-conditions and post-conditions of the Strong<T> migration, so a
//! human reviewer can verify that JSC's actual API (`JSValue::protect()` /
//! `JSValue::unprotect()`) matches the abstract contract proven here.
//!
//! Run under Kani:
//!     cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-109-kani
//!     cargo kani --harness proof_strong_protects_value_across_gc
//!     cargo kani --harness proof_drop_unprotects
//!     cargo kani --harness proof_bare_value_is_not_protected
//!
//! Run without Kani (just as a regular cargo build to confirm the model
//! is well-typed):
//!     cargo build

#![allow(dead_code)]

// ─── Mock JSC heap model ─────────────────────────────────────────────────────

/// Mock JS value — a tag the GC tracks.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct JsValueTag(u32);

/// Mock JSC heap: tracks which values are "alive" (allocated) and which are
/// in the "protected set" (rooted via Strong, will survive GC).
///
/// In real JSC this is `JSC::Heap` + the protected-set in `Heap.cpp`. The
/// mock preserves the only invariant we care about for EXP-109:
///   protected ⊆ alive  (a value cannot be protected without being alive)
///   GC removes from alive any value NOT in protected.
struct MockHeap {
    alive: [bool; 8],     // bit-set of which values are currently alive
    protected: [u32; 8],  // refcount per value (0 = not protected, >0 = protected)
}

impl MockHeap {
    const fn new() -> Self {
        Self { alive: [false; 8], protected: [0; 8] }
    }

    /// Allocate a new value; returns a JsValueTag that points to it.
    /// In real JSC this is JSCell allocation in MarkedSpace.
    fn alloc(&mut self, slot: usize) -> JsValueTag {
        assert!(slot < 8);
        self.alive[slot] = true;
        JsValueTag(slot as u32)
    }

    /// Add value to the protected set. Real JSC: JSValue::protect(v).
    fn protect(&mut self, v: JsValueTag) {
        let s = v.0 as usize;
        assert!(s < 8);
        assert!(self.alive[s], "cannot protect a dead value (heap-use-after-free)");
        self.protected[s] = self.protected[s].saturating_add(1);
    }

    /// Remove from protected set (one refcount). Real JSC: JSValue::unprotect(v).
    fn unprotect(&mut self, v: JsValueTag) {
        let s = v.0 as usize;
        assert!(s < 8);
        if self.protected[s] > 0 {
            self.protected[s] -= 1;
        }
    }

    /// Run garbage collection: free every alive-but-not-protected value.
    /// Real JSC: Heap::collectAllGarbage().
    fn gc(&mut self) {
        for i in 0..8 {
            if self.alive[i] && self.protected[i] == 0 {
                self.alive[i] = false;
            }
        }
    }

    fn is_alive(&self, v: JsValueTag) -> bool {
        let s = v.0 as usize;
        s < 8 && self.alive[s]
    }
}

// Global mock heap — a Kani harness writes to it directly via `unsafe`.
// In real Bun this is `JSC::VM::heap()` accessed via Strong's destructor.
static mut MOCK_HEAP: MockHeap = MockHeap::new();

fn heap_alloc(slot: usize) -> JsValueTag {
    unsafe { (*&raw mut MOCK_HEAP).alloc(slot) }
}
fn heap_gc() {
    unsafe { (*&raw mut MOCK_HEAP).gc() }
}
fn heap_is_alive(v: JsValueTag) -> bool {
    unsafe { (*&raw const MOCK_HEAP).is_alive(v) }
}
fn heap_protect(v: JsValueTag) {
    unsafe { (*&raw mut MOCK_HEAP).protect(v) }
}
fn heap_unprotect(v: JsValueTag) {
    unsafe { (*&raw mut MOCK_HEAP).unprotect(v) }
}

// ─── Mock Strong<JSValue> ────────────────────────────────────────────────────

/// Strong<JSValue> stand-in. Real Bun: bun_jsc::Strong wraps a protected
/// JSValue with !Send + !Sync auto-traits (must be created + dropped on the
/// JS thread).
struct Strong {
    inner: JsValueTag,
}

impl Strong {
    /// Constructor: protect the value, then store the handle.
    /// Real Bun: Strong::create(value, global) calls JSValue::protect(value).
    fn new(v: JsValueTag) -> Self {
        heap_protect(v);
        Self { inner: v }
    }

    /// Get the underlying value; sound because of the protection invariant.
    fn get(&self) -> JsValueTag {
        self.inner
    }
}

impl Drop for Strong {
    fn drop(&mut self) {
        heap_unprotect(self.inner);
    }
}

// ─── Mock bare JSValue (pre-fix shape) ───────────────────────────────────────

/// What Compiled.js_function currently holds: just the bits.
#[derive(Copy, Clone)]
struct BareJsValue {
    inner: JsValueTag,
}

impl BareJsValue {
    fn new(v: JsValueTag) -> Self {
        // NO protection step — this is the pre-fix bug.
        Self { inner: v }
    }
    fn get(&self) -> JsValueTag {
        self.inner
    }
}

// ─── Kani proof obligations ──────────────────────────────────────────────────

/// PROOF 1: For any allocated value held inside a `Strong`, GC does not
/// invalidate it.
///
/// This is the *core invariant* the EXP-109 Strong<JSValue> fix relies on.
///
/// Bound rationale: the inner gc() loop iterates exactly 8 slots; we bound to
/// 9 for CBMC's "<= N" semantics. The outer "non-deterministic GC cycles"
/// loop is fully unrolled below to 3 explicit cycles (sufficient since the
/// invariant is monotonic — if it holds across 3 cycles it holds across N).
#[cfg_attr(kani, kani::proof)]
#[cfg_attr(kani, kani::unwind(9))]
fn proof_strong_protects_value_across_gc() {
    let slot: usize = kani::any();
    kani::assume(slot < 8);

    let v = heap_alloc(slot);
    let s = Strong::new(v);
    assert!(heap_is_alive(s.get()), "freshly-protected value must be alive");

    // Explicit cycle 1
    heap_gc();
    assert!(heap_is_alive(s.get()), "Strong must survive GC cycle 1");
    // Explicit cycle 2
    heap_gc();
    assert!(heap_is_alive(s.get()), "Strong must survive GC cycle 2");
    // Explicit cycle 3 — invariant is monotonic; >3 cycles add no info.
    heap_gc();
    assert!(
        heap_is_alive(s.get()),
        "Strong<JSValue>::get() must return a live value across any number of GC cycles"
    );

    drop(s);
}

/// PROOF 2: Dropping a Strong unprotects the value (so it CAN be collected).
///
/// This is the *converse* of PROOF 1 — without this, refcounts leak and the
/// JS heap grows unboundedly.
#[cfg_attr(kani, kani::proof)]
fn proof_drop_unprotects() {
    let slot: usize = kani::any();
    kani::assume(slot < 8);

    let v = heap_alloc(slot);
    {
        let _s = Strong::new(v);
        // Strong is in scope here; v is protected.
    }
    // _s went out of scope; Drop ran; v is unprotected.
    heap_gc();
    assert!(
        !heap_is_alive(v),
        "After Strong is dropped + GC runs, the value MUST be collected (no leak)"
    );
}

/// PROOF 3: A bare JSValue does NOT protect the underlying value.
///
/// This is the *demonstration of the bug* EXP-109 catches: the bare JSValue
/// shape currently in Compiled.js_function has no protection lifecycle, so
/// GC will happily collect it.
#[cfg_attr(kani, kani::proof)]
fn proof_bare_value_is_not_protected() {
    let slot: usize = kani::any();
    kani::assume(slot < 8);

    let v = heap_alloc(slot);
    let bare = BareJsValue::new(v);
    assert!(heap_is_alive(bare.get()), "freshly-allocated value is alive");

    // GC — bare value is not in the protected set.
    heap_gc();

    // KEY POSTCONDITION: a bare JSValue lets GC collect the value out from
    // under it. This is the EXP-109 UB shape.
    assert!(
        !heap_is_alive(bare.get()),
        "EXP-109 demonstration: bare JSValue is NOT protected; GC collects it. \
         Subsequent .get() returns a dangling tag — UB if dereferenced by JSC."
    );
}

/// PROOF 4: Strong handles compose correctly with sibling Strongs over the
/// same value (refcount semantics).
///
/// Real Bun: a single JSFunction can be referenced from multiple Compiled
/// allocations — each must get its own Strong to add to the protect-refcount.
#[cfg_attr(kani, kani::proof)]
fn proof_multiple_strongs_refcount_correctly() {
    let slot: usize = kani::any();
    kani::assume(slot < 8);

    let v = heap_alloc(slot);
    let s1 = Strong::new(v);
    let s2 = Strong::new(v);

    // Drop one Strong; value still protected by the other.
    drop(s1);
    heap_gc();
    assert!(
        heap_is_alive(s2.get()),
        "Dropping ONE of two Strongs does not invalidate the value"
    );

    // Drop the last Strong.
    drop(s2);
    heap_gc();
    assert!(
        !heap_is_alive(v),
        "After ALL Strongs drop and GC runs, value is collected"
    );
}

// ─── Sanity main (for non-Kani build) ────────────────────────────────────────

fn main() {
    // Without Kani, run the proofs with concrete inputs as a smoke test
    // (proves the model compiles + matches our hand-traced expectations).
    println!("[exp-109-kani] running concrete smoke-tests of the abstract proofs");

    // Smoke 1: Strong protects across GC
    let v = heap_alloc(0);
    let s = Strong::new(v);
    heap_gc();
    heap_gc();
    assert!(heap_is_alive(s.get()), "smoke 1 failed: Strong did not protect");
    drop(s);
    println!("  smoke 1 PASS: Strong protects across multiple GC cycles");

    // Smoke 2: dropping Strong allows collection
    let v2 = heap_alloc(1);
    {
        let _s = Strong::new(v2);
    }
    heap_gc();
    assert!(!heap_is_alive(v2), "smoke 2 failed: Drop did not unprotect");
    println!("  smoke 2 PASS: dropping Strong allows collection");

    // Smoke 3: bare JSValue is collected
    let v3 = heap_alloc(2);
    let bare = BareJsValue::new(v3);
    heap_gc();
    assert!(!heap_is_alive(bare.get()), "smoke 3 failed: bare JSValue was somehow protected");
    println!("  smoke 3 PASS: bare JSValue is NOT protected (the EXP-109 bug shape)");

    // Smoke 4: refcount over multiple Strongs
    let v4 = heap_alloc(3);
    let s1 = Strong::new(v4);
    let s2 = Strong::new(v4);
    drop(s1);
    heap_gc();
    assert!(heap_is_alive(s2.get()), "smoke 4a failed: dropping one Strong invalidated value");
    drop(s2);
    heap_gc();
    assert!(!heap_is_alive(v4), "smoke 4b failed: value not collected after all Strongs gone");
    println!("  smoke 4 PASS: Strong refcount composes correctly");

    println!("[exp-109-kani] all 4 abstract invariants hold under concrete smoke-tests");
    println!("[exp-109-kani] run `cargo kani --harness <proof_*>` to verify symbolically");
}

// Kani stub for non-Kani builds (so `cargo build` succeeds).
#[cfg(not(kani))]
mod kani {
    pub fn any<T: Default>() -> T { T::default() }
    pub fn assume(_cond: bool) {}
}
