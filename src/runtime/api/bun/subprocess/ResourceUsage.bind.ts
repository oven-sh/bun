import * as b from "../../../../codegen/bindgen-lib.ts";

/** An object without a prototype. */
const counts = { getter: b.any, capability: "js" } as const;

export const ResourceUsage = b.class({
  rustPath: "crate::api::bun_subprocess::ResourceUsage",
  configurable: false,
  proto: {
    contextSwitches: { ...counts, cache: true },
    cpuTime: { ...counts, cache: true, throws: true },
    maxRSS: { getter: b.f64 },
    messages: counts,
    ops: { ...counts, cache: true },
    shmSize: { getter: b.f64 },
    signalCount: { getter: b.f64 },
    swapCount: { getter: b.f64 },
  },
});
