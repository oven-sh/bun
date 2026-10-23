import * as b from "../../codegen/bindgen-lib.ts";

const chainable = { returns: b.self, passThis: true } as const;

export const CronJob = b.class({
  rustPath: "crate::api::cron::CronJob",
  refCounted: true,
  finalize: true,
  internalFields: ["callback", "pendingPromise", "cron"],
  proto: {
    cron: { internalField: "cron" },
    ref: chainable,
    stop: chainable,
    unref: chainable,
    "@@dispose": { ...chainable, rustName: "stop" },
  },
});
