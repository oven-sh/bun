// https://w3c.github.io/performance-timeline/
import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget } from "../core/core.bind.ts";
import { Handler } from "../events/attributes.bind.ts";

export default b.module({
  rustPath: "crate::api::performance",
  feature: "Desktop",
  isCold: true,
  membersInTable: false,
});

const path = "crate::api::performance";
const heap = { capability: "heap" } as const;
const js = { capability: "js", throws: true } as const;
const everywhere = ["Window", "Worker"] as const;
const exposed = ["Window"] as const;
const string = b.DOMString.impl.as("crate::api::core::DomString");
const text = { getter: b.string.utf8 } as const;
const time = { getter: b.f64 } as const;
const each = (names: string, member: (name: string) => any) =>
  Object.fromEntries(names.split(/\s+/).map(it => [it, member(it)]));

export const DomPerformanceEntry = b.interface("DomPerformanceEntry", {
  name: "PerformanceEntry",
  rustPath: `${path}::Entry`,
  size: 32,
  exposed: everywhere,
  defaultToJSON: true,
  proto: { name: { getter: string }, entryType: text, startTime: time, duration: time },
});
const entry = (name: string, options: object) =>
  b.interface("Dom" + name, { name, extends: DomPerformanceEntry, exposed, ...options });

export const PerformanceMarkOptions = b.dictionary(
  { detail: b.any.omittable, startTime: b.double.optional },
  { webidl: true },
);
const detail = {
  internalFields: ["detail"],
  exposed: everywhere,
  proto: { detail: { getter: b.any, field: "detail" } },
};
export const DomPerformanceMark = entry("PerformanceMark", {
  ...detail,
  construct: {
    args: { markName: string, markOptions: PerformanceMarkOptions.default({}) },
    passStructure: true,
    ...js,
  },
});
export const DomPerformanceMeasure = entry("PerformanceMeasure", detail);

export const DomPerformanceServerTiming = b.interface("DomPerformanceServerTiming", {
  name: "PerformanceServerTiming",
  rustPath: `${path}::Metric`,
  exposed: everywhere,
  defaultToJSON: true,
  proto: { name: text, duration: time, description: text },
});

export const ResourceNumber = b.family("ResourceNumber", { on: DomPerformanceEntry, ...time });
export const ResourceText = b.family("ResourceText", { on: DomPerformanceEntry, ...text });
export const DomPerformanceResourceTiming = entry("PerformanceResourceTiming", {
  rustPath: `${path}::Resource`,
  exposed: everywhere,
  defaultToJSON: true,
  proto: {
    ...each("initiatorType deliveryType nextHopProtocol renderBlockingStatus contentType contentEncoding", () =>
      ResourceText.of(),
    ),
    ...each("workerStart workerRouterEvaluationStart workerCacheLookupStart", () => ResourceNumber.of()),
    ...each("workerMatchedSourceType workerFinalSourceType", () => ResourceText.of()),
    ...each(
      `redirectStart redirectEnd fetchStart domainLookupStart domainLookupEnd connectStart secureConnectionStart
      connectEnd requestStart responseStart firstInterimResponseStart finalResponseHeadersStart responseEnd transferSize
      encodedBodySize decodedBodySize responseStatus`,
      () => ResourceNumber.of(),
    ),
    serverTiming: { getter: b.frozenArray(DomPerformanceServerTiming), cache: true, ...heap },
  },
});

export const Milestone = b.family("Milestone", { on: DomPerformanceEntry, ...time, ...heap });
export const DomPerformanceNavigationTiming = entry("PerformanceNavigationTiming", {
  extends: DomPerformanceResourceTiming,
  defaultToJSON: true,
  proto: {
    ...each(
      `unloadEventStart unloadEventEnd domInteractive domContentLoadedEventStart domContentLoadedEventEnd domComplete
      loadEventStart loadEventEnd`,
      () => Milestone.of(),
    ),
    type: { ...text, ...heap },
    redirectCount: { getter: b.u16 },
    activationStart: ResourceNumber.of(),
    criticalCHRestart: ResourceNumber.of(),
    notRestoredReasons: { getter: b.object.nullable },
  },
});

export const DomPerformancePaintTiming = entry("PerformancePaintTiming", {
  defaultToJSON: true,
  proto: { paintTime: time, presentationTime: time },
});
export const DomVisibilityStateEntry = entry("VisibilityStateEntry", {});

export const DomPerformanceEventTiming = entry("PerformanceEventTiming", {
  rustPath: `${path}::EventEntry`,
  defaultToJSON: true,
  proto: {
    processingStart: time,
    processingEnd: time,
    cancelable: { getter: b.bool },
    target: { getter: b.ref("Node").nullable, ...heap },
    interactionId: { getter: b.u32 },
  },
});

export const Painted = b.interface("Painted", {
  extends: DomPerformanceEntry,
  abstract: true,
  rustPath: `${path}::Painted`,
  internalFields: ["rect"],
});
export const PaintedMembers = b.mixin("PaintedMembers", {
  on: Painted,
  proto: {
    renderTime: time,
    loadTime: time,
    id: { getter: string },
    element: { getter: b.ref("Node").nullable, ...heap },
    url: { getter: string },
    paintTime: { ...time, rustName: "render_time" },
    presentationTime: { getter: b.f64.nullable },
  },
});
const painted = { extends: Painted, includes: [PaintedMembers], defaultToJSON: true };
export const DomPerformanceElementTiming = entry("PerformanceElementTiming", {
  ...painted,
  proto: {
    intersectionRect: { getter: b.object, field: "rect" },
    identifier: { getter: string },
    naturalWidth: { getter: b.u32 },
    naturalHeight: { getter: b.u32 },
  },
});
export const DomLargestContentfulPaint = entry("LargestContentfulPaint", {
  ...painted,
  proto: { size: { getter: b.u32 } },
});

export const EventCounts = b.interface("EventCounts", {
  exposed,
  maplike: { key: b.DOMString, value: b.any, readonly: true },
});

export const DomPerformanceTiming = b.interface("DomPerformanceTiming", {
  name: "PerformanceTiming",
  exposed,
  defaultToJSON: true,
});
export const LegacyTime = b.family("LegacyTime", { on: DomPerformanceTiming, ...time, ...heap });
export const LegacyTimes = b.partial("LegacyTimes", {
  on: DomPerformanceTiming,
  proto: each(
    `navigationStart unloadEventStart unloadEventEnd redirectStart redirectEnd fetchStart domainLookupStart
    domainLookupEnd connectStart connectEnd secureConnectionStart requestStart responseStart responseEnd domLoading
    domInteractive domContentLoadedEventStart domContentLoadedEventEnd domComplete loadEventStart loadEventEnd`,
    () => LegacyTime.of(),
  ),
});

export const PerformanceNavigation = b.interface("PerformanceNavigation", {
  exposed,
  defaultToJSON: true,
  constants: { TYPE_NAVIGATE: 0, TYPE_RELOAD: 1, TYPE_BACK_FORWARD: 2, TYPE_RESERVED: 255 },
  proto: { type: { getter: b.u16, ...heap }, redirectCount: { getter: b.u16, ...heap } },
});

const entries = { returns: b.sequence(DomPerformanceEntry), ...heap } as const;
const getEntries = {
  getEntries: entries,
  getEntriesByType: { args: { type: string }, ...entries },
  getEntriesByName: { args: { name: string, type: string.optional }, ...entries },
};

export const DomPerformanceObserverEntryList = b.interface("DomPerformanceObserverEntryList", {
  name: "PerformanceObserverEntryList",
  exposed: everywhere,
  internalFields: ["entries"],
  proto: getEntries,
});

export const PerformanceObserverInit = b.dictionary(
  {
    buffered: b.bool.loose.default(false),
    durationThreshold: b.double.optional,
    entryTypes: b.sequence(b.DOMString.impl).optional,
    type: string.optional,
  },
  { webidl: true },
);
export const DomPerformanceObserver = b.interface("DomPerformanceObserver", {
  name: "PerformanceObserver",
  rustPath: `${path}::Observer`,
  exposed: everywhere,
  internalFields: ["callback", "entries"],
  construct: { args: { callback: b.callable }, passStructure: true, ...heap },
  static: { supportedEntryTypes: { getter: b.any, ...heap } },
  proto: {
    observe: { args: { options: PerformanceObserverInit.default({}) }, ...js },
    disconnect: heap,
    takeRecords: entries,
  },
});

export const MarkOrTime = b.union({ mark: b.DOMString.impl, time: b.double }, { webidl: true });
export const PerformanceMeasureOptions = b.dictionary(
  { detail: b.any.omittable, duration: b.double.optional, end: MarkOrTime.optional, start: MarkOrTime.optional },
  { webidl: true },
);
export const MarkOrOptions = b.union({ mark: b.DOMString.impl, options: PerformanceMeasureOptions }, { webidl: true });

export const DomPerformance = b.interface("DomPerformance", {
  name: "Performance",
  extends: DesktopEventTarget,
  rustPath: `${path}::Performance`,
  exposed: everywhere,
  /** `buffers` has a list for each type of entry, and `targets` the nodes of the events that wait for a frame. */
  internalFields: ["buffers", "overflow", "observers", "supportedTypes", "targets"],
  proto: {
    now: { returns: b.f64 },
    timeOrigin: time,
    toJSON: { returns: b.object, rustName: "to_json", ...js },
    timing: { getter: DomPerformanceTiming, cache: true, exposed, ...heap },
    navigation: { getter: PerformanceNavigation, cache: true, exposed, ...heap },
    eventCounts: { getter: EventCounts, cache: true, exposed, ...heap },
    interactionCount: { getter: b.u32, exposed },
    ...getEntries,
    clearResourceTimings: heap,
    setResourceTimingBufferSize: { args: { maxSize: b.u32.wrap } },
    onresourcetimingbufferfull: Handler.of(),
    mark: {
      args: { markName: string, markOptions: PerformanceMarkOptions.default({}) },
      returns: DomPerformanceMark,
      ...js,
    },
    clearMarks: { args: { markName: string.optional }, ...heap },
    measure: {
      args: { measureName: string, startOrMeasureOptions: MarkOrOptions.default({}), endMark: string.optional },
      returns: DomPerformanceMeasure,
      ...js,
    },
    clearMeasures: { args: { measureName: string.optional }, ...heap },
  },
});
