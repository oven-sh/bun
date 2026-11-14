import * as b from "bun-builtins-table";
import { prototypeBehindGlobalListsAllMembers } from "../collect-webcore-tables.ts";
import { methodsOfSubtleCrypto } from "./methods-of-subtle-crypto.ts";
import { cookiesOfRequestsCell, parametersOfRequestsCell, parametersOfRoutesWithoutAnyCell } from "./native-cells.ts";
import { answering, constructing, promiseOf } from "./native-code.ts";

const externalState = ["ExternalState"];
const objectOrUndefined = b.union(b.object, b.undefined);
const convertedToCharacters = [b.runs("ToPrimitive")];
const runsCodeOfOperands = {
  capability: "js",
  throws: true,
  runsOnlyOperandCode: true,
  implementation: b.generic,
} satisfies Partial<b.FunctionField>;

const webCoreClass = (name: string, instanceCppClass: b.CppClassRef, options: b.ClassOptions = {}) =>
  b.class(name, { instanceCppClass, types: [b.viewType(name)], ...options });

const lockedNativeValue = (structureSlot: string): b.ClassOptions => ({
  instanceStructureCppExpression: `globalObject->domStructure(WebCore::DOMStructureSlot::${structureSlot})`,
  lockedMembers: ["prototype"],
  stateHeap: "ExternalState",
});

const constructorOnly = (path: b.BuiltinPath, options: b.ClassOptions = {}) =>
  b.class(path, { hasPrototype: false, ...options });

// WorkerMessagingProxy.cpp :334 :339 :464-562 :619, Worker.cpp :217: what native code makes for the listeners of a started Worker and of the worker's own global object. The row of addEventListener says that an Event is made.
const eventsOfWorker = ["MessageEvent", "ErrorEvent", "CloseEvent"].map(name =>
  b.createdIn(b.instance(name), b.nativeMemory),
);
const startedWorker = {
  returns: b.instance("Worker").fresh,
  capability: "js",
  throws: true,
  implementation: b.hostCall,
} satisfies Partial<b.FunctionField>;

const codecStream = (name: string) =>
  webCoreClass(name, b.cppClass(`JS${name}`, `streams/JS${name}.h`), {
    prototypeListsAllMembers: prototypeBehindGlobalListsAllMembers(name),
    construct: [
      {
        args: { format: b.string, options: b.any.optional },
        returns: b.instance(name).fresh,
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: { options: [b.runsTransitively(b.named("highWaterMark", "size", "level"), "ToPrimitive")] },
        implementation: b.hostCall,
      },
      // JSCompressionStreamShared.cpp :31-47: what is no text is made one of; where that text names no format, the refusal prints the value as it was handed in.
      {
        args: { format: b.any.optional, options: b.any.optional },
        returns: b.instance(name).fresh,
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: {
          format: [b.runs("ToPrimitive"), b.printedByFormatter()],
          options: [b.runsTransitively(b.named("highWaterMark", "size", "level"), "ToPrimitive")],
        },
        implementation: b.hostCall,
      },
    ],
  });

export default b.declarations(
  b.class("%BunRequest%", {
    extends: "Request",
    instanceCppClass: b.cppClass("Bun::JSBunRequest", "JSBunRequest.h"),
    prototypeCppExpression:
      "globalObject->m_JSBunRequestStructure.getInitializedOnMainThread(globalObject)->storedPrototypeObject()",
    instanceStructureCppExpression: "globalObject->m_JSBunRequestStructure.getConcurrently()",
    hasConstructor: false,
    lockedMembers: ["prototype"],
    types: [b.viewType("bun.BunRequest")],
    proto: {
      clone: {
        returns: b.instance("BunRequest").fresh,
        capability: "js",
        throws: true,
        // A map of cookies that the request has made is copied for the clone.
        uses: {
          this: [
            b.readsContents(),
            b.runsTransitively("OwnKeys", "OwnValues"),
            b.createdIn(b.instance("Bun.CookieMap").fresh, b.nativeCell(cookiesOfRequestsCell)),
          ],
        },
        reads: externalState,
        writes: externalState,
        implementation: b.hostCall,
      },
      // JSBunRequest.cpp: the map is made of the header at the first read and kept in the request. Another receiver gets undefined.
      cookies: {
        this: b.any,
        getter: b.union(b.instance("Bun.CookieMap"), b.undefined),
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: {
          this: [
            b.runs(b.named("headers")),
            b.createdIn(b.instance("Bun.CookieMap").fresh, b.nativeCell(cookiesOfRequestsCell)),
            b.returnedFrom(cookiesOfRequestsCell),
          ],
        },
        reads: externalState,
        writes: externalState,
        implementation: b.generic,
      },
      // The host makes the object with the request, or at the first read, and keeps it in the request. Another receiver gets undefined.
      params: {
        this: b.any,
        getter: objectOrUndefined,
        capability: "heap",
        uses: {
          this: [b.returnedFrom(parametersOfRequestsCell), b.returnedFrom(parametersOfRoutesWithoutAnyCell)],
        },
        reads: externalState,
        writes: externalState,
        implementation: b.generic,
      },
    },
  }),

  // ServerRouteList.cpp: a string under each name of the route. Object.prototype is not above it: createJSBunRequestParamsPrototype()
  // makes an empty object below an object without a prototype that bears the tag, of which the table says nothing. A route without names gets an object without a prototype.
  b.namespace("%RequestParamsTag%", {}),
  b.inherits("%RequestParamsTag%", null),
  b.namespace("%RequestParamsPrototype%", {}),
  b.inherits("%RequestParamsPrototype%", "%RequestParamsTag%"),
  b.hostObject(parametersOfRequestsCell, { prototype: "%RequestParamsPrototype%", otherNames: b.string }),
  b.hostObject(parametersOfRoutesWithoutAnyCell, { prototype: null }),

  // JSFFICallback.cpp of JavaScriptCore: what Bun.FFI.callback() makes. bun:ffi lays each below JSCallback.prototype.
  // createPrototype(): an object below Object.prototype with `close` and nothing else. Of the own properties of an instance, `ptr` and `threadsafe`, the table says nothing.
  b.class("%FFICallback%", {
    hasConstructor: false,
    // bun:ffi gives every one another prototype.
    isNeverPristine: true,
    prototypeListsAllMembers: true,
    stateHeap: "ExternalState",
    proto: {
      // A callback that is closed has no address any more. On another receiver it throws.
      close: {
        capability: "heap",
        throws: true,
        uses: { this: [b.definesName(["ptr"], b.strictNull)] },
        reads: externalState,
        writes: externalState,
        implementation: b.generic,
      },
    },
  }),

  webCoreClass("SubtleCrypto", b.cppClass("JSSubtleCrypto"), {
    proto: {
      ...Object.fromEntries(methodsOfSubtleCrypto.map(name => [name, b.otherwiseBy(b.generic)])),
      digest: answering(promiseOf(b.instance("ArrayBuffer"))),
      sign: answering(promiseOf(b.instance("ArrayBuffer"))),
      verify: answering(promiseOf(b.bool)),
    },
  }),
  b.method("Crypto.prototype.subtle", {
    getter: b.instance("SubtleCrypto"),
    capability: "heap",
    throws: true,
    uses: { this: b.inspected },
    mutability: "ConstantUnlessWritten",
    implementation: b.generic,
    setter: {
      this: b.any,
      value: b.any,
      capability: "none",
      uses: { this: b.inspected, value: b.inspected },
      implementation: b.generic,
    },
  }),

  webCoreClass("Headers", b.cppClass("JSFetchHeaders"), lockedNativeValue("JSFetchHeaders")),
  webCoreClass("URL", b.cppClass("JSDOMURL"), lockedNativeValue("JSDOMURL")),
  webCoreClass("URLSearchParams", b.cppClass("JSURLSearchParams"), lockedNativeValue("JSURLSearchParams")),
  b.class("EventTarget", {
    instanceCppClass: b.cppClass("JSEventTarget"),
    construct: {
      returns: b.instance("EventTarget").exactly.fresh,
      capability: "heap",
      throws: true,
      implementation: b.hostCall,
    },
  }),
  webCoreClass("AbortSignal", b.cppClass("JSAbortSignal"), { extends: "EventTarget" }),
  // JSReadableStreamPrototype::finishCreation(): the rows of its C++ table, the tag and the method for util.inspect, which are collected, and what stands here. It also lays
  // an accessor under a private name of Bun's, which no text can spell.
  webCoreClass("ReadableStream", b.cppClass("JSReadableStream", "streams/JSReadableStream.h"), {
    prototypeListsAllMembers: true,
    proto: Object.fromEntries(
      ["readable", "errored", "disturbed"].map(state => [
        `@@@nodejs.stream.${state}`,
        {
          getter: b.bool,
          capability: "heap",
          throws: true,
          uses: { this: b.inspected },
          reads: externalState,
          implementation: b.generic,
        } satisfies b.GetterField,
      ]),
    ),
  }),
  b.same("ReadableStream.prototype.@@asyncIterator", "ReadableStream.prototype.values"),
  codecStream("CompressionStream"),
  codecStream("DecompressionStream"),

  ["Bun.WebView", "WebSocket"].flatMap(path => constructorOnly(path, { extends: "EventTarget" })),
  constructorOnly("Worker", {
    extends: "EventTarget",
    construct: [
      // What the URL and `preload` name is loaded into the global of the Worker, which begins a program of its own.
      {
        ...startedWorker,
        args: { url: b.string, options: b.undefined },
        uses: { url: [b.workerEntryPath, ...eventsOfWorker] },
      },
      {
        ...startedWorker,
        args: { url: b.any.optional, options: b.any.optional },
        uses: { url: [b.everything, b.workerEntryPath, ...eventsOfWorker], options: [b.everything] },
      },
    ],
  }),
  constructorOnly("CryptoKey"),
  // JSURLPattern.cpp: the constructor converts a string or the members of a dictionary, and makes the wrapper of a new URLPattern.
  constructorOnly("URLPattern", { construct: constructing(b.instance("URLPattern").fresh, b.hostCall) }),
  // JSURLPatternPrototype: an object below Object.prototype that bears the tag of the class. Of its members the table says nothing.
  b.static("URLPattern.prototype", b.property(b.instance("URLPattern"))),
  constructorOnly("Bun.Cookie"),
  b.class("Bun.CookieMap", { instanceCppClass: b.cppClass("JSCookieMap"), ...lockedNativeValue("JSCookieMap") }),
  // Both constructors stand below Object.prototype.
  ["Bun.Cookie", "Bun.CookieMap"].flatMap(path => b.inherits(path, "Object.prototype")),

  // JSCookie.cpp: they make strings of their operands, and `from` reads the members of its options.
  b.static("Bun.Cookie.parse", {
    ...runsCodeOfOperands,
    args: { text: b.any.optional },
    returns: b.instance("Bun.Cookie").fresh,
    uses: { text: convertedToCharacters },
  }),
  b.static("Bun.Cookie.from", {
    ...runsCodeOfOperands,
    args: { name: b.any.optional, value: b.any.optional, options: b.any.optional },
    returns: b.instance("Bun.Cookie").fresh,
    uses: { name: convertedToCharacters, value: convertedToCharacters, options: [b.everything] },
  }),
  // JSWebViewConstructor.cpp: it kills the processes of the browsers. What waits for them hears of it in a later turn of the event loop.
  b.static("Bun.WebView.closeAll", {
    args: {},
    returns: b.undefined,
    capability: "none",
    writes: externalState,
    implementation: b.generic,
  }),
  // FormData.bind.ts: a Blob, a string or bytes, and it throws for anything else.
  b.static("FormData.from", {
    ...runsCodeOfOperands,
    args: { input: b.any.optional, boundary: b.any.optional },
    returns: b.instance("FormData").fresh,
    uses: { input: [b.readsContents(), b.runs("ToPrimitive")], boundary: convertedToCharacters },
    reads: ["TypedArrayStorage", "TypedArrayElements", ...externalState],
  }),
  // JSSubtleCrypto.cpp: it reads the members of the algorithms as the methods of crypto.subtle do.
  b.static("SubtleCrypto.supports", {
    ...runsCodeOfOperands,
    this: b.any,
    args: { operation: b.any.optional, algorithm: b.any.optional, lengthOrAdditionalAlgorithm: b.any.optional },
    returns: b.bool,
    uses: {
      this: b.inspected,
      operation: convertedToCharacters,
      algorithm: [b.everything],
      lengthOrAdditionalAlgorithm: [b.everything],
    },
  }),
  // ObjectURLRegistry.bind.ts: they throw for an operand of another type. The registry keeps the bytes and not the Blob.
  b.static("URL.createObjectURL", {
    args: { object: b.any.optional },
    returns: b.string,
    capability: "heap",
    throws: true,
    uses: { object: b.inspected },
    reads: externalState,
    writes: externalState,
    implementation: b.generic,
  }),
  b.static("URL.revokeObjectURL", {
    ...runsCodeOfOperands,
    args: { url: b.any.optional },
    returns: b.undefined,
    uses: { url: convertedToCharacters },
    reads: externalState,
    writes: externalState,
  }),
);
