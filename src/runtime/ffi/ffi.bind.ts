import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::ffi::FFI" });

export const FFI = b.class({
  rustPath: "crate::ffi::FFI",
  internalFields: ["symbolsValue", "functionsValue"],
  proto: {
    close: { capability: "js", passThis: true },
    symbols: { internalField: "symbolsValue" },
  },
});

const method = { returns: b.any, capability: "js", throws: true } as const;

// The functions of `Bun.FFI`. One that is given bad options returns the error.
export const viewSource = b.fn({
  ...method,
  export: "Bun__FFI__viewSource",
  args: { symbols: b.any, isCallback: b.bool.loose },
});
/** Without a `name` it throws. */
export const dlopen = b.fn({
  ...method,
  export: "Bun__FFI__dlopen",
  args: { name: b.string.loose.utf8.nullable, symbols: b.any },
});
export const callback = b.fn({ ...method, export: "Bun__FFI__callback", args: { options: b.any, callback: b.any } });
export const linkSymbols = b.fn({ ...method, export: "Bun__FFI__linkSymbols", args: { symbols: b.any } });
export const closeCallback = b.fn({ export: "Bun__FFI__closeCallback", args: { callback: b.any } });
export const cfunction = b.fn({
  ...method,
  export: "Bun__FFI__cfunction",
  args: { options: b.any, name: b.string.allowStringObject.otherAsNull },
});

export const cc = b.fn({ ...method, args: { options: b.any }, returns: FFI });
