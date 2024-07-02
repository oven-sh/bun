Bun aims for complete Node.js API compatibility. Most `npm` packages intended for `Node.js` environments will work with Bun out of the box; the best way to know for certain is to try it.

This page is updated regularly to reflect compatibility status of the latest version of Bun. The information below reflects Bun's compatibility with _Node.js v20_. If you run into any bugs with a particular package, please [open an issue](https://bun.sh/issues). Opening issues for compatibility bugs helps us prioritize what to work on next.

## Built-in modules

### [`node:assert`](https://nodejs.org/api/assert.html)

🟢 Fully implemented.

### [`node:async_hooks`](https://nodejs.org/api/async_hooks.html)

🟡 Only `AsyncLocalStorage`, and `AsyncResource` are implemented. `AsyncResource` is missing `bind`.

### [`node:buffer`](https://nodejs.org/api/buffer.html)

🟢 Fully implemented.

### [`node:child_process`](https://nodejs.org/api/child_process.html)

🟡 Missing `proc.gid` `proc.uid`. `Stream` class not exported. IPC cannot send socket handles. Node.js <> Bun IPC can be used with JSON serialization.

### [`node:cluster`](https://nodejs.org/api/cluster.html)

🟢 Fully implemented.

### [`node:console`](https://nodejs.org/api/console.html)

🟢 Fully implemented.

### [`node:crypto`](https://nodejs.org/api/crypto.html)

🟡 Missing `Certificate` `ECDH` `X509Certificate` `checkPrime` `checkPrimeSync` `diffieHellman` `generatePrime` `generatePrimeSync` `getCipherInfo` `getFips` `hkdf` `hkdfSync` `secureHeapUsed` `setEngine` `setFips`

Some methods are not optimized yet.

### [`node:dgram`](https://nodejs.org/api/dgram.html)

🟡 Missing `setBroadcast` `setTTL` `setMulticastTTL` `setMulticastLoopback` `setMulticastInterface` `addMembership` `dropMembership`
`addSourceSpecificMembership` `dropSourceSpecificMembership`

### [`node:diagnostics_channel`](https://nodejs.org/api/diagnostics_channel.html)

🟢 Fully implemented.

### [`node:dns`](https://nodejs.org/api/dns.html)

🟡 Missing `cancel` `setServers` `getDefaultResultOrder`

### [`node:domain`](https://nodejs.org/api/domain.html)

🟡 Missing `Domain` `active`

### [`node:events`](https://nodejs.org/api/events.html)

🟡 `events.addAbortListener` & `events.getMaxListeners` do not support (web api) `EventTarget`

### [`node:fs`](https://nodejs.org/api/fs.html)

🟡 Missing `statfs` `statfsSync`, `opendirSync`. `Dir` is partially implemented.

### [`node:http`](https://nodejs.org/api/http.html)

🟢 Fully implemented. Outgoing client request body is currently buffered instead of streamed.

### [`node:http2`](https://nodejs.org/api/http2.html)

🟡 Client is supported, but server isn't yet.

### [`node:https`](https://nodejs.org/api/https.html)

🟢 APIs are implemented, but `Agent` is not always used yet.

### [`node:inspector`](https://nodejs.org/api/inspector.html)

🔴 Not implemented.

### [`node:module`](https://nodejs.org/api/module.html)

🟡 Missing `runMain` `syncBuiltinESMExports`, `Module#load()`. Attempts to override or patch the module cache will fail.

### [`node:net`](https://nodejs.org/api/net.html)

🟡 Missing `SocketAddress` `Stream`. `BlockList` exists but is a no-op.

### [`node:os`](https://nodejs.org/api/os.html)

🟢 Fully implemented.

### [`node:path`](https://nodejs.org/api/path.html)

🟢 Fully implemented.

### [`node:perf_hooks`](https://nodejs.org/api/perf_hooks.html)

🟡 Missing `createHistogram` `monitorEventLoopDelay`. It's recommended to use `performance` global instead of `perf_hooks.performance`.

### [`node:process`](https://nodejs.org/api/process.html)

🟡 See [`process`](#process) Global.

### [`node:punycode`](https://nodejs.org/api/punycode.html)

🟢 Fully implemented. _Deprecated by Node.js._

### [`node:querystring`](https://nodejs.org/api/querystring.html)

🟢 Fully implemented.

### [`node:readline`](https://nodejs.org/api/readline.html)

🟢 Fully implemented.

### [`node:repl`](https://nodejs.org/api/repl.html)

🔴 Not implemented.

### [`node:stream`](https://nodejs.org/api/stream.html)

🟡 Missing `getDefaultHighWaterMark` `setDefaultHighWaterMark` `toWeb`

### [`node:string_decoder`](https://nodejs.org/api/string_decoder.html)

🟢 Fully implemented.

### [`node:sys`](https://nodejs.org/api/util.html)

🟡 See [`node:util`](#node-util).

### [`node:test`](https://nodejs.org/api/test.html)

🔴 Not implemented. Use [`bun:test`](https://bun.sh/docs/cli/test) instead.

### [`node:timers`](https://nodejs.org/api/timers.html)

🟢 Recommended to use global `setTimeout`, et. al. instead.

### [`node:tls`](https://nodejs.org/api/tls.html)

🟡 Missing `tls.createSecurePair`.

### [`node:trace_events`](https://nodejs.org/api/tracing.html)

🔴 Not implemented.

### [`node:tty`](https://nodejs.org/api/tty.html)

🟢 Fully implemented.

### [`node:url`](https://nodejs.org/api/url.html)

🟢 Fully implemented.

### [`node:util`](https://nodejs.org/api/util.html)

🟡 Missing `MIMEParams` `MIMEType` `aborted` `debug` `getSystemErrorMap` `getSystemErrorName` `transferableAbortController` `transferableAbortSignal` `stripVTControlCharacters`

### [`node:v8`](https://nodejs.org/api/v8.html)

🔴 `serialize` and `deserialize` use JavaScriptCore's wire format instead of V8's. Otherwise, not implemented. For profiling, use [`bun:jsc`](/docs/project/benchmarking#bunjsc) instead.

### [`node:vm`](https://nodejs.org/api/vm.html)

🟡 Core functionality works, but experimental VM ES modules are not implemented, including `vm.Module`, `vm.SourceTextModule`, `vm.SyntheticModule`,`importModuleDynamically`, and `vm.measureMemory`. Options like `timeout`, `breakOnSigint`, `cachedData` are not implemented yet. There is a bug with `this` value for contextified options not having the correct prototype.

### [`node:wasi`](https://nodejs.org/api/wasi.html)

🟡 Partially implemented.

### [`node:worker_threads`](https://nodejs.org/api/worker_threads.html)

🟡 `Worker` doesn't support the following options: `stdin` `stdout` `stderr` `trackedUnmanagedFds` `resourceLimits`. Missing `markAsUntransferable` `moveMessagePortToContext` `getHeapSnapshot`.

### [`node:zlib`](https://nodejs.org/api/zlib.html)

🟡 Unoptimized.

## Globals

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

🔴 Not implemented.

### [`performance`](https://developer.mozilla.org/en-US/docs/Web/API/performance)

🟢 Fully implemented.

### [`process`](https://nodejs.org/api/process.html)

🟡 Missing `domain` `initgroups` `setegid` `seteuid` `setgid` `setgroups` `setuid` `allowedNodeEnvironmentFlags` `getActiveResourcesInfo` `setActiveResourcesInfo` `moduleLoadList` `setSourceMapsEnabled` `channel`. `process.binding` is partially implemented.

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

🟢 Fully implemented, including [`require.main`](https://nodejs.org/api/modules.html#requiremain), [`require.cache`](https://nodejs.org/api/modules.html#requirecache), [`require.resolve`](https://nodejs.org/api/modules.html#requireresolverequest-options)

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

🔴 Not implemented.

### [`TextEncoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder)

🟢 Fully implemented.

### [`TextEncoderStream`](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoderStream)

🔴 Not implemented.

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
