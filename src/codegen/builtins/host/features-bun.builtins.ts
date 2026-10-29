import * as b from "bun-builtins-table";
import { TLSOptions } from "../../../runtime/socket/SSLConfig.bind.ts";
import { pathOfNativeBinding } from "../paths.ts";
import {
  arrayBufferViewFeatures,
  externalValueFeatures,
  s3RequestFeatures,
  tlsSocketFeatures,
} from "./external-values.ts";

const extendAll = (uses: readonly b.FeatureUseSpec[], ...paths: readonly b.BuiltinPath[]) =>
  paths.flatMap(path => b.extend(path, { usesFeature: [...new Set(uses)] }));

const nativeBindings = (kind: b.NativeCallKind, file: string, ...symbols: readonly string[]) =>
  symbols.map(symbol => pathOfNativeBinding(kind, file, symbol));

const withMembers = (holder: b.BuiltinPath, ...names: readonly string[]) => [
  holder,
  ...names.map(name => `${holder}.${name}`),
];

const runtimeTranspilerFeatures = ["RuntimeTranspiler", "Buffer", "RegExp"];
const interpreterFeatures = ["Interpreter", "BuiltinSourceText", "RegExpUnicodeProperties"];
const serveFeatures = ["Serve", "Cookie", ...tlsSocketFeatures, "NodeHttp"];
const inspectorFeatures = ["Inspector", ...runtimeTranspilerFeatures, "Sockets", ...serveFeatures, "Profilers"];
const bundlerFeatures = [
  "Bundler",
  ...runtimeTranspilerFeatures,
  ...interpreterFeatures,
  "Inspector",
  "CssParser",
  "ReactCompiler",
  "ZstdCompressor",
  "ChildProcess",
  "Temporal",
  "HttpClient",
];
const spawnFeatures = ["Spawn", "Terminal", "ChildProcess", "Buffer"];
const nativeAddonFeatures = ["NativeAddons", "Buffer", ...arrayBufferViewFeatures];

const s3PathUses = (operand: b.OperandName) =>
  s3RequestFeatures.map(feature => ({ feature, when: b.whenOperandStartsWith(operand, "s3://") }));

// One line for each name: the feature is in use where the options may have any of them.
const usesWhenOptionsHave = (names: readonly string[], ...features: readonly b.FeatureName[]) =>
  features.flatMap(feature => names.map(name => ({ feature, when: b.whenOperandHasProperty("options", name) })));

// ServerConfig::from_js reads the TLS options from `tls`.
const serverTlsOptions = ["tls", ...TLSOptions.names];

const externalState = ["ExternalState"];
const viewHeaps = ["TypedArrayStorage", "TypedArrayElements"];

const s3Options = [
  "accessKeyId",
  "acl",
  "bucket",
  "contentDisposition",
  "contentEncoding",
  "endpoint",
  "pageSize",
  "partSize",
  "queueSize",
  "region",
  "requestPayer",
  "retry",
  "secretAccessKey",
  "sessionToken",
  "storageClass",
  "type",
  "virtualHostedStyle",
];

const pathOrDescriptor = b.union(b.string, b.f64);
const bytes = b.union(
  b.instance("TypedArray"),
  b.instance("DataView"),
  b.instance("ArrayBuffer"),
  b.instance("SharedArrayBuffer"),
);

// The store of the file keeps a path that is a buffer, and reads its bytes again when the file is opened.
const pathOfAnyKind = [b.retained, b.readsContents(), b.runs("ToPrimitive")];

// An "s3://" path makes an S3File, whose prototype has members of its own in front of Blob.prototype.
const newFile = b.union(b.instance("Blob"), b.instance("S3File")).fresh;

const newPromiseOf = (value: b.TableType) => b.instance("Promise").holding({ value, reason: b.any }).fresh;

// A file embedded in the executable cannot be written: for its path the promise holds a copy of the input as a Blob.
const byteCountOrCopy = b.union(b.f64, b.instance("Blob")).fresh;

export default b.declarations(
  // collectUsesOfBindingsForTests() gives the feature to every native binding that only these two modules name and that no line lists.
  extendAll(["InternalForTesting"], "bun:internal-for-testing", "internal/test/binding"),
  extendAll(
    ["InternalForTesting", "HttpClient"],
    ...nativeBindings("Bindgen", "install_binding.bind.ts", "installTestHelpers"),
  ),
  extendAll(
    ["InternalForTesting", "Shell"],
    ...nativeBindings("Bindgen", "shell_body.bind.ts", "disabledOnThisPlatform", "shellLex", "shellParse"),
  ),
  extendAll(
    ["InternalForTesting", ...runtimeTranspilerFeatures],
    ...nativeBindings("Bindgen", "checker_queries_testing.bind.ts", "describeCheckerQueries"),
    ...nativeBindings("Bindgen", "code_resolver_testing.bind.ts", "describeCodeGraph", "resolveComputedSpecifier"),
  ),
  extendAll(
    ["InternalForTesting", "Bundler", ...runtimeTranspilerFeatures],
    ...nativeBindings("Bindgen", "FrameworkRouter.bind.ts", "parseRoutePattern"),
    ...nativeBindings("Bindgen", "filesystem_router.bind.ts", "FrameworkFileSystemRouter"),
  ),
  extendAll(
    ["InternalForTesting", "Bundler"],
    ...nativeBindings("Bindgen", "DevServer.bind.ts", "getDeinitCountForTesting"),
    ...nativeBindings("Bindgen", "JSBundler.bind.ts", "workerLiveCount"),
  ),
  extendAll(["InternalForTesting", "ChildProcess"], ...nativeBindings("Bindgen", "patch_testing.bind.ts", "makeDiff")),
  extendAll(
    ["InternalForTesting", "TlsSockets"],
    ...nativeBindings("Bindgen", "SecureContext.bind.ts", "liveCount"),
    ...nativeBindings("Bindgen", "socket_body.bind.ts", "setSocketOptions"),
  ),
  extendAll(
    ["InternalForTesting", "NodeFs"],
    ...nativeBindings(
      "Bindgen",
      "node_fs_binding.bind.ts",
      "createMemfdForTesting",
      "rmOptionsForTesting",
      "stringToFlagsForTesting",
    ),
  ),
  extendAll(["InternalForTesting", "FsStats"], ...nativeBindings("Bindgen", "Stat.bind.ts", "createStatsForIno")),
  extendAll(["InternalForTesting", "Buffer"], ...nativeBindings("Bindgen", "memory_pressure.bind.ts", "psiTrigger")),

  extendAll(["Test", ...runtimeTranspilerFeatures, "DeepEquals"], "Bun.jest", "bun:test", "%Expect%"),
  extendAll(["Test"], ...nativeBindings("Bindgen", "jest.bind.ts", "nodeTestArmFileBoundary", "nodeTestMarkResult")),
  extendAll(
    bundlerFeatures,
    ...nativeBindings(
      "Bindgen",
      "bake_plugins.bind.ts",
      "checkFramework",
      "isRestart",
      "restartProcess",
      "setConfigPlugins",
      "setPages",
    ),
  ),
  extendAll(
    ["Test"],
    "node:test",
    "%ExpectAny%",
    "%ExpectAnything%",
    "%ExpectArrayContaining%",
    "%ExpectCloseTo%",
    "%ExpectCustomAsymmetricMatcher%",
    "%ExpectMatcherContext%",
    "%ExpectMatcherUtils%",
    "%ExpectObjectContaining%",
    "%ExpectStatic%",
    "%ExpectStringContaining%",
    "%ExpectStringMatching%",
    "%ExpectTypeOf%",
    "%ScopeFunctions%",
    "%DoneCallback%",
  ),

  extendAll(["WebView", "ChildProcess", "X509", ...tlsSocketFeatures], "Bun.WebView"),
  extendAll(["OpenInEditor", "ChildProcess"], "Bun.openInEditor"),
  extendAll(["Unsafe"], "Bun.unsafe"),

  extendAll(
    ["Ffi", ...nativeAddonFeatures],
    "Bun.FFI",
    ...nativeBindings("Bindgen", "ffi.bind.ts", "cc", "closeCallback"),
  ),
  extendAll(["Ffi"], "bun:ffi", "%FFI%"),

  extendAll(["Plugin", ...runtimeTranspilerFeatures], "Bun.plugin"),

  extendAll(["FileSystemRouter", ...runtimeTranspilerFeatures], "Bun.FileSystemRouter"),
  extendAll(["FileSystemRouter"], "%MatchedRoute%"),

  extendAll(["Cron", "ChildProcess"], "Bun.cron"),
  extendAll(["Cron"], "%CronJob%"),

  extendAll(["Secrets"], ...withMembers("Bun.secrets", "delete", "get", "set")),

  extendAll(["Shell", "ChildProcess", "Buffer"], "Bun.$", "%ShellInterpreter%"),
  extendAll(["Shell"], "%ParsedShellScript%"),

  extendAll(["Color"], "Bun.color"),
  extendAll(["Markdown", "StringHTML"], ...withMembers("Bun.markdown", "ansi", "html", "react", "render")),
  extendAll(["Xml"], "Bun.XML"),
  extendAll(["Json5"], "Bun.JSON5"),
  extendAll(["Jsonc"], "Bun.JSONC"),
  extendAll(["Jsonl"], ...withMembers("Bun.JSONL", "parse", "parseChunk")),
  extendAll(["Yaml"], "Bun.YAML"),
  extendAll(["Toml", "Temporal"], "Bun.TOML"),

  extendAll(["Archive", "LibdeflateCompressor", "Buffer"], "Bun.Archive"),
  extendAll(["Archive"], ...nativeBindings("Bindgen", "pack_command.bind.ts", "readTarball")),

  extendAll(["Semver"], "Bun.semver"),
  extendAll(["Ansi", "StringWidth"], "Bun.sliceAnsi", "Bun.wrapAnsi"),
  extendAll(["EscapeHtml"], "Bun.escapeHTML"),
  extendAll(["Hash"], "Bun.hash"),
  extendAll(["Uuid", "Buffer"], "Bun.randomUUIDv5", "Bun.randomUUIDv7"),
  extendAll(["Csrf"], "Bun.CSRF"),
  extendAll(["Password"], "Bun.password"),
  extendAll(
    ["Hashers", "Buffer"],
    "Bun.sha",
    "Bun.MD4",
    "Bun.MD5",
    "Bun.SHA1",
    "Bun.SHA224",
    "Bun.SHA256",
    "Bun.SHA384",
    "Bun.SHA512",
    "Bun.SHA512_256",
  ),

  extendAll(
    ["Sqlite", "SqliteExtensions", "Buffer"],
    "node:sqlite",
    ...nativeBindings("Cpp", "JSSQLStatement.cpp", "createJSSQLStatementConstructor"),
  ),
  extendAll(["Sqlite"], "bun:sqlite"),

  extendAll(
    ["Sql", "X509", ...tlsSocketFeatures, "Int32Array", "Float32Array"],
    ...nativeBindings("Bindgen", "postgres.bind.ts", "binding"),
    ...nativeBindings("Bindgen", "mysql.bind.ts", "binding"),
  ),
  extendAll(
    ["Sql"],
    "Bun.sql",
    "Bun.SQL",
    "bun:sql",
    "%PostgresSQLConnection%",
    "%PostgresSQLQuery%",
    "%MySQLConnection%",
    "%MySQLQuery%",
  ),

  extendAll(
    ["CompressionFunctions", "Buffer"],
    "Bun.gunzipSync",
    "Bun.inflateSync",
    "Bun.zstdDecompress",
    "Bun.zstdDecompressSync",
  ),
  extendAll(
    ["BunZstdCompress", "CompressionFunctions", "ZstdCompressor", "Buffer"],
    "Bun.zstdCompress",
    "Bun.zstdCompressSync",
  ),
  extendAll(
    ["BunDeflate", "CompressionFunctions", "LibdeflateCompressor", "Buffer"],
    "Bun.gzipSync",
    "Bun.deflateSync",
  ),

  extendAll(["BunJsc"], "bun:jsc"),
  extendAll(["BunJsc", ...externalValueFeatures], "bun:jsc.serialize", "bun:jsc.deserialize"),
  extendAll(["BunJsc", ...inspectorFeatures], "bun:jsc.startRemoteDebugger"),
  extendAll(
    ["BunJsc", "Profilers"],
    "bun:jsc.codeCoverageForFile",
    "bun:jsc.generateHeapSnapshotForDebugging",
    "bun:jsc.profile",
    "bun:jsc.samplingProfilerStackTraces",
    "bun:jsc.startSamplingProfiler",
  ),
  extendAll(["BunJsc"], "node:v8"),

  extendAll(["ModuleGraph"], "Bun.ModuleGraph"),
  extendAll(["Valkey", "X509", ...tlsSocketFeatures, "FileSink"], "Bun.redis", "Bun.RedisClient"),

  extendAll([...runtimeTranspilerFeatures, ...interpreterFeatures], "Bun.Transpiler", "Bun.registerMacro"),

  extendAll(bundlerFeatures, "Bun.build"),
  extendAll(["Bundler"], "%HTMLBundle%", "%FrameworkFileSystemRouter%", "%BuildArtifact%"),

  extendAll(nativeAddonFeatures, "process.dlopen"),
  extendAll(["Terminal", "Buffer"], "Bun.Terminal"),
  extendAll(["CryptoHasher", "Buffer"], "Bun.CryptoHasher"),

  extendAll(
    [
      "Udp",
      "Buffer",
      "Int8Array",
      "Int16Array",
      "Uint16Array",
      "Int32Array",
      "Uint32Array",
      "Float16Array",
      "Float32Array",
      "Float64Array",
    ],
    "Bun.udpSocket",
  ),
  extendAll(
    ["Udp"],
    "node:dgram",
    "internal/dgram",
    "%UDPSocket%",
    ...nativeBindings(
      "Bindgen",
      "udp_socket.bind.ts",
      "bufferSize",
      "connect",
      "dgramAdoptFd",
      "dgramBindFd",
      "dgramCloseFd",
      "dgramGetSockNameFd",
      "dgramGuessHandleType",
      "dgramIsFdAdopted",
      "dgramListenFd",
      "dgramNewSocketFd",
      "disconnect",
      "getFd",
    ),
  ),

  extendAll(
    ["DeepEquals", "Buffer"],
    "Bun.deepEquals",
    "Bun.deepMatch",
    ...nativeBindings(
      "NewCppFunction",
      "NodeUtilTypesModule.cpp",
      "jsFunctionIsDeepStrictEqual",
      "jsFunctionPartialDeepStrictEqual",
    ),
  ),

  // Other features need Spawn, so it stays in programs that name neither function. What guards the function is a feature that only its name keeps.
  extendAll(["BunSpawnSync", ...spawnFeatures], "Bun.spawnSync"),
  extendAll(["Spawn"], "%Subprocess%", "%ResourceUsage%"),
  extendAll(["BunSpawn", ...spawnFeatures, ...externalValueFeatures], "Bun.spawn"),

  extendAll(
    ["Sockets", "X509", ...tlsSocketFeatures],
    "Bun.listen",
    "Bun.connect",
    ...nativeBindings("Bindgen", "node_net_binding.bind.ts", "newDetachedSocket"),
    ...nativeBindings("Bindgen", "socket_body.bind.ts", "upgradeTLSDeferred"),
    ...nativeBindings("Bindgen", "node_net_binding.bind.ts", "doConnect"),
    ...nativeBindings("Bindgen", "socket_body.bind.ts", "upgradeDuplexToTLS"),
  ),
  extendAll(["Sockets", ...tlsSocketFeatures], "%TCPSocket%"),
  extendAll(
    ["Sockets"],
    "%Listener%",
    ...nativeBindings("Bindgen", "socket_body.bind.ts", "getBufferedAmount", "isNamedPipeSocket"),
  ),

  extendAll(
    ["Dns"],
    ...withMembers(
      "Bun.dns",
      "getCacheStats",
      "getServers",
      "lookup",
      "lookupService",
      "prefetch",
      "resolve",
      "resolveAny",
      "resolveCaa",
      "resolveCname",
      "resolveMx",
      "resolveNaptr",
      "resolveNs",
      "resolvePtr",
      "resolveSoa",
      "resolveSrv",
      "resolveTxt",
      "reverse",
      "setServers",
    ),
    "node:dns",
    "node:dns/promises",
    "%DNSResolver%",
    ...nativeBindings("Bindgen", "dns_internals.bind.ts", "getRuntimeDefaultResultOrderOption"),
    ...nativeBindings("Bindgen", "dns_internals.bind.ts", "newResolver"),
  ),

  extendAll(
    ["BunUtilities"],
    "Bun.stripANSI",
    "Bun.mmap",
    "Bun.which",
    "Bun.indexOfLine",
    "Bun.sleep",
    "Bun.sleepSync",
    "Bun.gc",
    "Bun.shrink",
    "Bun.allocUnsafe",
    "Bun.nanoseconds",
    "Bun.peek",
    "Bun.concatArrayBuffers",
  ),

  extendAll(["Image", ...s3RequestFeatures], "Bun.Image", "Blob.prototype.image"),
  extendAll(["Cookie"], "Bun.Cookie", "Bun.CookieMap", "%BunRequest%.prototype.cookies"),
  extendAll(["Glob"], "Bun.Glob"),
  extendAll(
    ["StringWidth"],
    "Bun.stringWidth",
    ...nativeBindings("NewCppFunction", "stringWidth.cpp", "jsFunctionBunStringWidth"),
  ),

  extendAll(s3RequestFeatures, "Bun.s3", "Bun.S3Client"),
  extendAll(["S3Client"], "%S3Stat%"),

  extendAll(tlsSocketFeatures, ...nativeBindings("Bindgen", "SecureContext.bind.ts", "SecureContext")),
  extendAll(["TlsSockets", "X509"], "%TLSSocket%"),
  extendAll(["TlsSockets"], "node:tls", "%SecureContext%", "%HTTPSServer%", "%DebugHTTPSServer%"),

  extendAll(
    ["Tls"],
    ...nativeBindings("Bindgen", "Listener.bind.ts", "addServerName", "setSecureContext"),
    ...nativeBindings(
      "Bindgen",
      "socket_body.bind.ts",
      "checkServerIdentityInHandshake",
      "firstFlightBeforeFin",
      "releaseHeldFlight",
    ),
    ...nativeBindings(
      "NewCppFunction",
      "NodeTLS.cpp",
      "getBundledRootCertificates",
      "getExtraCACertificates",
      "loadExtraCACertificates",
      "parseCACertificates",
      "selectServerName",
    ),
  ),
  extendAll(
    ["Tls", "SystemCaCertificates"],
    ...nativeBindings("NewCppFunction", "NodeTLS.cpp", "getSystemCACertificates"),
  ),

  // reload() changes none of these: the server stays what its first options made it.
  extendAll(
    [
      "Serve",
      "Cookie",
      "Buffer",
      "BunInfo",
      ...usesWhenOptionsHave(serverTlsOptions, "TlsSockets", "Tls"),
      ...usesWhenOptionsHave(["http2", "http3"], "ServeHttp2"),
      ...usesWhenOptionsHave(["http3"], "Http3"),
      ...usesWhenOptionsHave(["onNodeHTTPRequest"], "NodeHttp"),
      ...usesWhenOptionsHave(["app"], ...bundlerFeatures.filter(feature => feature !== "Buffer")),
    ],
    "Bun.serve",
  ),
  extendAll(["Serve"], "%HTTPServer%", "%DebugHTTPServer%", "%ServerWebSocket%"),

  b.fn("Bun.file", [
    {
      args: { path: pathOrDescriptor, options: b.primitiveValue.optional },
      returns: newFile,
      capability: "heap",
      throws: true,
      reads: externalState,
      usesFeature: ["BunFile", ...s3PathUses("path")],
      implementation: b.hostCall,
    },
    {
      args: { path: b.any, options: b.any.optional },
      returns: newFile,
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      uses: { path: pathOfAnyKind, options: b.hostOptionBag(["lastModified", ...s3Options]) },
      reads: [...viewHeaps, ...externalState],
      // A view that is kept as the path gets an ArrayBuffer, and its bytes move there.
      writes: ["TypedArrayStorage"],
      implementation: b.hostCall,
    },
  ]),
  b.fn("Bun.write", [
    {
      args: {
        destination: b.union(pathOrDescriptor, b.instance("Blob")),
        input: b.union(b.string, bytes),
        options: b.null.optional,
      },
      returns: newPromiseOf(byteCountOrCopy),
      capability: "heap",
      throws: true,
      uses: { destination: b.inspected, input: [b.readAsCharacters, b.readsContents()] },
      reads: externalState,
      writes: externalState,
      usesFeature: ["BunFile", ...s3PathUses("destination")],
      implementation: b.hostCall,
    },
    {
      args: { destination: b.any, input: b.any, options: b.any.optional },
      returns: newPromiseOf(b.any),
      capability: "js",
      throws: true,
      uses: {
        destination: pathOfAnyKind,
        input: [
          b.retained,
          b.readsContents(),
          b.runsTransitively("OwnValues", "PrototypeChain", "ToPrimitive", b.named("length")),
        ],
        options: b.hostOptionBag(["createPath", "mode", ...s3Options]),
      },
      reads: [...viewHeaps, ...externalState],
      writes: externalState,
      implementation: b.hostCall,
    },
  ]),

  extendAll(["FileSink"], "%FileSink%"),

  extendAll(["WebAssembly"], "node:wasi"),

  extendAll(inspectorFeatures, ...nativeBindings("NewCppFunction", "BunDebugger.cpp", "jsFunction_openNodeInspector")),
  extendAll(
    ["Inspector"],
    "node:inspector",
    "node:inspector/promises",
    ...nativeBindings(
      "NewCppFunction",
      "BunDebugger.cpp",
      "jsFunction_closeNodeInspector",
      "jsFunction_postNodeInspectorControl",
      "jsFunction_waitForNodeInspectorConnection",
    ),
  ),

  extendAll(
    ["Profilers"],
    "Bun.generateHeapSnapshot",
    ...nativeBindings(
      "NewCppFunction",
      "JSInspectorProfiler.cpp",
      "jsFunction_collectPreciseCoverage",
      "jsFunction_isCPUProfilerRunning",
      "jsFunction_setCPUSamplingInterval",
      "jsFunction_startCPUProfiler",
      "jsFunction_startPreciseCoverage",
      "jsFunction_stopCPUProfiler",
      "jsFunction_stopPreciseCoverage",
    ),
  ),
);
