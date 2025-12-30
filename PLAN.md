# Bun Source Reorganization

## The Goal: Guessability

Claude should be able to **guess** where code lives without searching.

| User says             | Claude guesses                                      |
| --------------------- | --------------------------------------------------- |
| "Fix the transpiler"  | `src/transpiler/`                                   |
| "Fix the test runner" | `src/test_runner/`                                  |
| "Fix the bundler"     | `src/bundler/`                                      |
| "Fix bun install"     | `src/install/`                                      |
| "Fix CSS parsing"     | `src/css/`                                          |
| "Fix the shell"       | `src/shell/`                                        |
| "Fix Postgres"        | `src/sql/postgres/`                                 |
| "Fix MySQL"           | `src/sql/mysql/`                                    |
| "Fix Valkey/Redis"    | `src/valkey/`                                       |
| "Fix S3"              | `src/s3/` (core) or `buntime/api/s3/` (JS bindings) |
| "Fix Bake"            | `src/bake/`                                         |
| "Fix Bun.serve()"     | `src/buntime/api/server/`                           |
| "Fix fetch()"         | `src/buntime/web/fetch/`                            |
| "Fix WebSocket"       | `src/buntime/web/websocket/`                        |
| "Fix node:fs"         | `src/buntime/node/fs/`                              |
| "Fix node:crypto"     | `src/buntime/node/crypto/`                          |
| "Fix crypto.subtle"   | `src/buntime/web/webcrypto/`                        |
| "Fix N-API"           | `src/buntime/compat/napi/`                          |
| "Fix V8 compat"       | `src/buntime/compat/v8/`                            |

---

## Step 1: Rename `src/bun.js/` → `src/buntime/`

```bash
git mv src/bun.js src/buntime
```

Update imports in `src/bun.zig`. Most code uses `bun.foo` namespaces, so they won't break.

---

## Step 2: Create `src/transpiler/`

Move the JS/TS transpiler from root:

```bash
mkdir -p src/transpiler
git mv src/js_parser.zig src/transpiler/parser.zig
git mv src/js_lexer.zig src/transpiler/lexer.zig
git mv src/js_lexer_tables.zig src/transpiler/lexer_tables.zig
git mv src/js_printer.zig src/transpiler/printer.zig
git mv src/transpiler.zig src/transpiler/transpiler.zig
git mv src/js_lexer src/transpiler/js_lexer
```

---

## Step 3: Create `src/test_runner/`

Move from `buntime/test/`:

```bash
mkdir -p src/test_runner
git mv src/buntime/test/* src/test_runner/
```

Files moved:

- `bun_test.zig`
- `Collection.zig`
- `debug.zig`
- `diff/` (entire directory)
- `diff_format.zig`
- `DoneCallback.zig`
- `Execution.zig`
- `expect/` (entire directory with 70+ matchers)
- `expect.zig`
- `jest.classes.ts`
- `jest.zig`
- `Order.zig`
- `pretty_format.zig`
- `ScopeFunctions.zig`
- `snapshot.zig`
- `test.zig`
- `timers/` (FakeTimers.zig, FakeTimersConfig.bindv2.ts)

---

## Step 4: Dissolve `bindings/` by Domain

### 4.1 → `api/console/`

```
ConsoleObject.cpp
ConsoleObject.h
UtilInspect.cpp
UtilInspect.h
```

Plus from buntime root: `ConsoleObject.zig`

### 4.2 → `api/inspector/`

```
BunCPUProfiler.cpp
BunCPUProfiler.h
BunCPUProfiler.zig
BunDebugger.cpp
BunInjectedScriptHost.cpp
BunInjectedScriptHost.h
BunInspector.cpp
CodeCoverage.cpp
generated_perf_trace_events.h
InspectorBunFrontendDevServerAgent.cpp
InspectorBunFrontendDevServerAgent.h
InspectorHTTPServerAgent.cpp
InspectorHTTPServerAgent.h
InspectorLifecycleAgent.cpp
InspectorLifecycleAgent.h
InspectorTestReporterAgent.cpp
InspectorTestReporterAgent.h
linux_perf_tracing.cpp
```

Plus from buntime root: `Debugger.zig`

### 4.3 → `api/error/`

```
CallSite.cpp
CallSite.h
CallSitePrototype.cpp
CallSitePrototype.h
DeferredError.zig
DOMException.cpp
DOMException.h
Errorable.zig
ErrorCode.cpp
ErrorCode.h
ErrorCode.ts
ErrorCode.zig
ErrorStackFrame.cpp
ErrorStackFrame.h
ErrorStackTrace.cpp
ErrorStackTrace.h
Exception.h
Exception.zig
ExceptionCode.h
ExceptionOr.h
FormatStackTraceForJS.cpp
FormatStackTraceForJS.h
JSErrorCode.zig
SystemError.zig
ZigErrorType.zig
ZigException.cpp
ZigException.zig
ZigStackFrame.zig
ZigStackFrameCode.zig
ZigStackFramePosition.zig
ZigStackTrace.zig
```

### 4.4 → `api/cookie/`

```
Cookie.cpp
Cookie.h
CookieMap.cpp
CookieMap.h
```

Plus from webcore: `JSCookie.cpp`, `JSCookie.h`, `JSCookieMap.cpp`, `JSCookieMap.h`
Plus from buntime/webcore: `CookieMap.zig`

### 4.5 → `api/s3/`

```
JSS3File.cpp
JSS3File.h
S3Error.cpp
S3Error.h
```

### 4.6 → `api/secrets/`

```
JSSecrets.cpp
JSSecrets.zig
Secrets.h
SecretsDarwin.cpp
SecretsLinux.cpp
SecretsWindows.cpp
```

### 4.7 → `api/ffi/`

```
DLHandleMap.h
ffi.cpp
FFI.zig
JSFFIFunction.cpp
JSFFIFunction.h
```

### 4.8 → `api/sqlite/`

Entire `bindings/sqlite/` directory:

```
CMakeLists.txt
JSSQLStatement.cpp
JSSQLStatement.h
lazy_sqlite3.h
sqlite3.c
sqlite3_error_codes.h
sqlite3_local.h
```

### 4.9 → `api/sql/`

```
SQLClient.cpp
```

### 4.10 → `api/shell/`

```
ShellBindings.cpp
```

### 4.11 → `api/ipc/`

```
IPC.cpp
```

### 4.12 → `api/test/`

```
FuzzilliREPRL.cpp
InternalForTesting.cpp
InternalForTesting.h
JSCTestingHelpers.cpp
JSCTestingHelpers.h
JSMockFunction.cpp
JSMockFunction.h
NoOpForTesting.cpp
NoOpForTesting.h
```

### 4.13 → `api/server/`

```
BunHttp2CommonStrings.cpp
BunHttp2CommonStrings.h
HTTPServerAgent.zig
JSBunRequest.cpp
JSBunRequest.h
ServerRouteList.cpp
ServerRouteList.h
uws_bindings.cpp
```

### 4.14 → `api/plugin/`

```
BunPlugin.cpp
BunPlugin.h
JSBundler+BunPlugin-impl.h
JSBundlerPlugin.cpp
JSBundlerPlugin.h
```

---

### 4.20 → `web/fetch/`

```
FetchHeaders.zig
NodeFetch.cpp
NodeFetch.h
Undici.cpp
Undici.h
```

Plus from webcore: `FetchHeaders.cpp`, `FetchHeaders.h`, `JSFetchHeaders.cpp`, `JSFetchHeaders.h`, `HTTPHeader*.cpp/h`

### 4.21 → `web/url/`

```
decodeURIComponentSIMD.cpp
decodeURIComponentSIMD.h
DOMURL.cpp
DOMURL.h
DOMURL.zig
EncodeURIComponent.cpp
EncodeURIComponent.h
NodeURL.cpp
NodeURL.h
URL.zig
URLDecomposition.cpp
URLDecomposition.h
URLSearchParams.cpp
URLSearchParams.h
URLSearchParams.zig
```

Plus from webcore: `JSDOMURL.cpp/h`, `JSURLSearchParams.cpp/h`, `URLPattern*.cpp/h`, `JSURLPattern*.cpp/h`

### 4.22 → `web/blob/`

```
blob.cpp
blob.h
DOMFormData.cpp
DOMFormData.h
DOMFormData.zig
JSDOMFile.cpp
JSDOMFile.h
```

Plus from webcore: `JSDOMFormData.cpp/h`

### 4.23 → `web/encoding/`

```
Base64Helpers.cpp
Base64Helpers.h
DecodeEscapeSequences.h
EncodingTables.cpp
EncodingTables.h
TextCodec.cpp
TextCodec.h
TextCodec.zig
TextCodecASCIIFastPath.h
TextCodecCJK.cpp
TextCodecCJK.h
TextCodecReplacement.cpp
TextCodecReplacement.h
TextCodecSingleByte.cpp
TextCodecSingleByte.h
TextCodecUserDefined.cpp
TextCodecUserDefined.h
TextCodecWrapper.cpp
TextEncoding.cpp
TextEncoding.h
TextEncodingRegistry.cpp
TextEncodingRegistry.h
UnencodableHandling.h
```

Plus from webcore: `JSTextEncoder.cpp/h`, `JSTextEncoderStream.cpp/h`, `JSTextDecoderStream.cpp/h`, `TextEncoder.cpp/h`

### 4.24 → `web/compression/`

```
JSCompressionStream.cpp
JSCompressionStream.h
JSDecompressionStream.cpp
JSDecompressionStream.h
```

### 4.25 → `web/events/`

From webcore directory:

```
AbortAlgorithm.h
AbortController.cpp/h
AbortSignal.cpp/h
BroadcastChannel.cpp/h
CloseEvent.cpp/h
CustomEvent.cpp/h
ErrorCallback.cpp/h
ErrorEvent.cpp/h
Event.cpp/h
EventContext.cpp/h
EventDispatcher.cpp/h
EventEmitter.cpp/h
EventFactory.cpp
EventListener.h
EventListenerMap.cpp/h
EventNames.cpp/h
EventPath.cpp/h
EventSender.h
EventTarget.cpp/h
EventTargetConcrete.cpp/h
EventTargetFactory.cpp
JSAbort*.cpp/h
JSBroadcastChannel.cpp/h
JSCloseEvent.cpp/h
JSCustomEvent.cpp/h
JSErrorCallback.cpp/h
JSErrorEvent.cpp/h
JSEvent*.cpp/h
MessageChannel.cpp/h
MessageEvent.cpp/h
MessagePort.cpp/h
MessagePortChannel*.cpp/h
JSMessage*.cpp/h
```

### 4.26 → `web/streams/`

From webcore directory:

```
InternalWritableStream.cpp/h
JSByteLengthQueuingStrategy.cpp/h
JSCountQueuingStrategy.cpp/h
JSReadableByteStreamController.cpp/h
JSReadableStream.cpp/h
JSReadableStreamBYOBReader.cpp/h
JSReadableStreamBYOBRequest.cpp/h
JSReadableStreamDefaultController.cpp/h
JSReadableStreamDefaultReader.cpp/h
JSReadableStreamSink.cpp/h
JSReadableStreamSource.cpp/h
JSTransformStream.cpp/h
JSTransformStreamDefaultController.cpp/h
JSWritableStream.cpp/h
JSWritableStreamDefaultController.cpp/h
JSWritableStreamDefaultWriter.cpp/h
JSWritableStreamSink.cpp/h
ReadableStream.cpp/h
ReadableStreamDefaultController.cpp/h
ReadableStreamSink.cpp/h
ReadableStreamSource.cpp/h
WritableStream.cpp/h
WritableStreamSink.h
```

### 4.27 → `web/performance/`

From webcore directory:

```
JSPerformance.cpp/h
JSPerformanceEntry.cpp/h
JSPerformanceMark.cpp/h
JSPerformanceMarkOptions.cpp/h
JSPerformanceMeasure.cpp/h
JSPerformanceMeasureOptions.cpp/h
JSPerformanceObserver.cpp/h
JSPerformanceObserverCallback.cpp/h
JSPerformanceObserverEntryList.cpp/h
JSPerformanceResourceTiming.cpp/h
JSPerformanceServerTiming.cpp/h
JSPerformanceTiming.cpp/h
NetworkLoadMetrics.cpp/h
Performance.cpp/h
PerformanceEntry.cpp/h
PerformanceMark.cpp/h
PerformanceMeasure.cpp/h
PerformanceObserver.cpp/h
PerformanceObserverEntryList.cpp/h
PerformanceResourceTiming.cpp/h
PerformanceServerTiming.cpp/h
PerformanceTiming.cpp/h
PerformanceUserTiming.cpp/h
ResourceLoadTiming.h
ResourceTiming.cpp/h
ServerTiming.cpp/h
ServerTimingParser.cpp/h
```

### 4.28 → `web/websocket/`

From webcore directory:

```
JSWebSocket.cpp/h
WebSocket.cpp/h
WebSocketDeflate.h
WebSocketErrorCode.h
WebSocketIdentifier.h
```

### 4.29 → `web/webcrypto/`

Entire `bindings/webcrypto/` directory (120+ files):

- All `CryptoAlgorithm*.cpp/h`
- All `CryptoKey*.cpp/h`
- All `JSCrypto*.cpp/h`
- All `JS*Params.cpp/h`
- All `.idl` files
- `OpenSSL*.cpp/h`
- `SubtleCrypto.cpp/h`
- etc.

---

### 4.30 → `node/buffer/`

```
BufferEncodingType.h
JSBuffer.cpp
JSBuffer.h
JSBufferEncodingType.cpp
JSBufferEncodingType.h
JSBufferList.cpp
JSBufferList.h
JSStringDecoder.cpp
JSStringDecoder.h
JSUint8Array.zig
Uint8Array.cpp
```

### 4.31 → `node/process/`

```
BunProcess.cpp
BunProcess.h
BunProcessReportObjectWindows.cpp
ExposeNodeModuleGlobals.cpp
JSEnvironmentVariableMap.cpp
JSEnvironmentVariableMap.h
JSNextTickQueue.cpp
JSNextTickQueue.h
ProcessBindingBuffer.cpp/h
ProcessBindingConstants.cpp/h
ProcessBindingFs.cpp/h
ProcessBindingHTTPParser.cpp/h
ProcessBindingNatives.cpp/h
ProcessBindingTTYWrap.cpp/h
ProcessBindingUV.cpp/h
ProcessIdentifier.cpp/h
```

### 4.32 → `node/vm/`

```
NodeVM.cpp
NodeVM.h
NodeVMModule.cpp
NodeVMModule.h
NodeVMScript.cpp
NodeVMScript.h
NodeVMScriptFetcher.h
NodeVMSourceTextModule.cpp
NodeVMSourceTextModule.h
NodeVMSyntheticModule.cpp
NodeVMSyntheticModule.h
```

### 4.33 → `node/crypto/`

From bindings root:

```
AsymmetricKeyValue.cpp/h
dh-primes.h
JSX509Certificate.cpp/h
JSX509CertificateConstructor.cpp/h
JSX509CertificatePrototype.cpp/h
ncrpyto_engine.cpp
ncrypto.cpp
ncrypto.h
NodeTLS.cpp
NodeTLS.h
```

Plus entire `bindings/node/crypto/` directory (70+ files):

- `CryptoDhJob.cpp/h`
- `CryptoGen*.cpp/h`
- `CryptoHkdf.cpp/h`
- `CryptoKeygen.cpp/h`
- `CryptoKeys.cpp/h`
- `CryptoPrimes.cpp/h`
- `CryptoSignJob.cpp/h`
- `CryptoUtil.cpp/h`
- `DiffieHellmanFunctions.h`
- `JSCipher*.cpp/h`
- `JSDiffieHellman*.cpp/h`
- `JSECDH*.cpp/h`
- `JSHash.cpp/h`
- `JSHmac.cpp/h`
- `JSKeyObject*.cpp/h`
- `JSPrivateKeyObject*.cpp/h`
- `JSPublicKeyObject*.cpp/h`
- `JSSecretKeyObject*.cpp/h`
- `JSSign.cpp/h`
- `JSVerify.cpp/h`
- `KeyObject.cpp/h`
- `KeyObjectData.h`
- `node_crypto_binding.cpp/h`

### 4.34 → `node/http/`

```
NodeHTTP.cpp
NodeHTTP.h
```

Plus entire `bindings/node/http/` directory:

- `JSConnectionsList*.cpp/h`
- `JSHTTPParser*.cpp/h`
- `llhttp/` subdirectory
- `NodeHTTPParser.cpp/h`

Plus `bindings/node/`:

- `JSNodeHTTPServerSocket.cpp/h`
- `JSNodeHTTPServerSocketPrototype.cpp/h`

### 4.35 → `node/fs/`

```
NodeDirent.cpp
NodeDirent.h
NodeFSStatBinding.cpp
NodeFSStatBinding.h
NodeFSStatFSBinding.cpp
NodeFSStatFSBinding.h
```

### 4.36 → `node/os/`

```
OsBinding.cpp
```

### 4.37 → `node/path/`

```
Path.cpp
Path.h
PathInlines.h
```

### 4.38 → `node/util/`

```
NodeValidator.cpp
NodeValidator.h
```

### 4.39 → `node/timers/`

```
NodeTimerObject.cpp
```

Plus from `bindings/node/`: `NodeTimers.cpp/h`

### 4.40 → `node/async_hooks/`

```
AsyncContextFrame.cpp
AsyncContextFrame.h
NodeAsyncHooks.cpp
NodeAsyncHooks.h
```

### 4.41 → `node/perf_hooks/`

```
JSNodePerformanceHooksHistogram.cpp
JSNodePerformanceHooksHistogram.h
JSNodePerformanceHooksHistogramConstructor.cpp
JSNodePerformanceHooksHistogramConstructor.h
JSNodePerformanceHooksHistogramPrototype.cpp
JSNodePerformanceHooksHistogramPrototype.h
```

### 4.42 → `node/constants/`

```
NodeConstants.h
```

---

### 4.50 → `compat/napi/`

```
napi.cpp
napi.h
napi_external.cpp
napi_external.h
napi_finalizer.cpp
napi_finalizer.h
napi_handle_scope.cpp
napi_handle_scope.h
napi_macros.h
napi_type_tag.cpp
napi_type_tag.h
NapiClass.cpp
NapiRef.cpp
NapiWeakValue.cpp
```

### 4.51 → `compat/v8/`

Entire `bindings/v8/` directory (60+ files):

- `CLAUDE.md`
- `node.cpp/h`
- `real_v8.h`
- `shim/` subdirectory (20 files)
- `v8.h`
- `v8_api_internal.cpp/h`
- `v8_compatibility_assertions.h`
- `v8_internal.cpp/h`
- `V8Array.cpp/h`
- `V8Boolean.cpp/h`
- `v8config.h`
- `V8Context.cpp/h`
- `V8Data.h`
- `V8EscapableHandleScope*.cpp/h`
- `V8External.cpp/h`
- `V8Function*.cpp/h`
- `V8HandleScope.cpp/h`
- `V8Isolate.cpp/h`
- `V8Local.cpp/h`
- `V8Maybe*.cpp/h`
- `V8Number.cpp/h`
- `V8Object*.cpp/h`
- `V8Primitive.h`
- `V8Signature.h`
- `V8String.cpp/h`
- `V8Template.cpp/h`
- `V8Value.cpp/h`

### 4.52 → `compat/libuv/`

Entire `bindings/libuv/` directory:

- `uv.h`
- `uv/` subdirectory (platform headers)
- Generator scripts

Plus from bindings root:

```
uv-posix-polyfills.c
uv-posix-polyfills.h
uv-posix-polyfills-darwin.c
uv-posix-polyfills-linux.c
uv-posix-polyfills-posix.c
uv-posix-stubs.c
```

### 4.53 → `compat/windows/`

Entire `bindings/windows/` directory:

```
rescle-binding.cpp
rescle.cpp
rescle.h
```

---

### 4.60 → `jsc/types/`

```
AbortSignal.zig
AnyPromise.zig
CachedBytecode.zig
CallFrame.zig
CatchScope.zig
CommonAbortReason.zig
CommonStrings.zig
CustomGetterSetter.zig
DecodedJSValue.zig
EventType.zig
GetterSetter.zig
JSArray.zig
JSArrayIterator.zig
JSBigInt.zig
JSCell.zig
JSFunction.zig
JSGlobalObject.zig
JSInternalPromise.zig
JSMap.zig
JSObject.zig
JSPromise.zig
JSPromiseRejectionOperation.zig
JSPropertyIterator.zig
JSRef.zig
JSRuntimeType.zig
JSString.zig
JSType.zig
JSValue.zig
MarkedArgumentBuffer.zig
RegularExpression.cpp
RegularExpression.zig
ResolvedSource.zig
ScriptExecutionStatus.zig
SourceProvider.zig
SourceType.zig
VM.zig
```

### 4.61 → `jsc/global/`

```
BunGlobalScope.cpp
BunGlobalScope.h
BunObject.cpp
BunObject.h
BunObject+exports.h
BunWorkerGlobalScope.cpp
BunWorkerGlobalScope.h
DOMWrapperWorld-class.h
DOMWrapperWorld.cpp
DOMWrapperWorld.h
JSDOMGlobalObject.cpp
JSDOMGlobalObject.h
ScriptExecutionContext.cpp
ScriptExecutionContext.h
ZigGeneratedCode.cpp
ZigGlobalObject.cpp
ZigGlobalObject.h
ZigGlobalObject.lut.txt
ZigLazyStaticFunctions-inlines.h
ZigLazyStaticFunctions.h
ZigSourceProvider.cpp
ZigSourceProvider.h
```

### 4.62 → `jsc/gc/`

```
bmalloc_heap_ref.h
BunGCOutputConstraint.cpp
BunGCOutputConstraint.h
GCDefferalContext.h
MarkingConstraint.cpp
MimallocWTFMalloc.h
StrongRef.cpp
StrongRef.h
Weak.cpp
WebCoreOpaqueRoot.h
WebCoreOpaqueRootInlines.h
WriteBarrierList.h
```

### 4.63 → `jsc/interop/`

```
ActiveDOMCallback.cpp
ActiveDOMCallback.h
Algo/Tuple.h
ares_build.h
Bindgen/ (entire directory)
Bindgen.h
BindgenCustomEnforceRange.h
bindings.cpp
BunClientData.cpp
BunClientData.h
BunIDLConvert.h
BunIDLConvertBase.h
BunIDLConvertBlob.h
BunIDLConvertContext.h
BunIDLConvertNumbers.h
BunIDLHumanReadable.h
BunIDLTypes.h
BunJSCEventLoop.cpp
c-bindings.cpp
CachedScript.h
CatchScopeBinding.cpp
ConcatCStrings.h
coroutine.cpp
CPUFeatures.cpp
CPUFeatures.zig
debug-helpers.h
DeleteCallbackDataTask.h
EventLoopTask.h
EventLoopTaskNoContext.cpp
EventLoopTaskNoContext.h
headers-cpp.h
headers-handwritten.h
headers.h
helpers.cpp
helpers.h
IDLTypes.h
inlines.cpp
JSDOMBinding.h
JSDOMConvertBufferSource+JSBuffer.h
JSDOMExceptionHandling.cpp
JSDOMExceptionHandling.h
JSDOMWrapper.cpp
JSDOMWrapper.h
JSDOMWrapperCache.cpp
JSDOMWrapperCache.h
JSPropertyIterator.cpp
JSBigIntBinding.cpp
JSCTaskScheduler.cpp
JSCTaskScheduler.h
JSSocketAddressDTO.cpp
JSSocketAddressDTO.h
JSWrappingFunction.cpp
JSWrappingFunction.h
MarkedArgumentBufferBinding.cpp
ObjectBindings.cpp
ObjectBindings.h
objects.cpp
objects.h
root.h
Serialization.cpp
Sink.h
sizes.zig
static_export.zig
StreamGlobals.h
workaround-missing-symbols.cpp
wtf-bindings.cpp
wtf-bindings.h
WTF.zig
ZigString.zig
```

### 4.64 → `jsc/generated/`

```
codegen.zig
generated_classes_list.zig
GeneratedBindings.zig
GeneratedJS2Native.zig
JS2Native.cpp
JS2Native.h
js_classes.ts
```

---

### 4.70 → `module/`

```
ImportMetaObject.cpp
ImportMetaObject.h
InternalModuleRegistry.cpp
InternalModuleRegistry.h
isBuiltinModule.cpp
isBuiltinModule.h
JSCommonJSExtensions.cpp
JSCommonJSExtensions.h
JSCommonJSModule.cpp
JSCommonJSModule.h
JSModuleLoader.zig
ModuleLoader.cpp
ModuleLoader.h
NodeModuleModule.bind.ts
NodeModuleModule.zig
```

---

### 4.80 → `src/string/`

```
bun-simdutf.cpp
bun-simdutf.zig
BunCommonStrings.cpp
BunCommonStrings.h
BunString.cpp
BunString.h
DoubleFormatter.cpp
highway_strings.cpp
MiString.h
StringAdaptors.h
StringBuilder.zig
StringBuilderBinding.cpp
stripANSI.cpp
stripANSI.h
```

---

### 4.90 → `src/bake/`

```
BakeAdditionsToGlobalObject.cpp
BakeAdditionsToGlobalObject.h
HTMLEntryPoint.cpp
JSBakeResponse.cpp
JSBakeResponse.h
```

---

## Step 5: Move remaining webcore C++

From `bindings/webcore/` to appropriate `web/` subdirectories:

- DOM helpers → `web/dom/`
- Structured clone → `web/`
- Worker → `web/worker/`
- MIME → `web/mime/`
- etc.

---

## Final Structure

```
src/
├── transpiler/           # JS/TS transpiler
├── test_runner/          # bun:test
├── bundler/              # bun build
├── resolver/             # Module resolution
├── install/              # Package manager
├── css/                  # CSS parser
├── shell/                # Bun.$
├── bake/                 # Bake framework
├── sql/                  # SQL (mysql/, postgres/)
├── s3/                   # S3 core
├── valkey/               # Valkey/Redis
├── http/                 # HTTP client
├── string/               # String utilities
├── ast/                  # AST types
├── js/                   # TypeScript modules
│
└── buntime/              # JavaScript runtime
    ├── api/              # Bun.* APIs
    │   ├── server/
    │   ├── console/
    │   ├── inspector/
    │   ├── error/
    │   ├── cookie/
    │   ├── s3/
    │   ├── ffi/
    │   ├── sqlite/
    │   ├── sql/
    │   ├── shell/
    │   ├── ipc/
    │   ├── plugin/
    │   ├── secrets/
    │   └── test/
    │
    ├── web/              # Web Standards
    │   ├── fetch/
    │   ├── url/
    │   ├── blob/
    │   ├── encoding/
    │   ├── compression/
    │   ├── events/
    │   ├── streams/
    │   ├── performance/
    │   ├── websocket/
    │   └── webcrypto/
    │
    ├── node/             # Node.js Compatibility
    │   ├── buffer/
    │   ├── process/
    │   ├── vm/
    │   ├── crypto/
    │   ├── http/
    │   ├── fs/
    │   ├── os/
    │   ├── path/
    │   ├── util/
    │   ├── timers/
    │   ├── async_hooks/
    │   ├── perf_hooks/
    │   └── constants/
    │
    ├── compat/           # Native Addon Compat
    │   ├── napi/
    │   ├── v8/
    │   ├── libuv/
    │   └── windows/
    │
    ├── jsc/              # JSC Integration
    │   ├── types/
    │   ├── global/
    │   ├── gc/
    │   ├── interop/
    │   └── generated/
    │
    ├── module/           # Module System
    └── event_loop/       # Event Loop
```

---

## Key Principle: Namespace Imports

Bun uses `@import("bun")` namespaces:

```zig
const bun = @import("bun");
bun.sys       // Not @import("./sys.zig")
bun.shell     // Not @import("./shell/shell.zig")
```

Most code won't break - just update `bun.zig` exports.

---

## Verification

After each step:

```bash
bun bd 2>&1 > out.txt | cat out.txt | head -50
```

---

## Don't Forget

1. **Strings go to `src/string/`** - simdutf, highway_strings, etc.
2. **RegularExpression goes to `jsc/types/`** - it's JSC-related
3. **S3 is a Bun API** → `api/s3/`, not `web/s3/`
4. **`webcrypto/` not `crypto/`** in web/ - distinguishes from node/crypto/
5. **Keep `module/` flat** - no subdirectories needed
6. **bun-spawn.cpp, spawn.cpp** → `api/bun/spawn/`
