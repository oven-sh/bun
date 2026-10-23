import * as b from "../../codegen/bindgen-lib.ts";

export const FFI = b.class({
  rustPath: "crate::ffi::FFI",
  internalFields: ["symbolsValue", "functionsValue"],
  proto: {
    close: { capability: "js", passThis: true },
    symbols: { internalField: "symbolsValue" },
  },
});
