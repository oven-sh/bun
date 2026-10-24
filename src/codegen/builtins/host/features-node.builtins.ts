import * as b from "bun-builtins-table";
import { pathOfNativeBinding } from "../paths.ts";

const extendAll = (uses: readonly b.FeatureUseSpec[], ...paths: readonly b.BuiltinPath[]) =>
  paths.flatMap(path => b.extend(path, { usesFeature: uses }));

const nativeBindings = (kind: b.NativeCallKind, file: string, ...symbols: readonly string[]) =>
  symbols.map(symbol => pathOfNativeBinding(kind, file, symbol));

export default b.declarations(
  extendAll(
    ["NodeQuic", "TlsSockets", "X509", "Tls", "NetAddresses", "Buffer"],
    ...nativeBindings("Bindgen", "node_quic_binding.bind.ts", "binding"),
  ),
  extendAll(["NodeQuic"], "node:quic", "%QuicEndpoint%", "%QuicSession%", "%QuicStream%"),

  extendAll(["NodeHttp2", "Buffer"], ...nativeBindings("Bindgen", "h2_frame_parser.bind.ts", "H2FrameParser")),
  extendAll(["NodeHttp2"], "node:http2", "%H2FrameParser%"),

  extendAll(
    ["NodeAssert"],
    ...nativeBindings("Bindgen", "node_assert_binding.bind.ts", "myersDiff", "printMyersDiff", "printSimpleMyersDiff"),
  ),

  extendAll(
    ["NodeVm", "RuntimeTranspiler", "Buffer", "RegExp", "BuiltinSourceText"],
    ...nativeBindings("Cpp", "NodeVM.cpp", "Bun::createNodeVMBinding"),
  ),
  extendAll(["NodeVm"], "node:vm"),

  extendAll(["DataFileLoaders"], "node:module._load"),

  extendAll(
    ["NodeZlib"],
    "%NativeZlib%",
    ...nativeBindings("Bindgen", "node_zlib_binding.bind.ts", "crc32"),
    ...nativeBindings("Bindgen", "node_zlib_binding.bind.ts", "NativeZlib"),
  ),
  extendAll(
    ["NodeZlibBrotli", "BrotliEncoder", "BrotliDecoder", "NodeZlib"],
    "%NativeBrotli%",
    ...nativeBindings("Bindgen", "node_zlib_binding.bind.ts", "NativeBrotli"),
  ),
  extendAll(
    ["NodeZlibZstd", "ZstdCompressor", "NodeZlib"],
    "%NativeZstd%",
    ...nativeBindings("Bindgen", "node_zlib_binding.bind.ts", "NativeZstd"),
  ),

  extendAll(
    ["Histogram"],
    ...nativeBindings("NewCppFunction", "JSNodePerformanceHooksHistogram.cpp", "jsFunction_createHistogram"),
    ...nativeBindings(
      "NewCppFunction",
      "JSNodePerformanceHooksHistogramPrototype.cpp",
      "jsFunction_disableEventLoopDelay",
      "jsFunction_enableEventLoopDelay",
      "jsFunction_monitorEventLoopDelay",
    ),
  ),

  extendAll(["NodeV8"], ...nativeBindings("Cpp", "NodeV8.cpp", "Bun::createNodeV8Binding")),
  extendAll(["ParseArgs"], ...nativeBindings("Bindgen", "parse_args.bind.ts", "parseArgs")),

  extendAll(
    ["NodeCrypto", "X509", "Buffer"],
    ...nativeBindings("Cpp", "node_crypto_binding.cpp", "createNodeCryptoBinding"),
  ),
  extendAll(["NodeCrypto", "Buffer"], ...nativeBindings("Bindgen", "node_crypto_binding.bind.ts", "crypto")),
  extendAll(["NodeCrypto"], "node:crypto"),

  extendAll(
    ["NodeOs"],
    ...nativeBindings(
      "Bindgen",
      "node_os.bind.ts",
      "cpus",
      "freemem",
      "getPriority",
      "homedir",
      "hostCpuCount",
      "hostname",
      "loadavg",
      "networkInterfaces",
      "release",
      "setPriority",
      "totalmem",
      "uptime",
      "userInfo",
      "version",
    ),
  ),

  extendAll(
    ["NodeFs", "FsStats", "Buffer"],
    "%NodeJSFS%",
    ...nativeBindings("Bindgen", "node_fs_binding.bind.ts", "binding"),
  ),
  extendAll(["NodeFs", "FsStats"], "%StatWatcher%"),
  extendAll(["NodeFs"], "%FSWatcher%"),

  extendAll(
    ["HttpParser"],
    "node:_http_common",
    "node:_http_client",
    "node:_http_server",
    "internal/http1_server_fallback",
  ),

  extendAll(["StringDecoder", "Buffer"], "node:string_decoder"),

  extendAll(
    ["NodeCluster"],
    ...nativeBindings(
      "Bindgen",
      "node_cluster_binding.bind.ts",
      "channelIgnoreOneDisconnectEventListener",
      "clusterCloseHandle",
      "clusterValidateFd",
      "onInternalMessageChild",
      "onInternalMessagePrimary",
      "setRef",
    ),
    ...nativeBindings("Bindgen", "node_cluster_binding.bind.ts", "clusterRawBind", "sendHelperPrimary"),
  ),

  extendAll(["NodeUrl"], ...nativeBindings("Cpp", "NodeURL.cpp", "Bun::createNodeURLBinding")),

  extendAll(["NodeHttp", "Buffer"], ...nativeBindings("Cpp", "NodeHTTP.cpp", "createNodeHTTPInternalBinding")),
  extendAll(
    ["NodeHttp"],
    "%NodeHTTPResponse%",
    ...nativeBindings(
      "Bindgen",
      "node_http_binding.bind.ts",
      "getBunServerOpenCount",
      "insecureHTTPParser",
      "getMaxHTTPHeaderSize",
      "sendWebSocketFrame",
      "setMaxHTTPHeaderSize",
      "upgradeNodeHTTPResponseToWebSocket",
    ),
    ...nativeBindings("Bindgen", "node_http_binding.bind.ts", "getBunServerAllClosedPromise"),
  ),

  extendAll(
    ["NetAddresses"],
    "%BlockList%",
    "%SocketAddress%",
    ...nativeBindings("Bindgen", "BlockList.bind.ts", "BlockList"),
    ...nativeBindings("Bindgen", "SocketAddress.bind.ts", "SocketAddress"),
  ),

  extendAll(
    ["NodePath"],
    ...nativeBindings(
      "Bindgen",
      "node_path.bind.ts",
      "basenamePosix",
      "dirnamePosix",
      "extnamePosix",
      "formatPosix",
      "isAbsolutePosix",
      "joinPosix",
      "normalizePosix",
      "parsePosix",
      "relativePosix",
      "resolvePosix",
      "toNamespacedPathPosix",
      "basenameWin32",
      "dirnameWin32",
      "extnameWin32",
      "formatWin32",
      "isAbsoluteWin32",
      "joinWin32",
      "normalizeWin32",
      "parseWin32",
      "relativeWin32",
      "resolveWin32",
      "toNamespacedPathWin32",
    ),
  ),

  extendAll(
    ["NodeValidators"],
    ...nativeBindings(
      "Bindgen",
      "node_validators.bind.ts",
      "checkRangesOrGetDefault",
      "validateAbortSignal",
      "validateArray",
      "validateBuffer",
      "validateEncoding",
      "validateFiniteNumber",
      "validateInt32",
      "validateInteger",
      "validateNumber",
      "validateObject",
      "validateOneOf",
      "validatePort",
      "validateUint32",
    ),
  ),

  extendAll(
    ["NodeUtil"],
    ...nativeBindings(
      "Bindgen",
      "node_util_binding.bind.ts",
      "assertEncodingValid",
      "ecanceledErrorCode",
      "enobufsErrorCode",
      "etimedoutErrorCode",
      "extractedSplitNewLinesFastPathStringsOnly",
      "internalErrorEntries",
      "internalErrorName",
      "normalizeEncoding",
      "parseEnv",
      "uvTranslateSysError",
    ),
    ...nativeBindings("NewCppFunction", "JSEventTarget.cpp", "jsEventTargetGetEventListenersCount"),
    ...nativeBindings("NewCppFunction", "JSEventTargetNode.cpp", "jsFunctionNodeEventsGetEventListeners"),
    ...nativeBindings("NewCppFunction", "NodeUtilTypesModule.cpp", "jsFunctionIsError"),
    ...nativeBindings("NewCppFunction", "UtilInspect.cpp", "jsFunctionGetOwnNonIndexProperties"),
  ),

  extendAll(["NodeSmallModules"], "node:util/types", "node:constants"),

  extendAll(["Buffer"], "Buffer", "internal/stream", "internal/streams/legacy", "internal/streams/readable"),
  extendAll(["NodeBufferModule", "Buffer"], "node:buffer"),

  extendAll(["NodeFetch"], "node-fetch", ...nativeBindings("Cpp", "NodeFetch.cpp", "createNodeFetchInternalBinding")),

  extendAll(
    ["Undici", "TlsSockets", "X509", "Tls", "Buffer"],
    ...nativeBindings("Cpp", "Undici.cpp", "createUndiciInternalBinding"),
  ),

  extendAll(["NodeEvents"], "node:events"),
  extendAll(["NodeRepl"], "node:repl"),
);
