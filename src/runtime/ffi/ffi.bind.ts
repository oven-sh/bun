import * as b from "../../codegen/bindgen-lib.ts";
import { FFINumber } from "./FFIObject.bind.ts";

export default b.module({ rustPath: "crate::ffi::FFI" });

export const FFI = b.class({
  rustPath: "crate::ffi::FFI",
  internalFields: ["symbolsValue", "functionsValue"],
  proto: {
    close: { capability: "js", passThis: true },
    symbols: { internalField: "symbolsValue" },
  },
});

const method = { returns: b.opaque, capability: "js", throws: true } as const;

export const FFIArgs = b.union({ list: b.jsArray, other: b.ignored });
/** The number of a type, or its name: anything else is converted to a string. */
export const FFIReturnType = b.union({ number: b.jsNumber, name: b.string.loose });
/** What is wrong with a member is reported before the next one is read. */
export const FFIFunction = b.dictionary(
  {
    args: { type: FFIArgs.ifPassed, own: true },
    threadsafe: b.bool.loose.default(false),
    returns: FFIReturnType.emptyStringAsNull,
    ptr: FFINumber,
  },
  { deferred: true },
);

// The functions of `Bun.FFI`. One that is given bad options returns the error.
export const viewSource = b.fn({
  ...method,
  export: "Bun__FFI__viewSource",
  /** With `isCallback`, `symbols` is one `FFIFunction`. */
  args: { symbols: b.object.otherAsNull, isCallback: b.bool.loose },
});
/** Without a `name` it throws. */
export const dlopen = b.fn({
  ...method,
  export: "Bun__FFI__dlopen",
  args: { name: b.string.loose.utf8.nullable, symbols: b.object.otherAsNull },
});
export const callback = b.fn({
  ...method,
  export: "Bun__FFI__callback",
  args: { options: FFIFunction.otherAsNull, callback: b.callable.otherAsNull },
});
export const linkSymbols = b.fn({
  ...method,
  export: "Bun__FFI__linkSymbols",
  args: { symbols: b.object.otherAsNull },
});
export const closeCallback = b.fn({ export: "Bun__FFI__closeCallback", args: { callback: b.opaque } });
export const cfunction = b.fn({
  ...method,
  export: "Bun__FFI__cfunction",
  args: { options: FFIFunction.otherAsNull, name: b.string.allowStringObject.otherAsNull },
});

/** The error for anything else prints it. */
export const CCSymbols = b.union({ record: b.object, other: b.opaque });
/** A string or an array of strings. The error for anything else prints it. */
export const CCStrings = b.union({ list: b.jsArray, text: b.string.allowStringObject, other: b.opaque });
/** What is wrong with a member is reported before the next one is read. */
export const CCOptions = b.dictionary(
  {
    symbols: { type: CCSymbols, own: true },
    library: { type: CCStrings.optional, own: true },
    flags: CCStrings.emptyStringAsNull,
    define: b.object.otherAsNull,
    include: CCStrings.emptyStringAsNull,
    source: { type: CCStrings.ifPassed, own: true },
  },
  { deferred: true },
);
export const cc = b.fn({ ...method, args: { options: CCOptions.otherAsNull }, returns: FFI, length: 1 });
