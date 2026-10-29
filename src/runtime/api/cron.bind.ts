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

const reaction = {
  args: { value: b.any, context: b.nativePromiseContext("crate::api::cron::CronJob") },
  capability: "js",
} as const;

/** The reactions to the promise a job's callback returned. */
export const onPromiseResolve = b.fn({ ...reaction, export: "Bun__CronJob__onPromiseResolve" });
export const onPromiseReject = b.fn({ ...reaction, export: "Bun__CronJob__onPromiseReject" });

export const CronOptions = b.dictionary(
  { tz: b.string.utf8.nullable },
  { allowArray: true, reportedAs: "Bun.cron: options" },
);

const signature = { export: "Bun__Cron__cron", feature: "Cron", capability: "js", throws: true } as const;

export const cron = b.overloads(
  /** An OS-level job. */
  {
    ...signature,
    args: { path: b.string.utf8, schedule: b.string.utf8, title: b.string.utf8 },
    expected: {
      path: "Bun.cron() expects a string path as the first argument",
      schedule: "Bun.cron() expects a string schedule as the second argument",
      title: "Bun.cron() expects a string title as the third argument",
    },
    returns: b.any,
    rustPath: "crate::api::cron::register_os_job",
  },
  /** An in-process job, whose `cron` is the `schedule` it was given. */
  {
    ...signature,
    args: { schedule: b.string.utf8.withValue, handler: b.callable, options: CronOptions.nullable },
    expected: {
      schedule: "Bun.cron() expects a string cron expression",
      handler: "Bun.cron(schedule, handler) expects a function handler as the second argument",
    },
    returns: CronJob,
    rustPath: "crate::api::cron::CronJob::register",
  },
);

export const remove = b.fn({
  export: "Bun__Cron__remove",
  feature: "Cron",
  args: { title: b.string.utf8 },
  expected: { title: "Bun.cron.remove() expects a string title" },
  returns: b.any,
  capability: "js",
  throws: true,
});

export const parse = b.fn({
  export: "Bun__Cron__parse",
  feature: "Cron",
  args: { expression: b.string.utf8, relativeDate: b.f64.allowDate.nullable, options: CronOptions.nullable },
  expected: {
    expression: "Bun.cron.parse() expects a string cron expression as the first argument",
    relativeDate: "Bun.cron.parse() expects the second argument to be a Date or number (ms since epoch)",
  },
  returns: b.f64.asDate.nullable,
  capability: "js",
  throws: true,
});
