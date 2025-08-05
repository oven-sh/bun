Every day, Bun gets closer to 100% Node.js API compatibility. Today, popular frameworks like Next.js, Express, and millions of `npm` packages intended for Node just work with Bun. To ensure compatibility, we run thousands of tests from Node.js' test suite before every release of Bun.

**If a package works in Node.js but doesn't work in Bun, we consider it a bug in Bun.** Please [open an issue](https://bun.com/issues) and we'll fix it.

This page is updated regularly to reflect compatibility status of the latest version of Bun. The information below reflects Bun's compatibility with _Node.js v23_.

## Built-in Node.js modules

### [`node:assert`](https://nodejs.org/api/assert.html)

🟢 Fully implemented.

### [`node:buffer`](https://nodejs.org/api/buffer.html)

🟢 Fully implemented.

### [`node:console`](https://nodejs.org/api/console.html)

🟢 Fully implemented.

### [`node:dgram`](https://nodejs.org/api/dgram.html)

🟢 Fully implemented. > 90% of Node.js's test suite passes.

### [`node:diagnostics_channel`](https://nodejs.org/api/diagnostics_channel.html)

🟢 Fully implemented.

### [`node:dns`](https://nodejs.org/api/dns.html)

🟢 Fully implemented. > 90% of Node.js's test suite passes.

### [`node:events`](https://nodejs.org/api/events.html)

🟢 Fully implemented. 100% of Node.js's test suite passes. `EventEmitterAsyncResource` uses `AsyncResource` underneath.

### [`node:fs`](https://nodejs.org/api/fs.html)

🟢 Fully implemented. 92% of Node.js's test suite passes.

### [`node:http`](https://nodejs.org/api/http.html)

🟢 Fully implemented. Outgoing client request body is currently buffered instead of streamed.

### [`node:https`](https://nodejs.org/api/https.html)

🟢 APIs are implemented, but `Agent` is not always used yet.

### [`node:os`](https://nodejs.org/api/os.html)

🟢 Fully implemented. 100% of Node.js's test suite passes.

### [`node:path`](https://nodejs.org/api/path.html)

🟢 Fully implemented. 100% of Node.js's test suite passes.

### [`node:punycode`](https://nodejs.org/api/punycode.html)

🟢 Fully implemented. 100% of Node.js's test suite passes, _deprecated by Node.js_.

### [`node:querystring`](https://nodejs.org/api/querystring.html)

🟢 Fully implemented. 100% of Node.js's test suite passes.

### [`node:readline`](https://nodejs.org/api/readline.html)

🟢 Fully implemented.

### [`node:stream`](https://nodejs.org/api/stream.html)

🟢 Fully implemented.

### [`node:string_decoder`](https://nodejs.org/api/string_decoder.html)

🟢 Fully implemented. 100% of Node.js's test suite passes.

### [`node:timers`](https://nodejs.org/api/timers.html)

🟢 Recommended to use global `setTimeout`, et. al. instead.

### [`node:tty`](https://nodejs.org/api/tty.html)

🟢 Fully implemented.

### [`node:url`](https://nodejs.org/api/url.html)

🟢 Fully implemented.

### [`node:zlib`](https://nodejs.org/api/zlib.html)

🟢 Fully implemented. 98% of Node.js's test suite passes.

### [`node:async_hooks`](https://nodejs.org/api/async_hooks.html)

🟡 **AsyncLocalStorage** is fully implemented with comprehensive context propagation. **AsyncResource** and **EventEmitterAsyncResource** have core functionality but lifecycle methods return stubs. **createHook**, **Promise Hooks**, and **Async ID tracking** are not implemented (JSC runtime, not V8). Zero-cost when not in use, optimized for production workloads.

### [`node:child_process`](https://nodejs.org/api/child_process.html)

🟢 **Mostly Complete** - All core child_process functions (spawn, exec, fork, etc.) are fully implemented with comprehensive stdio, environment, and IPC support.

**Minor limitations:**

- Missing `proc.gid`/`proc.uid` properties (validation exists, implementation needed in Bun.spawn)
- `Stream` base class not exported (easy fix - add to exports)
- IPC cannot send socket handles/file descriptors (Node.js advanced feature)
- Cross-runtime IPC (Node.js ↔ Bun) limited to JSON serialization

### [`node:cluster`](https://nodejs.org/api/cluster.html)

🟡 Worker process management, IPC communication, and round-robin load balancing are implemented. Handle/file descriptor passing not implemented (blocks SCHED_NONE scheduling). Direct socket sharing unavailable on all platforms. HTTP load balancing requires SO_REUSEPORT (Linux only) or external load balancer. Works for basic clustering, message passing, process management but not high-performance socket sharing or Windows/macOS HTTP clustering.

### [`node:crypto`](https://nodejs.org/api/crypto.html)

🟡 `secureHeapUsed` returns `undefined` instead of heap stats object. `setFips` lacks input validation. Reduced algorithm support compared to Node.js (10 vs 52 hashes, 28 vs 127 ciphers, 4 vs 82 curves).

### [`node:domain`](https://nodejs.org/api/domain.html)

🟡 Missing `Domain` constructor class and `active` property for domain context tracking. Core domain functionality is implemented.

### [`node:http2`](https://nodejs.org/api/http2.html)

🟡 Client & server are implemented with recent gRPC compatibility improvements. Missing `options.allowHTTP1`, `options.enableConnectProtocol`, and `http2stream.pushStream`. ALTSVC extension is implemented.

### [`node:module`](https://nodejs.org/api/module.html)

🟡 Missing `syncBuiltinESMExports` (stub implementation), `Module#load()`, and `module.register` (stub implementation). Overriding `require.cache` is fully supported for ESM & CJS modules. `module._extensions`, `module._pathCache`, `module._cache` are fully functional (not no-ops). Custom extensions can be registered and work correctly. We recommend using [`Bun.plugin`](https://bun.com/docs/runtime/plugins) instead of `module.register`.

### [`node:net`](https://nodejs.org/api/net.html)

🟢 Fully implemented.

### [`node:perf_hooks`](https://nodejs.org/api/perf_hooks.html)

🟡 Missing `monitorEventLoopDelay` ([#17650](https://github.com/oven-sh/bun/issues/17650)). `createHistogram` is fully implemented with complete statistical analysis capabilities. Note that `perf_hooks.performance` provides Node.js-specific features like `nodeTiming` and `eventLoopUtilization` that are not available on the global `performance` object.

### [`node:process`](https://nodejs.org/api/process.html)

🟡 See [`process`](#process) Global.

### [`node:sys`](https://nodejs.org/api/util.html)

🟡 See [`node:util`](#node-util).

### [`node:tls`](https://nodejs.org/api/tls.html)

🟡 Missing deprecated `tls.createSecurePair()` function. All modern TLS functionality is fully implemented.

### [`node:util`](https://nodejs.org/api/util.html)

🟡 **Minor gaps**: Missing newer functions `getCallSite` `getCallSites` (v22.9.0+), `getSystemErrorMap` (v16.0.0+), `getSystemErrorMessage` (v23.1.0+), `transferableAbortSignal` `transferableAbortController`, internal utilities `_errnoException` `_exceptionWithHostPort`, and `diff`. All core util functions and util/types module are fully implemented with ~98% test pass rate.

### [`node:v8`](https://nodejs.org/api/v8.html)

🟡 `writeHeapSnapshot`, `getHeapSnapshot`, and basic `serialize`/`deserialize` are implemented using JavaScriptCore. Most other V8-specific APIs are not implemented. Use [`bun:jsc`](https://bun.com/docs/project/benchmarking#bunjsc) for profiling instead.

### [`node:vm`](https://nodejs.org/api/vm.html)

🟡 Core functionality and ES modules are implemented, including `vm.Script`, `vm.createContext`, `vm.runInContext`, `vm.runInNewContext`, `vm.runInThisContext`, `vm.compileFunction`, `vm.isContext`, `vm.Module`, `vm.SourceTextModule`, `vm.SyntheticModule`, and `importModuleDynamically` support. Options like `timeout` and `breakOnSigint` are fully supported. Missing `vm.measureMemory` and some `cachedData` functionality.

### [`node:wasi`](https://nodejs.org/api/wasi.html)

🟡 WASI is implemented in JavaScript with basic functionality. Not all WASI specification features are supported yet.

### [`node:worker_threads`](https://nodejs.org/api/worker_threads.html)

🟡 `Worker` doesn't support the following options: `stdin` `stdout` `stderr` `trackedUnmanagedFds` `resourceLimits`. Missing `markAsUntransferable` `moveMessagePortToContext` `getHeapSnapshot`.

### [`node:inspector`](https://nodejs.org/api/inspector.html)

🟡 Basic stub exists. Inspector infrastructure is implemented but Node.js API compatibility layer is not connected yet.

### [`node:repl`](https://nodejs.org/api/repl.html)

🟡 `bun repl` CLI command works but `node:repl` module API is not implemented. Use `bun repl` instead.

### [`node:sqlite`](https://nodejs.org/api/sqlite.html)

🔴 Not implemented. Use [`bun:sqlite`](https://bun.com/docs/api/sqlite) instead.

### [`node:test`](https://nodejs.org/api/test.html)

🟡 Partly implemented. Missing mocks, snapshots, timers. Use [`bun:test`](https://bun.com/docs/cli/test) instead.

### [`node:trace_events`](https://nodejs.org/api/tracing.html)

🟡 Basic stub exists. Extensive internal tracing system implemented but Node.js API compatibility layer is minimal.

## Node.js globals

The table below lists all globals implemented by Node.js and Bun's current compatibility status.

### [`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)

🟢 Fully implemented.

### [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)

🟢 Fully implemented.

### [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob)

🟢 Fully implemented.

### [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer)

🟢 Fully implemented.

### [`ByteLengthQueuingStrategy`](https://developer.mozilla.org/en-US/docs/Web/API/ByteLengthQueuingStrategy)

🟢 Fully implemented.

### [`__dirname`](https://nodejs.org/api/globals.html#__dirname)

🟢 Fully implemented.

### [`__filename`](https://nodejs.org/api/globals.html#__filename)

🟢 Fully implemented.

### [`atob()`](https://developer.mozilla.org/en-US/docs/Web/API/atob)

🟢 Fully implemented.

### [`Atomics`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics)

🟢 Fully implemented.

### [`BroadcastChannel`](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)

🟢 Fully implemented.

### [`btoa()`](https://developer.mozilla.org/en-US/docs/Web/API/btoa)

🟢 Fully implemented.

### [`clearImmediate()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/clearImmediate)

🟢 Fully implemented.

### [`clearInterval()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/clearInterval)

🟢 Fully implemented.

### [`clearTimeout()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/clearTimeout)

🟢 Fully implemented.

### [`CompressionStream`](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream)

🔴 Not implemented.

### [`console`](https://developer.mozilla.org/en-US/docs/Web/API/console)

🟢 Fully implemented.

### [`CountQueuingStrategy`](https://developer.mozilla.org/en-US/docs/Web/API/CountQueuingStrategy)

🟢 Fully implemented.

### [`Crypto`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto)

🟢 Fully implemented.

### [`SubtleCrypto (crypto)`](https://developer.mozilla.org/en-US/docs/Web/API/crypto)

🟢 Fully implemented.

### [`CryptoKey`](https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey)

🟢 Fully implemented.

### [`CustomEvent`](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent)

🟢 Fully implemented.

### [`DecompressionStream`](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream)

🔴 Not implemented.

### [`Event`](https://developer.mozilla.org/en-US/docs/Web/API/Event)

🟢 Fully implemented.

### [`EventTarget`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget)

🟢 Fully implemented.

### [`exports`](https://nodejs.org/api/globals.html#exports)

🟢 Fully implemented.

### [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/fetch)

🟢 Fully implemented.

### [`FormData`](https://developer.mozilla.org/en-US/docs/Web/API/FormData)

🟢 Fully implemented.

### [`global`](https://nodejs.org/api/globals.html#global)

🟢 Implemented. This is an object containing all objects in the global namespace. It's rarely referenced directly, as its contents are available without an additional prefix, e.g. `__dirname` instead of `global.__dirname`.

### [`globalThis`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/globalThis)

🟢 Aliases to `global`.

### [`Headers`](https://developer.mozilla.org/en-US/docs/Web/API/Headers)

🟢 Fully implemented.

### [`MessageChannel`](https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel)

🟢 Fully implemented.

### [`MessageEvent`](https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent)

🟢 Fully implemented.

### [`MessagePort`](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort)

🟢 Fully implemented.

### [`module`](https://nodejs.org/api/globals.html#module)

🟢 Fully implemented.

### [`PerformanceEntry`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEntry)

🟢 Fully implemented.

### [`PerformanceMark`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceMark)

🟢 Fully implemented.

### [`PerformanceMeasure`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceMeasure)

🟢 Fully implemented.

### [`PerformanceObserver`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver)

🟢 Fully implemented.

### [`PerformanceObserverEntryList`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserverEntryList)

🟢 Fully implemented.

### [`PerformanceResourceTiming`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming)

🟢 Fully implemented.

### [`performance`](https://developer.mozilla.org/en-US/docs/Web/API/performance)

🟢 Fully implemented.

### [`process`](https://nodejs.org/api/process.html)

🟡 Mostly implemented. `process.binding` (internal Node.js bindings some packages rely on) is partially implemented. `process.title` is currently a no-op on macOS & Linux. `getActiveResourcesInfo` `setActiveResourcesInfo`, `getActiveResources` and `setSourceMapsEnabled` are stubs. Newer APIs like `process.loadEnvFile` and `process.getBuiltinModule` are not implemented yet.

### [`queueMicrotask()`](https://developer.mozilla.org/en-US/docs/Web/API/queueMicrotask)

🟢 Fully implemented.

### [`ReadableByteStreamController`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableByteStreamController)

🟢 Fully implemented.

### [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)

🟢 Fully implemented.

### [`ReadableStreamBYOBReader`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamBYOBReader)

🟢 Fully implemented.

### [`ReadableStreamBYOBRequest`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamBYOBRequest)

🟢 Fully implemented.

### [`ReadableStreamDefaultController`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamDefaultController)

🟢 Fully implemented.

### [`ReadableStreamDefaultReader`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamDefaultReader)

🟢 Fully implemented.

### [`require()`](https://nodejs.org/api/globals.html#require)

🟢 Fully implemented, including [`require.main`](https://nodejs.org/api/modules.html#requiremain), [`require.cache`](https://nodejs.org/api/modules.html#requirecache), [`require.resolve`](https://nodejs.org/api/modules.html#requireresolverequest-options).

### [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response)

🟢 Fully implemented.

### [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request)

🟢 Fully implemented.

### [`setImmediate()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/setImmediate)

🟢 Fully implemented.

### [`setInterval()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/setInterval)

🟢 Fully implemented.

### [`setTimeout()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout)

🟢 Fully implemented.

### [`structuredClone()`](https://developer.mozilla.org/en-US/docs/Web/API/structuredClone)

🟢 Fully implemented.

### [`SubtleCrypto`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)

🟢 Fully implemented.

### [`DOMException`](https://developer.mozilla.org/en-US/docs/Web/API/DOMException)

🟢 Fully implemented.

### [`TextDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder)

🟢 Fully implemented.

### [`TextDecoderStream`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoderStream)

🟢 Fully implemented.

### [`TextEncoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder)

🟢 Fully implemented.

### [`TextEncoderStream`](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoderStream)

🟢 Fully implemented.

### [`TransformStream`](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream)

🟢 Fully implemented.

### [`TransformStreamDefaultController`](https://developer.mozilla.org/en-US/docs/Web/API/TransformStreamDefaultController)

🟢 Fully implemented.

### [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL)

🟢 Fully implemented.

### [`URLSearchParams`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams)

🟢 Fully implemented.

### [`WebAssembly`](https://nodejs.org/api/globals.html#webassembly)

🟢 Fully implemented.

### [`WritableStream`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream)

🟢 Fully implemented.

### [`WritableStreamDefaultController`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStreamDefaultController)

🟢 Fully implemented.

### [`WritableStreamDefaultWriter`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStreamDefaultWriter)

🟢 Fully implemented.
