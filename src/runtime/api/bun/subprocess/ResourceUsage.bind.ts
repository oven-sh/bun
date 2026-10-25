import * as b from "../../../../codegen/bindgen-lib.ts";

export const ResourceUsageContextSwitches = b.dictionary(
  { voluntary: b.f64, involuntary: b.f64 },
  { nullPrototype: true },
);
export const ResourceUsageCpuTime = b.dictionary(
  { user: b.u64.asBigInt, system: b.u64.asBigInt, total: b.u64.asBigInt },
  { nullPrototype: true },
);
export const ResourceUsageMessages = b.dictionary({ sent: b.f64, received: b.f64 }, { nullPrototype: true });
export const ResourceUsageOps = b.dictionary({ in: b.f64, out: b.f64 }, { nullPrototype: true });

export const ResourceUsage = b.class({
  rustPath: "crate::api::bun_subprocess::ResourceUsage",
  proto: {
    contextSwitches: { getter: ResourceUsageContextSwitches, cache: true },
    cpuTime: { getter: ResourceUsageCpuTime, cache: true },
    maxRSS: { getter: b.f64 },
    messages: { getter: ResourceUsageMessages },
    ops: { getter: ResourceUsageOps, cache: true },
    shmSize: { getter: b.f64 },
    signalCount: { getter: b.f64 },
    swapCount: { getter: b.f64 },
  },
});
