import * as b from "../../codegen/bindgen-lib.ts";

const chained = { returns: b.self, passThis: true, capability: "heap" } as const;

export const CronJob = b.class({
  rustPath: "crate::api::cron::CronJob",
  refCounted: true,
  finalize: true,
  configurable: false,
  internalFields: ["callback", "pendingPromise", "cron"],
  proto: {
    cron: { internalField: "cron" },
    ref: { ...chained, rustName: "do_ref" },
    stop: chained,
    unref: { ...chained, rustName: "do_unref" },
    "@@dispose": chained,
  },
});
