### Problem
- A throw from a `'data'` listener on `child.stdout` or `child.stderr` stalls the stream: the child blocks in `write` and the parent never exits. The report is `unhandledRejection`, so an `'uncaughtException'` handler is not called.
- The cause is the pull promise in `read()` (`native-readable.ts`). `push()` emits `'data'` inside its reaction, and a throw there rejects it before the next read is asked for.

### Fix
- `FileReader` gets a read callback (`setReadCallback`), which `node:child_process` registers for stdout and stderr. Each read completion calls it from the event loop, as a libuv handle does in Node. No pull promise is left on these streams.
- A throw is an `uncaughtException`. The source then waits for the next turn of the event loop, so a run that ends at the error calls no listener again.
- Process lifetime does not change: the reader is unref'd until the first `_read()`.
- Verified: the four test files of the diff, which fail on main.

### Background
- `NativeReadable` is the Node `Readable` over a native source. `FileReader` is that source for a pipe.
- `EventLoop::run_callback_then` is new: it calls a function, reports the outcome, then runs ticks and promise jobs.
- Also weighed: a catch around `emit` (hides a throw from a manual `emit('data')`), a `process.nextTick` push (a re-attaching listener loses chunks), an fd-backed `net.Socket` (#36316: 18 more syscalls per spawn).

### Downsides
- Each chunk is a `Buffer` of its own, copied once from the reader's scratch. Per paced chunk: 13 to 5 GC cells, 3 to 2 `recvfrom`, 55.9 K to 47.3 K instructions.
- Listeners see the `AsyncLocalStorage` store of the spawn, as in Node, not of the first read.
- Binary text grows 12,158 bytes. The Windows code compiled but did not run here.
