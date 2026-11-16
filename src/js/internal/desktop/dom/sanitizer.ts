// https://html.spec.whatwg.org/#html-sanitization
const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const { attributeKeys } = require("internal/desktop/dom/node");

const { COMMENT, ELEMENT, INSTRUCTION, XLINK_NS, namespaces, splitTokens } = core;
const [HTML, SVG, MATHML] = [namespaces[core.HTML], namespaces[core.SVG], namespaces[core.MATHML]];

type N = $Dom.N;
/** Names, each with a space and its namespace after it. */
type Names = Set<string>;
type Own = { attributes?: Names; removeAttributes?: Names };
type Config = {
  elements?: Map<string, Own>;
  removeElements?: Names;
  replaceWithChildrenElements?: Names;
  processingInstructions?: Names;
  removeProcessingInstructions?: Names;
  attributes?: Names;
  removeAttributes?: Names;
  comments: boolean;
  dataAttributes?: boolean;
  javascriptURLs: boolean;
};

const keyOf = (name: string, namespace: string | null) => `${name} ${namespace ?? ""}`;
const attributesIn = (list: string): Names => new Set(splitTokens(list).map(it => keyOf(it, null)));
const isData = (key: string) => /^data-[^A-Z ]+ $/.test(key);

function canonical(value: any, namespace: string | null): string {
  if (!$isObject(value)) return keyOf(`${value}`, namespace);
  const { name, namespace: given = namespace } = value as any;
  if (name === undefined) throw new TypeError("Required member name is undefined.");
  return keyOf(`${name}`, given === null ? null : `${given}`);
}

function target(value: any): string {
  if ($isObject(value) && value.target === undefined) throw new TypeError("Required member target is undefined.");
  return `${$isObject(value) ? value.target : value}`;
}

const invalid = () => new TypeError("The configuration of the Sanitizer is not valid.");

function setOf(list: any, convert: (value: any) => string): Names | undefined {
  if (list === undefined) return;
  if (!$isObject(list)) throw new TypeError("The value cannot be converted to a sequence.");
  const all = Array.from(list as any, convert);
  if (new Set(all).size !== all.length) throw invalid();
  return new Set(all);
}

const toElement = (value: any) => canonical(value, HTML);
const toAttribute = (value: any) => canonical(value, null);

function ownOf(value: any): Own {
  const { attributes, removeAttributes } = $isObject(value) ? value : ({} as any);
  if (attributes === undefined && removeAttributes === undefined) return { removeAttributes: new Set() };
  return { attributes: setOf(attributes, toAttribute), removeAttributes: setOf(removeAttributes, toAttribute) };
}

const irreplaceable = new Set([keyOf("html", HTML), keyOf("svg", SVG), keyOf("math", MATHML)]);
const overlaps = (a?: Iterable<string>, b?: { has(key: string): boolean }) =>
  !!a && !!b && [...a].some(it => b.has(it));

function parseConfig(given: any, isPermissive: boolean): Config {
  const elements = given.elements === undefined ? undefined : [...given.elements];
  const keys = setOf(elements, toElement);
  const it: Config = {
    elements: keys && new Map([...keys].map((key, index) => [key, ownOf(elements![index])])),
    removeElements: setOf(given.removeElements, toElement),
    replaceWithChildrenElements: setOf(given.replaceWithChildrenElements, toElement),
    processingInstructions: setOf(given.processingInstructions, target),
    removeProcessingInstructions: setOf(given.removeProcessingInstructions, target),
    attributes: setOf(given.attributes, toAttribute),
    removeAttributes: setOf(given.removeAttributes, toAttribute),
    comments: !!(given.comments ?? isPermissive),
    dataAttributes: given.dataAttributes === undefined ? undefined : !!given.dataAttributes,
    javascriptURLs: !!(given.javascriptURLs ?? isPermissive),
  };
  if (!it.elements) it.removeElements ??= new Set();
  if (!it.attributes) it.removeAttributes ??= new Set();
  else it.dataAttributes ??= isPermissive;
  if (!it.processingInstructions && !it.removeProcessingInstructions) {
    it[isPermissive ? "removeProcessingInstructions" : "processingInstructions"] = new Set();
  }
  const { attributes, removeAttributes, replaceWithChildrenElements: replaced } = it;
  const isWrong = (own: Own) =>
    attributes
      ? overlaps(own.attributes, attributes) ||
        [...(own.removeAttributes ?? [])].some(key => !attributes.$has(key)) ||
        (it.dataAttributes && [...(own.attributes ?? [])].some(isData))
      : (own.attributes && own.removeAttributes) ||
        overlaps(own.attributes, removeAttributes) ||
        overlaps(own.removeAttributes, removeAttributes);
  if (
    (it.elements && it.removeElements) ||
    (attributes && removeAttributes) ||
    (it.processingInstructions && it.removeProcessingInstructions) ||
    overlaps(replaced, it.elements ?? it.removeElements) ||
    overlaps(replaced, irreplaceable) ||
    (attributes ? it.dataAttributes && [...attributes].some(isData) : it.dataAttributes !== undefined) ||
    [...(it.elements?.values() ?? [])].some(isWrong)
  ) {
    throw invalid();
  }
  return it;
}

function defaultConfig(): Config {
  const elements = new Map<string, Own>();
  const add = (namespace: string, list: string) => {
    for (const entry of splitTokens(list)) {
      const [name, own = ""] = entry.split(":");
      elements.$set(keyOf(name, namespace), { attributes: attributesIn(own.replaceAll(",", " ")) });
    }
  };
  add(
    HTML,
    `a:href,hreflang,type abbr address article aside b bdi bdo blockquote:cite body br caption cite code col:span
    colgroup:span data:value dd del:cite,datetime dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 head header
    hgroup hr html i ins:cite,datetime kbd li:value main mark menu nav ol:reversed,start,type p pre q rp rt ruby s samp
    search section small span strong sub sup table tbody td:colspan,headers,rowspan tfoot
    th:abbr,colspan,headers,rowspan,scope thead time:datetime title tr u ul var wbr`,
  );
  add(
    MATHML,
    `math merror mfrac mi mmultiscripts mn
    mo:fence,form,largeop,lspace,maxsize,minsize,movablelimits,rspace,separator,stretchy,symmetric mover:accent
    mpadded:depth,height,lspace,voffset,width mphantom mprescripts mroot mrow ms mspace:depth,height,width msqrt mstyle
    msub msubsup msup mtable mtd:columnspan,rowspan mtext mtr munder:accentunder munderover:accent,accentunder semantics`,
  );
  add(
    SVG,
    `a:href,hreflang,type circle:cx,cy,pathLength,r defs desc ellipse:cx,cy,pathLength,rx,ry
    foreignObject:height,width,x,y g line:pathLength,x1,x2,y1,y2
    marker:markerHeight,markerUnits,markerWidth,orient,preserveAspectRatio,refX,refY,viewBox metadata path:d,pathLength
    polygon:pathLength,points polyline:pathLength,points rect:height,pathLength,rx,ry,width,x,y
    svg:height,preserveAspectRatio,viewBox,width,x,y text:dx,dy,lengthAdjust,rotate,textLength,x,y
    textPath:lengthAdjust,method,path,side,spacing,startOffset,textLength title tspan:dx,dy,lengthAdjust,rotate,textLength,x,y`,
  );
  const attributes =
    attributesIn(`alignment-baseline baseline-shift clip-path clip-rule color color-interpolation cursor dir
    direction display displaystyle dominant-baseline fill fill-opacity fill-rule font-family font-size font-size-adjust
    font-stretch font-style font-variant font-weight lang letter-spacing marker-end marker-mid marker-start mathbackground
    mathcolor mathsize opacity paint-order pointer-events scriptlevel shape-rendering stop-color stop-opacity stroke
    stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width
    text-anchor text-decoration text-overflow text-rendering title transform transform-origin unicode-bidi vector-effect
    visibility white-space word-spacing writing-mode`);
  return {
    elements,
    processingInstructions: new Set(),
    attributes,
    comments: false,
    dataAttributes: false,
    javascriptURLs: false,
  };
}

function removeElement(it: Config, key: string): boolean {
  const wasReplaced = !!it.replaceWithChildrenElements?.$delete(key);
  if (it.elements) return it.elements.$delete(key) || wasReplaced;
  if (it.removeElements!.$has(key)) return wasReplaced;
  it.removeElements!.$add(key);
  return true;
}

function removeAttribute(it: Config, key: string): boolean {
  if (it.removeAttributes?.$has(key)) return false;
  let isModified = !it.attributes || it.attributes.$delete(key);
  for (const own of it.elements?.values() ?? []) {
    if (own.attributes?.$delete(key)) isModified = true;
    own.removeAttributes?.$delete(key);
  }
  it.removeAttributes?.$add(key);
  return isModified;
}

const unsafeElements = [
  ...splitTokens("base embed frame iframe object script").map(name => keyOf(name, HTML)),
  ...splitTokens("script use").map(name => keyOf(name, SVG)),
];

function removeUnsafe(it: Config): boolean {
  let isModified = it.javascriptURLs;
  it.javascriptURLs = false;
  for (const key of unsafeElements) if (removeElement(it, key)) isModified = true;
  for (const name of events.handlerAttributes()) if (removeAttribute(it, keyOf("on" + name, null))) isModified = true;
  return isModified;
}

function toggle(allowed: Names | undefined, removed: Names | undefined, key: string): boolean {
  if (!allowed) return removed!.$delete(key);
  if (allowed.$has(key)) return false;
  allowed.$add(key);
  return true;
}

function describe(keys: Iterable<string>) {
  const pairs = Array.from(keys, key => [key.slice(0, key.lastIndexOf(" ")), key.slice(key.lastIndexOf(" ") + 1)]);
  const order = (a: string, b: string) => (a < b ? -1 : +(a > b));
  pairs.sort((a, b) => order(a[1], b[1]) || order(a[0], b[0]));
  return pairs.map(([name, namespace]) => ({ name, namespace: namespace || null }));
}

const isSame = (a?: Names, b?: Names) => a === b || (!!a && !!b && a.size === b.size && a.isSubsetOf(b));

class Sanitizer {
  declare $impl: Config;

  constructor(configuration: any = "default") {
    this.$impl = configOf(configuration, true);
  }
  get() {
    const result: any = {};
    const it = this.$impl;
    for (const name of Object.keys(it).sort()) {
      const value = it[name];
      if (typeof value === "boolean") result[name] = value;
      else if (value !== undefined)
        result[name] = name.endsWith("Instructions")
          ? [...value].sort().map(target => ({ target }))
          : describe(value.keys());
    }
    for (const element of result.elements ?? []) {
      const own = it.elements!.$get(keyOf(element.name, element.namespace))!;
      for (const name in own) if (own[name]) element[name] = describe(own[name]);
    }
    return result;
  }
  allowElement(element: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    const it = this.$impl;
    const [key, own] = [toElement(element), ownOf(element)];
    if (!it.elements && (own.attributes || own.removeAttributes!.size > 0)) return false;
    const wasReplaced = !!it.replaceWithChildrenElements?.$delete(key);
    if (!it.elements) return it.removeElements!.$delete(key) || wasReplaced;
    const keep = (names: Names | undefined, test: (key: string) => boolean) =>
      names && new Set([...names].filter(test));
    if (it.attributes) {
      own.attributes = keep(own.attributes, name => !it.attributes!.$has(name) && !(it.dataAttributes && isData(name)));
      own.removeAttributes = keep(own.removeAttributes, name => it.attributes!.$has(name));
    } else if (own.attributes) {
      own.attributes = keep(
        own.attributes,
        name => !own.removeAttributes?.$has(name) && !it.removeAttributes!.$has(name),
      );
      own.removeAttributes = undefined;
    } else own.removeAttributes = keep(own.removeAttributes, name => !it.removeAttributes!.$has(name));
    const old = it.elements.$get(key);
    if (old && isSame(old.attributes, own.attributes) && isSame(old.removeAttributes, own.removeAttributes))
      return wasReplaced;
    it.elements.$set(key, own);
    return true;
  }
  removeElement(element: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    return removeElement(this.$impl, toElement(element));
  }
  replaceElementWithChildren(element: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    const [it, key] = [this.$impl, toElement(element)];
    if (irreplaceable.$has(key) || it.replaceWithChildrenElements?.$has(key)) return false;
    (it.elements ?? it.removeElements)!.delete(key);
    (it.replaceWithChildrenElements ??= new Set()).$add(key);
    return true;
  }
  allowProcessingInstruction(pi: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    return toggle(this.$impl.processingInstructions, this.$impl.removeProcessingInstructions, target(pi));
  }
  removeProcessingInstruction(pi: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    return toggle(this.$impl.removeProcessingInstructions, this.$impl.processingInstructions, target(pi));
  }
  allowAttribute(attribute: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    const [it, key] = [this.$impl, toAttribute(attribute)];
    if ((it.dataAttributes && isData(key)) || it.attributes?.$has(key)) return false;
    if (it.attributes) for (const own of it.elements?.values() ?? []) own.attributes?.$delete(key);
    return toggle(it.attributes, it.removeAttributes, key);
  }
  removeAttribute(attribute: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    return removeAttribute(this.$impl, toAttribute(attribute));
  }
  setComments(allow: boolean) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this.$impl.comments !== (this.$impl.comments = !!allow);
  }
  setDataAttributes(allow: boolean) {
    if ($argumentCount() < 1) core.tooFew(1);
    const it = this.$impl;
    if (!it.attributes || it.dataAttributes === !!allow) return false;
    if ((it.dataAttributes = !!allow)) {
      for (const names of [it.attributes, ...Array.from(it.elements?.values() ?? [], own => own.attributes)]) {
        for (const key of names ?? []) if (isData(key)) names!.$delete(key);
      }
    }
    return true;
  }
  setJavascriptURLs(allow: boolean) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this.$impl.javascriptURLs !== (this.$impl.javascriptURLs = !!allow);
  }
  removeUnsafe() {
    return removeUnsafe(this.$impl);
  }
}
core.expose(Sanitizer);

function configOf(value: any, isPermissive: boolean): Config {
  if (value === null || $isObject(value)) return parseConfig(value ?? {}, isPermissive);
  if (`${value}` !== "default") throw new TypeError(`The provided value '${value}' is not a valid enum value.`);
  return defaultConfig();
}

const navigating = new Set([
  ...splitTokens("a:href area:href base:href button:formaction form:action input:formaction").map(it =>
    keyOf(it, HTML),
  ),
  keyOf("a:href", SVG),
]);
const animating = new Set(splitTokens("animate animateMotion animateTransform set").map(it => keyOf(it, SVG)));

function runsScript(node: N, element: string, key: string): boolean {
  const [name, namespace, value] = [core.attrLocalName(key), core.attrNamespace(key), core.getAttr(node, key)!];
  if (animating.$has(element) && name === "attributeName") return value === "href" || value === "xlink:href";
  if (namespace !== null && (namespace !== XLINK_NS || node.ns === core.HTML)) return false;
  const navigates =
    node.ns === core.MATHML ? name === "href" : navigating.$has(keyOf(node.name + ":" + name, core.namespaceOf(node)));
  return navigates && URL.parse(value)?.protocol === "javascript:";
}

function allows(it: Config, own: Own | undefined, key: string): boolean {
  if (own?.removeAttributes?.$has(key)) return false;
  if (it.attributes)
    return it.attributes.$has(key) || !!own?.attributes?.$has(key) || (!!it.dataAttributes && isData(key));
  return own?.attributes?.$has(key) !== false && !it.removeAttributes!.$has(key);
}

function sanitize(parent: N, it: Config, isSafe: boolean) {
  for (let node = parent.first, next; node !== null; node = next) {
    next = node.next;
    if (node.type !== ELEMENT) {
      const isAllowed = it.processingInstructions?.$has(node.name) ?? !it.removeProcessingInstructions!.$has(node.name);
      if (node.type === COMMENT ? !it.comments : node.type === INSTRUCTION && !isAllowed) core.remove(node);
      continue;
    }
    const element = keyOf(node.name, core.namespaceOf(node));
    if (it.replaceWithChildrenElements?.$has(element)) {
      next = node.first ?? next;
      while (node.first !== null) core.insert(node.first, parent, node);
      core.remove(node);
      continue;
    }
    if (it.elements ? !it.elements.$has(element) : it.removeElements!.$has(element)) {
      core.remove(node);
      continue;
    }
    if (core.isHtml(node, "template")) sanitize(node.x, it, isSafe);
    if (node.flags & core.flags.HOST && !(node.rare!.shadow!.flags & core.flags.USER_AGENT))
      sanitize(node.rare!.shadow!, it, isSafe);
    for (const key of attributeKeys(node)) {
      const isUnsafe = (isSafe && key.startsWith("on")) || (!it.javascriptURLs && runsScript(node, element, key));
      if (!isUnsafe && allows(it, it.elements?.$get(element), keyOf(core.attrLocalName(key), core.attrNamespace(key))))
        continue;
      core.removeAttr(node, key);
      if (key === "is") node.rare!.is = null;
    }
    sanitize(node, it, isSafe);
  }
}

/** What sanitizes a tree of an inert document. */
function fromOption(value: any, isSafe: boolean): (root: N) => void {
  if (value === undefined) value = isSafe ? "default" : {};
  const config =
    value instanceof Sanitizer || value?.$impl?.javascriptURLs !== undefined
      ? structuredClone(value.$impl)
      : configOf(value, !isSafe);
  if (isSafe) removeUnsafe(config);
  return root => sanitize(root, config, isSafe);
}

export default { fromOption };
