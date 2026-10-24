// Constructors and objects of the global object and of native modules of which the table says no more than what they are: whoever reads one gets that object.
import * as b from "bun-builtins-table";
import { builtinModulesCell, cryptoObjectCell } from "./native-cells.ts";
import { handedOver } from "./native-code.ts";

const constructorOnly = (path: b.BuiltinPath, options: b.ClassOptions = {}) =>
  b.class(path, { hasPrototype: false, ...options });

const constructorsBelowFunctionPrototype = [
  "ByteLengthQueuingStrategy",
  "CountQueuingStrategy",
  "DOMException",
  "File",
  "FormData",
  "MessageChannel",
  "PerformanceEntry",
  "PerformanceObserver",
  "PerformanceObserverEntryList",
  "PerformanceServerTiming",
  "PerformanceTiming",
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

const undeclaredFunction = b.otherwiseBy(b.generic);

// src/jsc/bindings/webcore/streams: without operands a construction runs no code of the program; with them it reads their members, calls `start` and keeps the rest.
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
              uses: Object.fromEntries(operands.map(operand => [operand, handedOver])),
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
  constructorsBelowFunctionPrototype.flatMap(path => constructorOnly(path)),
  Object.entries(constructorsBelow).flatMap(([parent, paths]) =>
    paths.flatMap(path => constructorOnly(path, { extends: parent })),
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
      type: readsStream(b.string),
      eventPhase: readsStream(b.int(0, 65535)),
      bubbles: readsStream(b.bool),
      cancelable: readsStream(b.bool),
      defaultPrevented: readsStream(b.bool),
      composed: readsStream(b.bool),
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
    abort: undeclaredFunction,
    close: undeclaredFunction,
    getWriter: undeclaredFunction,
  }),
  // The three classes of a byte stream. A byte stream takes the bytes of the view that it is handed: the buffer behind the view is empty afterwards.
  partOfByteStream("ReadableByteStreamController", {
    byobRequest: readsStream(b.any),
    desiredSize: readsStream(b.union(b.f64, b.null)),
    close: undeclaredFunction,
    enqueue: takesBytesOf("chunk", b.undefined),
    error: undeclaredFunction,
  }),
  // For a receiver that is no reader both answer a new rejected promise.
  partOfByteStream("ReadableStreamBYOBReader", {
    closed: { ...readsStream(b.any), this: b.any, mutability: "ChangesOnItsOwn" },
    cancel: undeclaredFunction,
    read: { ...takesBytesOf("view", b.any), this: b.any },
    releaseLock: undeclaredFunction,
  }),
  partOfByteStream("ReadableStreamBYOBRequest", {
    view: readsStream(b.any),
    respond: undeclaredFunction,
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
  ["AbortController", "AbortSignal"].flatMap(name =>
    b.extend(`AbortController.${name}`, { mutability: "ChangesOnItsOwn" }),
  ),
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
        uses: { this: [b.retained], reason: [b.retained] },
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
  b.static(
    "crypto",
    b.property(b.instance("Crypto"), {
      createdOnFirstRead: {
        capability: "heap",
        uses: {
          this: [
            b.createdIn(b.instance("Crypto").fresh, b.nativeCell(cryptoObjectCell)),
            b.returnedFrom(cryptoObjectCell),
          ],
        },
      },
    }),
  ),
  b.namespace("navigator", {
    userAgent: describesMachine(b.string),
    platform: describesMachine(b.string),
    hardwareConcurrency: describesMachine(b.f64),
    "@@toStringTag": b.property(b.string),
  }),
  b.inherits("navigator", "Object.prototype"),

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
  // JSAbortSignal.cpp: without a script execution context they answer undefined. No slot of the class holds the reason yet, so native memory does.
  b.static("AbortSignal.abort", {
    args: { reason: b.any.optional },
    returns: newAbortSignal,
    capability: "heap",
    throws: true,
    uses: { reason: [b.retained] },
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
            b.createdIn(listOfStrings.fresh, b.nativeCell(builtinModulesCell)),
            b.returnedFrom(builtinModulesCell),
          ],
        },
      },
    }),
  ),

  // src/jsc/modules/NodeBufferModule.h.
  b.same("node:buffer.File", "File"),
  ["INSPECT_MAX_BYTES", "kMaxLength", "kStringMaxLength"].flatMap(name =>
    b.static(`node:buffer.${name}`, b.property(b.f64)),
  ),
  b.namespace("node:buffer.constants", { MAX_LENGTH: b.property(b.f64), MAX_STRING_LENGTH: b.property(b.f64) }),
  b.inherits("node:buffer.constants", "Object.prototype"),
  ["SlowBuffer", "isAscii", "isUtf8", "resolveObjectURL", "transcode"].flatMap(name =>
    b.static(`node:buffer.${name}`, undeclaredFunction),
  ),
  // Its `prototype` is Buffer.prototype.
  b.extend("node:buffer.SlowBuffer", { hasUndeclaredMembers: true }),
);
