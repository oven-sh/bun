import * as b from "../../../../codegen/bindgen-lib.ts";

/** An object with a null prototype. */
const record = { getter: b.any, capability: "heap" } as const;

export const ResourceUsage = b.class({
  rustPath: "crate::api::bun_subprocess::ResourceUsage",
  configurable: false,
  proto: {
    contextSwitches: { ...record, cache: true },
    cpuTime: { ...record, cache: true, throws: true },
    maxRSS: { getter: b.f64 },
    messages: record,
    ops: { ...record, cache: true },
    shmSize: { getter: b.f64 },
    signalCount: { getter: b.f64 },
    swapCount: { getter: b.f64 },
  },
});
