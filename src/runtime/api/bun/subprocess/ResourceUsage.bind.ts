import * as b from "../../../../codegen/bindgen-lib.ts";

export const ContextSwitches = b.dictionary({ voluntary: b.f64, involuntary: b.f64 }, { nullPrototype: true });
export const CpuTime = b.dictionary(
  { user: b.u64.asBigInt, system: b.u64.asBigInt, total: b.u64.asBigInt },
  { nullPrototype: true },
);
export const Messages = b.dictionary({ sent: b.f64, received: b.f64 }, { nullPrototype: true });
export const Ops = b.dictionary({ in: b.f64, out: b.f64 }, { nullPrototype: true });

export const ResourceUsage = b.class({
  rustPath: "crate::api::bun_subprocess::ResourceUsage",
  configurable: false,
  proto: {
    contextSwitches: { getter: ContextSwitches, cache: true },
    cpuTime: { getter: CpuTime, cache: true },
    maxRSS: { getter: b.f64 },
    messages: { getter: Messages },
    ops: { getter: Ops, cache: true },
    shmSize: { getter: b.f64 },
    signalCount: { getter: b.f64 },
    swapCount: { getter: b.f64 },
  },
});
