// Constructors and objects of the global object and of native modules of which the table says no more than what they are: whoever reads one gets that object.
import * as b from "bun-builtins-table";
import { cppClassBehindGlobal, prototypeBehindGlobalListsAllMembers } from "../collect-webcore-tables.ts";
import { builtinModulesCell, detailsOfEventsCell, errorsOfEventsCell, targetsOfEventsCell } from "./native-cells.ts";
import { answering, constructing, promiseOf, retainedByNativeCode } from "./native-code.ts";

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
// JSTextDecoderStream.cpp :122-172: options that are no object, null or undefined are refused, and what is described there is a primitive. `fatal` and `ignoreBOM` are read and made booleans of; the label is made a text of.
const constructionOfDecoderStream = {
  types: [b.viewType("TextDecoderStream")],
  call: refused,
  construct: [
    {
      args: { label: b.string.optional, options: b.null.optional },
      returns: b.instance("TextDecoderStream").fresh,
      capability: "heap",
      throws: true,
      uses: { label: b.inspected },
      implementation: b.hostCall,
    },
    {
      args: { label: b.string.loose.optional, options: b.any.optional },
      returns: b.instance("TextDecoderStream").fresh,
      capability: "js",
      runsOnlyOperandCode: true,
      // The options are tested and read before the label is made a text of.
      readsStateBeforeConversions: true,
      throws: true,
      uses: { label: b.inspected, options: [b.runs(b.named("fatal", "ignoreBOM")), b.membersOnlyInspected] },
      implementation: b.hostCall,
    },
  ],
} satisfies b.ClassOptions;
const rowsOfConstructor = (path: string): b.ClassOptions => ({
  instanceCppClass: cppClassBehindGlobal(path),
  prototypeListsAllMembers: prototypeBehindGlobalListsAllMembers(path),
  ...(constructorsThatMakeNothing.includes(path) ? { call: refused, construct: refused } : {}),
  ...(path === "PerformanceObserver" ? constructionOfObserver : {}),
  ...(constructionsOfClasses[path] ?? {}),
  ...(path === "TextDecoderStream" ? constructionOfDecoderStream : {}),
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
    prototypeListsAllMembers: prototypeBehindGlobalListsAllMembers(name),
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
                    ? retainedByNativeCode
                    : [...retainedByNativeCode, b.createdIn(b.instance(`${name}DefaultController`), b.nativeMemory)],
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
// JSCloseEvent.cpp: as JSEvent.cpp: the type is required and made a string of; options that are no object, null or undefined are refused with a message that names no value; each member is read, through the
// prototype chain, and converted as its kind asks.
const constructionOfEventBelowEvent = (name: string, options: readonly b.UseSpec[]): b.ClassOptions => ({
  types: [b.viewType(name)],
  call: refused,
  construct: [
    { args: { type: b.notPassed }, returns: b.never, capability: "heap", throws: true, implementation: b.hostCall },
    {
      args: {
        type: b.union(b.undefined, b.null, b.bool, b.f64, b.string, b.bigint),
        eventInitDict: b.union(b.undefined, b.null).optional,
      },
      returns: b.instance(name).fresh,
      capability: "heap",
      throws: true,
      implementation: b.hostCall,
    },
    {
      args: { type: b.any, eventInitDict: b.any.optional },
      returns: b.instance(name).fresh,
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      uses: { type: [b.runs("ToPrimitive")], eventInitDict: options },
      implementation: b.hostCall,
    },
  ],
});
const membersOfOptionsOfEvent = (...names: readonly string[]) => [
  b.runs("PrototypeChain"),
  b.runsTransitively(b.named("bubbles", "cancelable", "composed", ...names), "ToPrimitive"),
];
const constructionsOfClasses: Readonly<Record<string, b.ClassOptions>> = {
  CloseEvent: {
    ...constructionOfEventBelowEvent("CloseEvent", membersOfOptionsOfEvent("code", "reason", "wasClean")),
    proto: { wasClean: readsStream(b.bool), code: readsStream(b.int(0, 65535)), reason: readsStream(b.string) },
  },
  // JSCustomEvent.cpp :58-116 :160-190 :268-290, CustomEventCustom.cpp :37, CustomEvent.cpp :60: `detail` is read, kept as it is and answered as it is; an event that was handed none answers null. No native code makes a CustomEvent.
  CustomEvent: {
    ...constructionOfEventBelowEvent("CustomEvent", [
      ...membersOfOptionsOfEvent("detail"),
      b.memberStoredIn(["detail"], b.nativeCell(detailsOfEventsCell)),
    ]),
    proto: {
      detail: { ...readsStream(b.any), uses: { this: [b.handedBackFrom(detailsOfEventsCell)] } },
      initCustomEvent: {
        args: { type: b.any.optional, bubbles: b.any.optional, cancelable: b.any.optional, detail: b.any.optional },
        returns: b.undefined,
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: {
          this: b.inspected,
          type: [b.runs("ToPrimitive")],
          bubbles: b.inspected,
          cancelable: b.inspected,
          detail: [b.storedIn(b.nativeCell(detailsOfEventsCell))],
        },
        writes: ["ExternalState"],
        implementation: b.generic,
      },
    },
  },
  // JSDOMException.cpp :122-167: the message and a name that is no object are made strings of; of options that are an object `name` is read and made a string of, and `cause` is laid on the new object as it is.
  DOMException: {
    call: refused,
    construct: [
      {
        args: { message: b.union(b.undefined, b.string).optional, options: b.union(b.undefined, b.string).optional },
        returns: b.instance("DOMException").fresh,
        capability: "heap",
        throws: true,
        implementation: b.hostCall,
      },
      {
        args: { message: b.any.optional, options: b.any.optional },
        returns: b.instance("DOMException").fresh,
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: {
          message: [b.runs("ToPrimitive")],
          options: [
            b.runs("ToPrimitive", "PrototypeChain"),
            b.runsTransitively(b.named("name", "cause"), "ToPrimitive"),
            b.contentsStoredIn(b.nativeMemory),
          ],
        },
        implementation: b.hostCall,
      },
    ],
    proto: { code: readsStream(b.int(0, 65535)), name: readsStream(b.string), message: readsStream(b.string) },
  },
  // JSErrorEvent.cpp :50-162 :206-236 :305-364, ErrorEvent.cpp :73: `colno` and `lineno` are made numbers of, `filename` and `message` strings; `error` is kept as it is. An event that has none answers null.
  // WorkerMessagingProxy.cpp, Worker.cpp and WebSocket.cpp make ErrorEvents of their own, with an error of their own making: the getter answers more than the program handed in.
  ErrorEvent: {
    ...constructionOfEventBelowEvent("ErrorEvent", [
      ...membersOfOptionsOfEvent("colno", "error", "filename", "lineno", "message"),
      b.memberStoredIn(["error"], b.nativeCell(errorsOfEventsCell)),
    ]),
    proto: {
      message: readsStream(b.string),
      filename: readsStream(b.string),
      lineno: readsStream(b.f64),
      colno: readsStream(b.f64),
      error: { ...readsStream(b.any), uses: { this: [b.returnedFrom(errorsOfEventsCell)] } },
    },
  },
  // JSDOMFormData.cpp :158-178: it looks at none of its operands.
  FormData: {
    call: refused,
    construct: {
      args: { operands: b.any.rest },
      returns: b.instance("FormData").fresh,
      capability: "heap",
      throws: true,
      uses: { operands: b.inspected },
      implementation: b.hostCall,
    },
  },
};
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
  b.class(name, {
    instanceCppClass: b.cppClass(`JS${name}`, `streams/JS${name}.h`),
    prototypeListsAllMembers: prototypeBehindGlobalListsAllMembers(name),
    proto,
  });
// A stream that the program has made runs the functions that it was made with. Every refusal has a message that is written in the C++.
// write() and enqueue() describe nothing themselves. A chunk that a native transformer refuses in a later job (JSTextDecoderStream.cpp :350, JSCompressionStreamShared.cpp :128 :140 :151) is described there, by
// determineSpecificType() in ErrorCode.cpp, which reads `constructor`, its `name`, makes a text of a name that is an object, and reads the symbol of inspection. What has a truthy constructor is called by that name.
// What has none is described natively only if it is a plain object whose method of inspection is not callable, and is printed whole otherwise: an object that may have none brings the printer wherever it is refused
// (noteInstancesLoseTheirConstructor() in AOTFactsOfProgram.cpp).
const onStream = {
  capability: "js",
  throws: true,
  refusalsPrintNoValue: true,
  implementation: b.generic,
} as const;
const keepsStream = { this: [b.retained] };
const optionsOfPipe = [b.retained, b.runs(b.named("preventAbort", "preventCancel", "preventClose", "signal"))];
// The source of the stream is handed the reason.
const cancelsStream = {
  ...onStream,
  this: b.any,
  args: { reason: b.any.optional },
  returns: promiseOf(b.undefined),
  uses: { ...keepsStream, reason: retainedByNativeCode },
} satisfies b.FunctionField;
const closesStream = {
  ...onStream,
  this: b.any,
  returns: promiseOf(b.undefined),
  uses: keepsStream,
} satisfies b.FunctionField;
const readsChunk = {
  ...onStream,
  this: b.any,
  returns: promiseOf(b.anyMadeOf("Object", "Uint8Array")),
  uses: keepsStream,
} satisfies b.FunctionField;
const consumesStream = (settledValue: b.TableType) =>
  ({ ...onStream, returns: promiseOf(settledValue), uses: keepsStream }) satisfies b.FunctionField;
const viewsOfBytes = [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "DataView",
] as const;
const methodsOf = (holder: b.BuiltinPath, fields: Readonly<Record<string, b.Field>>) =>
  Object.entries(fields).flatMap(([name, field]) => b.method(`${holder}.${name}`, field));
const takesBytesOf = (operand: string, returns: b.TableType) =>
  ({
    args: { [operand]: b.any.optional, others: b.any.rest },
    returns,
    capability: "js",
    throws: true,
    uses: {
      this: [b.retained],
      [operand]: [...retainedByNativeCode, b.writesContents()],
      others: retainedByNativeCode,
    },
    implementation: b.generic,
  }) satisfies b.FunctionField;
const takesViewOfBytes = (operand: string) =>
  ({
    ...takesBytesOf(operand, b.undefined),
    args: { [operand]: b.instance("DataView").or(...viewsOfBytes.map(name => b.instance(name))), others: b.any.rest },
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
  // JSReadRequest.cpp, JSReadableStreamAsyncIterator.cpp, JSReadableStreamDefaultReader.cpp: createIteratorResultObject(). A chunk is what the program's own source or transformer
  // enqueued, or what native code makes of bytes: a string, or a Uint8Array (streams.rs to_js(), BunStreamSource.cpp, JSDirectStreamController.cpp, JSReadableByteStreamController.cpp,
  // JSCompressionStreamShared.cpp, WebStreamsMisc.cpp).
  // JSReadableStream.cpp.
  methodsOf("ReadableStream.prototype", {
    locked: readsStream(b.bool),
    cancel: cancelsStream,
    getReader: [
      {
        ...onStream,
        args: { options: b.union(b.undefined, b.null).optional },
        returns: b.instance("ReadableStreamDefaultReader").fresh,
        uses: keepsStream,
      },
      // ERR_INVALID_ARG_VALUE prints a `mode` that is not "byob".
      {
        ...onStream,
        refusalsPrintNoValue: false,
        args: { options: b.any },
        returns: b.union(b.instance("ReadableStreamDefaultReader"), b.instance("ReadableStreamBYOBReader")).fresh,
        uses: { ...keepsStream, options: [b.printedByFormatter("constructor", "mode")] },
      },
    ],
    // What it answers is what `readable` of the operand holds.
    pipeThrough: {
      ...onStream,
      args: { transform: b.any.optional, options: b.any.optional },
      returns: b.instance("ReadableStream"),
      uses: {
        ...keepsStream,
        transform: [b.retained, b.runs(b.named("readable", "writable"))],
        options: optionsOfPipe,
      },
    },
    pipeTo: {
      ...onStream,
      this: b.any,
      args: { destination: b.any.optional, options: b.any.optional },
      returns: promiseOf(b.undefined),
      uses: { ...keepsStream, destination: retainedByNativeCode, options: optionsOfPipe },
    },
    tee: {
      ...onStream,
      returns: b.instance("Array").holding({ element: b.instance("ReadableStream") }).fresh,
      uses: keepsStream,
    },
    values: {
      ...onStream,
      args: { options: b.any.optional },
      returns: b.instance("ReadableStreamAsyncIterator").fresh,
      uses: { ...keepsStream, options: [b.runs(b.named("preventCancel")), b.membersOnlyInspected] },
    },
    // BunStreamConsumers.cpp: what Bun.readableStreamToBlob() and the three beside it call.
    blob: consumesStream(b.anyMadeOf("Blob")),
    bytes: consumesStream(b.anyMadeOf("Uint8Array", "ArrayBuffer")),
    json: consumesStream(b.union(b.plainData, b.strictNull, b.bool, b.f64, b.string)),
    text: consumesStream(b.string),
  }),
  // JSReadableStreamAsyncIterator.cpp: nothing on the global object leads to it: values() makes the instances. For a receiver that is no such iterator both answer a new rejected promise.
  b.class("%ReadableStreamAsyncIterator%", {
    extends: "AsyncIterator",
    instanceCppClass: b.cppClass("JSReadableStreamAsyncIterator", "streams/JSReadableStreamAsyncIterator.h"),
    prototypeCppExpression: "WebCore::JSReadableStreamAsyncIterator::prototype(globalObject->vm(), *globalObject)",
    hasConstructor: false,
    prototypeListsAllMembers: true,
    usesFeature: "WebStreams",
    proto: {
      next: readsChunk,
      return: { ...readsChunk, args: { value: b.any.optional }, uses: { ...keepsStream, value: retainedByNativeCode } },
    },
  }),
  // JSReadableStreamDefaultReader.cpp. For a receiver that is no reader `closed`, `cancel` and `read` answer a new rejected promise.
  methodsOf("ReadableStreamDefaultReader.prototype", {
    closed: { ...readsStream(promiseOf(b.undefined)), this: b.any, mutability: "ChangesOnItsOwn" },
    cancel: cancelsStream,
    read: readsChunk,
    // { value, size, done } with a list of chunks, or a promise of one.
    readMany: { ...onStream, returns: b.anyMadeOf("Object", "Array", "Promise", "Uint8Array"), uses: keepsStream },
    releaseLock: { ...onStream, returns: b.undefined, uses: keepsStream },
  }),
  // JSReadableStreamDefaultController.cpp: INVALID_THIS and ERR_INVALID_STATE, with messages that are written there. enqueue() calls `size` of the strategy and may call `pull` of the source.
  methodsOf("ReadableStreamDefaultController.prototype", {
    desiredSize: readsStream(b.union(b.f64, b.null)),
    close: { ...onStream, returns: b.undefined, uses: keepsStream },
    enqueue: {
      ...onStream,
      args: { chunk: b.any.optional },
      returns: b.undefined,
      uses: { ...keepsStream, chunk: retainedByNativeCode },
    },
    error: {
      ...onStream,
      args: { reason: b.any.optional },
      returns: b.undefined,
      uses: { ...keepsStream, reason: retainedByNativeCode },
    },
  }),
  streamClass("WritableStream", ["underlyingSink", "strategy"], {
    locked: readsStream(b.bool),
    abort: cancelsStream,
    close: closesStream,
    getWriter: { ...onStream, returns: b.instance("WritableStreamDefaultWriter").fresh, uses: keepsStream },
  }),
  // JSWritableStreamDefaultWriter.cpp. For a receiver that is no writer closed, ready, abort, close and write answer a new rejected promise. write() calls `size` of the strategy and, now or later, `write` of the sink.
  methodsOf("WritableStreamDefaultWriter.prototype", {
    closed: { ...readsStream(promiseOf(b.undefined)), this: b.any, mutability: "ChangesOnItsOwn" },
    desiredSize: readsStream(b.union(b.f64, b.null)),
    ready: { ...readsStream(promiseOf(b.undefined)), this: b.any, mutability: "ChangesOnItsOwn" },
    abort: cancelsStream,
    close: closesStream,
    releaseLock: { ...onStream, returns: b.undefined, uses: keepsStream },
    write: {
      ...onStream,
      this: b.any,
      args: { chunk: b.any.optional },
      returns: promiseOf(b.undefined),
      uses: { ...keepsStream, chunk: retainedByNativeCode },
    },
  }),
  // JSWritableStreamDefaultController.cpp, JSTransformStreamDefaultController.cpp: INVALID_THIS and ERR_INVALID_STATE, with messages that are written there.
  methodsOf("WritableStreamDefaultController.prototype", {
    signal: readsStream(b.instance("AbortSignal")),
    error: {
      ...onStream,
      args: { reason: b.any.optional },
      returns: b.undefined,
      uses: { ...keepsStream, reason: retainedByNativeCode },
    },
  }),
  methodsOf("TransformStreamDefaultController.prototype", {
    desiredSize: readsStream(b.union(b.f64, b.null)),
    enqueue: {
      ...onStream,
      args: { chunk: b.any.optional },
      returns: b.undefined,
      uses: { ...keepsStream, chunk: retainedByNativeCode },
    },
    error: {
      ...onStream,
      args: { reason: b.any.optional },
      returns: b.undefined,
      uses: { ...keepsStream, reason: retainedByNativeCode },
    },
    terminate: { ...onStream, returns: b.undefined, uses: keepsStream },
  }),
  // The three classes of a byte stream. A byte stream takes the bytes of the view that it is handed: the buffer behind the view is empty afterwards.
  partOfByteStream("ReadableByteStreamController", {
    byobRequest: readsStream(b.union(b.instance("ReadableStreamBYOBRequest"), b.null)),
    desiredSize: readsStream(b.union(b.f64, b.null)),
    close: { ...onStream, returns: b.undefined, uses: keepsStream },
    enqueue: takesViewOfBytes("chunk"),
    error: {
      ...onStream,
      args: { reason: b.any.optional },
      returns: b.undefined,
      uses: { ...keepsStream, reason: retainedByNativeCode },
    },
  }),
  // For a receiver that is no reader both answer a new rejected promise.
  partOfByteStream("ReadableStreamBYOBReader", {
    closed: { ...readsStream(promiseOf(b.undefined)), this: b.any, mutability: "ChangesOnItsOwn" },
    cancel: cancelsStream,
    read: { ...takesBytesOf("view", promiseOf(b.anyMadeOf("Object", ...viewsOfBytes))), this: b.any },
    releaseLock: { ...onStream, returns: b.undefined, uses: keepsStream },
  }),
  partOfByteStream("ReadableStreamBYOBRequest", {
    view: readsStream(b.any),
    respond: answering(b.undefined),
    respondWithNewView: takesViewOfBytes("view"),
  }),
  streamClass(
    "TransformStream",
    ["transformer", "writableStrategy", "readableStrategy"],
    endsOfTransformStream("TransformStream"),
  ),
  methodsOf("TextDecoderStream.prototype", {
    encoding: readsStream(b.string),
    fatal: readsStream(b.bool),
    ignoreBOM: readsStream(b.bool),
    ...endsOfTransformStream("TextDecoderStream"),
  }),
  methodsOf("CompressionStream.prototype", endsOfTransformStream("CompressionStream")),
  methodsOf("DecompressionStream.prototype", endsOfTransformStream("DecompressionStream")),
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
    File: "Blob",
    MessageEvent: "MessageEvent",
  }).flatMap(([name, made]) => [
    ...b.construction(name, constructing(b.instance(made), b.hostCall)),
    ...b.callOfConstructor(name, answering(b.never, b.hostCall)),
  ]),
  // AbortSignal.cpp: what abort() of a controller or AbortSignal.abort() was handed, on this signal or on one that it follows, or the DOMException that toJS() makes of a CommonAbortReason.
  // A signal that nobody has aborted answers undefined. What abort() was handed may be any value: the type is what native code makes, and no proof.
  b.method("AbortSignal.prototype.reason", {
    getter: b.union(b.undefined, b.instance("DOMException")),
    resultIsDeclaredOnly: true,
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
