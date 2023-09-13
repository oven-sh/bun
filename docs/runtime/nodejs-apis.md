Bun aims for complete Node.js API compatibility. Most `npm` packages intended for `Node.js` environments will work with Bun out of the box; the best way to know for certain is to try it.

This page is updated regularly to reflect compatibility status of the latest version of Bun. If you run into any bugs with a particular package, please [open an issue](https://bun.sh/issues). Opening issues for compatibility bugs helps us prioritize what to work on next.

## Built-in modules

### [`node:assert`](https://nodejs.org/api/assert.html)

🟢 Fully implemented.

### [`node:async_hooks`](https://nodejs.org/api/async_hooks.html)

🟡 Only `AsyncLocalStorage`, and `AsyncResource` are implemented.

### [`node:buffer`](https://nodejs.org/api/buffer.html)

🟢 Fully implemented.

### [`node:child_process`](https://nodejs.org/api/child_process.html)

🟡 Missing `Stream` stdio, `proc.gid`, `proc.uid`. IPC has partial support and only current only works with other `bun` processes.

### [`node:cluster`](https://nodejs.org/api/cluster.html)

🔴 Not implemented.

### [`node:console`](https://nodejs.org/api/console.html)

🟡 Missing `Console` constructor.

### [`node:crypto`](https://nodejs.org/api/crypto.html)

🟡 Missing `crypto.Certificate` `crypto.ECDH` `crypto.KeyObject` `crypto.X509Certificate` `crypto.checkPrime{Sync}` `crypto.createPrivateKey` `crypto.createPublicKey` `crypto.createSecretKey` `crypto.diffieHellman` `crypto.generateKey{Sync}` `crypto.generateKeyPair{Sync}` `crypto.generatePrime{Sync}` `crypto.getCipherInfo` `crypto.{get|set}Fips` `crypto.hkdf` `crypto.hkdfSync` `crypto.secureHeapUsed` `crypto.setEngine` `crypto.sign` `crypto.verify`. Some methods are not optimized yet.

### [`node:dgram`](https://nodejs.org/api/dgram.html)

🔴 Not implemented.

### [`node:diagnostics_channel`](https://nodejs.org/api/diagnostics_channel.html)

🟢 Fully implemented.

### [`node:dns`](https://nodejs.org/api/dns.html)

🟢 Fully implemented.

### [`node:domain`](https://nodejs.org/api/domain.html)

🟢 Fully implemented.

### [`node:events`](https://nodejs.org/api/events.html)

🟡 Missing `on`.

### [`node:fs`](https://nodejs.org/api/fs.html)

🟡 Missing `fs.fdatasync{Sync}` `fs.opendir{Sync}`. `fs.promises.open` incorrectly returns a file descriptor instead of a `FileHandle`.

### [`node:http`](https://nodejs.org/api/http.html)

🟢 Fully implemented.

### [`node:http2`](https://nodejs.org/api/http2.html)

🔴 Not implemented.

### [`node:https`](https://nodejs.org/api/https.html)

🟢 Fully implemented.

### [`node:inspector`](https://nodejs.org/api/inspector.html)

🔴 Not implemented.

### [`node:module`](https://nodejs.org/api/module.html)

🟢 Fully implemented.

### [`node:net`](https://nodejs.org/api/net.html)

🟡 Missing `net.{get|set}DefaultAutoSelectFamily` `net.SocketAddress` `net.BlockList`.

### [`node:os`](https://nodejs.org/api/os.html)

🟢 Fully implemented.

### [`node:path`](https://nodejs.org/api/path.html)

🟢 Fully implemented.

### [`node:perf_hooks`](https://nodejs.org/api/perf_hooks.html)

🟡 Only `perf_hooks.performance.now()` and `perf_hooks.performance.timeOrigin` are implemented. Recommended to use `performance` global instead of `perf_hooks.performance`.

### [`node:process`](https://nodejs.org/api/process.html)

🟡 See `Globals > process`.

### [`node:punycode`](https://nodejs.org/api/punycode.html)

🟢 Fully implemented. _Deprecated by Node.js._

### [`node:querystring`](https://nodejs.org/api/querystring.html)

🟢 Fully implemented.

### [`node:readline`](https://nodejs.org/api/readline.html)

🟢 Fully implemented.

### [`node:repl`](https://nodejs.org/api/repl.html)

🔴 Not implemented.

### [`node:stream`](https://nodejs.org/api/stream.html)

🟢 Fully implemented.

### [`node:string_decoder`](https://nodejs.org/api/string_decoder.html)

🟢 Fully implemented.

### [`node:sys`](https://nodejs.org/api/util.html)

🟡 See `node:util`.

### [`node:timers`](https://nodejs.org/api/timers.html)

🟢 Recommended to use global `setTimeout`, et. al. instead.

### [`node:tls`](https://nodejs.org/api/tls.html)

🟡 Missing `tls.createSecurePair`.

### [`node:trace_events`](https://nodejs.org/api/tracing.html)

🔴 Not implemented.

### [`node:tty`](https://nodejs.org/api/tty.html)

🟢 Fully implemented.

### [`node:url`](https://nodejs.org/api/url.html)

🟡 Missing `url.domainTo{ASCII|Unicode}`. Recommended to use `URL` and `URLSearchParams` globals instead.

### [`node:util`](https://nodejs.org/api/util.html)

🟡 Missing `util.MIMEParams` `util.MIMEType` `util.getSystemErrorMap()` `util.getSystemErrorName()` `util.parseArgs()` `util.stripVTControlCharacters()` `util.transferableAbortController()` `util.transferableAbortSignal()`.

### [`node:v8`](https://nodejs.org/api/v8.html)

🔴 `serialize` and `deserialize` use JavaScriptCore's wire format instead of V8's. Otherwise, not implemented. For profiling, use [`bun:jsc`](/docs/project/benchmarking#bunjsc) instead.

### [`node:vm`](https://nodejs.org/api/vm.html)

🟡 Core functionality works, but VM modules are not implemented. `ShadowRealm` can be used.

### [`node:wasi`](https://nodejs.org/api/wasi.html)

🟡 Partially implemented.

### [`node:worker_threads`](https://nodejs.org/api/worker_threads.html)

🟡 `Worker` doesn't support the following options: `eval`, `argv`, `execArgv`, `stdin`, `stdout`, `stderr`, `trackedUnmanagedFds`, `resourceLimits`. Missing `markAsUntransferable`, `moveMessagePortToContext`, `getHeapSnapshot`.

### [`node:zlib`](https://nodejs.org/api/zlib.html)

🟡 Missing `zlib.brotli*`. Has not been optimized.

<!-- {% block className="ScrollFrame" %}
{% table %}

- Module
- Status
- Notes

---

- {% anchor id="node_assert" %} [`node:assert`](https://nodejs.org/api/assert.html) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_async_hooks" %} [`node:async_hooks`](https://nodejs.org/api/async_hooks.html) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_buffer" %} [`node:buffer`](https://nodejs.org/api/buffer.html) {% /anchor %}
- 🟢

---

- {% anchor id="node_child_process" %} [`node:child_process`](https://nodejs.org/api/child_process.html) {% /anchor %}
- 🟡
- Missing IPC, `Stream` stdio, `proc.gid`, `proc.uid`, advanced serialization.

---

- {% anchor id="node_cluster" %} [`node:cluster`](https://nodejs.org/api/cluster.html) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_console" %} [`node:console`](https://nodejs.org/api/console.html) {% /anchor %}
- 🟢
- Recommended to use `console` global instead

---

- {% anchor id="node_crypto" %} [`node:crypto`](https://nodejs.org/api/crypto.html) {% /anchor %}
- 🟡
- Missing `crypto.Certificate` `crypto.ECDH` `crypto.KeyObject` `crypto.X509Certificate` `crypto.checkPrime{Sync}` `crypto.createPrivateKey` `crypto.createPublicKey` `crypto.createSecretKey` `crypto.diffieHellman` `crypto.generateKey{Sync}` `crypto.generateKeyPair{Sync}` `crypto.generatePrime{Sync}` `crypto.getCipherInfo` `crypto.{get|set}Fips` `crypto.hkdf` `crypto.hkdfSync` `crypto.secureHeapUsed` `crypto.setEngine` `crypto.sign` `crypto.verify`. Some methods are not optimized yet.

---

- {% anchor id="node_dgram" %} [`node:dgram`](https://nodejs.org/api/dgram.html) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_diagnostics_channel" %} [`node:diagnostics_channel`](https://nodejs.org/api/diagnostics_channel.html) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_dns" %} [`node:dns`](https://nodejs.org/api/dns.html) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_domain" %} [`node:domain`](https://nodejs.org/api/domain.html) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_events" %} [`node:events`](https://nodejs.org/api/events.html) {% /anchor %}
- 🟡
- Missing `EventEmitterAsyncResource` `events.on`.

---

- {% anchor id="node_fs" %} [`node:fs`](https://nodejs.org/api/fs.html) {% /anchor %}
- 🟡
- Missing `fs.fdatasync{Sync}` `fs.opendir{Sync}`. `fs.promises.open` incorrectly returns a file descriptor instead of a `FileHandle`.

---

- {% anchor id="node_http" %} [`node:http`](https://nodejs.org/api/http.html) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_http2" %} [`node:http2`](https://nodejs.org/api/http2.html) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_https" %} [`node:https`](https://nodejs.org/api/https.html) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_inspector" %} [`node:inspector`](https://nodejs.org/api/inspector.html) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_module" %} [`node:module`](https://nodejs.org/api/module.html) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_net" %} [`node:net`](https://nodejs.org/api/net.html) {% /anchor %}
- 🟡
- Missing `net.{get|set}DefaultAutoSelectFamily` `net.SocketAddress` `net.BlockList`.

---

- {% anchor id="node_os" %} [`node:os`](https://nodejs.org/api/os.html) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_path" %} [`node:path`](https://nodejs.org/api/path.html) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_perf_hooks" %} [`node:perf_hooks`](https://nodejs.org/api/perf_hooks.html) {% /anchor %}
- 🟡
- Only `perf_hooks.performance.now()` and `perf_hooks.performance.timeOrigin` are implemented. Recommended to use `performance` global instead of `perf_hooks.performance`.

---

- {% anchor id="node_process" %} [`node:process`](https://nodejs.org/api/process.html) {% /anchor %}
- 🟡
- See `Globals > process`.

---

- {% anchor id="node_punycode" %} [`node:punycode`](https://nodejs.org/api/punycode.html) {% /anchor %}
- 🟢
- Fully implemented. _Deprecated by Node.js._

---

- {% anchor id="node_querystring" %} [`node:querystring`](https://nodejs.org/api/querystring.html) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_readline" %} [`node:readline`](https://nodejs.org/api/readline.html) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_repl" %} [`node:repl`](https://nodejs.org/api/repl.html) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_stream" %} [`node:stream`](https://nodejs.org/api/stream.html) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_string_decoder" %} [`node:string_decoder`](https://nodejs.org/api/string_decoder.html) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_sys" %} [`node:sys`](https://nodejs.org/api/util.html) {% /anchor %}
- 🟡
- See `node:util`.

---

- {% anchor id="node_timers" %} [`node:timers`](https://nodejs.org/api/timers.html) {% /anchor %}
- 🟢
- Recommended to use global `setTimeout`, et. al. instead.

---

- {% anchor id="node_tls" %} [`node:tls`](https://nodejs.org/api/tls.html) {% /anchor %}
- 🟡
- Missing `tls.createSecurePair`.

---

- {% anchor id="node_trace_events" %} [`node:trace_events`](https://nodejs.org/api/tracing.html) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_tty" %} [`node:tty`](https://nodejs.org/api/tty.html) {% /anchor %}
- 🟡
- Missing `tty.ReadStream` and `tty.WriteStream`.

---

- {% anchor id="node_url" %} [`node:url`](https://nodejs.org/api/url.html) {% /anchor %}
- 🟡
- Missing `url.domainTo{ASCII|Unicode}`. Recommended to use `URL` and `URLSearchParams` globals instead.

---

- {% anchor id="node_util" %} [`node:util`](https://nodejs.org/api/util.html) {% /anchor %}
- 🟡
- Missing `util.MIMEParams` `util.MIMEType` `util.formatWithOptions()` `util.getSystemErrorMap()` `util.getSystemErrorName()` `util.parseArgs()` `util.stripVTControlCharacters()` `util.transferableAbortController()` `util.transferableAbortSignal()`.

---

- {% anchor id="node_v8" %} [`node:v8`](https://nodejs.org/api/v8.html) {% /anchor %}
- 🔴
- `serialize` and `deserialize` use JavaScriptCore's wire format instead of V8's. Otherwise, not implemented. For profiling, use [`bun:jsc`](/docs/project/benchmarking#bunjsc) instead.

---

- {% anchor id="node_vm" %} [`node:vm`](https://nodejs.org/api/vm.html) {% /anchor %}
- 🟡
- Core functionality works, but VM modules are not implemented. `ShadowRealm` can be used.

---

- {% anchor id="node_wasi" %} [`node:wasi`](https://nodejs.org/api/wasi.html) {% /anchor %}
- 🟡
- Partially implemented.

---

- {% anchor id="node_worker_threads" %} [`node:worker_threads`](https://nodejs.org/api/worker_threads.html) {% /anchor %}
- 🔴
- Not implemented, but coming soon.

---

- {% anchor id="node_zlib" %} [`node:zlib`](https://nodejs.org/api/zlib.html) {% /anchor %}
- 🟡
- Missing `zlib.brotli*`.

{% /table %}
{% /block %} -->

## Globals

The table below lists all globals implemented by Node.js and Bun's current compatibility status.

### [`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)

🟢 Fully implemented.

### [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)

🟢 Fully implemented.

### [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob)

🟢 Fully implemented.

### [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer)

🟡 Incomplete implementation of `base64` and `base64url` encodings.

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

🟡 Missing `Console` constructor.

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

🔴 Not implemented.

### [`PerformanceMark`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceMark)

🔴 Not implemented.

### [`PerformanceMeasure`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceMeasure)

🔴 Not implemented.

### [`PerformanceObserver`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver)

🔴 Not implemented.

### [`PerformanceObserverEntryList`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserverEntryList)

🔴 Not implemented.

### [`PerformanceResourceTiming`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming)

🔴 Not implemented.

### [`performance`](https://developer.mozilla.org/en-US/docs/Web/API/performance)

🟢 Fully implemented.

### [`process`](https://nodejs.org/api/process.html)

🟡 Missing `process.allowedNodeEnvironmentFlags` `process.channel` `process.constrainedMemory()` `process.getActiveResourcesInfo/setActiveResourcesInfo()` `process.setuid/setgid/setegid/seteuid/setgroups()` `process.hasUncaughtExceptionCaptureCallback` `process.initGroups()` `process.report` `process.resourceUsage()`.

### [`queueMicrotask()`](https://developer.mozilla.org/en-US/docs/Web/API/queueMicrotask)

🟢 Fully implemented.

### [`ReadableByteStreamController`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableByteStreamController)

🟢 Fully implemented.

### [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)

🟢 Fully implemented.

### [`ReadableStreamBYOBReader`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamBYOBReader)

🔴 Not implemented.

### [`ReadableStreamBYOBRequest`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamBYOBRequest)

🔴 Not implemented.

### [`ReadableStreamDefaultController`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamDefaultController)

🟢 Fully implemented.

### [`ReadableStreamDefaultReader`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamDefaultReader)

🟢 Fully implemented.

### [`require()`](https://nodejs.org/api/globals.html#require)

🟢 Fully implemented, as well as [`require.main`](https://nodejs.org/api/modules.html#requiremain), [`require.cache`](https://nodejs.org/api/modules.html#requirecache), and [`require.resolve`](https://nodejs.org/api/modules.html#requireresolverequest-options).

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

<!-- {% table %}

---

- {% anchor id="node_abortcontroller" %} [`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_abortsignal" %} [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_blob" %} [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_buffer" %} [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer) {% /anchor %}
- 🟡
- Incomplete implementation of `base64` and `base64url` encodings.

---

- {% anchor id="node_bytelengthqueuingstrategy" %} [`ByteLengthQueuingStrategy`](https://developer.mozilla.org/en-US/docs/Web/API/ByteLengthQueuingStrategy) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_dirname" %} [`__dirname`](https://nodejs.org/api/globals.html#__dirname) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_filename" %} [`__filename`](https://nodejs.org/api/globals.html#__filename) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_atob" %} [`atob()`](https://developer.mozilla.org/en-US/docs/Web/API/atob) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_broadcastchannel" %} [`BroadcastChannel`](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_btoa" %} [`btoa()`](https://developer.mozilla.org/en-US/docs/Web/API/btoa) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_clearimmediate" %} [`clearImmediate()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/clearImmediate) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_clearinterval" %} [`clearInterval()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/clearInterval) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_cleartimeout" %} [`clearTimeout()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/clearTimeout) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_compressionstream" %} [`CompressionStream`](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_console" %} [`console`](https://developer.mozilla.org/en-US/docs/Web/API/console) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_countqueuingstrategy" %} [`CountQueuingStrategy`](https://developer.mozilla.org/en-US/docs/Web/API/CountQueuingStrategy) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_crypto" %} [`Crypto`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_crypto" %} [`SubtleCrypto (crypto)`](https://developer.mozilla.org/en-US/docs/Web/API/crypto) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_cryptokey" %} [`CryptoKey`](https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_customevent" %} [`CustomEvent`](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_decompressionstream" %} [`DecompressionStream`](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_event" %} [`Event`](https://developer.mozilla.org/en-US/docs/Web/API/Event) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_eventtarget" %} [`EventTarget`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_exports" %} [`exports`](https://nodejs.org/api/globals.html#exports) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_fetch" %} [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/fetch) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_formdata" %} [`FormData`](https://developer.mozilla.org/en-US/docs/Web/API/FormData) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_global" %} [`global`](https://nodejs.org/api/globals.html#global) {% /anchor %}
- 🟢
- Implemented. This is an object containing all objects in the global namespace. It's rarely referenced directly, as its contents are available without an additional prefix, e.g. `__dirname` instead of `global.__dirname`.

---

- {% anchor id="node_globalthis" %} [`globalThis`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/globalThis) {% /anchor %}
- 🟢
- Aliases to `global`.

---

- {% anchor id="node_headers" %} [`Headers`](https://developer.mozilla.org/en-US/docs/Web/API/Headers) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_messagechannel" %} [`MessageChannel`](https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_messageevent" %} [`MessageEvent`](https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_messageport" %} [`MessagePort`](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_module" %} [`module`](https://nodejs.org/api/globals.html#module) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_performanceentry" %} [`PerformanceEntry`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEntry) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_performancemark" %} [`PerformanceMark`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceMark) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_performancemeasure" %} [`PerformanceMeasure`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceMeasure) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_performanceobserver" %} [`PerformanceObserver`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_performanceobserverentrylist" %} [`PerformanceObserverEntryList`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserverEntryList) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_performanceresourcetiming" %} [`PerformanceResourceTiming`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_performance" %} [`performance`](https://developer.mozilla.org/en-US/docs/Web/API/performance) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_process" %} [`process`](https://nodejs.org/api/process.html) {% /anchor %}
- 🟡
- Missing `process.allowedNodeEnvironmentFlags` `process.channel()` `process.connected` `process.constrainedMemory()` `process.disconnect()` `process.getActiveResourcesInfo/setActiveResourcesInfo()` `process.setuid/setgid/setegid/seteuid/setgroups()` `process.hasUncaughtExceptionCaptureCallback` `process.initGroups()` `process.report` `process.resourceUsage()` `process.send()`.

---

- {% anchor id="node_queuemicrotask" %} [`queueMicrotask()`](https://developer.mozilla.org/en-US/docs/Web/API/queueMicrotask) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_readablebytestreamcontroller" %} [`ReadableByteStreamController`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableByteStreamController) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_readablestream" %} [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_readablestreambyobreader" %} [`ReadableStreamBYOBReader`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamBYOBReader) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_readablestreambyobrequest" %} [`ReadableStreamBYOBRequest`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamBYOBRequest) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_readablestreamdefaultcontroller" %} [`ReadableStreamDefaultController`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamDefaultController) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_readablestreamdefaultreader" %} [`ReadableStreamDefaultReader`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamDefaultReader) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_require" %} [`require()`](https://nodejs.org/api/globals.html#require) {% /anchor %}
- 🟢
- Fully implemented, as well as [`require.main`](https://nodejs.org/api/modules.html#requiremain), [`require.cache`](https://nodejs.org/api/modules.html#requirecache), and [`require.resolve`](https://nodejs.org/api/modules.html#requireresolverequest-options)

---

- {% anchor id="node_response" %} [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_request" %} [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_setimmediate" %} [`setImmediate()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/setImmediate) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_setinterval" %} [`setInterval()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/setInterval) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_settimeout" %} [`setTimeout()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_structuredclone" %} [`structuredClone()`](https://developer.mozilla.org/en-US/docs/Web/API/structuredClone) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_subtlecrypto" %} [`SubtleCrypto`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_domexception" %} [`DOMException`](https://developer.mozilla.org/en-US/docs/Web/API/DOMException) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_textdecoder" %} [`TextDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_textdecoderstream" %} [`TextDecoderStream`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoderStream) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_textencoder" %} [`TextEncoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_textencoderstream" %} [`TextEncoderStream`](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoderStream) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_transformstream" %} [`TransformStream`](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_transformstreamdefaultcontroller" %} [`TransformStreamDefaultController`](https://developer.mozilla.org/en-US/docs/Web/API/TransformStreamDefaultController) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_url" %} [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_urlsearchparams" %} [`URLSearchParams`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_webassembly" %} [`WebAssembly`](https://nodejs.org/api/globals.html#webassembly) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_writablestream" %} [`WritableStream`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_writablestreamdefaultcontroller" %} [`WritableStreamDefaultController`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStreamDefaultController) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_writablestreamdefaultwriter" %} [`WritableStreamDefaultWriter`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStreamDefaultWriter) {% /anchor %}
- 🟢
- Fully implemented.

{% /table %} -->
