import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEvent, DesktopEventInit, WindowTarget } from "../events/events.bind.ts";

export default b.module({ rustPath: "crate::api::scheduler", feature: "Desktop", membersInTable: false, isCold: true });

const path = "crate::api::scheduler";
const heap = { capability: "heap" } as const;
const js = { capability: "js", throws: true } as const;
const webidl = { webidl: true } as const;
const exposed = ["Window", "Worker"] as const;
const signal = b.instanceOf("AbortSignal", "WebCore::JSAbortSignal", "JSAbortSignal.h");
const promise = { returns: b.any.returning("Promise"), rejects: true, ...js } as const;

export const TaskPriority = b.enumeration(["user-blocking", "user-visible", "background"]);

export const PriorityOrSignal = b.union({ signal, priority: TaskPriority }, webidl);
export const TaskSignalAnyInit = b.dictionary({ priority: PriorityOrSignal.optional }, webidl);
export const TaskSignal = b.interface("TaskSignal", {
  exposed,
  prototypeBase: "AbortSignal",
  rustPath: `${path}::TaskSignal`,
  // `source` is what it has its priority from, `schedulers` those that may have tasks that follow it.
  internalFields: { signal: b.any, source: b.ref("TaskSignal"), schedulers: b.any },
  static: {
    any: {
      args: { signals: b.sequence(signal), init: TaskSignalAnyInit.default({}) },
      returns: b.any.returning("object"),
      ...js,
    },
  },
  proto: {
    priority: { getter: TaskPriority },
    onprioritychange: { getter: b.any, setter: true, ...heap },
  },
});

export const TaskControllerInit = b.dictionary({ priority: TaskPriority.default("user-visible") }, webidl);
export const TaskController = b.interface("TaskController", {
  exposed,
  prototypeBase: "AbortController",
  internalFields: { signal: TaskSignal },
  construct: { args: { init: TaskControllerInit.default({}) }, passNewTarget: true, ...js },
  proto: { setPriority: { args: { priority: TaskPriority }, ...js } },
});

export const TaskPriorityChangeEventInit = b.dictionary(
  { previousPriority: TaskPriority },
  { webidl: true, extends: DesktopEventInit },
);
export const TaskPriorityChangeEvent = b.interface("TaskPriorityChangeEvent", {
  exposed,
  extends: DesktopEvent,
  rustPath: `${path}::TaskPriorityChangeEvent`,
  construct: { args: { type: b.DOMString.atom.as("crate::api::core::Atom"), init: TaskPriorityChangeEventInit } },
  proto: { previousPriority: { getter: TaskPriority } },
});

export const ScheduledTask = b.interface("ScheduledTask", {
  noInterfaceObject: true,
  rustPath: `${path}::ScheduledTask`,
  internalFields: { callback: b.any, promise: b.any, signal: b.any, source: TaskSignal, next: b.ref("ScheduledTask") },
});

export const SchedulerPostTaskOptions = b.dictionary(
  { delay: b.u64.enforceRange().default(0), priority: TaskPriority.optional, signal: signal.optional },
  webidl,
);
export const Scheduler = b.interface("Scheduler", {
  exposed,
  rustPath: `${path}::Scheduler`,
  // `ends` has the first and the last task of each queue. `current` is the task whose microtasks are running.
  internalFields: { scope: WindowTarget, ends: b.any, current: ScheduledTask },
  proto: {
    postTask: { args: { callback: b.callable, options: SchedulerPostTaskOptions.default({}) }, ...promise },
    yield: { rustName: "yield_to_others", ...promise },
  },
});
