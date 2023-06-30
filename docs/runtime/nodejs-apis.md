Bun aims for complete Node.js API compatibility. Most `npm` packages intended for `Node.js` environments will work with Bun out of the box; the best way to know for certain is to try it.

This page is updated regularly to reflect compatibility status of the latest version of Bun.

## Built-in modules

{% block className="ScrollFrame" %}
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
- 🟡
- Incomplete implementation of `base64` and `base64url` encodings.

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
- Missing `crypto.Certificate` `crypto.ECDH` `crypto.KeyObject` `crypto.X509Certificate` `crypto.checkPrime{Sync}` `crypto.createPrivateKey` `crypto.createPublicKey` `crypto.createSecretKey` `crypto.diffieHellman` `crypto.generateKey{Sync}` `crypto.generateKeyPair{Sync}` `crypto.generatePrime{Sync}` `crypto.getCipherInfo` `crypto.getCurves` `crypto.{get|set}Fips` `crypto.hkdf` `crypto.hkdfSync` `crypto.randomInt` `crypto.secureHeapUsed` `crypto.setEngine` `crypto.sign` `crypto.verify`

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
- Missing `fs.fdatasync{Sync}` `fs.opendir{Sync}` `fs.readv{Sync}` `fs.{watch|watchFile|unwatchFile}` `fs.writev{Sync}`.

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
- Missing `net.createServer` `net.{get|set}DefaultAutoSelectFamily` `net.SocketAddress` `net.BlockList`.

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
- Missing `tls.Server` `tls.createServer` `tls.createSecurePair` `tls.checkServerIdentity` `tls.rootCertificates`

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
- Missing `url.domainTo{ASCII|Unicode}` `url.urlToHttpOptions`. Recommended to use `URL` and `URLSearchParams` globals instead.

---

- {% anchor id="node_util" %} [`node:util`](https://nodejs.org/api/util.html) {% /anchor %}
- 🟡
- Missing `util.MIMEParams` `util.MIMEType` `util.formatWithOptions()` `util.getSystemErrorMap()` `util.getSystemErrorName()` `util.parseArgs()` `util.stripVTControlCharacters()` `util.toUSVString()` `util.transferableAbortController()` `util.transferableAbortSignal()`.

---

- {% anchor id="node_v8" %} [`node:v8`](https://nodejs.org/api/v8.html) {% /anchor %}
- 🔴
- Not implemented or planned. For profiling, use [`bun:jsc`](/docs/project/benchmarking#bunjsc) instead.

---

- {% anchor id="node_vm" %} [`node:vm`](https://nodejs.org/api/vm.html) {% /anchor %}
- 🟡
- Partially implemented.

---

- {% anchor id="node_wasi" %} [`node:wasi`](https://nodejs.org/api/wasi.html) {% /anchor %}
- 🟡
- Partially implemented.

---

- {% anchor id="node_worker_threads" %} [`node:worker_threads`](https://nodejs.org/api/worker_threads.html) {% /anchor %}
- 🔴
- Not implemented.

---

- {% anchor id="node_zlib" %} [`node:zlib`](https://nodejs.org/api/zlib.html) {% /anchor %}
- 🟡
- Missing `zlib.brotli*`

{% /table %}
{% /block %}

## Globals

The table below lists all globals implemented by Node.js and Bun's current compatibility status.

{% table %}

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

- {% anchor id="node_crypto" %} [`crypto`](https://developer.mozilla.org/en-US/docs/Web/API/crypto) {% /anchor %}
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
- Fully implemented. Added in Bun 0.5.7.

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
- 🔴
- Not implemented.

---

- {% anchor id="node_messageevent" %} [`MessageEvent`](https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent) {% /anchor %}
- 🟢
- Fully implemented.

---

- {% anchor id="node_messageport" %} [`MessagePort`](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort) {% /anchor %}
- 🔴
- Not implemented.

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
- Missing `process.allowedNodeEnvironmentFlags` `process.channel()` `process.connected` `process.constrainedMemory()` `process.cpuUsage()` `process.debugPort` `process.disconnect()` `process.{get|set}ActiveResourcesInfo()` `process.{get|set}{uid|gid|egid|euid|groups}()` `process.hasUncaughtExceptionCaptureCallback` `process.initGroups()` `process.kill()` `process.listenerCount` `process.memoryUsage()` `process.report` `process.resourceUsage()` `process.setSourceMapsEnabled()` `process.send()`.

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
- Fully implemented.

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
- 🔴
- Not implemented.

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

{% /table %}
