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

export const utf8Echo = b.fn({ args: { text: b.string.utf8 }, returns: b.string.utf8 });
export const utf8EchoLoose = b.fn({ args: { text: b.string.utf8.loose }, returns: b.string.utf8 });
export const utf8Optional = b.fn({ args: { text: b.string.utf8.nullable }, returns: b.string.utf8.nullable });
export const stringEcho = b.fn({ args: { text: b.string }, returns: b.string });

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

export const sumBytes = b.fn({ args: { bytes: b.bufferSource.bytes }, returns: b.u32 });
/** The sum before `callback` runs, then after it, or `null` once the buffer is detached. */
export const sumBeforeAndAfterCallback = b.fn({
  args: { buffer: b.bufferSource, callback: b.any },
  returns: b.array(b.u32.nullable),
  capability: "js",
  throws: true,
});

/** The original value if the converted text is not empty. */
export const withValueEcho = b.fn({
  args: { text: b.string.utf8.loose.withValue },
  returns: b.any,
  capability: "heap",
});

export const TestFailure = b.enumeration(["type", "range", "plain", "syscall", "value"]);
export const fail = b.fn({ args: { how: TestFailure, value: b.any }, capability: "heap", throws: true });

export const TestCounter = b.class({
  rustPath: "crate::bindgen_test::TestCounter",
  construct: { args: { start: b.i32.default(0) }, capability: "heap", throws: true },
  internalFields: ["listener"],
  proto: {
    count: { getter: b.i32 },
    label: { getter: b.string.utf8, setter: true },
    tag: { getter: b.any, capability: "heap", cache: true },
    increment: { args: { by: b.i32.default(1) }, returns: b.i32, mutates: true },
    listen: { args: { listener: b.any }, capability: "heap", passThis: true },
    /** Calls the listener, which may call back into this object, then returns the count. */
    notify: { returns: b.i32, capability: "js", throws: true },
    /** `other` may be `this`. */
    plus: { args: { other: b.self }, returns: b.i32, capability: "js" },
  },
  static: {
    starting: { args: { at: b.i32 }, returns: b.self, capability: "heap" },
    alive: { returns: b.usize },
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
