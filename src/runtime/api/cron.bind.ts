import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::cron" });

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

const reaction = { args: { value: b.any, context: b.any }, capability: "js" } as const;

/** The reactions to the promise a job's callback returned. */
export const onPromiseResolve = b.fn({ ...reaction, export: "Bun__CronJob__onPromiseResolve" });
export const onPromiseReject = b.fn({ ...reaction, export: "Bun__CronJob__onPromiseReject" });

/** `Bun.cron(schedule, handler, options?)` or `Bun.cron(path, schedule, title)`. */
export const cron = b.fn({
  export: "Bun__Cron__cron",
  args: { pathOrSchedule: b.any, scheduleOrHandler: b.any, titleOrOptions: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
});

export const remove = b.fn({
  export: "Bun__Cron__remove",
  args: { title: b.string },
  expected: { title: "Bun.cron.remove() expects a string title" },
  returns: b.any,
  capability: "js",
  throws: true,
});

export const parse = b.fn({
  export: "Bun__Cron__parse",
  args: { expression: b.string, from: b.any, options: b.any },
  expected: { expression: "Bun.cron.parse() expects a string cron expression as the first argument" },
  returns: b.f64.asDate.nullable,
  capability: "js",
  throws: true,
  length: 1,
});
