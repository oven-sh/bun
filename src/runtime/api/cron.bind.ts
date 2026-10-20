import * as b from "../../codegen/bindgen-lib.ts";

const chainable = { returns: b.self, passThis: true } as const;

export const CronJob = b.class({
  rustPath: "crate::api::cron::CronJob",
  refCounted: true,
  finalize: true,
  configurable: false,
  internalFields: ["callback", "pendingPromise", "cron"],
  proto: {
    cron: { internalField: "cron" },
    ref: { ...chainable, rustName: "do_ref" },
    stop: chainable,
    unref: { ...chainable, rustName: "do_unref" },
    "@@dispose": { ...chainable, rustName: "stop" },
  },
});
