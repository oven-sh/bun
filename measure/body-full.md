### Problem
- A throw from a `'data'` listener on `child.stdout` or `child.stderr` stalls the stream: the child blocks in `write` and the parent never exits. The report is `unhandledRejection`, not `uncaughtException`.
- The cause is the pull promise in `read()` (`native-readable.ts`): `push()` emits `'data'` inside its reaction.

### Fix
- `FileReader` gets a read callback, which `node:child_process` registers for stdout and stderr. Each read completion calls it from the event loop, as libuv does in Node.
- A throw is an `uncaughtException`. The source then waits for the loop's next turn, so a run that ends there calls no listener again.
- Process lifetime is unchanged: the reader is unref'd until the first `_read()`.
- Verified: the four test files in the diff. 25 new tests fail on main.

### Background
- `FileReader` is the native source of a pipe under `NativeReadable`, the Node `Readable`.
- `EventLoop::run_callback_then` (new) calls a function, reports the outcome, then runs ticks and promise jobs.
- Also weighed: a catch around `emit` (hides manual `emit('data')` throws), a `nextTick` push (re-attaching listeners lose chunks), an fd-backed `net.Socket` (#36316: +18 syscalls per spawn).

### Downsides
- Each chunk is its own `Buffer`, copied once. Per paced chunk: 13 to 5 GC cells, 3 to 2 `recvfrom`, 55.9 K to 47.3 K instructions.
- Listeners see the `AsyncLocalStorage` store of the spawn (as in Node), not of the first read.
- Binary text: +12,158 bytes. Windows code compiled but did not run here.

<details><summary>Notes</summary>

**Repro** (Node prints `exit=0 spawned=40 data=40 uncaughtException=40 unhandledRejection=0`; main stops after a few children)

```js
import { spawn } from "node:child_process";
let ue = 0, ur = 0, data = 0, n = 0; const N = 40;
process.on("uncaughtException", (e, origin) => { origin === "unhandledRejection" ? ur++ : ue++; next(); });
process.on("unhandledRejection", () => { ur++; next(); });
process.on("exit", (code) => console.log(`exit=${code} spawned=${n} data=${data} uncaughtException=${ue} unhandledRejection=${ur}`));
function next() {
  if (n >= N) return; n++;
  const c = spawn("/bin/sh", ["-c", "echo hi"], { stdio: ["ignore", "pipe", "ignore"] });
  c.stdout.on("data", () => { data++; throw new Error("data-throw-" + n); });
}
next();
```

**What the diff does, by file**

- `FileReader.rs`: `setReadCallback` puts a source in handle mode. `on_read_chunk` hands each chunk to the callback as a `Buffer` that owns its bytes, `on_reader_done` and `on_reader_error` report the end or the error in a call of their own. `false` from the callback stops the reader until `setFlowing(true)`. Only a fresh live pipe can enter handle mode. Every other source keeps the pull path.
- `event_loop.rs`: `run_callback_then` and `CallbackOutcome` (`Returned`, `Threw`, `Stopped`).
- `PipeReader.rs`: `PAUSE_ENDS_READ_LOOP` (a paused reader ends its read loop also on a pipe that hung up) and `try_unpause` on Windows.
- `ReadCallbackAsyncContext.cpp`: the report of a throw is made inside the async context of the callback, as a timer's is. `node:repl` needs this to take the error for its own.
- `native-readable.ts`: handle mode for `constructNativeReadable(stream, options, true)`. `_read()` only starts the reader. `onRead()` pushes.
- `child_process.ts`: builds stdout and stderr at spawn also for a stdio array of fewer than 3 entries, and passes `handleMode`.

**After a throw**

The source pauses its reader and queues a task with `enqueue_task_after_yield`. That task starts the reader again on the next turn of the loop. An end or a read error that arrives on the turn of the throw waits for the same task. With no `'uncaughtException'` handler, `bun run` and `bun -e` stop turning the loop once the error is counted, so the task never runs: one listener call, exit code 1, no `'end'`, no `'close'`. Where the loop goes on (`--hot`, a queued immediate, a pending top-level `await`, `bun test`, the REPL) the stream goes on with it.

**Process lifetime** (unref'd `sleep 2` child, seconds until the parent exits: Node / main / this PR)

| | Node v26.3.0 | main | PR |
|---|---|---|---|
| pipes untouched | 2 | 0 | 0 |
| `child.stdout` read once as a property | 2 | 0 | 0 |
| `'data'` listener | 2 | 2 | 2 |
| `'readable'` listener | 2 | 2 | 2 |
| `'data'` listener, then `pause()` | 2 | 2 | 2 |
| `unref()` of every pipe | 0 | 0 | 0 |

Node holds the parent for an unread pipe. Bun did not and does not: the source reads from spawn on, as in Node, but the reader is unref'd and what it reads waits in a list until the stream's first `_read()`. `_read()` takes the list, as a pulling `_read()` takes what the pipe holds, and applies `ref()` and `unref()`.

**Measurements** (release builds, Linux x64, merge base `447ff870b60` against this branch; instructions with `perf_event_open`, syscalls with a `ptrace` counter of the parent, cells with `heapStats()` and `BUN_JSC_useGC=0`)

Per `'data'` of `child.stdout`, each chunk written to a stream that waits:

| | main | PR |
|---|---|---|
| GC cells | 13.0 | 5.0 |
| of these `Promise` / `Function` / `JSLexicalEnvironment` / `Uint8Array` | 2 / 2 / 3 / 2 | 0 / 0 / 1 / 1 |
| `process.nextTick` | 0.98 | 1.00 |
| `Promise.prototype.then` | 0.98 | 0 |
| `Buffer` views (`subarray`) | 2 | 0 |
| chunks that share an `ArrayBuffer` | 63 of 64 | 0 of 64 |
| `recvfrom` / `epoll_ctl` / `epoll_pwait2` | 3.0 / 3.0 / 1.3 | 2.0 / 3.0 / 1.2 |
| host calls from JS (`pull`, `setFlowing`) | 2 | 0 |
| instructions, `'data'` listener | 55.9 K | 47.3 K |
| instructions, `for await` | 76.1 K | 65.9 K |

The fixture's own work per chunk (an immediate and a write to the child's stdin) is in both columns.

A writer that never pauses: 256 MiB gives `then()` 0.89 to 0 per chunk and 3419 to 2947 chunks. 1 GiB costs 710 M to 607 M instructions (median of 3).

Other consumers of `FileReader`, 1 GiB, instructions of 3 runs. `Bun.file().stream()`: 84.0, 82.7, 83.1 M against 79.9, 85.1, 85.2 M. `Bun.spawn().stdout.text()`: 939, 817, 793 M against 831, 827, 834 M. `Readable.fromWeb(Bun.spawn().stdout)`: 713, 783, 792 M against 744, 780, 733 M. No change beyond the spread between runs.

Per spawn of `true` with default stdio: `recvfrom` 2, `epoll_ctl` 4, `epoll_pwait2` 1 on both. Instructions per spawn with the child: 0.866 M to 0.812 M with nothing reading, 0.850 M to 0.855 M with a stdout listener.

Binary: text 144,201,948 to 144,214,106 bytes (`size`). One more host function (`setReadCallback`), one more internal field on the source's wrapper, one more task tag, four one-byte flags on `FileReader`.

**Still different from Node**

- A listener attached in the child's `'exit'` gets what was read before it from `flow()`, inside a tick. A fatal throw there is followed by `'end'` and `'close'`, on main and with this PR. Node ends the process at the throw. Ticks run on after a fatal report in every such case in Bun, so this is not specific to these streams.
- After a fatal report an immediate still turns the loop, as before, and the stream goes on with it.
- `Readable.fromWeb(Bun.spawn().stdout)` and other pulled streams keep the pull promise and its `unhandledRejection`. Node's `fromWeb` reports the same way.

**Tests**

- `test/js/node/child_process/child_process.test.ts`, `test/js/bun/spawn/spawn-stdio-syscall-error.test.ts`, `test/js/bun/repl/repl.test.ts`, `test/js/node/stream/node-stream.test.js`. On a release build of the merge base 25 of the new tests fail (13, 2 and 10). On a release build of this branch all pass.
- One older test in `child_process.test.ts` fails on both builds in this container: "spawn still works with more than 10240 fds open" (the container cannot open that many).
- Fixtures equal to Node v26.3.0 on debug and release: one throw on a waiting chunk, throws on 2, 3 and all chunks of a 12.5 MiB write with and without an `'unhandledRejection'` handler, a fatal throw on a 4 MiB write (one call, code 1), a fatal throw with the end still to come, a listener that re-attaches from a promise job, `'end'` after an async listener's continuation, the order `d1 t1 j1 d2 t2 j2`.
- `bun run rust:check-all`: 12 of 12 targets.
- This branch also carries the pull-buffer change of #48553 (`kRemainingChunk`), which the pull path still needs.

</details>

<!-- robobun:evidence:begin -->

---

**no test proof** · iteration 0 · platform-specific test(s) that do not run on this machine, deferring to CI, which covers all platforms: test/js/node/stream/node-stream.test.js, test/js/node/child_process/child_process.test.ts

<!-- robobun:evidence:end -->
