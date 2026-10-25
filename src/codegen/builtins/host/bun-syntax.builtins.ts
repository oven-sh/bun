import * as b from "bun-builtins-table";

const privateGlobal: b.IntrinsicSpec = { intrinsic: "PrivateGlobal" };
const erased: b.IntrinsicSpec = { intrinsic: "Erased" };
const inlinableCall: b.IntrinsicSpec = { intrinsic: "Call", isNeverInlined: false };

const builtin = (path: string): b.IntrinsicSpec => ({ intrinsic: "Builtin", path });

const operation = (name: string, opcode: string) => b.intrinsic(name, "Call", { intrinsic: "Operation", opcode });

const directive = (name: string, kind: b.DirectiveKind) =>
  b.intrinsic(name, "Value", { intrinsic: "Directive", directive: kind });

const privateGlobalFunctions = [
  "createCommonJSModule",
  "createFIFO",
  "esmLoadSync",
  "esmNamespaceForCjs",
  "esmRegistryDelete",
  "esmRegistryEvaluatedKeys",
  "esmRegistryHasEvaluated",
  "evaluateCommonJSModule",
  "evictIsolationSourceProviderCache",
  "internalRequire",
  "isHiddenFromRequireCache",
  "loadEsmIntoCjs",
  "makeAbortError",
  "peekPromiseSettledValue",
  "peekPromiseStatus",
  "pokePromiseAsHandled",
  "requireCacheWillSet",
  "requireCommonJS",
  "requireESM",
  "requireNativeModule",
  "resolveSync",
  "toClass",
  "webStreamClosedPromise",
  "webStreamControllerError",
];

const privateGlobalValues = ["asyncContext", "processBindingConstants", "requireMap"];

const prefixedBuiltins = [
  "AbortSignal",
  "Array",
  "ArrayBuffer",
  "Buffer",
  "Promise",
  "RangeError",
  "ReadableStream",
  "RegExp",
  "String",
  "TypeError",
  "Uint8Array",
  "isFinite",
];

const prefixedPrivateGlobals = [
  "ReadableByteStreamController",
  "ReadableStreamBYOBReader",
  "ReadableStreamBYOBRequest",
  "ReadableStreamDefaultController",
  "ReadableStreamDefaultReader",
  "TransformStream",
  "TransformStreamDefaultController",
  "WritableStream",
  "WritableStreamDefaultController",
  "WritableStreamDefaultWriter",
];

export default b.declarations(
  b.intrinsic("argument", "Call", { intrinsic: "Argument" }),
  b.intrinsic("argumentCount", "Call", { intrinsic: "ArgumentCount" }),
  b.intrinsic("arrayPush", "Call", { intrinsic: "ArrayPush" }),
  b.intrinsic("getByIdDirect", "Call", { intrinsic: "GetOwnProperty", privateKey: false }),
  b.intrinsic("getByIdDirectPrivate", "Call", { intrinsic: "GetOwnProperty", privateKey: true }),
  operation("getInternalField", "GetInternalField"),
  operation("getProxyInternalField", "GetInternalField"),
  b.intrinsic("isCallable", "Call", { intrinsic: "IsCallable" }),
  b.intrinsic("isObject", "Call", { intrinsic: "IsObject" }),
  b.intrinsic("isUndefinedOrNull", "Call", { intrinsic: "IsNullish" }),
  b.intrinsic("newArrayWithSize", "Call", { intrinsic: "Construct", path: "Array" }),
  operation("newPromise", "NewPromise"),
  b.intrinsic("putByIdDirectPrivate", "Call", { intrinsic: "PutByValDirect", privateKey: true }),
  b.intrinsic("putByValDirect", "Call", { intrinsic: "PutByValDirect", privateKey: false }),
  operation("putInternalField", "PutInternalField"),

  b.intrinsic("Array", "Value", builtin("Array")),
  b.intrinsic("Buffer", "Value", builtin("Buffer")),
  b.intrinsic("isArray", "Call", builtin("Array.isArray")),
  b.intrinsic("isArray", "Value", builtin(b.linkTimeConstantPath("isArray"))),
  b.intrinsic("isFinite", "Call", builtin("isFinite")),
  b.intrinsic("min", "Call", builtin("Math.min")),
  b.intrinsic("Promise", "Value", builtin("Promise")),
  operation("rejectPromiseWithFirstResolvingFunctionCallCheck", "RejectPromise"),
  operation("resolvePromiseWithFirstResolvingFunctionCallCheck", "ResolvePromise"),
  operation("toLength", "ToLength"),

  b.intrinsic("apply", "Member", { intrinsic: "Apply" }),
  b.intrinsic("call", "Member", inlinableCall),

  privateGlobalFunctions.flatMap(name => b.intrinsic(name, "Call", privateGlobal)),
  privateGlobalValues.flatMap(name => b.intrinsic(name, "Value", privateGlobal)),
  b.intrinsic("overridableRequire", "Value", { intrinsic: "ReplaceablePrivateGlobal" }),

  operation("arrayStorageKind", "ArrayStorageKind"),
  b.intrinsic("call", "Call", inlinableCall),
  b.intrinsic("callNoInline", "Call", { intrinsic: "Call", isNeverInlined: true }),
  operation("getContiguousIndex", "GetContiguousIndex"),
  operation("getDoubleIndex", "GetDoubleIndex"),
  operation("growNewArray", "GrowNewArray"),
  operation("hasContiguousIndex", "HasContiguousIndex"),
  operation("newArrayLike", "NewArrayLike"),
  operation("newArrayWithCapacity", "NewArrayWithCapacity"),
  operation("newContiguousArray", "NewContiguousArray"),
  operation("newDoubleArray", "NewDoubleArray"),
  operation("putContiguousIndex", "PutContiguousIndex"),
  operation("putDoubleIndex", "PutDoubleIndex"),
  operation("truncateNewArray", "TruncateNewArray"),
  operation("tryPutByValDirect", "TryPutByValDirect"),
  operation("tryPutDoubleIndex", "TryPutDoubleIndex"),
  operation("tryPutIndex", "TryPutIndex"),

  b.intrinsic("jsonStringify", "Call", builtin("JSON.stringify")),

  b.intrinsic("assert", "Call", erased),
  b.intrinsic("bundleError", "Call", { intrinsic: "BundleError" }),
  directive("constructor", "Constructor"),
  b.intrinsic("debug", "Call", erased),
  b.intrinsic("debug", "Value", { intrinsic: "Bool", value: false }),
  directive("getter", "Getter"),
  b.intrinsic("isPromisePending", "Call", { intrinsic: "HasPromiseStatus", status: "Pending" }),
  directive("linkTimeConstant", "LinkTimeConstant"),
  directive("overriddenName", "OverriddenName"),
  directive("visibility", "Visibility"),

  prefixedBuiltins.flatMap(name => b.prefixedGlobal(name, builtin(name))),
  prefixedPrivateGlobals.flatMap(name => b.prefixedGlobal(name, privateGlobal)),
  b.prefixedGlobal("undefined", { intrinsic: "Undefined" }),
  b.prefixedGlobal("Infinity", { intrinsic: "Double", value: Infinity }),
);
