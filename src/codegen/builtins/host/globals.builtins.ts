import * as b from "bun-builtins-table";
import {
  argumentsCell,
  environmentCell,
  formatsStackCell,
  framesOfModuleGraphsCell,
  functionOfTimersPromisesCell,
  moduleGraphsCell,
  overriddenMainCell,
  performanceTimingCell,
  requestHandlerCell,
  serverOptionsCell,
  standardBlobCell,
  targetsOfEventsCell,
  timelineHandlerCell,
  timerArgumentsCell,
  timerCallbackCell,
  timerFieldsCell,
  webSocketDataCell,
  webSocketHandlerCell,
  webSocketsCell,
} from "./native-cells.ts";
import {
  answering,
  comparedDeeply,
  deepComparison,
  handedOver,
  matchedDeeply,
  mayAnswerWrapperKeptIn,
  promiseOf,
} from "./native-code.ts";
import { convertedToString, iterated, sequencesOfTLSOptions, socketOptions, tlsOptionNames } from "./socket-options.ts";

type Contents = Readonly<Record<string, b.TableType>>;
type UsesByOperand = Readonly<Record<string, readonly b.UseSpec[]>>;

const externalState = ["ExternalState"];
const viewHeaps = ["TypedArrayStorage", "TypedArrayElements"];
const longestDelayWithoutWarning = 2 ** 31 - 1;
const widestString = 2 ** 32;

// `_onTimeout` of the timer answers the callback.
const scheduled = (times: b.CallbackTimes) => ({
  callback: [
    b.storedIn(b.nativeCell(timerCallbackCell)),
    b.called({
      afterwards: "TouchesOnlyWhatRowNames",
      times,
      args: [],
      this: b.result,
      spreadArgs: b.operand("passed"),
      result: "Ignored",
    }),
  ],
  passed: [b.storedIn(b.nativeCell(timerArgumentsCell))],
});

const timerAfterDelay = (times: b.CallbackTimes, delay: b.TableType, capability: b.Capability) =>
  ({
    args: { callback: b.callable, delay, passed: b.any.rest },
    returns: b.instance("Timeout").fresh,
    capability,
    throws: true,
    uses: scheduled(times),
    reads: externalState,
    writes: externalState,
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

const delayedTimer = (times: b.CallbackTimes) => [
  timerAfterDelay(times, b.int(0, longestDelayWithoutWarning).optional, "heap"),
  timerAfterDelay(times, b.f64.loose.optional, "js"),
];

// NodeTimers.cpp: the getter loads node:timers/promises and answers what the object of the module holds under the name of the timer. It does not look at its receiver.
const answersFunctionOfTimersPromises = (timer: string) =>
  ({
    this: b.any,
    getter: b.any,
    capability: "js",
    throws: true,
    uses: { this: [b.returnedFrom(functionOfTimersPromisesCell(timer))] },
    implementation: b.generic,
  }) satisfies b.GetterField;

const timerCancellation = {
  args: { timer: b.any.optional },
  capability: "heap",
  uses: { timer: b.inspected },
  reads: externalState,
  writes: externalState,
  implementation: b.hostCall,
} satisfies b.FunctionField;

const arrayBufferView = b.union(b.instance("TypedArray"), b.instance("DataView"));
const anyArrayBuffer = b.union(b.instance("ArrayBuffer"), b.instance("SharedArrayBuffer"));
const byteSource = b.union(arrayBufferView, anyArrayBuffer);
const parsedJSON = b.union(b.plainData, b.strictNull, b.bool, b.f64, b.string);

const newArrayOf = (elements: b.TableType) => b.instance("Array").holding({ element: elements }).fresh;
const newPromiseHolding = (contents: Contents) => b.instance("Promise").holding(contents).fresh;
// The reason may be an error that native code makes, with members of its own (`code`, `errno`, `syscall`). A handler that is given to catch() or then() gets it, so it is no `never`.
const settledWithAnyReason = (value: b.TableType) => newPromiseHolding({ value, reason: b.any });

const operandCodeOnly = { capability: "js", runsOnlyOperandCode: true } as const;

// The clock moves between two readings with no store in between. The write keeps each reading where it is written.
// Compiled code enters a function that takes the realm alone and answers a number that is not boxed: no frame is made for a call without operands that cannot throw.
const clockReading = (symbol: string) =>
  ({
    returns: b.f64,
    capability: "none",
    reads: externalState,
    writes: externalState,
    implementation: b.hostCall,
    directEntry: {
      symbol,
      declaration: `extern "C" SYSV_ABI double ${symbol}(JSC::JSGlobalObject*);`,
      headers: [],
      parameters: [{ value: "Realm", cppType: "JSC::JSGlobalObject*" }],
      returnsNumber: true,
    },
  }) satisfies b.FunctionField;

const characters = b.inspected;
const converted = [b.runs("ToPrimitive")];
// Native code that asks whether a value is a string says yes to a String object, and runs the object's own toString.
const stringOrStringObject = b.union(b.string, b.instance("String"));
const membersInspected = (...names: readonly string[]) => [b.runs(b.named(...names)), b.membersOnlyInspected];

// The message of an error about a refused value reads its constructor.name, or prints it the way console.log does.
const describedAfterReading = (...names: readonly string[]) => [b.printedByFormatter("constructor", ...names)];
const describedInErrorMessage = describedAfterReading();

const refusal = (operand: string, implementation: b.ImplementationSpec = b.hostCall) =>
  ({
    ...operandCodeOnly,
    args: { [operand]: b.any.optional },
    returns: b.never,
    throws: true,
    uses: { [operand]: describedInErrorMessage },
    implementation,
  }) satisfies b.FunctionField;

// Native code calls a handler later and with another `this`, as it may call every function that it keeps.
const keptByNativeCode = (readMembers: readonly string[], calledMembers: readonly string[]) => [
  b.retained,
  b.reachableValuesStoredIn(b.nativeMemory),
  b.runsTransitively(
    "OwnKeys",
    "OwnValues",
    "PrototypeChain",
    "Iterate",
    "ToPrimitive",
    b.named(...readMembers),
    ...(calledMembers.length > 0 ? [b.calls(...calledMembers)] : []),
  ),
];

// Native code copies what it reads out of the options. Each function that it calls has a b.memberCalled of its own, which says its `this`, and each sequence a b.memberCalled of its iterator.
const readAndKeptIn = (cell: string, readMembers: readonly string[]) => [
  b.storedIn(b.nativeCell(cell)),
  b.reachableValuesStoredIn(b.nativeCell(cell)),
  b.runsTransitively("OwnKeys", "OwnValues", "PrototypeChain", "ToPrimitive", b.named(...readMembers)),
  b.functionsConvertedUnderNamesOnly,
];

const listenerRegistration = (eventTarget: b.TableType) =>
  ({
    args: { type: b.string.loose, listener: b.object.nullable, options: b.any.optional },
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: {
      this: [b.retained],
      type: b.inspected,
      listener: [
        b.retained,
        // dispatchEvent hands the listener the event that it was handed.
        b.called({
          afterwards: "TouchesOnlyWhatRowNames",
          times: "PerEvent",
          this: eventTarget,
          args: [b.object],
          result: "Escapes",
        }),
        b.runs(b.calls("handleEvent")),
      ],
      options: [b.runs(b.named("capture", "once", "passive", "signal")), b.contentsStoredIn(b.nativeMemory)],
    },
    reads: externalState,
    writes: externalState,
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

// A call with fewer than two arguments throws before it converts the type.
const listenerRemoval = {
  ...operandCodeOnly,
  args: { type: b.any.optional, listener: b.object.nullable, options: b.any.optional },
  throws: true,
  uses: { type: converted, listener: b.inspected, options: membersInspected("capture") },
  reads: externalState,
  writes: externalState,
  implementation: b.hostCall,
} satisfies b.FunctionField;

const eventHandlerAttribute = (eventTarget: b.TableType) =>
  ({
    getter: b.any,
    capability: "heap",
    uses: { this: b.inspected },
    reads: externalState,
    implementation: b.generic,
    setter: {
      value: b.any,
      capability: "heap",
      uses: {
        this: [b.retained],
        value: [
          b.retained,
          b.called({
            afterwards: "TouchesOnlyWhatRowNames",
            times: "PerEvent",
            args: [],
            this: eventTarget,
            spreadArgs: b.any,
            result: "Escapes",
          }),
        ],
      },
      writes: externalState,
      implementation: b.generic,
    },
  }) satisfies b.GetterField;

// JSEventListener.cpp, eventHandlerAttribute(): it answers the object that was stored last, and null after anything else.
const eventHandlerAttributeKeptIn = (cell: string, eventTarget: b.TableType) => {
  const attribute = eventHandlerAttribute(eventTarget);
  const { uses } = attribute.setter;
  return {
    ...attribute,
    getter: b.null,
    uses: { this: [b.returnedFrom(cell)] },
    setter: { ...attribute.setter, uses: { ...uses, value: [...uses.value, b.storedIn(b.nativeCell(cell))] } },
  } satisfies b.GetterField;
};

const receiver = b.operand("this");
const globalObject = b.builtin("globalThis");

// The listeners that were added earlier run, with the event and the target, and the event keeps the target.
// What stands for the global object there is an object of the host.
const eventDispatch = (eventTarget: b.TableType) =>
  ({
    args: { event: b.object },
    returns: b.bool,
    capability: "js",
    throws: true,
    uses: {
      this: [
        b.retained,
        eventTarget === receiver
          ? b.storedIn(b.nativeCell(targetsOfEventsCell))
          : b.createdIn(b.object, b.nativeCell(targetsOfEventsCell)),
      ],
      event: [b.retained],
    },
    reads: externalState,
    writes: externalState,
  }) satisfies b.FunctionField;
// What `bun:test` exports. The table lists the members that the compiler has to know, so the object counts as one that nobody knows as well.
const testModule = b.union(b.builtin("bun:test"), b.object);

// `performance` has one property of its own, now. The rest lies on Performance.prototype and on EventTarget.prototype above it.
const timeline = b.union(b.builtin("performance"), b.instance("Performance"));
const timelineFeatures: readonly b.FeatureUseSpec[] = ["PerformanceTimeline"];

const heapsReadByClone = [
  "TypedArrayStorage",
  "TypedArrayElements",
  "CollectionStorage",
  "CollectionEntries",
  "InternalFields",
  "ExternalState",
];
const heapsWrittenByTransfer = ["TypedArrayStorage", "TypedArrayElements", "ExternalState"];
// A view that keeps its bytes in its cell gets a buffer.
const heapsWrittenByClone = ["TypedArrayStorage", "ExternalState"];
const membersReadByClone = ["name", "message", "stack", "cause"];
const cloned = [
  b.readsContents(),
  b.runsTransitively("OwnKeys", "OwnValues", "PrototypeChain", "ToPrimitive", b.named(...membersReadByClone)),
];
const transferList = [b.runsTransitively(b.named("transfer"), "Iterate"), b.writesContents()];
const optionsWithClonedDetail = (...names: readonly string[]) => [
  b.readsContents(),
  b.runsTransitively("OwnKeys", "OwnValues", "PrototypeChain", "ToPrimitive", b.named(...membersReadByClone, ...names)),
];

const timelineOperation = (signature: b.SignatureOptions) =>
  ({
    throws: true,
    reads: externalState,
    writes: externalState,
    ...signature,
    this: timeline,
    uses: { this: b.inspected, ...signature.uses },
    implementation: b.generic,
  }) satisfies b.FunctionField;

// getEntries answers the object that mark or measure returned, and an observer is handed it too. It is a PerformanceMark, a PerformanceMeasure or a PerformanceResourceTiming.
const timelineEntry = b.instance("PerformanceEntry");
const timelineEntries = newArrayOf(timelineEntry);

// `timing` and toJSON() hand out one object, which the first of them makes.
const madeAtFirstRequest = b.createdIn(b.instance("PerformanceTiming").fresh, b.nativeCell(performanceTimingCell));

// JSPerformanceTimingPrototypeTableValues in webcore/JSPerformanceTiming.cpp.
const momentsOfPageLoad = [
  "navigationStart",
  "unloadEventStart",
  "unloadEventEnd",
  "redirectStart",
  "redirectEnd",
  "fetchStart",
  "domainLookupStart",
  "domainLookupEnd",
  "connectStart",
  "connectEnd",
  "secureConnectionStart",
  "requestStart",
  "responseStart",
  "responseEnd",
  "domLoading",
  "domInteractive",
  "domContentLoadedEventStart",
  "domContentLoadedEventEnd",
  "domComplete",
  "loadEventStart",
  "loadEventEnd",
];

const removesTimelineEntries = timelineOperation({
  ...operandCodeOnly,
  args: { name: b.any.optional },
  uses: { name: converted },
});

const dialog = (returns: b.TableType) =>
  ({
    args: { message: b.string.loose.optional },
    returns,
    capability: "heap",
    throws: true,
    reads: externalState,
    writes: externalState,
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

const textTransformation = {
  args: { input: b.string.loose },
  returns: b.string,
  capability: "heap",
  throws: true,
  uses: { input: characters },
  deterministic: true,
  implementation: b.hostCall,
} satisfies b.FunctionField;

// A call without an argument throws.
const base64Coding = { ...textTransformation, args: { input: b.string.loose.optional } } satisfies b.FunctionField;

const measuredWidth = {
  returns: b.int(0, widestString),
  throws: true,
  implementation: b.hostCall,
} satisfies Partial<b.FunctionField>;

const stringWidth = [
  {
    ...measuredWidth,
    args: { input: b.string.loose.optional, options: b.primitiveValue.optional },
    capability: "heap",
    uses: { input: characters },
  },
  {
    ...measuredWidth,
    ...operandCodeOnly,
    args: { input: b.string.loose.optional, options: b.any.optional },
    uses: {
      input: characters,
      options: membersInspected("countAnsiEscapeCodes", "ambiguousIsNarrow", "perCodePoint"),
    },
  },
] satisfies b.FunctionField[];

// An empty input is answered before the other operands are converted.
const ansiTextOperation = (args: Contents, uses: UsesByOperand) =>
  ({
    ...operandCodeOnly,
    args: { input: b.string.loose, ...args },
    returns: b.string,
    throws: true,
    uses: { input: characters, ...uses },
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

const printedValue = {
  returns: b.string,
  throws: true,
  implementation: b.generic,
} satisfies Partial<b.FunctionField>;

const inspect = [
  {
    ...printedValue,
    args: { value: b.primitiveValue.optional, options: b.primitiveValue.optional, colors: b.any.optional },
    capability: "heap",
    uses: { colors: b.inspected },
  },
  {
    ...printedValue,
    ...operandCodeOnly,
    args: { value: b.any.optional, options: b.any.optional, colors: b.any.optional },
    uses: {
      value: [b.printedByFormatter()],
      options: membersInspected("depth", "colors", "sorted", "compact"),
      colors: b.inspected,
    },
  },
] satisfies b.FunctionField[];

const peek: b.FunctionField[] = [
  {
    args: { promise: b.instance("Promise") },
    returns: b.union(b.operand("promise"), b.slot("promise", "value"), b.slot("promise", "reason")),
    capability: "heap",
    uses: { promise: b.inspected },
    implementation: b.generic,
  },
  {
    args: { value: b.any.optional },
    returns: b.union(b.operand("value"), b.undefined),
    capability: "heap",
    uses: { value: b.inspected },
    implementation: b.generic,
  },
];

const joinedBytes = {
  returns: b.union(b.instance("ArrayBuffer"), b.instance("Uint8Array").exactly).fresh,
  throws: true,
  reads: viewHeaps,
  implementation: b.hostCall,
} satisfies Partial<b.FunctionField>;

const concatArrayBuffers = [
  {
    ...joinedBytes,
    args: {
      buffers: b.instance("Array").holding({ element: byteSource }).pristine("Storage"),
      maxLength: b.any.optional,
      asUint8Array: b.any.optional,
    },
    capability: "heap",
    uses: { buffers: [b.readsContents()], maxLength: b.inspected, asUint8Array: b.inspected },
  },
  {
    ...joinedBytes,
    ...operandCodeOnly,
    args: { buffers: b.instance("Array").nullable, maxLength: b.any.optional, asUint8Array: b.any.optional },
    uses: {
      buffers: [b.readsContents(), b.runs("OwnValues", "PrototypeChain")],
      maxLength: b.inspected,
      asUint8Array: b.inspected,
    },
  },
] satisfies b.FunctionField[];

const encodingOrTimestamp = b.union(b.primitiveValue, b.instance("Date")).optional;

const newUUID = {
  returns: b.union(b.string, b.instance("Buffer")).fresh,
  throws: true,
  reads: externalState,
  writes: externalState,
  implementation: b.hostCall,
} satisfies Partial<b.FunctionField>;

const randomUUIDv7 = [
  {
    ...newUUID,
    args: { encoding: encodingOrTimestamp, timestamp: encodingOrTimestamp },
    capability: "heap",
    uses: { encoding: [b.readsContents()], timestamp: [b.readsContents()] },
  },
  {
    ...newUUID,
    ...operandCodeOnly,
    args: { encoding: b.any.optional, timestamp: b.any.optional },
    uses: { encoding: describedInErrorMessage, timestamp: describedInErrorMessage },
  },
] satisfies b.FunctionField[];

// An onResolve function of a plugin may run.
const resolution = (returns: b.TableType) =>
  ({
    args: { specifier: b.any.optional, from: b.any.optional, isESM: b.any.optional },
    returns,
    capability: "js",
    throws: true,
    uses: { specifier: converted, from: converted, isESM: b.inspected },
    reads: externalState,
    writes: externalState,
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

// Reading runs the pull and cancel functions that the stream was created with.
const consumedStream = (settledValue: b.TableType) =>
  ({
    args: { stream: b.instance("ReadableStream") },
    returns: settledWithAnyReason(settledValue),
    capability: "js",
    throws: true,
    uses: { stream: [b.retained] },
    reads: externalState,
    writes: externalState,
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

const streamConsumer = (settledValue: b.TableType) => [consumedStream(settledValue), refusal("stream")];

const s3OptionNames = [
  "accessKeyId",
  "secretAccessKey",
  "sessionToken",
  "region",
  "endpoint",
  "bucket",
  "virtualHostedStyle",
  "pageSize",
  "partSize",
  "queueSize",
  "retry",
  "acl",
  "storageClass",
  "type",
  "contentDisposition",
  "contentEncoding",
  "requestPayer",
];

const requestOptionNames = [
  "url",
  "method",
  "headers",
  "body",
  "signal",
  "redirect",
  "keepalive",
  "timeout",
  "decompress",
  "compress",
  "encoding",
  "level",
  "maxRedirects",
  "session",
  "protocol",
  "verbose",
  "unix",
  "proxy",
  "respectNoProxy",
  "tls",
  ...tlsOptionNames,
  "s3",
  ...s3OptionNames,
];

const requestCallbackNames = ["checkServerIdentity"];
const pluginCallbackNames = ["setup"];

const developmentServerOptionNames = [
  "bundlerOptions",
  "server",
  "client",
  "ssr",
  "sourcemap",
  "minify",
  "whitespace",
  "syntax",
  "identifiers",
  "framework",
  "root",
  "plugins",
  "name",
  "serverEntryPoint",
  "clientEntryPoint",
  "reactFastRefresh",
  "importSource",
  "serverComponents",
  "separateSSRGraph",
  "serverRuntimeImportSource",
  "serverRegisterClientReferenceExport",
  "builtInModules",
  "import",
  "path",
  "code",
  "fileSystemRouterTypes",
  "prefix",
  "ignoreUnderscores",
  "layouts",
  "clientPages",
  "style",
  "extensions",
  "ignoreDirs",
];

const serverOptionNames = [
  "development",
  "hmr",
  "console",
  "chromeDevToolsAutomaticWorkspaceFolders",
  "routes",
  "static",
  "dir",
  "style",
  "statCache",
  "index",
  "files",
  "path",
  "headers",
  "webSocket",
  "websocket",
  "perMessageDeflate",
  "compress",
  "decompress",
  "maxPayloadLength",
  "backpressureLimit",
  "closeOnBackpressureLimit",
  "sendPings",
  "publishToSelf",
  "idleTimeout",
  "port",
  "hostname",
  "host",
  "unix",
  "baseURI",
  "id",
  "reusePort",
  "ipv6Only",
  "http1",
  "http2",
  "http3",
  "maxRequestBodySize",
  "tls",
  ...tlsOptionNames,
  "app",
  ...developmentServerOptionNames,
];

// runSetupFunction in BundlerPlugin.ts calls it as a plain function.
const pluginsSetUpUnder = (...path: readonly string[]) =>
  b.memberCalled([...path, "plugins", b.everyOwnValue, "setup"], {
    times: "PerEvent",
    this: b.undefined,
    args: [b.any],
    result: "Escapes",
  });
// The server, the URL, the method, the dispatch bits, the response, whether there is a body, the socket, whether it is new, its duplex, whether the request is HTTP/1.0, the bytes after the head, and whether the request was pipelined.
const nodeRequestHandlerArguments = Array.from({ length: 12 }, () => b.any);
const routeMethodNames = ["CONNECT", "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "TRACE"];

// A socket is one object for as long as it lives, whichever handler it is handed to.
const webSocket = b.nativeCell(webSocketsCell);
// The kind follows the binaryType of the socket.
const binaryFrame = b.union(
  b.instance("Buffer"),
  b.instance("Uint8Array"),
  b.instance("ArrayBuffer"),
  b.instance("Blob"),
).fresh;

const webSocketHandlerArguments: Readonly<Record<string, readonly b.PlaceLike[]>> = {
  open: [webSocket],
  message: [webSocket, b.union(b.string, binaryFrame)],
  drain: [webSocket],
  ping: [webSocket, binaryFrame],
  pong: [webSocket, binaryFrame],
  close: [webSocket, b.f64, b.string],
  // WebSocketServerContext.rs run_error_callback(): what another of these handlers threw.
  error: [b.thrown, webSocket],
};

// upgrade, close and terminate call these before they return.
const webSocketHandlersCalledByMethods = ["open", "close", "error"];

const webSocketHandlersUnder = (options: string) =>
  Object.entries(webSocketHandlerArguments).flatMap(([handler, args]) => [
    b.memberCalled([options, handler], { times: "PerEvent", this: b.undefined, args, result: "Ignored" }),
    ...(webSocketHandlersCalledByMethods.includes(handler)
      ? [b.memberStoredIn([options, handler], b.nativeCell(webSocketHandlerCell(handler)))]
      : []),
  ]);

// A route is a function, or an object with a function for each method. Whatever else it is, it is kept with the options.
const routeHandlersUnder = (routes: string, calledPerRequest: b.HandlerOptions) => [
  b.memberCalled([routes, b.everyOwnValue], calledPerRequest),
  ...routeMethodNames.map(method => b.memberCalled([routes, b.everyOwnValue, method], calledPerRequest)),
];

const serverOptions = (server: b.PlaceLike) => {
  const calledWith = (request: b.TableType): b.HandlerOptions => ({
    times: "PerEvent",
    this: server,
    args: [request, server],
    result: "Escapes",
  });
  const routed = calledWith(b.instance("BunRequest").fresh);
  return [
    ...readAndKeptIn(serverOptionsCell, serverOptionNames),
    // ServerConfig.rs: `tls` is the options of SSLConfig.bind.ts or a list of them. server_body.rs: a route that names a file has headers, which are a record or a sequence of pairs.
    ...sequencesOfTLSOptions.flatMap(name => [
      iterated("options", "tls", name),
      iterated("options", "tls", b.everyOwnValue, name),
    ]),
    ...["routes", "static"].flatMap(routes => [
      iterated("options", routes, b.everyOwnValue, "headers"),
      iterated("options", routes, b.everyOwnValue, "headers", b.everyOwnValue),
    ]),
    // bake's options: whatever lies there may run.
    b.memberStoredIn(["app"], b.nativeMemory),
    pluginsSetUpUnder("app"),
    pluginsSetUpUnder("app", "framework"),
    b.createdIn(b.instance("ServerWebSocket").fresh, webSocket),
    b.memberCalled(["fetch"], calledWith(b.instance("Request").fresh)),
    b.memberStoredIn(["fetch"], b.nativeCell(requestHandlerCell)),
    b.memberCalled(["onNodeHTTPRequest"], {
      times: "PerEvent",
      this: b.undefined,
      args: nodeRequestHandlerArguments,
      result: "Escapes",
    }),
    // RequestContext.rs: what a handler threw, the reason of the promise that it answered, or an error that native code made. `this` is undefined once the server object has been collected.
    b.memberCalled(["error"], {
      times: "PerEvent",
      this: b.union(servers, b.undefined),
      args: [b.thrown],
      result: "Escapes",
    }),
    ...routeHandlersUnder("routes", routed),
    ...routeHandlersUnder("static", routed),
    ...webSocketHandlersUnder("websocket"),
    ...webSocketHandlersUnder("webSocket"),
  ];
};

const subprocessOptionNames = [
  "cmd",
  "argv0",
  "cwd",
  "env",
  "stdio",
  "stdin",
  "stdout",
  "stderr",
  "serialization",
  "signal",
  "timeout",
  "killSignal",
  "maxBuffer",
  "lazy",
  "detached",
  "uid",
  "gid",
  "cgroup",
  "windowsHide",
  "windowsVerbatimArguments",
  "terminal",
  "cols",
  "rows",
  "name",
];

const subprocessHandlerNames = ["ipc", "onExit", "onDisconnect", "data", "exit", "drain"];

const datagramSocketOptionNames = ["port", "hostname", "flags", "fd", "sharedFd", "binaryType", "socket", "connect"];
const datagramSocketHandlerNames = ["data", "drain", "error"];
const datagramSocket = b.instance("UDPSocket");
const receivedDatagram = b.union(
  b.instance("Buffer"),
  b.instance("Uint8Array").exactly,
  b.instance("ArrayBuffer"),
).fresh;
// udp_socket.rs on_data(), on_drain(), call_error_handler().
const datagramSocketHandlerArguments: Readonly<Record<string, readonly b.PlaceLike[]>> = {
  data: [datagramSocket, receivedDatagram, b.f64, b.string, b.anyMadeOf("Object")],
  drain: [datagramSocket],
  error: [b.thrown],
};

const bundlerOptionNames = [
  "admit",
  "allow",
  "allowCodeFromDisk",
  "allowUnresolved",
  "aot",
  "aotCheck",
  "aotExplain",
  "aotHarden",
  "aotOut",
  "aotTesting",
  "asset",
  "assets",
  "auto",
  "autoloadBunfig",
  "autoloadDotenv",
  "autoloadPackageJson",
  "autoloadTsconfig",
  "banner",
  "bytecode",
  "bytecodeDepth",
  "bytecodeOrder",
  "check",
  "chunk",
  "compile",
  "conditions",
  "copyright",
  "define",
  "deprecatedNamespaceObjectSetters",
  "description",
  "development",
  "disallowCodeGenerationFromStrings",
  "drop",
  "dts",
  "emitDCEAnnotations",
  "entry",
  "entrypoints",
  "entryPoints",
  "env",
  "execArgv",
  "executablePath",
  "external",
  "factory",
  "features",
  "files",
  "foldChunksForTesting",
  "footer",
  "format",
  "fragment",
  "functionSource",
  "hideConsole",
  "icon",
  "identifiers",
  "ignoreDCEAnnotations",
  "importSource",
  "inspector",
  "jitPolicy",
  "json",
  "jsx",
  "keep",
  "keepNames",
  "loader",
  "locales",
  "log",
  "macros",
  "markdown",
  "metafile",
  "minChunkSize",
  "minify",
  "modulePreload",
  "name",
  "naming",
  "obfuscate",
  "optimize",
  "optimizeImports",
  "outdir",
  "outfile",
  "packages",
  "plugins",
  "publicPath",
  "publisher",
  "reactCompiler",
  "reactCompilerOutputMode",
  "reactCompilerParseTestPragmas",
  "reactFastRefresh",
  "remove",
  "root",
  "runtime",
  "sideEffects",
  "sourcemap",
  "splitRequire",
  "splitting",
  "syntax",
  "target",
  "throw",
  "title",
  "treeShaking",
  "trim",
  "tsconfig",
  "version",
  "whitespace",
  "windows",
];

const startedByOptions = {
  capability: "js",
  throws: true,
  reads: externalState,
  writes: externalState,
  implementation: b.hostCall,
} as const;

const servers = b.union(
  b.instance("HTTPServer"),
  b.instance("HTTPSServer"),
  b.instance("DebugHTTPServer"),
  b.instance("DebugHTTPSServer"),
);

const serverClassNames = ["HTTPServer", "HTTPSServer", "DebugHTTPServer", "DebugHTTPSServer"];
const thisServer = b.operand("this");
const serverState = [b.readsContents(), b.writesContents()];

const closesConnections = [
  ...serverState,
  b.keptCalled(webSocketHandlerCell("close"), {
    times: "Repeatedly",
    this: b.undefined,
    args: webSocketHandlerArguments.close,
    result: "Ignored",
  }),
];
const changesServerState = {
  capability: "heap",
  uses: { this: serverState },
  reads: externalState,
  writes: externalState,
  implementation: b.hostCall,
} as const;
const readsServerState = (getter: b.TableType, capability: "heap" | "none" = "none") =>
  ({
    getter,
    capability,
    uses: { this: [b.readsContents()] },
    reads: externalState,
    implementation: b.generic,
  }) satisfies b.GetterField;

const serverMembers = {
  // The open handler runs before the call returns, and the error handler if it throws.
  upgrade: {
    ...startedByOptions,
    args: { request: b.any.optional, options: b.any.optional },
    returns: b.bool,
    uses: {
      this: [
        ...serverState,
        b.keptCalled(webSocketHandlerCell("open"), {
          times: "Once",
          this: b.undefined,
          args: [webSocket],
          result: "Ignored",
        }),
        b.keptCalled(webSocketHandlerCell("error"), {
          times: "Once",
          this: b.undefined,
          args: webSocketHandlerArguments.error,
          result: "Ignored",
        }),
      ],
      request: [b.readsContents(), b.writesContents()],
      options: [
        b.runsTransitively(
          "OwnKeys",
          "OwnValues",
          "PrototypeChain",
          "Iterate",
          "ToPrimitive",
          b.named("data", "headers"),
        ),
        b.memberStoredIn(["data"], b.nativeCell(webSocketDataCell)),
      ],
    },
  },
  reload: {
    ...startedByOptions,
    args: { options: b.any.optional },
    returns: thisServer,
    uses: { this: serverState, options: serverOptions(thisServer) },
  },
  // The handler gets a request of its own and no second argument: a copy of the Request that is passed, which is told from any other object by its class.
  fetch: {
    ...startedByOptions,
    args: { request: b.any.optional, options: b.any.optional },
    returns: b.any,
    uses: {
      this: [
        ...serverState,
        b.keptCalled(requestHandlerCell, {
          times: "Once",
          this: thisServer,
          args: [b.instance("Request").fresh],
          result: "Escapes",
        }),
      ],
      request: [b.readsContents(), b.writesContents(), ...converted],
      options: handedOver,
    },
  },
  // Closing a connection runs the close handler of its WebSocket before the call returns.
  stop: {
    ...startedByOptions,
    throws: false,
    args: { closeActiveConnections: b.any.optional },
    returns: b.instance("Promise").holding({ value: b.undefined, reason: b.never }),
    uses: { this: closesConnections, closeActiveConnections: b.inspected },
  },
  "@@dispose": { ...startedByOptions, throws: false, returns: b.undefined, uses: { this: closesConnections } },
  closeIdleConnections: { ...changesServerState, returns: b.f64 },
  ref: { ...changesServerState, returns: thisServer },
  unref: { ...changesServerState, returns: thisServer },
  requestIP: {
    ...changesServerState,
    throws: true,
    args: { request: b.any.optional },
    returns: b.union(b.strictNull, b.plainData.fresh),
    uses: { this: serverState, request: [b.readsContents()] },
  },
  timeout: {
    ...changesServerState,
    throws: true,
    args: { request: b.any.optional, seconds: b.any.optional },
    returns: b.union(b.undefined, b.strictNull),
    uses: { this: serverState, request: [b.readsContents(), b.writesContents()], seconds: b.inspected },
  },
  port: readsServerState(b.union(b.f64, b.undefined)),
  pendingRequests: readsServerState(b.f64),
  pendingWebSockets: readsServerState(b.f64),
  protocol: readsServerState(b.string, "heap"),
  development: readsServerState(b.bool),
} satisfies Readonly<Record<string, b.Field>>;

// The first read creates the value, and the server keeps it for the reads that follow.
const cachedServerGetters = {
  address: b.union(b.string, b.strictNull, b.plainData),
  hostname: b.union(b.string, b.undefined),
  id: b.string,
  url: b.instance("URL"),
} satisfies Readonly<Record<string, b.TableType>>;

// js_bun_spawn_bindings.rs reads each option off the options under its name, during the call, and keeps what it has read: not the options.
const subprocessOptionsConverted = ["argv0", "cwd"];
// A stream, a blob, a view, a signal, a terminal: native code goes on using them behind the call.
const subprocessOptionsKept: readonly b.MemberPath[] = [
  ["stdin"],
  ["stdout"],
  ["stderr"],
  ["stdio", b.everyOwnValue],
  ["signal"],
  ["terminal"],
  ["cgroup"],
];

const runningSubprocess = b.instance("Subprocess");
const subprocessOptionsAt = (operand: b.OperandName, callsHandlers: boolean) => [
  b.runsTransitively(b.named(...subprocessOptionNames, ...subprocessHandlerNames)),
  // What it keeps of them, and what it calls, is listed below.
  b.membersOnlyInspected,
  ...subprocessOptionsConverted.flatMap(name => convertedToString(operand, name)),
  // The variables of the child: the own enumerable names of `env`, and each value as a string. The command: each element as a string.
  ...convertedToString(operand, "env", b.everyOwnValue),
  ...convertedToString(operand, "cmd", b.everyOwnValue),
  ...subprocessOptionsKept.map(path => b.memberStoredIn(path, b.nativeMemory)),
  ...(callsHandlers ? subprocessHandlersCalled : []),
];
// subprocess.rs: (the Subprocess or undefined, the exit code or null, the signal or null, an error of the system or undefined), (the message, the Subprocess, a handle), (true). Each is called on the Subprocess.
const subprocessHandlersCalled = [
  b.memberCalled(["onExit"], {
    times: "PerEvent",
    this: b.union(runningSubprocess, b.undefined),
    args: [
      b.union(runningSubprocess, b.undefined),
      b.union(b.f64, b.strictNull),
      b.union(b.string, b.f64, b.strictNull),
      b.union(b.instance("Error"), b.undefined),
    ],
    result: "Ignored",
  }),
  b.memberCalled(["ipc"], {
    times: "PerEvent",
    this: runningSubprocess,
    args: [b.any, runningSubprocess, b.any],
    result: "Ignored",
  }),
  b.memberCalled(["onDisconnect"], { times: "PerEvent", this: runningSubprocess, args: [b.bool], result: "Ignored" }),
  ...["data", "exit", "drain"].map(handler =>
    b.memberCalled(["terminal", handler], {
      times: "PerEvent",
      this: b.any,
      args: [b.any, b.any, b.any],
      result: "Ignored",
    }),
  ),
];
// The options are the first operand where that is no list, and the second where it is.
// js_bun_spawn_bindings.rs: spawnSync makes no Subprocess for a script: it asks that onExit and onDisconnect are functions, keeps neither and calls neither, does not read `ipc` and refuses `terminal`.
const startsSubprocess = (returns: b.TableType, callsHandlers: boolean): b.FunctionField[] => [
  {
    ...startedByOptions,
    args: { commandOrOptions: b.instance("Array"), options: b.any.optional },
    returns,
    uses: {
      commandOrOptions: [b.readsContents(), b.runsTransitively("OwnValues", "ToPrimitive")],
      options: subprocessOptionsAt("options", callsHandlers),
    },
  },
  {
    ...startedByOptions,
    args: { commandOrOptions: b.object },
    returns,
    uses: { commandOrOptions: subprocessOptionsAt("commandOrOptions", callsHandlers) },
  },
];

// js_bun_spawn_bindings.rs: what the child has printed is a new Buffer, the number of the descriptor it was told to write to, or undefined where the output was ignored or inherited.
const outputOfFinishedProcess = b.union(b.instance("Buffer"), b.f64, b.undefined).fresh;
const resultOfSpawnSync = b.layout("SpawnSyncResult", {
  exitCode: b.f64.nullable,
  signalCode: b.maybeAbsent(b.union(b.string, b.f64)),
  stdout: outputOfFinishedProcess,
  stderr: outputOfFinishedProcess,
  success: b.bool,
  resourceUsage: b.union(b.instance("ResourceUsage"), b.undefined).fresh,
  exitedDueToTimeout: b.maybeAbsent(b.bool),
  exitedDueToMaxBuffer: b.maybeAbsent(b.bool),
  pid: b.f64,
});

const cron: b.FunctionField[] = [
  {
    ...operandCodeOnly,
    args: { schedule: stringOrStringObject, handler: b.callable, options: b.any.optional },
    returns: b.instance("CronJob").fresh,
    throws: true,
    uses: {
      schedule: converted,
      handler: [
        b.called({
          afterwards: "TouchesOnlyWhatRowNames",
          times: "PerEvent",
          args: [],
          this: b.result,
          result: "Escapes",
        }),
      ],
      options: membersInspected("tz"),
    },
    reads: externalState,
    writes: externalState,
    implementation: b.generic,
  },
  {
    args: { path: stringOrStringObject, schedule: stringOrStringObject, title: stringOrStringObject },
    returns: settledWithAnyReason(b.undefined),
    ...operandCodeOnly,
    throws: true,
    uses: { path: converted, schedule: converted, title: converted },
    reads: externalState,
    writes: externalState,
    implementation: b.generic,
  },
];

// The function reads the environment that `$.env` was given.
const shellCommand = {
  args: { strings: b.any.optional, expressions: b.any.rest },
  returns: b.object,
  capability: "js",
  throws: true,
  uses: {
    strings: [b.runsTransitively("OwnValues", "ToPrimitive", b.named("raw", "length"))],
    expressions: [
      b.retained,
      b.reachableValuesStoredIn(b.nativeMemory),
      b.runsTransitively("OwnValues", "ToPrimitive", b.named("raw", "length")),
    ],
  },
  reads: externalState,
  writes: externalState,
  implementation: b.generic,
} satisfies b.FunctionField;

const jsonLines = b.union(b.string, b.instance("TypedArray"));

const parsesLines = (returns: b.TableType, args: Contents, uses: UsesByOperand) =>
  [
    {
      args: { input: jsonLines, ...args },
      returns,
      capability: "heap",
      throws: true,
      uses: { input: [b.readsContents()], ...uses },
      reads: viewHeaps,
      implementation: b.generic,
    },
    {
      ...operandCodeOnly,
      args: { input: b.any.optional, ...args },
      returns,
      throws: true,
      uses: { input: converted, ...uses },
      implementation: b.generic,
    },
  ] satisfies b.FunctionField[];

const keychainOperation = (settledValue: b.TableType, options: readonly b.UseSpec[]) =>
  ({
    ...operandCodeOnly,
    args: { options: b.any.optional, name: b.any.optional, value: b.any.optional },
    returns: settledWithAnyReason(settledValue),
    throws: true,
    uses: { options, name: b.inspected, value: b.inspected },
    reads: externalState,
    writes: externalState,
    implementation: b.generic,
  }) satisfies b.FunctionField;

const namedSecret = membersInspected("service", "name");

// get_main() in src/runtime/api/BunObject.rs: what the program has stored there, and else a path.
const mainModulePath = {
  getter: b.string,
  capability: "heap",
  uses: { this: [b.returnedFrom(overriddenMainCell)] },
  reads: externalState,
  writes: externalState,
  implementation: b.generic,
  // setBunObjectMain in BunObject.cpp refuses another path where the build has decided in the code which file is the main module.
  setter: {
    value: b.any,
    capability: "heap",
    throws: true,
    uses: { value: [b.retained, b.storedIn(b.nativeCell(overriddenMainCell))] },
    writes: externalState,
    implementation: b.generic,
  },
} satisfies b.GetterField;

// JSX509Certificate::toLegacyObject()
const legacyCertificate = b.anyMadeOf("Object", "Array", "Buffer", "ArrayBuffer");

const sentWithRequest = [
  ...keptByNativeCode([...requestOptionNames, ...requestCallbackNames], []),
  // fetch.rs looks for it on `tls` of the options and nowhere else. FetchTasklet.rs calls it with the name of the host and the certificate, and an object that it answers rejects the promise.
  b.memberCalled(["tls", "checkServerIdentity"], {
    times: "PerEvent",
    this: b.undefined,
    args: [b.string, legacyCertificate],
    result: "Escapes",
  }),
  b.reachableValuesStoredIn(b.resultSlot("reason")),
];

const fetch = {
  args: { input: b.any.optional, init: b.any.optional },
  returns: settledWithAnyReason(b.instance("Response").fresh),
  capability: "js",
  throws: true,
  uses: { input: sentWithRequest, init: sentWithRequest },
  reads: externalState,
  writes: externalState,
  implementation: b.hostCall,
} satisfies b.FunctionField;

// fetch.rs preconnect: it counts its operands, takes the first as a string and parses it as an address. It opens a connection and answers nothing.
const preconnect = {
  args: { url: b.any.optional },
  returns: b.undefined,
  capability: "js",
  throws: true,
  runsOnlyOperandCode: true,
  uses: { url: [b.runs("ToPrimitive")] },
  reads: externalState,
  writes: externalState,
  implementation: b.hostCall,
} satisfies b.FunctionField;

// FFIObject.rs type-checks these arguments and never converts them. A pointer can point into one of the program's own typed arrays.
const rawMemoryHeaps = [...viewHeaps, ...externalState];
const readAtPointer = (returns: b.TableType) =>
  ({
    args: { ptr: b.any.optional, byteOffset: b.any.optional },
    returns,
    capability: "heap",
    throws: true,
    uses: { ptr: b.inspected, byteOffset: b.inspected },
    reads: rawMemoryHeaps,
    implementation: b.generic,
  }) satisfies b.FunctionField;

const viewAtPointer = (returns: b.TableType) =>
  ({
    args: {
      ptr: b.any.optional,
      byteOffset: b.any.optional,
      byteLength: b.any.optional,
      deallocatorContext: b.any.optional,
      deallocator: b.any.optional,
    },
    returns,
    capability: "heap",
    throws: true,
    uses: {
      ptr: b.inspected,
      byteOffset: b.inspected,
      byteLength: b.inspected,
      deallocatorContext: b.inspected,
      deallocator: b.inspected,
    },
    reads: rawMemoryHeaps,
    writes: externalState,
    implementation: b.generic,
  }) satisfies b.FunctionField;

// ffi_body.rs generate_symbol_for_function(): of a signature `args` is read as an own property and must be a list of type numbers or texts; `threadsafe`, `returns` and
// `ptr` are read through the prototype chain, and so is a hole of `args`. A String object in `args` and whatever lies under `returns` are converted to a text; `ptr` never is.
// generate_symbols(): an object with a signature under each of its own names. Nothing is retained, and no error message formats a value.
const signatureFields = b.named("args", "threadsafe", "returns", "ptr");
const signature = [b.runsTransitively("OwnValues", "PrototypeChain", "ToPrimitive", signatureFields)];
const signaturesByName = [b.runsTransitively("OwnKeys", "OwnValues", "PrototypeChain", "ToPrimitive", signatureFields)];
// One that refuses its operands answers the error in place of throwing it: a new Error or TypeError. What code of an operand throws, it throws.
const readingSignatures = (made: b.TableType) =>
  ({
    returns: b.union(made, b.instance("Error")),
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    reads: externalState,
    writes: externalState,
    implementation: b.generic,
  }) satisfies Partial<b.FunctionField>;
// JSFFICString.cpp: called or constructed it answers a text and no object: the bytes at the address, up to a zero or `byteLength` of them. Without an address the text is empty.
const textAtPointer = {
  args: { ptr: b.any.optional, byteOffset: b.any.optional, byteLength: b.any.optional },
  returns: b.string,
  capability: "heap",
  throws: true,
  uses: { ptr: b.inspected, byteOffset: b.inspected, byteLength: b.inspected },
  reads: rawMemoryHeaps,
  constructable: true,
  implementation: b.generic,
} satisfies b.FunctionField;

// builtins/Glob.ts: each hands its operand to a native method that lies on the prototype under a private symbol (glob.rs scan() | scan_sync()), and answers the object of a generator
// function of its own. The operand is undefined, null, a text (the folder) or a dictionary; native code copies what it reads of it, keeps nothing and calls nothing of the library.
// What the object yields goes through `yield*` over a list of texts, so through the iterator of lists as the program has left it: the row says nothing of it.
const optionsOfScan = ["onlyFiles", "throwErrorOnBrokenSymlink", "followSymlinks", "absolute", "cwd", "dot"];
const scansFolder = (name: string, made: b.TableType): b.FunctionField[] => {
  const scans = {
    this: b.instance("Glob"),
    returns: made,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    reads: externalState,
    writes: externalState,
    implementation: b.compiled("builtins/Glob", name),
  } satisfies b.FunctionField;
  return [
    {
      ...scans,
      args: { folder: b.union(b.string, b.instance("String")).nullable },
      uses: { this: b.inspected, folder: converted },
    },
    // What is neither a text nor an object is refused.
    {
      ...scans,
      args: { options: b.union(b.bool, b.f64, b.bigint, b.symbol) },
      returns: b.never,
      uses: { this: b.inspected, options: b.inspected },
    },
    // A member is read through the prototype chain, and a String object under `cwd` is converted.
    {
      ...scans,
      args: { options: b.dictionary(optionsOfScan) },
      uses: {
        this: b.inspected,
        options: [b.readsContents(), b.runsTransitively("ToPrimitive", b.named(...optionsOfScan))],
      },
    },
  ] satisfies b.FunctionField[];
};

// constructDNSObject in BunObject.cpp puts them on Bun.dns. Each answers a promise of the records.
const queriesOfDNS = [
  "lookupService",
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
];

const createdOnFirstRead = (holds: b.TableType) => b.property(holds, { createdOnFirstRead: { capability: "heap" } });

const computedOnce = ["argv", "cwd", "env", "isMainThread", "revision", "stderr", "stdin", "stdout", "version"];

const plainObjects = [
  "Bun",
  "Bun.CSRF",
  "Bun.FFI",
  "Bun.JSON5",
  "Bun.JSONC",
  "Bun.JSONL",
  "Bun.TOML",
  "Bun.XML",
  "Bun.YAML",
  "Bun.dns",
  "Bun.markdown",
  "Bun.password",
  "Bun.secrets",
  "Bun.semver",
  "Bun.unsafe",
];

export default b.declarations(
  resultOfSpawnSync,
  b.membersFrom("globalThis", b.staticTable("src/jsc/bindings/ZigGlobalObject.lut.txt", "bunGlobalObjectTable")),
  plainObjects.flatMap(path => b.inherits(path, "Object.prototype")),
  // ZigGlobalObject.lut.txt: DontDelete|ReadOnly. No store replaces it, so nobody has to ask whether one has.
  b.extend("Bun", { mutability: "AlwaysLocked" }),
  computedOnce.flatMap(name => b.extend(`Bun.${name}`, { mutability: "ConstantUnlessWritten" })),
  // A function of the library's JavaScript, which `new` may be used on as on any such function.
  b.constructionOfFunction("Bun.$", shellCommand),
  b.namespace(
    "Bun",
    {
      fetch,
      main: mainModulePath,
      // What process.argv answers at the first read: the list that it keeps, which this read makes if nobody has asked for it,
      // or what the program has stored there, or what a getter of the program answers.
      argv: b.property(b.any, {
        createdOnFirstRead: {
          capability: "js",
          throws: true,
          uses: {
            this: [b.createdIn(newArrayOf(b.string).dense, b.nativeCell(argumentsCell)), b.returnedFrom(argumentsCell)],
          },
          reads: externalState,
        },
      }),
      // Nothing is known of the class, so whoever reads it counts as calling import() of a graph (ReadLoadsCodeByName in marks.builtins.ts).
      // From the first graph on, the natives that look for the graph of a frame find graphs and frames.
      ModuleGraph: b.property(b.any, {
        createdOnFirstRead: {
          capability: "js",
          throws: true,
          uses: {
            this: [
              b.createdIn(b.object, b.nativeCell(moduleGraphsCell)),
              b.createdIn(b.object, b.nativeCell(framesOfModuleGraphsCell)),
            ],
          },
        },
      }),
      cwd: createdOnFirstRead(b.string),
      // BunObject.rs make_blob: a new Blob over the descriptor, which the realm keeps (m_bunStdin ..).
      ...Object.fromEntries(
        ["stdin", "stdout", "stderr"].map(name => [
          name,
          b.property(b.instance("Blob"), {
            createdOnFirstRead: {
              capability: "heap",
              uses: {
                this: [
                  b.createdIn(b.instance("Blob").fresh, b.nativeCell(standardBlobCell(name))),
                  b.returnedFrom(standardBlobCell(name)),
                ],
              },
            },
          }),
        ]),
      ),
      // What process.env answers.
      env: b.property(b.object, {
        createdOnFirstRead: { capability: "heap", throws: true, uses: { this: [b.returnedFrom(environmentCell)] } },
      }),
      enableANSIColors: createdOnFirstRead(b.bool),
      isMainThread: createdOnFirstRead(b.bool),
      revision: createdOnFirstRead(b.string),
      version: createdOnFirstRead(b.string),
      plugin: b.otherwise,

      // Only under --hot, which a compiled executable does not have, is the result a server that exists already.
      serve: {
        ...startedByOptions,
        refusalsPrintNoValue: true,
        args: { options: b.object },
        returns: servers.fresh,
        uses: { options: serverOptions(b.result) },
      },
      spawn: startsSubprocess(b.instance("Subprocess"), true),
      spawnSync: startsSubprocess(b.ordinaryObjectOf("SpawnSyncResult").fresh, false),
      sleep: {
        args: { duration: b.union(b.f64, b.instance("Date")) },
        // Nothing rejects it: a duration of another kind is refused at the call.
        returns: newPromiseHolding({ value: b.undefined, reason: b.never }),
        capability: "heap",
        throws: true,
        uses: { duration: [b.readsContents()] },
        reads: externalState,
        writes: externalState,
        implementation: b.hostCall,
      },
      nanoseconds: clockReading("AOT__nanoseconds"),
      inspect,
      escapeHTML: textTransformation,
      stringWidth,
      stripANSI: textTransformation,
      sliceAnsi: ansiTextOperation(
        {
          start: b.any.optional,
          end: b.any.optional,
          ellipsisOrOptions: b.any.optional,
          ambiguousIsNarrow: b.any.optional,
        },
        {
          start: converted,
          end: converted,
          ellipsisOrOptions: membersInspected("ellipsis", "ambiguousIsNarrow"),
          ambiguousIsNarrow: b.inspected,
        },
      ),
      wrapAnsi: ansiTextOperation(
        { columns: b.any.optional, options: b.any.optional },
        { columns: converted, options: membersInspected("hard", "wordWrap", "trim", "ambiguousIsNarrow") },
      ),
      fileURLToPath: [
        {
          args: { url: b.union(b.string, b.instance("URL")) },
          returns: b.string,
          capability: "heap",
          throws: true,
          uses: { url: [b.readsContents()] },
          implementation: b.hostCall,
        },
        refusal("url"),
      ],
      pathToFileURL: {
        args: { path: b.string.loose },
        returns: b.instance("URL").fresh,
        capability: "heap",
        throws: true,
        uses: { path: characters },
        reads: externalState,
        implementation: b.hostCall,
      },
      resolveSync: resolution(b.string),
      resolve: resolution(settledWithAnyReason(b.string)),
      deepEquals: deepComparison(
        { left: b.any.optional, right: b.any.optional, strict: b.any.optional, skipsPrototypes: b.any.optional },
        { left: comparedDeeply, right: comparedDeeply, strict: b.inspected, skipsPrototypes: b.inspected },
      ),
      deepMatch: deepComparison({ subset: b.object, value: b.object }, { subset: matchedDeeply, value: matchedDeeply }),
      concatArrayBuffers,
      readableStreamToArray: streamConsumer(newArrayOf(b.any)),
      // A stream whose only chunk is a string settles with a Uint8Array.
      readableStreamToArrayBuffer: streamConsumer(
        b.union(b.instance("ArrayBuffer"), b.instance("Uint8Array").exactly).fresh,
      ),
      readableStreamToBlob: streamConsumer(b.instance("Blob").fresh),
      readableStreamToBytes: streamConsumer(b.instance("Uint8Array").exactly.fresh),
      // The bytes are handed to `FormData.from` when they have arrived, which no program can replace. What the promise finds under `then` above the form may be anything.
      readableStreamToFormData: [
        {
          ...consumedStream(b.anyMadeOf("FormData")),
          args: { stream: b.instance("ReadableStream"), contentType: b.any.optional },
          uses: { stream: [b.retained], contentType: [b.retained] },
        },
        refusal("stream"),
      ],
      readableStreamToJSON: streamConsumer(parsedJSON),
      readableStreamToText: streamConsumer(b.string),
      randomUUIDv7,
      peek,

      $: shellCommand,
      build: {
        ...startedByOptions,
        args: { options: b.object },
        returns: settledWithAnyReason(b.object),
        uses: { options: keptByNativeCode(bundlerOptionNames, pluginCallbackNames) },
      },
      color: [
        {
          args: { input: b.primitiveValue, format: b.string.nullable },
          returns: b.union(b.plainData, b.strictNull, b.f64, b.string),
          capability: "heap",
          throws: true,
          reads: externalState,
          implementation: b.hostCall,
        },
        {
          ...operandCodeOnly,
          args: { input: b.any, format: b.any.optional },
          returns: b.union(b.plainData, b.strictNull, b.f64, b.string),
          throws: true,
          uses: {
            input: [b.readsContents(), b.runs("OwnValues", b.named("r", "g", "b", "a")), b.membersOnlyInspected],
            format: [...characters, ...converted],
          },
          reads: [...viewHeaps, ...externalState],
          implementation: b.hostCall,
        },
      ],
      // A connection may fail inside the call. What connectError throws then goes to the uncaughtException listeners.
      connect: {
        ...startedByOptions,
        args: { options: b.any.optional },
        returns: settledWithAnyReason(b.union(b.instance("TCPSocket"), b.instance("TLSSocket"))),
        uses: { options: socketOptions },
      },
      cron,
      generateHeapSnapshot: {
        args: { format: b.any.optional, encoding: b.any.optional },
        returns: b.union(b.plainData, b.string, b.instance("ArrayBuffer")).fresh,
        capability: "heap",
        throws: true,
        uses: { format: b.inspected, encoding: b.inspected },
        implementation: b.hostCall,
      },
      jest: {
        args: { path: b.any.optional, byWhoLoads: b.any.optional, ownGlobals: b.any.optional },
        returns: b.union(testModule, b.f64),
        capability: "js",
        throws: true,
        uses: { path: converted, byWhoLoads: b.inspected, ownGlobals: b.inspected },
        implementation: b.hostCall,
      },
      listen: {
        ...startedByOptions,
        refusalsPrintNoValue: true,
        args: { options: b.object },
        returns: b.instance("Listener").fresh,
        uses: { options: socketOptions },
      },
      udpSocket: {
        ...startedByOptions,
        runsOnlyOperandCode: true,
        args: { options: b.any.optional },
        returns: settledWithAnyReason(b.instance("UDPSocket")),
        uses: {
          options: [
            ...keptByNativeCode(datagramSocketOptionNames, datagramSocketHandlerNames),
            ...Object.entries(datagramSocketHandlerArguments).map(([handler, args]) =>
              b.memberCalled(["socket", handler], { times: "PerEvent", this: datagramSocket, args, result: "Ignored" }),
            ),
          ],
        },
      },
    },
    { table: b.staticTable("src/jsc/bindings/BunObject.cpp", "bunObjectTable") },
  ),
  serverClassNames.flatMap(name =>
    Object.entries(serverMembers).flatMap(([member, field]) => b.method(`%${name}%.prototype.${member}`, field)),
  ),
  serverClassNames.flatMap(name =>
    Object.entries(cachedServerGetters).flatMap(([member, getter]) =>
      b.method(`%${name}%.prototype.${member}`, {
        getter,
        capability: "heap",
        throws: true,
        uses: { this: serverState },
        reads: externalState,
        writes: externalState,
        implementation: { how: "CachedGetter", cppClass: `JS${name}`, member: `m_${member}` },
      }),
    ),
  ),
  b.fn("Bun.plugin.clearAll", b.otherwise),
  // Symbol.for("nodejs.util.inspect.custom"): whoever has it may lay the method that the formatter calls with util.inspect.
  b.static("Bun.inspect.custom", b.property(b.symbol)),
  // The printer of console.table. The second operand is a list of names or the options.
  b.fn("Bun.inspect.table", {
    ...printedValue,
    ...operandCodeOnly,
    args: { tabularData: b.any.optional, properties: b.any.optional, options: b.any.optional },
    uses: {
      tabularData: [b.printedByFormatter()],
      properties: [b.printedByFormatter("depth", "colors", "sorted", "compact")],
      options: membersInspected("depth", "colors", "sorted", "compact"),
    },
  }),
  b.namespace("Bun.JSONL", {
    parse: parsesLines(newArrayOf(parsedJSON), {}, {}),
    parseChunk: parsesLines(
      b.object.fresh,
      { start: b.any.optional, end: b.any.optional },
      { start: b.inspected, end: b.inspected },
    ),
  }),
  // bun:ffi calls its own throwing wrappers (ffi.bind.ts) instead of these six, and deletes callback, closeCallback and cfunction when it loads. cfunction, dlopen and linkSymbols load native code.
  b.namespace("Bun.FFI", {
    // Native code calls the function with primitives only and converts its result to the declared return type.
    callback: {
      ...readingSignatures(b.instance("FFICallback")),
      args: { options: b.any.optional, callback: b.any.optional },
      uses: {
        options: signature,
        callback: [
          b.retained,
          b.called({
            afterwards: "TouchesOnlyWhatRowNames",
            times: "PerEvent",
            this: b.undefined,
            args: [],
            spreadArgs: b.union(b.f64, b.bigint, b.bool, b.string, b.strictNull),
            result: "Escapes",
          }),
        ],
      },
    },
    // JSFFIFunction.cpp of JavaScriptCore: a function that enters the machine code at `ptr`.
    cfunction: {
      ...readingSignatures(b.callable),
      args: { options: b.any.optional, name: b.any.optional },
      uses: { options: signature, name: converted },
    },
    // A callback that is closed has no address any more. Anything else is left as it is.
    closeCallback: {
      args: { callback: b.any.optional },
      capability: "heap",
      uses: { callback: [...handedOver, b.definesName(["ptr"], b.strictNull)] },
      reads: externalState,
      writes: externalState,
      implementation: b.generic,
    },
    // Without a `name` it throws.
    dlopen: {
      ...readingSignatures(b.instance("FFI")),
      args: { name: b.string.loose.nullable, symbols: b.any.optional },
      uses: { name: converted, symbols: signaturesByName },
    },
    linkSymbols: {
      ...readingSignatures(b.instance("FFI")),
      args: { symbols: b.any.optional },
      uses: { symbols: signaturesByName },
    },
    // The text of the C wrapper of each signature, or one line of text for a callback.
    viewSource: {
      ...readingSignatures(b.union(b.string, b.instance("Array").holding({ element: b.string }))),
      args: { symbols: b.any.optional, isCallback: b.bool.loose.optional },
      uses: { symbols: signaturesByName },
    },
    // Returns a TypeError for a bad argument. Once the pointer exists, native code, `read.*` and views created from the pointer can read and write the bytes.
    ptr: {
      args: { view: b.any.optional, byteOffset: b.any.optional },
      returns: b.union(b.f64, b.strictNull, b.instance("TypeError")).unaliased,
      resultProperties: {
        name: b.string,
        code: b.string,
        toString: b.builtin("%NativeFunctions%.ErrorCodeCppNodeError_proto_toString"),
      },
      capability: "heap",
      uses: { view: [...handedOver, b.readsContents(), b.writesContents()], byteOffset: b.inspected },
      reads: viewHeaps,
      writes: externalState,
      implementation: b.generic,
    },
    toArrayBuffer: viewAtPointer(b.instance("ArrayBuffer").fresh),
    toBuffer: viewAtPointer(b.instance("Buffer").fresh),
    CString: textAtPointer,
  }),
  b.namespace(
    "Bun.FFI.read",
    Object.fromEntries(
      ["u8", "u16", "u32", "ptr", "i8", "i16", "i32", "i64", "u64", "intptr", "f32", "f64"].map(name => [
        name,
        readAtPointer(name.endsWith("64") && name !== "f64" ? b.bigint : b.f64),
      ]),
    ),
  ),
  b.inherits("Bun.FFI.read", "Object.prototype"),
  b.constructionOfFunction("Bun.FFI.CString", textAtPointer),
  // ffi_body.rs dlopen(), link_symbols(), cc(): an object below Object.prototype that native code has made for the library, with a function under each name of the symbols. The accessor has no setter.
  // An empty field reads as undefined.
  b.method("%FFI%.prototype.symbols", {
    getter: b.union(b.instance("Object"), b.undefined),
    capability: "heap",
    throws: true,
    uses: { this: [b.readsContents(), b.writesContents(), b.reachableValuesStoredIn(b.result)] },
    reads: externalState,
    writes: externalState,
    implementation: { how: "CachedGetter", cppClass: "Bun::Bindgen::Generated::JSFFI", member: "m_symbolsValue" },
  }),
  b.method("%Glob%.prototype.scan", scansFolder("scan", b.instance("AsyncGenerator"))),
  b.method("%Glob%.prototype.scanSync", scansFolder("scanSync", b.instance("Generator"))),
  b.namespace("Bun.dns", {
    ...Object.fromEntries(["ADDRCONFIG", "ALL", "V4MAPPED"].map(name => [name, b.property(b.f64)])),
    ...Object.fromEntries(queriesOfDNS.map(name => [name, answering(promiseOf(b.plainData))])),
    getServers: answering(b.plainData),
    setServers: answering(b.undefined),
    getCacheStats: { returns: b.plainData, capability: "heap", reads: externalState, implementation: b.generic },
    lookup: {
      ...operandCodeOnly,
      args: { hostname: stringOrStringObject, options: b.any.optional },
      returns: settledWithAnyReason(b.plainData),
      throws: true,
      uses: {
        hostname: converted,
        options: describedAfterReading("port", "family", "socketType", "socktype", "protocol", "backend", "flags"),
      },
      reads: externalState,
      writes: externalState,
      implementation: b.generic,
    },
    prefetch: {
      args: { hostname: stringOrStringObject, port: b.f64.nullable },
      ...operandCodeOnly,
      throws: true,
      uses: { hostname: converted },
      reads: externalState,
      writes: externalState,
      implementation: b.generic,
    },
  }),
  b.namespace("Bun.secrets", {
    delete: keychainOperation(b.bool, namedSecret),
    get: keychainOperation(b.union(b.string, b.strictNull), namedSecret),
    set: keychainOperation(b.undefined, [
      b.printedByFormatter("service", "name", "value", "allowUnrestrictedAccess", "persist"),
    ]),
  }),
  b.same("global", "globalThis"),
  b.same("self", "globalThis"),

  b.fn("alert", dialog(b.undefined)),
  b.fn("confirm", dialog(b.bool)),
  // The message is written before the default value is converted.
  b.fn("prompt", {
    ...operandCodeOnly,
    args: { message: b.string.loose.optional, defaultValue: b.any.optional },
    returns: b.union(b.string, b.strictNull, b.bool, b.operand("defaultValue")),
    throws: true,
    uses: { defaultValue: converted },
    reads: externalState,
    writes: externalState,
    implementation: b.hostCall,
  }),
  b.fn("atob", base64Coding),
  b.fn("btoa", base64Coding),
  b.fn("postMessage", {
    ...operandCodeOnly,
    args: { message: b.any.optional, options: b.any.optional },
    throws: true,
    uses: { message: cloned, options: transferList },
    reads: heapsReadByClone,
    writes: heapsWrittenByTransfer,
    implementation: b.hostCall,
  }),

  b.fn("Error.appendStackTrace", {
    args: { source: b.instance("Error"), destination: b.instance("Error") },
    capability: "heap",
    uses: { source: b.inspected, destination: b.inspected },
    reads: externalState,
    writes: externalState,
    implementation: b.hostCall,
  }),
  // FormatStackTraceForJS.cpp: it answers the text of the stack, or throws where its first operand is no error.
  b.hostFunction(
    formatsStackCell,
    "FormatStackTraceForJS.cpp",
    "jsFunctionDefaultErrorPrepareStackTrace",
    answering(b.string, b.hostCall),
  ),
  // ZigGlobalObject.cpp errorConstructorPrepareStackTraceGetter: what the program has stored, and until then that function.
  // FormatStackTraceForJS.cpp: the function is handed the object whose stack is asked for and a new list of call sites, objects of a class that the table does not have.
  b.static(
    "Error.prepareStackTrace",
    b.property(b.builtin("%NativeFunctions%.FormatStackTraceForJSCppJsFunctionDefaultErrorPrepareStackTrace"), {
      resultIsDeclaredOnly: true,
      setter: {
        value: b.any,
        capability: "js",
        runsOnlyOperandCode: true,
        uses: {
          value: [
            b.retained,
            b.called({
              afterwards: "TouchesOnlyWhatRowNames",
              times: "Later",
              this: b.builtin("Error"),
              args: [b.nativeMemory, b.instance("Array").holding({ element: b.instance("Object").unaliased }).fresh],
              result: "Escapes",
            }),
          ],
        },
        implementation: b.generic,
      },
    }),
  ),

  // Native code answers a read and takes a store, and a descriptor shows a data property (ZigGlobalObject.cpp: a CustomGetterSetter without the attribute of an accessor).
  b.method("AbortSignal.prototype.onabort", eventHandlerAttributeKeptIn("AbortSignal.onabort", receiver)),
  b.static("onerror", b.property(b.any, { setter: eventHandlerAttribute(globalObject).setter })),
  b.static("onmessage", b.property(b.any, { setter: eventHandlerAttribute(globalObject).setter })),
  b.fn("addEventListener", listenerRegistration(globalObject)),
  b.fn("removeEventListener", listenerRemoval),
  // Whatever it is called on, the target is the global object.
  b.fn("dispatchEvent", { ...eventDispatch(globalObject), this: b.any, implementation: b.generic }),

  b.namespace("performance", { now: clockReading("AOT__performanceNow") }),
  b.inherits("performance", "Performance.prototype"),
  b.class("Performance", {
    extends: "EventTarget",
    instanceCppClass: b.cppClass("JSPerformance"),
    proto: {
      timeOrigin: {
        this: timeline,
        getter: b.f64,
        capability: "none",
        uses: { this: b.inspected },
        implementation: b.generic,
      },
      timing: {
        this: timeline,
        getter: b.instance("PerformanceTiming"),
        capability: "heap",
        uses: { this: [madeAtFirstRequest, b.returnedFrom(performanceTimingCell)] },
        implementation: b.generic,
      },
      onresourcetimingbufferfull: {
        this: timeline,
        ...eventHandlerAttribute(receiver),
        // It answers the object that was stored last, and null after anything else.
        getter: b.null,
        uses: { this: [b.returnedFrom(timelineHandlerCell)] },
        setter: {
          this: timeline,
          ...eventHandlerAttribute(receiver).setter,
          uses: {
            ...eventHandlerAttribute(receiver).setter.uses,
            value: [
              ...eventHandlerAttribute(receiver).setter.uses.value,
              b.storedIn(b.nativeCell(timelineHandlerCell)),
            ],
          },
        },
      },
      mark: timelineOperation({
        ...operandCodeOnly,
        args: { markName: b.any.optional, markOptions: b.any.optional },
        returns: timelineEntry,
        uses: { markName: converted, markOptions: optionsWithClonedDetail("detail", "startTime") },
        reads: heapsReadByClone,
        writes: heapsWrittenByClone,
      }),
      measure: timelineOperation({
        ...operandCodeOnly,
        args: { measureName: b.any.optional, startOrMeasureOptions: b.any.optional, endMark: b.any.optional },
        returns: timelineEntry,
        uses: {
          measureName: converted,
          startOrMeasureOptions: optionsWithClonedDetail("detail", "start", "duration", "end"),
          endMark: converted,
        },
        reads: heapsReadByClone,
        writes: heapsWrittenByClone,
      }),
      getEntries: timelineOperation({ returns: timelineEntries, capability: "heap" }),
      getEntriesByName: timelineOperation({
        ...operandCodeOnly,
        args: { name: b.any.optional, type: b.any.optional },
        returns: timelineEntries,
        uses: { name: converted, type: converted },
      }),
      getEntriesByType: timelineOperation({
        ...operandCodeOnly,
        args: { type: b.any.optional },
        returns: timelineEntries,
        uses: { type: converted },
      }),
      clearMarks: removesTimelineEntries,
      clearMeasures: removesTimelineEntries,
      clearResourceTimings: timelineOperation({ capability: "heap" }),
      setResourceTimingBufferSize: timelineOperation({
        ...operandCodeOnly,
        args: { maxSize: b.any.optional },
        uses: { maxSize: converted },
      }),
      markResourceTiming: { this: b.any, capability: "none", uses: { this: b.inspected }, implementation: b.generic },
      toJSON: timelineOperation({
        returns: b.instance("Object").fresh,
        // The new object of this row is the one that madeAtFirstRequest puts into the cell, so `timing` here and the getter share it.
        resultProperties: { timeOrigin: b.f64, timing: b.instance("PerformanceTiming").fresh },
        capability: "heap",
        uses: { this: [madeAtFirstRequest] },
      }),
    },
  }),
  b.class("PerformanceTiming", {
    instanceCppClass: b.cppClass("JSPerformanceTiming"),
    proto: {
      ...Object.fromEntries(
        momentsOfPageLoad.map(name => [
          name,
          {
            getter: b.f64,
            capability: "none",
            throws: true,
            uses: { this: b.inspected },
            implementation: b.generic,
          } satisfies b.GetterField,
        ]),
      ),
      toJSON: {
        returns: b.plainData.fresh,
        capability: "heap",
        throws: true,
        uses: { this: b.inspected },
        implementation: b.generic,
      },
    },
  }),
  ...Object.entries({
    // A receiver that is no target is refused before the type is converted.
    addEventListener: (eventTarget: b.TableType) => ({
      ...listenerRegistration(eventTarget),
      readsStateBeforeConversions: true,
    }),
    removeEventListener: () => ({ ...listenerRemoval, uses: { this: b.inspected, ...listenerRemoval.uses } }),
    dispatchEvent: eventDispatch,
  } satisfies Record<string, (eventTarget: b.TableType) => b.FunctionField>).map(([name, on]) =>
    b.method(`EventTarget.prototype.${name}`, [
      {
        ...on(receiver),
        this: b.builtin("performance"),
        overloadUsesFeature: timelineFeatures,
        implementation: b.generic,
      },
      // Without a receiver the target is the global object.
      { ...on(globalObject), this: b.union(b.undefined, b.null, globalObject), implementation: b.generic },
      { ...on(receiver), implementation: b.generic },
    ]),
  ),

  b.fn("setTimeout", delayedTimer("Later")),
  b.fn("setInterval", delayedTimer("PerEvent")),
  ...["setImmediate", "setInterval", "setTimeout"].flatMap(timer => [
    b.static(`${timer}.@@@nodejs.util.promisify.custom`, answersFunctionOfTimersPromises(timer)),
    b.extend(`${timer}.@@@nodejs.util.promisify.custom`, {
      loads: [
        {
          module: "node:timers/promises",
          exports: [b.exportRead(timer, b.keptIn(functionOfTimersPromisesCell(timer)))],
        },
      ],
    }),
  ]),
  b.method("%Timeout%.prototype._onTimeout", {
    getter: b.any,
    capability: "heap",
    uses: { this: [b.readsContents(), mayAnswerWrapperKeptIn(timerCallbackCell), b.returnedFrom(timerCallbackCell)] },
    implementation: b.hostCall,
    setter: {
      value: b.any,
      capability: "heap",
      uses: {
        this: [b.writesContents()],
        value: [
          b.storedIn(b.nativeCell(timerCallbackCell)),
          b.called({
            afterwards: "TouchesOnlyWhatRowNames",
            times: "PerEvent",
            args: [],
            this: b.operand("this"),
            spreadArgs: b.nativeCell(timerArgumentsCell),
            result: "Ignored",
          }),
        ],
      },
      implementation: b.hostCall,
    },
  }),
  // Native code puts numbers and null there, and what a program has stored as `_repeat` becomes `_idleTimeout` when the timer fires.
  ...["_idleStart", "_idleTimeout", "_repeat"].map(name =>
    b.method(`%Timeout%.prototype.${name}`, {
      getter: b.any,
      capability: "heap",
      uses: { this: [b.readsContents(), b.returnedFrom(timerFieldsCell)] },
      implementation: b.hostCall,
      setter: {
        value: b.any,
        capability: "heap",
        uses: { this: [b.writesContents()], value: [b.storedIn(b.nativeCell(timerFieldsCell))] },
        implementation: b.hostCall,
      },
    }),
  ),
  b.fn("setImmediate", {
    args: { callback: b.callable, passed: b.any.rest },
    returns: b.instance("Immediate").fresh,
    capability: "heap",
    throws: true,
    uses: scheduled("Later"),
    reads: externalState,
    writes: externalState,
    implementation: b.hostCall,
  }),
  b.fn("clearTimeout", timerCancellation),
  b.fn("clearInterval", timerCancellation),
  b.fn("clearImmediate", timerCancellation),

  b.fn("queueMicrotask", {
    args: { callback: b.callable },
    capability: "heap",
    uses: {
      callback: [
        b.called({
          afterwards: "TouchesOnlyWhatRowNames",
          times: "Later",
          this: b.undefined,
          args: [],
          result: "Ignored",
        }),
      ],
    },
    reads: externalState,
    writes: externalState,
    implementation: b.hostCall,
  }),

  // The native code counts its arguments: without one it throws, and `undefined` is one.
  b.fn("structuredClone", [
    {
      args: { value: b.primitiveValue.optional, options: b.null.optional },
      returns: b.primitiveValue,
      capability: "heap",
      throws: true,
      implementation: b.hostCall,
    },
    {
      args: { value: b.any.optional, options: b.any.optional },
      returns: b.any.fresh,
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      uses: { value: cloned, options: transferList },
      reads: heapsReadByClone,
      writes: heapsWrittenByTransfer,
      implementation: b.hostCall,
    },
  ]),

  b.fn("fetch", fetch),
  // constructBunFetchObject in BunObject.cpp makes both functions, each with a member of its own.
  b.static("fetch.preconnect", preconnect),
  b.static("Bun.fetch.preconnect", preconnect),

  b.fn("reportError", {
    args: { error: b.any.optional },
    capability: "js",
    throws: true,
    uses: { error: [b.everything] },
    reads: externalState,
    writes: externalState,
    implementation: b.hostCall,
  }),
);
