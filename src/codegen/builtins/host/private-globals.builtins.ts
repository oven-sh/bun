// The native functions that Bun's own modules call under private names of the global object.
import * as b from "bun-builtins-table";
import { numberedErrorCodes } from "../../replacements.ts";
import {
  asyncContextCell,
  bindingConstantsCell,
  closedPromiseOfStreamCell,
  constantsOfBindingCell,
  printsErrorWithCodeCell,
  requireMapCell,
} from "./native-cells.ts";
import { handedOver } from "./native-code.ts";

const promiseState = ["PromiseState"];

const changesNothing = (returns: b.TableType): b.FunctionField => ({
  args: { operands: b.any.rest },
  returns,
  capability: "js",
  throws: true,
  uses: { operands: handedOver },
  implementation: b.hostCall,
});

const resultsOfFunctionsChangingNothing = {
  webStreamControllerError: b.undefined,
};

// ZigGlobalObject.cpp jsFunctionInherits: it asks the cell of the value for its class.
const asksCellForItsClass = {
  args: { operands: b.any.rest },
  returns: b.bool,
  capability: "none",
  uses: { operands: b.inspected },
  implementation: b.hostCall,
} satisfies b.FunctionField;

// ErrorCode.cpp: an error with a code is an instance of the kind of error the code stands for, with an object of its own for each code in front of the prototype of that kind.
const kindsOfErrorsWithCode = ["Error", "TypeError", "RangeError", "SyntaxError", "URIError"];
const [firstKind, ...otherKinds] = kindsOfErrorsWithCode.map(kind => b.instance(kind));
const newErrorWithCode = b.union(firstKind, ...otherKinds).unaliased;
const printsErrorWithCode = b.builtin("%NativeFunctions%.ErrorCodeCppNodeError_proto_toString");
const membersInheritedByErrorWithCode = { name: b.string, code: b.string, toString: printsErrorWithCode };

// The message reads constructor.name of a value, converts it to a string, or prints it the way console.log does.
const formattedInMessage = [b.printedByFormatter("constructor")];

// These put an operand on the error as it is, and ERR_UNHANDLED_ERROR answers what an exception of the engine holds.
const errorCodesKeepingOperands = [
  "ERR_INVALID_ADDRESS_FAMILY",
  "ERR_INVALID_URL",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_UNHANDLED_ERROR",
  "ERR_VM_MODULE_LINK_FAILURE",
];

function numberOfErrorCode(name: string): number {
  const found = numberedErrorCodes.find(code => code.name === name);
  if (found === undefined) throw new Error(`${name} is no error code of src/jsc/bindings/ErrorCode.ts`);
  return found.number;
}

// The numbers between those of the codes that keep an operand. A call spells its code out, and the first range that holds it takes the call.
function rangesOfErrorCodesKeepingNothing(): [number, number][] {
  const kept = errorCodesKeepingOperands.map(numberOfErrorCode).sort((left, right) => left - right);
  const last = Math.max(...numberedErrorCodes.map(code => code.number));
  const starts = [0, ...kept.map(number => number + 1)];
  const ends = [...kept.map(number => number - 1), last];
  return starts.map((start, index): [number, number] => [start, ends[index]]).filter(([start, end]) => start <= end);
}

const makesErrorWithCode = [
  ...rangesOfErrorCodesKeepingNothing().map(([first, last]): b.FunctionField => ({
    args: { code: b.int(first, last), operands: b.any.rest },
    returns: newErrorWithCode,
    // ERR_SSL_NO_CIPHER_MATCH.
    resultProperties: { ...membersInheritedByErrorWithCode, reason: b.string, library: b.string },
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { operands: formattedInMessage },
    implementation: b.hostCall,
  })),
  // What an exception of the engine holds comes out of the operand: native code has not made it, and it may be any value: the type is what is made, and no proof.
  {
    ...changesNothing(newErrorWithCode),
    resultIsDeclaredOnly: true,
    uses: { operands: [...handedOver, b.reachableValuesStoredIn(b.result)] },
  },
];

// An object that the conversion of the message throws, or the getter of the cause, is the answer.
const makesAbortError = [
  {
    args: { message: b.string.optional, options: b.undefined.optional },
    returns: b.instance("Error").unaliased,
    resultProperties: membersInheritedByErrorWithCode,
    capability: "heap",
    implementation: b.hostCall,
  },
  changesNothing(b.any),
] satisfies b.FunctionField[];

const looksAtPromise = (returns: b.TableType, otherwise: b.TableType, uses: readonly b.UseSpec[] = b.inspected) =>
  [
    {
      args: { promise: b.instance("Promise") },
      returns,
      capability: "none",
      uses: { promise: uses },
      reads: promiseState,
      implementation: b.hostCall,
    },
    {
      args: { promise: b.any },
      returns: otherwise,
      capability: "none",
      uses: { promise: b.inspected },
      implementation: b.hostCall,
    },
  ] satisfies b.FunctionField[];

// The stream makes the promise at the first call and keeps it. It is fulfilled with undefined, or rejected with the error of the stream.
const closedPromise = b.instance("Promise").holding({ value: b.undefined, reason: b.any });

const requireMap = b.instance("Map").holding({ key: b.any, value: b.any });

// What builtins/CommonJS.ts calls. Which file a name finds, and that the file runs, is said by the entry that took the name: %ModuleRequire% and its like.
// The run time refuses there what the executable does not hold. These say what native code does with the operands and what it answers.

// ImportMetaObject.cpp functionImportMeta__resolveSyncPrivate. A Module._resolveFilename that the program has replaced gets the name, the module object and the options.
// require() leaves the fourth operand undefined and gets the answer of that function as a string. require.resolve() passes true and gets it as it is.
const resolvesName = [
  {
    args: { name: b.any, from: b.any, isESM: b.any, isRequireResolve: b.undefined, operands: b.any.rest },
    returns: b.string,
    capability: "js",
    throws: true,
    uses: { name: handedOver, from: handedOver, isESM: b.inspected, operands: handedOver },
    implementation: b.hostCall,
  },
  changesNothing(b.any),
] satisfies b.FunctionField[];

// JSCommonJSModule.cpp jsFunctionEvaluateCommonJSModule. Once script has read or stored `children` of the module that asks, the answer is what stands there, and the library appends to it.
const evaluatesModule = {
  args: { module: b.any, referrer: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { module: handedOver, referrer: [...handedOver, b.readByKey(b.keysNamed("children"))] },
  implementation: b.hostCall,
} satisfies b.FunctionField;

// jsFunctionCreateCommonJSModule.
const createsModuleObject = {
  args: { id: b.any, exports: b.any, hasEvaluated: b.any, requirer: b.any },
  returns: b.builtin("%ModuleObject%"),
  capability: "js",
  throws: true,
  uses: { id: handedOver, exports: handedOver, hasEvaluated: b.inspected, requirer: handedOver },
  implementation: b.hostCall,
} satisfies b.FunctionField;

// jsFunctionRequireCommonJS: fetchCommonJSModule() in ModuleLoader.cpp puts what the file exports on the module object.
const loadsIntoModuleObject = {
  args: { id: b.any, module: b.any, operands: b.any.rest },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { id: handedOver, module: [...handedOver, b.definesName(["exports"], b.any)], operands: handedOver },
  implementation: b.hostCall,
} satisfies b.FunctionField;

// ZigGlobalObject.cpp: these look at a key that is a string, and at the cell of the module object that stands for a loader.
const asksRegistry = (returns: b.TableType): b.FunctionField => ({
  args: { operands: b.any.rest },
  returns,
  capability: "heap",
  throws: true,
  uses: { operands: b.inspected },
  implementation: b.hostCall,
});

// ProcessBindingConstants.cpp: objects without a prototype. Which names one has differs between platforms. `objects`: the names under which it holds another of them.
const constantsOfBinding = (cell: string, values: readonly b.TableType[], objects: readonly string[] = []) =>
  b.hostObject(cell, {
    prototype: null,
    fields: Object.fromEntries(objects.map(name => [name, b.nativeCell(`${cell}.${name}`)])),
    ...(values.length === 0 ? {} : { otherNames: values }),
  });

export default b.declarations(
  constantsOfBinding(bindingConstantsCell, [], ["os", "fs", "crypto", "zlib", "trace"]),
  constantsOfBinding(constantsOfBindingCell("os"), [b.f64], ["dlopen", "errno", "signals", "priority"]),
  ["os.dlopen", "os.errno", "os.signals", "os.priority", "fs", "zlib", "trace"].flatMap(path =>
    constantsOfBinding(constantsOfBindingCell(path), [b.f64]),
  ),
  // The lists of ciphers are texts.
  constantsOfBinding(constantsOfBindingCell("crypto"), [b.f64, b.string]),
  // Each of those objects has a function of its own, and one entry stands for them all. It reads the three members of its receiver and converts each to a string.
  b.hostFunction(printsErrorWithCodeCell, "ErrorCode.cpp", "NodeError_proto_toString", {
    this: b.any,
    returns: b.string,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { this: [b.runsTransitively(b.named("name", "code", "message"), "ToPrimitive")] },
    implementation: b.hostCall,
  }),
  b.extend("native:NewCppFunction:ErrorCode.cpp:NodeError_proto_toString", {
    functionObjectCode: { symbol: "NodeError_proto_toString", header: "ErrorCode.h" },
    length: 0,
  }),
  b.namespace("%PrivateGlobals%", {
    ...Object.fromEntries(
      Object.entries(resultsOfFunctionsChangingNothing).map(([name, returns]) => [name, changesNothing(returns)]),
    ),
    // The object that runtime-dependencies.builtins.ts describes. The realm has one from its first read on, so compiled code keeps it.
    asyncContext: b.property(b.object, {
      mutability: "AlwaysLocked",
      createdOnFirstRead: { capability: "none", uses: { this: [b.returnedFrom(asyncContextCell)] } },
    }),
    createCommonJSModule: createsModuleObject,
    // Its code says what it does.
    createFIFO: b.otherwiseBy(b.compiled("builtins/Fifo", "createFIFO")),
    // `require` in a library module hands another library module to it.
    createInternalModuleById: b.otherwiseBy(b.hostCall),
    // `require` hands an ES module to it.
    esmLoadSync: changesNothing(b.any),
    esmNamespaceForCjs: changesNothing(b.any),
    esmRegistryDelete: asksRegistry(b.bool),
    esmRegistryEvaluatedKeys: asksRegistry(b.instance("Array").holding({ element: b.string }).fresh),
    esmRegistryHasEvaluated: asksRegistry(b.bool),
    evaluateCommonJSModule: evaluatesModule,
    // ModuleLoader.cpp jsFunctionEvictIsolationSourceProviderCache converts a key that is not undefined to a string.
    evictIsolationSourceProviderCache: changesNothing(b.undefined),
    inherits: asksCellForItsClass,
    internalRequire: b.otherwiseBy(b.compiled("builtins/CommonJS", "internalRequire")),
    isHiddenFromRequireCache: asksRegistry(b.union(b.bool, b.undefined)),
    loadEsmIntoCjs: b.otherwiseBy(b.compiled("builtins/CommonJS", "loadEsmIntoCjs")),
    makeAbortError: makesAbortError,
    makeErrorWithCode: makesErrorWithCode,
    // NodeModuleModule.cpp getterRequireFunction and setterRequireFunction: Module.prototype.require is an accessor over this slot, so what a program stores there stands here.
    overridableRequire: b.property(b.any, { mutability: "ChangesOnItsOwn" }),
    peekPromiseSettledValue: looksAtPromise(
      b.union(b.slot("promise", "value"), b.slot("promise", "reason"), b.undefined),
      b.undefined,
      [b.readsContents()],
    ),
    peekPromiseStatus: looksAtPromise(b.int(0, 2), b.int(0, 0)),
    // The realm makes the object with itself.
    processBindingConstants: b.property(b.object, {
      mutability: "AlwaysLocked",
      createdOnFirstRead: { capability: "none", uses: { this: [b.returnedFrom(bindingConstantsCell)] } },
    }),
    pokePromiseAsHandled: {
      args: { promise: b.any },
      returns: b.undefined,
      capability: "none",
      uses: { promise: b.inspected },
      writes: promiseState,
      implementation: b.hostCall,
    },
    // A module object of the executable, or whether a module of the library is listed.
    requireCacheCompiledEntry: changesNothing(b.any),
    requireCacheDidDelete: asksRegistry(b.undefined),
    // It asks whether the entry is truthy, and the run time keeps an entry that stands in for a file of the executable.
    requireCacheWillSet: changesNothing(b.undefined),
    // `require` hands a CommonJS file to it.
    requireCommonJS: loadsIntoModuleObject,
    requireESM: b.otherwiseBy(b.compiled("builtins/CommonJS", "requireESM")),
    // The realm makes the map with itself. Native code files module objects in it and takes out what the library has filed.
    requireMap: b.property(b.instance("Map"), {
      mutability: "AlwaysLocked",
      createdOnFirstRead: {
        capability: "none",
        uses: {
          this: [
            b.createdIn(requireMap.fresh, b.nativeCell(requireMapCell)),
            b.handedOutFrom(requireMapCell),
            b.returnedFrom(requireMapCell),
          ],
        },
      },
    }),
    // What a module of the library exports.
    requireNativeModule: changesNothing(b.any),
    resolveSync: resolvesName,
    webStreamClosedPromise: {
      args: { stream: b.any.optional },
      returns: b.instance("Promise"),
      capability: "heap",
      throws: true,
      uses: {
        stream: [
          b.createdIn(closedPromise.fresh, b.nativeCell(closedPromiseOfStreamCell)),
          b.returnedFrom(closedPromiseOfStreamCell),
        ],
      },
      implementation: b.hostCall,
    },
    // It makes a function a class: under the base, with a new object under the prototype of the base as its prototype, and with the name.
    toClass: {
      args: { target: b.any, name: b.any.optional, base: b.any.optional },
      returns: b.undefined,
      capability: "js",
      throws: true,
      uses: {
        target: [...handedOver, b.prototypeSetTo("base"), b.definesName(["prototype", "name"], b.any)],
        name: handedOver,
        base: handedOver,
      },
      implementation: b.hostCall,
    },
  }),
);
