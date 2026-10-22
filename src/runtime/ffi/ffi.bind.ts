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

const method = { returns: b.any, length: 1, capability: "js", throws: true } as const;

// The functions of `Bun.FFI`. One that is given bad options returns the error.
export const viewSource = b.fn({
  ...method,
  export: "Bun__FFI__viewSource",
  args: { symbols: b.any, isCallback: b.bool.loose },
});
export const dlopen = b.fn({ ...method, export: "Bun__FFI__dlopen", args: { name: b.any, symbols: b.any } });
export const callback = b.fn({ ...method, export: "Bun__FFI__callback", args: { options: b.any, callback: b.any } });
export const linkSymbols = b.fn({ ...method, export: "Bun__FFI__linkSymbols", args: { symbols: b.any } });
export const closeCallback = b.fn({ export: "Bun__FFI__closeCallback", args: { callback: b.any } });
export const cfunction = b.fn({ ...method, export: "Bun__FFI__cfunction", args: { options: b.any, name: b.any } });

export const cc = b.fn({ ...method, args: { options: b.any } });
