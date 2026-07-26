// GENERATED FILE — do not edit. See src/codegen/generate-primordials.ts.
//
// Node.js's `primordials` object, for modules ported from Node's lib/: the same
// member names and call semantics as lib/internal/per_context/primordials.js
// (uncurried prototype methods, XGetY/XSetY accessors, *Apply variants for
// varargs methods, Safe* classes, hardenRegExp, promise helpers). Everything is
// built from JSC's link-time constants ($Name), which the engine captures before
// user code can run, so nothing here reads a global at load time. Spec constants
// (constructor lengths, Math/Number constants, BYTES_PER_ELEMENT, ...) are inlined
// as literals instead of read at runtime.
//
// This object exists for Node compatibility; Bun's own modules should use the
// $Name constants and intrinsics directly rather than going through it.

// (thisArg, ...args) => func.call(thisArg, ...args) without touching
// Function.prototype: bind and call are both pristine link-time constants.
const uncurryThis = $FunctionPrototypeBind.$call($FunctionPrototypeBind, $FunctionPrototypeCall);

// applyBind(func) => (thisArg, args) => func.apply(thisArg, args);
// applyBind(func, receiver) binds the receiver as `this` (static methods).
const applyBind = $FunctionPrototypeBind.$call($FunctionPrototypeBind, $FunctionPrototypeApply);

const primordials = {
  __proto__: null,
  Proxy: $Proxy,
  globalThis: $globalThis,
  decodeURI: $decodeURI,
  decodeURIComponent: $decodeURIComponent,
  encodeURI: $encodeURI,
  encodeURIComponent: $encodeURIComponent,
  escape: $escape,
  eval: $eval,
  unescape: $unescape,
  AtomicsAdd: $AtomicsAdd,
  AtomicsAnd: $AtomicsAnd,
  AtomicsCompareExchange: $AtomicsCompareExchange,
  AtomicsExchange: $AtomicsExchange,
  AtomicsIsLockFree: $AtomicsIsLockFree,
  AtomicsLoad: $AtomicsLoad,
  AtomicsNotify: $AtomicsNotify,
  AtomicsOr: $AtomicsOr,
  AtomicsStore: $AtomicsStore,
  AtomicsSub: $AtomicsSub,
  AtomicsWait: $AtomicsWait,
  AtomicsXor: $AtomicsXor,
  AtomicsPause: $AtomicsPause,
  AtomicsWaitAsync: $AtomicsWaitAsync,
  AtomicsSymbolToStringTag: "Atomics",
  JSONParse: $JSONParse,
  JSONStringify: $JSONStringify,
  JSONIsRawJSON: $JSONIsRawJSON,
  JSONRawJSON: $JSONRawJSON,
  JSONSymbolToStringTag: "JSON",
  MathE: 2.718281828459045,
  MathLN2: 0.6931471805599453,
  MathLN10: 2.302585092994046,
  MathLOG2E: 1.4426950408889634,
  MathLOG10E: 0.4342944819032518,
  MathPI: 3.141592653589793,
  MathSQRT1_2: 0.7071067811865476,
  MathSQRT2: 1.4142135623730951,
  MathAbs: $MathAbs,
  MathAcos: $MathAcos,
  MathAsin: $MathAsin,
  MathAtan: $MathAtan,
  MathAcosh: $MathAcosh,
  MathAsinh: $MathAsinh,
  MathAtanh: $MathAtanh,
  MathAtan2: $MathAtan2,
  MathCbrt: $MathCbrt,
  MathCeil: $MathCeil,
  MathClz32: $MathClz32,
  MathCos: $MathCos,
  MathCosh: $MathCosh,
  MathExp: $MathExp,
  MathExpm1: $MathExpm1,
  MathFloor: $MathFloor,
  MathFround: $MathFround,
  MathHypot: $MathHypot,
  MathHypotApply: applyBind($MathHypot, undefined),
  MathLog: $MathLog,
  MathLog10: $MathLog10,
  MathLog1p: $MathLog1p,
  MathLog2: $MathLog2,
  MathMax: $MathMax,
  MathMaxApply: applyBind($MathMax, undefined),
  MathMin: $MathMin,
  MathMinApply: applyBind($MathMin, undefined),
  MathPow: $MathPow,
  MathRandom: $MathRandom,
  MathRound: $MathRound,
  MathSign: $MathSign,
  MathSin: $MathSin,
  MathSinh: $MathSinh,
  MathSqrt: $MathSqrt,
  MathTan: $MathTan,
  MathTanh: $MathTanh,
  MathTrunc: $MathTrunc,
  MathImul: $MathImul,
  MathF16round: $MathF16round,
  MathSumPrecise: $MathSumPrecise,
  MathSymbolToStringTag: "Math",
  ReflectApply: $ReflectApply,
  ReflectConstruct: $ReflectConstruct,
  ReflectDefineProperty: $ReflectDefineProperty,
  ReflectDeleteProperty: $ReflectDeleteProperty,
  ReflectGet: $ReflectGet,
  ReflectGetOwnPropertyDescriptor: $ReflectGetOwnPropertyDescriptor,
  ReflectGetPrototypeOf: $ReflectGetPrototypeOf,
  ReflectHas: $ReflectHas,
  ReflectIsExtensible: $ReflectIsExtensible,
  ReflectOwnKeys: $ReflectOwnKeys,
  ReflectPreventExtensions: $ReflectPreventExtensions,
  ReflectSet: $ReflectSet,
  ReflectSetPrototypeOf: $ReflectSetPrototypeOf,
  ReflectSymbolToStringTag: "Reflect",
  ProxyLength: 2,
  ProxyName: "Proxy",
  ProxyRevocable: $ProxyRevocable,
  AggregateError: $AggregateError,
  AggregateErrorLength: 2,
  AggregateErrorName: "AggregateError",
  AggregateErrorPrototype: $AggregateErrorPrototype,
  AggregateErrorPrototypeName: "AggregateError",
  AggregateErrorPrototypeMessage: "",
  AggregateErrorPrototypeConstructor: uncurryThis($AggregateErrorPrototypeConstructor),
  Array: $Array,
  ArrayFrom: $ArrayFrom,
  ArrayLength: 1,
  ArrayName: "Array",
  ArrayPrototype: $ArrayPrototype,
  ArrayOf: $ArrayOf,
  ArrayOfApply: applyBind($ArrayOf, $Array),
  ArrayIsArray: $ArrayIsArray,
  ArrayFromAsync: $ArrayFromAsync,
  ArrayGetSymbolSpecies: uncurryThis($ArrayGetSymbolSpecies),
  ArrayPrototypeLength: 0,
  ArrayPrototypeToString: uncurryThis($ArrayPrototypeToString),
  ArrayPrototypeValues: uncurryThis($ArrayPrototypeValues),
  ArrayPrototypeToLocaleString: uncurryThis($ArrayPrototypeToLocaleString),
  ArrayPrototypeConcat: uncurryThis($ArrayPrototypeConcat),
  ArrayPrototypeFill: uncurryThis($ArrayPrototypeFill),
  ArrayPrototypeJoin: uncurryThis($ArrayPrototypeJoin),
  ArrayPrototypePop: uncurryThis($ArrayPrototypePop),
  ArrayPrototypePush: uncurryThis($ArrayPrototypePush),
  ArrayPrototypePushApply: applyBind($ArrayPrototypePush),
  ArrayPrototypeReverse: uncurryThis($ArrayPrototypeReverse),
  ArrayPrototypeShift: uncurryThis($ArrayPrototypeShift),
  ArrayPrototypeSlice: uncurryThis($ArrayPrototypeSlice),
  ArrayPrototypeSort: uncurryThis($ArrayPrototypeSort),
  ArrayPrototypeSplice: uncurryThis($ArrayPrototypeSplice),
  ArrayPrototypeUnshift: uncurryThis($ArrayPrototypeUnshift),
  ArrayPrototypeUnshiftApply: applyBind($ArrayPrototypeUnshift),
  ArrayPrototypeEvery: uncurryThis($ArrayPrototypeEvery),
  ArrayPrototypeForEach: uncurryThis($ArrayPrototypeForEach),
  ArrayPrototypeSome: uncurryThis($ArrayPrototypeSome),
  ArrayPrototypeIndexOf: uncurryThis($ArrayPrototypeIndexOf),
  ArrayPrototypeLastIndexOf: uncurryThis($ArrayPrototypeLastIndexOf),
  ArrayPrototypeFilter: uncurryThis($ArrayPrototypeFilter),
  ArrayPrototypeFlat: uncurryThis($ArrayPrototypeFlat),
  ArrayPrototypeFlatMap: uncurryThis($ArrayPrototypeFlatMap),
  ArrayPrototypeReduce: uncurryThis($ArrayPrototypeReduce),
  ArrayPrototypeReduceRight: uncurryThis($ArrayPrototypeReduceRight),
  ArrayPrototypeMap: uncurryThis($ArrayPrototypeMap),
  ArrayPrototypeKeys: uncurryThis($ArrayPrototypeKeys),
  ArrayPrototypeEntries: uncurryThis($ArrayPrototypeEntries),
  ArrayPrototypeFind: uncurryThis($ArrayPrototypeFind),
  ArrayPrototypeFindLast: uncurryThis($ArrayPrototypeFindLast),
  ArrayPrototypeFindIndex: uncurryThis($ArrayPrototypeFindIndex),
  ArrayPrototypeFindLastIndex: uncurryThis($ArrayPrototypeFindLastIndex),
  ArrayPrototypeIncludes: uncurryThis($ArrayPrototypeIncludes),
  ArrayPrototypeCopyWithin: uncurryThis($ArrayPrototypeCopyWithin),
  ArrayPrototypeAt: uncurryThis($ArrayPrototypeAt),
  ArrayPrototypeToReversed: uncurryThis($ArrayPrototypeToReversed),
  ArrayPrototypeToSorted: uncurryThis($ArrayPrototypeToSorted),
  ArrayPrototypeToSpliced: uncurryThis($ArrayPrototypeToSpliced),
  ArrayPrototypeWith: uncurryThis($ArrayPrototypeWith),
  ArrayPrototypeConstructor: uncurryThis($ArrayPrototypeConstructor),
  ArrayPrototypeSymbolIterator: uncurryThis($ArrayPrototypeSymbolIterator),
  ArrayPrototypeSymbolUnscopables: $ArrayPrototypeSymbolUnscopables,
  ArrayBuffer: $ArrayBufferPrimordial,
  ArrayBufferLength: 1,
  ArrayBufferName: "ArrayBuffer",
  ArrayBufferPrototype: $ArrayBufferPrototype,
  ArrayBufferIsView: $ArrayBufferIsView,
  ArrayBufferGetSymbolSpecies: uncurryThis($ArrayBufferGetSymbolSpecies),
  ArrayBufferPrototypeSlice: uncurryThis($ArrayBufferPrototypeSlice),
  ArrayBufferPrototypeGetByteLength: uncurryThis($ArrayBufferPrototypeGetByteLength),
  ArrayBufferPrototypeResize: uncurryThis($ArrayBufferPrototypeResize),
  ArrayBufferPrototypeTransfer: uncurryThis($ArrayBufferPrototypeTransfer),
  ArrayBufferPrototypeTransferToFixedLength: uncurryThis($ArrayBufferPrototypeTransferToFixedLength),
  ArrayBufferPrototypeGetResizable: uncurryThis($ArrayBufferPrototypeGetResizable),
  ArrayBufferPrototypeGetMaxByteLength: uncurryThis($ArrayBufferPrototypeGetMaxByteLength),
  ArrayBufferPrototypeGetDetached: uncurryThis($ArrayBufferPrototypeGetDetached),
  ArrayBufferPrototypeConstructor: uncurryThis($ArrayBufferPrototypeConstructor),
  ArrayBufferPrototypeSymbolToStringTag: "ArrayBuffer",
  BigInt: $BigInt,
  BigIntAsUintN: $BigIntAsUintN,
  BigIntAsIntN: $BigIntAsIntN,
  BigIntLength: 1,
  BigIntName: "BigInt",
  BigIntPrototype: $BigIntPrototype,
  BigIntPrototypeToString: uncurryThis($BigIntPrototypeToString),
  BigIntPrototypeToLocaleString: uncurryThis($BigIntPrototypeToLocaleString),
  BigIntPrototypeValueOf: uncurryThis($BigIntPrototypeValueOf),
  BigIntPrototypeConstructor: uncurryThis($BigIntPrototypeConstructor),
  BigIntPrototypeSymbolToStringTag: "BigInt",
  BigInt64Array: $BigInt64Array,
  BigInt64ArrayLength: 3,
  BigInt64ArrayName: "BigInt64Array",
  BigInt64ArrayPrototype: $BigInt64ArrayPrototype,
  BigInt64ArrayBYTES_PER_ELEMENT: 8,
  BigInt64ArrayPrototypeBYTES_PER_ELEMENT: 8,
  BigInt64ArrayPrototypeConstructor: uncurryThis($BigInt64ArrayPrototypeConstructor),
  BigUint64Array: $BigUint64Array,
  BigUint64ArrayLength: 3,
  BigUint64ArrayName: "BigUint64Array",
  BigUint64ArrayPrototype: $BigUint64ArrayPrototype,
  BigUint64ArrayBYTES_PER_ELEMENT: 8,
  BigUint64ArrayPrototypeBYTES_PER_ELEMENT: 8,
  BigUint64ArrayPrototypeConstructor: uncurryThis($BigUint64ArrayPrototypeConstructor),
  Boolean: $Boolean,
  BooleanLength: 1,
  BooleanName: "Boolean",
  BooleanPrototype: $BooleanPrototype,
  BooleanPrototypeToString: uncurryThis($BooleanPrototypeToString),
  BooleanPrototypeValueOf: uncurryThis($BooleanPrototypeValueOf),
  BooleanPrototypeConstructor: uncurryThis($BooleanPrototypeConstructor),
  DataView: $DataView,
  DataViewLength: 1,
  DataViewName: "DataView",
  DataViewPrototype: $DataViewPrototype,
  DataViewBYTES_PER_ELEMENT: 1,
  DataViewPrototypeGetInt8: uncurryThis($DataViewPrototypeGetInt8),
  DataViewPrototypeGetUint8: uncurryThis($DataViewPrototypeGetUint8),
  DataViewPrototypeGetInt16: uncurryThis($DataViewPrototypeGetInt16),
  DataViewPrototypeGetUint16: uncurryThis($DataViewPrototypeGetUint16),
  DataViewPrototypeGetInt32: uncurryThis($DataViewPrototypeGetInt32),
  DataViewPrototypeGetUint32: uncurryThis($DataViewPrototypeGetUint32),
  DataViewPrototypeGetFloat16: uncurryThis($DataViewPrototypeGetFloat16),
  DataViewPrototypeGetFloat32: uncurryThis($DataViewPrototypeGetFloat32),
  DataViewPrototypeGetFloat64: uncurryThis($DataViewPrototypeGetFloat64),
  DataViewPrototypeGetBigInt64: uncurryThis($DataViewPrototypeGetBigInt64),
  DataViewPrototypeGetBigUint64: uncurryThis($DataViewPrototypeGetBigUint64),
  DataViewPrototypeSetInt8: uncurryThis($DataViewPrototypeSetInt8),
  DataViewPrototypeSetUint8: uncurryThis($DataViewPrototypeSetUint8),
  DataViewPrototypeSetInt16: uncurryThis($DataViewPrototypeSetInt16),
  DataViewPrototypeSetUint16: uncurryThis($DataViewPrototypeSetUint16),
  DataViewPrototypeSetInt32: uncurryThis($DataViewPrototypeSetInt32),
  DataViewPrototypeSetUint32: uncurryThis($DataViewPrototypeSetUint32),
  DataViewPrototypeSetFloat16: uncurryThis($DataViewPrototypeSetFloat16),
  DataViewPrototypeSetFloat32: uncurryThis($DataViewPrototypeSetFloat32),
  DataViewPrototypeSetFloat64: uncurryThis($DataViewPrototypeSetFloat64),
  DataViewPrototypeSetBigInt64: uncurryThis($DataViewPrototypeSetBigInt64),
  DataViewPrototypeSetBigUint64: uncurryThis($DataViewPrototypeSetBigUint64),
  DataViewPrototypeGetBuffer: uncurryThis($DataViewPrototypeGetBuffer),
  DataViewPrototypeGetByteOffset: uncurryThis($DataViewPrototypeGetByteOffset),
  DataViewPrototypeGetByteLength: uncurryThis($DataViewPrototypeGetByteLength),
  DataViewPrototypeConstructor: uncurryThis($DataViewPrototypeConstructor),
  DataViewPrototypeSymbolToStringTag: "DataView",
  Date: $Date,
  DateParse: $DateParse,
  DateUTC: $DateUTC,
  DateNow: $DateNow,
  DateLength: 7,
  DateName: "Date",
  DatePrototype: $DatePrototype,
  DatePrototypeToString: uncurryThis($DatePrototypeToString),
  DatePrototypeToISOString: uncurryThis($DatePrototypeToISOString),
  DatePrototypeToDateString: uncurryThis($DatePrototypeToDateString),
  DatePrototypeToTimeString: uncurryThis($DatePrototypeToTimeString),
  DatePrototypeToLocaleString: uncurryThis($DatePrototypeToLocaleString),
  DatePrototypeToLocaleDateString: uncurryThis($DatePrototypeToLocaleDateString),
  DatePrototypeToLocaleTimeString: uncurryThis($DatePrototypeToLocaleTimeString),
  DatePrototypeValueOf: uncurryThis($DatePrototypeValueOf),
  DatePrototypeGetTime: uncurryThis($DatePrototypeGetTime),
  DatePrototypeGetFullYear: uncurryThis($DatePrototypeGetFullYear),
  DatePrototypeGetUTCFullYear: uncurryThis($DatePrototypeGetUTCFullYear),
  DatePrototypeGetMonth: uncurryThis($DatePrototypeGetMonth),
  DatePrototypeGetUTCMonth: uncurryThis($DatePrototypeGetUTCMonth),
  DatePrototypeGetDate: uncurryThis($DatePrototypeGetDate),
  DatePrototypeGetUTCDate: uncurryThis($DatePrototypeGetUTCDate),
  DatePrototypeGetDay: uncurryThis($DatePrototypeGetDay),
  DatePrototypeGetUTCDay: uncurryThis($DatePrototypeGetUTCDay),
  DatePrototypeGetHours: uncurryThis($DatePrototypeGetHours),
  DatePrototypeGetUTCHours: uncurryThis($DatePrototypeGetUTCHours),
  DatePrototypeGetMinutes: uncurryThis($DatePrototypeGetMinutes),
  DatePrototypeGetUTCMinutes: uncurryThis($DatePrototypeGetUTCMinutes),
  DatePrototypeGetSeconds: uncurryThis($DatePrototypeGetSeconds),
  DatePrototypeGetUTCSeconds: uncurryThis($DatePrototypeGetUTCSeconds),
  DatePrototypeGetMilliseconds: uncurryThis($DatePrototypeGetMilliseconds),
  DatePrototypeGetUTCMilliseconds: uncurryThis($DatePrototypeGetUTCMilliseconds),
  DatePrototypeGetTimezoneOffset: uncurryThis($DatePrototypeGetTimezoneOffset),
  DatePrototypeGetYear: uncurryThis($DatePrototypeGetYear),
  DatePrototypeSetTime: uncurryThis($DatePrototypeSetTime),
  DatePrototypeSetMilliseconds: uncurryThis($DatePrototypeSetMilliseconds),
  DatePrototypeSetUTCMilliseconds: uncurryThis($DatePrototypeSetUTCMilliseconds),
  DatePrototypeSetSeconds: uncurryThis($DatePrototypeSetSeconds),
  DatePrototypeSetUTCSeconds: uncurryThis($DatePrototypeSetUTCSeconds),
  DatePrototypeSetMinutes: uncurryThis($DatePrototypeSetMinutes),
  DatePrototypeSetUTCMinutes: uncurryThis($DatePrototypeSetUTCMinutes),
  DatePrototypeSetHours: uncurryThis($DatePrototypeSetHours),
  DatePrototypeSetUTCHours: uncurryThis($DatePrototypeSetUTCHours),
  DatePrototypeSetDate: uncurryThis($DatePrototypeSetDate),
  DatePrototypeSetUTCDate: uncurryThis($DatePrototypeSetUTCDate),
  DatePrototypeSetMonth: uncurryThis($DatePrototypeSetMonth),
  DatePrototypeSetUTCMonth: uncurryThis($DatePrototypeSetUTCMonth),
  DatePrototypeSetFullYear: uncurryThis($DatePrototypeSetFullYear),
  DatePrototypeSetUTCFullYear: uncurryThis($DatePrototypeSetUTCFullYear),
  DatePrototypeSetYear: uncurryThis($DatePrototypeSetYear),
  DatePrototypeToJSON: uncurryThis($DatePrototypeToJSON),
  DatePrototypeToUTCString: uncurryThis($DatePrototypeToUTCString),
  DatePrototypeToGMTString: uncurryThis($DatePrototypeToGMTString),
  DatePrototypeConstructor: uncurryThis($DatePrototypeConstructor),
  DatePrototypeSymbolToPrimitive: uncurryThis($DatePrototypeSymbolToPrimitive),
  Error: $Error,
  ErrorLength: 1,
  ErrorName: "Error",
  ErrorPrototype: $ErrorPrototype,
  ErrorStackTraceLimit: 10,
  ErrorCaptureStackTrace: $ErrorCaptureStackTrace,
  ErrorIsError: $ErrorIsError,
  ErrorAppendStackTrace: $ErrorAppendStackTrace,
  ErrorPrepareStackTrace: $ErrorPrepareStackTrace,
  ErrorPrototypeToString: uncurryThis($ErrorPrototypeToString),
  ErrorPrototypeName: "Error",
  ErrorPrototypeMessage: "",
  ErrorPrototypeConstructor: uncurryThis($ErrorPrototypeConstructor),
  EvalError: $EvalError,
  EvalErrorLength: 1,
  EvalErrorName: "EvalError",
  EvalErrorPrototype: $EvalErrorPrototype,
  EvalErrorPrototypeName: "EvalError",
  EvalErrorPrototypeMessage: "",
  EvalErrorPrototypeConstructor: uncurryThis($EvalErrorPrototypeConstructor),
  FinalizationRegistry: $FinalizationRegistry,
  FinalizationRegistryLength: 1,
  FinalizationRegistryName: "FinalizationRegistry",
  FinalizationRegistryPrototype: $FinalizationRegistryPrototype,
  FinalizationRegistryPrototypeRegister: uncurryThis($FinalizationRegistryPrototypeRegister),
  FinalizationRegistryPrototypeUnregister: uncurryThis($FinalizationRegistryPrototypeUnregister),
  FinalizationRegistryPrototypeConstructor: uncurryThis($FinalizationRegistryPrototypeConstructor),
  FinalizationRegistryPrototypeSymbolToStringTag: "FinalizationRegistry",
  Float32Array: $Float32Array,
  Float32ArrayLength: 3,
  Float32ArrayName: "Float32Array",
  Float32ArrayPrototype: $Float32ArrayPrototype,
  Float32ArrayBYTES_PER_ELEMENT: 4,
  Float32ArrayPrototypeBYTES_PER_ELEMENT: 4,
  Float32ArrayPrototypeConstructor: uncurryThis($Float32ArrayPrototypeConstructor),
  Float64Array: $Float64Array,
  Float64ArrayLength: 3,
  Float64ArrayName: "Float64Array",
  Float64ArrayPrototype: $Float64ArrayPrototype,
  Float64ArrayBYTES_PER_ELEMENT: 8,
  Float64ArrayPrototypeBYTES_PER_ELEMENT: 8,
  Float64ArrayPrototypeConstructor: uncurryThis($Float64ArrayPrototypeConstructor),
  Function: $Function,
  FunctionLength: 1,
  FunctionName: "Function",
  FunctionPrototype: $FunctionPrototype,
  FunctionPrototypeLength: 0,
  FunctionPrototypeName: "",
  FunctionPrototypeToString: uncurryThis($FunctionPrototypeToString),
  FunctionPrototypeApply: uncurryThis($FunctionPrototypeApply),
  FunctionPrototypeCall: uncurryThis($FunctionPrototypeCall),
  FunctionPrototypeBind: uncurryThis($FunctionPrototypeBind),
  FunctionPrototypeGetArguments: uncurryThis($FunctionPrototypeGetArguments),
  FunctionPrototypeSetArguments: uncurryThis($FunctionPrototypeSetArguments),
  FunctionPrototypeGetCaller: uncurryThis($FunctionPrototypeGetCaller),
  FunctionPrototypeSetCaller: uncurryThis($FunctionPrototypeSetCaller),
  FunctionPrototypeConstructor: uncurryThis($FunctionPrototypeConstructor),
  FunctionPrototypeSymbolHasInstance: uncurryThis($FunctionPrototypeSymbolHasInstance),
  Int16Array: $Int16Array,
  Int16ArrayLength: 3,
  Int16ArrayName: "Int16Array",
  Int16ArrayPrototype: $Int16ArrayPrototype,
  Int16ArrayBYTES_PER_ELEMENT: 2,
  Int16ArrayPrototypeBYTES_PER_ELEMENT: 2,
  Int16ArrayPrototypeConstructor: uncurryThis($Int16ArrayPrototypeConstructor),
  Int32Array: $Int32Array,
  Int32ArrayLength: 3,
  Int32ArrayName: "Int32Array",
  Int32ArrayPrototype: $Int32ArrayPrototype,
  Int32ArrayBYTES_PER_ELEMENT: 4,
  Int32ArrayPrototypeBYTES_PER_ELEMENT: 4,
  Int32ArrayPrototypeConstructor: uncurryThis($Int32ArrayPrototypeConstructor),
  Int8Array: $Int8Array,
  Int8ArrayLength: 3,
  Int8ArrayName: "Int8Array",
  Int8ArrayPrototype: $Int8ArrayPrototype,
  Int8ArrayBYTES_PER_ELEMENT: 1,
  Int8ArrayPrototypeBYTES_PER_ELEMENT: 1,
  Int8ArrayPrototypeConstructor: uncurryThis($Int8ArrayPrototypeConstructor),
  Iterator: $Iterator,
  IteratorLength: 0,
  IteratorName: "Iterator",
  IteratorPrototype: $IteratorPrototype,
  IteratorFrom: $IteratorFrom,
  IteratorConcat: $IteratorConcat,
  IteratorPrototypeGetConstructor: uncurryThis($IteratorPrototypeGetConstructor),
  IteratorPrototypeSetConstructor: uncurryThis($IteratorPrototypeSetConstructor),
  IteratorPrototypeToArray: uncurryThis($IteratorPrototypeToArray),
  IteratorPrototypeForEach: uncurryThis($IteratorPrototypeForEach),
  IteratorPrototypeSome: uncurryThis($IteratorPrototypeSome),
  IteratorPrototypeEvery: uncurryThis($IteratorPrototypeEvery),
  IteratorPrototypeFind: uncurryThis($IteratorPrototypeFind),
  IteratorPrototypeReduce: uncurryThis($IteratorPrototypeReduce),
  IteratorPrototypeMap: uncurryThis($IteratorPrototypeMap),
  IteratorPrototypeFilter: uncurryThis($IteratorPrototypeFilter),
  IteratorPrototypeTake: uncurryThis($IteratorPrototypeTake),
  IteratorPrototypeDrop: uncurryThis($IteratorPrototypeDrop),
  IteratorPrototypeFlatMap: uncurryThis($IteratorPrototypeFlatMap),
  IteratorPrototypeSymbolIterator: uncurryThis($IteratorPrototypeSymbolIterator),
  IteratorPrototypeGetSymbolToStringTag: uncurryThis($IteratorPrototypeGetSymbolToStringTag),
  IteratorPrototypeSetSymbolToStringTag: uncurryThis($IteratorPrototypeSetSymbolToStringTag),
  IteratorPrototypeSymbolDispose: uncurryThis($IteratorPrototypeSymbolDispose),
  Map: $Map,
  MapLength: 0,
  MapName: "Map",
  MapPrototype: $MapPrototype,
  MapGroupBy: $MapGroupBy,
  MapGetSymbolSpecies: uncurryThis($MapGetSymbolSpecies),
  MapPrototypeClear: uncurryThis($MapPrototypeClear),
  MapPrototypeDelete: uncurryThis($MapPrototypeDelete),
  MapPrototypeEntries: uncurryThis($MapPrototypeEntries),
  MapPrototypeForEach: uncurryThis($MapPrototypeForEach),
  MapPrototypeGet: uncurryThis($MapPrototypeGet),
  MapPrototypeHas: uncurryThis($MapPrototypeHas),
  MapPrototypeKeys: uncurryThis($MapPrototypeKeys),
  MapPrototypeSet: uncurryThis($MapPrototypeSet),
  MapPrototypeGetOrInsert: uncurryThis($MapPrototypeGetOrInsert),
  MapPrototypeGetOrInsertComputed: uncurryThis($MapPrototypeGetOrInsertComputed),
  MapPrototypeGetSize: uncurryThis($MapPrototypeGetSize),
  MapPrototypeValues: uncurryThis($MapPrototypeValues),
  MapPrototypeConstructor: uncurryThis($MapPrototypeConstructor),
  MapPrototypeSymbolIterator: uncurryThis($MapPrototypeSymbolIterator),
  MapPrototypeSymbolToStringTag: "Map",
  Number: $NumberPrimordial,
  NumberLength: 1,
  NumberName: "Number",
  NumberIsFinite: $NumberIsFinite,
  NumberIsNaN: $NumberIsNaN,
  NumberIsSafeInteger: $NumberIsSafeInteger,
  NumberPrototype: $NumberPrototype,
  NumberEPSILON: 2.220446049250313e-16,
  NumberMAX_VALUE: 1.7976931348623157e308,
  NumberMIN_VALUE: 5e-324,
  NumberMAX_SAFE_INTEGER: 9007199254740991,
  NumberMIN_SAFE_INTEGER: -9007199254740991,
  NumberNEGATIVE_INFINITY: -Infinity,
  NumberPOSITIVE_INFINITY: Infinity,
  NumberNaN: NaN,
  NumberParseInt: $NumberParseInt,
  NumberParseFloat: $NumberParseFloat,
  NumberIsInteger: $NumberIsInteger,
  NumberPrototypeToLocaleString: uncurryThis($NumberPrototypeToLocaleString),
  NumberPrototypeValueOf: uncurryThis($NumberPrototypeValueOf),
  NumberPrototypeToFixed: uncurryThis($NumberPrototypeToFixed),
  NumberPrototypeToExponential: uncurryThis($NumberPrototypeToExponential),
  NumberPrototypeToPrecision: uncurryThis($NumberPrototypeToPrecision),
  NumberPrototypeToString: uncurryThis($NumberPrototypeToString),
  NumberPrototypeConstructor: uncurryThis($NumberPrototypeConstructor),
  Object: $Object,
  ObjectGetPrototypeOf: $ObjectGetPrototypeOf,
  ObjectSetPrototypeOf: $ObjectSetPrototypeOf,
  ObjectGetOwnPropertyDescriptor: $ObjectGetOwnPropertyDescriptor,
  ObjectGetOwnPropertyDescriptors: $ObjectGetOwnPropertyDescriptors,
  ObjectGetOwnPropertyNames: $ObjectGetOwnPropertyNames,
  ObjectGetOwnPropertySymbols: $ObjectGetOwnPropertySymbols,
  ObjectKeys: $ObjectKeys,
  ObjectDefineProperty: $ObjectDefineProperty,
  ObjectDefineProperties: $ObjectDefineProperties,
  ObjectCreate: $ObjectCreate,
  ObjectSeal: $ObjectSeal,
  ObjectFreeze: $ObjectFreeze,
  ObjectPreventExtensions: $ObjectPreventExtensions,
  ObjectIsSealed: $ObjectIsSealed,
  ObjectIsFrozen: $ObjectIsFrozen,
  ObjectIsExtensible: $ObjectIsExtensible,
  ObjectIs: $ObjectIs,
  ObjectAssign: $ObjectAssign,
  ObjectValues: $ObjectValues,
  ObjectEntries: $ObjectEntries,
  ObjectFromEntries: $ObjectFromEntries,
  ObjectLength: 1,
  ObjectName: "Object",
  ObjectPrototype: $ObjectPrototype,
  ObjectHasOwn: $ObjectHasOwn,
  ObjectGroupBy: $ObjectGroupBy,
  ObjectPrototypeToString: uncurryThis($ObjectPrototypeToString),
  ObjectPrototypeToLocaleString: uncurryThis($ObjectPrototypeToLocaleString),
  ObjectPrototypeValueOf: uncurryThis($ObjectPrototypeValueOf),
  ObjectPrototypeHasOwnProperty: uncurryThis($ObjectPrototypeHasOwnProperty),
  ObjectPrototypePropertyIsEnumerable: uncurryThis($ObjectPrototypePropertyIsEnumerable),
  ObjectPrototypeIsPrototypeOf: uncurryThis($ObjectPrototypeIsPrototypeOf),
  ObjectPrototype__defineGetter__: uncurryThis($ObjectPrototype__defineGetter__),
  ObjectPrototype__defineSetter__: uncurryThis($ObjectPrototype__defineSetter__),
  ObjectPrototype__lookupGetter__: uncurryThis($ObjectPrototype__lookupGetter__),
  ObjectPrototype__lookupSetter__: uncurryThis($ObjectPrototype__lookupSetter__),
  ObjectPrototypeGet__proto__: uncurryThis($ObjectPrototypeGet__proto__),
  ObjectPrototypeSet__proto__: uncurryThis($ObjectPrototypeSet__proto__),
  ObjectPrototypeConstructor: uncurryThis($ObjectPrototypeConstructor),
  RangeError: $RangeError,
  RangeErrorLength: 1,
  RangeErrorName: "RangeError",
  RangeErrorPrototype: $RangeErrorPrototype,
  RangeErrorPrototypeName: "RangeError",
  RangeErrorPrototypeMessage: "",
  RangeErrorPrototypeConstructor: uncurryThis($RangeErrorPrototypeConstructor),
  ReferenceError: $ReferenceError,
  ReferenceErrorLength: 1,
  ReferenceErrorName: "ReferenceError",
  ReferenceErrorPrototype: $ReferenceErrorPrototype,
  ReferenceErrorPrototypeName: "ReferenceError",
  ReferenceErrorPrototypeMessage: "",
  ReferenceErrorPrototypeConstructor: uncurryThis($ReferenceErrorPrototypeConstructor),
  RegExp: $RegExp,
  RegExpGetInput: uncurryThis($RegExpGetInput),
  RegExpSetInput: uncurryThis($RegExpSetInput),
  RegExpGet$_: uncurryThis($RegExpGetDollarUnderscore),
  RegExpSet$_: uncurryThis($RegExpSetDollarUnderscore),
  RegExpGetMultiline: uncurryThis($RegExpGetMultiline),
  RegExpSetMultiline: uncurryThis($RegExpSetMultiline),
  "RegExpGet$*": uncurryThis($RegExpGetDollarAsterisk),
  "RegExpSet$*": uncurryThis($RegExpSetDollarAsterisk),
  RegExpGetLastMatch: uncurryThis($RegExpGetLastMatch),
  "RegExpGet$&": uncurryThis($RegExpGetDollarAmpersand),
  RegExpGetLastParen: uncurryThis($RegExpGetLastParen),
  "RegExpGet$+": uncurryThis($RegExpGetDollarPlus),
  RegExpGetLeftContext: uncurryThis($RegExpGetLeftContext),
  "RegExpGet$`": uncurryThis($RegExpGetDollarBacktick),
  RegExpGetRightContext: uncurryThis($RegExpGetRightContext),
  "RegExpGet$'": uncurryThis($RegExpGetDollarApostrophe),
  RegExpGet$1: uncurryThis($RegExpGetDollar1),
  RegExpGet$2: uncurryThis($RegExpGetDollar2),
  RegExpGet$3: uncurryThis($RegExpGetDollar3),
  RegExpGet$4: uncurryThis($RegExpGetDollar4),
  RegExpGet$5: uncurryThis($RegExpGetDollar5),
  RegExpGet$6: uncurryThis($RegExpGetDollar6),
  RegExpGet$7: uncurryThis($RegExpGetDollar7),
  RegExpGet$8: uncurryThis($RegExpGetDollar8),
  RegExpGet$9: uncurryThis($RegExpGetDollar9),
  RegExpLength: 2,
  RegExpName: "RegExp",
  RegExpPrototype: $RegExpPrototype,
  RegExpEscape: $RegExpEscape,
  RegExpGetSymbolSpecies: uncurryThis($RegExpGetSymbolSpecies),
  RegExpPrototypeCompile: uncurryThis($RegExpPrototypeCompile),
  RegExpPrototypeExec: uncurryThis($RegExpPrototypeExec),
  RegExpPrototypeToString: uncurryThis($RegExpPrototypeToString),
  RegExpPrototypeGetGlobal: uncurryThis($RegExpPrototypeGetGlobal),
  RegExpPrototypeGetDotAll: uncurryThis($RegExpPrototypeGetDotAll),
  RegExpPrototypeGetHasIndices: uncurryThis($RegExpPrototypeGetHasIndices),
  RegExpPrototypeGetIgnoreCase: uncurryThis($RegExpPrototypeGetIgnoreCase),
  RegExpPrototypeGetMultiline: uncurryThis($RegExpPrototypeGetMultiline),
  RegExpPrototypeGetSticky: uncurryThis($RegExpPrototypeGetSticky),
  RegExpPrototypeGetUnicode: uncurryThis($RegExpPrototypeGetUnicode),
  RegExpPrototypeGetUnicodeSets: uncurryThis($RegExpPrototypeGetUnicodeSets),
  RegExpPrototypeGetSource: uncurryThis($RegExpPrototypeGetSource),
  RegExpPrototypeGetFlags: uncurryThis($RegExpPrototypeGetFlags),
  RegExpPrototypeTest: uncurryThis($RegExpPrototypeTest),
  RegExpPrototypeConstructor: uncurryThis($RegExpPrototypeConstructor),
  RegExpPrototypeSymbolMatch: uncurryThis($RegExpPrototypeSymbolMatch),
  RegExpPrototypeSymbolMatchAll: uncurryThis($RegExpPrototypeSymbolMatchAll),
  RegExpPrototypeSymbolReplace: uncurryThis($RegExpPrototypeSymbolReplace),
  RegExpPrototypeSymbolSearch: uncurryThis($RegExpPrototypeSymbolSearch),
  RegExpPrototypeSymbolSplit: uncurryThis($RegExpPrototypeSymbolSplit),
  Set: $Set,
  SetLength: 0,
  SetName: "Set",
  SetPrototype: $SetPrototype,
  SetGetSymbolSpecies: uncurryThis($SetGetSymbolSpecies),
  SetPrototypeAdd: uncurryThis($SetPrototypeAdd),
  SetPrototypeClear: uncurryThis($SetPrototypeClear),
  SetPrototypeDelete: uncurryThis($SetPrototypeDelete),
  SetPrototypeEntries: uncurryThis($SetPrototypeEntries),
  SetPrototypeForEach: uncurryThis($SetPrototypeForEach),
  SetPrototypeHas: uncurryThis($SetPrototypeHas),
  SetPrototypeKeys: uncurryThis($SetPrototypeKeys),
  SetPrototypeGetSize: uncurryThis($SetPrototypeGetSize),
  SetPrototypeValues: uncurryThis($SetPrototypeValues),
  SetPrototypeUnion: uncurryThis($SetPrototypeUnion),
  SetPrototypeIntersection: uncurryThis($SetPrototypeIntersection),
  SetPrototypeDifference: uncurryThis($SetPrototypeDifference),
  SetPrototypeSymmetricDifference: uncurryThis($SetPrototypeSymmetricDifference),
  SetPrototypeIsSubsetOf: uncurryThis($SetPrototypeIsSubsetOf),
  SetPrototypeIsSupersetOf: uncurryThis($SetPrototypeIsSupersetOf),
  SetPrototypeIsDisjointFrom: uncurryThis($SetPrototypeIsDisjointFrom),
  SetPrototypeConstructor: uncurryThis($SetPrototypeConstructor),
  SetPrototypeSymbolIterator: uncurryThis($SetPrototypeSymbolIterator),
  SetPrototypeSymbolToStringTag: "Set",
  String: $String,
  StringLength: 1,
  StringName: "String",
  StringFromCharCode: $StringFromCharCode,
  StringFromCharCodeApply: applyBind($StringFromCharCode, $String),
  StringFromCodePoint: $StringFromCodePoint,
  StringFromCodePointApply: applyBind($StringFromCodePoint, $String),
  StringRaw: $StringRaw,
  StringPrototype: $StringPrototype,
  StringPrototypeLength: 0,
  StringPrototypeAnchor: uncurryThis($StringPrototypeAnchor),
  StringPrototypeBig: uncurryThis($StringPrototypeBig),
  StringPrototypeBold: uncurryThis($StringPrototypeBold),
  StringPrototypeBlink: uncurryThis($StringPrototypeBlink),
  StringPrototypeFixed: uncurryThis($StringPrototypeFixed),
  StringPrototypeFontcolor: uncurryThis($StringPrototypeFontcolor),
  StringPrototypeFontsize: uncurryThis($StringPrototypeFontsize),
  StringPrototypeItalics: uncurryThis($StringPrototypeItalics),
  StringPrototypeLink: uncurryThis($StringPrototypeLink),
  StringPrototypeSmall: uncurryThis($StringPrototypeSmall),
  StringPrototypeStrike: uncurryThis($StringPrototypeStrike),
  StringPrototypeSub: uncurryThis($StringPrototypeSub),
  StringPrototypeSup: uncurryThis($StringPrototypeSup),
  StringPrototypeToString: uncurryThis($StringPrototypeToString),
  StringPrototypeValueOf: uncurryThis($StringPrototypeValueOf),
  StringPrototypeCharAt: uncurryThis($StringPrototypeCharAt),
  StringPrototypeCharCodeAt: uncurryThis($StringPrototypeCharCodeAt),
  StringPrototypeCodePointAt: uncurryThis($StringPrototypeCodePointAt),
  StringPrototypeConcat: uncurryThis($StringPrototypeConcat),
  StringPrototypeConcatApply: applyBind($StringPrototypeConcat),
  StringPrototypeIndexOf: uncurryThis($StringPrototypeIndexOf),
  StringPrototypeLastIndexOf: uncurryThis($StringPrototypeLastIndexOf),
  StringPrototypeReplace: uncurryThis($StringPrototypeReplace),
  StringPrototypeReplaceAll: uncurryThis($StringPrototypeReplaceAll),
  StringPrototypeRepeat: uncurryThis($StringPrototypeRepeat),
  StringPrototypePadStart: uncurryThis($StringPrototypePadStart),
  StringPrototypePadEnd: uncurryThis($StringPrototypePadEnd),
  StringPrototypeSlice: uncurryThis($StringPrototypeSlice),
  StringPrototypeSubstr: uncurryThis($StringPrototypeSubstr),
  StringPrototypeAt: uncurryThis($StringPrototypeAt),
  StringPrototypeSubstring: uncurryThis($StringPrototypeSubstring),
  StringPrototypeToLowerCase: uncurryThis($StringPrototypeToLowerCase),
  StringPrototypeToUpperCase: uncurryThis($StringPrototypeToUpperCase),
  StringPrototypeLocaleCompare: uncurryThis($StringPrototypeLocaleCompare),
  StringPrototypeToLocaleLowerCase: uncurryThis($StringPrototypeToLocaleLowerCase),
  StringPrototypeToLocaleUpperCase: uncurryThis($StringPrototypeToLocaleUpperCase),
  StringPrototypeTrim: uncurryThis($StringPrototypeTrim),
  StringPrototypeStartsWith: uncurryThis($StringPrototypeStartsWith),
  StringPrototypeEndsWith: uncurryThis($StringPrototypeEndsWith),
  StringPrototypeIncludes: uncurryThis($StringPrototypeIncludes),
  StringPrototypeMatch: uncurryThis($StringPrototypeMatch),
  StringPrototypeSearch: uncurryThis($StringPrototypeSearch),
  StringPrototypeMatchAll: uncurryThis($StringPrototypeMatchAll),
  StringPrototypeSplit: uncurryThis($StringPrototypeSplit),
  StringPrototypeNormalize: uncurryThis($StringPrototypeNormalize),
  StringPrototypeTrimStart: uncurryThis($StringPrototypeTrimStart),
  StringPrototypeTrimLeft: uncurryThis($StringPrototypeTrimLeft),
  StringPrototypeTrimEnd: uncurryThis($StringPrototypeTrimEnd),
  StringPrototypeTrimRight: uncurryThis($StringPrototypeTrimRight),
  StringPrototypeIsWellFormed: uncurryThis($StringPrototypeIsWellFormed),
  StringPrototypeToWellFormed: uncurryThis($StringPrototypeToWellFormed),
  StringPrototypeConstructor: uncurryThis($StringPrototypeConstructor),
  StringPrototypeSymbolIterator: uncurryThis($StringPrototypeSymbolIterator),
  Symbol: $Symbol,
  SymbolFor: $SymbolFor,
  SymbolKeyFor: $SymbolKeyFor,
  SymbolLength: 0,
  SymbolName: "Symbol",
  SymbolPrototype: $SymbolPrototype,
  SymbolHasInstance: $SymbolHasInstance,
  SymbolIsConcatSpreadable: $SymbolIsConcatSpreadable,
  SymbolAsyncIterator: $SymbolAsyncIterator,
  SymbolIterator: $SymbolIterator,
  SymbolMatch: $SymbolMatch,
  SymbolMatchAll: $SymbolMatchAll,
  SymbolReplace: $SymbolReplace,
  SymbolSearch: $SymbolSearch,
  SymbolSpecies: $SymbolSpecies,
  SymbolSplit: $SymbolSplit,
  SymbolToPrimitive: $SymbolToPrimitive,
  SymbolToStringTag: $SymbolToStringTag,
  SymbolUnscopables: $SymbolUnscopables,
  SymbolDispose: $SymbolDispose,
  SymbolAsyncDispose: $SymbolAsyncDispose,
  SymbolPrototypeGetDescription: uncurryThis($SymbolPrototypeGetDescription),
  SymbolPrototypeToString: uncurryThis($SymbolPrototypeToString),
  SymbolPrototypeValueOf: uncurryThis($SymbolPrototypeValueOf),
  SymbolPrototypeConstructor: uncurryThis($SymbolPrototypeConstructor),
  SymbolPrototypeSymbolToPrimitive: uncurryThis($SymbolPrototypeSymbolToPrimitive),
  SymbolPrototypeSymbolToStringTag: "Symbol",
  SyntaxError: $SyntaxError,
  SyntaxErrorLength: 1,
  SyntaxErrorName: "SyntaxError",
  SyntaxErrorPrototype: $SyntaxErrorPrototype,
  SyntaxErrorPrototypeName: "SyntaxError",
  SyntaxErrorPrototypeMessage: "",
  SyntaxErrorPrototypeConstructor: uncurryThis($SyntaxErrorPrototypeConstructor),
  TypeError: $TypeError,
  TypeErrorLength: 1,
  TypeErrorName: "TypeError",
  TypeErrorPrototype: $TypeErrorPrototype,
  TypeErrorPrototypeName: "TypeError",
  TypeErrorPrototypeMessage: "",
  TypeErrorPrototypeConstructor: uncurryThis($TypeErrorPrototypeConstructor),
  URIError: $URIError,
  URIErrorLength: 1,
  URIErrorName: "URIError",
  URIErrorPrototype: $URIErrorPrototype,
  URIErrorPrototypeName: "URIError",
  URIErrorPrototypeMessage: "",
  URIErrorPrototypeConstructor: uncurryThis($URIErrorPrototypeConstructor),
  Uint16Array: $Uint16Array,
  Uint16ArrayLength: 3,
  Uint16ArrayName: "Uint16Array",
  Uint16ArrayPrototype: $Uint16ArrayPrototype,
  Uint16ArrayBYTES_PER_ELEMENT: 2,
  Uint16ArrayPrototypeBYTES_PER_ELEMENT: 2,
  Uint16ArrayPrototypeConstructor: uncurryThis($Uint16ArrayPrototypeConstructor),
  Uint32Array: $Uint32Array,
  Uint32ArrayLength: 3,
  Uint32ArrayName: "Uint32Array",
  Uint32ArrayPrototype: $Uint32ArrayPrototype,
  Uint32ArrayBYTES_PER_ELEMENT: 4,
  Uint32ArrayPrototypeBYTES_PER_ELEMENT: 4,
  Uint32ArrayPrototypeConstructor: uncurryThis($Uint32ArrayPrototypeConstructor),
  Uint8Array: $Uint8Array,
  Uint8ArrayLength: 3,
  Uint8ArrayName: "Uint8Array",
  Uint8ArrayPrototype: $Uint8ArrayPrototype,
  Uint8ArrayBYTES_PER_ELEMENT: 1,
  Uint8ArrayFromBase64: $Uint8ArrayFromBase64,
  Uint8ArrayFromHex: $Uint8ArrayFromHex,
  Uint8ArrayPrototypeBYTES_PER_ELEMENT: 1,
  Uint8ArrayPrototypeSetFromBase64: uncurryThis($Uint8ArrayPrototypeSetFromBase64),
  Uint8ArrayPrototypeSetFromHex: uncurryThis($Uint8ArrayPrototypeSetFromHex),
  Uint8ArrayPrototypeToBase64: uncurryThis($Uint8ArrayPrototypeToBase64),
  Uint8ArrayPrototypeToHex: uncurryThis($Uint8ArrayPrototypeToHex),
  Uint8ArrayPrototypeConstructor: uncurryThis($Uint8ArrayPrototypeConstructor),
  Uint8ClampedArray: $Uint8ClampedArray,
  Uint8ClampedArrayLength: 3,
  Uint8ClampedArrayName: "Uint8ClampedArray",
  Uint8ClampedArrayPrototype: $Uint8ClampedArrayPrototype,
  Uint8ClampedArrayBYTES_PER_ELEMENT: 1,
  Uint8ClampedArrayPrototypeBYTES_PER_ELEMENT: 1,
  Uint8ClampedArrayPrototypeConstructor: uncurryThis($Uint8ClampedArrayPrototypeConstructor),
  WeakMap: $WeakMap,
  WeakMapLength: 0,
  WeakMapName: "WeakMap",
  WeakMapPrototype: $WeakMapPrototype,
  WeakMapPrototypeDelete: uncurryThis($WeakMapPrototypeDelete),
  WeakMapPrototypeGet: uncurryThis($WeakMapPrototypeGet),
  WeakMapPrototypeHas: uncurryThis($WeakMapPrototypeHas),
  WeakMapPrototypeSet: uncurryThis($WeakMapPrototypeSet),
  WeakMapPrototypeGetOrInsert: uncurryThis($WeakMapPrototypeGetOrInsert),
  WeakMapPrototypeGetOrInsertComputed: uncurryThis($WeakMapPrototypeGetOrInsertComputed),
  WeakMapPrototypeConstructor: uncurryThis($WeakMapPrototypeConstructor),
  WeakMapPrototypeSymbolToStringTag: "WeakMap",
  WeakRef: $WeakRef,
  WeakRefLength: 1,
  WeakRefName: "WeakRef",
  WeakRefPrototype: $WeakRefPrototype,
  WeakRefPrototypeDeref: uncurryThis($WeakRefPrototypeDeref),
  WeakRefPrototypeConstructor: uncurryThis($WeakRefPrototypeConstructor),
  WeakRefPrototypeSymbolToStringTag: "WeakRef",
  WeakSet: $WeakSet,
  WeakSetLength: 0,
  WeakSetName: "WeakSet",
  WeakSetPrototype: $WeakSetPrototype,
  WeakSetPrototypeDelete: uncurryThis($WeakSetPrototypeDelete),
  WeakSetPrototypeHas: uncurryThis($WeakSetPrototypeHas),
  WeakSetPrototypeAdd: uncurryThis($WeakSetPrototypeAdd),
  WeakSetPrototypeConstructor: uncurryThis($WeakSetPrototypeConstructor),
  WeakSetPrototypeSymbolToStringTag: "WeakSet",
  Promise: $Promise,
  PromiseLength: 1,
  PromiseName: "Promise",
  PromiseResolve: $FunctionPrototypeBind.$call($PromiseResolve, $Promise),
  PromiseReject: $FunctionPrototypeBind.$call($PromiseReject, $Promise),
  PromiseRace: $FunctionPrototypeBind.$call($PromiseRace, $Promise),
  PromiseAll: $FunctionPrototypeBind.$call($PromiseAll, $Promise),
  PromiseAllSettled: $FunctionPrototypeBind.$call($PromiseAllSettled, $Promise),
  PromiseAny: $FunctionPrototypeBind.$call($PromiseAny, $Promise),
  PromiseWithResolvers: $FunctionPrototypeBind.$call($PromiseWithResolvers, $Promise),
  PromisePrototype: $PromisePrototype,
  PromiseTry: $FunctionPrototypeBind.$call($PromiseTry, $Promise),
  PromiseGetSymbolSpecies: uncurryThis($PromiseGetSymbolSpecies),
  PromisePrototypeFinally: uncurryThis($PromisePrototypeFinally),
  PromisePrototypeThen: uncurryThis($PromisePrototypeThen),
  PromisePrototypeCatch: uncurryThis($PromisePrototypeCatch),
  PromisePrototypeConstructor: uncurryThis($PromisePrototypeConstructor),
  PromisePrototypeSymbolToStringTag: "Promise",
  TypedArray: $TypedArray,
  TypedArrayLength: 0,
  TypedArrayName: "TypedArray",
  TypedArrayPrototype: $TypedArrayPrototype,
  TypedArrayOf: uncurryThis($TypedArrayOf),
  TypedArrayOfApply: applyBind($TypedArrayOf),
  TypedArrayFrom: uncurryThis($TypedArrayFrom),
  TypedArrayGetSymbolSpecies: uncurryThis($TypedArrayGetSymbolSpecies),
  TypedArrayPrototypeToString: uncurryThis($TypedArrayPrototypeToString),
  TypedArrayPrototypeGetBuffer: uncurryThis($TypedArrayPrototypeGetBuffer),
  TypedArrayPrototypeGetByteLength: uncurryThis($TypedArrayPrototypeGetByteLength),
  TypedArrayPrototypeGetByteOffset: uncurryThis($TypedArrayPrototypeGetByteOffset),
  TypedArrayPrototypeCopyWithin: uncurryThis($TypedArrayPrototypeCopyWithin),
  TypedArrayPrototypeSort: uncurryThis($TypedArrayPrototypeSort),
  TypedArrayPrototypeEvery: uncurryThis($TypedArrayPrototypeEvery),
  TypedArrayPrototypeFilter: uncurryThis($TypedArrayPrototypeFilter),
  TypedArrayPrototypeEntries: uncurryThis($TypedArrayPrototypeEntries),
  TypedArrayPrototypeIncludes: uncurryThis($TypedArrayPrototypeIncludes),
  TypedArrayPrototypeFill: uncurryThis($TypedArrayPrototypeFill),
  TypedArrayPrototypeFind: uncurryThis($TypedArrayPrototypeFind),
  TypedArrayPrototypeFindLast: uncurryThis($TypedArrayPrototypeFindLast),
  TypedArrayPrototypeFindIndex: uncurryThis($TypedArrayPrototypeFindIndex),
  TypedArrayPrototypeFindLastIndex: uncurryThis($TypedArrayPrototypeFindLastIndex),
  TypedArrayPrototypeForEach: uncurryThis($TypedArrayPrototypeForEach),
  TypedArrayPrototypeIndexOf: uncurryThis($TypedArrayPrototypeIndexOf),
  TypedArrayPrototypeJoin: uncurryThis($TypedArrayPrototypeJoin),
  TypedArrayPrototypeKeys: uncurryThis($TypedArrayPrototypeKeys),
  TypedArrayPrototypeLastIndexOf: uncurryThis($TypedArrayPrototypeLastIndexOf),
  TypedArrayPrototypeGetLength: uncurryThis($TypedArrayPrototypeGetLength),
  TypedArrayPrototypeMap: uncurryThis($TypedArrayPrototypeMap),
  TypedArrayPrototypeReduce: uncurryThis($TypedArrayPrototypeReduce),
  TypedArrayPrototypeReduceRight: uncurryThis($TypedArrayPrototypeReduceRight),
  TypedArrayPrototypeReverse: uncurryThis($TypedArrayPrototypeReverse),
  TypedArrayPrototypeSet: uncurryThis($TypedArrayPrototypeSet),
  TypedArrayPrototypeSlice: uncurryThis($TypedArrayPrototypeSlice),
  TypedArrayPrototypeSome: uncurryThis($TypedArrayPrototypeSome),
  TypedArrayPrototypeSubarray: uncurryThis($TypedArrayPrototypeSubarray),
  TypedArrayPrototypeToLocaleString: uncurryThis($TypedArrayPrototypeToLocaleString),
  TypedArrayPrototypeToReversed: uncurryThis($TypedArrayPrototypeToReversed),
  TypedArrayPrototypeToSorted: uncurryThis($TypedArrayPrototypeToSorted),
  TypedArrayPrototypeWith: uncurryThis($TypedArrayPrototypeWith),
  TypedArrayPrototypeAt: uncurryThis($TypedArrayPrototypeAt),
  TypedArrayPrototypeValues: uncurryThis($TypedArrayPrototypeValues),
  TypedArrayPrototypeConstructor: uncurryThis($TypedArrayPrototypeConstructor),
  TypedArrayPrototypeGetSymbolToStringTag: uncurryThis($TypedArrayPrototypeGetSymbolToStringTag),
  TypedArrayPrototypeSymbolIterator: uncurryThis($TypedArrayPrototypeSymbolIterator),
  ArrayIteratorPrototype: $ArrayIteratorPrototype,
  ArrayIteratorPrototypeNext: uncurryThis($ArrayIteratorPrototypeNext),
  ArrayIteratorPrototypeSymbolToStringTag: "Array Iterator",
  AsyncFunctionPrototype: $AsyncFunctionPrototype,
  AsyncFunctionPrototypeConstructor: uncurryThis($AsyncFunctionPrototypeConstructor),
  AsyncFunctionPrototypeSymbolToStringTag: "AsyncFunction",
  AsyncGeneratorFunctionPrototype: $AsyncGeneratorFunctionPrototype,
  AsyncGeneratorFunctionPrototypeConstructor: uncurryThis($AsyncGeneratorFunctionPrototypeConstructor),
  AsyncGeneratorFunctionPrototypePrototype: $AsyncGeneratorFunctionPrototypePrototype,
  AsyncGeneratorFunctionPrototypeSymbolToStringTag: "AsyncGeneratorFunction",
  AsyncIteratorPrototype: $AsyncIteratorPrototype,
  AsyncIteratorPrototypeSymbolAsyncIterator: uncurryThis($AsyncIteratorPrototypeSymbolAsyncIterator),
  AsyncIteratorPrototypeSymbolAsyncDispose: uncurryThis($AsyncIteratorPrototypeSymbolAsyncDispose),
  GeneratorFunctionPrototype: $GeneratorFunctionPrototype,
  GeneratorFunctionPrototypeConstructor: uncurryThis($GeneratorFunctionPrototypeConstructor),
  GeneratorFunctionPrototypePrototype: $GeneratorFunctionPrototypePrototype,
  GeneratorFunctionPrototypeSymbolToStringTag: "GeneratorFunction",
  IteratorHelperPrototype: $IteratorHelperPrototype,
  IteratorHelperPrototypeNext: uncurryThis($IteratorHelperPrototypeNext),
  IteratorHelperPrototypeReturn: uncurryThis($IteratorHelperPrototypeReturn),
  IteratorHelperPrototypeSymbolToStringTag: "Iterator Helper",
  MapIteratorPrototype: $MapIteratorPrototype,
  MapIteratorPrototypeNext: uncurryThis($MapIteratorPrototypeNext),
  MapIteratorPrototypeSymbolToStringTag: "Map Iterator",
  RegExpStringIteratorPrototype: $RegExpStringIteratorPrototype,
  RegExpStringIteratorPrototypeNext: uncurryThis($RegExpStringIteratorPrototypeNext),
  RegExpStringIteratorPrototypeSymbolToStringTag: "RegExp String Iterator",
  SetIteratorPrototype: $SetIteratorPrototype,
  SetIteratorPrototypeNext: uncurryThis($SetIteratorPrototypeNext),
  SetIteratorPrototypeSymbolToStringTag: "Set Iterator",
  StringIteratorPrototype: $StringIteratorPrototype,
  StringIteratorPrototypeNext: uncurryThis($StringIteratorPrototypeNext),
  StringIteratorPrototypeSymbolToStringTag: "String Iterator",
  WrapForValidIteratorPrototype: $WrapForValidIteratorPrototype,
  WrapForValidIteratorPrototypeNext: uncurryThis($WrapForValidIteratorPrototypeNext),
  WrapForValidIteratorPrototypeReturn: uncurryThis($WrapForValidIteratorPrototypeReturn),
  WrapForValidIteratorPrototypeSymbolToStringTag: "Iterator",
};

// Pristine descriptors of the Safe* bases' original properties (see epilogue).
const pristineDescriptors = { __proto__: null };
pristineDescriptors.MapPrototype = {
  __proto__: null,
  clear: { __proto__: null, value: $MapPrototypeClear, writable: true, enumerable: false, configurable: true },
  delete: { __proto__: null, value: $MapPrototypeDelete, writable: true, enumerable: false, configurable: true },
  entries: { __proto__: null, value: $MapPrototypeEntries, writable: true, enumerable: false, configurable: true },
  forEach: { __proto__: null, value: $MapPrototypeForEach, writable: true, enumerable: false, configurable: true },
  get: { __proto__: null, value: $MapPrototypeGet, writable: true, enumerable: false, configurable: true },
  has: { __proto__: null, value: $MapPrototypeHas, writable: true, enumerable: false, configurable: true },
  keys: { __proto__: null, value: $MapPrototypeKeys, writable: true, enumerable: false, configurable: true },
  set: { __proto__: null, value: $MapPrototypeSet, writable: true, enumerable: false, configurable: true },
  getOrInsert: {
    __proto__: null,
    value: $MapPrototypeGetOrInsert,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  getOrInsertComputed: {
    __proto__: null,
    value: $MapPrototypeGetOrInsertComputed,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  size: { __proto__: null, get: $MapPrototypeGetSize, enumerable: false, configurable: true },
  values: { __proto__: null, value: $MapPrototypeValues, writable: true, enumerable: false, configurable: true },
  constructor: {
    __proto__: null,
    value: $MapPrototypeConstructor,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  [$SymbolIterator]: {
    __proto__: null,
    value: $MapPrototypeSymbolIterator,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  [$SymbolToStringTag]: { __proto__: null, value: "Map", writable: false, enumerable: false, configurable: true },
};
pristineDescriptors.MapConstructor = {
  __proto__: null,
  length: { __proto__: null, value: 0, writable: false, enumerable: false, configurable: true },
  name: { __proto__: null, value: "Map", writable: false, enumerable: false, configurable: true },
  groupBy: { __proto__: null, value: $MapGroupBy, writable: true, enumerable: false, configurable: true },
  [$SymbolSpecies]: { __proto__: null, get: $MapGetSymbolSpecies, enumerable: false, configurable: true },
};
pristineDescriptors.SetPrototype = {
  __proto__: null,
  add: { __proto__: null, value: $SetPrototypeAdd, writable: true, enumerable: false, configurable: true },
  clear: { __proto__: null, value: $SetPrototypeClear, writable: true, enumerable: false, configurable: true },
  delete: { __proto__: null, value: $SetPrototypeDelete, writable: true, enumerable: false, configurable: true },
  entries: { __proto__: null, value: $SetPrototypeEntries, writable: true, enumerable: false, configurable: true },
  forEach: { __proto__: null, value: $SetPrototypeForEach, writable: true, enumerable: false, configurable: true },
  has: { __proto__: null, value: $SetPrototypeHas, writable: true, enumerable: false, configurable: true },
  keys: { __proto__: null, value: $SetPrototypeKeys, writable: true, enumerable: false, configurable: true },
  size: { __proto__: null, get: $SetPrototypeGetSize, enumerable: false, configurable: true },
  values: { __proto__: null, value: $SetPrototypeValues, writable: true, enumerable: false, configurable: true },
  union: { __proto__: null, value: $SetPrototypeUnion, writable: true, enumerable: false, configurable: true },
  intersection: {
    __proto__: null,
    value: $SetPrototypeIntersection,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  difference: {
    __proto__: null,
    value: $SetPrototypeDifference,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  symmetricDifference: {
    __proto__: null,
    value: $SetPrototypeSymmetricDifference,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  isSubsetOf: {
    __proto__: null,
    value: $SetPrototypeIsSubsetOf,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  isSupersetOf: {
    __proto__: null,
    value: $SetPrototypeIsSupersetOf,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  isDisjointFrom: {
    __proto__: null,
    value: $SetPrototypeIsDisjointFrom,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  constructor: {
    __proto__: null,
    value: $SetPrototypeConstructor,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  [$SymbolIterator]: {
    __proto__: null,
    value: $SetPrototypeSymbolIterator,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  [$SymbolToStringTag]: { __proto__: null, value: "Set", writable: false, enumerable: false, configurable: true },
};
pristineDescriptors.SetConstructor = {
  __proto__: null,
  length: { __proto__: null, value: 0, writable: false, enumerable: false, configurable: true },
  name: { __proto__: null, value: "Set", writable: false, enumerable: false, configurable: true },
  [$SymbolSpecies]: { __proto__: null, get: $SetGetSymbolSpecies, enumerable: false, configurable: true },
};
pristineDescriptors.WeakMapPrototype = {
  __proto__: null,
  delete: { __proto__: null, value: $WeakMapPrototypeDelete, writable: true, enumerable: false, configurable: true },
  get: { __proto__: null, value: $WeakMapPrototypeGet, writable: true, enumerable: false, configurable: true },
  has: { __proto__: null, value: $WeakMapPrototypeHas, writable: true, enumerable: false, configurable: true },
  set: { __proto__: null, value: $WeakMapPrototypeSet, writable: true, enumerable: false, configurable: true },
  getOrInsert: {
    __proto__: null,
    value: $WeakMapPrototypeGetOrInsert,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  getOrInsertComputed: {
    __proto__: null,
    value: $WeakMapPrototypeGetOrInsertComputed,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  constructor: {
    __proto__: null,
    value: $WeakMapPrototypeConstructor,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  [$SymbolToStringTag]: { __proto__: null, value: "WeakMap", writable: false, enumerable: false, configurable: true },
};
pristineDescriptors.WeakMapConstructor = {
  __proto__: null,
  length: { __proto__: null, value: 0, writable: false, enumerable: false, configurable: true },
  name: { __proto__: null, value: "WeakMap", writable: false, enumerable: false, configurable: true },
};
pristineDescriptors.WeakSetPrototype = {
  __proto__: null,
  delete: { __proto__: null, value: $WeakSetPrototypeDelete, writable: true, enumerable: false, configurable: true },
  has: { __proto__: null, value: $WeakSetPrototypeHas, writable: true, enumerable: false, configurable: true },
  add: { __proto__: null, value: $WeakSetPrototypeAdd, writable: true, enumerable: false, configurable: true },
  constructor: {
    __proto__: null,
    value: $WeakSetPrototypeConstructor,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  [$SymbolToStringTag]: { __proto__: null, value: "WeakSet", writable: false, enumerable: false, configurable: true },
};
pristineDescriptors.WeakSetConstructor = {
  __proto__: null,
  length: { __proto__: null, value: 0, writable: false, enumerable: false, configurable: true },
  name: { __proto__: null, value: "WeakSet", writable: false, enumerable: false, configurable: true },
};
pristineDescriptors.FinalizationRegistryPrototype = {
  __proto__: null,
  register: {
    __proto__: null,
    value: $FinalizationRegistryPrototypeRegister,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  unregister: {
    __proto__: null,
    value: $FinalizationRegistryPrototypeUnregister,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  constructor: {
    __proto__: null,
    value: $FinalizationRegistryPrototypeConstructor,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  [$SymbolToStringTag]: {
    __proto__: null,
    value: "FinalizationRegistry",
    writable: false,
    enumerable: false,
    configurable: true,
  },
};
pristineDescriptors.FinalizationRegistryConstructor = {
  __proto__: null,
  length: { __proto__: null, value: 1, writable: false, enumerable: false, configurable: true },
  name: { __proto__: null, value: "FinalizationRegistry", writable: false, enumerable: false, configurable: true },
};
pristineDescriptors.WeakRefPrototype = {
  __proto__: null,
  deref: { __proto__: null, value: $WeakRefPrototypeDeref, writable: true, enumerable: false, configurable: true },
  constructor: {
    __proto__: null,
    value: $WeakRefPrototypeConstructor,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  [$SymbolToStringTag]: { __proto__: null, value: "WeakRef", writable: false, enumerable: false, configurable: true },
};
pristineDescriptors.WeakRefConstructor = {
  __proto__: null,
  length: { __proto__: null, value: 1, writable: false, enumerable: false, configurable: true },
  name: { __proto__: null, value: "WeakRef", writable: false, enumerable: false, configurable: true },
};
pristineDescriptors.PromisePrototype = {
  __proto__: null,
  finally: { __proto__: null, value: $PromisePrototypeFinally, writable: true, enumerable: false, configurable: true },
  then: { __proto__: null, value: $PromisePrototypeThen, writable: true, enumerable: false, configurable: true },
  catch: { __proto__: null, value: $PromisePrototypeCatch, writable: true, enumerable: false, configurable: true },
  constructor: {
    __proto__: null,
    value: $PromisePrototypeConstructor,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  [$SymbolToStringTag]: { __proto__: null, value: "Promise", writable: false, enumerable: false, configurable: true },
};
pristineDescriptors.PromiseConstructor = {
  __proto__: null,
  length: { __proto__: null, value: 1, writable: false, enumerable: false, configurable: true },
  name: { __proto__: null, value: "Promise", writable: false, enumerable: false, configurable: true },
  resolve: { __proto__: null, value: $PromiseResolve, writable: true, enumerable: false, configurable: true },
  reject: { __proto__: null, value: $PromiseReject, writable: true, enumerable: false, configurable: true },
  race: { __proto__: null, value: $PromiseRace, writable: true, enumerable: false, configurable: true },
  all: { __proto__: null, value: $PromiseAll, writable: true, enumerable: false, configurable: true },
  allSettled: { __proto__: null, value: $PromiseAllSettled, writable: true, enumerable: false, configurable: true },
  any: { __proto__: null, value: $PromiseAny, writable: true, enumerable: false, configurable: true },
  withResolvers: {
    __proto__: null,
    value: $PromiseWithResolvers,
    writable: true,
    enumerable: false,
    configurable: true,
  },
  try: { __proto__: null, value: $PromiseTry, writable: true, enumerable: false, configurable: true },
  [$SymbolSpecies]: { __proto__: null, get: $PromiseGetSymbolSpecies, enumerable: false, configurable: true },
};

// ─── helpers layered on the generated object (mirrors Node's primordials.js) ───

primordials.uncurryThis = uncurryThis;
primordials.applyBind = applyBind;

const {
  Array: ArrayConstructor,
  ArrayPrototypeForEach,
  ArrayPrototypeMap,
  ArrayPrototypePushApply,
  ArrayPrototypeSlice,
  ArrayIteratorPrototypeNext,
  ArrayPrototypeSymbolIterator,
  FinalizationRegistry,
  FunctionPrototypeCall,
  Map,
  MapIteratorPrototypeNext,
  ObjectCreate,
  ObjectDefineProperties,
  ObjectDefineProperty,
  ObjectFreeze,
  ObjectGetPrototypeOf,
  ObjectSetPrototypeOf,
  Promise,
  PromisePrototypeThen,
  PromiseResolve,
  ReflectApply,
  ReflectConstruct,
  ReflectDefineProperty,
  ReflectGet,
  ReflectGetOwnPropertyDescriptor,
  ReflectOwnKeys,
  ReflectSet,
  RegExp,
  RegExpPrototypeExec,
  RegExpPrototypeGetDotAll,
  RegExpPrototypeGetFlags,
  RegExpPrototypeGetGlobal,
  RegExpPrototypeGetHasIndices,
  RegExpPrototypeGetIgnoreCase,
  RegExpPrototypeGetMultiline,
  RegExpPrototypeGetSource,
  RegExpPrototypeGetSticky,
  RegExpPrototypeGetUnicode,
  Set,
  SetIteratorPrototypeNext,
  StringIteratorPrototypeNext,
  StringPrototypeSymbolIterator,
  SymbolIterator,
  SymbolMatch,
  SymbolMatchAll,
  SymbolReplace,
  SymbolSearch,
  SymbolSpecies,
  SymbolSplit,
  WeakMap,
  WeakRef,
  WeakSet,
} = primordials;

// An iterator user code can't intercept: its next() and Symbol.iterator are
// captured functions and its prototype is detached and frozen.
const createSafeIterator = (factory, next) => {
  class SafeIterator {
    constructor(iterable) {
      this._iterator = factory(iterable);
    }
    next() {
      return next(this._iterator);
    }
    [SymbolIterator]() {
      return this;
    }
  }
  ObjectSetPrototypeOf(SafeIterator.prototype, null);
  ObjectFreeze(SafeIterator.prototype);
  ObjectFreeze(SafeIterator);
  return SafeIterator;
};

const SafeArrayIterator = createSafeIterator(ArrayPrototypeSymbolIterator, ArrayIteratorPrototypeNext);
primordials.SafeArrayIterator = SafeArrayIterator;
primordials.SafeStringIterator = createSafeIterator(StringPrototypeSymbolIterator, StringIteratorPrototypeNext);

const copyOwnProperties = (source, target) => {
  ArrayPrototypeForEach(ReflectOwnKeys(source), key => {
    if (!ReflectGetOwnPropertyDescriptor(target, key))
      ReflectDefineProperty(target, key, { __proto__: null, ...ReflectGetOwnPropertyDescriptor(source, key) });
  });
};

const detachAndFreeze = safe => {
  ObjectSetPrototypeOf(safe.prototype, null);
  ObjectFreeze(safe.prototype);
  ObjectFreeze(safe);
  return safe;
};

const defineFromDescriptors = (descriptors, target, mapDescriptor) => {
  ArrayPrototypeForEach(ReflectOwnKeys(descriptors), key => {
    if (!ReflectGetOwnPropertyDescriptor(target, key))
      ReflectDefineProperty(target, key, mapDescriptor({ __proto__: null, ...descriptors[key] }, key));
  });
};

// This module loads lazily, possibly after user code, so our own Safe* classes are
// built from the pristine descriptor records the generator emits rather than by
// reading the live prototypes. `iterator` = { prototype, next } (pristine): zero-arg
// methods that hand out that iterator kind are rewrapped to return safe iterators.
const makeSafeFromPristine = (unsafe, safe, prototypeDescriptors, staticDescriptors, iterator) => {
  const instance = iterator ? new unsafe() : null;
  defineFromDescriptors(prototypeDescriptors, safe.prototype, descriptor => {
    const method = descriptor.value;
    if (iterator && typeof method === "function" && method.length === 0) {
      const result = FunctionPrototypeCall(method, instance);
      if (result != null && typeof result === "object" && ObjectGetPrototypeOf(result) === iterator.prototype) {
        const SafeIterator = createSafeIterator(uncurryThis(method), iterator.next);
        descriptor.value = function () {
          return new SafeIterator(this);
        };
      }
    }
    return descriptor;
  });
  defineFromDescriptors(staticDescriptors, safe, descriptor => descriptor);
  return detachAndFreeze(safe);
};

// The exported makeSafe copies from a consumer's own classes at their call time
// (as in Node); zero-arg iterator-returning methods are rewrapped so the copies
// hand out safe iterators over a captured pristine `next`.
const makeSafe = (unsafe, safe) => {
  if (SymbolIterator in unsafe.prototype) {
    const dummy = new unsafe();
    let next; // We can reuse the same `next` method.
    ArrayPrototypeForEach(ReflectOwnKeys(unsafe.prototype), key => {
      if (ReflectGetOwnPropertyDescriptor(safe.prototype, key)) return;
      const descriptor = ReflectGetOwnPropertyDescriptor(unsafe.prototype, key);
      if (
        typeof descriptor.value === "function" &&
        descriptor.value.length === 0 &&
        SymbolIterator in (FunctionPrototypeCall(descriptor.value, dummy) ?? {})
      ) {
        const createIterator = uncurryThis(descriptor.value);
        next ??= uncurryThis(createIterator(dummy).next);
        const SafeIterator = createSafeIterator(createIterator, next);
        descriptor.value = function () {
          return new SafeIterator(this);
        };
      }
      ReflectDefineProperty(safe.prototype, key, { __proto__: null, ...descriptor });
    });
  } else {
    copyOwnProperties(unsafe.prototype, safe.prototype);
  }
  copyOwnProperties(unsafe, safe);
  return detachAndFreeze(safe);
};
primordials.makeSafe = makeSafe;

const mapIteration = { prototype: primordials.MapIteratorPrototype, next: MapIteratorPrototypeNext };
const setIteration = { prototype: primordials.SetIteratorPrototype, next: SetIteratorPrototypeNext };
primordials.SafeMap = makeSafeFromPristine(
  Map,
  class SafeMap extends Map {},
  pristineDescriptors.MapPrototype,
  pristineDescriptors.MapConstructor,
  mapIteration,
);
primordials.SafeWeakMap = makeSafeFromPristine(
  WeakMap,
  class SafeWeakMap extends WeakMap {},
  pristineDescriptors.WeakMapPrototype,
  pristineDescriptors.WeakMapConstructor,
);
primordials.SafeSet = makeSafeFromPristine(
  Set,
  class SafeSet extends Set {},
  pristineDescriptors.SetPrototype,
  pristineDescriptors.SetConstructor,
  setIteration,
);
primordials.SafeWeakSet = makeSafeFromPristine(
  WeakSet,
  class SafeWeakSet extends WeakSet {},
  pristineDescriptors.WeakSetPrototype,
  pristineDescriptors.WeakSetConstructor,
);
primordials.SafeFinalizationRegistry = makeSafeFromPristine(
  FinalizationRegistry,
  class SafeFinalizationRegistry extends FinalizationRegistry {},
  pristineDescriptors.FinalizationRegistryPrototype,
  pristineDescriptors.FinalizationRegistryConstructor,
);
primordials.SafeWeakRef = makeSafeFromPristine(
  WeakRef,
  class SafeWeakRef extends WeakRef {},
  pristineDescriptors.WeakRefPrototype,
  pristineDescriptors.WeakRefConstructor,
);

const SafePromise = makeSafeFromPristine(
  Promise,
  class SafePromise extends Promise {},
  pristineDescriptors.PromisePrototype,
  pristineDescriptors.PromiseConstructor,
);

// The Safe* promise combinators wrap results in a plain Promise so the SafePromise
// prototype never reaches user code, and wrap each input so a tampered .then on
// a user promise cannot observe the combinator.
const SafePromisePrototypeFinallyOfSafe = uncurryThis(SafePromise.prototype.finally);
const SafePromisePrototypeThenOfSafe = uncurryThis(SafePromise.prototype.then);
primordials.SafePromisePrototypeFinally = (thisPromise, onFinally) =>
  new Promise((resolve, reject) => {
    const wrapped = new SafePromise((resolveInner, rejectInner) =>
      PromisePrototypeThen(thisPromise, resolveInner, rejectInner),
    );
    SafePromisePrototypeThenOfSafe(SafePromisePrototypeFinallyOfSafe(wrapped, onFinally), resolve, reject);
  });

const arrayToSafePromiseIterable = (promises, mapFn) =>
  new SafeArrayIterator(
    ArrayPrototypeMap(
      promises,
      (promise, i) =>
        new SafePromise((resolve, reject) =>
          PromisePrototypeThen(mapFn == null ? promise : mapFn(promise, i), resolve, reject),
        ),
    ),
  );

const safePromiseCombinator = combinator => (promises, mapFn) =>
  new Promise((resolve, reject) =>
    SafePromisePrototypeThenOfSafe(
      FunctionPrototypeCall(combinator, SafePromise, arrayToSafePromiseIterable(promises, mapFn)),
      resolve,
      reject,
    ),
  );

primordials.SafePromiseAll = safePromiseCombinator(SafePromise.all);
primordials.SafePromiseAllSettled = safePromiseCombinator(SafePromise.allSettled);
primordials.SafePromiseAny = safePromiseCombinator(SafePromise.any);
primordials.SafePromiseRace = safePromiseCombinator(SafePromise.race);

// The *ReturnArrayLike/*ReturnVoid variants avoid Promise.all entirely: no
// prototype lookups, and the array-like result has no Array.prototype.
primordials.SafePromiseAllReturnArrayLike = (promises, mapFn) =>
  new Promise((resolve, reject) => {
    const { length } = promises;
    const results = ArrayConstructor(length);
    ObjectSetPrototypeOf(results, null);
    if (length === 0) resolve(results);
    let pending = length;
    for (let i = 0; i < length; i++) {
      const promise = mapFn != null ? mapFn(promises[i], i) : promises[i];
      PromisePrototypeThen(
        PromiseResolve(promise),
        result => {
          results[i] = result;
          if (--pending === 0) resolve(results);
        },
        reject,
      );
    }
  });

primordials.SafePromiseAllReturnVoid = (promises, mapFn) =>
  new Promise((resolve, reject) => {
    let pending = promises.length;
    if (pending === 0) resolve();
    const onFulfilled = () => {
      if (--pending === 0) resolve();
    };
    for (let i = 0; i < promises.length; i++) {
      const promise = mapFn != null ? mapFn(promises[i], i) : promises[i];
      PromisePrototypeThen(PromiseResolve(promise), onFulfilled, reject);
    }
  });

primordials.SafePromiseAllSettledReturnVoid = (promises, mapFn) =>
  new Promise(resolve => {
    let pending = promises.length;
    if (pending === 0) resolve();
    const onSettled = () => {
      if (--pending === 0) resolve();
    };
    for (let i = 0; i < promises.length; i++) {
      const promise = mapFn != null ? mapFn(promises[i], i) : promises[i];
      PromisePrototypeThen(PromiseResolve(promise), onSettled, onSettled);
    }
  });

// The raw (this-taking) originals: hardenRegExp installs them on the pattern
// itself. They come from the pristine constants, not the live RegExp.prototype,
// because this module can load after user code has replaced those properties.
const OriginalRegExpPrototypeExec = $RegExpPrototypeExec;
const OriginalRegExpPrototypeSymbolMatch = $RegExpPrototypeSymbolMatch;
const OriginalRegExpPrototypeSymbolMatchAll = $RegExpPrototypeSymbolMatchAll;
const OriginalRegExpPrototypeSymbolReplace = $RegExpPrototypeSymbolReplace;
const OriginalRegExpPrototypeSymbolSearch = $RegExpPrototypeSymbolSearch;
const OriginalRegExpPrototypeSymbolSplit = $RegExpPrototypeSymbolSplit;

// The species String.prototype.split uses on a hardened pattern: only lastIndex
// and exec are ever consulted, and the inner pattern is a real, private RegExp.
class RegExpLikeForStringSplitting {
  #regex;
  constructor() {
    this.#regex = ReflectConstruct(RegExp, arguments);
  }
  get lastIndex() {
    return ReflectGet(this.#regex, "lastIndex");
  }
  set lastIndex(value) {
    ReflectSet(this.#regex, "lastIndex", value);
  }
  exec() {
    return ReflectApply(OriginalRegExpPrototypeExec, this.#regex, arguments);
  }
}
ObjectSetPrototypeOf(RegExpLikeForStringSplitting.prototype, null);

// Freezes a pattern's observable protocol (Symbol.match/replace/..., exec, flags,
// species) to the original algorithms so String methods can use it after user code ran.
primordials.hardenRegExp = function hardenRegExp(pattern) {
  ObjectDefineProperties(pattern, {
    [SymbolMatch]: { __proto__: null, configurable: true, value: OriginalRegExpPrototypeSymbolMatch },
    [SymbolMatchAll]: { __proto__: null, configurable: true, value: OriginalRegExpPrototypeSymbolMatchAll },
    [SymbolReplace]: { __proto__: null, configurable: true, value: OriginalRegExpPrototypeSymbolReplace },
    [SymbolSearch]: { __proto__: null, configurable: true, value: OriginalRegExpPrototypeSymbolSearch },
    [SymbolSplit]: { __proto__: null, configurable: true, value: OriginalRegExpPrototypeSymbolSplit },
    constructor: { __proto__: null, configurable: true, value: { [SymbolSpecies]: RegExpLikeForStringSplitting } },
    dotAll: { __proto__: null, configurable: true, value: RegExpPrototypeGetDotAll(pattern) },
    exec: { __proto__: null, configurable: true, value: OriginalRegExpPrototypeExec },
    global: { __proto__: null, configurable: true, value: RegExpPrototypeGetGlobal(pattern) },
    hasIndices: { __proto__: null, configurable: true, value: RegExpPrototypeGetHasIndices(pattern) },
    ignoreCase: { __proto__: null, configurable: true, value: RegExpPrototypeGetIgnoreCase(pattern) },
    multiline: { __proto__: null, configurable: true, value: RegExpPrototypeGetMultiline(pattern) },
    source: { __proto__: null, configurable: true, value: RegExpPrototypeGetSource(pattern) },
    sticky: { __proto__: null, configurable: true, value: RegExpPrototypeGetSticky(pattern) },
    unicode: { __proto__: null, configurable: true, value: RegExpPrototypeGetUnicode(pattern) },
  });
  ObjectDefineProperty(pattern, "flags", {
    __proto__: null,
    configurable: true,
    value: RegExpPrototypeGetFlags(pattern),
  });
  return pattern;
};

primordials.SafeStringPrototypeSearch = (str, regexp) => {
  regexp.lastIndex = 0;
  const match = RegExpPrototypeExec(regexp, str);
  return match ? match.index : -1;
};

// Chunked push.apply so arbitrarily large arrays don't exhaust the stack.
primordials.SafeArrayPrototypePushApply = (array, items) => {
  let end = 0x10000;
  if (end < items.length) {
    let start = 0;
    do {
      ArrayPrototypePushApply(array, ArrayPrototypeSlice(items, start, (start = end)));
      end += 0x10000;
    } while (end < items.length);
    items = ArrayPrototypeSlice(items, start);
  }
  return ArrayPrototypePushApply(array, items);
};

ObjectSetPrototypeOf(primordials, null);
ObjectFreeze(primordials);

export default primordials;
