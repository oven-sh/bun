// What Event Timing, Element Timing and Largest Contentful Paint report.
const core = require("internal/desktop/dom/core");
const { DOMRectReadOnly } = require("internal/desktop/dom/geometry");

const { getAttr } = core;

type N = $Dom.N;
type Page = $Dom.Page;
type Picture = $Dom.Picture;
type Values = Record<string, any>;

const BUFFER_SIZE = 150;
const BUFFERED_DURATION = 104;
const INTERACTION_STEP = 7;
const MIN_BITS_PER_PIXEL = 0.05;

const enum Content {
  Text,
  Replaced,
  Background,
}

class Dispatched {
  event: any;
  start: number;
  end: number;
  target: N | null;
  interaction = 0;
  duration = -1;
  /** A `pointerdown` does not know yet whether it begins an interaction. */
  isHeld = false;

  constructor(event: any, start: number) {
    this.event = event;
    this.start = start;
    this.end = performance.now();
    this.target = event.target;
  }
}

class Timing {
  page: Page;
  /** Until there is a performance timeline. */
  waiting: Values[] = [];

  counts = new Map<string, number>();
  interactions = 0;
  observesEvents = false;
  dispatched: Dispatched[] = [];
  #firstInteraction = 100 + Math.floor(Math.random() * 9900);
  #hadFirstInput = false;
  #held = new Map<number, Dispatched>();
  #byPointer = new Map<number, number>();
  #byKey = new Map<number, number>();
  #lastKey = 0;

  observesLargest = false;
  hasNewImages = false;
  /** Those that have had an `elementtiming` attribute. */
  #timed: WeakRef<N>[] = [];
  /** They are reported again if they get a new box. */
  #reported = new Set<N>();
  #largest = 0;
  /** The images, and 0 for the text. */
  #painted = new WeakMap<N, Set<number>>();

  constructor(page: Page, eventTypes: Iterable<string>) {
    this.page = page;
    for (const type of eventTypes) this.counts.$set(type, 0);
  }

  #add(values: Values) {
    if (this.page.onTiming !== null) this.page.onTiming(values);
    else if (this.waiting.length < BUFFER_SIZE) this.waiting.push(values);
  }

  /** https://w3c.github.io/paint-timing/#exposed-for-paint-timing */
  #expose(values: Values, name: string, node: N | null): Values {
    const { page } = this;
    const weak = node && new WeakRef(node);
    core.accessor(values, name, () => {
      const it = weak?.deref();
      return it?.scope === page.doc.node && page.host.isActive?.() !== false ? core.wrap(it) : null;
    });
    return values;
  }

  count(type: string) {
    this.counts.$set(type, this.counts.$get(type)! + 1);
  }

  #nextInteraction(): number {
    return this.#firstInteraction + ++this.interactions * INTERACTION_STEP;
  }

  #release(pointer: number, isInteraction: boolean) {
    const held = this.#held.$get(pointer);
    if (held === undefined) return;
    this.#held.$delete(pointer);
    held.isHeld = false;
    if (isInteraction) this.#byPointer.$set(pointer, (held.interaction = this.#nextInteraction()));
    if (held.duration >= 0) this.#finish(held);
  }

  /** https://w3c.github.io/event-timing/#sec-computing-interactionid */
  #interactionOf(it: Dispatched): number {
    const { js, name } = it.event;
    switch (name) {
      case "keydown":
        if (js.isComposing) return 0;
        this.#byKey.$set(js.keyCode, (this.#lastKey = this.#nextInteraction()));
        return this.#lastKey;
      case "keypress":
        return this.#lastKey;
      case "keyup":
        return this.#byKey.$get(js.keyCode) ?? 0;
      case "input":
        return js.isComposing ? this.#nextInteraction() : 0;
      case "pointerdown":
        this.#release(js.pointerId, false);
        this.#byPointer.$delete(js.pointerId);
        this.#held.$set(js.pointerId, it);
        it.isHeld = true;
        return 0;
      case "pointercancel":
        this.#release(js.pointerId, false);
        return 0;
      case "contextmenu":
        for (const pointer of Array.from(this.#held.keys())) this.#release(pointer, true);
        return 0;
      case "pointerup":
        this.#release(js.pointerId, true);
        return this.#byPointer.$get(js.pointerId) ?? 0;
      case "click": {
        if (js.pointerId === -1) return this.#lastKey;
        const interaction = this.#byPointer.$get(js.pointerId) ?? 0;
        this.#byPointer.$delete(js.pointerId);
        return interaction;
      }
    }
    return 0;
  }

  dispatchedEvent(event: any, start: number) {
    const it = new Dispatched(event, start);
    this.count(event.name);
    it.interaction = this.#interactionOf(it);
    this.dispatched.push(it);
  }

  #finish({ event, start, end, target, interaction, duration }: Dispatched) {
    const isFirst = !this.#hadFirstInput && interaction !== 0;
    if (!isFirst && duration < (this.observesEvents ? 16 : BUFFERED_DURATION)) return;
    const values = (entryType: string) => {
      const times = { startTime: event.time, duration, processingStart: start, processingEnd: end };
      const { cancelable } = event.js;
      return this.#expose(
        { name: event.name, entryType, ...times, cancelable, interactionId: interaction },
        "target",
        target,
      );
    };
    this.#hadFirstInput ||= isFirst;
    if (isFirst) this.#add(values("first-input"));
    if (duration >= 16) this.#add(values("event"));
  }

  /** What the events have changed is on the screen. */
  presented() {
    const now = performance.now();
    for (const it of this.dispatched.splice(0)) {
      it.duration = Math.round((now - it.event.time) / 8) * 8;
      if (!it.isHeld) this.#finish(it);
    }
  }

  get watchesLargest(): boolean {
    return this.observesLargest && !this.page.hadInput;
  }

  get watchesContent(): boolean {
    return this.#timed.length > 0 || this.watchesLargest;
  }

  watch(node: N) {
    this.#timed = this.#timed.filter(it => (it.deref() ?? node) !== node);
    this.#timed.push(new WeakRef(node));
  }

  paintedTimedElements() {
    const { doc } = this.page;
    let found: number[] | null = this.#reported.size > 0 || this.hasNewImages ? [] : null;
    for (const it of this.#timed) {
      const node = it.deref();
      if (node === undefined || node.scope !== doc.node || node.id === 0) continue;
      if (!this.hasNewImages && this.#painted.get(node)?.$has(0)) continue;
      const own = doc.engine.contentful(node.id);
      if (own.length > 0) found = found === null ? own : found.concat(own);
    }
    if (found !== null) this.painted(found, performance.now());
  }

  #isNew(node: N, image: number): boolean {
    let painted = this.#painted.get(node);
    if (painted === undefined) this.#painted.set(node, (painted = new Set()));
    return painted.size !== painted.$add(image).size;
  }

  #paintedElement(node: N, picture: Picture | undefined, rect: number[], time: number) {
    const identifier = getAttr(node, "elementtiming");
    if (identifier === null || node.scope !== this.page.doc.node) return;
    const values = {
      name: picture ? "image-paint" : "text-paint",
      entryType: "element",
      ...this.#paintTimes(node, picture, time),
      intersectionRect: new DOMRectReadOnly(...rect),
      identifier,
      naturalWidth: Math.round(picture?.width || 0),
      naturalHeight: Math.round(picture?.height || 0),
    };
    this.#reported.$add(node);
    this.#add(this.#expose(values, "element", node));
  }

  #paintTimes(node: N, picture: Picture | undefined, time: number) {
    const url = picture === undefined ? "" : picture.url.startsWith("data:") ? picture.url.slice(0, 100) : picture.url;
    const loadTime = picture === undefined ? 0 : (node.x?.picture === picture && node.x.loadedAt) || picture.loadedAt;
    const times = { startTime: time, duration: 0, renderTime: time, paintTime: time, presentationTime: null, loadTime };
    return { ...times, id: getAttr(node, "id") ?? "", url };
  }

  /** https://w3c.github.io/largest-contentful-paint/#sec-effective-visual-size */
  #visualSize(picture: Picture | undefined, visible: number, whole: number): number {
    if (picture === undefined) return visible;
    const [, , , , , , , , , , , width, height] = this.page.doc.engine.intersection(1, 1, []);
    if (visible >= width * height) return 0;
    const size = Math.floor(visible * Math.min((picture.pixels() || whole) / whole, 1));
    return (picture.bytes * 8) / size < MIN_BITS_PER_PIXEL ? 0 : size;
  }

  painted(found: number[], time: number) {
    const { page } = this;
    const { doc } = page;
    for (const node of this.#reported) {
      if (node.scope === doc.node && doc.engine.styleBits(node.id, 1)) continue;
      this.#painted.delete(node);
      this.#reported.$delete(node);
    }
    if (this.hasNewImages) {
      for (const { id, x } of core.filterDescendants(doc.node, (it: N) => it.ns === core.SVG && it.name === "image")) {
        const rect = doc.engine.intersection(id, 1, []);
        const xPicture = x.picture;
        if (xPicture?.id && rect[7] * rect[8] > 0)
          found.push(id, Content.Replaced, xPicture.id, ...rect.slice(5, 9), rect[3] * rect[4]);
      }
    }
    this.hasNewImages = false;
    const texts = new Map<N, number[]>();
    let pictures: Map<number, Picture> | undefined;
    let largest: Values | undefined;
    const paint = (node: N, picture: Picture | undefined, rect: number[], whole: number) => {
      if (!this.#isNew(node, picture?.id ?? 0)) return;
      this.#paintedElement(node, picture, rect, time);
      const size = Math.round(this.#visualSize(picture, rect[2] * rect[3], whole));
      if (size <= this.#largest || page.hadInput) return;
      this.#largest = size;
      const values = {
        name: "",
        entryType: "largest-contentful-paint",
        ...this.#paintTimes(node, picture, time),
        size,
      };
      largest = this.#expose(values, "element", node);
    };
    for (let i = 0; i < found.length; i += 8) {
      const painted = doc.nodes[found[i]];
      if (!painted) continue;
      const node = core.outOfControl(painted);
      if (found[i + 1] === Content.Text) {
        if (this.#painted.get(node)?.$has(0)) continue;
        const [left, top] = [Math.floor(found[i + 3]), Math.floor(found[i + 4])];
        const [right, bottom] = [Math.ceil(found[i + 3] + found[i + 5]), Math.ceil(found[i + 4] + found[i + 6])];
        const [l, t, r, b] = texts.$get(node) ?? [left, top, right, bottom];
        texts.$set(node, [Math.min(l, left), Math.min(t, top), Math.max(r, right), Math.max(b, bottom)]);
        continue;
      }
      if (found[i + 1] === Content.Background && (node.name === "html" || node.name === "body")) continue;
      pictures ??= new Map(Array.from(page.pictures.values(), it => [it.id, it]));
      const picture = pictures.$get(found[i + 2]);
      if (picture !== undefined) paint(node, picture, found.slice(i + 3, i + 7), found[i + 7]);
    }
    for (const [node, [left, top, right, bottom]] of texts)
      paint(node, undefined, [left, top, right - left, bottom - top], 0);
    if (largest !== undefined) this.#add(largest);
  }
}

declare global {
  namespace $Dom {
    type Timing = TimingImpl;
  }
}
type TimingImpl = Timing;

export default { Timing };
