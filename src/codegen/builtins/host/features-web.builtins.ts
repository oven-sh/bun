import * as b from "bun-builtins-table";
import { pathOfNativeBinding } from "../paths.ts";

const extendAll = (uses: readonly b.FeatureUseSpec[], ...paths: readonly b.BuiltinPath[]) =>
  paths.flatMap(path => b.extend(path, { usesFeature: uses }));

const nativeBindings = (kind: b.NativeCallKind, file: string, ...symbols: readonly string[]) =>
  symbols.map(symbol => pathOfNativeBinding(kind, file, symbol));

const usesWhen = (when: b.ConditionSpec, ...features: readonly b.FeatureName[]) =>
  features.map(feature => ({ feature, when }));

const secureConnectionFeatures = ["TlsSockets", "Tls", "X509"];
const abortSignalFeatures = ["AbortSignal", "Events"];
const s3Features = ["S3Client", "S3Responses"];
const fetchFeatures = [
  "Fetch",
  "HttpClient",
  "Bodies",
  "Headers",
  "WebStreams",
  ...secureConnectionFeatures,
  "Http3",
  "BrotliDecoder",
  "BrotliEncoder",
  "ZstdCompressor",
  "LibdeflateCompressor",
];
const webSocketFeatures = ["WebSocket", "HttpClient", "Events", "Bodies", ...secureConnectionFeatures, "Buffer"];
const workerFeatures = ["WorkerConstructor", "Worker", "MessageChannel", "StructuredClone", "Events", "Buffer"];
const codecStreamFeatures = ["CompressionStreams", "WebStreams"];
const serverFeatures = ["Bodies", "Headers", "Url", ...abortSignalFeatures, "WebStreams"];

const whenFormat = (format: string) => b.whenOperand("format", format);

export default b.declarations(
  // Which of ICU's data these entries of the engine open.
  extendAll(["IntlLocale"], "Intl.Locale", "Intl.supportedValuesOf"),
  extendAll(["IntlPluralRules"], "Intl.PluralRules", "Intl.RelativeTimeFormat"),
  extendAll(["HtmlRewriter", "Bodies", "WebStreams"], "HTMLRewriter"),
  extendAll(
    ["HtmlRewriter"],
    "%AttributeIterator%",
    "%Comment%",
    "%DocEnd%",
    "%DocType%",
    "%Element%",
    "%EndTag%",
    "%HTMLRewriterTransform%",
    "%TextChunk%",
  ),

  extendAll(["UrlPattern", "RegExp", "RegExpUnicodeProperties"], "URLPattern"),

  extendAll(
    [
      "CompressionStream",
      ...codecStreamFeatures,
      ...usesWhen(whenFormat("brotli"), "BrotliEncoder"),
      ...usesWhen(whenFormat("zstd"), "ZstdCompressor"),
    ],
    "CompressionStream",
  ),
  extendAll(
    ["DecompressionStream", ...codecStreamFeatures, ...usesWhen(whenFormat("brotli"), "BrotliDecoder")],
    "DecompressionStream",
  ),

  extendAll(["MessageChannel", "StructuredClone", "Events"], "BroadcastChannel", "MessageChannel", "MessagePort"),
  extendAll(["Dialogs"], "alert", "confirm", "prompt"),
  extendAll(
    ["PostMessage", "StructuredClone"],
    "postMessage",
    ...nativeBindings("NewCppFunction", "Worker.cpp", "jsFunctionPostMessage"),
  ),
  extendAll(
    workerFeatures,
    "Worker",
    ...nativeBindings("Cpp", "Worker.cpp", "createNodeWorkerConstructor", "createNodeWorkerThreadsBinding"),
  ),
  extendAll(["WorkerConstructor"], "node:worker_threads"),
  // A build with several entry points asks for it: such a Worker loads node:worker_threads before its entry point.
  extendAll(["NodeWorker"], ...nativeBindings("Cpp", "Worker.cpp", "createNodeWorkerConstructor")),

  extendAll(webSocketFeatures, "WebSocket", ...nativeBindings("Cpp", "JSWebSocket.cpp", "createWebSocketBindingForWs")),

  extendAll(["WebCrypto", "X509"], "Crypto.prototype.subtle", "CryptoKey", "SubtleCrypto"),
  extendAll(["CryptoObject", "CryptoGlobal"], "Crypto"),
  extendAll(["CryptoGlobal", "CryptoObject"], "crypto"),

  extendAll(
    ["StructuredClone", "RegExp"],
    "structuredClone",
    ...nativeBindings("NewCppFunction", "StructuredClone.cpp", "jsFunctionStructuredCloneAdvanced"),
  ),

  extendAll(["TextDecoder", "LegacyEncodings"], "TextDecoder"),
  extendAll(["TextDecoderStream", "LegacyEncodings", "WebStreams"], "TextDecoderStream"),
  extendAll(["TextEncoder"], "TextEncoder"),
  extendAll(["Base64Globals"], "atob", "btoa"),

  extendAll(
    [...fetchFeatures, ...usesWhen(b.whenOperandStartsWith("input", "s3:", "S3:"), ...s3Features)],
    "Bun.fetch",
    "fetch",
  ),
  extendAll([...fetchFeatures, ...s3Features], "Bun.FetchSession"),

  extendAll(["Url"], "Bun.pathToFileURL", "URL", "URLSearchParams"),
  extendAll(["Events"], "CloseEvent", "CustomEvent", "ErrorEvent", "Event", "MessageEvent"),
  extendAll(abortSignalFeatures, "AbortSignal", "AbortController"),
  extendAll(["Headers"], "Headers"),
  extendAll(["FormData", "Bodies"], "FormData"),
  extendAll(["FormData", "WebStreams", "Bodies"], "Bun.readableStreamToFormData"),

  extendAll(["WebStreams", "Bodies", "FileSink"], "ReadableStream"),
  extendAll(["WebStreams", "Bodies"], "Bun.readableStreamToBlob"),
  extendAll(["WebStreams", ...abortSignalFeatures], "WritableStream", "WritableStreamDefaultController"),
  extendAll(
    ["WebStreams"],
    "%BlobInternalReadableStreamSource%",
    "%BytesInternalReadableStreamSource%",
    "%FileInternalReadableStreamSource%",
    "%NetworkSink%",
    "%ReadableSinkController%",
    "Bun.ArrayBufferSink",
    "Bun.readableStreamToArray",
    "Bun.readableStreamToArrayBuffer",
    "Bun.readableStreamToBytes",
    "Bun.readableStreamToJSON",
    "Bun.readableStreamToText",
    "ByteLengthQueuingStrategy",
    "CountQueuingStrategy",
    "ReadableByteStreamController",
    "ReadableStreamBYOBReader",
    "ReadableStreamBYOBRequest",
    "ReadableStreamDefaultController",
    "ReadableStreamDefaultReader",
    "TextEncoderStream",
    "TransformStream",
    "TransformStreamDefaultController",
    "WritableStreamDefaultWriter",
    ...nativeBindings("NewCppFunction", "streams/BunStreamConsumers.cpp", "jsFunctionTransferToNativeReadableStream"),
  ),

  extendAll(["Bodies"], "Blob", "Bun.embeddedFiles", "File"),
  extendAll(["Bodies", "WebStreams", "FileSink"], "Bun.stderr", "Bun.stdin", "Bun.stdout"),
  extendAll(["Bodies", "WebStreams"], "Request", "Response"),
  extendAll(
    ["Bodies", "WebStreams"],
    "Blob.prototype.stream",
    "Request.prototype.body",
    "Request.prototype.textStream",
    "Response.prototype.body",
    "Response.prototype.textStream",
  ),
  extendAll(
    ["Bodies", "FormData"],
    "Blob.prototype.formData",
    "Request.prototype.formData",
    "Response.prototype.formData",
  ),
  extendAll(["Bodies", "Headers"], "Request.prototype.headers", "Response.prototype.headers"),
  extendAll(["Bodies", ...abortSignalFeatures], "Request.prototype.signal"),
  extendAll(["Bodies", "FsStats"], "Blob.prototype.stat"),
  extendAll(["Bodies", "FileSink"], "Blob.prototype.writer", "console.write"),

  extendAll(serverFeatures, "%DebugHTTPSServer%", "%DebugHTTPServer%", "%HTTPSServer%", "%HTTPServer%", "Bun.serve"),
  extendAll(["Bodies"], "%ServerWebSocket%", "Blob.prototype.image", "Bun.Archive", "Bun.Image"),
  extendAll(["Bodies", "WebStreams"], "Bun.build"),
  extendAll(["Bodies", ...usesWhen(b.whenOperandStartsWith("path", "s3://"), "HttpClient")], "Bun.file"),
  extendAll(["Bodies", ...usesWhen(b.whenOperandStartsWith("destination", "s3://"), "HttpClient")], "Bun.write"),
  extendAll(["HttpClient", "Bodies", "WebStreams"], "Bun.S3Client", "Bun.s3"),
  extendAll(["HttpClient", "WebStreams"], "Bun.Image", "Blob.prototype.image"),
  extendAll(["StructuredClone", "WebStreams"], "%Subprocess%"),
  extendAll(["WebStreams"], "Bun.spawn"),
  extendAll(["WebSocket", "HttpClient", "Events", "Bodies"], "Bun.WebView"),
  extendAll(["Bodies", "Headers", "WebStreams"], "WebAssembly.compileStreaming", "WebAssembly.instantiateStreaming"),

  extendAll(["NodeBufferModule", "Base64Globals"], "node:buffer.atob", "node:buffer.btoa"),
  extendAll(["NodeBufferModule", "Bodies"], "node:buffer.resolveObjectURL"),
  extendAll(["WebCrypto"], ...nativeBindings("Cpp", "node_crypto_binding.cpp", "createNodeCryptoBinding")),
  extendAll(
    ["Bodies", "Headers", "FormData", "WebStreams"],
    ...nativeBindings("Cpp", "NodeFetch.cpp", "createNodeFetchInternalBinding"),
  ),
  extendAll(
    ["Bodies", "Headers", "FormData", "WebStreams", "Url", ...abortSignalFeatures, "WebSocket", "HttpClient"],
    ...nativeBindings("Cpp", "Undici.cpp", "createUndiciInternalBinding"),
  ),

  extendAll(
    ["HttpClient"],
    ...nativeBindings("Bindgen", "headers_jsc.bind.ts", "h2LiveCounts"),
    ...nativeBindings("Bindgen", "headers_jsc.bind.ts", "h3LiveCounts"),
    ...nativeBindings("Bindgen", "proxy_testing.bind.ts", "noProxyMatches", "parseURL", "proxyFor"),
  ),
  extendAll(["WebStreams"], ...nativeBindings("Bindgen", "ByteStream.bind.ts", "cancelOnDrain")),
);
