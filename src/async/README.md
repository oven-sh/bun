# `async`/`.await` on Bun's event loops

An exploration: can Rust's `async`/`.await` run on the event loop Bun already has, without a runtime, and does it
make the code simpler? This file is the result. The code is real and tested, and three pieces of Bun were ported to
it to find out.

**Short answer: yes, and it fits.** The loop's existing rules (task queue, script execution contexts, the thread door,
teardown, keep-alive) each map onto one small piece of glue, and the consumers get a lot shorter. The costs are
listed under [What it costs](#what-it-costs) and [What went wrong](#what-went-wrong-and-what-to-watch-for).

## What it is

Not a runtime. There is no reactor, no thread, no timer wheel and no run queue here. `core::future` asks an executor
for two things: somewhere to keep a future, and a `Waker`. That is all this provides.

| Where                   | Lines | What                                                                                      |
| ----------------------- | ----- | ----------------------------------------------------------------------------------------- |
| `src/async/task.rs`     | 366   | One allocation: header + scheduler + future. A `Waker` is a counted pointer to it.        |
| `src/async/slot.rs`     | 57    | `Slot<T>`: a callback on the loop's thread hands a value to the future that awaits it.    |
| `src/async/blocking.rs` | 183   | `blocking(f).await`: a closure on a thread pool, safe to abandon at any time.             |
| `src/async/race.rs`     | 38    | `race(a, b)`: the one combinator the ports needed.                                        |
| `src/jsc/future.rs`     | 349   | The JS loop's side: `spawn`, `promise`, `JsTask::blocking`, `AwaitSafe`.                  |
| `src/runtime/future.rs` | 532   | What to await: `sleep`, `settled` (a JS promise), `Command` (a child process and a pipe). |

`src/async` has no dependency on JSC or uSockets, so its tests run under Miri: `bun run rust:miri -p bun_async`.

## How it hooks into the loop

```
host function ── future::promise(cx, |js| async move { .. }) ──► Box { header, OnJsLoop, future }
                                                                   │ polled once, right here
                                                                   ▼
                                                            .await something ──► Pending, back to JS
   timer fires / child exits / promise reacts / pool thread finishes
                                                                   │ waker.wake()
        same thread: EventLoop::tasks.push(Task { tag: Future, ptr, context })
       other thread: VmHandle::post(intrusive ConcurrentTask in the same allocation)
                                                                   ▼
                     tick_queue_with_count ─► enter context ─► run_task ─► poll ─► drain microtasks
```

| The loop's rule                                                         | What it becomes                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work is a `Task { tag, ptr, context }`                                  | One tag, `Future`, for every `async` body. One arm in `run_task`, one in `release_task_unrun`.                                                                                  |
| A task runs inside the context that started it, or is released unrun    | The `ContextId` is captured at `spawn` and rides on every wake-up.                                                                                                              |
| Microtasks drain after each task; what it throws is folded in one place | Unchanged. A poll is a task. `Err(JsError)` out of the future is the arm's `Err`.                                                                                               |
| Native work stops with its context (`AbortHandle`)                      | The task embeds one. VM teardown, the `bun test --isolate` swap and a disposed `Bun.ModuleGraph` drop the future. Destructors replace `release_unrun`, `cancel` and `deinit`.   |
| What leaves the thread holds a `Ticket`                                 | A future never leaves. The closure given to `blocking` does, with a `Ticket` held until its result is posted. A `Waker` holds a `VmHandle`, so it may outlive the VM.           |
| The macro loop only ticks while a macro is waited on                    | A macro's task that is woken after the macro returned goes to the regular loop, as `macro_loop_if_not_running` does for posts. Not tested.                                      |
| A pending promise does not keep the process alive; a handle does        | A pending future does not. `Sleep`, `blocking` and `LoopRef` do. `settled` does not.                                                                                            |
| The collector scans the stack, not the heap                             | `AwaitSafe`, below.                                                                                                                                                             |
| A promise that is collected unsettled releases what waited for it       | The reaction's cell drops the `Waker`. A task whose last `Waker` is gone can never resume, so it queues itself once more to be dropped on its own thread (safe during a sweep). |

### `AwaitSafe`: a `JSValue` across an `.await` does not compile

A suspended future is heap memory, which JSC's conservative scan never sees. This is the hazard that would make the
whole idea a bad one, and it turns out the compiler can rule it out. rustc already computes which types a future stores
across its suspension points (that is how it decides `Send`), and a custom auto trait asks the same question:

```rust
pub unsafe auto trait AwaitSafe {}
impl !AwaitSafe for JSValue {}      // and JSCell, JSObject, JSPromise, .., JsError, CallFrame, scope guards
pub fn spawn<F: Future + AwaitSafe + 'static>(..)
```

```
error[E0277]: `JSValue` cannot be held across an `.await`
   |  let v = make(); tick().await; use_value(v);
   |      -                  ^^^^^ await occurs here, with `v` maybe used later
   |      has type `JSValue` which does not implement `AwaitSafe`
   = note: keep a `Strong` across the `.await` and read the `JSValue` back after it
```

A value that is dead before the `.await`, a `JSValue` as the future's output and `step().await?` all compile. It needs
`#![feature(auto_traits, negative_impls)]`. The newer bindings API is safe by construction as well:
`js.scope(|cx| ..)` takes a `for<'call>` closure, so no `JsLocal<'call>` can reach an `.await`.

## The ports

Each was picked for a different shape, and each keeps its existing tests.

| What                                                | Shape                                      | Before → after (lines) | Also removed                                                                                                       | Existing tests               |
| --------------------------------------------------- | ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `Bun.password.hash` / `verify`                      | one pool hop                               | 604 → 529              | a trait, two op structs, a job struct, a `JobContext` impl                                                         | 77 pass, as before           |
| `Bun.cron(path, ..)` / `Bun.cron.remove` (OS-level) | spawn, read a pipe, write a file, spawn    | 2896 → 1857            | two refcounted job structs, two state enums, a 13-method trait, 2 `ProcessExit` + 2 reader-parent variants (→ 1+1) | 82 pass / 35 skip, as before |
| `vi.waitFor` / `vi.waitUntil` / `expect.poll`       | interval + deadline + callbacks + thenable | 495 → 338              | a JS class, a timer tag and its arm, two reaction host functions, an `AbortHandle` impl                            | 935 pass, as before (\*)     |

(\*) Two leak checks counted instances of the `ViWait` JS class, which no longer exists. They now count the `Error` each
wait roots (0 → 100 while pending → 0).

Tracked files: **+568 / −1771**. The glue above is about 1,525 lines, once.

What the cron port looks like, in full, for Linux:

```rust
async fn register(self) -> Result<(), Failure> {
    let crontab = find_crontab().ok_or_else(|| failure!("crontab not found in PATH"))?;
    let mut table = crontab_without(&crontab, title, "Out of memory ..").await?;   // runs `crontab -l`
    let _ = write!(&mut table, "# bun-cron: {title}\n{sched} '{exe}' run ..");
    install_crontab(&crontab, &table, "bun-cron-").await                       // temp file, `crontab <file>`
}
```

Before, that sequence was `RegisterState`, `check_finished`, `advance_state`, `remaining_fds`,
`has_called_process_exit` and 25 "may free `this`" comments. Those comments are gone because the hazard is: a callback
now only fills a `Slot` and wakes the task, so nothing is freed, spawned or settled beneath a callback.

### The structural part

Every closed dispatch list has one entry per _consumer_: `task_tag` (86), `EventLoopTimer::Tag` (28), `ProcessExit` (14),
`BufferedReaderParentLink` (14), `NativePromiseContext::Tag` (12). "Adding a variant: do all four" is the cost of each new
async thing. With futures a list has one entry per _primitive_, and a consumer is an `async fn` that registers nothing.

`--trim` likes this too. A dispatch arm names its consumer, so each needs `in_features!` to keep the reference from
counting. The only static reference to an `async` body is the vtable its own `spawn` call site names. A leaf belongs to
no feature, so it stays out of entry points that features remove: the cell of an awaited promise has a destructor
callback of its own (`Bun__Future__promiseCollected`), not an arm in `Bun__NativePromiseContext__destroy`.

## What it costs

Release, `cargo bench -p bun_async` (system allocator, one thread):

| Case                                                                          | ns   |
| ----------------------------------------------------------------------------- | ---- |
| by hand: box a struct with a fn pointer, queue, run, free                     | 12.4 |
| future: spawn, finish in the first poll, free                                 | 17.4 |
| future: spawn, suspend, wake, queue, resume, free (+ an `Rc` the bench makes) | 45.6 |
| future: each further suspend, wake, queue, resume                             | 17.3 |

Per operation, next to `Job<C>` for one pool hop: the same number of allocations (task + operation, against job +
`ConcurrentTask`: the wake-up's queue node is intrusive), the same single loop dispatch, a few more uncontended atomics.
End to end on the **debug** build, `futures.add` and the same thing through `Job` are within noise of each other
(35-100 µs either way).

**Not measured:** a release build of Bun, and binary size. Each `spawn` site instantiates a poll function and a vtable.

## What went wrong, and what to watch for

Found by doing the ports and by having them reviewed, not by thinking about them.

1. **`AwaitSafe` is per type, so it has false positives.**
   - `fallible()?.await` is refused when the error is a `JsError`: the `?` makes a `ControlFlow<Result<!, JsError>, Fut>`
     temporary that lives to the end of the statement. Bind the future with `let` first.
   - A crate-wide `Error` enum with a `Js(JsError)` variant makes every `Result<_, Error>` unholdable.
     `Blocking<T>` asserts the trait itself for that reason (`T: Send` cannot point to a cell).
   - It follows pointers. A `Weak<BunTest>` is refused because `BunTest` has `JSValue` fields, though it roots them
     itself. Such a type opts in with an `unsafe impl` that says why (`RunningEntry`).
   - It cannot see a cell laundered through `usize` or `*mut c_void`.
2. **Polling a finished future hangs.** The first `ViWait` port `break`ed out of a `race` the timer had won and then
   awaited the same timer: 11 tests timed out. Leaf futures should stay ready once ready (`Sleep` now does).
3. **`blocking` closures are `Send + 'static`.** The future can be dropped while the pool thread runs, so the closure
   cannot borrow from it: data moves in, and back out with the result. Work that reads a pinned `ArrayBuffer` in place has
   a harder version of this: the pin must outlive the pool work _and_ be released on the JS thread. `Job<C>`'s `Js` half
   does exactly that. Those jobs should stay on `Job`, or get a `blocking_with(js_half, f)` that comes home when abandoned.
4. **A resume is a task, not a microtask.** `settled(promise).await` continues one loop task after the reaction, where
   hand-written reactions run inside it. No ported test noticed. Code with spec-exact microtask ordering (streams) would.
5. **One more hop.** A timer, an exit or an EOF used to call its owner directly. Now it wakes a task: ~17 ns and one more
   (usually empty) microtask checkpoint.
6. **Cancellation is `drop`, at any `.await`, and porting adds it.** That is the feature, but every leaf must be
   drop-safe and anything that must be undone needs a guard (`TempFile`).
   - It changes behaviour. The old OS-level cron jobs had no `AbortHandle` and ran to their end whatever happened to the
     context that started them. Now an `--isolate` swap or a worker's end stops one between two commands: on macOS,
     between `bootout` and `bootstrap`, which leaves the job unregistered.
   - A dropped `Command` lets go of its child as a collected `Subprocess` does: not killed, and not reaped.
   - A future cancelled from inside its own poll (its callback disposes its `Bun.ModuleGraph`) runs on to its next
     `.await`. In a poll the loop started nothing of that shows: the loop entered the task's context, and `JSValue::call`
     and settling a promise are no-ops once that context has stopped. In the first poll, inside the host function, it does.
7. **Roots are `Strong`s.** `ViWait` kept four values in a JS wrapper's internal fields behind one root. Now it holds
   three or four handle slots.
8. **Futures pull, uSockets pushes.** `on_data` hands over bytes now. A future would have to buffer them until polled.
   This is not for the HTTP server's request path or the socket hot paths.
9. **Stack traces stop at the poll.** About four readable frames of glue, then `run_task`. Nothing says who awaited
   whom, and the inspector's `AsyncTaskTracker` is not wired up.
10. **The core is lock-free `unsafe` code, and tests did not find its worst bug.** Review did: the last `Waker` dropped on a
    pool thread counted the references down to zero and _then_ marked the task an orphan, and `cancel`, which reaches a
    task through the `AbortHandle`'s uncounted pointer, could free it in between. 16 tests under 64 Miri seeds had passed, and
    a test written for that interleaving passed 783 seeds on the broken code. It is now one compare-and-swap that never
    passes through zero. The same review found unbounded recursion when a loop refuses an orphan (reproduced, fixed).
11. **`await` has more cases than it looks.** Reacting to a promise directly skips a `then` that a subclass overrides
    (`p-lazy`), which the hand-written `ViWait` called. `settled` now asks JSC's `isThenFastAndNonObservable` first.

## Not done

- **`MiniEventLoop`.** The core does not care which loop it is on: it needs a `Schedule` impl of about 50 lines whose node is
  an `AnyTaskWithExtraContext`, and `InFlight for ()` already exists. The biggest state machines (install's lifecycle
  scripts, `--filter`, the shell) run there, so this is the next thing to prove.
- **macOS and Windows.** The `cfg`-gated halves of the cron and `Command` code were neither compiled nor run for this.
- **Fake timers.** `Sleep` is on the real clock. The in-process `CronJob` (about 500 lines of refcounts, `tick_cell`,
  `in_fire` and deferred stops around "sleep, call, await the promise, repeat") needs a fakeable one.
- **`Bun.spawnSync`'s isolated loop** as a task's home.
- **`async: true` in bindgen**, so that a host function can simply be an `async fn`.

## Writing one

```rust
pub(crate) fn thing(cx: &mut JsScope<'_>, input: Vec<u8>, callback: JsLocal<'_, Callable>) -> JsResult<JSValue> {
    let callback = Strong::create(callback.to_js(), cx.global());          // root what crosses an .await
    future::promise(&cx.js_thread(), |js| async move {                     // runs to the first .await right now
        let digest = js.blocking(move || expensive(&input)).await;         // pool thread; owns its input
        sleep(10).await;                                                   // timer heap; keeps the process alive
        let returned = callback.get().call(js.global(), JSValue::UNDEFINED, &[])?;   // `?` rejects the promise
        let returned = settled(js.global(), returned)?;                    // `let`, then `.await`: see 1.
        match returned.await {
            Ok(value) => Ok(value),
            Err(reason) => Err(Rejection::Value(reason)),
        }
    })
}
```

To make something awaitable: put a `Slot<T>` where the callback can reach it, `fill` it from the callback,
`poll_take` it from `poll`, and undo the registration in `Drop`.
