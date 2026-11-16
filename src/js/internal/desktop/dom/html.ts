const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const nodes = require("internal/desktop/dom/node");
const cssom = require("internal/desktop/dom/cssom");
const { prepareCustomElement } = require("internal/desktop/dom/custom");
const { DOMRect, rectAt, rectList } = require("internal/desktop/dom/geometry");

const { ELEMENT, DOCUMENT, HTML, Kind, kinds, hooks, flags, accessor, asciiLower, domError, expose } = core;
const { getAttr, hasAttr, isHtml, rare, react, removeAttr, same, setAttr, splitTokens, sync, unwrap } = core;
const { wrap, wrapOrNull } = core;
const { Element, collectionOf, defineTokenList } = nodes;
const { CONNECTED } = flags;

type N = $Dom.N;
type Doc = $Dom.Doc;
type Page = $Dom.Page;

// ───────────────────────────── reflection ─────────────────────────────

function parseInteger(text: string | null): number {
  const match = text === null ? null : /^[\t\n\f\r ]*([+-]?\d+)/.exec(text);
  return match === null ? NaN : +match[1] + 0;
}

function reflect(
  ctor: any,
  property: string,
  attribute: string,
  read: (value: string | null, node: N) => any,
  write?: any,
) {
  accessor(
    ctor.prototype,
    property,
    function (this: any) {
      return read(getAttr(this.$impl, attribute), this.$impl);
    },
    function (this: any, value) {
      const text = write === undefined ? `${value}` : write(value);
      if (text === null) removeAttr(this.$impl, attribute);
      else setAttr(this.$impl, attribute, text);
      react();
    },
  );
}

const renamed = {
  __proto__: null,
  acceptCharset: "accept-charset",
  ch: "char",
  chOff: "charoff",
  defaultChecked: "checked",
  defaultMuted: "muted",
  defaultSelected: "selected",
  defaultValue: "value",
  encoding: "enctype",
  htmlFor: "for",
  httpEquiv: "http-equiv",
};
const referrerPolicies = `no-referrer no-referrer-when-downgrade same-origin origin strict-origin origin-when-cross-origin
  strict-origin-when-cross-origin unsafe-url`;
const encodings = "application/x-www-form-urlencoded multipart/form-data text/plain";
/** The keywords, the value for a missing attribute, and the one for an invalid attribute. */
const enumerations: Record<string, [string, string | null, (string | null)?]> = {
  crossOrigin: ["anonymous use-credentials", null, "anonymous"],
  decoding: ["sync async auto", "auto"],
  dir: ["ltr rtl auto", ""],
  encoding: [encodings, "application/x-www-form-urlencoded"],
  enctype: [encodings, "application/x-www-form-urlencoded"],
  enterKeyHint: ["enter done go next previous search send", ""],
  fetchPriority: ["high low auto", "auto"],
  formEnctype: [encodings, "", "application/x-www-form-urlencoded"],
  formMethod: ["get post dialog", "", "get"],
  inputMode: ["none text tel url email numeric decimal search", ""],
  kind: ["subtitles captions descriptions chapters metadata", "subtitles", "metadata"],
  autocomplete: ["on off", "on"],
  as: [
    `fetch audio document embed font image manifest object report script sharedworker style track video worker xslt`,
    "",
  ],
  loading: ["lazy eager", "eager"],
  method: ["get post dialog", "get"],
  popoverTargetAction: ["toggle show hide", "toggle"],
  preload: ["none metadata auto", "metadata"],
  referrerPolicy: [referrerPolicies, ""],
  scope: ["row col rowgroup colgroup", ""],
  shadowRootMode: ["open closed", ""],
};

const spanLimits = { __proto__: null, span: 1000, colSpan: 1000, rowSpan: 65534 } as Record<string, any>;
const nullIsEmpty = /^(?:bgColor|cellPadding|cellSpacing|margin\w+|text|[av]?[lL]ink)$/;
const asString = (value: string | null) => value ?? "";
const emptyIfNull = (value: unknown) => (value === null ? "" : `${value}`);
const asBoolean = (value: string | null) => value !== null;
const asUrl = (value: string | null, node: N) => (value === null ? "" : (core.resolveUrl(node.doc, value) ?? value));

/**
 * `name` is a string or an enumeration, `name?` a boolean, `name@` a URL, `name=1` an integer with its default, and
 * `name+1` one that is not negative, `name>1` a positive one, `name~` a string even if there is such an enumeration,
 * and `name!` one that null empties.
 */
function reflectAll(ctor: any, list: string) {
  for (const entry of splitTokens(list)) {
    const [, property, type, rest] = /^(\w+)([?@=+>~!]?)(.*)$/.exec(entry)!;
    const attribute = renamed[property] ?? property.toLowerCase();
    if (type === "?") reflect(ctor, property, attribute, asBoolean, value => (value ? "" : null));
    else if (type === "@") reflect(ctor, property, attribute, asUrl, value => `${value}`.toWellFormed());
    else if (type === "!") reflect(ctor, property, attribute, asString, emptyIfNull);
    else if (type === "~") reflect(ctor, property, attribute, asString);
    else if (type !== "") {
      const min = type === "+" ? 0 : type === ">" ? 1 : -(2 ** 31);
      const max = spanLimits[property];
      const read = (value: string | null) => {
        const number = parseInteger(value);
        if (number > max) return max;
        return number >= min && number < 2 ** 31 ? number : +rest;
      };
      reflect(ctor, property, attribute, read, value => {
        if (type === "+" && rest === "-1" && value < 0) throw domError("IndexSizeError", "The value is negative.");
        if (property === "size" && type === ">" && value >>> 0 === 0)
          throw domError("IndexSizeError", "The value is 0.");
        return String((value | 0) < (max ? 0 : min) ? +rest : value | 0);
      });
    } else if (Object.hasOwn(enumerations, property)) {
      const [keywords, missing, invalid = missing] = enumerations[property];
      const known = splitTokens(keywords);
      const read = (value: string | null) =>
        value === null ? missing : known.includes((value = asciiLower(value))) ? value : invalid;
      reflect(ctor, property, attribute, read, value => (value == null && missing === null ? null : `${value}`));
    } else if (nullIsEmpty.test(property)) reflect(ctor, property, attribute, asString, emptyIfNull);
    else reflect(ctor, property, attribute, asString);
  }
}

// ───────────────────────────── geometry ─────────────────────────────

const zeros = [0, 0, 0, 0, 0, 0];

/** Null if the node is not in a window. */
function layout(node: N) {
  return node.flags & CONNECTED && node.id !== 0 && node.doc.page !== null ? sync(node.doc) : null;
}

/** The root element stands for the viewport. */
function scrollerId(node: N): number {
  if (node.doc.quirks) {
    if (node.parent === node.doc.node) return 0;
    if (node === core.bodyOf(node.doc) && !isScrollableBody(node)) return 1;
  }
  return node.parent === node.doc.node
    ? 1
    : node.name === "input" && node.x?.editor && layout(node)
      ? node.x.editor.id
      : node.id;
}

const isScrollableBody = (body: N) => styleBits(body, 1 | (1 << 19)) > 1;

function clientSize(node: N, which: number): number {
  const isViewport = node.doc.quirks ? node === core.bodyOf(node.doc) : node.parent === node.doc.node;
  return metric(node, isViewport ? 1 : scrollerId(node) || node.id, which);
}

function metric(node: N, id: number, which: number): number {
  const engine = layout(node);
  return engine === null ? 0 : engine.metric(id, which);
}
const scrollerMetric = (node: N, which: number) => metric(node, scrollerId(node), which);

const behaviors = { __proto__: null, auto: 0, instant: 1, smooth: 2 };
const AWAITED = 8;

function member(options: any, name: string, values: any, missing: number): number {
  const given = options[name];
  const value = given === undefined ? missing : values[`${given}`];
  if (value === undefined)
    throw new TypeError(`The provided value '${given}' is not a valid enum value for '${name}'.`);
  return value;
}

/** Of what was last asked for with `AWAITED`. */
function scrollResult(doc: Doc): Promise<object> {
  const request = doc.engine.metric(1, 13);
  if (request === 0) return Promise.$resolve({ interrupted: false });
  const { promise, resolve } = Promise.withResolvers<object>();
  doc.page!.scrollRequests.$set(request, resolve);
  return promise;
}

function scrollFromScript(target: N | Page, count: number, first: any, second: any, isRelative: boolean) {
  try {
    const { doc } = target;
    const node = target === doc.page ? null : (target as N);
    if (count === 1 && first != null && !$isObject(first))
      throw new TypeError("The provided value is not of type 'ScrollToOptions'.");
    const behavior = count < 2 && first != null ? member(first, "behavior", behaviors, 0) : 0;
    if (node !== null && !layout(node)) return Promise.$resolve({ interrupted: false });
    if (count < 2) scroll(doc, node ? scrollerId(node) : 1, first?.left, first?.top, isRelative, behavior | AWAITED);
    else scroll(doc, node ? scrollerId(node) : 1, +first || 0, +second || 0, isRelative, AWAITED);
    return scrollResult(doc);
  } catch (error) {
    return Promise.$reject(error);
  }
}

const finite = (value: any) => (value === undefined ? NaN : Number.isFinite((value = +value)) ? value : 0);

function scroll(doc: Doc, id: number, left: any, top: any, isRelative: boolean, behavior = 0) {
  let x = finite(left);
  let y = finite(top);
  const engine = sync(doc);
  if (isRelative) {
    const from = engine.scrollMetrics(id);
    x += from[0];
    y += from[1];
  }
  engine.scrollTo(id, x, y, behavior | (isRelative ? 4 : 0));
  core.invalidate(doc);
}

const alignments = { __proto__: null, start: 0, center: 1, end: 2, nearest: 3 };
const containers = { __proto__: null, all: 0, nearest: 1 };

function scrollIntoView(node: N, block: number, inline: number, behavior = 0, onlyNearest = false) {
  layout(node)?.scrollIntoView(node.id, block, inline, behavior, onlyNearest);
  core.invalidate(node.doc);
}

const TRANSPARENT = 128;

function styleBits(node: N, wanted = 0xffff & ~TRANSPARENT): number {
  return layout(node)?.styleBits(node.id, wanted) ?? 0;
}

function boundingRect(node: N): number[] {
  return layout(node)?.boundingRect(node.id) ?? zeros;
}

core.mixin(
  {
    getBoundingClientRect(this: any) {
      const node: N = this.$impl;
      const engine = layout(node);
      if (engine === null) return new DOMRect();
      return new DOMRect(engine.measure(node.id), engine.measured(1), engine.measured(2), engine.measured(3));
    },
    getClientRects(this: any) {
      return rectList(layout(this.$impl)?.clientRects(this.$impl.id) ?? []);
    },
    get scrollLeft() {
      return scrollerMetric((this as any).$impl, 4);
    },
    set scrollLeft(left) {
      const node = (this as any).$impl;
      if (layout(node)) scroll(node.doc, scrollerId(node), +left || 0, undefined, false);
    },
    get scrollTop() {
      return scrollerMetric((this as any).$impl, 5);
    },
    set scrollTop(top) {
      const node = (this as any).$impl;
      if (layout(node)) scroll(node.doc, scrollerId(node), undefined, +top || 0, false);
    },
    scroll(this: any, first: any = undefined, second?: any) {
      return scrollFromScript(this?.$impl, $argumentCount(), first, second, false);
    },
    scrollTo(this: any, first: any = undefined, second?: any) {
      return scrollFromScript(this?.$impl, $argumentCount(), first, second, false);
    },
    scrollBy(this: any, first: any = undefined, second?: any) {
      return scrollFromScript(this?.$impl, $argumentCount(), first, second, true);
    },
    scrollIntoView(this: any, argument: any = undefined) {
      const options = $isObject(argument) ? argument : { block: argument == null || argument ? "start" : "end" };
      try {
        const node: N = this.$impl;
        const behavior = member(options, "behavior", behaviors, 0);
        const block = member(options, "block", alignments, 0);
        const container = member(options, "container", containers, 0);
        const inline = member(options, "inline", alignments, 3);
        if (!layout(node)) return Promise.$resolve({ interrupted: false });
        scrollIntoView(node, block, inline, behavior | AWAITED, container === 1);
        return scrollResult(node.doc);
      } catch (error) {
        return Promise.$reject(error);
      }
    },
    scrollIntoViewIfNeeded(this: any, center = true) {
      scrollIntoView(this.$impl, center ? 4 : 3, center ? 4 : 3);
    },
    checkVisibility(this: any, options: any = {}) {
      const bits = styleBits(this.$impl, 0xffff);
      return (
        (bits & (1 | 16384)) === 1 &&
        !((options.checkOpacity || options.opacityProperty) && bits & 128) &&
        !((options.checkVisibilityCSS || options.visibilityProperty) && !(bits & 2)) &&
        !(options.contentVisibilityAuto && bits & 256)
      );
    },
    computedStyleMap(this: any) {
      core.brand(this);
      return cssom.styleMap(cssom.computedStyle(this.$impl, ""), false);
    },
    get scrollWidth() {
      return metric((this as any).$impl, scrollerId((this as any).$impl) || 1, 6);
    },
    get scrollHeight() {
      return metric((this as any).$impl, scrollerId((this as any).$impl) || 1, 7);
    },
    get clientLeft() {
      return metric((this as any).$impl, (this as any).$impl.id, 0);
    },
    get clientTop() {
      return metric((this as any).$impl, (this as any).$impl.id, 1);
    },
    get clientWidth() {
      return clientSize((this as any).$impl, 2);
    },
    get clientHeight() {
      return clientSize((this as any).$impl, 3);
    },
    get currentCSSZoom() {
      return metric((this as any).$impl, (this as any).$impl.id, 14) || 1;
    },
  },
  Element,
);

// ───────────────────────────── HTMLElement ─────────────────────────────

const focusableByDefault = new Set(splitTokens("a area button frame iframe input object select textarea"));

const htmlOrSvg = {
  get dataset() {
    const node = (this as any).$impl;
    return (rare(node).dataset ??= nodes.datasetOf(node));
  },
  get attributeStyleMap() {
    return same((this as any).$impl, "styleMap", node => cssom.styleMap(cssom.styleOf(node), true));
  },
  get nonce() {
    return (this as any).$impl.rare?.nonce ?? "";
  },
  set nonce(value) {
    rare((this as any).$impl).nonce = String(value);
  },
  get autofocus() {
    return hasAttr((this as any).$impl, "autofocus");
  },
  set autofocus(value) {
    core.toggleAttr((this as any).$impl, "autofocus", !!value);
    react();
  },
  get tabIndex() {
    const node = (this as any).$impl;
    const index = parseInteger(getAttr(node, "tabindex"));
    if (index === index) return index;
    return focusableByDefault.$has(node.name) || hooks.isDetailsSummary(node) ? 0 : -1;
  },
  set tabIndex(value) {
    setAttr((this as any).$impl, "tabindex", String(value | 0));
    react();
  },
  focus(this: any, options: object | undefined = undefined) {
    hooks.focusFromScript(this.$impl, options);
  },
  blur(this: any) {
    hooks.blur(this.$impl);
  },
};

function mergeWithNextText(node: N) {
  const { next } = node;
  if (next === null || !core.isText(node) || !core.isText(next)) return;
  core.replaceData(node, node.data.length, 0, next.data);
  core.remove(next);
}

function textWithBreaks(doc: Doc, text: string): N {
  const fragment = core.createFragment(doc);
  text.split(/\r\n|\r|\n/).forEach((line, index) => {
    if (index > 0) core.insert(core.createPlainElement(doc, "br", HTML), fragment, null);
    if (line !== "") core.insert(core.createText(doc, line), fragment, null);
  });
  return fragment;
}

function inherited(node: N | null, attribute: string, on: string, off: string, fallback: boolean): boolean {
  for (; node !== null; node = core.parentOrHost(node)) {
    if (node.parent === null && node.type !== core.ELEMENT) break;
    const value = getAttr(node, attribute);
    if (value === null) continue;
    if (value === "" || asciiLower(value) === on) return true;
    if (asciiLower(value) === off) return false;
  }
  return fallback;
}

function formToInheritFrom(node: N): N | null {
  return node.ns === core.HTML && /^(?:button|fieldset|input|output|select|textarea)$/.test(node.name)
    ? hooks.formOf(node)
    : null;
}

function capitalization(node: N): string {
  const value = asciiLower(getAttr(node, "autocapitalize") ?? "");
  if (value === "") {
    const form = formToInheritFrom(node);
    return form === null ? "" : capitalization(form);
  }
  if (value === "off" || value === "none") return "none";
  return value === "words" || value === "characters" ? value : "sentences";
}

function editableState(node: N): string {
  const value = asciiLower(getAttr(node, "contenteditable") ?? "inherit");
  if (value === "") return "true";
  return value === "true" || value === "false" || value === "plaintext-only" ? value : "inherit";
}

function isDraggable(node: N): boolean {
  const value = asciiLower(getAttr(node, "draggable") ?? "");
  if (value === "true" || value === "false") return value === "true";
  return isHtml(node, "img") || (isHtml(node, "a") && hasAttr(node, "href"));
}

const clicking = new WeakSet<N>();

function click(node: N, trusted: boolean, init?: object) {
  if (hooks.isDisabled(node) || clicking.has(node)) return;
  clicking.add(node);
  const view = node.doc.page?.window ?? null;
  const options = { bubbles: true, cancelable: true, composed: true, view, pointerId: -1, ...init };
  const event = new events.PointerEvent("click", options);
  if (trusted) events.dispatch(node, event);
  else events.dispatchFromScript(node, event);
  clicking.delete(node);
}

/** The offset parent is not in a shadow tree that `node` is only slotted into. */
function offsets(node: N): number[] {
  const engine = layout(node);
  if (engine === null) return zeros;
  const result = engine.offsetMetrics(node.id);
  for (let parent; (parent = node.doc.nodes[result[0]]) && !core.containsComposed(parent, node);) {
    const [outer, left, top] = engine.offsetMetrics(parent.id);
    const [borderLeft, borderTop] = engine.clientMetrics(parent.id);
    result[0] = outer;
    result[1] += left + borderLeft;
    result[2] += top + borderTop;
  }
  return result;
}

function offset(node: N, which: number): number {
  return core.hasSlots() ? offsets(node)[which] : metric(node, node.id, 8 + which);
}

function popoverSource(options: any): N | null {
  const source = $isObject(options) ? options.source : undefined;
  if (source === undefined) return null;
  if (core.nodeOf(source)?.ns !== HTML) throw new TypeError("The source is not of type 'HTMLElement'.");
  return source.$impl;
}

function mapOf(image: N): N | null {
  const reference = getAttr(image, "usemap")!;
  const name = reference.slice(reference.indexOf("#") + 1);
  if (!reference.includes("#") || name === "") return null;
  const isIt = (node: N) => isHtml(node, "map") && (getAttr(node, "id") === name || getAttr(node, "name") === name);
  return core.findDescendant(core.rootOf(image), isIt);
}

/** https://html.spec.whatwg.org/#image-map-processing-model */
function isInArea(area: N, x: number, y: number): boolean {
  const shape = asciiLower(getAttr(area, "shape") ?? "");
  if (shape === "default") return true;
  const parse = (text: string) => parseFloat(text.replace(/^[^\d.-]+/, "")) || 0;
  const coords = (getAttr(area, "coords") ?? "").match(/[^\t\n\f\r ,;]+/g)?.map(parse) ?? [];
  if (shape === "circle" || shape === "circ")
    return coords[2] > 0 && Math.hypot(x - coords[0], y - coords[1]) <= coords[2];
  if (shape !== "poly" && shape !== "polygon") {
    const [x1, y1, x2, y2] = coords;
    return (
      coords.length >= 4 &&
      x >= Math.min(x1, x2) &&
      x < Math.max(x1, x2) &&
      y >= Math.min(y1, y2) &&
      y < Math.max(y1, y2)
    );
  }
  let isInside = false;
  const count = coords.length >> 1;
  for (let i = 0, j = count - 1; count >= 3 && i < count; j = i++) {
    const [x1, y1, x2, y2] = [coords[2 * i], coords[2 * i + 1], coords[2 * j], coords[2 * j + 1]];
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) isInside = !isInside;
  }
  return isInside;
}

function areaAt(image: N, x: number, y: number): N | null {
  const map = mapOf(image);
  if (map === null) return null;
  const { engine } = image.doc;
  const [left, top] = engine.toLocal(image.id, x, y);
  const [paddingLeft, paddingTop] = engine.boxSizes(image.id);
  const [borderLeft, borderTop] = engine.clientMetrics(image.id);
  const isHit = (node: N) =>
    isHtml(node, "area") && isInArea(node, left - borderLeft - paddingLeft, top - borderTop - paddingTop);
  return core.findDescendant(map, isHit);
}

function imageOfArea(area: N): N | null {
  const map = core.closestHtml(area, "map");
  const usesIt = (node: N) => isHtml(node, "img") && hasAttr(node, "usemap") && mapOf(node) === map;
  return map && core.findDescendant(core.rootOf(area), usesIt);
}

class HTMLElement extends Element {
  constructor() {
    if (!core.hasPending()) return prepareCustomElement(new.target, HTMLElement);
    super();
  }
  get style(): any {
    return cssom.styleOf(this.$impl);
  }
  set style(text) {
    cssom.styleOf(this.$impl).cssText = text;
  }
  get hidden() {
    const value = getAttr(this.$impl, "hidden");
    return value !== null && asciiLower(value) === "until-found" ? "until-found" : value !== null;
  }
  set hidden(value: any) {
    if (!value) removeAttr(this.$impl, "hidden");
    else setAttr(this.$impl, "hidden", asciiLower(String(value)) === "until-found" ? "until-found" : "");
    react();
  }
  get translate() {
    return inherited(this.$impl, "translate", "yes", "no", true);
  }
  set translate(value) {
    setAttr(this.$impl, "translate", value ? "yes" : "no");
    react();
  }
  get spellcheck() {
    return inherited(this.$impl, "spellcheck", "true", "false", true);
  }
  set spellcheck(value) {
    setAttr(this.$impl, "spellcheck", value ? "true" : "false");
    react();
  }
  get autocorrect() {
    const node = this.$impl;
    if (isHtml(node, "input") && /^(?:url|email|password)$/.test(node.x.type)) return false;
    const form = formToInheritFrom(node);
    return asciiLower(getAttr(node, "autocorrect") ?? (form && getAttr(form, "autocorrect")) ?? "") !== "off";
  }
  get autocapitalize() {
    return capitalization(this.$impl);
  }
  set autocapitalize(value) {
    setAttr(this.$impl, "autocapitalize", `${value}`);
    react();
  }
  get writingSuggestions() {
    for (let node: N | null = this.$impl; node !== null; node = core.parentOrHost(node)) {
      const value = getAttr(node, "writingsuggestions");
      if (value !== null) return asciiLower(value) === "false" ? "false" : "true";
    }
    return "true";
  }
  set writingSuggestions(value) {
    setAttr(this.$impl, "writingsuggestions", `${value}`);
    react();
  }
  set autocorrect(value) {
    setAttr(this.$impl, "autocorrect", value ? "on" : "off");
    react();
  }
  get draggable() {
    return isDraggable(this.$impl);
  }
  set draggable(value) {
    setAttr(this.$impl, "draggable", value ? "true" : "false");
    react();
  }
  get contentEditable() {
    return editableState(this.$impl);
  }
  set contentEditable(value) {
    value = asciiLower(String(value));
    if (value === "inherit") removeAttr(this.$impl, "contenteditable");
    else if (value === "true" || value === "false" || value === "plaintext-only") {
      setAttr(this.$impl, "contenteditable", value);
    } else throw domError("SyntaxError", `The value provided ('${value}') is not valid.`);
    react();
  }
  get isContentEditable() {
    for (let node: N | null = this.$impl; node !== null; node = node.parent) {
      const state = editableState(node);
      if (state !== "inherit") return state !== "false";
    }
    return this.$impl.doc.designMode;
  }
  get popover() {
    return hooks.popoverState(this.$impl);
  }
  set popover(value) {
    if (value == null) removeAttr(this.$impl, "popover");
    else setAttr(this.$impl, "popover", String(value));
    react();
  }
  get innerText() {
    const node = this.$impl;
    if (!(styleBits(node) & (1 | 64))) return core.textContent(node);
    return node.doc.engine.innerText(node.id);
  }
  set innerText(text) {
    core.replaceAll(textWithBreaks(this.$impl.doc, text === null ? "" : String(text)), this.$impl);
    react();
  }
  get outerText() {
    return this.innerText;
  }
  set outerText(text) {
    const node = this.$impl;
    if (node.parent === null) throw domError("NoModificationAllowedError", "The element has no parent.");
    const { prev, next } = node;
    const fragment = textWithBreaks(node.doc, text === null ? "" : String(text));
    if (fragment.first === null) core.insert(core.createText(node.doc, ""), fragment, null);
    core.replaceChild(node, fragment, node.parent);
    if (next?.prev) mergeWithNextText(next.prev);
    if (prev !== null) mergeWithNextText(prev);
    react();
  }
  get offsetParent() {
    return wrapOrNull(this.$impl.doc.nodes[offset(this.$impl, 0)]);
  }
  get offsetLeft() {
    return offset(this.$impl, 1);
  }
  get offsetTop() {
    return offset(this.$impl, 2);
  }
  get offsetWidth() {
    return metric(this.$impl, this.$impl.id, 11);
  }
  get offsetHeight() {
    return metric(this.$impl, this.$impl.id, 12);
  }
  click() {
    click(this.$impl, false);
  }
  attachInternals() {
    return hooks.attachInternals(this.$impl);
  }
  showPopover(options: { source?: any } | undefined = undefined) {
    hooks.showPopover(this.$impl, true, popoverSource(options));
  }
  hidePopover() {
    hooks.hidePopover(this.$impl, true);
  }
  togglePopover(options: any = undefined) {
    const force = $isObject(options) ? options.force : options;
    return hooks.togglePopover(this.$impl, force === undefined ? force : !!force, popoverSource(options));
  }
}
reflectAll(HTMLElement, "title lang dir accessKey inert? enterKeyHint inputMode");
core.mixin(htmlOrSvg, HTMLElement);
events.defineHandlers(HTMLElement.prototype, events.globalHandlers);
expose(HTMLElement);
kinds.htmlElement = new Kind(HTMLElement);

class MathMLElement extends Element {
  get style() {
    return cssom.styleOf(this.$impl);
  }
}
core.mixin(htmlOrSvg, MathMLElement);
events.defineHandlers(MathMLElement.prototype, events.globalHandlers);
kinds.mathml = new Kind(expose(MathMLElement));

/** An interface for some tags, with reflected attributes, other members, and the hooks of its `Kind`. */
function define(
  name: string,
  tags: string,
  reflected = "",
  members?: () => any,
  kindHooks?: object,
  base: any = HTMLElement,
) {
  const lazy = new core.Interface(name, () => {
    const Base = core.loaded(base);
    const ctor = {
      [name]: class extends Base {
        constructor() {
          if (!core.hasPending()) return prepareCustomElement(new.target, ctor);
          super();
        }
      },
    }[name];
    reflectAll(ctor, reflected);
    if (members !== undefined) core.mixin(members(), ctor);
    return expose(ctor);
  });
  const kind = new Kind(lazy, kindHooks);
  if (tags === "") return lazy;
  if (!tags.includes(" ")) kinds.html.$set(tags, kind);
  else for (const tag of splitTokens(tags)) kinds.html.$set(tag, kind);
  return lazy;
}

/** `new Image()` */
function defineFactory(name: string, factory: Function, of: $Dom.Interface) {
  new core.Interface(name, () =>
    Object.defineProperties(factory, {
      name: { value: name },
      prototype: { value: of.load().prototype, writable: false },
    }),
  );
}

kinds.unknown = new Kind(define("HTMLUnknownElement", ""));
for (const tag of splitTokens(`abbr acronym address article aside b basefont bdi bdo big center cite code dd dfn dt em
  figcaption figure footer header hgroup i kbd main mark nav nobr noembed noframes noscript plaintext rb rp rt rtc ruby s
  samp search section small strike strong sub sup tt u var wbr`)) {
  kinds.html.$set(tag, kinds.htmlElement);
}

define("HTMLBRElement", "br", "clear");
define("HTMLDListElement", "dl", "compact?");
define("HTMLDataElement", "data", "value");
define("HTMLDirectoryElement", "dir", "compact?");
define("HTMLDivElement", "div", "align");
define("HTMLFontElement", "font", "color! face size");
define("HTMLHRElement", "hr", "align color noShade? size width");
define("HTMLHeadElement", "head");
define("HTMLHeadingElement", "h1 h2 h3 h4 h5 h6", "align");
define("HTMLHtmlElement", "html", "version");
define("HTMLLIElement", "li", "value=0 type");
define(
  "HTMLMarqueeElement",
  "marquee",
  "behavior bgColor~ direction height width hspace+0 vspace+0 scrollAmount+6 scrollDelay+85 trueSpeed?",
);
define("HTMLMenuElement", "menu", "compact?");
define("HTMLModElement", "del ins", "cite@ dateTime");
define("HTMLOListElement", "ol", "reversed? start=1 type compact?");
define("HTMLParagraphElement", "p", "align");
define("HTMLParamElement", "param", "name value type valueType");
define("HTMLPictureElement", "picture");
define("HTMLPreElement", "pre listing xmp", "width=0");
define("HTMLQuoteElement", "blockquote q", "cite@");
define("HTMLSpanElement", "span");
define("HTMLTableCaptionElement", "caption", "align");
define("HTMLTableColElement", "col colgroup", "span>1 align ch chOff vAlign width");
define("HTMLTimeElement", "time", "dateTime");
define("HTMLTrackElement", "track", "kind src@ srclang label default?");
define("HTMLUListElement", "ul", "compact? type");
define("HTMLMapElement", "map", "name", () => ({
  get areas() {
    return same((this as any).$impl, "areas", node => nodes.liveElements(node, it => isHtml(it, "area"), false));
  },
}));

for (const ctor of [
  define("HTMLBodyElement", "body", "text link vLink aLink bgColor background", undefined, {
    inserted: takeFrameMargins,
  }),
  define("HTMLFrameSetElement", "frameset", "cols rows"),
]) {
  core.extend(ctor, it => events.defineHandlers(it.prototype, events.reflectedByBody, true));
}

function takeFrameMargins(body: N) {
  const { container } = body.doc;
  if (container === null) return;
  for (const name of ["marginwidth", "marginheight"]) {
    const margin = parseInteger(container.attribute(name));
    if (margin >= 0) setAttr(body, name, String(margin));
  }
}
hooks.takeFrameMargins = takeFrameMargins;

const hasText = {
  get text() {
    return core.childText((this as any).$impl);
  },
  set text(value) {
    core.replaceAllWithText(String(value), (this as any).$impl);
    react();
  },
};

const titleChanged = (node: N) => node.doc.page?.titleChanged();
define("HTMLTitleElement", "title", "", () => hasText, {
  inserted: titleChanged,
  removed: titleChanged,
  children: (node: N) => node.flags & CONNECTED && titleChanged(node),
});

function baseChanged({ doc }: N) {
  const base = core.findDescendant(doc.node, it => isHtml(it, "base") && hasAttr(it, "href"));
  const fallback = doc.fallbackBaseUrl ?? doc.url;
  const url = base && URL.parse(getAttr(base, "href")!, fallback);
  const isAllowed =
    url && !/^(?:data|javascript):$/.test(url.protocol) && doc.page?.host.allowsBase?.(url.href) !== false;
  doc.baseUrl = isAllowed ? url.href : fallback;
  if (doc.page !== null) doc.engine.setBaseUrl(doc.baseUrl);
}
const baseMembers = () => ({
  get href() {
    const node: N = (this as any).$impl;
    const value = getAttr(node, "href") ?? "";
    return URL.parse(value, node.doc.fallbackBaseUrl ?? node.doc.url)?.href ?? value;
  },
  set href(value) {
    setAttr((this as any).$impl, "href", `${value}`.toWellFormed());
    react();
  },
});
define("HTMLBaseElement", "base", "target", baseMembers, {
  inserted: baseChanged,
  removed: baseChanged,
  attribute: (node: N) => node.flags & CONNECTED && baseChanged(node),
});

const metaChanged = (node: N) => node.scope === node.doc.node && node.doc.page?.metaChanged(node);
define("HTMLMetaElement", "meta", "name httpEquiv content media scheme", undefined, {
  inserted: metaChanged,
  removed: (node: N) => node.doc.page?.metaChanged(node),
  attribute: (node: N) => node.flags & CONNECTED && metaChanged(node),
});

define(
  "HTMLTemplateElement",
  "template",
  "shadowRootMode shadowRootDelegatesFocus? shadowRootClonable? shadowRootSerializable? shadowRootCustomElementRegistry",
  () => ({
    get content() {
      return wrap((this as any).$impl.x);
    },
  }),
  {
    created(node: N) {
      node.x = core.createFragment(core.templateDoc(node.doc));
      node.x.x = { host: node };
    },
    cloned(from: N, to: N, deep: boolean) {
      if (deep)
        for (let child = from.x.first; child !== null; child = child.next) core.clone(child, to.x.doc, true, to.x);
    },
    adopted: (node: N) => core.adopt(node.x, core.templateDoc(node.doc)),
  },
);

function assignedNodes(slot: N, flatten: boolean): N[] {
  const { assigned } = core.slotOf(slot);
  if (!flatten || !(core.rootOf(slot).flags & flags.SHADOW_ROOT)) return assigned;
  const isSlottable = (node: N) => node.type === ELEMENT || core.isText(node);
  return (assigned.length > 0 ? assigned : core.childArray(slot).filter(isSlottable)).flatMap(node =>
    node.flags & flags.SLOT && core.rootOf(node).flags & flags.SHADOW_ROOT ? assignedNodes(node, true) : [node],
  );
}

function reassign(slot: N) {
  const root = core.rootOf(slot);
  if (root.flags & flags.SHADOW_ROOT) core.assignSlots(root);
}

define(
  "HTMLSlotElement",
  "slot",
  "name",
  () => ({
    assignedNodes(this: any, options: { flatten?: boolean } | undefined = undefined) {
      return assignedNodes(this.$impl, !!options?.flatten).map(wrap);
    },
    assignedElements(this: any, options: { flatten?: boolean } | undefined = undefined) {
      return assignedNodes(this.$impl, !!options?.flatten)
        .filter(node => node.type === ELEMENT)
        .map(wrap);
    },
    assign(this: any, ...values: unknown[]) {
      const slot = this.$impl;
      for (const node of core.slotOf(slot).manual) node.rare!.manualSlot = null;
      core.slotOf(slot).manual = [...new Set(values.map(value => unwrap(value, "assign")))];
      for (const node of core.slotOf(slot).manual) rare(node).manualSlot = slot;
      reassign(slot);
    },
  }),
  { created: core.noteSlot, attribute: (node: N, name: string) => name === "name" && reassign(node) },
);

// ───────────────────────────── links ─────────────────────────────

const hyperlink = {
  get origin() {
    return URL.parse((this as any).href)?.origin ?? "";
  },
  toString(this: any) {
    return this.href;
  },
};
for (const part of splitTokens("protocol username password host hostname port pathname search hash")) {
  accessor(
    hyperlink,
    part,
    function (this: any) {
      return URL.parse(this.href)?.[part] ?? (part === "protocol" ? ":" : "");
    },
    function (this: any, value) {
      const url = URL.parse(this.href);
      if (url === null) return;
      url[part] = value;
      this.href = url.href;
    },
  );
}

const followsLink = {
  activate(node: N, event: any) {
    const href = core.svgHref(node);
    if (href !== null && !styleBits(node, 4)) node.doc.page?.followLink(node, href, event);
  },
};
const linkTypes = ["noreferrer", "noopener", "opener"];
for (const ctor of [
  define(
    "HTMLAnchorElement",
    "a",
    "href@ target download ping rel hreflang type referrerPolicy coords charset name rev shape",
    () => ({
      get text() {
        return (this as any).textContent;
      },
      set text(value) {
        (this as any).textContent = value;
      },
    }),
    followsLink,
  ),
  define(
    "HTMLAreaElement",
    "area",
    "href@ alt coords shape target download ping rel referrerPolicy noHref?",
    undefined,
    followsLink,
  ),
]) {
  core.mixin(hyperlink, ctor);
  defineTokenList(ctor, "relList", "rel", linkTypes);
}

// ───────────────────────────── tables ─────────────────────────────

const childrenNamed = (node: N, ...names: string[]) =>
  core.elementChildren(node).filter(child => child.ns === HTML && names.includes(child.name));

function rowsOf(table: N): N[] {
  const rowsIn = (name: string) => childrenNamed(table, name).flatMap(group => childrenNamed(group, "tr"));
  const body = childrenNamed(table, "tr", "tbody").flatMap(it => (it.name === "tr" ? [it] : childrenNamed(it, "tr")));
  return [...rowsIn("thead"), ...body, ...rowsIn("tfoot")];
}

function insertPart(items: N[], index: number, name: string, fallback: () => N, doc: Doc) {
  if (index < -1 || index > items.length)
    throw domError("IndexSizeError", `The index (${index}) is outside of the range.`);
  const before = index === -1 ? null : (items[index] ?? null);
  const made = core.createPlainElement(doc, name, HTML);
  core.insert(made, before?.parent ?? fallback(), before);
  react();
  return wrap(made);
}

function deletePart(items: N[], index: number) {
  if (index < -1 || (index >= items.length && index !== -1))
    throw domError("IndexSizeError", `The index (${index}) is outside of the range.`);
  if (items.length > 0) core.remove(items.at(index)!);
  react();
}

const HTMLTableElement = define(
  "HTMLTableElement",
  "table",
  "align border frame rules summary width bgColor cellPadding cellSpacing",
  () => ({
    get tBodies() {
      return same((this as any).$impl, "tBodies", node => collectionOf(node, () => childrenNamed(node, "tbody")));
    },
    get rows() {
      return same((this as any).$impl, "rows", node => collectionOf(node, () => rowsOf(node)));
    },
    createTBody(this: any) {
      const body = core.createPlainElement(this.$impl.doc, "tbody", HTML);
      core.insert(body, this.$impl, childrenNamed(this.$impl, "tbody").at(-1)?.next ?? null);
      return wrap(body);
    },
    insertRow(this: any, index = -1) {
      const table = this.$impl;
      const rows = rowsOf(table);
      const parent = () => rows.at(-1)?.parent ?? childrenNamed(table, "tbody").at(-1) ?? this.createTBody().$impl;
      return insertPart(rows, index | 0, "tr", parent, table.doc);
    },
    deleteRow(this: any, index: number) {
      if ($argumentCount() < 1) core.tooFew(1);
      deletePart(rowsOf(this.$impl), index | 0);
    },
  }),
);
function defineTablePart({ prototype }: any, property: string, suffix: string, tag: string) {
  const find = (table: N) => childrenNamed(table, tag)[0];
  const put = (table: N, part: N) => {
    const isAfter = (child: N) => !isHtml(child, "caption") && !isHtml(child, "colgroup");
    const before = tag === "caption" ? table.first : tag === "tfoot" ? null : core.elementChildren(table).find(isAfter);
    core.preInsert(part, table, before ?? null);
    react();
  };
  accessor(
    prototype,
    property,
    function (this: any) {
      return wrapOrNull(find(this.$impl));
    },
    function (this: any, value) {
      const part = value === null ? null : unwrap(value, property);
      if (part !== null && !isHtml(part, tag)) {
        if (part.kind !== kinds.html.$get(tag)) throw new TypeError(`The value is not a '${tag}' element.`);
        throw domError("HierarchyRequestError", `The value is not a '${tag}' element.`);
      }
      this["delete" + suffix]();
      if (part !== null) put(this.$impl, part);
    },
  );
  prototype["create" + suffix] = function () {
    if (!find(this.$impl)) put(this.$impl, core.createPlainElement(this.$impl.doc, tag, HTML));
    return wrap(find(this.$impl));
  };
  prototype["delete" + suffix] = function () {
    if (find(this.$impl)) core.remove(find(this.$impl));
    react();
  };
}

core.extend(HTMLTableElement, ctor => {
  defineTablePart(ctor, "caption", "Caption", "caption");
  defineTablePart(ctor, "tHead", "THead", "thead");
  defineTablePart(ctor, "tFoot", "TFoot", "tfoot");
});

define("HTMLTableSectionElement", "tbody thead tfoot", "align ch chOff vAlign", () => ({
  get rows() {
    return same((this as any).$impl, "rows", node => collectionOf(node, () => childrenNamed(node, "tr")));
  },
  insertRow(this: any, index = -1) {
    return insertPart(childrenNamed(this.$impl, "tr"), index | 0, "tr", () => this.$impl, this.$impl.doc);
  },
  deleteRow(this: any, index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    deletePart(childrenNamed(this.$impl, "tr"), index | 0);
  },
}));

define("HTMLTableRowElement", "tr", "align ch chOff vAlign bgColor", () => ({
  get rowIndex() {
    const row = (this as any).$impl;
    const table = isHtml(row.parent, "table") ? row.parent : row.parent?.parent;
    return table && isHtml(table, "table") ? rowsOf(table).indexOf(row) : -1;
  },
  get sectionRowIndex() {
    const row = (this as any).$impl;
    if (row.parent === null) return -1;
    return (isHtml(row.parent, "table") ? rowsOf(row.parent) : childrenNamed(row.parent, "tr")).indexOf(row);
  },
  get cells() {
    return same((this as any).$impl, "cells", node => collectionOf(node, () => childrenNamed(node, "td", "th")));
  },
  insertCell(this: any, index = -1) {
    return insertPart(childrenNamed(this.$impl, "td", "th"), index | 0, "td", () => this.$impl, this.$impl.doc);
  },
  deleteCell(this: any, index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    deletePart(childrenNamed(this.$impl, "td", "th"), index | 0);
  },
}));

define(
  "HTMLTableCellElement",
  "td th",
  "colSpan>1 rowSpan+1 headers scope abbr align axis height width ch chOff noWrap? vAlign bgColor",
  () => ({
    get cellIndex() {
      const cell = (this as any).$impl;
      return isHtml(cell.parent, "tr") ? childrenNamed(cell.parent, "td", "th").indexOf(cell) : -1;
    },
  }),
);

export default {
  HTMLElement,
  areaAt,
  boundingRect,
  childrenNamed,
  click,
  define,
  defineFactory,
  editableState,
  followsLink,
  hasText,
  htmlOrSvg,
  imageOfArea,
  inherited,
  isDraggable,
  layout,
  parseInteger,
  reflectAll,
  isScrollableBody,
  metric,
  scroll,
  scrollFromScript,
  scrollIntoView,
  styleBits,
};
