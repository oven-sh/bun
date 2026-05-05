use core::cell::Cell;
use core::ptr::NonNull;

use bun_jsc::SystemError;

use crate::interpreter::{
    Assigns, Cmd, CondExpr, Expansion, If, Pipeline, Script, Stmt, Subshell,
};
use crate::interpreter::io_writer::IOWriterChildPtr;

// TODO(port): `log` is `bun.shell.interpret.log` — a `bun.Output.scoped(.X, ...)` debug logger.
// Replace with `bun_output::scoped_log!(SHELL, ...)` once the scope name is confirmed.
use crate::interpret::log;

/// There are constraints on Bun's shell interpreter which are unique to shells in
/// general:
/// 1. We try to keep everything in the Bun process as much as possible for
///    performance reasons and also to leverage Bun's existing IO/FS code
/// 2. We try to use non-blocking IO as much as possible so the shell
///    does not block the main JS thread
/// 3. Zig does not have coroutines (yet)
///
/// These cause two problems:
/// 1. Unbounded recursion, if we keep calling .next() on state machine structs
///    then the call stack could get really deep, we need some mechanism to allow
///    execution to continue without blowing up the call stack
///
/// 2. Correctly handling suspension points. These occur when IO would block so
///    we must, for example, wait for epoll/kqueue. The easiest solution is to have
///    functions return some value indicating that they suspended execution of the
///    interpreter.
///
/// This `Yield` struct solves these problems. It represents a "continuation" of
/// the shell interpreter. Shell interpreter functions must return this value.
/// At the top-level of execution, `Yield.run(...)` serves as a "trampoline" to
/// drive execution without blowing up the callstack.
///
/// Note that the "top-level of execution" could be in `Interpreter.run` or when
/// shell execution resumes after suspension in a task callback (for example in
/// IOWriter.onWritePoll).
#[derive(strum::IntoStaticStr)]
pub enum Yield<'a> {
    Script(&'a mut Script),
    Stmt(&'a mut Stmt),
    Pipeline(&'a mut Pipeline),
    Cmd(&'a mut Cmd),
    Assigns(&'a mut Assigns),
    Expansion(&'a mut Expansion),
    If(&'a mut If),
    Subshell(&'a mut Subshell),
    CondExpr(&'a mut CondExpr),

    /// This can occur if data is written using IOWriter and it immediately
    /// completes (e.g. the buf to write was empty or the fd was immediately
    /// writeable).
    ///
    /// When that happens, we return this variant to ensure that the
    /// `.onIOWriterChunk` is called at the top of the callstack.
    ///
    /// TODO: this struct is massive, also I think we can remove this since
    ///       it is only used in 2 places. we might need to implement signals
    ///       first tho.
    OnIoWriterChunk {
        err: Option<SystemError>,
        written: usize,
        /// This type is actually `IOWriterChildPtr`, but because
        /// of an annoying cyclic Zig compile error we're doing this
        /// quick fix of making it `*anyopaque`.
        // TODO(port): the cyclic-import constraint is Zig-specific; in Rust this
        // can likely be `IOWriterChildPtr` directly.
        child: NonNull<()>,
    },

    Suspended,
    /// Failed and threw a JS error
    Failed,
    Done,
}

thread_local! {
    /// Used in debug builds to ensure the shell is not creating a callstack
    /// that is too deep.
    // Zig: `if (Environment.isDebug) usize else u0` — in release the counter is
    // zero-sized. Here we keep a `usize` always but only touch it under
    // `cfg!(debug_assertions)`, so release builds elide all accesses.
    static DBG_CATCH_EXEC_WITHIN_EXEC: Cell<usize> = const { Cell::new(0) };
}

impl<'a> Yield<'a> {
    /// Ideally this should be 1, but since we actually call the `resolve` of the Promise in
    /// Interpreter.finish it could actually result in another shell script running.
    const MAX_DEPTH: usize = 2;

    pub fn is_done(&self) -> bool {
        matches!(self, Yield::Done)
    }

    pub fn run(self) {
        // Capture the tag name of the *original* `self` for debug logging. The Zig
        // labelled-switch trampoline never reassigns `this`, so the `defer` log uses
        // the entry tag, not the current state's tag.
        let tag: &'static str = (&self).into();

        if cfg!(debug_assertions) {
            let n = DBG_CATCH_EXEC_WITHIN_EXEC.get();
            log!("Yield({}) _dbg_catch_exec_within_exec = {} + 1 = {}", tag, n, n + 1);
        }
        debug_assert!(DBG_CATCH_EXEC_WITHIN_EXEC.get() <= Self::MAX_DEPTH);
        if cfg!(debug_assertions) {
            DBG_CATCH_EXEC_WITHIN_EXEC.set(DBG_CATCH_EXEC_WITHIN_EXEC.get() + 1);
        }
        // Zig `defer { ... _dbg_catch_exec_within_exec -= 1; }` — side-effect defer.
        let _guard = scopeguard::guard((), move |_| {
            if cfg!(debug_assertions) {
                let n = DBG_CATCH_EXEC_WITHIN_EXEC.get();
                log!("Yield({}) _dbg_catch_exec_within_exec = {} - 1 = {}", tag, n, n - 1);
                DBG_CATCH_EXEC_WITHIN_EXEC.set(n - 1);
            }
        });

        // A pipeline creates multiple "threads" of execution:
        //
        // ```bash
        // cmd1 | cmd2 | cmd3
        // ```
        //
        // We need to start cmd1, go back to the pipeline, start cmd2, and so
        // on.
        //
        // This means we need to store a reference to the pipeline. And
        // there can be nested pipelines, so we need a stack.
        //
        // PERF(port): was stack-fallback (std.heap.stackFallback(@sizeOf(*Pipeline) * 4)) —
        // profile in Phase B; smallvec::SmallVec<[*mut Pipeline; 4]> may be the right shape.
        //
        // PORT NOTE: reshaped for borrowck — the Zig stores `*Pipeline` while *also*
        // continuing execution via `x.next()` (which holds `&mut Pipeline`). That is
        // aliased mutable access and cannot be expressed with `&'a mut`. We store raw
        // pointers (identity-compared, same as `std.mem.indexOfScalar(*Pipeline, ...)`).
        let mut pipeline_stack: Vec<*mut Pipeline> = Vec::with_capacity(4);

        // Zig uses a labelled `state: switch (this) { ... continue :state expr; }` as a
        // tail-call trampoline. Rust has no labelled-switch-continue, so we lower it to
        // an explicit `loop { state = match state { ... } }`.
        //
        // Note that we're using labelled switch statements but _not_
        // re-assigning `this`, so the `this` variable is stale after the first
        // execution. Don't touch it.
        let mut state = self;
        loop {
            state = match state {
                Yield::Pipeline(x) => {
                    let x_ptr: *mut Pipeline = x as *mut Pipeline;
                    if x.state.is_done() {
                        // remove it from the pipeline stack as calling `.next()` will now deinit it
                        if let Some(idx) = pipeline_stack.iter().position(|p| *p == x_ptr) {
                            pipeline_stack.remove(idx);
                        }
                        x.next()
                    } else {
                        debug_assert_eq!(pipeline_stack.iter().position(|p| *p == x_ptr), None);
                        pipeline_stack.push(x_ptr);
                        x.next()
                    }
                }
                Yield::Cmd(x) => x.next(),
                Yield::Script(x) => x.next(),
                Yield::Stmt(x) => x.next(),
                Yield::Assigns(x) => x.next(),
                Yield::Expansion(x) => x.next(),
                Yield::If(x) => x.next(),
                Yield::Subshell(x) => x.next(),
                Yield::CondExpr(x) => x.next(),
                Yield::OnIoWriterChunk { err, written, child } => {
                    let child = IOWriterChildPtr::from_any_opaque(child);
                    child.on_io_writer_chunk(written, err)
                }
                Yield::Failed | Yield::Suspended | Yield::Done => {
                    if let Some(y) = Self::drain_pipelines(&mut pipeline_stack) {
                        y
                    } else {
                        return;
                    }
                }
            };
        }
    }

    pub fn drain_pipelines(pipeline_stack: &mut Vec<*mut Pipeline>) -> Option<Yield<'a>> {
        if pipeline_stack.is_empty() {
            return None;
        }
        let mut i: i64 = i64::try_from(pipeline_stack.len()).unwrap() - 1;
        while i >= 0 && usize::try_from(i).unwrap() < pipeline_stack.len() {
            // SAFETY: `pipeline_stack` only holds pointers pushed in `run()` above from
            // live `&'a mut Pipeline` borrows that have not yet reached `.done` (which
            // deinits). The Zig invariant is that a pipeline is removed from the stack
            // before `.next()` is called on a `.done` pipeline (see the `Pipeline` arm
            // in `run`), so dereferencing here is sound.
            // TODO(port): lifetime — revisit once shell state-machine ownership is settled.
            let pipeline: &mut Pipeline =
                unsafe { &mut *pipeline_stack[usize::try_from(i).unwrap()] };
            if pipeline.state.is_starting_cmds() {
                return Some(pipeline.next());
            }
            let _ = pipeline_stack.pop();
            if pipeline.state.is_done() {
                return Some(pipeline.next());
            }
            i -= 1;
        }
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/Yield.zig (172 lines)
//   confidence: medium
//   todos:      3
//   notes:      pipeline_stack uses *mut Pipeline (aliased &mut); labelled-switch lowered to loop+match; Pipeline.state matched via .is_done()/.is_starting_cmds() helpers Phase B must add
// ──────────────────────────────────────────────────────────────────────────
