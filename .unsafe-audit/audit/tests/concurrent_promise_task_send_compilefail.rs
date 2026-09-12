// =========================================================================
// trybuild compile-fail fixture
// Bug:      pass-3 jsc-ub-2 — ConcurrentPromiseTask<C>: Send unbounded
//           (src/jsc/ConcurrentPromiseTask.rs:55)
// Catches:  any ConcurrentPromiseTaskContext that itself holds a !Send
//           payload (e.g. a JS-thread-only Strong, a !Send pool handle) is
//           silently laundered into the work-pool queue, where it crosses
//           thread boundaries and is dereferenced on the worker.
// Today:    COMPILES — `unsafe impl<C: ConcurrentPromiseTaskContext> Send
//           for ConcurrentPromiseTask<'_, C> {}` carries NO Send bound on
//           the Context. With the existing fields:
//             - ctx: Box<Context>             ← needs Context: Send
//             - promise: JSPromiseStrong      ← JS-thread-only !Send
//             - global_this: &JSGlobalObject  ← needs ref Sync
//           the only way Send is justifiable is the work-pool hand-off
//           sequence, but the type-system bound should mirror what the
//           contract says.
// After fix: FAILS TO COMPILE. Audit-recommended bound:
//
//               unsafe impl<C: ConcurrentPromiseTaskContext + Send> Send
//                   for ConcurrentPromiseTask<'_, C> {}
//
//           ... and a separate, narrower SAFETY note for the JSC-handle
//           fields whose Send-safety derives from the work-pool sequence
//           (or factor them into Send wrappers).
//
// To wire in: add to `tests/compile_fail.rs` in `bun_jsc`.
// =========================================================================

#![allow(dead_code)]

use std::marker::PhantomData;
use std::rc::Rc;

use bun_jsc::{ConcurrentPromiseTask, ConcurrentPromiseTaskContext};

// A Context that is intentionally !Send (holds an Rc) but otherwise satisfies
// the trait. This MUST be rejected by the type system after the fix lands.
struct NotSendCtx {
    _rc: Rc<u32>,
    _phantom: PhantomData<*const ()>,
}

// Stub implementation of the trait — fields/methods follow the actual
// ConcurrentPromiseTaskContext shape in src/jsc/ConcurrentPromiseTask.rs.
// Use the project's TASK_TAG; trait body is the minimum to compile.
impl ConcurrentPromiseTaskContext for NotSendCtx {
    const TASK_TAG: bun_jsc::TaskTag = bun_jsc::TaskTag::PLACEHOLDER;
    fn run(&mut self) {}
    fn then(&mut self, _promise: &mut bun_jsc::JSPromise) -> Result<(), bun_jsc::JsTerminated> {
        Ok(())
    }
}

fn requires_send<T: Send>(_: T) {}

fn make() -> Box<ConcurrentPromiseTask<'static, NotSendCtx>> {
    unimplemented!("constructor is irrelevant — we only need the type to typecheck")
}

fn main() {
    // Today this compiles because of the unbounded Send impl. After fix:
    //   error[E0277]: `Rc<u32>` cannot be sent between threads safely
    let t = make();
    requires_send(t);
}
