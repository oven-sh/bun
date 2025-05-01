Every day, Bun gets closer to 100% Node.js API compatibility. Today, popular frameworks like Next.js, Express, and millions of `npm` packages intended for Node just work with Bun. To ensure compatibility, we run thousands of tests from Node.js' test suite before every release of Bun.

**If a package works in Node.js but doesn't work in Bun, we consider it a bug in Bun.** Please [open an issue](https://bun.sh/issues) and we'll fix it.

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

🟡 `AsyncLocalStorage`, and `AsyncResource` are implemented. v8 promise hooks are not called, and its usage is [strongly discouraged](https://nodejs.org/docs/latest/api/async_hooks.html#async-hooks).

### [`node:child_process`](https://nodejs.org/api/child_process.html)

🟡 Missing `proc.gid` `proc.uid`. `Stream` class not exported. IPC cannot send socket handles. Node.js <> Bun IPC can be used with JSON serialization.

### [`node:cluster`](https://nodejs.org/api/cluster.html)

🟡 Handles and file descriptors cannot be passed between workers, which means load-balancing HTTP requests across processes is only supported on Linux at this time (via `SO_REUSEPORT`). Otherwise, implemented but not battle-tested.

### [`node:crypto`](https://nodejs.org/api/crypto.html)

🟡 Missing `secureHeapUsed` `setEngine` `setFips`

### [`node:domain`](https://nodejs.org/api/domain.html)

🟡 Missing `Domain` `active`

### [`node:http2`](https://nodejs.org/api/http2.html)

🟡 Client & server are implemented (95.25% of gRPC's test suite passes). Missing `options.allowHTTP1`, `options.enableConnectProtocol`, ALTSVC extension, and `http2stream.pushStream`.

### [`node:module`](https://nodejs.org/api/module.html)

🟡 Missing `syncBuiltinESMExports`, `Module#load()`. Overriding `require.cache` is supported for ESM & CJS modules. `module._extensions`, `module._pathCache`, `module._cache` are no-ops. `module.register` is not implemented and we recommend using a [`Bun.plugin`](https://bun.sh/docs/runtime/plugins) in the meantime.

### [`node:net`](https://nodejs.org/api/net.html)

🟢 Fully implemented.

### [`node:perf_hooks`](https://nodejs.org/api/perf_hooks.html)

🟡 Missing `createHistogram` `monitorEventLoopDelay`. It's recommended to use `performance` global instead of `perf_hooks.performance`.

### [`node:process`](https://nodejs.org/api/process.html)

🟡 See [`process`](#process) Global.

### [`node:sys`](https://nodejs.org/api/util.html)

🟡 See [`node:util`](#node-util).

### [`node:tls`](https://nodejs.org/api/tls.html)

🟡 Missing `tls.createSecurePair`.

### [`node:util`](https://nodejs.org/api/util.html)

🟡 Missing `getCallSite` `getCallSites` `getSystemErrorMap` `getSystemErrorMessage` `transferableAbortSignal` `transferableAbortController`

### [`node:v8`](https://nodejs.org/api/v8.html)

🟡 `writeHeapSnapshot` and `getHeapSnapshot` are implemented. `serialize` and `deserialize` use JavaScriptCore's wire format instead of V8's. Other methods are not implemented. For profiling, use [`bun:jsc`](https://bun.sh/docs/project/benchmarking#bunjsc) instead.

### [`node:vm`](https://nodejs.org/api/vm.html)

🟡 Core functionality works, but experimental VM ES modules are not implemented, including `vm.Module`, `vm.SourceTextModule`, `vm.SyntheticModule`,`importModuleDynamically`, and `vm.measureMemory`. Options like `timeout`, `breakOnSigint`, `cachedData` are not implemented yet.

### [`node:wasi`](https://nodejs.org/api/wasi.html)

🟡 Partially implemented.

### [`node:worker_threads`](https://nodejs.org/api/worker_threads.html)

🟡 `Worker` doesn't support the following options: `stdin` `stdout` `stderr` `trackedUnmanagedFds` `resourceLimits`. Missing `markAsUntransferable` `moveMessagePortToContext` `getHeapSnapshot`.

### [`node:inspector`](https://nodejs.org/api/inspector.html)

🔴 Not implemented.

### [`node:repl`](https://nodejs.org/api/repl.html)

🔴 Not implemented.

### [`node:sqlite`](https://nodejs.org/api/sqlite.html)

🔴 Not implemented.

### [`node:test`](https://nodejs.org/api/test.html)

🟡 Partly implemented. Missing mocks, snapshots, timers. Use [`bun:test`](https://bun.sh/docs/cli/test) instead.

### [`node:trace_events`](https://nodejs.org/api/tracing.html)

🔴 Not implemented.

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
