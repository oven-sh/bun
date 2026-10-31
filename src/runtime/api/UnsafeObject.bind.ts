import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::unsafe_object" });

export const unsafe = b.namespace({
  gcAggressionLevel: {
    args: { level: b.f64.loose.nullable },
    returns: b.i32,
    readsStateBeforeConversions: true,
  },
  arrayBufferToString: {
    args: { buffer: b.any },
    returns: b.any,
    capability: "js",
    throws: true,
  },
  mimallocDump: {},
  memoryFootprint: { returns: b.usize.optional },
  setJITPolicy: {
    args: { scale: b.f64 },
    capability: "js",
    throws: true,
  },
});
