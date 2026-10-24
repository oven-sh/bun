// Functions that exist to test the binding generator: test/internal/bindgen.test.ts
import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::bindgen_test" });

export const add = b.fn({
  args: {
    a: b.i32.wrap,
    b: b.i32.wrap.nullable.default(-1),
  },
  returns: b.i32,
  capability: "heap",
  throws: true,
});

export const requiredAndOptionalArg = b.fn({
  args: {
    a: b.bool.loose,
    b: b.usize.wrap.nullable,
    c: b.i32.enforceRange(0, 100).nullable.default(42),
    d: b.u8.wrap.nullable,
  },
  returns: b.i32,
});

export const utf8Echo = b.fn({ args: { text: b.string.utf8 }, returns: b.string.utf8, length: 3 });
export const utf8EchoLoose = b.fn({ args: { text: b.string.loose.utf8 }, returns: b.string.utf8 });
export const utf8Optional = b.fn({ args: { text: b.string.utf8.nullable }, returns: b.string.utf8.nullable });
export const utf8Owned = b.fn({ args: { text: b.string.utf8.owned }, returns: b.string.utf8 });
export const stringEcho = b.fn({ args: { text: b.string }, returns: b.string });
export const stringViewEcho = b.fn({ args: { text: b.string.view }, returns: b.string });
export const stringOrObjectViewEcho = b.fn({
  args: { text: b.string.allowStringObject.view.optional },
  returns: b.string.optional,
});
export const stringLength = b.fn({ args: { text: b.string.default("absent") }, returns: b.usize });
export const expectedByNode = b.fn({
  args: { text: b.string, data: b.bytes({ from: ["string", "buffer"] }).optional, flag: b.bool.default(false) },
  expected: { text: ["string"], data: ["Buffer", "TypedArray", "DataView", "string"] },
  returns: b.usize,
});
export const TestFlag = b.dictionary({ flag: b.bool.loose.default(false) });
export const expectedMessage = b.fn({
  args: { data: b.bytes({ from: ["buffer"] }), options: TestFlag.nullable.default({}), more: TestFlag.default({}) },
  expected: { data: "data is not a buffer.", options: ["object"] },
  returns: b.usize,
});

export const TestColor = b.enumeration(["red", ["green", "lime"], "blue"]);
export const nextColor = b.fn({ args: { color: TestColor }, returns: TestColor });

export const TestOptions = b.dictionary({
  count: b.i32.default(1),
  flag: b.bool.loose.default(false),
  name: b.string.utf8.optional,
  color: TestColor.default("red"),
  ratio: b.f64.nullable,
  payload: b.any,
  renamed: { type: b.u8.optional, altNames: ["oldName"] },
});
export const TestOptionsEcho = b.dictionary({
  count: b.i32,
  flag: b.bool,
  name: b.string.utf8.optional,
  color: TestColor,
  ratio: b.f64.nullable,
  payload: b.any,
  renamed: b.u8.optional,
});
export const optionsEcho = b.fn({ args: { options: TestOptions }, returns: TestOptionsEcho, capability: "heap" });

export const TestNames = b.dictionary({
  first: b.string.utf8,
  nickname: b.string.utf8.nullable,
  all: b.array(b.string.utf8),
});
export const names = b.fn({ args: { text: b.string.utf8 }, returns: TestNames });

export const TestBare = b.dictionary({ id: b.u32, label: b.string.utf8.optional }, { nullPrototype: true });
export const bare = b.fn({ args: { id: b.u32 }, returns: TestBare });

export const dateOf = b.fn({ args: { time: b.f64 }, returns: b.f64.asDate });
export const latin1 = b.fn({
  args: { bytes: b.bytes({ from: ["buffer"] }) },
  returns: b.string.local,
  capability: "heap",
});
export const TestTextOrBytes = b.union({ text: b.string.utf8, bytes: b.bufferSource, nothing: b.null });
export const textOrBytes = b.fn({
  args: { text: b.string.utf8, as: b.u8 },
  returns: TestTextOrBytes,
  capability: "heap",
  throws: true,
});
export const positions = b.fn({ args: { text: b.string.utf8 }, returns: b.record(b.usize) });

export const TestValue = b.union({
  number: b.f64,
  flag: b.bool,
  text: b.string.utf8,
  list: b.array(b.i32),
});
export const describeValue = b.fn({ args: { value: TestValue }, returns: b.string.utf8 });

export const sumArray = b.fn({ args: { numbers: b.array(b.i32) }, returns: b.f64 });
export const range = b.fn({ args: { length: b.u32 }, returns: b.array(b.u32) });
export const words = b.fn({ args: { text: b.string.utf8 }, returns: b.array(b.string.utf8) });

export const sumBytes = b.fn({ args: { bytes: b.bytes({ from: ["buffer"] }) }, returns: b.u32 });
/** Converting `text` can run JavaScript. */
export const sumBytesThenText = b.fn({
  args: { bytes: b.bytes({ from: ["buffer"] }), text: b.string.loose.utf8 },
  returns: b.u32,
});
/** The sum before `callback` runs, then after it. */
export const sumBeforeAndAfterCallback = b.fn({
  args: { buffer: b.bufferSource, callback: b.callable },
  returns: b.array(b.u32),
  capability: "js",
  throws: true,
});

/** What `callback` returns, or `fallback` if there is no `callback`. */
export const callOr = b.fn({
  args: { callback: b.callable.nullable, fallback: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
});
export const fillBuffer = b.fn({
  args: { buffer: b.bufferSource.allowShared, value: b.u8 },
  returns: b.usize,
  capability: "heap",
});
/** -1 without any. */
export const sumBytesIfAny = b.fn({
  args: { bytes: b.bytes({ from: ["string", "buffer"] }).nullable, text: b.string.loose.utf8.default("") },
  returns: b.i32,
});
export const stringOrObjectEcho = b.fn({ args: { text: b.string.allowStringObject }, returns: b.string });

type BytesOptions = Parameters<typeof b.bytes>[0];
const bytesOfWith = (options: BytesOptions) =>
  b.fn({ args: { data: b.bytes(options) }, returns: b.array(b.u8), rustPath: "crate::bindgen_test::bytes_of" });
export const bytesOf = bytesOfWith({ from: ["string", "buffer"] });
export const bytesOfString = bytesOfWith({ from: ["string"] });
export const bytesOfRefusingStringObject = bytesOfWith({ from: ["string", "buffer"], refuse: ["stringObject"] });
export const bytesOfBufferOrBlob = bytesOfWith({ from: ["buffer", "blob"] });
export const bytesOfOrToString = bytesOfWith({ from: ["string", "buffer", "blob"], otherwise: "toString" });
export const bytesOfRefusingUndefined = bytesOfWith({
  from: ["string", "buffer"],
  otherwise: "toString",
  refuse: ["undefined"],
});
/** `after` is converted after `data`, and can run JavaScript. */
const bytesOfThenWith = (options: Omit<BytesOptions, "from">, rustName: string) =>
  b.fn({
    args: { data: b.bytes({ from: ["string", "buffer", "blob"], ...options }), after: b.f64.loose },
    returns: b.array(b.u8),
    rustPath: `crate::bindgen_test::${rustName}`,
  });
export const bytesOfThen = bytesOfThenWith({}, "bytes_of_then");
export const bytesOfThenCopyingShared = bytesOfThenWith({ shared: "copied" }, "bytes_of_then");
export const bytesOfThenCopied = bytesOfThenWith({ held: "copied" }, "bytes_of_then_copied");
/** Given one value twice: whether both are its own memory, and not a copy each. */
const bytesOfAreSameMemoryWith = (shared: BytesOptions["shared"]) => {
  const data = b.bytes({ from: ["string", "buffer", "blob"], shared });
  return b.fn({
    args: { data, again: data },
    returns: b.bool,
    rustPath: "crate::bindgen_test::bytes_of_are_same_memory",
  });
};
export const bytesOfAreSameMemory = bytesOfAreSameMemoryWith("borrowed");
export const bytesOfAreSameMemoryCopyingShared = bytesOfAreSameMemoryWith("copied");
/** The bytes before `callback` runs, then after it. */
const bytesBeforeAndAfterCallbackWith = (shared: BytesOptions["shared"]) =>
  b.fn({
    args: {
      data: b.bytes({ from: ["string", "buffer", "blob"], otherwise: "toString", shared, held: "handle" }),
      callback: b.callable,
    },
    returns: b.array(b.array(b.u8)),
    capability: "js",
    throws: true,
    rustPath: "crate::bindgen_test::bytes_before_and_after_callback",
  });
export const bytesBeforeAndAfterCallback = bytesBeforeAndAfterCallbackWith("borrowed");
export const bytesBeforeAndAfterCallbackCopyingShared = bytesBeforeAndAfterCallbackWith("copied");
/** The bytes another thread reads after `callback` has run. */
export const pinnedBytesAfterCallback = b.fn({
  args: { data: b.bytes({ from: ["string", "buffer"], held: "pinned" }), callback: b.callable },
  returns: b.array(b.u8),
  capability: "js",
  throws: true,
});
/** The size of a code unit of a string, 0 for anything else, then the bytes. */
export const stringAsIsOrBytes = b.fn({
  args: {
    data: b.bytes({ from: ["string", "buffer", "blob"], otherwise: "toString", string: "asIs", held: "handle" }),
  },
  returns: b.array(b.u8),
  capability: "heap",
});
/** As `stringAsIsOrBytes`, or nothing. */
export const stringAsIsOrBytesIfAny = b.fn({
  args: { data: b.bytes({ from: ["string", "buffer"], string: "asIs", held: "handle" }).nullable },
  returns: b.array(b.u8).nullable,
  capability: "heap",
});
/** Which of the two are present. */
export const presentUnlessEmptyString = b.fn({
  args: { number: b.f64.emptyStringAsNull, value: b.any.emptyStringAsNull },
  returns: b.array(b.bool),
});
export const asBigInt = b.fn({ args: { value: b.u64.allowBigInt }, returns: b.u64.asBigInt });

export const TestFailure = b.enumeration(["type", "range", "plain", "code", "syscall", "outOfMemory", "value"]);
export const fail = b.fn({ args: { how: TestFailure, value: b.any }, capability: "heap", throws: true });

export const TestCounter = b.class({
  rustPath: "crate::bindgen_test::TestCounter",
  runsUnseenCode: false,
  construct: { args: { start: b.i32.default(0) }, capability: "heap", throws: true },
  internalFields: ["listener"],
  proto: {
    count: { getter: b.i32 },
    label: { getter: b.string.utf8, setter: true },
    tag: { getter: b.any, cache: true, capability: "heap", throws: true },
    sameTag: { getter: b.any, cache: "tag", capability: "heap", throws: true },
    increment: { args: { by: b.i32.default(1) }, returns: b.i32 },
    /** By a number, or by the length of a string, as many times. */
    add: [
      { args: { text: b.string.utf8, times: b.i32.default(1) }, returns: b.i32, rustName: "add_length" },
      { args: { by: b.i32 }, returns: b.i32, rustName: "add_number" },
    ],
    forgetTag: { capability: "heap", passThis: true },
    listen: { args: { listener: b.any }, capability: "heap", passThis: true, requiredArguments: 1 },
    /** Calls the listener, which may call back into this object, then returns the count. */
    notify: { returns: b.i32, capability: "js", throws: true, passThis: true },
    /** `other` may be `this`. */
    plus: { args: { other: b.self }, returns: b.i32 },
  },
  static: {
    starting: { args: { at: b.i32 }, returns: b.self, capability: "heap" },
    alive: { returns: b.usize },
    /** How many are alive. The prototype has a `count` too. */
    count: { getter: b.usize, rustName: "static_count" },
    limit: { getter: b.any, capability: "heap", throws: true },
  },
});

/** `mutates`: `increment` and the setter take `&mut self`. */
export const TestMutates = b.class({
  rustPath: "crate::bindgen_test::TestMutates",
  runsUnseenCode: false,
  construct: { args: { count: b.i32 }, requiredArguments: 1 },
  proto: {
    count: { getter: b.i32 },
    label: { getter: b.string.utf8, setter: true },
    increment: { args: { by: b.i32 }, returns: b.i32, mutates: true },
  },
});

/** A `refCounted` class: Rust can keep a ref after the object is collected. */
export const TestRefCounted = b.class({
  rustPath: "crate::bindgen_test::TestRefCounted",
  refCounted: true,
  finalize: true,
  construct: { args: { value: b.i32.default(0) } },
  internalFields: ["listener"],
  proto: {
    value: { getter: b.i32, setter: true },
    listener: { getter: b.any, setter: { capability: "js" }, passThis: true },
    sameListener: { setter: true, internalField: "listener" },
    readOnlyListener: { internalField: "listener" },
    /** Calls the listener, which may call back into this object, then returns the value. */
    notify: { returns: b.i32, capability: "js", throws: true, passThis: true },
    /** Makes Rust hold a ref until `TestRefCounted.release()`. */
    keep: {},
    "@@dispose": {},
    "@@toPrimitive": { returns: b.i32, name: "", rustName: "get_value" },
    valueOrUndefined: { returns: b.i32, invalidThis: "undefined", rustName: "get_value" },
    /** Returns `this`, or nothing if the value is negative. */
    orUndefined: { returns: b.self.optional, passThis: true },
    orNull: { returns: b.self.nullable, passThis: true, rustName: "or_undefined" },
    isSame: { args: { other: b.self.nullable }, returns: b.bool },
  },
  static: {
    /** The instance kept by `keep()`, as `[value, finalized]`. */
    kept: { returns: b.array(b.i32) },
    release: {},
    alive: { returns: b.usize },
    /** `object.value` read through `from_js`, or `null` if `object` is not an instance. */
    valueFromJS: { args: { object: b.any }, returns: b.i32.nullable },
  },
});

/** Only native code makes one. */
export const TestToken = b.class({
  rustPath: "crate::bindgen_test::TestToken",
  proto: {
    id: { getter: b.u32 },
  },
});
export const makeToken = b.fn({ args: { id: b.u32 }, returns: TestToken, capability: "heap" });

/** `enumerable` / `configurable`, `prototypeBase`, `call`, `writable` and a cached setter. */
export const TestError = b.class({
  rustPath: "crate::bindgen_test::TestError",
  prototypeBase: "Error",
  configurable: true,
  enumerable: false,
  construct: { args: { code: b.i32 } },
  /** An instance whose code is the sum. */
  call: { args: { codes: b.any.variadic }, returns: b.self, capability: "heap" },
  proto: {
    code: { getter: b.i32 },
    nonConfigurableCode: { getter: b.i32, configurable: false },
    enumerableCode: { getter: b.i32, enumerable: true },
    describe: { returns: b.string.utf8 },
    countArguments: { args: { args: b.any.variadic }, returns: b.usize },
    /** Computed once. Assigning replaces it without calling Rust. */
    message: { getter: b.string.utf8, cache: true, writable: true },
    /** Computed once. Assigning a number stores its double. */
    detail: { getter: b.any, setter: true, cache: true, capability: "heap", passThis: true },
  },
  static: {
    /** Process-wide. */
    level: { getter: b.i32, setter: true },
  },
});

/** `writable: false` and `constant`. */
export const TestReadOnly = b.class({
  rustPath: "crate::bindgen_test::TestReadOnly",
  writable: false,
  construct: {},
  proto: {
    answer: { returns: b.i32 },
    "@@dispose": {},
    kind: { constant: 3 },
    hiddenKind: { constant: -1, enumerable: false, configurable: true },
  },
});

/** `calledFromCpp` and `calledFromRust`. `BindgenTest.cpp` has the C++. */
export const TestMemberFunctions = b.class({
  rustPath: "crate::bindgen_test::TestMemberFunctions",
  construct: {},
  internalFields: { note: b.any, promise: b.cell("JSC::JSPromise", "JavaScriptCore/JSPromise.h") },
  proto: {
    twice: { args: { n: b.i32 }, returns: b.i32, calledFromCpp: true },
    run: { args: { n: b.any, fail: b.bool }, returns: b.any, capability: "js", throws: true, passThis: true },
    /** Returns what the field holds afterwards. */
    setNote: { args: { value: b.any }, returns: b.any, capability: "heap", passThis: true },
    fail: { capability: "js", throws: true, passThis: true },
    /** The same promise on every call. */
    promise: { returns: b.any, capability: "js", passThis: true },
  },
  calledFromCpp: {
    callCount: { returns: b.u32 },
    sum: { args: { bytes: b.byteSpan }, returns: b.u32 },
    failInRust: { capability: "heap", throws: true },
  },
  calledFromRust: {
    runInCpp: { args: { n: b.any, fail: b.bool }, returns: b.any, throws: true },
    setNoteInCpp: { args: { value: b.any } },
    noteInCpp: { returns: b.any },
    failInCpp: { throws: true },
    promiseInCpp: { capability: "heap", returns: b.any },
  },
});

const note = {
  estimatedSize: true,
  construct: {
    passStructure: true,
    args: { text: b.any, size: b.usize.default(0) },
    capability: "heap",
    throws: true,
  },
  internalFields: ["text"],
  proto: { text: { internalField: "text" } },
} as const;
/** `passStructure`, `estimatedSize` and `memoryCost`: it reports `size` bytes. */
export const TestNote = b.class({ ...note, rustPath: "crate::bindgen_test::TestNote", memoryCost: true });
export const TestRefCountedNote = b.class({
  ...note,
  rustPath: "crate::bindgen_test::TestRefCountedNote",
  refCounted: true,
});

/** `forBind`: the bound `this` of a function. */
export const TestBoundThis = b.class({
  rustPath: "crate::bindgen_test::TestBoundThis",
  forBind: true,
  construct: { args: { value: b.i32 } },
  proto: {
    value: { getter: b.i32 },
    /** Says how many times it was computed. */
    label: { getter: b.string, cache: true },
    plus: { args: { other: b.i32 }, returns: b.i32 },
  },
});

/** `rustTraits`, `overridesToJS` and `final: false`. */
export const TestNonFinal = b.class({
  rustPath: "crate::bindgen_test::TestNonFinal",
  refCounted: true,
  final: false,
  overridesToJS: true,
  rustTraits: ["crate::bindgen_test::TestNonFinalExt"],
  construct: { args: { value: b.i32 } },
  proto: { value: { getter: b.i32 } },
  static: { doubled: { args: { value: b.i32 }, returns: b.any, capability: "heap" } },
});

/** `token.id` read through `from_js`, or `null` if `token` is not an instance. */
export const tokenIdFromJS = b.fn({ args: { token: b.any }, returns: b.u32.nullable });
/** Whether `from_js_direct` takes the value as a `TestNote` or a `TestRefCountedNote`. */
export const isNoteFromJSDirect = b.fn({ args: { note: b.any }, returns: b.bool });
export const errorConstructor = b.fn({ returns: b.any, capability: "js" });
/** The arguments after the first, as an array. */
export const afterFirst = b.fn({
  args: { first: b.any, rest: b.any.variadic },
  returns: b.any,
  capability: "heap",
  throws: true,
});

/** `[this, the function itself, value]`. */
export const thisAndCallee = b.fn({
  passThis: true,
  passCallee: true,
  args: { value: b.any },
  returns: b.any,
  capability: "heap",
  throws: true,
});
export const doubled = b.fn({ export: "Bun__BindgenTest__doubled", args: { value: b.i32 }, returns: b.i32 });
/** A new function, made in Rust, that runs `doubled`. */
export const makeDoubled = b.fn({ returns: b.any, capability: "js" });
/** What `JSValue::then` gives a reaction as its context, for a static that holds 42. */
export const promisePtrContext = b.value({ returns: b.any, capability: "heap" });
export const readPromisePtr = b.fn({
  args: { context: b.promisePtr("core::sync::atomic::AtomicI32") },
  returns: b.i32,
});
/** A new `NativePromiseContext` cell with a pointer to the same static. */
export const makeNativePromiseContext = b.fn({ returns: b.any, capability: "js" });
export const readNativePromiseContext = b.fn({
  args: { context: b.nativePromiseContext("core::sync::atomic::AtomicI32") },
  returns: b.i32.nullable,
});
export const primes = b.value({ returns: b.array(b.u32) });
export const testNamespace = b.namespace({
  increment: { args: { value: b.i32 }, returns: b.i32 },
  decrement: { args: { value: b.i32 }, returns: b.i32 },
  negate: [
    { args: { value: b.f64 }, returns: b.f64, rustPath: "crate::bindgen_test::negate_number" },
    { args: { value: b.bool }, returns: b.bool, rustPath: "crate::bindgen_test::negate_flag" },
  ],
});

/** Reports its members as Node does. */
export const TestNodeOptions = b.dictionary(
  { size: b.u32.validateInteger(1, 10).optional, flag: { type: b.bool.default(false), expected: ["boolean"] } },
  { reportedAs: "options" },
);
export const TestBareOptions = b.dictionary({ size: b.u32.validateInteger(1, 10).optional }, { reportedAs: "" });
export const nodeOptionsSize = b.fn({ args: { options: TestNodeOptions }, returns: b.u32.optional });
export const bareOptionsSize = b.fn({ args: { options: TestBareOptions }, returns: b.u32.optional });

export const timeValue = b.fn({ args: { time: b.f64.allowDate }, returns: b.f64 });
/** "none" without the argument. `undefined` is converted, to "undefined". */
export const textIfPassed = b.fn({ args: { text: b.string.loose.utf8.ifPassed }, returns: b.string.utf8 });
export const isPassed = b.fn({ args: { first: b.any, second: b.any.ifPassed }, returns: b.bool });
export const isPassedAfterRequired = b.fn({
  args: { first: b.any, second: b.any.ifPassed },
  returns: b.bool,
  requiredArguments: 1,
  rustPath: "crate::bindgen_test::is_passed",
});
export const requiredPair = b.fn({
  args: { a: b.f64, b: b.f64 },
  returns: b.string.utf8,
  requiredArguments: 2,
  rustPath: "crate::bindgen_test::overloaded_two_numbers",
});
export const requiredOverloaded = b.overloads(
  {
    args: { text: b.string.utf8, upper: b.bool },
    returns: b.string.utf8,
    requiredArguments: 1,
    rustPath: "crate::bindgen_test::overloaded_text_upper",
  },
  {
    args: { number: b.f64 },
    returns: b.string.utf8,
    requiredArguments: 1,
    rustPath: "crate::bindgen_test::overloaded_number",
  },
);
/** `[the text's length, the argument]`. */
export const lengthWithValue = b.fn({
  args: { text: b.string.loose.utf8.withValue },
  returns: b.any,
  capability: "heap",
  throws: true,
});
export const counterWithValue = b.fn({ args: { counter: TestCounter.withValue }, returns: b.any, capability: "heap" });
export const keptString = b.fn({ args: { text: b.string.owned }, returns: b.string });

export const TestBracket = b.enumeration({ Plain: "rgb", Square: "[rgb]", Curly: ["{rgb}", "{RGB}"] });
export const bracketEcho = b.fn({ args: { bracket: TestBracket }, returns: TestBracket });

export const TestPoint = b.dictionary({ x: b.f64 });
/** `point` gets objects only, so `text` gets every other value that no alternative before it takes. */
export const TestHandle = b.union({
  missing: b.undefined,
  nothing: b.null,
  callback: b.callable,
  list: b.jsArray,
  point: TestPoint,
  text: b.string.loose.utf8,
});
export const describeHandle = b.fn({ args: { value: TestHandle }, returns: b.string.utf8 });
export const TestObjectOrRest = b.union({ object: b.object, rest: b.any });
export const isObject = b.fn({ args: { value: TestObjectOrRest }, returns: b.bool });
export const objectEcho = b.fn({ args: { value: b.object }, returns: b.object, capability: "heap" });
export const TestAbsence = b.union({ missing: b.undefined, nothing: b.null, number: b.f64 });
export const absenceEcho = b.fn({ args: { value: TestAbsence }, returns: TestAbsence });

export const TestOtherAsNullOptions = b.dictionary(
  { size: b.f64.otherAsNull, callback: b.callable.otherAsNull, strict: b.f64.optional },
  { allowArray: true },
);
/** Which of its arguments, and of the members of `options`, are of their types. */
export const presentArguments = b.fn({
  args: {
    number: b.f64.otherAsNull,
    text: b.string.utf8.otherAsNull,
    callback: b.callable.otherAsNull,
    object: b.object.otherAsNull,
    numbers: b.array(b.f64).otherAsNull,
    counter: TestCounter.otherAsNull,
    options: TestOtherAsNullOptions.otherAsNull,
  },
  returns: b.array(b.string),
});

const withThis = {
  passThis: true,
  passCallee: true,
  export: "Bun__BindgenTest__callbackOrDelay",
  returns: b.string.utf8,
};
/** Told apart by whether the first argument can be called. */
export const callbackOrDelay = b.overloads(
  { ...withThis, args: { callback: b.callable }, rustPath: "crate::bindgen_test::callback_or_delay_callback" },
  { ...withThis, args: { delay: b.f64 }, rustPath: "crate::bindgen_test::callback_or_delay_delay" },
);

/** A promise for the number. One that is not finite, and an argument that is not a number, reject it. */
export const finiteLater = b.fn({
  args: { value: b.f64 },
  returns: b.any,
  capability: "js",
  throws: true,
  rejects: true,
});
export const requiredFiniteLater = b.fn({
  args: { value: b.f64 },
  returns: b.any,
  capability: "js",
  throws: true,
  rejects: true,
  requiredArguments: 1,
  rustPath: "crate::bindgen_test::finite_later",
});

export const integerOrBigInt = b.fn({ args: { value: b.u32.allowBigInt }, returns: b.u32 });
export const looseInteger = b.fn({ args: { value: b.u16.loose }, returns: b.u16 });
export const looseIntegerOrBigInt = b.fn({ args: { value: b.u16.loose.allowBigInt }, returns: b.u16 });
export const looseDoubleOrBigInt = b.fn({ args: { value: b.f64.loose.allowBigInt }, returns: b.f64 });
/** In decimal: a number does not hold every `u64`. */
export const wideIntegerOrBigInt = b.fn({ args: { value: b.u64.allowBigInt }, returns: b.string.utf8 });

/** An alternative for each kind of value. What `bytes` and `blob` refuse, and everything else, goes to `options`. */
export const TestAnything = b.union({
  nothing: b.null,
  flag: b.bool,
  integer: b.i32.allowBigInt,
  text: b.string,
  bytes: b.bufferSource.arrayBuffer,
  blob: b.blob,
  counter: TestCounter,
  token: TestToken,
  list: b.array(b.f64),
  options: TestOptions,
});
export const describeAnything = b.fn({ args: { value: TestAnything }, returns: b.string.utf8 });

/** Told apart by the first argument, then by the second. */
export const overloaded = b.overloads(
  {
    args: { text: b.string.utf8, times: b.u32.default(1) },
    returns: b.string.utf8,
    rustPath: "crate::bindgen_test::overloaded_text_times",
  },
  {
    args: { text: b.string.utf8, upper: b.bool },
    returns: b.string.utf8,
    rustPath: "crate::bindgen_test::overloaded_text_upper",
  },
  { args: { number: b.f64 }, returns: b.string.utf8, rustPath: "crate::bindgen_test::overloaded_number" },
  {
    args: { a: b.f64, b: b.f64 },
    returns: b.string.utf8,
    rustPath: "crate::bindgen_test::overloaded_two_numbers",
  },
  { args: { list: b.array(b.f64) }, returns: b.string.utf8, rustPath: "crate::bindgen_test::overloaded_list" },
  {
    args: { counter: TestCounter },
    returns: b.string.utf8,
    rustPath: "crate::bindgen_test::overloaded_counter",
  },
);

export const TestInner = b.dictionary({
  a: b.bool.default(true),
  b: b.i32.default(7),
  name: b.string.utf8.default("inner"),
});
export const TestChoice = b.union({ none: b.null, flag: b.bool });
/** A string is a color. What `bytes` refuses, and everything else, is kept as it is. */
export const TestColorOrRest = b.union({ color: TestColor, bytes: b.bufferSource, rest: b.any });
export const TestOuter = b.dictionary({
  inner: TestInner.nullable,
  value: b.any,
  choice: TestChoice,
  rest: TestColorOrRest,
});
/** What a default written in the schema gives each member, the nested ones included. */
export const describeDefaults = b.fn({
  args: { options: TestOuter.default({ inner: {} }) },
  returns: b.string.utf8,
  capability: "heap",
});
