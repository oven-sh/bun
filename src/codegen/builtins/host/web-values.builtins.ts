import * as b from "bun-builtins-table";
import { socketDataCell, webSocketDataCell, webSocketHandlerCell, webSocketsCell } from "./native-cells.ts";

type Fields = Readonly<Record<string, b.Field>>;
type StringOperation = Omit<b.SignatureOptions, "args" | "capability" | "runsOnlyOperandCode" | "implementation">;

const externalState = ["ExternalState"];
const viewHeaps = ["TypedArrayStorage", "TypedArrayElements"];

const operandCodeOnly = { capability: "js", runsOnlyOperandCode: true } as const;

const characters = [b.readAsCharacters];
const convertedToCharacters = [b.readAsCharacters, b.runs("ToPrimitive")];
const readsState = [b.readsContents()];
const changesState = [b.readsContents(), b.writesContents()];
const membersInspected = (...names: readonly string[]) => [b.runs(b.named(...names)), b.membersOnlyInspected];

const stateRead = { uses: { this: readsState }, reads: externalState } satisfies Partial<b.SignatureOptions>;
const stateChanged = {
  uses: { this: changesState },
  reads: externalState,
  writes: externalState,
} satisfies Partial<b.SignatureOptions>;

const stringOrNull = b.union(b.string, b.strictNull);
const newArrayOfStrings = b.instance("Array").holding({ element: b.string }).fresh;
const arrayBufferView = b.union(b.instance("TypedArray"), b.instance("DataView"));
const byteSource = b.union(arrayBufferView, b.instance("ArrayBuffer"), b.instance("SharedArrayBuffer"));

const membersOf = (holder: b.BuiltinPath, fields: Fields) =>
  Object.entries(fields).flatMap(([name, field]) => b.method(`${holder}.${name}`, field));

const eachOf = <Value>(names: readonly string[], value: Value) => Object.fromEntries(names.map(name => [name, value]));

const cachedIn = (className: string, member: string): b.ImplementationSpec => ({
  how: "CachedGetter",
  cppClass: `JS${className}`,
  member: `m_${member}`,
});

// A call that leaves out a required string throws before it converts the others.
const takingStrings = (required: readonly string[], optional: readonly string[], operation: StringOperation) => {
  const names = [...required, ...optional];
  return [
    {
      ...operation,
      args: { ...eachOf(required, b.string), ...eachOf(optional, b.string.optional) },
      capability: "heap",
      uses: { ...operation.uses, ...eachOf(names, characters) },
      implementation: b.hostCall,
    },
    {
      ...operation,
      ...operandCodeOnly,
      args: eachOf(names, b.any.optional),
      throws: true,
      uses: { ...operation.uses, ...eachOf(names, convertedToCharacters) },
      implementation: b.hostCall,
    },
  ] satisfies b.FunctionField[];
};

// A sequence of sequences of strings, or a record of strings.
const pairsOfStrings = [b.runsTransitively("Iterate", "OwnKeys", "OwnValues", "PrototypeChain", "ToPrimitive")];

// The iterator keeps the native headers or parameters alive, and not the object that wraps them.
const newIterator = (iteratorClass: b.ClassName) =>
  ({
    ...stateRead,
    returns: b.instance(iteratorClass).fresh,
    capability: "heap",
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

const forEachPair = {
  ...operandCodeOnly,
  args: { callback: b.callable, thisArg: b.any.optional },
  throws: true,
  uses: {
    this: readsState,
    callback: [
      b.called({
        afterwards: "TouchesOnlyWhatRowNames",
        times: "PerElement",
        this: b.operand("thisArg"),
        args: [b.string, b.string, b.operand("this")],
        result: "Ignored",
      }),
    ],
    thisArg: b.inspected,
  },
  reads: externalState,
  implementation: b.hostCall,
} satisfies b.FunctionField;

const pairIteration = (iteratorClass: b.ClassName) =>
  ({
    entries: newIterator(iteratorClass),
    keys: newIterator(iteratorClass),
    values: newIterator(iteratorClass),
    forEach: forEachPair,
  }) satisfies Fields;

// next() tests its receiver against the base class.
const pairIteratorClass = (
  iterated: b.ClassName,
  instanceCppClass: b.CppClassRef,
  prototypeCppExpression: string,
  structureSlot: string,
  usesFeature: b.FeatureName,
) =>
  b.class(`%${iterated}Iterator%`, {
    extends: "Iterator",
    instanceCppClass,
    prototypeCppExpression,
    instanceStructureCppExpression: `globalObject->domStructure(WebCore::DOMStructureSlot::${structureSlot})`,
    hasConstructor: false,
    stateHeap: "ExternalState",
    lockedMembers: ["prototype"],
    usesFeature,
    proto: {
      next: {
        ...stateChanged,
        returns: b.ordinaryObjectOf("StringPairIteratorResult").fresh,
        capability: "heap",
        throws: true,
        implementation: b.hostCall,
      },
      "@@toStringTag": b.property(b.enumeration([`${iterated} Iterator`])),
    },
  });

const serialized = {
  ...stateRead,
  returns: b.string,
  capability: "heap",
  implementation: b.hostCall,
} satisfies b.FunctionField;

const newHeaders = b.instance("Headers").fresh;

const otherReceiverIgnored = {
  this: b.any,
  returns: b.undefined,
  capability: "none",
  uses: { this: b.inspected },
  implementation: b.hostCall,
} satisfies b.FunctionField;

const parsesURL = (returns: b.TableType, throws: boolean) => takingStrings(["url"], ["base"], { returns, throws });

// Native code makes the object at the first read and keeps it for the later ones. It is nothing that the program has handed over.
const madeOnceAndKept = (className: string, cell: string) => [
  b.createdIn(b.instance(className).fresh, b.nativeCell(cell)),
  b.returnedFrom(cell),
];

const urlComponent = {
  ...stateRead,
  getter: b.string,
  capability: "heap",
  implementation: b.hostCall,
} satisfies b.GetterField;

const assignableURLComponent = {
  ...urlComponent,
  setter: {
    ...stateChanged,
    value: b.string.loose,
    capability: "heap",
    throws: true,
    uses: { this: changesState, value: characters },
    implementation: b.hostCall,
  },
} satisfies b.GetterField;

const assignableURLComponents = [
  "href",
  "protocol",
  "username",
  "password",
  "host",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash",
];

const newURLSearchParams = b.instance("URLSearchParams").fresh;

const pairCount = {
  ...stateRead,
  getter: b.u32,
  capability: "none",
  implementation: b.hostCall,
} satisfies b.GetterField;

const newTextDecoder = b.instance("TextDecoder").fresh;

const decodedText = {
  returns: b.string,
  throws: true,
  implementation: b.hostCall,
} satisfies Partial<b.FunctionField>;

const decoderFlag = {
  getter: b.bool,
  capability: "none",
  uses: { this: readsState },
  implementation: b.hostCall,
} satisfies b.GetterField;

const encodedInto = {
  returns: b.ordinaryObjectOf("ReadAndWrittenCounts").fresh,
  implementation: b.hostCall,
} satisfies Partial<b.FunctionField>;

const keepsData = (className: string, cell: string, getterImplementation: b.ImplementationSpec) =>
  b.method(`%${className}%.prototype.data`, {
    getter: b.any,
    capability: "heap",
    uses: { this: [...readsState, b.returnedFrom(cell)] },
    implementation: getterImplementation,
    setter: {
      value: b.any,
      capability: "heap",
      uses: { this: [b.writesContents()], value: [b.storedIn(b.nativeCell(cell))] },
      implementation: b.hostCall,
    },
  });

const anyMessage = [b.readAsCharacters, b.readsContents(), b.runs("ToPrimitive")];
const textMessage = characters;
const binaryMessage = readsState;

// A socket that is closed inside a call has its close handler called before the call returns, and the error handler with what that one throws. close and terminate close this socket.
const mayClose = (socket: b.PlaceLike) => [
  b.keptCalled(webSocketHandlerCell("close"), {
    times: "Once",
    this: b.undefined,
    args: [socket, b.f64, b.string],
    result: "Ignored",
  }),
  b.keptCalled(webSocketHandlerCell("error"), {
    times: "Once",
    this: b.undefined,
    args: [b.any, socket],
    result: "Ignored",
  }),
];
const writesToSocket = [...changesState, ...mayClose(b.operand("this"))];
const writesToSubscribers = [...writesToSocket, ...mayClose(b.nativeCell(webSocketsCell))];

// On a closed socket send, subscribe and close answer before they look at an argument, so no parameter is strict and no conversion is hoisted.
const socketTraffic = {
  returns: b.int(-1, Number.MAX_SAFE_INTEGER),
  capability: "js",
  throws: true,
  reads: [...viewHeaps, ...externalState],
  writes: externalState,
  implementation: b.hostCall,
} satisfies b.FunctionField;

const sends = (message: readonly b.UseSpec[]) =>
  ({
    ...socketTraffic,
    args: { message: b.any.optional, compress: b.any.optional },
    uses: { this: writesToSocket, message, compress: b.inspected },
  }) satisfies b.FunctionField;

const publishes = (message: readonly b.UseSpec[]) =>
  ({
    ...socketTraffic,
    args: { topic: b.any.optional, message: b.any.optional, compress: b.any.optional },
    uses: { this: writesToSubscribers, topic: characters, message, compress: b.inspected },
  }) satisfies b.FunctionField;

const topicOperation = (state: readonly b.UseSpec[]) =>
  ({
    args: { topic: b.any.optional },
    returns: b.bool,
    capability: "heap",
    throws: true,
    uses: { this: state, topic: characters },
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

export default b.declarations(
  b.tuple("StringPair", [b.string, b.string]),
  b.layout("StringPairIteratorResult", {
    value: b.union(b.string, b.layoutOf("StringPair"), b.undefined),
    done: b.bool,
  }),

  b.construction("Headers", [
    { args: { init: b.undefined.optional }, returns: newHeaders, capability: "heap", implementation: b.hostCall },
    {
      args: { init: b.instance("Headers") },
      returns: newHeaders,
      capability: "heap",
      uses: { init: readsState },
      reads: externalState,
      implementation: b.hostCall,
    },
    {
      ...operandCodeOnly,
      args: { init: b.any },
      returns: newHeaders,
      throws: true,
      uses: { init: pairsOfStrings },
      implementation: b.hostCall,
    },
  ]),
  membersOf("Headers.prototype", {
    ...pairIteration("HeadersIterator"),
    get: takingStrings(["name"], [], { ...stateRead, returns: stringOrNull, throws: true }),
    has: takingStrings(["name"], [], { ...stateRead, returns: b.bool, throws: true }),
    delete: takingStrings(["name"], [], { ...stateChanged, throws: true }),
    set: takingStrings(["name", "value"], [], { ...stateChanged, throws: true }),
    append: takingStrings(["name", "value"], [], { ...stateChanged, throws: true }),
    getAll: [
      ...takingStrings(["name"], [], { ...stateRead, returns: newArrayOfStrings, throws: true }),
      otherReceiverIgnored,
    ],
    getSetCookie: [
      { ...stateRead, returns: newArrayOfStrings, capability: "heap", implementation: b.hostCall },
      otherReceiverIgnored,
    ],
    toJSON: { ...stateRead, returns: b.plainData, capability: "heap", implementation: b.hostCall },
    count: [
      { ...stateRead, getter: b.u32, capability: "none", implementation: b.hostCall },
      {
        this: b.any,
        getter: b.undefined,
        capability: "none",
        uses: { this: b.inspected },
        implementation: b.hostCall,
      },
    ],
  }),
  b.same("Headers.prototype.@@iterator", "Headers.prototype.entries"),
  pairIteratorClass(
    "Headers",
    b.cppClass("FetchHeadersIteratorBase", "JSFetchHeaders.h"),
    "fetchHeadersIteratorPrototype(*globalObject)",
    "FetchHeadersIterator",
    "Headers",
  ),

  // A request and a response have headers of their own: a copy of what the constructor was handed, or what came over the wire.
  ["Request", "Response"].flatMap(name =>
    b.method(`${name}.prototype.headers`, {
      getter: b.instance("Headers"),
      capability: "heap",
      throws: true,
      uses: { this: madeOnceAndKept("Headers", `${name}.headers`) },
      reads: externalState,
      writes: externalState,
      implementation: { how: "CachedGetter", cppClass: `JS${name}`, member: "m_headers" },
    }),
  ),

  b.construction("URL", parsesURL(b.instance("URL").fresh, true)),
  b.static("URL.canParse", parsesURL(b.bool, false)),
  b.static("URL.parse", parsesURL(b.union(b.instance("URL"), b.strictNull).fresh, false)),
  membersOf("URL.prototype", {
    ...eachOf(assignableURLComponents, assignableURLComponent),
    origin: urlComponent,
    // Every read answers the same object, which native code makes at the first one, and a change to it changes the URL.
    searchParams: {
      ...urlComponent,
      getter: b.instance("URLSearchParams"),
      uses: { this: [...readsState, ...madeOnceAndKept("URLSearchParams", "URL.searchParams")] },
    },
    toString: serialized,
    toJSON: serialized,
  }),

  b.construction("URLSearchParams", [
    {
      args: { init: b.string.optional },
      returns: newURLSearchParams,
      capability: "heap",
      uses: { init: characters },
      implementation: b.hostCall,
    },
    {
      ...operandCodeOnly,
      args: { init: b.any },
      returns: newURLSearchParams,
      throws: true,
      uses: { init: pairsOfStrings },
      implementation: b.hostCall,
    },
  ]),
  membersOf("URLSearchParams.prototype", {
    ...pairIteration("URLSearchParamsIterator"),
    get: takingStrings(["name"], [], { ...stateRead, returns: stringOrNull }),
    getAll: takingStrings(["name"], [], { ...stateRead, returns: newArrayOfStrings }),
    has: takingStrings(["name"], ["value"], { ...stateRead, returns: b.bool }),
    delete: takingStrings(["name"], ["value"], stateChanged),
    set: takingStrings(["name", "value"], [], stateChanged),
    append: takingStrings(["name", "value"], [], stateChanged),
    sort: { ...stateChanged, capability: "heap", implementation: b.hostCall },
    toString: serialized,
    // The object has an own @@toStringTag, which plain data has not.
    toJSON: { ...stateRead, returns: b.object.fresh, capability: "heap", implementation: b.hostCall },
    size: pairCount,
    length: pairCount,
  }),
  b.same("URLSearchParams.prototype.@@iterator", "URLSearchParams.prototype.entries"),
  pairIteratorClass(
    "URLSearchParams",
    b.cppClass("URLSearchParamsIteratorBase", "JSURLSearchParams.h"),
    "urlSearchParamsIteratorPrototype(*globalObject)",
    "URLSearchParamsIterator",
    "Url",
  ),

  b.construction("%TextDecoder%", [
    {
      args: { label: b.string.optional, options: b.null.optional },
      returns: newTextDecoder,
      capability: "heap",
      throws: true,
      uses: { label: characters },
      implementation: b.hostCall,
    },
    {
      ...operandCodeOnly,
      args: { label: b.string.loose.optional, options: b.any.optional },
      returns: newTextDecoder,
      throws: true,
      uses: { label: characters, options: membersInspected("fatal", "ignoreBOM") },
      implementation: b.hostCall,
    },
  ]),
  membersOf("%TextDecoder%.prototype", {
    // The stream option is read before the kind of the input is tested.
    decode: [
      {
        ...decodedText,
        args: { input: byteSource.optional, options: b.null.optional },
        capability: "heap",
        uses: { this: changesState, input: readsState },
      },
      {
        ...decodedText,
        ...operandCodeOnly,
        args: { input: byteSource.optional, options: b.any.optional },
        uses: { this: changesState, input: readsState, options: membersInspected("stream") },
      },
    ],
    encoding: {
      getter: b.string,
      capability: "heap",
      uses: { this: readsState },
      implementation: cachedIn("TextDecoder", "encoding"),
    },
    fatal: decoderFlag,
    ignoreBOM: decoderFlag,
  }),

  b.class("TextEncoder", {
    instanceCppClass: b.cppClass("JSTextEncoder"),
    types: [b.viewType("TextEncoder")],
    call: { returns: b.never, capability: "heap", throws: true, implementation: b.hostCall },
    construct: { returns: b.instance("TextEncoder").fresh, capability: "heap", implementation: b.hostCall },
    proto: {
      encoding: {
        getter: b.enumeration(["utf-8"]),
        capability: "heap",
        uses: { this: b.inspected },
        implementation: b.hostCall,
      },
      encode: takingStrings([], ["input"], {
        returns: b.instance("Uint8Array").exactly.fresh,
        throws: true,
        uses: { this: b.inspected },
      }),
      // Any view is taken as the destination, and its kind is tested after the source is converted.
      encodeInto: [
        {
          ...encodedInto,
          args: { source: b.string, destination: arrayBufferView },
          capability: "heap",
          uses: { this: b.inspected, source: characters, destination: changesState },
          directEntry: b.typedEntry({
            calls: { latin1: "TextEncoder__encodeInto8", utf16: "TextEncoder__encodeInto16" },
            headers: ["headers-handwritten.h"],
            parameters: ["Characters", "Bytes"],
            returnsFields: ["read", "written"],
          }),
        },
        {
          ...encodedInto,
          ...operandCodeOnly,
          args: { source: b.string.loose, destination: arrayBufferView },
          throws: true,
          uses: { this: b.inspected, source: convertedToCharacters, destination: changesState },
        },
        {
          ...encodedInto,
          ...operandCodeOnly,
          args: { source: b.any.optional, destination: arrayBufferView.optional },
          throws: true,
          uses: { this: b.inspected, source: convertedToCharacters, destination: changesState },
        },
      ],
    },
  }),

  // The first value of a websocket is the one upgrade was given.
  keepsData("ServerWebSocket", webSocketDataCell, cachedIn("ServerWebSocket", "data")),
  keepsData("TCPSocket", socketDataCell, cachedIn("TCPSocket", "data")),
  keepsData("TLSSocket", socketDataCell, cachedIn("TLSSocket", "data")),
  keepsData("Listener", socketDataCell, b.hostCall),

  membersOf("%ServerWebSocket%.prototype", {
    send: sends(anyMessage),
    sendText: sends(textMessage),
    sendBinary: sends(binaryMessage),
    publish: publishes(anyMessage),
    publishText: publishes(textMessage),
    publishBinary: publishes(binaryMessage),
    ping: sends(binaryMessage),
    pong: sends(binaryMessage),
    subscribe: topicOperation(changesState),
    // Leaving the last topic writes out what was published to this socket.
    unsubscribe: { ...topicOperation(writesToSocket), capability: "js" },
    isSubscribed: topicOperation(readsState),
    // The listeners for `abort` on the signal of the request that was upgraded run too.
    close: {
      args: { code: b.any.optional, reason: b.any.optional },
      capability: "js",
      throws: true,
      uses: { this: writesToSocket, code: b.inspected, reason: convertedToCharacters },
      implementation: b.hostCall,
    },
    terminate: { capability: "js", throws: true, uses: { this: writesToSocket }, implementation: b.hostCall },
    // What was written inside the callback is sent when it returns.
    cork: {
      args: { callback: b.callable },
      returns: b.callbackResult("callback"),
      capability: "js",
      throws: true,
      uses: {
        this: writesToSubscribers,
        callback: [
          b.called({
            afterwards: "TouchesOnlyWhatRowNames",
            times: "Once",
            this: b.operand("this"),
            args: [b.operand("this")],
            result: "Returned",
          }),
        ],
      },
      implementation: b.hostCall,
    },
  }),
);
