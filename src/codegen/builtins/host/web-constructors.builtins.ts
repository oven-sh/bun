// Constructors and objects of the global object and of native modules of which the table says no more than what they are: whoever reads one gets that object.
import * as b from "bun-builtins-table";
import { cppClassBehindGlobal, prototypeBehindGlobalListsAllMembers } from "../collect-webcore-tables.ts";
import { builtinModulesCell, targetsOfEventsCell } from "./native-cells.ts";
import { answering, constructing, handedOver, promiseOf } from "./native-code.ts";

const constructorsBelowFunctionPrototype = [
  "ByteLengthQueuingStrategy",
  "CountQueuingStrategy",
  "DOMException",
  "FormData",
  "MessageChannel",
  "PerformanceEntry",
  "PerformanceObserver",
  "PerformanceObserverEntryList",
  "PerformanceServerTiming",
  "ReadableStreamDefaultController",
  "ReadableStreamDefaultReader",
  "TextDecoderStream",
  "TransformStreamDefaultController",
  "WritableStreamDefaultController",
  "WritableStreamDefaultWriter",
];

const constructorsBelow = {
  Event: ["CloseEvent", "CustomEvent", "ErrorEvent", "MessageEvent"],
  EventTarget: ["BroadcastChannel", "MessagePort"],
  PerformanceEntry: ["PerformanceMark", "PerformanceMeasure", "PerformanceResourceTiming"],
};

// JSDOMConstructorNotConstructable.h: native code alone makes the instances. The constructor throws, called or constructed.
const refused = {
  returns: b.never,
  capability: "heap",
  throws: true,
  implementation: b.hostCall,
} satisfies b.FunctionField;
const constructorsThatMakeNothing = [
  "MessagePort",
  "PerformanceEntry",
  "PerformanceMeasure",
  "PerformanceObserverEntryList",
  "PerformanceResourceTiming",
  "PerformanceServerTiming",
  "ReadableStreamDefaultController",
  "TransformStreamDefaultController",
  "WritableStreamDefaultController",
];
// JSPerformanceEntry.cpp, JSPerformanceResourceTiming.cpp, JSPerformanceServerTiming.cpp: each getter answers what native code keeps for the entry, and throws on any other receiver.
const partOfEntry = (getter: b.TableType, capability: b.Capability) =>
  ({
    getter,
    capability,
    throws: true,
    uses: { this: b.inspected },
    implementation: b.generic,
  }) satisfies b.GetterField;
const partsOfEntry = (texts: readonly string[], numbers: readonly string[]) =>
  Object.fromEntries([
    ...texts.map(name => [name, partOfEntry(b.string, "heap")]),
    ...numbers.map(name => [name, partOfEntry(b.f64, "none")]),
  ]);
// toJSON() makes an ordinary object and puts the parts on it.
const partsAsObject = (texts: readonly string[], numbers: readonly string[]) =>
  ({
    returns: b.instance("Object").fresh,
    resultProperties: Object.fromEntries([
      ...texts.map(name => [name, b.string]),
      ...numbers.map(name => [name, b.f64]),
    ]),
    capability: "heap",
    throws: true,
    uses: { this: b.inspected },
    implementation: b.generic,
  }) satisfies b.FunctionField;
// JSPerformanceObserverEntryList.cpp, JSPerformanceObserver.cpp: each call makes an array of entries that mark(), measure() or a fetch has made. An operand is made a string.
const listsEntries = (operands: readonly string[], writes: readonly string[] = []) =>
  ({
    args: Object.fromEntries(operands.map(operand => [operand, b.any.optional])),
    returns: b.instance("Array").holding({ element: b.instance("PerformanceEntry") }).fresh,
    capability: operands.length === 0 ? "heap" : "js",
    runsOnlyOperandCode: operands.length !== 0,
    throws: true,
    uses: { this: b.inspected, ...Object.fromEntries(operands.map(operand => [operand, [b.runs("ToPrimitive")]])) },
    reads: ["ExternalState"],
    writes,
    implementation: b.generic,
  }) satisfies b.FunctionField;
const membersOfPrototypes: Readonly<Record<string, Readonly<Record<string, b.Field>>>> = {
  PerformanceEntry: {
    ...partsOfEntry(["name", "entryType"], ["startTime", "duration"]),
    toJSON: partsAsObject(["name", "entryType"], ["startTime", "duration"]),
  },
  PerformanceObserver: {
    // PerformanceObserver::Init: `entryTypes` is iterated over and each of its values made a string, `type` is made a string, `buffered` a boolean.
    observe: {
      args: { options: b.any.optional },
      capability: "js",
      runsOnlyOperandCode: true,
      throws: true,
      uses: {
        this: [b.retained],
        options: [b.runsTransitively(b.named("buffered", "entryTypes", "type"), "Iterate", "ToPrimitive")],
      },
      reads: ["ExternalState"],
      writes: ["ExternalState"],
      implementation: b.generic,
    },
    disconnect: {
      capability: "heap",
      throws: true,
      uses: { this: b.inspected },
      writes: ["ExternalState"],
      implementation: b.generic,
    },
    takeRecords: listsEntries([], ["ExternalState"]),
  },
  PerformanceObserverEntryList: {
    getEntries: listsEntries([]),
    getEntriesByType: listsEntries(["type"]),
    getEntriesByName: listsEntries(["name", "type"]),
  },
  PerformanceResourceTiming: partsOfEntry(
    ["initiatorType", "nextHopProtocol"],
    [
      "workerStart",
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
      "transferSize",
      "encodedBodySize",
      "decodedBodySize",
    ],
  ),
  PerformanceServerTiming: {
    ...partsOfEntry(["name", "description"], ["duration"]),
    toJSON: partsAsObject(["name", "description"], ["duration"]),
  },
};
// JSPerformanceObserverCallback.cpp: while the observer is registered, native code calls the function on it with a new list of the entries and with the observer, and drops the answer.
const constructionOfObserver = {
  call: refused,
  construct: [
    {
      args: { callback: b.callable },
      returns: b.instance("PerformanceObserver").fresh,
      capability: "heap",
      throws: true,
      uses: {
        callback: [
          b.retained,
          b.called({
            afterwards: "TouchesOnlyWhatRowNames",
            times: "PerEvent",
            this: b.result,
            args: [b.instance("PerformanceObserverEntryList").fresh, b.result],
            result: "Ignored",
          }),
        ],
      },
      implementation: b.hostCall,
    },
    { ...refused, args: { callback: b.any.optional }, uses: { callback: b.inspected } },
  ],
} satisfies b.ClassOptions;
const rowsOfConstructor = (path: string): b.ClassOptions => ({
  instanceCppClass: cppClassBehindGlobal(path),
  prototypeListsAllMembers: prototypeBehindGlobalListsAllMembers(path),
  ...(constructorsThatMakeNothing.includes(path) ? { call: refused, construct: refused } : {}),
  ...(path === "PerformanceObserver" ? constructionOfObserver : {}),
  ...(path in membersOfPrototypes ? { proto: membersOfPrototypes[path] } : {}),
});

// JSBuffer.cpp: constructSlowBuffer is Buffer.allocUnsafeSlow.
const allocatedSlowly = {
  args: { size: b.f64 },
  returns: b.instance("Buffer"),
  capability: "heap",
  throws: true,
  implementation: b.generic,
} satisfies b.FunctionField;

const numbersFrom = (first: number, ...names: readonly string[]) =>
  Object.fromEntries(names.map((name, index) => [name, b.constant(first + index)]));
const constantsOf = (holder: b.BuiltinPath, constants: Readonly<Record<string, b.ConstantField>>) =>
  Object.entries(constants).flatMap(([name, constant]) => b.static(`${holder}.${name}`, constant));

const phasesOfEvent = numbersFrom(0, "NONE", "CAPTURING_PHASE", "AT_TARGET", "BUBBLING_PHASE");
const statesOfWebSocket = numbersFrom(0, "CONNECTING", "OPEN", "CLOSING", "CLOSED");
const codesOfDOMException = numbersFrom(
  1,
  "INDEX_SIZE_ERR",
  "DOMSTRING_SIZE_ERR",
  "HIERARCHY_REQUEST_ERR",
  "WRONG_DOCUMENT_ERR",
  "INVALID_CHARACTER_ERR",
  "NO_DATA_ALLOWED_ERR",
  "NO_MODIFICATION_ALLOWED_ERR",
  "NOT_FOUND_ERR",
  "NOT_SUPPORTED_ERR",
  "INUSE_ATTRIBUTE_ERR",
  "INVALID_STATE_ERR",
  "SYNTAX_ERR",
  "INVALID_MODIFICATION_ERR",
  "NAMESPACE_ERR",
  "INVALID_ACCESS_ERR",
  "VALIDATION_ERR",
  "TYPE_MISMATCH_ERR",
  "SECURITY_ERR",
  "NETWORK_ERR",
  "ABORT_ERR",
  "URL_MISMATCH_ERR",
  "QUOTA_EXCEEDED_ERR",
  "TIMEOUT_ERR",
  "INVALID_NODE_TYPE_ERR",
  "DATA_CLONE_ERR",
);

// src/jsc/bindings/webcore/streams: without operands a construction runs no code of the program; with them it reads their members, calls `start` and keeps the rest.
// The members of the first operand are called with the controller, which native code makes with the stream.
const streamClass = (name: string, operands: readonly string[], proto: Readonly<Record<string, b.Field>>) =>
  b.class(name, {
    // The C++ classes of TextEncoderStream, TextDecoderStream, CompressionStream and DecompressionStream inherit from the one of TransformStream, and their instances are no instances of TransformStream: a test by that C++ class would take them for some.
    ...(name === "TransformStream" ? {} : { instanceCppClass: b.cppClass(`JS${name}`, `streams/JS${name}.h`) }),
    types: [b.viewType(name)],
    call: { returns: b.never, capability: "heap", throws: true, implementation: b.hostCall },
    construct: [
      {
        args: Object.fromEntries(operands.map(operand => [operand, b.undefined.optional])),
        returns: b.instance(name).fresh,
        capability: "heap",
        throws: true,
        implementation: b.hostCall,
      },
      ...(operands.length === 0
        ? []
        : [
            {
              args: Object.fromEntries(operands.map(operand => [operand, b.any.optional])),
              returns: b.instance(name).fresh,
              capability: "js",
              throws: true,
              uses: Object.fromEntries(
                operands.map((operand, index) => [
                  operand,
                  index
                    ? handedOver
                    : [...handedOver, b.createdIn(b.instance(`${name}DefaultController`), b.nativeMemory)],
                ]),
              ),
              implementation: b.hostCall,
            } satisfies b.FunctionField,
          ]),
    ],
    proto,
  });
// The two ends of a transform stream, which native code makes with it.
const endOfTransformStream = (holder: string, className: string) =>
  ({
    getter: b.instance(className),
    capability: "heap",
    throws: true,
    uses: {
      this: [
        b.createdIn(b.instance(className).fresh, b.nativeCell(`${holder}.${className}`)),
        b.returnedFrom(`${holder}.${className}`),
      ],
    },
    implementation: b.generic,
  }) satisfies b.GetterField;
const endsOfTransformStream = (holder: string) => ({
  readable: endOfTransformStream(holder, "ReadableStream"),
  writable: endOfTransformStream(holder, "WritableStream"),
});
const readsStream = (getter: b.TableType) =>
  ({
    getter,
    capability: "heap",
    throws: true,
    uses: { this: b.inspected },
    reads: ["ExternalState"],
    implementation: b.generic,
  }) satisfies b.GetterField;
// An event that nobody dispatched has none.
const targetOfEvent = {
  ...readsStream(b.null),
  uses: { this: [b.returnedFrom(targetsOfEventsCell)] },
} satisfies b.GetterField;
// JSEvent.cpp: the setter makes a boolean of what it is given.
const flagOfEvent = {
  ...readsStream(b.bool),
  setter: {
    value: b.any,
    capability: "heap",
    throws: true,
    uses: { this: b.inspected, value: b.inspected },
    writes: ["ExternalState"],
    implementation: b.generic,
  },
} satisfies b.GetterField;
const partOfByteStream = (name: string, proto: Readonly<Record<string, b.Field>>) =>
  b.class(name, { instanceCppClass: b.cppClass(`JS${name}`, `streams/JS${name}.h`), proto });
const takesBytesOf = (operand: string, returns: b.TableType) =>
  ({
    args: { [operand]: b.any.optional, others: b.any.rest },
    returns,
    capability: "js",
    throws: true,
    uses: { this: [b.retained], [operand]: [...handedOver, b.writesContents()], others: handedOver },
    implementation: b.generic,
  }) satisfies b.FunctionField;
const signalsOfControllersCell = "AbortController.signal";
const reasonsOfSignalsCell = "AbortSignal.reason";
// `reason` of a signal answers it. Native code hands it on besides: to what waits for the signal, and as what a promise is rejected with.
const keptAsReason = [b.retained, b.storedIn(b.nativeCell(reasonsOfSignalsCell))];
const describesMachine = (getter: b.TableType) =>
  ({
    this: b.any,
    getter,
    capability: "heap",
    uses: { this: b.inspected },
    implementation: b.generic,
  }) satisfies b.GetterField;
const newAbortSignal = b.union(b.instance("AbortSignal"), b.undefined).fresh;
const listOfStrings = b.instance("Array").holding({ element: b.string });

// src/jsc/bindings/JSStringDecoder.cpp. A decoder keeps the bytes of a character that is not complete yet.
const stateOfDecoder = ["ExternalState"];
const decodersMadeByCallCell = "StringDecoder.madeByCall";
// Nothing leads from the realm to the constructor, and it is no function with native code of its own, so a validated build takes it for native code that nothing describes: its operands are said to be handed over, which costs nothing where an encoding is a string.
const encodingOfDecoder = [b.retained, b.runs("ToPrimitive")];
const readsDecoder = (getter: b.TableType) =>
  ({
    this: b.any.refusing(b.null),
    getter,
    capability: "heap",
    throws: true,
    uses: { this: b.inspected },
    reads: stateOfDecoder,
    implementation: b.generic,
  }) satisfies b.GetterField;
const decodes = (args: Readonly<Record<string, b.TableType>>, uses: Readonly<Record<string, readonly b.UseSpec[]>>) =>
  ({
    this: b.any.refusing(b.null),
    args,
    returns: b.string,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { this: b.inspected, ...uses },
    reads: [...stateOfDecoder, "TypedArrayElements", "TypedArrayStorage"],
    writes: stateOfDecoder,
    implementation: b.generic,
  }) satisfies b.FunctionField;

export default b.declarations(
  constructorsBelowFunctionPrototype.flatMap(path => b.class(path, rowsOfConstructor(path))),
  Object.entries(constructorsBelow).flatMap(([parent, paths]) =>
    paths.flatMap(path => b.class(path, { extends: parent, ...rowsOfConstructor(path) })),
  ),
  // Its prototype object is that of Blob: b.same() below.
  b.class("File", { extends: "Blob", hasPrototype: false }),
  // A File is a Blob, and the constructor stands below Function.prototype all the same.
  b.inherits("File", "Function.prototype"),
  // JSDOMException.cpp: the constructor stands below Function.prototype, the prototype object below that of Error.
  b.inherits("DOMException.prototype", "Error.prototype"),
  constantsOf("DOMException", codesOfDOMException),
  constantsOf("WebSocket", statesOfWebSocket),
  // JSPerformanceObserver.cpp makes the list at each read and freezes it. A global object without a context answers undefined.
  b.static(
    "PerformanceObserver.supportedEntryTypes",
    b.property(b.union(listOfStrings, b.undefined), { createdOnFirstRead: { capability: "heap" } }),
  ),
  // Called without `new` on another object, it puts a decoder on that object under a private name, where the methods find it, defines `encoding` and answers the object.
  b.class("node:string_decoder.StringDecoder", {
    instanceCppClass: b.cppClass("WebCore::JSStringDecoder", "JSStringDecoder.h"),
    call: {
      this: b.any,
      args: { encoding: b.any.optional },
      returns: b.union(b.operand("this"), b.instance("node:string_decoder.StringDecoder")),
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      uses: {
        this: [
          b.retained,
          b.returned,
          b.definesName(["encoding"], b.string),
          // The private name has no spelling.
          b.definesName(b.anyKey, b.object),
          b.createdIn(b.instance("node:string_decoder.StringDecoder").fresh, b.nativeCell(decodersMadeByCallCell)),
          b.returnedFrom(decodersMadeByCallCell),
        ],
        encoding: encodingOfDecoder,
      },
      implementation: b.generic,
    },
    construct: {
      args: { encoding: b.any.optional },
      returns: b.instance("node:string_decoder.StringDecoder").fresh,
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      uses: { encoding: encodingOfDecoder },
      implementation: b.generic,
    },
    proto: {
      lastChar: readsDecoder(b.instance("Buffer").fresh),
      lastNeed: readsDecoder(b.f64),
      lastTotal: readsDecoder(b.f64),
      encoding: readsDecoder(b.string),
      // The message of the error about another value prints it.
      write: decodes({ buffer: b.any.optional }, { buffer: [b.readsContents(), b.printedByFormatter("constructor")] }),
      end: decodes({ buffer: b.any.optional }, { buffer: [b.readsContents()] }),
      text: decodes(
        { buffer: b.any.optional, offset: b.any.optional },
        { buffer: [b.readsContents()], offset: [b.runs("ToPrimitive")] },
      ),
    },
  }),
  // JSEvent.cpp. The constructor makes a string of the type and reads three members of the options, each of which it takes for a boolean.
  b.class("Event", {
    instanceCppClass: b.cppClass("JSEvent"),
    types: [b.viewType("Event")],
    // `isTrusted` is an own property of every event, not a member of Event.prototype.
    namesDefinedOnNewInstances: ["isTrusted"],
    static: phasesOfEvent,
    call: { returns: b.never, capability: "heap", throws: true, implementation: b.hostCall },
    construct: [
      // The type is required: it counts the operands, so a type that is not passed is not one that is undefined.
      { args: { type: b.notPassed }, returns: b.never, capability: "heap", throws: true, implementation: b.hostCall },
      {
        args: {
          type: b.union(b.undefined, b.null, b.bool, b.f64, b.string, b.bigint),
          eventInitDict: b.union(b.undefined, b.null).optional,
        },
        returns: b.instance("Event").fresh,
        capability: "heap",
        throws: true,
        implementation: b.hostCall,
      },
      {
        args: { type: b.any, eventInitDict: b.any.optional },
        returns: b.instance("Event").fresh,
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: {
          type: [b.runs("ToPrimitive")],
          eventInitDict: [b.runs("PrototypeChain", b.named("bubbles", "cancelable", "composed"))],
        },
        implementation: b.hostCall,
      },
    ],
    proto: {
      ...phasesOfEvent,
      type: readsStream(b.string),
      eventPhase: readsStream(b.int(0, 65535)),
      bubbles: readsStream(b.bool),
      cancelable: readsStream(b.bool),
      defaultPrevented: readsStream(b.bool),
      composed: readsStream(b.bool),
      // jsEvent_timeStampGetter: a global object without a context answers undefined.
      timeStamp: readsStream(b.union(b.f64, b.undefined)),
      target: targetOfEvent,
      currentTarget: targetOfEvent,
      srcElement: targetOfEvent,
      cancelBubble: flagOfEvent,
      returnValue: flagOfEvent,
      ...Object.fromEntries(
        ["preventDefault", "stopPropagation", "stopImmediatePropagation"].map(name => [
          name,
          {
            returns: b.undefined,
            capability: "heap",
            throws: true,
            uses: { this: b.inspected },
            writes: ["ExternalState"],
            implementation: b.generic,
          } satisfies b.FunctionField,
        ]),
      ),
    },
  }),
  streamClass("WritableStream", ["underlyingSink", "strategy"], {
    locked: readsStream(b.bool),
    abort: answering(promiseOf(b.undefined)),
    close: answering(promiseOf(b.undefined)),
    getWriter: answering(b.instance("WritableStreamDefaultWriter")),
  }),
  // The three classes of a byte stream. A byte stream takes the bytes of the view that it is handed: the buffer behind the view is empty afterwards.
  partOfByteStream("ReadableByteStreamController", {
    byobRequest: readsStream(b.union(b.instance("ReadableStreamBYOBRequest"), b.null)),
    desiredSize: readsStream(b.union(b.f64, b.null)),
    close: answering(b.undefined),
    enqueue: takesBytesOf("chunk", b.undefined),
    error: answering(b.undefined),
  }),
  // For a receiver that is no reader both answer a new rejected promise.
  partOfByteStream("ReadableStreamBYOBReader", {
    closed: { ...readsStream(b.any), this: b.any, mutability: "ChangesOnItsOwn" },
    cancel: answering(promiseOf(b.undefined)),
    read: { ...takesBytesOf("view", b.any), this: b.any },
    releaseLock: answering(b.undefined),
  }),
  partOfByteStream("ReadableStreamBYOBRequest", {
    view: readsStream(b.any),
    respond: answering(b.undefined),
    respondWithNewView: takesBytesOf("view", b.undefined),
  }),
  streamClass(
    "TransformStream",
    ["transformer", "writableStrategy", "readableStrategy"],
    endsOfTransformStream("TransformStream"),
  ),
  streamClass("TextEncoderStream", [], {
    encoding: readsStream(b.string),
    ...endsOfTransformStream("TextEncoderStream"),
  }),

  // What the module abort-controller exports is this constructor (objectModules in collect-modules.ts), on which it puts three more members when it is loaded: src/jsc/modules/AbortControllerModuleModule.h.
  Object.entries({
    AbortController: "AbortController",
    AbortSignal: "AbortSignal",
    default: "AbortController",
  }).flatMap(([name, held]) => [
    ...b.static(`AbortController.${name}`, b.property(b.union(b.builtin(held), b.undefined))),
    ...b.extend(`AbortController.${name}`, { mutability: "ChangesOnItsOwn" }),
  ]),
  // JSAbortController.cpp. A controller has one signal, which native code makes with it.
  b.class("AbortController", {
    instanceCppClass: b.cppClass("JSAbortController"),
    construct: {
      returns: b.instance("AbortController").fresh,
      capability: "heap",
      throws: true,
      implementation: b.hostCall,
    },
    proto: {
      signal: {
        getter: b.instance("AbortSignal"),
        capability: "heap",
        throws: true,
        uses: {
          this: [
            b.createdIn(b.instance("AbortSignal").fresh, b.nativeCell(signalsOfControllersCell)),
            b.returnedFrom(signalsOfControllersCell),
          ],
        },
        implementation: b.generic,
      },
      // The listeners of the signal, and of the signals that depend on it, run before it returns. The signal keeps the reason.
      abort: {
        args: { reason: b.any.optional },
        returns: b.undefined,
        capability: "js",
        throws: true,
        // Nothing leads from the realm to a member of the module's entry, so a validated build takes the function for native code that nothing describes.
        uses: { this: [b.retained], reason: keptAsReason },
        implementation: b.generic,
      },
    },
  }),
  Object.entries({ write: 1, end: 1, text: 2 }).flatMap(([name, length]) =>
    b.extend(`node:string_decoder.StringDecoder.prototype.${name}`, {
      functionObjectCode: { symbol: `WebCore::jsStringDecoderPrototypeFunction_${name}`, header: "JSStringDecoder.h" },
      length,
    }),
  ),
  b.same("BuildError", "BuildMessage"),
  b.same("ResolveError", "ResolveMessage"),

  // The realm makes the one instance of Crypto with the global object.
  b.namespace("crypto", {}, { listsAllMembers: true }),
  b.inherits("crypto", "Crypto.prototype"),
  b.namespace("navigator", {
    userAgent: describesMachine(b.string),
    platform: describesMachine(b.string),
    hardwareConcurrency: describesMachine(b.f64),
    "@@toStringTag": b.property(b.string),
  }),
  b.inherits("navigator", "Object.prototype"),

  // Called without `new` they throw. A File is a Blob that has a name.
  Object.entries({
    ByteLengthQueuingStrategy: "ByteLengthQueuingStrategy",
    CountQueuingStrategy: "CountQueuingStrategy",
    CustomEvent: "CustomEvent",
    DOMException: "DOMException",
    ErrorEvent: "ErrorEvent",
    File: "Blob",
    MessageEvent: "MessageEvent",
  }).flatMap(([name, made]) => [
    ...b.construction(name, constructing(b.instance(made), b.hostCall)),
    ...b.callOfConstructor(name, answering(b.never, b.hostCall)),
  ]),
  // AbortSignal.cpp: what abort() of a controller or AbortSignal.abort() was handed, on this signal or on one that it follows, or the DOMException that toJS() makes of a CommonAbortReason.
  b.method("AbortSignal.prototype.reason", {
    getter: b.any,
    capability: "heap",
    throws: true,
    uses: {
      this: [
        // Native code lays line, column, sourceURL and stack on it, which no `new DOMException()` has: it is not called fresh.
        b.createdIn(b.instance("DOMException"), b.nativeCell(reasonsOfSignalsCell)),
        b.returnedFrom(reasonsOfSignalsCell),
      ],
    },
    reads: ["ExternalState"],
    implementation: b.generic,
  }),
  b.method("AbortSignal.prototype.aborted", {
    getter: b.bool,
    capability: "heap",
    throws: true,
    uses: { this: b.inspected },
    reads: ["ExternalState"],
    implementation: b.generic,
  }),
  // It throws the reason, which the signal was handed or native code has made.
  b.method("AbortSignal.prototype.throwIfAborted", {
    returns: b.undefined,
    capability: "heap",
    throws: true,
    uses: { this: b.inspected },
    reads: ["ExternalState"],
    implementation: b.generic,
  }),
  // JSAbortSignal.cpp: without a script execution context they answer undefined.
  b.static("AbortSignal.abort", {
    args: { reason: b.any.optional },
    returns: newAbortSignal,
    capability: "heap",
    throws: true,
    uses: { reason: keptAsReason },
    implementation: b.generic,
  }),
  b.static("AbortSignal.timeout", {
    args: { milliseconds: b.any.optional },
    returns: newAbortSignal,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { milliseconds: [b.runs("ToPrimitive")] },
    implementation: b.generic,
  }),
  // The message of the error about an element that is no signal prints the element.
  b.static("AbortSignal.any", {
    args: { signals: b.any.optional },
    returns: newAbortSignal,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: {
      signals: [
        b.retained,
        b.iteratedValuesStoredIn(b.nativeMemory),
        b.runs("Iterate"),
        b.printedByFormatter("constructor"),
      ],
    },
    implementation: b.generic,
  }),

  // getBuiltinModulesObject in NodeModuleModule.cpp makes the list at the first read.
  b.static(
    "node:module.builtinModules",
    b.property(listOfStrings, {
      createdOnFirstRead: {
        capability: "heap",
        uses: {
          this: [
            b.createdIn(listOfStrings.fresh.dense, b.nativeCell(builtinModulesCell)),
            b.returnedFrom(builtinModulesCell),
          ],
        },
      },
    }),
  ),

  b.same("File.prototype", "Blob.prototype"),
  // src/jsc/modules/NodeBufferModule.h.
  b.same("node:buffer.File", "File"),
  ["INSPECT_MAX_BYTES", "kMaxLength", "kStringMaxLength"].flatMap(name =>
    b.static(`node:buffer.${name}`, b.property(b.f64)),
  ),
  b.namespace("node:buffer.constants", { MAX_LENGTH: b.property(b.f64), MAX_STRING_LENGTH: b.property(b.f64) }),
  b.inherits("node:buffer.constants", "Object.prototype"),
  Object.entries({
    isAscii: b.bool,
    isUtf8: b.bool,
    resolveObjectURL: b.union(b.instance("Blob"), b.undefined),
    transcode: b.instance("Buffer"),
  }).flatMap(([name, answer]) => b.static(`node:buffer.${name}`, answering(answer))),
  b.static("node:buffer.SlowBuffer", allocatedSlowly),
  b.extend("node:buffer.SlowBuffer", { hasUndeclaredMembers: true }),
  b.same("node:buffer.SlowBuffer.prototype", "Buffer.prototype"),
  // `new SlowBuffer(..)` runs the same function, and the Buffer that it answers takes the place of the new object.
  b.constructionOfFunction("node:buffer.SlowBuffer", allocatedSlowly),
);
