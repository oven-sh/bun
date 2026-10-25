import * as b from "bun-builtins-table";

const externalState = ["ExternalState"];
const objectOrUndefined = b.union(b.object, b.undefined);

const webCoreClass = (name: string, instanceCppClass: b.CppClassRef, options: b.ClassOptions = {}) =>
  b.class(name, { instanceCppClass, types: [b.viewType(name)], ...options });

const lockedNativeValue = (structureSlot: string): b.ClassOptions => ({
  instanceStructureCppExpression: `globalObject->domStructure(WebCore::DOMStructureSlot::${structureSlot})`,
  lockedObjects: ["prototype"],
  stateHeap: "ExternalState",
});

const constructorOnly = (path: b.BuiltinPath, options: b.ClassOptions = {}) =>
  b.class(path, { hasPrototype: false, ...options });

const startedWorker = {
  returns: b.instance("Worker").fresh,
  capability: "js",
  throws: true,
  implementation: b.hostCall,
} satisfies Partial<b.FunctionField>;

const codecStream = (name: string) =>
  webCoreClass(name, b.cppClass(`JS${name}`, `streams/JS${name}.h`), {
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
      b.otherwise,
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
    lockedObjects: ["prototype"],
    types: [b.viewType("bun.BunRequest")],
    proto: {
      clone: {
        returns: b.instance("BunRequest").fresh,
        capability: "js",
        throws: true,
        uses: { this: [b.readsContents(), b.runsTransitively("OwnKeys", "OwnValues")] },
        reads: externalState,
        writes: externalState,
        implementation: b.hostCall,
      },
      cookies: {
        this: b.any,
        getter: objectOrUndefined,
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: { this: [b.runs(b.named("headers"))] },
        reads: externalState,
        writes: externalState,
        implementation: b.generic,
      },
      params: {
        this: b.any,
        getter: objectOrUndefined,
        capability: "heap",
        uses: { this: b.inspected },
        reads: externalState,
        writes: externalState,
        implementation: b.generic,
      },
    },
  }),

  webCoreClass("SubtleCrypto", b.cppClass("JSSubtleCrypto")),
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
      returns: b.instance("EventTarget").fresh,
      capability: "heap",
      throws: true,
      implementation: b.hostCall,
    },
  }),
  webCoreClass("AbortSignal", b.cppClass("JSAbortSignal"), { extends: "EventTarget" }),
  webCoreClass("ReadableStream", b.cppClass("JSReadableStream", "streams/JSReadableStream.h")),
  codecStream("CompressionStream"),
  codecStream("DecompressionStream"),

  ["Bun.WebView", "WebSocket"].flatMap(path => constructorOnly(path, { extends: "EventTarget" })),
  constructorOnly("Worker", {
    extends: "EventTarget",
    construct: [
      // What the URL and `preload` name is loaded into the global of the Worker, which begins a program of its own.
      { ...startedWorker, args: { url: b.string, options: b.undefined }, uses: { url: [b.workerEntryPath] } },
      {
        ...startedWorker,
        args: { url: b.any, options: b.any.optional },
        uses: { url: [b.everything, b.workerEntryPath], options: [b.everything] },
      },
    ],
  }),
  ["CryptoKey", "URLPattern"].flatMap(path => constructorOnly(path)),
  ["Bun.Cookie", "Bun.CookieMap"].flatMap(path => [...constructorOnly(path), ...b.inherits(path, "Object.prototype")]),
);
