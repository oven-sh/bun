import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::crash_handler_jsc" });

export const FeatureData = b.dictionary({
  features: b.array(b.string),
  version: b.string,
  is_canary: b.bool,
  revision: b.string,
  generated_at: b.u64,
});

export const crashHandler = b.namespace({
  getMachOImageZeroOffset: { returns: b.f64.optional, length: 1 },
  getFeatureData: { returns: FeatureData, length: 1 },
  segfault: { length: 1 },
  segfaultInDll: { length: 1 },
  panic: { length: 1 },
  rootError: { length: 1 },
  outOfMemory: { length: 1 },
  operatorNew: { args: { nothrow: b.bool.loose.default(false) }, returns: b.bool.optional, length: 1 },
  abort: { length: 1 },
  fastfail: { length: 1 },
  trap: { length: 1 },
  raiseIgnoringPanicHandler: { length: 1 },
});
