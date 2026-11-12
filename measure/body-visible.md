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
