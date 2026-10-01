### Problem
- `process` has its own native emitter (`src/jsc/bindings/webcore/EventEmitter.cpp`), which differs from `node:events`. `process.on(ev, h)` twice registers `h` once. `process.emit('error', e)` with no listener does not throw.
- The methods of `node:events` are closures of a module, so `process` cannot use them before that module is evaluated.

### Fix
- The methods are now builtins (`src/js/builtins/EventEmitterPrototype.ts`). `EventEmitter.prototype` is a native object (`NodeEventEmitterPrototype.cpp`) that creates a method at its first read.
- `process` inherits from it, with its listeners in its own `_events`. The signal, IPC and memory-pressure hooks are `'newListener'` and `'removeListener'` listeners, as in node.
- Native code emits with the same `emit`. The native emitter is deleted (1,397 lines).
- Verified: `process.test.js`, `event-emitter.test.ts` and two more files (42 new tests, 29 fail before). Also 653 of node's own tests.

### Background
- A builtin is a function whose source is in the binary. JavaScriptCore compiles it at its first call.
- Node installs a signal handler from a `'newListener'` listener of `process`. A program can remove it.
- Considered: repair the native emitter case by case, as #41830 does for three cases. Then two emitters stay.

### Downsides
- Behaviour: a listener that throws stops the listeners after it. After `process.removeAllListeners()` a new signal listener has no signal handler. Node does both. Notes lists 17 changes.
- The first `process.on()` in a program that used no EventEmitter needs 634,535 instructions (was 10,497): JavaScriptCore compiles `addListener` and `emit`.
- Each process: +7,817 instructions at startup (+0.23%). The first read of `process`: 37,792 (was 50,516).

<details><summary>Notes</summary>

#### What changes for a program

Each item is what node v26.3.0 does. Each was run side by side with node.

Listeners of `process`:

1. One function that is added twice runs twice (`on` + `on`, `once` + `on`, `on` + `prependListener`). `removeListener()` removes one registration. A signal keeps its handler until the last registration is gone.
2. `process.listenerCount(event, fn)` counts only `fn`.
3. `events.errorMonitor` listeners run before the `'error'` listeners.
4. `process.emit('error', err)` with no listener throws `err` to the caller. Before: an uncaught exception, and `emit()` returned.
5. What a listener throws out of `process.emit()` reaches the caller, and the listeners after it do not run. Before: an uncaught exception, and the other listeners ran.
6. For an event that the runtime emits (a signal, `'exit'`, `'beforeExit'`, `'message'`, `'disconnect'`, `'uncaughtException'`, `'unhandledRejection'`, `'warning'`), what a listener throws is an uncaught exception as before. New: the listeners after it do not run.
7. What an `'exit'` listener throws reaches the caller of `process.exit()`.
8. `'removeListener'` is emitted. `rawListeners()` returns the wrapper of a `once()` listener.
9. More than 10 listeners of one event give a `MaxListenersExceededWarning`. `process.getMaxListeners()` is 10 (was 4294967295). `setMaxListeners()` validates its argument and returns `process`. `once(event, null)` throws.

The shape of `process`:

10. `process.on === EventEmitter.prototype.on`, and the same for the other 14 methods. `process.on === process.addListener`. A method that is borrowed from `EventEmitter.prototype` and `events.getEventListeners(process, …)` use the listeners of `process`.
11. `process._events`, `process._eventsCount` and `process._maxListeners` are own properties, and `Object.keys(process)` has them.
12. On the main thread `process.eventNames()` starts with `newListener`, `removeListener` and `warning`. The first two are the functions `startListeningIfSignal` and `stopListeningIfSignal`. `process.removeAllListeners()` removes them. A signal listener that is added after that has no signal handler, and a `'message'` listener does not keep the IPC channel alive.
13. `on()` and `off()` emit `'newListener'` and `'removeListener'` with the current `process.emit`. A program that replaces `process.emit` sees these two events. A `once()` listener needs a callable `process.emit` to remove itself: `test/js/node/worker_threads/emit-non-function-fixture.js` used `once()` with `process.emit = 5`, and now uses `on()`.
14. `process.constructor` is a function with the name `process`. A call returns the object that it was called on. The prototype of `process` has one own key, `constructor`.
15. `worker_threads.postMessageToThread()` delivers with `process.emit('workerMessage')`: a `once()` listener gets one message.

`node:events`:

16. `String(EventEmitter.prototype.on)` prints `function addListener() { [native code] }`. The stack frame of a method reads `native:LINE:COL`. A `TypeError` that JavaScriptCore creates for a missing receiver has no `(evaluating '…')` text.
17. After `delete EventEmitter.prototype.<method>` the own keys of the prototype are in the order in which the methods were first read.

#### What stays different from node

- The runtime emits with the `emit` of `EventEmitter.prototype`, not with a `process.emit` that a program assigned (#12918, #32228).
- An uncaught exception from an `'exit'` listener inside `process.exit(3)` gives exit code 1. Node gives 3.
- After an uncaught exception that a handler accepts, node runs the event loop once more, so `'beforeExit'` or `'exit'` is emitted again. Bun does not.
- The Windows code of the signal hooks compiles only on Windows. I did not run it.

#### Decisions that a maintainer can change

The defaults are node's behaviour.

1. `process._events` is a property that a program can read and assign. Native code reads it with `getDirect()`, so a getter or a Proxy there gives native code no listeners.
2. The signal, IPC and memory-pressure hooks are listeners that a program can remove (item 12).
3. A listener that throws stops the rest for runtime emits too (item 6).
4. A runtime emit through a replaced `process.emit` is not in this PR.

#### How it is built

- `src/js/builtins/EventEmitterPrototype.ts` has the 15 methods and 6 functions that they call. The methods read `$nodeEvents…` variables of the global object: `defaultMaxListeners`, two symbols and the 6 functions. `Zig::GlobalObject::addBuiltinGlobal()` defines such a variable with `JSGlobalObject::addStaticGlobals()`. The JIT folds a constant one. The same value as an own property of the global object costs more: `emit('error')` with a listener needs 15% more instructions in the FTL.
- `emit` has a rest parameter. A builtin begins with `"use strict"`, which such a function cannot contain, so the builtin `createEmit` returns `emit`. An `emit` without a rest parameter, which reads `arguments`, needs 3 to 15 times the instructions in the FTL for more than three arguments and for `'error'`.
- `EventEmitter.prototype` is an object with a static property table (`NodeEventEmitterPrototype.cpp`). JavaScriptCore creates a property of such a table when it is first read. Every entry is a plain value. `on` and `addListener` are one function: the first read of one name defines both.
- `Process::createStructure()` sets the flag that says that the structure has accessors. Without it `process.exitCode = 1` throws `TypeError: Attempted to assign to readonly property.` JavaScriptCore takes that flag from the generated table (`HashTable::seenPropertyAttributes`), and `src/codegen/create_hash_table` writes `true` or `false` there. Before this PR the flag came from an accessor on the native prototype. The same happens on main after `Object.setPrototypeOf(process, {})`. The repair of the generator is a separate change.

#### Measurements

Release builds of the merge base (bf42a525d5) and of this PR, Linux x64. `perf`, `valgrind` and `strace` are not available on the machine: `perf_event_open` is denied and there is no package source. Small ptrace programs count the instructions of the main thread with single steps: between two calls of `Bun.nanoseconds()`, or inside one native function.

Size (`size`): `.text` 80,677,149 to 80,676,704 (-445 bytes), `.data` 110,424 to 110,872 (+448 bytes). Native host functions: 13 removed, 4 added. Builtin functions: 19 added. Builtin names: 10 added.

Startup of every process:

| function | base | PR |
|---|---|---|
| `BunBuiltinNames::BunBuiltinNames` | 64,590 | 68,575 |
| `JSBuiltinFunctions::JSBuiltinFunctions` | 635 | 859 |
| `JSVMClientData::create` (has the two above) | 69,467 | 72,144 |
| `Zig::GlobalObject::finishCreation` | 1,018,880 | 1,024,020 |

`JSVMClientData::create` and `Zig::GlobalObject::finishCreation` together: +7,817 instructions. A program with an empty file runs 3,424,000 instructions on the main thread (+0.23%).

The first use in a process (instructions, one run, the variation between runs is under 100):

| step | base | PR |
|---|---|---|
| first read of `process` | 50,516 | 37,792 |
| first read of `process.on` | 1,014 | 42,355 |
| first `process.on("x", f)` | 9,483 | 592,180 |
| first `process.emit("x", 1)` | 21,084 | 19,516 |
| first `process.off("x", f)` | 2,863 | 288,141 |
| `on()` and `off()` of a signal | 6,456 | 24,739 |
| `on()`, `emit()`, `off()` again | 7,043 | 20,195 |

The first `on()` compiles `addListener` and its helper (238,000), and `emit` for the `'newListener'` listener (122,000 for `createEmit`, 248,000 for `emit`). A program that already used an EventEmitter paid for that there: the functions are the same, and the base compiles its own closures at that point (757,000 for the first `on()`, `emit()` and `off()` of a plain emitter, 854,000 with this PR).

The whole program, main thread, from `exec` to exit:

| program | base | PR |
|---|---|---|
| `process.on("SIGINT", () => {})` | 3,566,674 | 4,182,069 |
| `require("node:events")`, one `on()` and `emit()`, then `process.on("SIGINT", f)` | 10,097,866 | 9,105,375 |

One run each. Two runs of one binary differ by up to 25,000.

Wall clock cannot resolve these differences on the shared machine. 400 interleaved runs of each program, median in µs, for the base, a copy of the base binary, and the PR:

| program | base | base copy | PR |
|---|---|---|---|
| empty file | 4,615 | 4,650 | 4,843 |
| `process.argv.length` | 4,517 | 4,566 | 4,802 |
| `process.on("SIGINT", () => {})` | 5,568 | 5,949 | 5,650 |
| the `require("node:events")` program above | 7,303 | 7,902 | 7,206 |

The first use in a new process, between two markers (median of 5 processes):

| body | base | PR | change |
|---|---|---|---|
| empty (what the measurement costs) | 19,311 | 20,471 | +1,160 |
| `require("node:events")` | 5,435,899 | 4,386,456 | -19.3% |
| the same, then `on()`, `emit()`, `off()` | 6,366,043 | 5,416,719 | -14.9% |
| the same, then every method once | 7,515,174 | 6,677,304 | -11.1% |
| `require("node:stream")` | 25,144,315 | 24,108,775 | -4.1% |
| `require("node:http")` | 52,875,583 | 51,814,416 | -2.0% |
| `process.on("SIGINT", f)` then `off()`, no emitter before | 77,171 | 958,861 | +881,690 |
| `process.on("x", f)`, `emit()`, `off()`, no emitter before | 99,706 | 989,483 | +889,777 |

The module has less source to parse, and it creates no method.

Hot cases: the body runs in a loop, and the result is the difference of two loop lengths divided by the difference of the iteration counts, the median of 5. The concurrent JIT is off for the three JIT tiers. A change under 0.5% counts as the same.

| tier | same | fewer | more |
|---|---|---|---|
| FTL | 24 | 24 | 3 |
| DFG | 25 | 24 | 2 |
| baseline JIT | 21 | 21 | 9 |
| LLInt | 24 | 19 | 8 |

11 of the 22 rises are the five `process` cases outside the FTL: the native methods needed no compilation, and the interpreter and the baseline JIT run the builtins slower than C++. The largest is `process.on()` then `off()` in the interpreter: 4,472 to 11,825. In the FTL the same pair needs 2,724 (was 3,212), and `process.emit()` to one listener 12 (was 617).

The other 11 rises are under 1%, except `emit('error')` with a listener in the baseline JIT (+3.2%) and `new EventEmitter()` in the interpreter (+3.8% and +2.8%). The interpreter does not cache a lookup that misses on an object with a static table.

The last column is the same measurement with the base binary on both sides. It shows what the method cannot resolve.

All hot cases, instructions per iteration, base → PR:

| case | FTL | DFG | baseline JIT | LLInt | FTL, base binary twice |
|---|---|---|---|---|---|
| `emit_0l_0a` | 11.9 → 11.9 (+0.0%) | 303.7 → 304.2 (+0.2%) | 469.8 → 471.6 (+0.4%) | 1319.1 → 1322.1 (+0.2%) | +0.0% |
| `emit_0l_1a` | 11.9 → 11.8 (-0.7%) | 310.0 → 309.9 (-0.0%) | 506.8 → 509.7 (+0.6%) | 1375.1 → 1378.1 (+0.2%) | +0.0% |
| `emit_0l_3a` | 11.9 → 11.9 (+0.0%) | 197.6 → 197.4 (-0.1%) | 562.9 → 565.6 (+0.5%) | 1450.5 → 1453.1 (+0.2%) | +0.9% |
| `emit_0l_5a` | 11.9 → 11.9 (+0.0%) | 220.7 → 220.9 (+0.1%) | 649.6 → 653.6 (+0.6%) | 1550.1 → 1553.0 (+0.2%) | -1.8% |
| `emit_1l_0a` | 17.9 → 17.9 (+0.0%) | 320.6 → 320.4 (-0.1%) | 775.5 → 778.3 (+0.4%) | 1927.1 → 1930.1 (+0.2%) | -0.5% |
| `emit_1l_1a` | 20.0 → 19.9 (-0.5%) | 341.7 → 342.1 (+0.1%) | 845.5 → 848.9 (+0.4%) | 2045.1 → 2048.2 (+0.1%) | +0.5% |
| `emit_1l_3a` | 19.8 → 17.8 (-10.1%) | 250.1 → 250.4 (+0.1%) | 972.6 → 975.9 (+0.3%) | 2278.1 → 2281.1 (+0.1%) | +0.0% |
| `emit_1l_5a` | 20.9 → 20.9 (+0.0%) | 516.1 → 515.9 (-0.0%) | 1288.3 → 1291.5 (+0.2%) | 2716.1 → 2718.7 (+0.1%) | +0.0% |
| `emit_3l_0a` | 78.9 → 78.9 (-0.0%) | 613.6 → 613.6 (-0.0%) | 1305.7 → 1309.7 (+0.3%) | 3371.1 → 3373.7 (+0.1%) | +0.0% |
| `emit_3l_1a` | 78.8 → 79.0 (+0.3%) | 671.2 → 670.9 (-0.0%) | 1430.9 → 1433.9 (+0.2%) | 3613.2 → 3615.7 (+0.1%) | +0.0% |
| `emit_3l_3a` | 78.9 → 78.9 (+0.0%) | 630.6 → 630.4 (-0.0%) | 1701.6 → 1704.9 (+0.2%) | 4162.1 → 4165.1 (+0.1%) | +0.0% |
| `emit_3l_5a` | 324.9 → 324.9 (+0.0%) | 1470.3 → 1470.2 (-0.0%) | 2482.6 → 2485.4 (+0.1%) | 5276.1 → 5279.1 (+0.1%) | -0.0% |
| `emit_noevents` | 11.8 → 11.9 (+0.9%) | 309.8 → 310.0 (+0.1%) | 508.0 → 510.9 (+0.6%) | 1375.2 → 1378.2 (+0.2%) | +0.0% |
| `emit_error_handled` | 25.9 → 25.9 (+0.0%) | 663.8 → 663.7 (-0.0%) | 1161.7 → 1198.7 (+3.2%) | 3012.1 → 3026.5 (+0.5%) | +0.4% |
| `emit_shape_1l_1a` | 11.9 → 11.9 (+0.0%) | 327.8 → 328.1 (+0.1%) | 787.9 → 790.5 (+0.3%) | 1871.2 → 1874.2 (+0.2%) | +0.9% |
| `emit_capture_1l_1a` | 11.9 → 11.9 (+0.0%) | 326.9 → 327.2 (+0.1%) | 792.8 → 792.7 (-0.0%) | 1914.2 → 1914.2 (+0.0%) | +0.0% |
| `emit_capture_3l_1a` | 69.9 → 69.9 (+0.0%) | 678.3 → 678.6 (+0.0%) | 1392.9 → 1393.3 (+0.0%) | 3672.2 → 3672.1 (-0.0%) | +0.0% |
| `emit_capture_promise` | 227.7 → 229.4 (+0.7%) | 496.0 → 495.9 (-0.0%) | 1372.4 → 1369.7 (-0.2%) | 2968.2 → 2968.2 (+0.0%) | -1.3% |
| `emit_names256` | 149.7 → 149.6 (-0.1%) | 390.3 → 390.0 (-0.1%) | 876.6 → 877.2 (+0.1%) | 2009.0 → 2011.7 (+0.1%) | -0.4% |
| `on_off` | 104.5 → 100.7 (-3.6%) | 367.4 → 342.2 (-6.9%) | 1458.0 → 1225.4 (-16.0%) | 5204.5 → 4242.5 (-18.5%) | -0.3% |
| `on_off_other` | 1745.3 → 1757.2 (+0.7%) | 1807.2 → 1782.2 (-1.4%) | 2832.1 → 2639.5 (-6.8%) | 5693.8 → 4731.8 (-16.9%) | +0.0% |
| `on_off_second` | 346.4 → 343.5 (-0.9%) | 666.2 → 638.4 (-4.2%) | 2346.8 → 2057.4 (-12.3%) | 7236.8 → 6061.8 (-16.2%) | +0.0% |
| `on_off_names256` | 5116.4 → 5115.8 (-0.0%) | 5125.1 → 5097.9 (-0.5%) | 6016.5 → 5802.7 (-3.6%) | 5830.7 → 4868.3 (-16.5%) | +0.0% |
| `on_off_newlistener` | 2326.9 → 2322.9 (-0.2%) | 2740.4 → 2714.9 (-0.9%) | 5014.3 → 4787.2 (-4.5%) | 10887.0 → 9931.0 (-8.8%) | +0.7% |
| `once_emit` | 370.8 → 299.7 (-19.2%) | 1275.5 → 1236.4 (-3.1%) | 4022.3 → 3684.7 (-8.4%) | 11538.8 → 10099.8 (-12.5%) | +0.0% |
| `once_emit_second` | 660.9 → 595.0 (-10.0%) | 1760.4 → 1720.3 (-2.3%) | 5240.2 → 4839.4 (-7.6%) | 14515.5 → 12863.5 (-11.4%) | +0.1% |
| `prepend_once_emit` | 675.3 → 609.1 (-9.8%) | 1796.2 → 1756.2 (-2.2%) | 5363.4 → 4954.0 (-7.6%) | 15223.5 → 13556.9 (-10.9%) | +0.0% |
| `remove_mid3` | 596.9 → 596.8 (-0.0%) | 1497.7 → 1441.6 (-3.7%) | 5610.0 → 5058.8 (-9.8%) | 18818.5 → 16482.5 (-12.4%) | +0.1% |
| `prepend_remove` | 313.0 → 313.2 (+0.1%) | 786.9 → 758.8 (-3.6%) | 2939.8 → 2663.3 (-9.4%) | 10157.7 → 8987.2 (-11.5%) | +0.0% |
| `add_10` | 2235.0 → 2235.0 (+0.0%) | 4965.0 → 4802.3 (-3.3%) | 16862.5 → 15411.5 (-8.6%) | 56931.5 → 50466.5 (-11.4%) | +0.0% |
| `listener_count` | 10.9 → 10.9 (+0.0%) | 124.8 → 124.9 (+0.1%) | 393.9 → 393.6 (-0.1%) | 1067.1 → 1067.1 (+0.0%) | +0.0% |
| `listener_count_fn` | 54.9 → 54.9 (+0.0%) | 218.9 → 218.9 (+0.0%) | 676.9 → 677.9 (+0.1%) | 2729.1 → 2729.1 (+0.0%) | -0.0% |
| `event_names` | 23.0 → 22.9 (-0.5%) | 52.0 → 51.9 (-0.2%) | 388.9 → 389.9 (+0.3%) | 990.0 → 990.1 (+0.0%) | +0.0% |
| `listeners_raw` | 155.2 → 153.4 (-1.2%) | 566.2 → 566.0 (-0.0%) | 2560.6 → 2557.8 (-0.1%) | 6890.7 → 6890.7 (+0.0%) | +0.1% |
| `get_max_default` | 11.9 → 9.7 (-18.9%) | 24.9 → 22.9 (-8.0%) | 265.9 → 202.9 (-23.7%) | 923.1 → 631.1 (-31.6%) | +0.0% |
| `get_max_instance` | 10.9 → 8.8 (-19.6%) | 27.9 → 24.8 (-11.1%) | 259.9 → 191.9 (-26.2%) | 868.1 → 584.1 (-32.7%) | +0.0% |
| `set_max` | 147.7 → 8.8 (-94.0%) | 157.9 → 72.8 (-53.9%) | 296.4 → 169.9 (-42.7%) | 708.1 → 516.7 (-27.0%) | +0.0% |
| `remove_all` | 187.5 → 185.2 (-1.2%) | 1057.9 → 1018.9 (-3.7%) | 3943.7 → 3565.4 (-9.6%) | 17881.1 → 16368.9 (-8.5%) | -4.0% |
| `construct` | 73.7 → 73.3 (-0.6%) | 176.4 → 175.3 (-0.6%) | 897.2 → 877.5 (-2.2%) | 4794.1 → 4978.4 (+3.8%) | +0.5% |
| `construct_subclass` | 100.9 → 91.7 (-9.1%) | 200.5 → 196.6 (-2.0%) | 1064.9 → 1064.6 (-0.0%) | 5380.3 → 5532.6 (+2.8%) | +0.2% |
| `shape_life` | 1085.0 → 1013.0 (-6.6%) | 8130.0 → 8046.0 (-1.0%) | 20515.3 → 19741.0 (-3.8%) | 69492.0 → 66465.5 (-4.4%) | +1.5% |
| `plain_receiver` | 485.6 → 485.8 (+0.0%) | 1050.3 → 1013.2 (-3.5%) | 2845.7 → 2593.5 (-8.9%) | 8977.9 → 8140.0 (-9.3%) | +2.0% |
| `bench_single_emit` | 32.1 → 32.1 (+0.0%) | 373.8 → 373.9 (+0.0%) | 1015.7 → 1019.1 (+0.3%) | 2429.5 → 2432.2 (+0.1%) | +0.3% |
| `bench_once_test1` | 756.6 → 691.0 (-8.7%) | 1864.6 → 1824.3 (-2.2%) | 5727.6 → 5324.1 (-7.0%) | 15442.5 → 13762.3 (-10.9%) | -0.1% |
| `bench_once_test2` | 410.5 → 336.5 (-18.0%) | 1347.4 → 1311.6 (-2.7%) | 4355.6 → 4016.7 (-7.8%) | 12256.5 → 10818.2 (-11.7%) | +0.1% |
| `bench_stream_simulation` | 87802.0 → 87704.0 (-0.1%) | 508394.0 → 510619.0 (+0.4%) | 984207.0 → 986924.0 (+0.3%) | 2436807.0 → 2439060.0 (+0.1%) | +0.0% |
| `process_on_off` | 3212.0 → 2723.8 (-15.2%) | 3097.8 → 3137.2 (+1.3%) | 3311.7 → 5564.7 (+68.0%) | 4471.5 → 11825.2 (+164.5%) | +0.0% |
| `process_emit_0l` | 257.9 → 11.9 (-95.4%) | 262.0 → 322.8 (+23.2%) | 324.9 → 638.1 (+96.4%) | 914.7 → 1900.0 (+107.7%) | +0.0% |
| `process_emit_1l` | 616.9 → 11.8 (-98.1%) | 641.8 → 340.9 (-46.9%) | 759.9 → 917.9 (+20.8%) | 1523.0 → 2396.1 (+57.3%) | +0.0% |
| `process_emit_3l` | 1263.2 → 69.9 (-94.5%) | 1326.1 → 665.9 (-49.8%) | 1565.1 → 1503.1 (-4.0%) | 2706.5 → 3964.2 (+46.5%) | +0.0% |
| `process_listener_count` | 220.4 → 10.9 (-95.0%) | 232.9 → 136.9 (-41.2%) | 326.9 → 521.6 (+59.6%) | 1012.1 → 1654.1 (+63.4%) | +0.0% |


#### Tests

- 42 new tests: 16 in `process.test.js`, 8 in `process-signal-listener-count.test.ts`, 17 in `event-emitter.test.ts`, 1 in `worker_threads.test.ts`. 29 of them fail with the base, and so does the changed test of `call-constructor.test.js`. The other 13 pin what must not change: the own keys of `EventEmitter.prototype`, their order and attributes, the `name` and `length` of each method, and the validation errors.
- `bun bd test` of `event-emitter.test.ts`, `process.test.js`, `process-signal-listener-count.test.ts`, `call-constructor.test.js`, `worker_threads.test.ts`: 461 pass, 5 skip. `process-on.test.ts`: pass.
- Node's tests with the debug build, one process each: `test-process-*`, `test-signal-*`, `test-event-emitter-*`, `test-events-*`, `test-worker-message*`, `test-cluster-*`, `test-domain-*`, `test-unhandled*`, `test-promise-unhandled*`, `test-warn*`, `test-repl-*`, `test-stdout-*`, `test-stdin-*`, `test-child-process-*`, `test-stream-*`: 653 pass. 13 fail, and fail the same way with the base: 11 need `bun test`, 2 fail only in a debug build.
- `test/js/node/{process,events,child_process,cluster,worker_threads,readline}`, `test/js/web/workers` and `test/js/bun/spawn` with release builds of the base and of this PR: the same tests fail with both, except those 30. One timing test is not settled: `spawn.test.ts`, `kill and unref`, 100 spawns in 5 s. It failed in 2 of 3 runs with the PR binary and in 0 of 2 with the base, on a machine with a load average over 400. In 12 alternating runs of that test alone the times were 631 to 5,284 ms for the base and 738 to 10,490 ms for the PR. The test does not use `process`, and its loop runs the same number of instructions with both binaries (7.11M and 7.22M for 20 iterations, where two runs of one binary differ by 160,000).
- `BUN_JSC_validateExceptionChecks=1` on the five test files above: pass.
- `bun x tsc --noEmit -p src/js/tsconfig.json`, `bun lint`, `bun test test/internal/source-lints/`: pass.

#### Related

- #41830 repairs items 1 to 3 inside the native emitter. Its tests are in this PR. It is not needed if this PR merges.
- #41599 adds the `MaxListenersExceededWarning` to the native emitter (item 9).
- #32228 and #12918: a runtime emit through a replaced `process.emit`.
- Differential fuzz ledger entries 29451 (canonical 12251), 29452 and 29453.

</details>
