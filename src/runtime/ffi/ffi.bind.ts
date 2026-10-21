import * as b from "../../codegen/bindgen-lib.ts";

export const FFI = b.class({
  rustPath: "crate::ffi::FFI",
  configurable: false,
  internalFields: ["symbolsValue", "functionsValue"],
  proto: {
    close: { passThis: true, capability: "js" },
    symbols: { internalField: "symbolsValue" },
  },
});
