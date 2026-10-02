Fixes #44170, fixes #12918

### Problem
- `process` has its own native emitter (`src/jsc/bindings/webcore/EventEmitter.cpp`), which differs from `node:events`: the listeners after one that throws still run, and `process.on(ev, fn)` twice adds `fn` once.
- The runtime emits `'exit'` with no call of `process.emit`, so `signal-exit` misses it.

### Fix
- The methods of `EventEmitter.prototype` move to the module `internal/events/prototype`. The prototype is a native object that takes a method from it at the first read.
- `process` inherits from it, with its listeners in `process._events`. The native emitter is deleted (1,397 lines).
- Native code emits with `process.emit`.
- Verified: `process.test.js` and 6 more files (55 new tests, 39 fail before). Also 609 of node's tests.

### Background
- An internal module is parsed at its first `require()`. `--compile --bytecode` embeds bytecode for the ones that a program can import.
- As in node, a `'newListener'` listener of `process` installs a signal handler.
- Considered: builtin functions (no embedded bytecode), and case-by-case repairs as in #41830 (two emitters stay).

### Downsides
- Behaviour: a listener that throws stops the listeners after it. More than 10 listeners of one event print `MaxListenersExceededWarning`. Notes lists 20 changes.
- The first `process.on()` of a program that did not load `node:events` needs 1,466,055 instructions (was 10,486), about 0.3 ms. With `node:events` loaded: 64,000 to 95,000 fewer.
- Before the JIT compiles them, the methods of `process` are slower: `on` + `off` needs 11,817 instructions in the interpreter (was 4,474). In FTL: 2,723 (was 3,212).

<details><summary>Notes</summary>

#### What changes for a program

Each item is what node v26.3.0 does. Each was run side by side with node.

Listeners of `process`:

1. One function that is added twice runs twice (`on` + `on`, `once` + `on`, `on` + `prependListener`). `removeListener()` removes one registration. A signal keeps its handler until the last registration is gone.
2. `process.listenerCount(event, fn)` counts only `fn`.
3. `events.errorMonitor` listeners run before the `'error'` listeners.
4. `process.emit('error', err)` with no listener throws `err` to the caller. Before: an uncaught exception, and `emit()` returned.
5. What a listener throws out of `process.emit()` reaches the caller, and the listeners after it do not run. Before: an uncaught exception, and the other listeners ran.
6. For an event that the runtime emits (a signal, `'exit'`, `'beforeExit'`, `'message'`, `'disconnect'`, `'uncaughtException'`, `'unhandledRejection'`, `'warning'`), what a listener throws is an uncaught exception as before. New: the listeners after it do not run. Every row of the table in #44170 now prints what node prints.
7. What an `'exit'` listener throws reaches the caller of `process.exit()`.
8. `'removeListener'` is emitted. `rawListeners()` returns the wrapper of a `once()` listener.
9. More than 10 listeners of one event give a `MaxListenersExceededWarning`. `process.getMaxListeners()` is 10 (was 4294967295). `setMaxListeners()` validates its argument and returns `process`. `once(event, null)` throws. `bun test` runs every file in one `process`, and `bun --hot` keeps the listeners of earlier reloads: 11 files or reloads that each add a listener of one event print the warning once.

The shape of `process`:

10. `process.on === EventEmitter.prototype.on`, and the same for the other 14 methods. `process.on === process.addListener`. A method that is borrowed from `EventEmitter.prototype` and `events.getEventListeners(process, …)` use the listeners of `process`.
11. `process._events`, `process._eventsCount` and `process._maxListeners` are own properties, and `Object.keys(process)` has them.
12. On the main thread `process.eventNames()` starts with `newListener`, `removeListener` and `warning`. The first two are the functions `startListeningIfSignal` and `stopListeningIfSignal`. `process.removeAllListeners()` removes them. A signal listener that is added after that has no signal handler, and a `'message'` listener does not keep the IPC channel alive.
13. `process.constructor` is a function with the name `process`. A call returns the object that it was called on. The prototype of `process` has one own key, `constructor`.
14. `worker_threads.postMessageToThread()` delivers with `process.emit('workerMessage')`: a `once()` listener gets one message.

`process.emit` that a program replaced (#12918, also #29194 and #32227):

15. The runtime reads `process.emit` when it emits an event. An `emit` that a program put on `process`, on the prototype of `process` or on `EventEmitter.prototype` gets each event, with or without a listener: `'exit'`, `'beforeExit'`, a signal, `'warning'`, `'message'`, `'disconnect'`, `'uncaughtExceptionMonitor'`, `'rejectionHandled'`, `'worker'`. The four programs of #12918 print what node prints. An `emit` that returns `false` for a warning hides it, which is how some tools hide `ExperimentalWarning`.
16. `on()` and `off()` emit `'newListener'` and `'removeListener'` with the current `process.emit`. A `once()` listener needs a callable `process.emit` to remove itself: `test/js/node/worker_threads/emit-non-function-fixture.js` used `once()` with `process.emit = 5`, and now uses `on()`.

The end of a process or a worker:

17. In a Worker, what an `'exit'` listener throws goes to the worker's `'uncaughtException'` listeners, or else to the `'error'` event of the parent. Before: nothing reported it. `web_worker.rs` set `is_shutting_down` before the listeners ran, and `VirtualMachine::uncaught_exception` drops an error in that state. The main thread sets the flag after the listeners, and the worker now does the same. #42032 has the same line, and also gives the worker the exit code of node.
18. `bun test` exits 1 when an `'exit'` listener throws (the 5 lines of #41588). Without them a listener that throws would hide a later listener that sets the exit code.
19. The trace file (`--trace-event-categories`) and the release of QUIC endpoint sockets were `'exit'` listeners. They now run after the event, also when a listener throws (`Process_functionAddExitCallback`). With a listener that throws, node writes the trace file in 5 of 5 variants, main in 4, this PR in 5.

`node:events`:

20. The stack frame of a method reads `internal:events/prototype:LINE:COL`. Before: `node:events:LINE:COL`, and no frame for a method of `process`.

#### What stays different from node

- `'uncaughtException'` and `'unhandledRejection'`: the error is handled when the event has a listener, as before. Node uses what `process.emit` returns. A replaced `emit` gets these two events only when they have a listener. The same is true for an IPC `'error'`: with no listener it is dropped, as before.
- Node binds `process.emit` to a signal when its first listener is added. Bun reads `process.emit` when the signal arrives.
- After an uncaught exception that a handler accepts, node runs the event loop once more, so `'beforeExit'` is emitted again and the listeners that the throw skipped run in that second pass. Bun does not: a `'beforeExit'` listener that always throws would repeat without end, as it does in node.
- An uncaught exception from an `'exit'` listener gives exit code 1 where node keeps the code (#44018, #42032).
- After `delete EventEmitter.prototype.<method>` the own keys of the prototype are in the order in which the methods were first read.
- The Windows code of the signal hooks compiles only on Windows. I did not run it.

#### Decisions that a maintainer can change

The defaults are node's behaviour.

1. The cost of the first `process.on()` (see Measurements). To halve it for a program that only adds listeners, split the module in two. To remove it, keep the native emitter and take #41830, which repairs three of the differences.
2. `process._events` is a property that a program can read and assign. Native code reads it with `getDirect()`, so a getter or a Proxy there gives native code no listeners.
3. The signal, IPC and memory-pressure hooks are listeners that a program can remove (item 12).
4. A listener that throws stops the rest for runtime emits too (item 6).
5. `MaxListenersExceededWarning` under `bun test` and `--hot` (item 9).
6. A `--compile --bytecode` executable has the bytecode of `internal/events/prototype` only when the program imports `node:events` or a module that can require it (45 of the 69 built-in JavaScript modules). To embed it in every executable costs 12,288 bytes each and adds a module that is "not run" to every bytecode order recording (two tests of `bun-build-compile.test.ts` assert that there is none). Not done.

#### How it is built

- `src/js/internal/events/prototype.ts` has the 13 methods and their helpers, moved from `src/js/node/events.ts` with no change of behaviour. `events.ts` keeps the constructor and the static functions.
- `NodeEventEmitterPrototype.cpp`: `EventEmitter.prototype` is a `JSNonFinalObject` with a static property table. Each entry is a `PropertyCallback`: the first read of `on` evaluates the module and stores its `addListener`. An entry with a getter or a setter would send every assignment to an emitter through the path that looks for setters, so all 17 entries are plain values.
- `Process` is a `JSDestructibleObject`. Its prototype is a plain object with `constructor`, which inherits from `EventEmitter.prototype`. `Process::create` makes the prototype and the two symbols (`kCapture`, `kShapeMode`) that `events.ts` uses as keys. A program that never touches a method evaluates no module: the first read of `process` needs 36,768 instructions (was 50,852).
- `Process::emit` is the one place where native code emits. It skips the call when the event has no listener and `process.emit` is the `emit` that `EventEmitter.prototype` started with. It finds that with no JavaScript: `process` and its prototype have no own `emit`, and the one of `EventEmitter.prototype` is not yet read or is the function of the module.
- `Process::emitFromRuntime` is `emit` for an event that the runtime starts. What a listener throws is reported as an uncaught exception. A termination (a listener called `process.exit()` in a Worker) is taken there when no script is left to unwind, as a timer callback does (`Bun::takeTerminationOutsideScript`). The deleted emitter cleared every exception of a listener. Left pending, the termination reached the next garbage collection of the worker's event loop, where a debug build of JavaScriptCore asserts. A new test covers it.
- `Process::createStructure` clears the flag that makes an assignment look for a setter in the static table. The generator of the tables (`create_hash_table`) does not write the attribute mask that JavaScriptCore reads for this, and `process.exitCode = 1` worked only because the old native prototype had an accessor. That generator bug is handed off.

#### Measurements

Release builds of the merge base 4b02e1031d and of this branch, linux x64. Instructions of the main thread, counted with single steps (`ptrace`), so they do not depend on the load of the machine.

First use in a new process:

| | base | PR |
| --- | ---: | ---: |
| first read of `process` | 50,852 | 36,768 |
| first `process.on("x", f)` (read and call) | 10,486 | 1,466,055 |
| first `process.emit("x", 1)` | 21,000 | 19,490 |
| first `process.off("x", f)` | 2,791 | 282,108 |
| `on` + `off` of a signal, after that | 6,338 | 24,912 |
| `require("node:events")` | 5,437,043 | 5,362,471 |
| `require("node:events")`, first `on` and `emit` | 6,365,911 | 6,271,241 |
| `require("node:stream")` | 25,154,193 | 25,084,379 |
| `require("node:http")` | 52,879,198 | 52,806,098 |
| whole process, empty script | 3,540,001 | 3,519,988 |
| whole process, `process.on("exit", f)` | 3,672,543 | 5,117,258 |

The 1,466,055 are: 991,137 to evaluate the module, the rest to compile `addListener`, its helper and `emit` (the `'newListener'` listener of item 12 needs `emit`). CPU time of the whole process for `process.on("exit", f)`, median of 300 runs on a loaded machine: 5.85 ms and 6.21 ms. Startup of each VM does not change (`Zig::GlobalObject::finishCreation` 1,017,709 and 1,018,906 instructions, `JSVMClientData::create` 69,535 and 69,283).

`--compile --bytecode`:

| | base | PR |
| --- | ---: | ---: |
| app imports `node:events`: the `require` | 1,504,733 | 1,467,901 |
| first `on`, `emit`, `off` of an emitter | 233,877 | 224,318 |
| 9 other methods, once each | 113,604 | 125,915 |
| app imports nothing: first `process.on` | 10,334 | 1,468,495 |

Steady state, instructions per call, 51 cases for each JIT tier (`BUN_JSC_useConcurrentJIT=0`). A case counts as different when the ranges of 3 runs do not overlap.

| tier | fewer | same | more |
| --- | ---: | ---: | ---: |
| FTL | 18 | 32 | 1 |
| DFG | 13 | 36 | 2 |
| baseline | 22 | 25 | 4 |
| interpreter | 25 | 18 | 8 |

- FTL, more: `on` + `off` with a `'newListener'` listener, 2,325 to 2,331 (+0.3%). Fewer: `process.emit` with one listener 617 to 12, `process.listenerCount` 220 to 11, `once` + `emit` 369 to 297, `setMaxListeners` 148 to 9.
- More in the lower tiers: the cases of `process`, which ran native code before. `process.on` + `off`: DFG 3,097 to 3,140, baseline 3,312 to 5,517, interpreter 4,474 to 11,817. `process.emit` with no listener: DFG 262 to 327, baseline 325 to 631, interpreter 915 to 1,885.
- Interpreter, more, not `process`: `listenerCount(event, fn)` +2.1%, `listeners()` + `rawListeners()` +1.1%, construct a subclass +1.9%.

Size: `.text` 58,161,589 to 58,141,365 bytes (-20,224). `.data` and `.bss` do not change.

The same methods as builtin functions (an earlier version of this branch, 3916caabd7): the first `process.on()` needs 634,535 instructions. But `--compile --bytecode` has no bytecode for builtin functions: in an app that imports `node:events`, the first `on`, `emit`, `off` needs 1,009,461 (base 233,877) and the 9 other methods 732,183 (base 113,604). It also needs a way for builtins to share state, which is a new mechanism.

#### Related pull requests

This PR contains what #41830 (duplicates, `listenerCount(event, fn)`, `errorMonitor`), #41599 (`MaxListenersExceededWarning`) and #32228 (`process.emit` for `'exit'` and `'beforeExit'`) do for the native emitter. It has the 5 lines of #41588 and one line of #42032. It deletes the native emitter that #42575 changes. #36322, #35801 and #35823 change `events.ts` code that this PR moves to `internal/events/prototype.ts`.

#### Tests

- `test/js/node/process/process.test.js`: the block `process is an EventEmitter of node:events` (23 tests).
- `test/js/node/process/process-signal-listener-count.test.ts` (from #41830), `call-constructor.test.js`.
- `test/js/node/events/event-emitter.test.ts`: `errorMonitor` on `process`, the prototype, a method on an object whose `_events` getter throws.
- `test/js/node/worker_threads/worker_threads.test.ts`: an `'exit'` listener that throws in a Worker (2), `process.exit()` in an `'uncaughtException'` listener of a Worker, `postMessageToThread` with `once()`.
- `test/cli/test/bun-test.test.ts`: an `'exit'` listener that throws fails the run.
- `test/js/node/trace_events/trace-events.test.ts`: the trace file with an `'exit'` listener that throws (4).
- Also run on the debug build with `BUN_JSC_validateExceptionChecks=1`: the process, events and trace files.
- Release builds of both commits: 57 test files under `test/js/node/{process,events,worker_threads,child_process,trace_events,quic}`, `test/js/web/workers` and `test/cli/test/bun-test.test.ts` have the same failures, apart from the new tests. 609 of node's own tests (`test-process-*`, `test-events-*`, `test-worker-*`, `test-child-process-*`, `test-signal-*` and more) have the same result on both: 601 pass, 8 fail. That run was before the last two changes (adeb164599). On the debug build of the final code, 293 of node's tests for trace events, QUIC, `process` exit and Worker exit: 288 pass, and the 5 that fail do not run with plain `bun <file>` on main either (they need a flag or `bun test`) or depend on timing.

</details>
