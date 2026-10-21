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
  construct: { args: { start: b.i32.default(0) }, capability: "heap", throws: true },
  internalFields: ["listener"],
  proto: {
    count: { getter: b.i32 },
    label: { getter: b.string.utf8, setter: true },
    tag: { getter: b.any, capability: "heap", cache: true, throws: true },
    sameTag: { getter: b.any, capability: "heap", cache: "tag", throws: true },
    increment: { args: { by: b.i32.default(1) }, returns: b.i32, mutates: true },
    /** By a number, or by the length of a string, as many times. */
    add: [
      { rustName: "add_length", args: { text: b.string.utf8, times: b.i32.default(1) }, returns: b.i32, mutates: true },
      { rustName: "add_number", args: { by: b.i32 }, returns: b.i32, mutates: true },
    ],
    forgetTag: { capability: "heap", passThis: true },
    listen: { args: { listener: b.any }, capability: "heap", passThis: true },
    /** Calls the listener, which may call back into this object, then returns the count. */
    notify: { returns: b.i32, capability: "js", throws: true },
    /** `other` may be `this`. */
    plus: { args: { other: b.self }, returns: b.i32, capability: "js" },
  },
  static: {
    starting: { args: { at: b.i32 }, returns: b.self, capability: "heap" },
    alive: { returns: b.usize },
    /** How many are alive. The prototype has a `count` too. */
    count: { getter: b.usize, rustName: "static_count" },
    limit: { getter: b.any, capability: "heap", throws: true },
  },
});

/** Keeps a `TestCounter` alive from Rust. */
export const TestHolder = b.class({
  rustPath: "crate::bindgen_test::TestHolder",
  construct: { args: { counter: TestCounter }, capability: "heap" },
  proto: {
    counter: { getter: TestCounter, capability: "heap" },
    incrementCounter: { returns: b.i32, capability: "js" },
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
    sameListener: { internalField: "listener", setter: true },
    readOnlyListener: { internalField: "listener" },
    /** Calls the listener, which may call back into this object, then returns the value. */
    notify: { returns: b.i32, passThis: true, capability: "js", throws: true },
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
export const describeAnything = b.fn({ args: { value: TestAnything }, returns: b.string.utf8, capability: "js" });

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
  {
    args: { a: b.f64, b: b.f64 },
    returns: b.string.utf8,
    rustPath: "crate::bindgen_test::overloaded_two_numbers",
  },
  { args: { number: b.f64 }, returns: b.string.utf8, rustPath: "crate::bindgen_test::overloaded_number" },
  { args: { list: b.array(b.f64) }, returns: b.string.utf8, rustPath: "crate::bindgen_test::overloaded_list" },
  {
    args: { counter: TestCounter },
    returns: b.string.utf8,
    capability: "js",
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
  counter: TestCounter.nullable,
});
/** What a default written in the schema gives each member, the nested ones included. */
export const describeDefaults = b.fn({
  args: { options: TestOuter.default({ inner: {} }) },
  returns: b.string.utf8,
  capability: "heap",
});
