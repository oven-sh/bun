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

const functionsBelowOtherObjects = ["%ModuleRequire%.resolve", "Bun.$", "Bun.sql"];

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

const typedArrays = [
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
] as const;

// The classes whose instances a test answers true for, and no others.
const classesToldApart: Readonly<Record<string, readonly b.ClassName[]>> = {
  isAnyArrayBuffer: ["ArrayBuffer", "SharedArrayBuffer"],
  isArgumentsObject: ["Arguments"],
  isArrayBuffer: ["ArrayBuffer"],
  isArrayBufferView: [...typedArrays, "DataView"],
  isBigIntObject: ["BigInt"],
  isBooleanObject: ["Boolean"],
  isBoxedPrimitive: ["BigInt", "Boolean", "Number", "String", "Symbol"],
  isDataView: ["DataView"],
  isDate: ["Date"],
  isMap: ["Map"],
  isMapIterator: ["MapIterator"],
  isNativeError: ["Error"],
  isNumberObject: ["Number"],
  isPromise: ["Promise"],
  isProxy: ["Proxy"],
  isRegExp: ["RegExp"],
  isSet: ["Set"],
  isSetIterator: ["SetIterator"],
  isSharedArrayBuffer: ["SharedArrayBuffer"],
  isStringObject: ["String"],
  isSymbolObject: ["Symbol"],
  isTypedArray: typedArrays,
  isWeakMap: ["WeakMap"],
  isWeakSet: ["WeakSet"],
  ...Object.fromEntries(typedArrays.map(name => [`is${name}`, [name]])),
};

const testOf = (name: string) => {
  const classes = classesToldApart[name];
  if (classes === undefined) return testsKindOfCell;
  const [first, ...others] = classes.map(b.instance);
  return { ...testsKindOfCell, answersWhetherInstance: { value: b.union(first, ...others) } };
};

export default b.declarations(
  typeTestsOfNode.flatMap(name => b.static(`node:util/types.${name}`, { ...testOf(name), implementation: b.generic })),
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
  // The others are ordinary native functions, so `call`, `apply` and `bind` are found above them.
  functionsWithUndeclaredMembers
    .filter(path => !functionsBelowOtherObjects.includes(path))
    .flatMap(path => b.inherits(path, "Function.prototype")),

  b.static(cpp("NodeUtilTypesModule.cpp", "jsFunctionIsMapIterator"), testOf("isMapIterator")),
  b.static(cpp("NodeUtilTypesModule.cpp", "jsFunctionIsSetIterator"), testOf("isSetIterator")),
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
  // It lists the own keys of the holder and asks first `except` and then the holder for the property under each: no getter of either runs. Of each function that the holder has for a value it reads `length`, and those without parameters it calls on the receiver. Of an object that such a call answers it asks whether it has @@iterator.
  b.static(cpp("BunCompiledModules.cpp", "jsFunctionCallOwnFunctionsWithoutParameters"), {
    args: { holder: b.object, except: b.object, receiver: b.any.optional },
    returns: b.instance("Array").fresh.dense,
    capability: "js",
    throws: true,
    uses: {
      holder: [
        b.runs("OwnKeys"),
        b.runsOnContents(b.named("length")),
        b.memberCalled([b.everyOwnValue], {
          times: "Repeatedly",
          this: b.operand("receiver"),
          args: [],
          result: "Escapes",
        }),
        b.contentsStoredIn(b.resultSlot("element")),
      ],
      except: b.ownPropertyTraps,
      receiver: b.inspected,
    },
    implementation: b.hostCall,
  }),
  // It lists the own keys of the source and asks first the target, then the source and then `replacements` for the property under each: no getter of any runs. What the target lacks is defined on it as it stands on the source, a value with the value that `replacements` has under the key.
  b.static(cpp("BunCompiledModules.cpp", "jsFunctionDefineOwnPropertiesLeftOut"), {
    ...operandCodeOnly,
    args: { target: b.object, source: b.object, replacements: b.union(b.object, b.undefined) },
    returns: b.undefined,
    runsUnseenCode: false,
    uses: {
      target: [b.definedFrom("source"), b.definedFrom("replacements"), ...b.ownPropertyTraps],
      source: b.inspected,
      replacements: b.inspected,
    },
    reads: ["ObjectFields", "ShapeWords", "OrderWords", "NamedProperties", "Elements", "ArrayStorage"],
    writes: ["MemberGuards"],
    implementation: b.hostCall,
  }),
  // It keeps the function. Whoever looks under the symbol with a key that is a value calls it first, on the object that has a field under the symbol.
  b.static(cpp("BunCompiledModules.cpp", "jsFunctionPrepareHoldersBeforeLookupsUnder"), {
    args: { symbol: b.symbol, prepare: b.callable },
    returns: b.undefined,
    capability: "none",
    uses: {
      symbol: b.inspected,
      prepare: [
        b.retained,
        b.called({
          afterwards: "TouchesOnlyWhatRowNames",
          times: "Later",
          this: b.any,
          args: [],
          result: "Ignored",
        }),
      ],
    },
    writes: externalState,
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
