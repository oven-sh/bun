const core = require("internal/desktop/dom/core");
const { callBack } = require("internal/desktop/dom/events");
const { staticList } = require("internal/desktop/dom/node");
const { DOMRectReadOnly, rectAt } = require("internal/desktop/dom/geometry");

const { SVG, domError, expose, flags, hooks, rare, reportError, unwrap, wrap, wrapOrNull } = core;
const { CONNECTED, OBSERVED, WATCHED } = flags;

type N = $Dom.N;
type Doc = $Dom.Doc;
type Page = $Dom.Page;

function requireCallback(callback: unknown, name: string) {
  if (!$isCallable(callback))
    throw new TypeError(`Failed to construct '${name}': parameter 1 is not of type 'Function'.`);
}

/** A class whose getters read `$impl`. */
function record(name: string, fields: string) {
  const ctor = {
    [name]: class {
      constructor() {
        core.illegalConstructor();
      }
    },
  }[name];
  for (const field of core.splitTokens(fields)) {
    const holder = {
      get [field]() {
        const value = (this as any).$impl?.[field];
        if (value === undefined) throw new TypeError("Illegal invocation");
        return value;
      },
    };
    Object.defineProperty(ctor.prototype, field, Object.getOwnPropertyDescriptor(holder, field)!);
  }
  return expose(ctor);
}

function make(ctor: any, data: object) {
  const made = Object.create(ctor.prototype);
  made.$impl = data;
  return made;
}

// ───────────────────────────── mutations ─────────────────────────────

class MutationRecord {
  declare $impl: any;

  constructor() {
    core.illegalConstructor();
  }
  get type() {
    const { type } = this.$impl;
    return type === 1 ? "childList" : type === 2 ? "attributes" : "characterData";
  }
  get target() {
    return wrap(this.$impl.target);
  }
  get addedNodes() {
    return (this.$impl.addedList ??= staticList(this.$impl.added ?? []));
  }
  get removedNodes() {
    return (this.$impl.removedList ??= staticList(this.$impl.removed ?? []));
  }
  get previousSibling() {
    return wrapOrNull(this.$impl.previous);
  }
  get nextSibling() {
    return wrapOrNull(this.$impl.next);
  }
  get attributeName() {
    return this.$impl.name;
  }
  get attributeNamespace() {
    return this.$impl.namespace;
  }
  get oldValue() {
    return this.$impl.oldValue;
  }
}
expose(MutationRecord);

let nextSerial = 0;

class Observer {
  serial = nextSerial++;
  js: object;
  callback: Function;
  records: object[] = [];
  transient: N[] = [];
  nodes: WeakRef<N>[] = [];

  constructor(js: object, callback: Function) {
    this.js = js;
    this.callback = callback;
  }
}
declare global {
  namespace $Dom {
    type MutationObserver = Observer;
  }
}

function unregister(node: N, test: (registered: InstanceType<typeof core.Observation>) => boolean) {
  const rest = (node.rare!.observers = node.rare!.observers!.filter(it => !test(it)));
  if (rest.length === 0) node.flags &= ~OBSERVED;
}

function takeRecords(observer: Observer) {
  const { records } = observer;
  observer.records = [];
  return records.map(it => make(MutationRecord, it));
}

function dropTransient(observer: Observer) {
  for (const node of observer.transient) unregister(node, it => it.observer === observer && it.source !== null);
  observer.transient = [];
}

hooks.notifyObserver = (observer: Observer) => {
  dropTransient(observer);
  if (observer.records.length === 0) return;
  try {
    observer.callback.$call(observer.js, takeRecords(observer), observer.js);
  } catch (error) {
    reportError(null, error);
  }
};

class MutationObserver {
  declare $impl: Observer;

  constructor(callback: unknown) {
    if ($argumentCount() < 1) core.tooFew(1);
    requireCallback(callback, "MutationObserver");
    this.$impl = new Observer(this, callback as Function);
  }
  observe(target: any, init: any = {}) {
    const node = unwrap(target, "observe");
    const observer = this.$impl;
    const { attributeOldValue, attributeFilter, characterDataOldValue } = init;
    const attributes = init.attributes ?? (attributeOldValue !== undefined || attributeFilter !== undefined);
    const characterData = init.characterData ?? characterDataOldValue !== undefined;
    const types = (init.childList ? 1 : 0) | (attributes ? 2 : 0) | (characterData ? 4 : 0);
    if (types === 0) {
      throw new TypeError("The options object must set at least one of 'attributes', 'characterData', or 'childList'.");
    }
    if (((attributeOldValue || attributeFilter) && !attributes) || (characterDataOldValue && !characterData)) {
      throw new TypeError("The options object asks for details of what it does not observe.");
    }
    const oldValues = (attributeOldValue ? 2 : 0) | (characterDataOldValue ? 4 : 0);
    const filter = attributeFilter ? new Set(Array.from(attributeFilter, String)) : null;
    const observation = new core.Observation(observer, types, oldValues, !!init.subtree, filter);
    const list = (rare(node).observers ??= []);
    const existing = list.findIndex(it => it.observer === observer && it.source === null);
    if (existing >= 0) {
      for (const it of observer.transient) unregister(it, other => other.source === list[existing]);
      list[existing] = observation;
    } else {
      list.push(observation);
      observer.nodes.push(new WeakRef(node));
    }
    node.flags |= OBSERVED;
    node.doc.observed |= types;
    node.doc.observedOldValues |= oldValues;
  }
  disconnect() {
    const observer = this.$impl;
    dropTransient(observer);
    for (const reference of observer.nodes) {
      const node = reference.deref();
      if (node !== undefined) unregister(node, it => it.observer === observer);
    }
    observer.nodes = [];
    observer.records = [];
  }
  takeRecords() {
    return takeRecords(this.$impl);
  }
}
expose(MutationObserver);

// ───────────────────────────── sizes ─────────────────────────────

const ResizeObserverSize = record("ResizeObserverSize", "inlineSize blockSize");
const ResizeObserverEntry = record(
  "ResizeObserverEntry",
  "target contentRect borderBoxSize contentBoxSize devicePixelContentBoxSize",
);
const noBox = [0, 0, 0, 0, 0, 0];

/** The page whose frames look after the node. */
function pageOf(node: N): Page {
  return node.doc.page ?? core.realm.page;
}

const idIn = (page: Page, node: N) => (node.flags & CONNECTED && node.doc === page.doc ? node.id : 0);

class Observation {
  observer: BoxObserver;
  node: N;
  /** Which box, for a size. */
  box: number;
  width = -1;
  height = -1;
  /** How many thresholds it has crossed, for an intersection. */
  crossed = -1;
  reportedAt = -Infinity;
  serial = nextSerial++;
  /** -1 after `unobserve`. */
  generation: number;

  constructor(observer: BoxObserver, node: N, box: number) {
    this.generation = observer.generation;
    this.observer = observer;
    this.node = node;
    this.box = box;
  }
  isCurrent(): boolean {
    return this.generation === this.observer.generation;
  }
  forget() {
    const extra = this.node.rare!;
    extra.watchers = extra.watchers!.filter(it => it.isCurrent());
    this.observer.active.$delete(this);
  }
  /** There is nothing to report until the node is connected again, and nothing here has to keep it alive. */
  isDormant(): boolean {
    return !(this.node.flags & CONNECTED) && (this.crossed === 0 || (this.width === 0 && this.height === 0));
  }
}

class BoxObserver {
  js: object;
  page: Page = core.realm.page;
  callback: Function;
  /** The observations of all the observers of its kind. */
  active: Set<Observation>;
  serial = nextSerial++;
  /** Changes with `disconnect`. */
  generation = 0;
  entries: object[] = [];
  root: N | null = null;
  rootMargin = "";
  scrollMargin = "";
  margins: number[] = [];
  thresholds: readonly number[] = [];
  delay = 0;

  constructor(js: object, callback: Function, active: Set<Observation>) {
    this.js = js;
    this.callback = callback;
    this.active = active;
  }
  find(node: N): Observation | undefined {
    return node.rare?.watchers?.find(it => it.observer === this && it.isCurrent());
  }
  observe(node: N, box: number) {
    const page = pageOf(node);
    const observation = new Observation(this, node, box);
    this.unobserve(node);
    const extra = rare(node);
    extra.watchers = extra.watchers === null ? [] : extra.watchers.filter(it => it.isCurrent());
    extra.watchers.push(observation);
    this.active.$add(observation);
    node.flags |= WATCHED;
    this.changed();
    page.hasNewObservations = true;
    core.invalidate(page.doc);
  }
  unobserve(node: N) {
    const found = this.find(node);
    if (found === undefined) return;
    found.generation = -1;
    found.forget();
    this.changed();
  }
  disconnect() {
    this.generation++;
    for (const it of this.active) if (it.observer === this) it.forget();
    this.entries = [];
    this.changed();
  }
  changed() {
    if (this.active === sizeObservations) sizesVersion++;
    else intersectionsVersion++;
  }
}

const sizeObservations = new Set<Observation>();
const intersectionObservations = new Set<Observation>();
let sizesVersion = 0;
let intersectionsVersion = 0;
const SIZE_RECORD = 4;
const INTERSECTION_RECORD = 5;

function observationsIn(page: Page, active: Set<Observation>): Observation[] {
  const list: Observation[] = [];
  for (const it of active) {
    if (!it.isCurrent() || it.isDormant()) active.$delete(it);
    else if (pageOf(it.node) === page) list.push(it);
  }
  return list.sort((a, b) => a.observer.serial - b.observer.serial || a.serial - b.serial);
}

hooks.watchedMirrored = node => {
  const extra = node.rare;
  if (!extra?.watchers) return;
  extra.watchers = extra.watchers.filter(it => it.isCurrent());
  for (const it of extra.watchers) it.observer.active.$add(it);
};

/** The observations of a page, and the same as numbers for the engine. */
class Watched {
  sizesVersion = -1;
  intersectionsVersion = -1;
  sizes: Observation[] = [];
  sizeRecords = new Float64Array(0);
  intersections: Observation[] = [];
  intersectionRecords = new Float64Array(0);
  settings = new Float64Array(0);
  /** What SVG draws changes without a layout. */
  hasSvgTargets = false;
  /** The indexes of those whose root is the viewport of a document above. */
  acrossFrames: number[] = [];

  updateSizes(page: Page) {
    const version = sizesVersion + core.watchedVersion();
    if (this.sizesVersion === version) return;
    this.sizesVersion = version;
    const sizes = (this.sizes = observationsIn(page, sizeObservations));
    const sizeRecords = (this.sizeRecords = new Float64Array(sizes.length * SIZE_RECORD));
    for (let i = 0, at = 0; i < sizes.length; i++) {
      const it = sizes[i];
      sizeRecords[at++] = idIn(page, it.node);
      sizeRecords[at++] = it.box;
      sizeRecords[at++] = it.width;
      sizeRecords[at++] = it.height;
    }
  }

  updateIntersections(page: Page) {
    const version = intersectionsVersion + core.watchedVersion();
    if (this.intersectionsVersion === version) return;
    this.intersectionsVersion = version;
    const intersections = (this.intersections = observationsIn(page, intersectionObservations));
    const records = (this.intersectionRecords = new Float64Array(intersections.length * INTERSECTION_RECORD));
    const settings: number[] = [];
    for (let i = 0, at = 0, first = 0; i < intersections.length; i++) {
      const { node, observer, crossed } = intersections[i];
      if (i === 0 || observer !== intersections[i - 1].observer) {
        first = settings.length;
        settings.push(...observer.margins, ...observer.thresholds);
      }
      records[at++] = idIn(page, node);
      records[at++] = observer.root === null ? 1 : idIn(page, observer.root);
      records[at++] = crossed;
      records[at++] = first;
      records[at++] = observer.thresholds.length;
    }
    this.settings = new Float64Array(settings);
    this.hasSvgTargets = intersections.some(it => it.node.ns === core.SVG);
    const had = this.acrossFrames.length > 0;
    this.acrossFrames =
      page.container === null ? [] : intersections.flatMap((it, i) => (it.observer.root === null ? [i] : []));
    if (!had && this.acrossFrames.length > 0) for (const above of page.above()) above.isObservedFromFrames = true;
  }
}
declare global {
  namespace $Dom {
    type Watcher = WatcherImpl;
  }
}
type WatcherImpl = Observation;

class ResizeObserver {
  declare $impl: BoxObserver;

  constructor(callback: Function) {
    if ($argumentCount() < 1) core.tooFew(1);
    requireCallback(callback, "ResizeObserver");
    this.$impl = new BoxObserver(this, callback, sizeObservations);
  }
  observe(target: any, options: { box?: string } | undefined = undefined) {
    const node = unwrap(target, "observe");
    const name = options?.box;
    const box = name === "border-box" ? 1 : name === "device-pixel-content-box" ? 2 : 0;
    if (this.$impl.find(node)?.box !== box) this.$impl.observe(node, box);
  }
  unobserve(target: any) {
    this.$impl.unobserve(unwrap(target, "unobserve"));
  }
  disconnect() {
    this.$impl.disconnect();
  }
}
expose(ResizeObserver);

function depthOf(node: N | null) {
  let depth = 1;
  while ((node = core.flatParent(node!)) !== null) depth++;
  return depth;
}

function boxSize(inlineSize: number, blockSize: number) {
  return Object.freeze([make(ResizeObserverSize, { inlineSize, blockSize })]);
}

/** The depth of the shallowest node that was reported. Infinity if none was, and -1 if some had to be skipped. */
/** In width, among those that were visible and still are. */
function hasResizedBoxes(page: Page): boolean {
  const { watched } = page;
  const { engine } = page.doc;
  watched.updateSizes(page);
  const changed = watched.sizes.length === 0 ? null : engine.changedSizes(watched.sizeRecords, page.scale);
  if (changed == null) return false;
  for (const index of changed) {
    const { node, width, box } = watched.sizes[index];
    const id = idIn(page, node);
    if (width <= 0 || id === 0 || box === 2) continue;
    const now = engine.boxSizes(id)[box === 0 ? 2 : 4];
    if (now > 0 && Math.abs(now - width) > 1) return true;
  }
  return false;
}

function deliverResizes(page: Page, below: number): number {
  const { watched, scale } = page;
  const { engine } = page.doc;
  watched.updateSizes(page);
  const changed = watched.sizes.length === 0 ? null : engine.changedSizes(watched.sizeRecords, scale);
  if (changed == null) return Infinity;
  const observers: BoxObserver[] = [];
  let shallowest = Infinity;
  for (const index of changed) {
    const observation = watched.sizes[index];
    const { node, box, observer } = observation;
    const depth = depthOf(node);
    if (depth <= below) continue;
    const id = idIn(page, node);
    let [x, y, width, height, borderWidth, borderHeight, isVertical] = id === 0 ? noBox : engine.boxSizes(id);
    const contentRect = new DOMRectReadOnly(x, y, width, height);
    if (isVertical) [width, height, borderWidth, borderHeight] = [height, width, borderHeight, borderWidth];
    const [deviceWidth, deviceHeight] = [Math.round(width * scale), Math.round(height * scale)];
    shallowest = Math.min(shallowest, depth);
    observation.width = box === 0 ? width : box === 1 ? borderWidth : deviceWidth;
    observation.height = box === 0 ? height : box === 1 ? borderHeight : deviceHeight;
    watched.sizeRecords[index * SIZE_RECORD + 2] = observation.width;
    watched.sizeRecords[index * SIZE_RECORD + 3] = observation.height;
    if (observation.isDormant()) sizesVersion++;
    if (observer.entries.length === 0) observers.push(observer);
    observer.entries.push(
      make(ResizeObserverEntry, {
        target: wrap(node),
        contentRect,
        borderBoxSize: boxSize(borderWidth, borderHeight),
        contentBoxSize: boxSize(width, height),
        devicePixelContentBoxSize: boxSize(deviceWidth, deviceHeight),
      }),
    );
  }
  for (const observer of observers) deliver(page, observer);
  return observers.length === 0 ? -1 : shallowest;
}

function deliver(page: Page, observer: BoxObserver) {
  const { entries } = observer;
  observer.entries = [];
  if (entries.length > 0 && !page.isDisposed) callBack(page, observer.callback, observer.js, entries, observer.js);
}

// ───────────────────────────── intersections ─────────────────────────────

const IntersectionObserverEntry = record(
  "IntersectionObserverEntry",
  "time rootBounds boundingClientRect intersectionRect isIntersecting isVisible intersectionRatio target",
);

const pixelsIn = { px: 1, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, in: 96, pt: 96 / 72, pc: 16 };
const marginPart = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|cm|mm|q|in|pt|pc|%)$/;

function parseMargin(text: string): { text: string; values: number[] } {
  const matches = core.splitTokens(core.asciiLower(text)).map(part => marginPart.exec(part === "0" ? "0px" : part));
  if (matches.length > 4 || matches.includes(null)) {
    throw domError("SyntaxError", "The margin must be specified in absolute length units or percent.");
  }
  const parts = matches.map(([all, number, unit]: any) =>
    unit === "%" ? all : Math.floor(number * pixelsIn[unit]) + "px",
  );
  const [top = "0px", right = top, bottom = top, left = right] = parts;
  const sides = [top, right, bottom, left];
  const values = sides.flatMap(side => (side.endsWith("%") ? [0, parseFloat(side)] : [parseFloat(side), 0]));
  return { text: sides.join(" "), values };
}

class IntersectionObserver {
  declare $impl: BoxObserver;

  constructor(callback: Function, init: any = {}) {
    if ($argumentCount() < 1) core.tooFew(1);
    requireCallback(callback, "IntersectionObserver");
    const thresholds = [init.threshold ?? 0].flat().map(Number);
    if (!thresholds.every(Number.isFinite)) throw new TypeError("The provided double value is non-finite.");
    if (thresholds.some(it => !(it >= 0 && it <= 1))) throw new RangeError("Threshold values must be between 0 and 1");
    const rootMargin = parseMargin(String(init.rootMargin ?? "0px"));
    const scrollMargin = parseMargin(String(init.scrollMargin ?? "0px"));
    const observer = (this.$impl = new BoxObserver(this, callback, intersectionObservations));
    observer.root = init.root == null ? null : unwrap(init.root, "IntersectionObserver");
    if (observer.root !== null) observer.root.flags |= WATCHED;
    observer.delay = init.delay | 0;
    observer.rootMargin = rootMargin.text;
    observer.scrollMargin = scrollMargin.text;
    observer.margins = [...rootMargin.values, ...scrollMargin.values];
    observer.thresholds = Object.freeze(thresholds.length > 0 ? thresholds.sort((a, b) => a - b) : [0]);
  }
  get root() {
    return wrapOrNull(this.$impl.root);
  }
  get rootMargin() {
    return this.$impl.rootMargin;
  }
  get scrollMargin() {
    return this.$impl.scrollMargin;
  }
  get thresholds() {
    return this.$impl.thresholds;
  }
  get delay() {
    return this.$impl.delay;
  }
  get trackVisibility() {
    this.$impl.delay;
    return false;
  }
  observe(target: any) {
    const node = unwrap(target, "observe");
    if (this.$impl.find(node) === undefined) this.$impl.observe(node, 0);
  }
  unobserve(target: any) {
    this.$impl.unobserve(unwrap(target, "unobserve"));
  }
  disconnect() {
    this.$impl.disconnect();
  }
  takeRecords() {
    return this.$impl.entries.splice(0);
  }
}
expose(IntersectionObserver);

const nowhere = Array(13).fill(0);
const noMargins = Array(16).fill(0);

/** Clips what the engine has found in the viewport of `page` by the frames around it. */
function intersectAcrossFrames(page: Page, id: number, { margins }: BoxObserver): number[] {
  const isSameOrigin = page.topOfSameOrigin() !== null;
  const inner = isSameOrigin ? [...noMargins.slice(8), ...margins.slice(8)] : noMargins;
  const result = page.doc.engine.intersection(id, 1, inner);
  let [left, top, right, bottom] = [result[5], result[6], result[5] + result[7], result[6] + result[8]];
  let [x, y, scale] = [0, 0, 1];
  for (let at = page; at.container !== null && result[0] !== 0; at = at.container.page) {
    const { node, page: outer } = at.container;
    const frame = hooks.frameOf(node);
    scale *= frame.scale;
    x = x * frame.scale + frame.box[0];
    y = y * frame.scale + frame.box[1];
    const shown = core
      .sync(outer.doc)
      .intersection(node.id, 1, outer.container === null && isSameOrigin ? margins : inner);
    left = Math.max(left, (shown[5] - x) / scale);
    top = Math.max(top, (shown[6] - y) / scale);
    right = Math.min(right, (shown[5] + shown[7] - x) / scale);
    bottom = Math.min(bottom, (shown[6] + shown[8] - y) / scale);
    if (shown[0] === 0 || left > right || top > bottom) result[0] = 0;
  }
  result.splice(5, 4, ...(result[0] === 0 ? [0, 0, 0, 0] : [left, top, right - left, bottom - top]));
  const outermost = page.above().at(-1)!;
  result.splice(9, 4, ...core.sync(outermost.doc).intersection(1, 1, margins).slice(9));
  return result;
}

function updateIntersections(page: Page, time: number) {
  const { watched } = page;
  const { engine } = page.doc;
  watched.updateIntersections(page);
  const records = watched.intersectionRecords;
  let changed: Iterable<number> | null =
    records.length === 0 ? null : engine.changedIntersections(records, watched.settings);
  if (watched.acrossFrames.length > 0) changed = new Set([...(changed ?? []), ...watched.acrossFrames]);
  if (changed == null) return;
  for (const index of changed) {
    const observation = watched.intersections[index];
    const { observer } = observation;
    const { thresholds } = observer;
    if (observation.node.doc.page === null) continue;
    if (time - observation.reportedAt < observer.delay) {
      page.needsAnotherFrame = page.hasNewObservations = true;
      continue;
    }
    const [id, root] = [records[index * INTERSECTION_RECORD], records[index * INTERSECTION_RECORD + 1]];
    const isAcross = observer.root === null && page.container !== null;
    let result = nowhere;
    if (id !== 0 && root !== 0 && engine.styleBits(id, 1)) {
      result = isAcross ? intersectAcrossFrames(page, id, observer) : engine.intersection(id, root, observer.margins);
    }
    const isIntersecting = result[0] !== 0;
    const area = result[3] * result[4];
    const ratio = area > 0 ? Math.min(1, (result[7] * result[8]) / area) : +isIntersecting;
    let crossed = 0;
    while (isIntersecting && crossed < thresholds.length && thresholds[crossed] <= ratio) crossed++;
    if (crossed === observation.crossed) continue;
    records[index * INTERSECTION_RECORD + 2] = observation.crossed = crossed;
    observation.reportedAt = time;
    if (observation.isDormant()) intersectionsVersion++;
    if (observer.entries.length === 0) page.queueTask(() => deliver(page, observer));
    observer.entries.push(
      make(IntersectionObserverEntry, {
        time: core.coarse(time - observer.page.timeOrigin),
        rootBounds: isAcross && page.topOfSameOrigin() === null ? null : rectAt(result, 9),
        boundingClientRect: rectAt(result, 1),
        intersectionRect: rectAt(result, 5),
        isIntersecting: crossed > 0,
        isVisible: false,
        intersectionRatio: ratio,
        target: wrap(observation.node),
      }),
    );
  }
}

export default { MutationObserver, Watched, deliverResizes, hasResizedBoxes, make, record, updateIntersections };
