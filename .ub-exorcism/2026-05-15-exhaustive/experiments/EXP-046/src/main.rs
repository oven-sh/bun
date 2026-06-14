// EXP-046: `WorkTask<C>` / `ConcurrentPromiseTask<C>` `unsafe impl Send` lacks
// `C: Send` on the task-context trait.
//
// This is a *generic owned-wrapper* witness, not a verbatim model of Bun's
// `WorkTask<C>` layout. Production `WorkTask<C>` stores `ctx: *mut C`, so its
// live proof still requires per-context source audit. Production
// `ConcurrentPromiseTask<C>`, however, stores `ctx: Box<C>` and is much closer
// to this witness:
//   src/jsc/ConcurrentPromiseTask.rs:13-22  trait ConcurrentPromiseTaskContext
//   src/jsc/ConcurrentPromiseTask.rs:31     pub ctx: Box<Context>
//   src/jsc/ConcurrentPromiseTask.rs:55     unsafe impl<C: ...> Send for ...
//
// The `WorkTaskContext` trait does **not** require `C: Send`, so the
// `unsafe impl<C: WorkTaskContext> Send for WorkTask<C>` launders Send for any
// payload — including a `WorkTaskContext` impl whose state is `!Send` (e.g. one
// embedding `JSPromiseStrong` / `Strong`).
//
// This file demonstrates both halves of EXP-046:
//   (1) **Type-system witness:** `assert_send` compiles for `WorkTask<MyCtx>`
//       even though `MyCtx` (transparently containing a `Strong<u32>` whose
//       internal representation is `Rc<u32>`) is itself `!Send`. Removing the
//       laundering `unsafe impl` or adding `Context: Send` would make this
//       compile-time-impossible.
//   (2) **Runtime UB witness:** sending `WorkTask<MyCtx>` to another thread,
//       cloning the inner `Rc` on the spawning thread, and dropping the
//       `WorkTask` (and thus the `Strong` and the `Rc`) on the worker thread
//       produces a Miri data race on the `Rc` refcount — the same shape a real
//       `JSPromiseStrong::drop` off-thread would produce against the JS thread.

use std::rc::Rc;
use std::thread;

// --- Modelled `Strong<T>` -------------------------------------------------
//
// Production `Strong<T>` (src/jsc/Strong.rs) holds a JSC handle that must only
// be touched on the JS thread; its type-system signal is `!Send + !Sync`.
// Here we model that with `Rc<T>`, which is `!Send + !Sync` for the same
// reason (non-atomic refcount; touching it cross-thread races on the count).
pub struct Strong<T> {
    inner: Rc<T>,
}

impl<T> Strong<T> {
    pub fn new(value: T) -> Self {
        Self { inner: Rc::new(value) }
    }

    pub fn clone_handle(&self) -> Rc<T> {
        Rc::clone(&self.inner)
    }
}

// Production `Strong<T>` auto-trait is `!Send + !Sync` because it holds a
// raw JSC pointer that may only be touched on the JS thread; we inherit
// `!Send + !Sync` from `Rc<T>` automatically.

// --- Modelled `WorkTaskContext` trait + WorkTask --------------------------
//
// Mirrors the trait declaration in src/jsc/WorkTask.rs:23-34. Note the
// **missing** `Send` bound — this is the load-bearing defect.
pub trait WorkTaskContext: Sized {
    fn run(&self);
}

// `ctx` is private + accessed only through `&self` / `run_and_drop` methods
// below. This intentionally models the owned-context wrapper class. It is
// source-faithful for `ConcurrentPromiseTask<C>`'s `ctx: Box<C>` risk surface,
// but only a lower-bound design warning for `WorkTask<C>`'s raw `*mut C`
// surface.
pub struct WorkTask<C: WorkTaskContext> {
    ctx: C,
}

impl<C: WorkTaskContext> WorkTask<C> {
    pub fn new(ctx: C) -> Self {
        Self { ctx }
    }

    pub fn run_and_drop(self) {
        self.ctx.run();
        // self drops here — Strong::drop → Rc::drop runs on whichever thread
        // owns the WorkTask.
    }
}

// Mirrors src/jsc/WorkTask.rs:58 verbatim: the impl launders `Send` for any
// `WorkTaskContext` impl, including ones that carry `!Send` JS handles.
unsafe impl<C: WorkTaskContext> Send for WorkTask<C> {}

// --- Concrete `WorkTaskContext` impl carrying a `Strong` -------------------
pub struct MyCtx {
    pub strong: Strong<u32>,
}

impl WorkTaskContext for MyCtx {
    fn run(&self) {
        // Real production .run() bodies vary; the relevant defect is what
        // happens at Drop time, not run time.
        std::hint::black_box(*self.strong.inner);
    }
}

// --- (1) Type-system witness ---------------------------------------------
//
// `assert_send::<MyCtx>()` would NOT compile (Rc is !Send), but the laundering
// `unsafe impl<C: WorkTaskContext> Send for WorkTask<C>` makes
// `assert_send::<WorkTask<MyCtx>>()` compile cleanly. This is the load-bearing
// soundness lie: the trait promise is empty, but Send is granted.
fn assert_send<T: Send>() {}

fn main() {
    // (1) compile-time witness — these two lines together demonstrate the
    // laundering. If we tightened the trait to `WorkTaskContext: Send`, the
    // second line below would fail to compile and force every impl to be
    // audited; today it compiles.
    //
    //   // Commented out so the binary still builds — uncomment to see the
    //   // compile error that *should* be there but isn't:
    //   // assert_send::<MyCtx>();   // would fail: `Rc<u32>` is !Send
    assert_send::<WorkTask<MyCtx>>();  // succeeds today thanks to line 58 launder

    // (2) runtime witness — the type-system lie translates to a Miri data race
    // when the `Strong` (and thus its inner `Rc`) is dropped on the worker
    // thread while the spawning thread still holds a clone.

    let ctx = MyCtx { strong: Strong::new(42) };

    // Keep a same-handle clone on the spawning thread so a cross-thread
    // refcount decrement (during the worker's Strong/Rc drop) races with our
    // own refcount manipulation on the main thread.
    let handle_on_main: Rc<u32> = ctx.strong.clone_handle();

    let task = WorkTask::new(ctx);

    // The unbounded `unsafe impl Send for WorkTask<_>` is what makes this
    // `thread::spawn` accept the move closure. The closure only sees the
    // `WorkTask<MyCtx>` opaque wrapper, never `MyCtx` directly, so auto-trait
    // inference reads only the laundering impl — without that impl the
    // compiler would reject the spawn because `MyCtx: !Send`.
    let h = thread::spawn(move || {
        task.run_and_drop();
        // `task` consumed → Strong::drop → Rc::drop runs on the worker thread,
        // decrementing the non-atomic refcount that the main thread is about
        // to drop concurrently.
    });

    // Meanwhile on the main thread, drop the clone — this is the second
    // non-atomic refcount op that races with the worker's drop.
    drop(handle_on_main);

    h.join().unwrap();
}
