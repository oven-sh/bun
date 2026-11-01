# `async`/`.await` on Bun's event loops

An exploration: can Rust's `async`/`.await` run on the event loops Bun already has, without a runtime, and does it make
the code simpler? This file is the result. The code is real and tested, and four pieces of Bun were ported to it to find
out.

**Short answer: yes.** A first version bolted futures onto the loop as it was, and its seams were hacks
([what went wrong](#what-went-wrong-and-what-to-watch-for), 1). This one changes four things in Bun so that they fit:
something owns in-flight work, tasks never leave their thread, a child process can be awaited by whoever holds it, and
`MiniEventLoop` runs futures too. What is still awkward, and what it would take, is under [Not done](#not-done).

## What it is

Not a runtime. There is no reactor, no thread, no timer wheel and no run queue here. `core::future` asks an executor
for two things: somewhere to keep a future, and a `Waker`. That is all this provides.

| Where                       | Lines | `unsafe` | What                                                                                   |
| --------------------------- | ----- | -------- | -------------------------------------------------------------------------------------- |
| `src/async/task.rs`         | 396   | 1        | `Tasks`: the futures of one loop. A `Waker` is a `TaskId`, which is a number.          |
| `src/async/slot.rs`         | 63    | 0        | `Slot<T>`: a callback on the loop's thread hands a value to the future that awaits it. |
| `src/async/race.rs`         | 38    | 1        | `race(a, b)`: the one combinator the ports needed.                                     |
| `src/jsc/future.rs`         | 411   | 7        | The JS loop: `spawn`, `promise`, `JsTask::blocking`, `AwaitSafe`.                      |
| `src/event_loop/futures.rs` | 68    | 0        | `MiniEventLoop`: `spawn`.                                                              |
| `src/spawn/capture.rs`      | 248   | 3        | `Capture`: a child process run to its end, with its output. On either loop.            |
| `src/runtime/future.rs`     | 309   | 6        | `sleep` (the timer heap) and `settled` (a JS promise).                                 |

`src/async` depends on nothing, so its tests run under Miri: `bun run rust:miri -p bun_async`.

## Who owns what

```
VirtualMachine.futures: Tasks<OnJsLoop>          (a thread with a MiniEventLoop: one Tasks<OnMiniLoop>)
   └─ entry { generation, Pin<Box<dyn Future>>, scheduler, how many Wakers }       ◄── the only owner
          ▲ TaskId = table | generation | index: a number
          ├── a Waker                      clone and drop count; wake queues the id
          └── Task { tag: Future, ptr: id, context } in EventLoop::tasks
```

The table owns every future. Everything else holds a number, and a number that outlives its task finds nothing: there
is no reference count to get wrong and no pointer to dangle. A future is dropped when it finishes, when its context or
its VM stops (`cancel_where`, `close`), or when the last `Waker` that could resume it is gone.

**Tasks do not leave their thread, and neither do their `Waker`s.** What another thread has for a task comes back through
the door Bun already has: `JsTask::blocking` is a `Job<C>` whose completion fills a `Slot`. So the core has no atomics
(one counter hands out table ids) and is safe Rust but for `Waker::from_raw`. A `Waker` has to be `Send`, and a number
is: on another thread, cloning and dropping one do nothing and waking one panics.

## How it hooks into the loop

```
host function ── future::promise(cx, |js| async move { .. }) ──► vm.futures.spawn(..), polled once, right here
                                                                   ▼
                                                            .await something ──► Pending, back to JS
   timer fires / child exits                          │ waker.wake():  EventLoop::tasks.push(Task { Future, id, context })
   pool thread finishes ── Ticket::post ──► Job::then │ resume_now(task, ..): polled in this task
   promise reacts (a microtask)                       │ resume_now(task, ..): polled in this microtask
                                                                   ▼
                     tick_queue_with_count ─► enter context ─► run_task ─► vm.futures.run(id) ─► drain microtasks
```

| The loop's rule                                                         | What it becomes                                                                                                                                                         |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work is a `Task { tag, ptr, context }`                                  | One tag, `Future`, for every `async` body. One arm in `run_task`, one in `release_task_unrun`. Both are safe calls: `ptr` is an id.                                     |
| A task runs inside the context that started it, or is released unrun    | The `ContextId` is kept with the task and rides on every wake-up.                                                                                                       |
| Microtasks drain after each task; what it throws is folded in one place | Unchanged. A poll is a task. `Err(JsError)` out of the future is the arm's `Err`.                                                                                       |
| Native work stops with its context                                      | `ScriptExecutionContext::stop_handles`, which every kind of stop goes through, drops the context's futures. Destructors replace `release_unrun`, `cancel` and `deinit`. |
| What leaves the thread holds a `Ticket`, and comes back by `post`       | `blocking` is a `Job`. `worker-late-completion.test.ts` has a row for `Bun.password.hash`, and it passes unchanged.                                                     |
| A pending promise does not keep the process alive; a handle does        | A pending future does not. `Sleep`, `blocking` and `LoopRef` do. `settled` does not.                                                                                    |
| `await` continues in the promise's reaction                             | So does `settled(promise).await`: after the reactions registered before it and before those registered after.                                                           |
| A promise that is collected unsettled releases what waited for it       | The reaction's cell drops the `Waker`. A task with none left is queued once more, to be dropped outside the sweep.                                                      |
| The macro loop only ticks while a macro is waited on                    | A macro's task that is woken after the macro returned goes to the regular loop, as `macro_loop_if_not_running` does for posts.                                          |
| A callback that is kept carries its `AsyncLocalStorage` context         | Unchanged, and per callback: `with_async_context_if_needed` when it is rooted, as a timer does.                                                                         |
| The collector scans the stack, not the heap                             | `AwaitSafe`, below.                                                                                                                                                     |

### `AwaitSafe`: a `JSValue` across an `.await` does not compile

A suspended future is heap memory, which JSC's conservative scan never sees. This is the hazard that would make the
whole idea a bad one, and the compiler can rule it out. rustc already computes which types a future stores across its
suspension points (that is how it decides `Send`), and a custom auto trait asks the same question:

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
`#![feature(auto_traits, negative_impls)]`, and it is a stopgap: it exists because `JSValue` is `Copy + 'static`. The
newer bindings are safe by construction. `js.scope(|cx| ..)` takes a `for<'call>` closure, so no `JsLocal<'call>` can
reach an `.await`.

## The ports

Each was picked for a different shape, and each keeps its existing tests.

| What                                                | Loop | Shape                                      | Lines       | Also removed                                                                                                               | Existing tests               |
| --------------------------------------------------- | ---- | ------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `Bun.password.hash` / `verify`                      | JS   | one pool hop                               | 604 → 529   | a trait, two op structs, a job struct, a `JobContext` impl                                                                 | 77 pass, as before           |
| `Bun.cron(path, ..)` / `Bun.cron.remove` (OS-level) | JS   | spawn, read a pipe, write a file, spawn    | 2896 → 1859 | two refcounted job structs, two state enums, a 13-method trait, 25 "may free `this`"                                       | 82 pass / 35 skip, as before |
| `vi.waitFor` / `vi.waitUntil` / `expect.poll`       | JS   | interval + deadline + callbacks + thenable | 495 → 338   | a JS class, a timer tag and its arm, two reaction host functions, an `AbortHandle` impl                                    | 935 pass, as before (\*)     |
| git dependencies of `bun install`                   | Mini | a chain of commands, retries over URLs     | 1645 → 1360 | an 18-field refcounted struct, a `Step` enum, the 135-line `on_command_exit` over it, 16 "may free `this`", a `--trim` cut | 201 pass, as before (\*\*)   |

(\*) Two leak checks counted instances of the `ViWait` JS class, which no longer exists. They now count the `Error` each
wait roots (0 → 100 while pending → 0).

(\*\*) `bun-install-git-deps.test.ts`. On a debug build two or three of them pass their 5 s limit when the file runs whole,
before and after the port alike. They pass alone.

Files that existed before: **+934 / −2385**. The glue above is about 1,530 lines, once.

A clone, which tries each URL until one works, was `Step::Clone { url, replaces }`, `spawn_clone`, an arm of
`on_command_exit`, `reset_polls`, `maybe_finished` and `fail`. Now:

```rust
async fn clone_anew(&mut self, mut urls: Vec<Vec<u8>>, replaces: bool) -> Result<Finalize, Error> {
    loop {
        let url = self.next_url(&mut urls, "clone");
        let tmp_path = self.new_staging()?;
        let cloned = self.git(&[b"clone", .., b"--bare", b"--", &url, &tmp_path])?.await;
        if cloned.succeeded() {
            return Ok(Finalize::PublishRepo(self.take_staging(), url, replaces));
        }
        self.hold_output(&cloned.stderr);
        if urls.is_empty() { .. return Err(..) }
        self.take_staging().discard();
    }
}
```

The "may free `this`" comments are gone because the hazard is: a callback only fills a `Slot` and wakes the task, so
nothing is freed, spawned or settled beneath a callback.

### The structural part

Every closed dispatch list has one entry per _consumer_: `task_tag` (86), `EventLoopTimer::Tag` (28), `ProcessExit` (14),
`BufferedReaderParentLink` (14), `NativePromiseContext::Tag` (12). "Adding a variant: do all four" is the cost of each new
async thing. With futures a list has one entry per _primitive_, or none, and a consumer is an `async fn` that registers
nothing. `Process` now keeps a `Waker` next to its exit handler, so awaiting one takes no variant: `ProcessExit` is down
to 11. `Capture` is the one reader parent that every future shares: `BufferedReaderParentLink` is down to 12.

cron and git each had their own copy of "spawn, start the readers, count `remaining_fds`, wait for the exit too". So do
`lifecycle_script_runner.rs`, `security_scanner.rs` and `filter_run.rs`. It is `Capture` now, in `bun_spawn`, below both
`bun_install` and `bun_runtime`.

`--trim` likes this too. A dispatch arm names its consumer, so each needs `in_features!` or a `removable_definition!` to
keep the reference from counting. The only static reference to an `async` body is the vtable its own `spawn` call site
names.

## What it costs

Release, `cargo bench -p bun_async` (system allocator, one thread):

| Case                                                                          | ns   | lock-free first version |
| ----------------------------------------------------------------------------- | ---- | ----------------------- |
| by hand: box a struct with a fn pointer, queue, run, free                     | 12.6 |                         |
| future: spawn, finish in the first poll, free                                 | 21.4 | 17.4                    |
| future: spawn, suspend, wake, queue, resume, free (+ an `Rc` the bench makes) | 59.2 | 45.6                    |
| future: each further suspend, wake, queue, resume                             | 24.1 | 17.3                    |

Owning the tasks in a table costs 4 to 14 ns per operation over counted pointers: a thread-local read, a `RefCell` flag
and an index, each time a `Waker` is cloned, dropped or woken.

Everything below is the **debug + ASAN** build, on a shared VM whose timings move by 20% from one minute to the next:

- One pool hop: `futures.add` and the same thing written as a `Job` are within noise of each other (40-100 µs). The
  future is a `Job` plus an `Rc`, an `Arc` and a table entry, and continues in the job's own completion task.
- A cold install of 12 git dependencies (38 git commands), the same tree with the old and the new `git_runner.rs`: medians
  of 277 and 284 ms before, 284 to 354 ms after, 284 and 287 in the quietest runs. The runs were not interleaved, so that
  does not tell them apart. The main thread makes the same system calls in both: 38 `vfork`, 38 `pidfd_open`, 78
  `epoll_ctl`, 9 `epoll_pwait2`.

**Not measured:** a release build of Bun, and binary size. Each `spawn` site instantiates a poll function and a vtable.

## What went wrong, and what to watch for

Found by doing the ports and by having them reviewed, not by thinking about them.

1. **The first version was hacky, and its worst bug was not found by tests.** A task was a counted pointer with a lock-free
   state word, as in `async-task`, kept alive by its own `Waker`s, and its context reached it through an `AbortHandle`'s
   uncounted pointer. The last `Waker` dropped on a pool thread counted the references down to zero and _then_ marked the
   task an orphan, and a context that stopped in between freed it. 16 tests under 64 Miri seeds had passed, and a test
   written for that interleaving passed 783 seeds on the broken code. Review found it. It also needed a hook in a generic
   trait for one debug test, `unsafe impl Send + Sync`, and 94 lines with `unsafe` where there are 18 now. Those went with
   their cause: tasks had no owner and were reachable from other threads.
2. **In the safe core a mistake is a panic or a hang, not corruption.** `for _ in 0..queue.borrow().len()` keeps the borrow
   for the whole loop: every git install aborted with "RefCell already borrowed" and a stack trace that named the line.
   `cancel_where` counted a task that, being polled, was only marked: a context stopped by its own future asked again for
   ever. Review found that one, and tests now hold it.
3. **`AwaitSafe` is per type, so it has false positives.**
   - `fallible()?.await` is refused when the error is a `JsError`: the `?` makes a `ControlFlow<Result<!, JsError>, Fut>`
     temporary that lives to the end of the statement. Bind the future with `let` first.
   - A crate-wide `Error` enum with a `Js(JsError)` variant makes every `Result<_, Error>` unholdable.
     `Blocking<T>` asserts the trait itself for that reason (`T: Send` cannot point to a cell).
   - It follows pointers. A `Weak<BunTest>` is refused because `BunTest` has `JSValue` fields, though it roots them
     itself. Such a type opts in with an `unsafe impl` that says why (`RunningEntry`).
   - It cannot see a cell laundered through `usize` or `*mut c_void`.
4. **Polling a finished future hangs.** The first `ViWait` port `break`ed out of a `race` the timer had won and then
   awaited the same timer: 11 tests timed out. Leaf futures should stay ready once ready (`Sleep` does).
5. **A future that keeps its own `Waker` is never an orphan.** It waits for its context to stop.
6. **`blocking` closures are `Send + 'static`.** The future can be dropped while the pool thread runs, so the closure
   cannot borrow from it: data moves in, and back out with the result. Work that is abandoned before the pool starts it is
   skipped, and it is the `Blocking`, not the job, that keeps the process alive. Work that uses a pinned `ArrayBuffer` in
   place takes `blocking_with(pinned, |ticket| ..)`: the job keeps `pinned` and drops it on the JS thread when the work
   has ended, whoever still waits.
7. **A timer, an exit or an EOF resumes its future one task later.** About 24 ns and one more (usually empty) microtask
   checkpoint. It is deliberate: the future owns the `Sleep` or the `Capture` whose callback is running, and polling it
   there could free that beneath the callback. A `Job`'s completion and a promise's reaction are beneath nothing the future
   owns, so they poll it where they stand (`resume_now`). They know which task from `running_task()`, noted when they were
   polled. Telling it from the `Waker` would mean comparing vtables, whose addresses differ from crate to crate in some
   builds: the order of continuations would have depended on the build.
8. **Cancellation is `drop`, at any `.await`, and porting adds it.** That is the feature, but every leaf must be
   drop-safe and anything that must be undone needs a guard (`TempFile`, `GitTask::staging`).
   - It changes behaviour. The old OS-level cron jobs ran to their end whatever happened to the context that started
     them. Now an `--isolate` swap or a worker's end stops one between two commands: on macOS, between `bootout` and
     `bootstrap`, which leaves the job unregistered.
   - A dropped `Capture` lets go of its child as a collected `Subprocess` does: not killed, and not reaped.
   - A future cancelled from inside its own poll (its callback disposes its `Bun.ModuleGraph`) runs on to its next
     `.await`. In a poll the loop started nothing of that shows: the loop entered the task's context, and `JSValue::call`
     and settling a promise are no-ops once that context has stopped. In the first poll, inside the host function, it does.
   - Nothing cancels a `MiniEventLoop`'s futures. They end, or the process does.
9. **`await` has more cases than it looks.** Reacting to a promise directly skips a `then` that a subclass overrides
   (`p-lazy`), which the hand-written `ViWait` called. `settled` asks JSC's `isThenFastAndNonObservable` first.
10. **Roots are `Strong`s.** `ViWait` kept four values in a JS wrapper's internal fields behind one root. Now it holds
    three or four handle slots.
11. **Futures pull, uSockets pushes.** `on_data` hands over bytes now. A future would have to buffer them until polled.
    This is not for the HTTP server's request path or the socket hot paths.
12. **Stack traces stop at the poll.** A few readable frames of glue, then `run_task`. Nothing says who awaited whom, and
    the inspector's `AsyncTaskTracker` is not wired up.
13. **An id is 63 bits:** 24 of index, 27 of generation, 12 of table.
    - A VM with 16.7 million futures at once throws an out-of-memory error for the next.
    - A `Waker` that is kept while its slot is reused an exact multiple of 2²⁷ times names the task that is there now: a
      needless poll, or a `Waker` counted out too early.
    - The 4,096th table gets the first one's id again. Only a `Waker` on the wrong thread could tell, and none gets there.

## Not done

- **Awaiting a promise still goes through a GC cell.** `settled` makes a `NativePromiseContext` cell that holds a raw `Rc`,
  two host functions react, a `Strong` carries the outcome, and the cell's C++ destructor has a branch for this tag. Bun's
  JSC has `performPromiseThenWithInternalMicrotask` and internal microtasks of Bun's own: one more, "resume native task
  _id_", would replace all four. It is a change to the WebKit fork.
- **`JSValue` is still `Copy + 'static`.** 371 Rust files name it and 189 name `JsLocal` or `JsScope`. `AwaitSafe` and its
  `unsafe impl`s can go when native code holds only a `JsLocal<'call>` or a rooted handle, and when an error that crosses an
  `.await` carries its value instead of meaning "an exception is pending on the VM".
- **The timer heap is in `bun_runtime`, and `MiniEventLoop` has no timers.** So `sleep` is JS-only and `bun_install` cannot
  use it. The heap belongs to the loop, in `bun_event_loop`. Whether a timer can be faked is decided by its `Tag`, so `Sleep`
  is always on the real clock. The in-process `CronJob` (about 500 lines of refcounts, `tick_cell`, `in_fire` and deferred
  stops around "sleep, call, await the promise, repeat") needs one that can be.
- **A thread's plain futures are only polled by a `MiniEventLoop`.** `bun_event_loop::futures::spawn` on a JS thread would wait
  for ever. One `EventLoopHandle::spawn` for both loops needs the JS loop to drain them as well.
- **`lifecycle_script_runner.rs`**, the largest state machine of the install (about 860 lines). `Capture` fits its I/O. What
  does not fit a `'static` future yet: it borrows (`&'a ZStr`, `*mut Installer<'a>`), and it is an intrusive node of
  `active_lifecycle_scripts`, which refers to it by address.
- **Streams.** `Capture` collects. `filter_run.rs`, `multi_run.rs` and the shell print output as it comes, which wants
  `reader.next_chunk().await`.
- **macOS and Windows.** The `cfg`-gated halves of `Capture`, `command` and cron were neither compiled nor run for this.
- **`Bun.spawnSync`'s isolated loop** as a task's home, and **`async: true` in bindgen**, so that a host function can simply be
  an `async fn`.

## Writing one

```rust
pub(crate) fn thing(cx: &mut JsScope<'_>, input: Vec<u8>, callback: JsLocal<'_, Callable>) -> JsResult<JSValue> {
    let callback = callback.to_js().with_async_context_if_needed(cx.global());
    let callback = Strong::create(callback, cx.global());                  // root what crosses an .await
    future::promise(&cx.js_thread(), |js| async move {                     // runs to the first .await right now
        let digest = js.blocking(move || expensive(&input)).await;         // pool thread; owns its input
        sleep(10).await;                                                   // timer heap; keeps the process alive
        let returned = callback.get().call(js.global(), JSValue::UNDEFINED, &[])?;   // `?` rejects the promise
        let returned = settled(js.global(), returned)?;                    // `let`, then `.await`: see 3.
        match returned.await {
            Ok(value) => Ok(value),
            Err(reason) => Err(Rejection::Value(reason)),
        }
    })
}
```

Off the JS thread's loop there is no `js`, no roots and no `AwaitSafe`:

```rust
bun_event_loop::futures::spawn(async move {
    let listed = Capture::spawn(options, streams, &argv, env, event_loop)?.await;
    ..
});
```

To make something awaitable: put a `Slot<T>` (or a `Waker`) where the callback can reach it, `fill` it from the callback,
`poll_take` it from `poll`, and undo the registration in `Drop`.
