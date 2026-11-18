import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::bindgen" });

export const NativeCallback = b.class({
  rustPath: "crate::bindgen::NativeCallback",
  internalFields: ["first", "second"],
  callInstance: { args: { values: b.any.variadic }, returns: b.any, passThis: true, capability: "js", throws: true },
  proto: {},
});
