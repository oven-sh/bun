// The performance timeline.
const idl = require("internal/desktop/web/idl");
const core = require("internal/desktop/web/dom").core;

const { dictionary, error, expose, internal, need, scope } = idl;
const pageTime = (time: number): number => core.coarse(time - scope.timeOrigin);
const now = (): number => pageTime(performance.now());
/** From milliseconds since the epoch. */
const fromEpoch = (time: number): number => (time ? Math.max(pageTime(time - performance.timeOrigin), 0) : 0);

let valuesOf: (entry: any) => any;

class PerformanceEntry {
  #values: any;

  constructor(key: unknown = undefined, values: object = {}) {
    idl.illegal(key);
    this.#values = values;
  }

  static {
    valuesOf = entry => entry.#values;
  }
}

/** Read-only attributes, and `toJSON()` unless `inJson` is undefined. */
function attributes(constructor: any, names: string, inJson?: string[], values = valuesOf): string[] {
  const own = core.splitTokens(names);
  for (const name of own) idl.attribute(constructor, name, self => values(self)[name]);
  const all = [...(inJson ?? []), ...own];
  if (inJson) {
    Object.assign(constructor.prototype, {
      toJSON() {
        const json = {};
        for (const name of all) if (name !== "element" && name !== "target") json[name] = values(this)[name];
        return json;
      },
    });
  }
  expose(constructor);
  return all;
}

const common = attributes(PerformanceEntry, "name entryType startTime duration", []);

class PerformanceMark extends PerformanceEntry {
  constructor(name: string, options: any = undefined) {
    need(arguments.length, 1);
    name = `${name}`;
    const { detail = null, startTime } = dictionary(options);
    if (scope.isWindow && timingNames.includes(name)) {
      throw error(
        "SyntaxError",
        `'${name}' is part of the PerformanceTiming interface, and cannot be used as a mark name.`,
      );
    }
    const start = startTime === undefined ? now() : idl.finite(startTime);
    if (start < 0) throw new TypeError("A mark cannot have a negative start time.");
    super(internal, {
      name,
      entryType: "mark",
      startTime: start,
      duration: 0,
      detail: idl.native.structuredClone(detail),
    });
  }
}
attributes(PerformanceMark, "detail");

class PerformanceMeasure extends PerformanceEntry {}
attributes(PerformanceMeasure, "detail");

class PerformanceServerTiming {
  #values: object;

  constructor(key: unknown = undefined, values: object = {}) {
    idl.illegal(key);
    this.#values = values;
  }

  static {
    attributes(this, "name duration description", [], self => self.#values);
  }
}

class PerformanceResourceTiming extends PerformanceEntry {}
const ofResources = attributes(
  PerformanceResourceTiming,
  `initiatorType deliveryType nextHopProtocol renderBlockingStatus contentType contentEncoding workerStart
  workerRouterEvaluationStart workerCacheLookupStart workerMatchedSourceType workerFinalSourceType redirectStart
  redirectEnd fetchStart domainLookupStart domainLookupEnd connectStart secureConnectionStart connectEnd requestStart
  responseStart firstInterimResponseStart finalResponseHeadersStart responseEnd transferSize encodedBodySize
  decodedBodySize responseStatus serverTiming`,
  common,
);

class PerformanceNavigationTiming extends PerformanceResourceTiming {}
attributes(
  PerformanceNavigationTiming,
  `unloadEventStart unloadEventEnd domInteractive domContentLoadedEventStart domContentLoadedEventEnd domComplete
  loadEventStart loadEventEnd type redirectCount activationStart criticalCHRestart notRestoredReasons`,
  ofResources,
);

class PerformancePaintTiming extends PerformanceEntry {}
attributes(PerformancePaintTiming, "paintTime presentationTime", common);

class PerformanceEventTiming extends PerformanceEntry {}
attributes(PerformanceEventTiming, "processingStart processingEnd cancelable target interactionId", common);

class PerformanceElementTiming extends PerformanceEntry {}
attributes(
  PerformanceElementTiming,
  "renderTime loadTime intersectionRect identifier naturalWidth naturalHeight id element url paintTime presentationTime",
  common,
);

class LargestContentfulPaint extends PerformanceEntry {}
attributes(LargestContentfulPaint, "loadTime renderTime size id url element paintTime presentationTime", common);

class EventCounts {
  #counts: Map<string, number> = scope.page.timing().counts;

  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  get size() {
    return this.#counts.size;
  }
  get(type: string) {
    need(arguments.length, 1);
    return this.#counts.$get(`${type}`);
  }
  has(type: string) {
    need(arguments.length, 1);
    return this.#counts.$has(`${type}`);
  }
  entries() {
    return this.#counts.entries();
  }
  keys() {
    return this.#counts.keys();
  }
  values() {
    return this.#counts.values();
  }
  forEach(callback: Function, thisArg: unknown = undefined) {
    idl.callable(callback);
    for (const [type, count] of this.#counts) (callback as any).$call(thisArg, count, type, this);
  }
}
expose(EventCounts);
Object.defineProperty(EventCounts.prototype, Symbol.iterator, {
  value: EventCounts.prototype.entries,
  writable: true,
  configurable: true,
});

class VisibilityStateEntry extends PerformanceEntry {}
expose(VisibilityStateEntry);

const timingNames = core.splitTokens(`navigationStart unloadEventStart unloadEventEnd redirectStart redirectEnd
  fetchStart domainLookupStart domainLookupEnd connectStart connectEnd secureConnectionStart requestStart responseStart
  responseEnd domLoading domInteractive domContentLoadedEventStart domContentLoadedEventEnd domComplete loadEventStart
  loadEventEnd`);

const timeOrigin = () => performance.timeOrigin + scope.timeOrigin;

function legacyTiming() {
  const entry = valuesOf(navigationEntry());
  const values = {};
  for (const name of timingNames) values[name] = entry[name] ? Math.floor(timeOrigin() + entry[name]) : 0;
  return Object.assign(values, { navigationStart: Math.floor(timeOrigin()) });
}

class PerformanceTiming {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }
}
attributes(PerformanceTiming, timingNames.join(" "), [], legacyTiming);

class PerformanceNavigation {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }
}
attributes(PerformanceNavigation, "type redirectCount", [], () => {
  const { type, redirectCount } = valuesOf(navigationEntry());
  return { type: ["navigate", "reload", "back_forward"].indexOf(type), redirectCount };
});
expose(PerformanceNavigation, ["TYPE_NAVIGATE", "TYPE_RELOAD", "TYPE_BACK_FORWARD"]);
for (const target of [PerformanceNavigation, PerformanceNavigation.prototype]) {
  Object.defineProperty(target, "TYPE_RESERVED", { value: 255, enumerable: true });
}

function resourceValues(record: any) {
  const { allowsTiming } = record;
  const detailed = (time: number) => (allowsTiming ? fromEpoch(time) : 0);
  const startTime = fromEpoch(record.start);
  const fetchStart = allowsTiming ? fromEpoch(record.fetchStart) : startTime;
  const responseEnd = fromEpoch(record.responseEnd);
  return {
    name: record.name,
    entryType: "resource",
    startTime,
    duration: responseEnd - startTime,
    initiatorType: record.initiatorType,
    deliveryType: allowsTiming && record.fromCache ? "cache" : "",
    nextHopProtocol: allowsTiming ? record.protocol : "",
    renderBlockingStatus: record.blocksRendering ? "blocking" : "non-blocking",
    contentType: record.contentType,
    contentEncoding: record.contentEncoding,
    workerStart: 0,
    workerRouterEvaluationStart: 0,
    workerCacheLookupStart: 0,
    workerMatchedSourceType: "",
    workerFinalSourceType: "",
    redirectStart: detailed(record.redirectStart),
    redirectEnd: detailed(record.redirectEnd),
    fetchStart,
    domainLookupStart: detailed(record.fetchStart),
    domainLookupEnd: detailed(record.fetchStart),
    connectStart: detailed(record.fetchStart),
    secureConnectionStart: record.isSecure ? detailed(record.fetchStart) : 0,
    connectEnd: detailed(record.fetchStart),
    requestStart: detailed(record.requestStart),
    responseStart: detailed(record.responseStart),
    firstInterimResponseStart: 0,
    finalResponseHeadersStart: detailed(record.responseStart),
    responseEnd,
    transferSize: allowsTiming ? record.transferSize : 0,
    encodedBodySize: record.encodedBodySize,
    decodedBodySize: record.decodedBodySize,
    responseStatus: record.status,
    serverTiming: Object.freeze(
      Array.from(
        allowsTiming ? record.serverTiming : [],
        (it: object) => new PerformanceServerTiming(internal, { ...it }),
      ),
    ),
  };
}

let navigation: PerformanceNavigationTiming | undefined;

function navigationEntry() {
  if (navigation) return navigation;
  const record = scope.env.navigationTiming();
  const values: any = { ...resourceValues({ ...record, allowsTiming: true }), entryType: "navigation", startTime: 0 };
  const { milestones } = scope.page;
  if (!record.allowsTiming) values.redirectStart = values.redirectEnd = 0;
  for (const name of [...timingNames.slice(1, 3), ...timingNames.slice(14)]) {
    core.accessor(values, name, () => (milestones[name] ? pageTime(milestones[name]) : 0));
  }
  core.accessor(values, "duration", () => values.loadEventEnd);
  Object.assign(values, {
    initiatorType: "navigation",
    type: record.type,
    redirectCount: record.allowsTiming ? record.redirects : 0,
    activationStart: 0,
    criticalCHRestart: 0,
    notRestoredReasons: null,
  });
  return (navigation = new PerformanceNavigationTiming(internal, values));
}

// ───────────────────────────── the timeline ─────────────────────────────

const inWorkers = ["mark", "measure", "resource"];
const inWindows =
  core.splitTokens(`element event first-input largest-contentful-paint mark measure navigation paint resource
  visibility-state`);
const onlyForObservers = new Set(["element", "event", "largest-contentful-paint"]);
const supportedTypes = Object.freeze(scope.isWindow ? inWindows : inWorkers);
const buffers = new Map<string, PerformanceEntry[]>(supportedTypes.map(type => [type, []]));
const observers = new Set<Registration>();
let dropped = 0;
let resourceLimit = 250;
let overflow: PerformanceEntry[] = [];
let isDeliveryQueued = false;

type Registration = {
  observer: object;
  callback: Function;
  types: Set<string>;
  isForOneType?: boolean;
  entries: PerformanceEntry[];
  tellsDropped: boolean;
  durationThreshold: number;
};

function select(entries: PerformanceEntry[], name?: string, type?: string) {
  return entries
    .filter(entry => {
      const values = valuesOf(entry);
      return (name === undefined || values.name === name) && (type === undefined || values.entryType === type);
    })
    .sort((a, b) => valuesOf(a).startTime - valuesOf(b).startTime);
}

function queueDelivery() {
  if (isDeliveryQueued) return;
  isDeliveryQueued = true;
  idl.queueTask(() => {
    isDeliveryQueued = false;
    for (const it of Array.from(observers)) {
      if (it.entries.length === 0) continue;
      const list = new PerformanceObserverEntryList(internal, it.entries.splice(0));
      const options = it.tellsDropped ? { droppedEntriesCount: it.types.$has("resource") ? dropped : 0 } : {};
      it.tellsDropped = false;
      try {
        (it.callback as any).$call(it.observer, list, it.observer, options);
      } catch (thrown) {
        scope.report(thrown);
      }
    }
  });
}

function notify(entry: PerformanceEntry) {
  const { entryType, duration } = valuesOf(entry);
  for (const it of observers) {
    if (!it.types.$has(entryType) || (entryType === "event" && duration < it.durationThreshold)) continue;
    it.entries.push(entry);
    queueDelivery();
  }
}

function add(entry: PerformanceEntry) {
  buffers.$get(valuesOf(entry).entryType)!.push(entry);
  notify(entry);
}

function addResource(record: object) {
  const entry = new PerformanceResourceTiming(internal, resourceValues(record));
  const buffer = buffers.$get("resource")!;
  notify(entry);
  if (buffer.length < resourceLimit && overflow.length === 0) return void buffer.push(entry);
  if (overflow.push(entry) === 1) idl.queueTask(handleOverflow);
}

function handleOverflow() {
  while (overflow.length > 0) {
    const before = overflow.length;
    if (buffers.$get("resource")!.length >= resourceLimit) idl.fire(instance, "resourcetimingbufferfull");
    const buffer = buffers.$get("resource")!;
    buffer.push(...overflow.splice(0, Math.max(resourceLimit - buffer.length, 0)));
    if (overflow.length < before) continue;
    dropped += overflow.length;
    overflow = [];
  }
}

function buffered(only?: string): PerformanceEntry[] {
  if (only !== undefined) return (!onlyForObservers.$has(only) && buffers.$get(only)) || [];
  return [...buffers].flatMap(([type, entries]) => (onlyForObservers.$has(type) ? [] : entries));
}

class PerformanceObserverEntryList {
  #entries: PerformanceEntry[];

  constructor(key: unknown = undefined, entries: PerformanceEntry[] = []) {
    idl.illegal(key);
    this.#entries = entries;
  }

  getEntries() {
    return select(this.#entries);
  }
  getEntriesByType(type: string) {
    need(arguments.length, 1);
    return select(this.#entries, undefined, `${type}`);
  }
  getEntriesByName(name: string, type: any = undefined) {
    need(arguments.length, 1);
    return select(this.#entries, `${name}`, type === undefined ? type : `${type}`);
  }
}
expose(PerformanceObserverEntryList);

class PerformanceObserver {
  #it: Registration;

  constructor(callback: Function) {
    this.#it = {
      observer: this,
      callback: idl.callable(callback),
      types: new Set(),
      entries: [],
      tellsDropped: false,
      durationThreshold: 104,
    };
  }

  static get supportedEntryTypes() {
    return supportedTypes;
  }

  observe(options: any = undefined) {
    const it = this.#it;
    const { buffered, durationThreshold, entryTypes, type } = dictionary(options);
    const types = entryTypes === undefined ? undefined : idl.sequence(entryTypes).map(idl.string);
    if (!types && type === undefined) throw new TypeError("Either entryTypes or type is required.");
    if (types && type !== undefined) throw new TypeError("entryTypes and type do not go together.");
    if ((it.isForOneType ??= !types) !== !types) {
      throw error("InvalidModificationError", "This observer was first used with the other kind of options.");
    }
    it.tellsDropped = true;
    const known = (types ?? [`${type}`]).filter(name => buffers.$has(name));
    if (known.length === 0) return;
    if (types) it.types.$clear();
    for (const name of known) it.types.$add(name);
    if (durationThreshold !== undefined) it.durationThreshold = Math.max(idl.finite(durationThreshold), 16);
    if (known.includes("event")) scope.page.timing().observesEvents = true;
    if (known.includes("largest-contentful-paint")) {
      Object.assign(scope.page.timing(), { observesLargest: true, hasNewImages: true });
      core.invalidate(scope.page.doc);
    }
    observers.$add(it);
    if (types || !buffered) return;
    const isWanted = (entry: object) => known[0] !== "event" || valuesOf(entry).duration >= it.durationThreshold;
    it.entries.push(...buffers.$get(known[0])!.filter(isWanted));
    queueDelivery();
  }

  disconnect() {
    const it = this.#it;
    observers.$delete(it);
    it.entries.length = 0;
    it.types.$clear();
  }

  takeRecords() {
    return this.#it.entries.splice(0);
  }
}
expose(PerformanceObserver);

function timeOf(mark: unknown): number {
  if (typeof mark === "number") {
    if (idl.finite(mark) < 0) throw new TypeError("A timestamp cannot be negative.");
    return mark;
  }
  const name = `${mark}`;
  if (timingNames.includes(name)) {
    if (!scope.isWindow) throw new TypeError(`'${name}' is only known in a window.`);
    const timing = legacyTiming();
    if (timing[name] === 0) throw error("InvalidAccessError", `'${name}' is empty: the event has not happened yet.`);
    return timing[name] - timing.navigationStart;
  }
  const found = buffers.$get("mark")!.findLast(entry => valuesOf(entry).name === name);
  if (!found) throw error("SyntaxError", `The mark '${name}' does not exist.`);
  return valuesOf(found).startTime;
}

function clear(type: string, name: unknown) {
  buffers.$set(type, name === undefined ? [] : buffers.$get(type)!.filter(entry => valuesOf(entry).name !== `${name}`));
}

class Performance extends idl.EventTarget {
  #timing: PerformanceTiming | undefined;
  #navigation: PerformanceNavigation | undefined;
  #eventCounts: EventCounts | undefined;

  constructor(key: unknown = undefined) {
    idl.illegal(key);
    super();
  }

  get timeOrigin() {
    void this.#timing;
    return timeOrigin();
  }
  get timing() {
    return (this.#timing ??= new PerformanceTiming(internal));
  }
  get navigation() {
    return (this.#navigation ??= new PerformanceNavigation(internal));
  }

  get eventCounts() {
    return (this.#eventCounts ??= new EventCounts(internal));
  }
  get interactionCount() {
    void this.#timing;
    return scope.page.timings?.interactions ?? 0;
  }

  now() {
    void this.#timing;
    return now();
  }

  getEntries() {
    return select(buffered());
  }
  getEntriesByType(type: string) {
    need(arguments.length, 1);
    return select(buffered(`${type}`));
  }
  getEntriesByName(name: string, type: any = undefined) {
    need(arguments.length, 1);
    return select(buffered(type === undefined ? type : `${type}`), `${name}`);
  }

  clearResourceTimings() {
    clear("resource", undefined);
  }
  setResourceTimingBufferSize(size: number) {
    need(arguments.length, 1);
    resourceLimit = size >>> 0;
  }

  mark(name: string, options: any = undefined) {
    need(arguments.length, 1);
    const entry = new PerformanceMark(name, options);
    add(entry);
    return entry;
  }
  clearMarks(name: any = undefined) {
    clear("mark", name);
  }

  measure(name: string, startOrOptions: any = undefined, endMark: any = undefined) {
    need(arguments.length, 1);
    name = `${name}`;
    const isOptions = startOrOptions == null || $isObject(startOrOptions);
    const { detail, duration, end, start } = isOptions ? dictionary(startOrOptions) : { start: `${startOrOptions}` };
    const given = (value: unknown) => value !== undefined;
    if (isOptions && [detail, duration, end, start].some(given)) {
      if (given(endMark) || !(given(start) || given(end)) || [duration, end, start].every(given)) {
        throw new TypeError("These options do not go together.");
      }
    }
    const length = given(duration) ? timeOf(idl.finite(duration)) : 0;
    const endTime = given(endMark)
      ? timeOf(`${endMark}`)
      : given(end)
        ? timeOf(end)
        : given(start) && given(duration)
          ? timeOf(start) + length
          : now();
    const startTime = given(start) ? timeOf(start) : given(duration) && given(end) ? endTime - length : 0;
    const entry = new PerformanceMeasure(internal, {
      name,
      entryType: "measure",
      startTime,
      duration: endTime - startTime,
      detail: idl.native.structuredClone(detail ?? null),
    });
    add(entry);
    return entry;
  }
  clearMeasures(name: any = undefined) {
    clear("measure", name);
  }

  toJSON() {
    const { timeOrigin } = this;
    return scope.isWindow ? { timeOrigin, timing: this.timing, navigation: this.navigation } : { timeOrigin };
  }
}
idl.defineHandlers(Performance.prototype, ["resourcetimingbufferfull"]);
expose(Performance);
if (!scope.isWindow)
  for (const name of ["timing", "navigation", "eventCounts", "interactionCount"]) delete Performance.prototype[name];

const instance = new Performance(internal);

function reached(milestone: string, time: number) {
  const startTime = pageTime(time);
  if (milestone === "loadEventEnd") notify(navigationEntry());
  else if (milestone === "first-paint" || milestone === "first-contentful-paint") {
    const times = { startTime, duration: 0, paintTime: startTime, presentationTime: startTime };
    add(new PerformancePaintTiming(internal, { name: milestone, entryType: "paint", ...times }));
  } else if (milestone === "visible" || milestone === "hidden") {
    add(new VisibilityStateEntry(internal, { name: milestone, entryType: "visibility-state", startTime, duration: 0 }));
  }
}

function addTiming(values: any) {
  const { entryType, duration, intersectionRect } = values;
  for (const name of ["startTime", "processingStart", "processingEnd", "renderTime", "paintTime", "loadTime"]) {
    if (values[name]) values[name] = pageTime(values[name]);
  }
  if (intersectionRect) scope.page.mirror?.adopt(intersectionRect);
  const Entry = { "element": PerformanceElementTiming, "largest-contentful-paint": LargestContentfulPaint }[entryType];
  const entry = new (Entry ?? PerformanceEventTiming)(internal, values);
  if (buffers.$get(entryType)!.length < 150 && (entryType !== "event" || duration >= 104)) add(entry);
  else notify(entry);
}

if (scope.isWindow) {
  const { page } = scope;
  buffers.$get("navigation")!.push(navigationEntry());
  reached(page.isVisible ? "visible" : "hidden", scope.timeOrigin);
  for (const name of ["first-paint", "first-contentful-paint"]) {
    const pageMilestones = page.milestones;
    if (pageMilestones[name]) reached(name, pageMilestones[name]);
  }
  page.onMilestone = reached;
  page.onTiming = addTiming;
  page.timings?.waiting.splice(0).forEach(addTiming);
}
scope.env.watchResourceTimings(addResource);

export default {
  EventCounts,
  LargestContentfulPaint,
  Performance,
  PerformanceElementTiming,
  PerformanceEntry,
  PerformanceEventTiming,
  PerformanceMark,
  PerformanceMeasure,
  PerformanceNavigation,
  PerformanceNavigationTiming,
  PerformanceObserver,
  PerformanceObserverEntryList,
  PerformancePaintTiming,
  PerformanceResourceTiming,
  PerformanceServerTiming,
  PerformanceTiming,
  VisibilityStateEntry,
  performance: instance,
};
