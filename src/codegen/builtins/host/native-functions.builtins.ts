// The native functions that Bun's own modules make with $newCppFunction, each from the code of the function.
import * as b from "bun-builtins-table";
import { framesOfModuleGraphsCell, moduleGraphsCell } from "./native-cells.ts";

const cpp = (file: string, symbol: string): b.BuiltinPath => `native:NewCppFunction:${file}:${symbol}`;

const externalState = ["ExternalState"];
const operandCodeOnly = { capability: "js", throws: true, runsOnlyOperandCode: true } as const;
const newArrayOf = (elements: b.TableType) => b.instance("Array").holding({ element: elements }).fresh;
const converted = [b.runs("ToPrimitive")];

// It compares the type of a cell.
const testsKindOfCell = {
  args: { value: b.any.optional },
  returns: b.bool,
  capability: "none",
  uses: { value: b.inspected },
  implementation: b.hostCall,
} satisfies b.FunctionField;

const listsCertificates = {
  returns: newArrayOf(b.string),
  capability: "heap",
  throws: true,
  reads: externalState,
  implementation: b.hostCall,
} satisfies b.FunctionField;

// Until the program has made a Bun.ModuleGraph they answer at once.
const looksForModuleGraph = (returns: b.TableType, uses: readonly b.UseSpec[]) =>
  ({
    args: { frame: b.any.optional },
    returns,
    capability: "none",
    uses: { frame: uses },
    reads: ["ObjectFields", "NamedProperties", ...externalState],
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

// Functions on which the host puts members that have no entry yet: fetch.preconnect, Bun.inspect.custom, process.hrtime.bigint .. Bun.$ and Bun.sql are callable objects of classes of the library, and require.resolve inherits `paths` from an object of its own.
const functionsWithUndeclaredMembers = [
  "%ModuleRequire%.resolve",
  "Bun.$",
  "Bun.cron",
  "Bun.fetch",
  "Bun.inspect",
  "Bun.peek",
  "Bun.sql",
  "fetch",
  "process.hrtime",
  "process.memoryUsage",
];

// src/jsc/modules/NodeUtilTypesModule.cpp. Each looks at the type or the C++ class of a cell, isAsyncFunction also at what lies above a function.
const typeTestsOfNode = [
  "isAnyArrayBuffer",
  "isArgumentsObject",
  "isArrayBuffer",
  "isArrayBufferView",
  "isAsyncFunction",
  "isBigInt64Array",
  "isBigIntObject",
  "isBigUint64Array",
  "isBooleanObject",
  "isBoxedPrimitive",
  "isCryptoKey",
  "isDataView",
  "isDate",
  "isEventTarget",
  "isExternal",
  "isFloat16Array",
  "isFloat32Array",
  "isFloat64Array",
  "isGeneratorFunction",
  "isGeneratorObject",
  "isInt16Array",
  "isInt32Array",
  "isInt8Array",
  "isKeyObject",
  "isMap",
  "isMapIterator",
  "isModuleNamespaceObject",
  "isNativeError",
  "isNumberObject",
  "isPromise",
  "isProxy",
  "isRegExp",
  "isSet",
  "isSetIterator",
  "isSharedArrayBuffer",
  "isStringObject",
  "isSymbolObject",
  "isTypedArray",
  "isUint16Array",
  "isUint32Array",
  "isUint8Array",
  "isUint8ClampedArray",
  "isWeakMap",
  "isWeakSet",
];

export default b.declarations(
  typeTestsOfNode.flatMap(name =>
    b.static(`node:util/types.${name}`, { ...testsKindOfCell, implementation: b.generic }),
  ),
  // Nothing leads from the realm to a member of a module: its native code tells which function it is. That of these two belongs to the functions below.
  typeTestsOfNode
    .filter(name => name !== "isMapIterator" && name !== "isSetIterator")
    .flatMap(name =>
      b.extend(`node:util/types.${name}`, {
        functionObjectCode: {
          symbol: `jsFunction${name[0].toUpperCase()}${name.slice(1)}`,
          header: "NodeUtilTypesModule.h",
        },
        length: 1,
      }),
    ),
  functionsWithUndeclaredMembers.flatMap(path => b.extend(path, { hasUndeclaredMembers: true })),

  b.static(cpp("NodeUtilTypesModule.cpp", "jsFunctionIsMapIterator"), testsKindOfCell),
  b.static(cpp("NodeUtilTypesModule.cpp", "jsFunctionIsSetIterator"), testsKindOfCell),
  // It looks for @@toStringTag without running a getter, and asks for the prototype, which a proxy answers with its trap.
  b.static(cpp("NodeUtilTypesModule.cpp", "jsFunctionIsError"), {
    ...operandCodeOnly,
    args: { value: b.any.optional },
    returns: b.bool,
    uses: { value: [b.runs("PrototypeChain")] },
    implementation: b.hostCall,
  }),
  b.static(cpp("UtilInspect.cpp", "jsFunctionGetOwnNonIndexProperties"), {
    ...operandCodeOnly,
    args: { object: b.any.optional, filter: b.any.optional },
    returns: newArrayOf(b.union(b.string, b.symbol)),
    uses: { object: [b.runs("OwnKeys"), b.readsContents()], filter: converted },
    implementation: b.hostCall,
  }),
  b.static(cpp("JSEventTarget.cpp", "jsEventTargetGetEventListenersCount"), {
    ...operandCodeOnly,
    args: { target: b.any.optional, type: b.any.optional },
    returns: b.union(b.f64, b.undefined),
    uses: { target: b.inspected, type: converted },
    reads: externalState,
    implementation: b.hostCall,
  }),
  b.static(cpp("NodeAsyncHooks.cpp", "jsSetAsyncHooksEnabled"), {
    args: { enabled: b.any },
    returns: b.undefined,
    capability: "none",
    uses: { enabled: b.inspected },
    writes: externalState,
    implementation: b.hostCall,
  }),
  b.static(cpp("streams/BunStreamConsumers.cpp", "jsFunctionTransferToNativeReadableStream"), {
    args: { stream: b.any.optional },
    returns: b.undefined,
    capability: "none",
    uses: { stream: b.inspected },
    writes: externalState,
    implementation: b.hostCall,
  }),

  b.static(cpp("ModuleGraph.cpp", "jsFunctionIsFrameOfStoppedModuleGraph"), looksForModuleGraph(b.bool, b.inspected)),
  b.static(
    cpp("ModuleGraph.cpp", "jsFunctionModuleGraphOfFrame"),
    looksForModuleGraph(b.union(b.object, b.undefined), [b.returnedFrom(moduleGraphsCell)]),
  ),
  // The frame it answers is the operand or one below it: one that native code has made, or the copy of one that node:async_hooks has made.
  b.static(
    cpp("ModuleGraph.cpp", "jsFunctionModuleGraphFrameOfFrame"),
    looksForModuleGraph(b.union(b.object, b.undefined), [
      b.returned,
      b.reachableValuesStoredIn(b.result),
      b.returnedFrom(framesOfModuleGraphsCell),
    ]),
  ),

  // What Bun.jest answers. It has no feature: the `require` that gets its names at run time calls it, and such a name keeps nothing.
  b.static(cpp("JSCommonJSModule.cpp", "jsFunctionRequireTestModule"), {
    args: { filename: b.any.optional },
    returns: b.object,
    capability: "js",
    throws: true,
    uses: { filename: b.inspected },
    implementation: b.hostCall,
  }),
  b.static(cpp("NodeTLS.cpp", "getBundledRootCertificates"), listsCertificates),
  b.static(cpp("NodeTLS.cpp", "getExtraCACertificates"), listsCertificates),
  b.static(cpp("NodeTLS.cpp", "getSystemCACertificates"), listsCertificates),
  // The value under the name that fits best, of a Map that is walked without its iterator.
  b.static(cpp("NodeTLS.cpp", "selectServerName"), [
    {
      args: { names: b.instance("Map"), servername: b.any.optional },
      returns: b.union(b.slot("names", "value"), b.undefined),
      capability: "heap",
      throws: true,
      uses: { names: [b.readsContents()], servername: b.inspected },
      implementation: b.hostCall,
    },
    {
      args: { names: b.any.optional, servername: b.any.optional },
      returns: b.undefined,
      capability: "none",
      uses: { names: b.inspected, servername: b.inspected },
      implementation: b.hostCall,
    },
  ]),
);
