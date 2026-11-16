const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const nodes = require("internal/desktop/dom/node");
const html = require("internal/desktop/dom/html");
const ranges = require("internal/desktop/dom/range");
const parsing = require("internal/desktop/dom/parser");
const editing = require("internal/desktop/dom/editing");
const interactive = require("internal/desktop/dom/interactive");
const loader = require("internal/desktop/dom/loader");
const { createTimeline, getAnimations } = require("internal/desktop/dom/animation");
const { hasSheets } = require("internal/desktop/dom/cssom");
const { rectAt } = require("internal/desktop/dom/geometry");

const { CDATA, COMMENT, DOCTYPE, DOCUMENT, ELEMENT, HTML, INSTRUCTION, Kind, SVG, kinds } = core;
const { asciiLower, domError, expose, getAttr, hasAttr, isHtml, react, same, sync, unwrap, wrap, wrapOrNull } = core;
const { hooks, splitTokens } = core;
const { Node, ShadowRoot, kList, liveElements } = nodes;

type N = $Dom.N;
type Doc = $Dom.Doc;
type Page = $Dom.Page;

function titleElement(doc: Doc): N | null {
  const root = core.documentElement(doc);
  if (root?.ns !== SVG || root.name !== "svg") return core.findDescendant(doc.node, node => isHtml(node, "title"));
  return core.elementChildren(root).find(node => node.ns === SVG && node.name === "title") ?? null;
}

function titleOf(doc: Doc): string {
  const element = titleElement(doc);
  return element === null ? "" : core.splitTokens(core.childText(element)).join(" ");
}

function encodingName({ encoding }: Doc): string {
  return encoding === "utf-8" ? "UTF-8" : require("internal/desktop/web/encoding").nameOf(encoding);
}

function createElement(doc: Doc, namespace: string | null, prefix: string | null, local: string, options: any) {
  const { customElementRegistry, is } = $isObject(options) ? options : ({} as any);
  if (customElementRegistry !== undefined && is !== undefined) {
    throw domError("NotSupportedError", "The custom element registry and the is value cannot both be given.");
  }
  const before = core.setRegistry(hooks.registryOption(customElementRegistry, doc), doc);
  try {
    return wrap(core.createElementNS(doc, namespace, prefix, local, is === undefined ? null : `${is}`, true));
  } finally {
    core.setRegistry(before);
  }
}

function caretAt(doc: Doc, x: number, y: number): [N, number] | null {
  const found = isInViewport(doc.page, x, y) ? sync(doc).pointAt(1, +x, +y) : [];
  return found.length === 0 || found[0] === 0 ? null : ranges.fromEngine(doc, found[0], found[1]);
}

class CaretPosition {
  declare $impl: [N, number];

  constructor() {
    core.illegalConstructor();
  }
  get offsetNode() {
    return wrap(core.outOfControl(this.$impl[0]));
  }
  get offset() {
    return this.$impl[1];
  }
  getClientRect() {
    const [node, offset] = this.$impl;
    if (node.scope === null) return null;
    const [x, y, , height] = sync(node.doc).caretRect(ranges.pointId(node), ranges.pointOffset(node, offset), false);
    return rectAt([x, y, 0, height]);
  }
}
expose(CaretPosition);

const transitions = () => require("internal/desktop/dom/view_transition");
for (const name of ["ViewTransition", "ViewTransitionTypeSet"])
  new core.Interface(name, () => (transitions(), core.interfaces[name]));

const nameStart =
  ":A-Z_a-z\\xc0-\\xd6\\xd8-\\xf6\\xf8-\\u02ff\\u0370-\\u037d\\u037f-\\u1fff\\u200c\\u200d\\u2070-\\u218f\\u2c00-\\u2fef\\u3001-\\ud7ff\\uf900-\\ufdcf\\ufdf0-\\ufffd\\u{10000}-\\u{effff}";
const isXmlName = new RegExp(`^[${nameStart}][${nameStart}\\-.0-9\\xb7\\u0300-\\u036f\\u203f\\u2040]*$`, "u");

function requireHtml(document: any) {
  if (!document.$impl.doc.isHtml) throw domError("InvalidStateError", "This is only supported on HTML documents.");
}

function requireMarkupInsertion(document: any) {
  requireHtml(document);
  if (document.$impl.doc.forbidsMarkupInsertion > 0)
    throw domError("InvalidStateError", "The parser is in the middle of a step.");
}

function removeListenersIn(root: N) {
  for (let node: N | null = root; node !== null; node = core.following(node, root)) {
    events.removeAllListeners(node);
    if (node.flags & core.flags.HOST) removeListenersIn(node.rare!.shadow!);
  }
}

/** https://html.spec.whatwg.org/#document-open-steps */
function open(doc: Doc) {
  const { page } = doc;
  if ((doc.parser !== null && doc.parser.scripts > 0) || page?.isUnloading || doc.wasParserAborted) return;
  const entry: Page =
    (page?.host.owner && require("internal/desktop/dom/exotic").callingWindow(true)?.x) || core.realm.page;
  page?.host.cancelNavigation?.();
  removeListenersIn(doc.node);
  if (page !== null) events.removeAllListeners(page.target);
  core.replaceAll(null, doc.node);
  if (page !== null && !page.isDisposed && page.host.isActive?.() !== false) {
    if (entry !== page) page.history().replaceUrl(page, entry.doc.url.replace(/#.*/s, ""));
    page.host.opened?.();
  }
  core.setQuirks(doc, 0);
  const old = doc.parser;
  old?.abort();
  startParser(doc).isFromScript = true;
  if (old !== null) page?.allowLoad();
}

function abortParser({ doc, host }: Page) {
  if (doc.parser === null) return;
  doc.parser.abort();
  doc.parser = null;
  doc.wasParserAborted = true;
  setReadyState(doc, "interactive");
  setReadyState(doc, "complete");
  host.loaded?.("load");
}

const xpath = () => require("internal/desktop/dom/xpath").evaluator;

function setReadyState(doc: Doc, state: string) {
  if (doc.readyState === state) return;
  doc.readyState = state;
  events.fire(doc.node, "readystatechange");
}

function startParser(doc: Doc): $Dom.Parser {
  const parser = (doc.parser = new parsing.Parser(doc));
  const { page } = doc;
  parser.allowShadow = true;
  parser.onScript = script => {
    if (parser.scripts === 0) events.microtaskCheckpoint();
    if (page !== null && page.renderBlockers.size > 0) loader.isRenderBlocked(page);
    loader.prepareScript(script);
  };
  parser.onEnd = () => {
    doc.parser = null;
    if (page === null) doc.readyState = "complete";
    else {
      core.invalidate(doc);
      finishParsing(page);
    }
  };
  page?.delayLoad();
  setReadyState(doc, "loading");
  return parser;
}

async function finishParsing(page: Page) {
  const { doc } = page;
  page.reached("domInteractive");
  setReadyState(doc, "interactive");
  for (const loading of page.deferredScripts.splice(0)) {
    const [run] = await Promise.all([loading, ...page.blockingSheets]);
    if (page.isDisposed) return;
    page.runAsTask(run);
  }
  page.queueTask(() => {
    page.reached("domContentLoadedEventStart");
    events.fire(doc.node, "DOMContentLoaded", true);
    page.reached("domContentLoadedEventEnd");
    page.container?.fit(page.sizesContainer);
    page.host.loaded?.("dom-ready");
    loader.takeRequests(page);
    page.allowLoad();
  });
}

function write(document: any, texts: unknown[], end: string) {
  const { doc } = document.$impl as N;
  const text = texts.map(it => `${it}`).join("") + end;
  requireMarkupInsertion(document);
  if (doc.wasParserAborted) return;
  if (doc.parser === null || (doc.parser.ended && doc.parser.scripts === 0)) {
    if (doc.ignoresDestructiveWrites > 0 || doc.page?.isUnloading) return;
    open(doc);
  }
  doc.parser!.write(text);
  doc.parser!.run();
  react();
}

const namedInAll = new Set(
  splitTokens("a button embed form frame frameset iframe img input map meta object select textarea"),
);
const nameInAll = (node: N) => (node.ns === core.HTML && namedInAll.$has(node.name) ? getAttr(node, "name") : null);

class AllElements extends nodes.Elements {
  named(name: string) {
    const matches = (node: N) => getAttr(node, "id") === name || nameInAll(node) === name;
    const all = this.items();
    const found = name === "" ? [] : all.filter(matches);
    return found.length > 1 ? nodes.liveElements(all[0].doc.node, matches) : wrapOrNull(found[0]);
  }
  names() {
    return this.items().flatMap(node => [getAttr(node, "id"), nameInAll(node)].filter(it => !!it) as string[]);
  }
}

class HTMLAllCollection {
  constructor() {
    core.illegalConstructor();
  }
  get length() {
    return this[kList].size();
  }
  namedItem(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].named(`${name}`);
  }
  item(nameOrIndex: unknown = undefined) {
    if (nameOrIndex === undefined) return null;
    const index = nodes.arrayIndex(`${nameOrIndex}`);
    return index >= 0 ? (this[kList].at(index) ?? null) : this[kList].named(`${nameOrIndex}`);
  }
}
expose(HTMLAllCollection);
nodes.iterable(HTMLAllCollection, false);

function namesInDocument(node: N): string[] {
  const id = node.name === "object" || node.name === "img" ? getAttr(node, "id") : null;
  return [id, getAttr(node, "name")].filter(it => !!it) as string[];
}

/** https://html.spec.whatwg.org/#dom-document-nameditem */
hooks.namesChanged = (doc: Doc) => {
  // As in Chromium, markup cannot replace the members of a document that a sanitizer works on.
  if (doc.page === null || (doc.named.size === 0 && doc.exposedNames === null)) return;
  const document = wrap(doc.node);
  const old = doc.exposedNames ?? new Set();
  const byName = new Map<string, N[]>();
  for (const node of Array.from(doc.named).sort(core.compareOrder)) {
    for (const name of new Set(namesInDocument(node))) byName.$set(name, [...(byName.$get(name) ?? []), node]);
  }
  for (const name of old) delete document[name];
  doc.exposedNames = new Set();
  for (const [name, found] of byName) {
    if (Object.hasOwn(document, name) || name === "location") continue;
    const matches = (node: N) => doc.named.$has(node) && namesInDocument(node).includes(name);
    let value;
    if (found.length > 1) value = same(doc.node, "document." + name, () => nodes.liveElements(doc.node, matches));
    else value = (found[0].name === "iframe" && found[0].x?.window) || wrap(found[0]);
    Object.defineProperty(document, name, {
      value: doc.mirror?.adopt(value) ?? value,
      enumerable: true,
      configurable: true,
    });
    doc.exposedNames.$add(name);
  }
};

function parseHtml(html: string, options: unknown, isSafe: boolean) {
  const sanitize = nodes.sanitizerFor(options, isSafe);
  const doc = createHtmlDoc();
  parsing.parseDocument(doc, html, true);
  sanitize?.(doc.node);
  return wrap(doc.node);
}

class FragmentDirective {
  constructor() {
    core.illegalConstructor();
  }
}
expose(FragmentDirective);

class Document extends Node {
  constructor() {
    if (!core.hasPending()) {
      const doc = core.createDoc();
      doc.isHtml = false;
      doc.contentType = "application/xml";
      core.setPending(doc.node);
    }
    super();
  }
  static parseHTMLUnsafe(html: string, options: any = {}) {
    if ($argumentCount() < 1) core.tooFew(1);
    return parseHtml(`${html}`, options, false);
  }
  static parseHTML(html: string, options: any = {}) {
    if ($argumentCount() < 1) core.tooFew(1);
    return parseHtml(`${html}`, options, true);
  }
  get implementation() {
    return same(this.$impl, "implementation", node => new DOMImplementation(ofDocument, node.doc));
  }
  get URL() {
    return this.$impl.doc.url;
  }
  get documentURI() {
    return this.$impl.doc.url;
  }
  get compatMode() {
    return this.$impl.doc.quirks ? "BackCompat" : "CSS1Compat";
  }
  get characterSet() {
    return encodingName(this.$impl.doc);
  }
  get charset() {
    return encodingName(this.$impl.doc);
  }
  get inputEncoding() {
    return encodingName(this.$impl.doc);
  }
  get contentType() {
    return this.$impl.doc.contentType;
  }
  get doctype() {
    return wrapOrNull(core.childArray(this.$impl).find(node => node.type === DOCTYPE));
  }
  get documentElement() {
    return wrapOrNull(core.documentElement(this.$impl.doc));
  }
  get rootElement() {
    const root = core.documentElement(this.$impl.doc);
    return root?.ns === SVG ? wrap(root) : null;
  }
  get scrollingElement() {
    core.brand(this);
    const { doc } = this.$impl;
    if (!doc.quirks) return this.documentElement;
    const body = core.bodyOf(doc);
    return body !== null && body.name === "body" && !html.isScrollableBody(body) ? core.wrap(body) : null;
  }
  get head() {
    return wrapOrNull(core.rootChild(this.$impl.doc, "head"));
  }
  get body() {
    return wrapOrNull(core.bodyOf(this.$impl.doc));
  }
  set body(value) {
    const { doc } = this.$impl;
    const body = core.nodeOf(value);
    if (value != null && body?.ns !== HTML) throw new TypeError("The value is not of type 'HTMLElement'.");
    const old = core.bodyOf(doc);
    const root = core.documentElement(doc);
    if (!(isHtml(body, "body") || isHtml(body, "frameset")) || root === null) {
      throw domError("HierarchyRequestError", "The new body element must be a 'BODY' or a 'FRAMESET' element.");
    }
    if (old === null) core.preInsert(body!, root, null);
    else if (old !== body) core.replaceChild(old, body!, old.parent!);
    react();
  }
  get title() {
    return titleOf(this.$impl.doc);
  }
  set title(value) {
    const { doc } = this.$impl;
    const root = core.documentElement(doc);
    let element = titleElement(doc);
    if (root?.ns === SVG && root.name === "svg") {
      if (element === null) core.insert((element = core.createPlainElement(doc, "title", SVG)), root, root.first);
    } else if (root?.ns !== HTML) return;
    else if (element === null) {
      const head = core.rootChild(doc, "head");
      if (head === null) return;
      core.insert((element = core.createPlainElement(doc, "title", HTML)), head, null);
    }
    core.replaceAllWithText(String(value), element);
    react();
  }
  get dir() {
    core.brand(this);
    return this.documentElement?.dir ?? "";
  }
  set dir(value) {
    this.documentElement?.setAttribute("dir", value);
  }
  get domain() {
    const { page, url } = this.$impl.doc;
    return URL.parse((page ?? core.realm.page).host.origin ?? url)?.hostname ?? "";
  }
  /** Agent clusters are by origin. */
  set domain(value) {
    const { page } = this.$impl.doc;
    const wanted = URL.parse(`http://${value}`)?.hostname;
    const { domain } = this;
    const isAllowed =
      page !== null &&
      !page.host.isSandboxed?.("allow-document-domain") &&
      domain !== "" &&
      !/[/:@?#\\]/.test(`${value}`.replace(/^.*]$/, ""));
    if (
      isAllowed &&
      (wanted === domain ||
        (domain.endsWith("." + wanted) && page.host.isSameSite?.("http://" + wanted, "http://" + domain)))
    )
      return;
    throw domError("SecurityError", `'${value}' is not a suffix of '${domain}'.`);
  }
  get referrer() {
    return this.$impl.doc.page?.host.referrer ?? "";
  }
  get cookie() {
    const text = this.$impl.doc.page?.host.cookie?.get();
    if (text === null) throw domError("SecurityError", "Cookies are disabled in this document.");
    return text ?? "";
  }
  set cookie(value) {
    value = `${value}`.toWellFormed();
    if (this.$impl.doc.page?.host.cookie?.get() === null)
      throw domError("SecurityError", "Cookies are disabled in this document.");
    this.$impl.doc.page?.host.cookie?.set(value);
  }
  get fragmentDirective() {
    return same(this.$impl, "fragmentDirective", () => Object.create(FragmentDirective.prototype));
  }
  get lastModified() {
    const date = new Date(Date.parse(this.$impl.doc.lastModified!) || Date.now());
    const two = (...parts: number[]) => parts.map(part => String(part).padStart(2, "0"));
    const day = [...two(date.getMonth() + 1, date.getDate()), String(date.getFullYear()).padStart(4, "0")];
    return day.join("/") + " " + two(date.getHours(), date.getMinutes(), date.getSeconds()).join(":");
  }
  get readyState() {
    return this.$impl.doc.readyState;
  }
  get currentScript() {
    return wrapOrNull(this.$impl.doc.currentScript);
  }
  get defaultView() {
    return this.$impl.doc.page?.window ?? null;
  }
  get location() {
    return this.$impl.doc.page?.window.location ?? null;
  }
  set location(value) {
    this.location.href = value;
  }
  get designMode() {
    return this.$impl.doc.designMode ? "on" : "off";
  }
  set designMode(value) {
    const { doc } = this.$impl;
    doc.designMode = asciiLower(String(value)) === "on";
    doc.page?.setSheet("designMode", doc.designMode ? ":root{-webkit-user-modify:read-write}" : null);
  }
  get hidden() {
    return !this.$impl.doc.page?.isVisible;
  }
  get visibilityState() {
    core.brand(this);
    return this.hidden ? "hidden" : "visible";
  }
  get wasDiscarded() {
    core.brand(this);
    return false;
  }
  get prerendering() {
    return false;
  }
  get timeline() {
    return this.$impl.doc.page?.timeline ?? same(this.$impl, "timeline", () => createTimeline(null));
  }
  get fonts() {
    return loader.fontsOf(this.$impl.doc.page ?? core.realm.page).js;
  }
  get fullscreenEnabled() {
    return interactive.isFullscreenEnabled(this.$impl.doc);
  }
  set fullscreenEnabled(_) {
    core.brand(this);
  }
  get webkitFullscreenEnabled() {
    return this.fullscreenEnabled;
  }
  get webkitIsFullScreen() {
    return this.fullscreen;
  }
  set fullscreen(_) {
    core.brand(this);
  }
  get fullscreen() {
    return interactive.fullscreenElement(this.$impl.doc) !== null;
  }
  get all() {
    const all = () => core.filterDescendants(this.$impl, () => true);
    return same(this.$impl, "all", node => {
      const list = nodes.collectionOf(node, all, HTMLAllCollection, AllElements);
      return require("internal/desktop/dom/exotic").undetectable(list, HTMLAllCollection.prototype.item);
    });
  }

  createExpression(_expression: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return xpath().createExpression.$apply(this, arguments);
  }
  createNSResolver(nodeResolver: object) {
    if ($argumentCount() < 1) core.tooFew(1);
    return xpath().createNSResolver(nodeResolver);
  }
  evaluate(_expression: string, _contextNode: object) {
    if ($argumentCount() < 2) core.tooFew(2);
    return xpath().evaluate.$apply(this, arguments);
  }

  createElement(name: string, options: any = undefined) {
    const { doc } = this.$impl;
    if (typeof name !== "string") {
      if ($argumentCount() < 1) core.tooFew(1);
      name = `${name}`;
    }
    if (doc.isHtml && options === undefined && kinds.html.$has(name) && !core.hasScopedRegistries()) {
      return wrap(core.createPlainElement(doc, name, HTML));
    }
    nodes.validateElementName(name);
    const isXhtml = doc.isHtml || doc.contentType === "application/xhtml+xml";
    const namespace = isXhtml ? core.namespaces[HTML] : null;
    const local = doc.isHtml ? asciiLower(name) : name;
    return createElement(doc, namespace, null, local, options);
  }
  createElementNS(namespace: string | null, name: string, options: any = undefined) {
    if ($argumentCount() < 2) core.tooFew(2);
    const { doc } = this.$impl;
    if (namespace === core.namespaces[SVG] && kinds.svg.$has(name) && !core.hasScopedRegistries()) {
      return wrap(core.createPlainElement(doc, name, SVG));
    }
    if ($argumentCount() < 2) core.tooFew(2);
    const [uri, prefix, local] = nodes.splitName(namespace, `${name}`, true);
    return createElement(doc, uri, prefix, local, options);
  }
  createTextNode(data: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return wrap(core.createText(this.$impl.doc, typeof data === "string" ? data : String(data)));
  }
  createComment(data: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return wrap(core.createData(this.$impl.doc, COMMENT, String(data)));
  }
  createDocumentFragment() {
    return wrap(core.createFragment(this.$impl.doc));
  }
  createCDATASection(data: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (this.$impl.doc.isHtml) throw domError("NotSupportedError", "This is not supported for HTML documents.");
    if ((data = String(data)).includes("]]>")) throw domError("InvalidCharacterError", "The data contains ']]>'.");
    return wrap(core.createData(this.$impl.doc, CDATA, data));
  }
  createProcessingInstruction(target: string, data: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    if (!isXmlName.test((target = String(target))))
      throw domError("InvalidCharacterError", "The target is not a valid name.");
    if ((data = String(data)).includes("?>")) throw domError("InvalidCharacterError", "The data contains '?>'.");
    return wrap(core.createData(this.$impl.doc, INSTRUCTION, data, target));
  }
  createAttribute(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    const { doc } = this.$impl;
    nodes.validateAttributeName((name = String(name)));
    return wrap(nodes.createAttr(doc, doc.isHtml ? asciiLower(name) : name, null, null, ""));
  }
  createAttributeNS(namespace: string | null, name: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    const [uri, prefix, local] = nodes.splitName(namespace, String(name), false);
    return wrap(nodes.createAttr(this.$impl.doc, local, prefix, uri, ""));
  }
  createEvent(name: string) {
    core.brand(this);
    if ($argumentCount() < 1) core.tooFew(1);
    return events.createEvent(String(name));
  }
  createRange() {
    return ranges.createRange(this.$impl);
  }
  createNodeIterator(root: any, whatToShow: number | undefined = undefined, filter?: any) {
    core.brand(this);
    return ranges.createTraversal(false, unwrap(root, "createNodeIterator"), whatToShow, filter);
  }
  createTreeWalker(root: any, whatToShow: number | undefined = undefined, filter?: any) {
    core.brand(this);
    return ranges.createTraversal(true, unwrap(root, "createTreeWalker"), whatToShow, filter);
  }
  importNode(value: any, options: any = false) {
    const node = unwrap(value, "importNode");
    if (node.type === DOCUMENT || node.flags & core.flags.SHADOW_ROOT) {
      throw domError("NotSupportedError", "This node may not be imported.");
    }
    const { doc } = this.$impl;
    const isDictionary = options === null || $isObject(options);
    const given = isDictionary ? options?.customElementRegistry : undefined;
    if (given === null) throw new TypeError("The value is not of type 'CustomElementRegistry'.");
    const copy = core.clone(
      node,
      doc,
      isDictionary ? !options?.selfOnly : !!options,
      null,
      hooks.registryOption(given, doc),
    );
    react();
    return wrap(copy);
  }
  adoptNode(value: any) {
    const node = unwrap(value, "adoptNode");
    if (node.type === DOCUMENT) throw domError("NotSupportedError", "A document may not be adopted.");
    if (node.flags & core.flags.SHADOW_ROOT)
      throw domError("HierarchyRequestError", "A shadow root may not be adopted.");
    if (node.type === core.ATTRIBUTE) value.ownerElement?.removeAttributeNode(value);
    core.adopt(node, this.$impl.doc);
    react();
    return value;
  }
  getElementsByName(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    const root = this.$impl;
    name = String(name);
    const find = () => core.filterDescendants(root, node => node.ns === HTML && getAttr(node, "name") === name);
    return same(root, "name " + name, () => nodes.collectionOf(root, find, nodes.NodeList, nodes.Nodes));
  }
  hasFocus() {
    return this.$impl.doc.page?.isFocused ?? false;
  }
  open(url: string | undefined = undefined, target?: string, features?: string) {
    if (arguments.length > 2) {
      const { page } = this.$impl.doc;
      if (page === null || page.isDisposed) throw domError("InvalidAccessError", "The document has no window.");
      return hooks.openWindow(page, url, target, features);
    }
    requireMarkupInsertion(this);
    open(this.$impl.doc);
    react();
    return this;
  }
  close() {
    requireMarkupInsertion(this);
    const { parser } = this.$impl.doc;
    if (parser === null || !parser.isFromScript) return;
    if (parser.scripts > 0) return void (parser.endsAfterScript = true);
    parser.ended = true;
    parser.run();
  }
  write(...texts: string[]) {
    write(this, texts, "");
  }
  writeln(...texts: string[]) {
    write(this, texts, "\n");
  }
  execCommand(name: string, _showsInterface: boolean | undefined = undefined, value = "") {
    if ($argumentCount() < 1) core.tooFew(1);
    requireHtml(this);
    const { page } = this.$impl.doc;
    if (page === null || page.isExecutingCommand) return false;
    page.isExecutingCommand = true;
    try {
      return editing.execute(page.doc, asciiLower(String(name)), String(value), true);
    } finally {
      page.isExecutingCommand = false;
    }
  }
  queryCommandSupported(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    requireHtml(this);
    return editing.isSupported(asciiLower(String(name)));
  }
  queryCommandEnabled(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    requireHtml(this);
    return this.$impl.doc.page !== null && editing.isEnabled(this.$impl.doc, asciiLower(String(name)));
  }
  queryCommandState(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    requireHtml(this);
    return this.$impl.doc.page !== null && editing.commands().state(this.$impl.doc, asciiLower(String(name)));
  }
  queryCommandIndeterm(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    requireHtml(this);
    return this.$impl.doc.page !== null && editing.commands().isIndeterminate(this.$impl.doc, asciiLower(String(name)));
  }
  queryCommandValue(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    requireHtml(this);
    return this.$impl.doc.page === null ? "" : editing.commands().value(this.$impl.doc, asciiLower(String(name)));
  }
  caretRangeFromPoint(x = 0, y = 0) {
    const found = caretAt(this.$impl.doc, x | 0, y | 0);
    if (found === null) return null;
    let [node, offset] = found;
    for (let root; (root = core.rootOf(node)) !== this.$impl;) {
      const host = core.hostOf(root);
      [node, offset] = [host.parent!, core.indexOf(host)];
    }
    return ranges.rangeOf(node, offset, node, offset);
  }
  caretPositionFromPoint(x: number, y: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    const found = caretAt(this.$impl.doc, x, y);
    if (found === null) return null;
    const position = Object.create(CaretPosition.prototype);
    position.$impl = found;
    return position;
  }
  async exitFullscreen() {
    await interactive.exitFullscreen(this.$impl.doc);
  }
  webkitExitFullscreen() {
    if (this.fullscreen) interactive.exitFullscreen(this.$impl.doc);
  }
  webkitCancelFullScreen() {
    const { page } = this.$impl.doc;
    if (page !== null) interactive.exitFullscreenFully(page);
  }
  exitPointerLock() {
    const { page } = this.$impl.doc;
    if (page !== null) hooks.exitPointerLock(page);
  }
  startViewTransition(update: any = undefined) {
    return transitions().start(this.$impl.doc.page, update, null);
  }
  get activeViewTransition() {
    return this.$impl.doc.page?.transition?.js ?? null;
  }
  async hasStorageAccess() {
    return true;
  }
  async requestStorageAccess() {}
  captureEvents() {}
  releaseEvents() {}
  clear() {}
}

const named = (name: string) => (node: N) => isHtml(node, name);
for (const [property, test] of Object.entries({
  anchors: (node: N) => isHtml(node, "a") && hasAttr(node, "name"),
  applets: () => false,
  embeds: named("embed"),
  forms: named("form"),
  images: named("img"),
  links: (node: N) => (isHtml(node, "a") || isHtml(node, "area")) && hasAttr(node, "href"),
  plugins: named("embed"),
  scripts: named("script"),
})) {
  core.accessor(Document.prototype, property, function (this: Document) {
    return same(this.$impl, property === "plugins" ? "embeds" : property, node => liveElements(node, test));
  });
}

for (const [property, attribute] of Object.entries({
  alinkColor: "alink",
  bgColor: "bgcolor",
  fgColor: "text",
  linkColor: "link",
  vlinkColor: "vlink",
})) {
  core.accessor(
    Document.prototype,
    property,
    function (this: Document) {
      const body = core.bodyOf(this.$impl.doc);
      return (isHtml(body, "body") && getAttr(body!, attribute)) || "";
    },
    function (this: Document, value) {
      const body = core.bodyOf(this.$impl.doc);
      if (isHtml(body, "body")) core.setAttr(body!, attribute, value === null ? "" : `${value}`);
      react();
    },
  );
}

/** `node` as the scripts of `scope` see it. */
function seenFrom(scope: N, node: N | null): N | null {
  const found = core.retarget(node, scope);
  return found !== null && found.scope === scope ? found : null;
}

function elementFor(scope: N, id: number): N | null {
  const found = scope.doc.nodes[id];
  return found ? core.retarget(found.type === ELEMENT ? found : core.flatParent(found), scope) : null;
}

function isInViewport(page: Page | null, x: number, y: number): boolean {
  if (!Number.isFinite(+x) || !Number.isFinite(+y)) throw new TypeError("The provided double value is non-finite.");
  return page !== null && x >= 0 && y >= 0 && x < page.width && y < page.height;
}

const documentOrShadowRoot = {
  get customElementRegistry() {
    return core.registryOf((this as any).$impl);
  },
  get activeElement() {
    const scope: N = (this as any).$impl;
    const { doc } = scope;
    const found = seenFrom(scope, doc.focused);
    return wrapOrNull(found ?? (scope === doc.node ? (core.bodyOf(doc) ?? core.documentElement(doc)) : null));
  },
  get fullscreenElement() {
    const scope: N = (this as any).$impl;
    return wrapOrNull(seenFrom(scope, interactive.fullscreenElement(scope.doc)));
  },
  set fullscreenElement(_) {
    core.brand(this);
  },
  get webkitCurrentFullScreenElement() {
    return this.fullscreenElement;
  },
  get webkitFullscreenElement() {
    return this.fullscreenElement;
  },
  get pointerLockElement() {
    const scope: N = (this as any).$impl;
    return wrapOrNull(seenFrom(scope, scope.doc.page?.mouse.lock ?? null));
  },
  get pictureInPictureElement() {
    return null;
  },
  elementFromPoint(this: any, x: number, y: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    const { doc }: N = this.$impl;
    if (!isInViewport(doc.page, x, y)) return null;
    const found = elementFor(this.$impl, sync(doc).hitTest(+x, +y));
    const area = isHtml(found, "img") && hasAttr(found!, "usemap") ? html.areaAt(found!, +x, +y) : null;
    return wrapOrNull(area ?? found ?? core.documentElement(doc));
  },
  elementsFromPoint(this: any, x: number, y: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    const { doc }: N = this.$impl;
    if (!isInViewport(doc.page, x, y)) return [];
    const found: N[] = [];
    const seen = new Set<number>();
    for (const id of sync(doc).hitTestAll(+x, +y)) {
      const node = elementFor(this.$impl, id);
      const isItself = node === doc.nodes[id];
      if (node !== null && node !== found.at(-1) && (isItself || !seen.$has(node.id))) found.push(node);
      seen.$add(node?.id ?? 0);
    }
    const root = core.documentElement(doc);
    if (root !== null && !found.includes(root)) found.push(root);
    return found.map(node => wrap(node));
  },
  getSelection(this: any) {
    return this.$impl.doc.page === null ? null : ranges.wrapSelection(this.$impl.doc, this.$impl);
  },
  getAnimations(this: any) {
    return getAnimations(this.$impl, true);
  },
};
core.mixin(documentOrShadowRoot, Document, ShadowRoot);
core.mixin(hasSheets, Document, ShadowRoot);
core.mixin(nodes.parentNode, Document);
core.mixin(nodes.elementLookups, Document);
core.mixin(nodes.elementById, Document);
events.defineHandlers(Document.prototype, events.globalHandlers);
events.defineHandlers(Document.prototype, events.clipboardHandlers);
events.defineHandlers(
  Document.prototype,
  core.splitTokens(`readystatechange visibilitychange fullscreenchange fullscreenerror webkitfullscreenchange
  webkitfullscreenerror pointerlockchange
  pointerlockerror freeze resume`),
);

Object.defineProperty(Document.prototype, Symbol.unscopables, {
  value: { __proto__: null, append: true, fullscreen: true, prepend: true, replaceChildren: true },
  configurable: true,
});

class HTMLDocument extends Document {}
class XMLDocument extends Document {
  constructor() {
    if (!core.hasPending()) core.illegalConstructor();
    super();
  }
}
for (const ctor of [Document, HTMLDocument, XMLDocument]) expose(ctor);
kinds.document = new Kind(Document);
kinds.xmlDocument = new Kind(XMLDocument);
const htmlDocument = new Kind(HTMLDocument);

function createHtmlDoc(page?: Page): Doc {
  const doc = core.createDoc(page);
  doc.node.kind = htmlDocument;
  return doc;
}

function createXmlDoc(contentType: string): Doc {
  const doc = core.createDoc();
  doc.node.kind = kinds.xmlDocument;
  doc.isHtml = false;
  doc.contentType = contentType;
  return doc;
}

const ofDocument = Symbol();
class DOMImplementation {
  #doc: Doc;

  constructor(key: unknown = undefined, doc?: Doc) {
    if (key !== ofDocument) core.illegalConstructor();
    this.#doc = doc!;
  }
  hasFeature() {
    void this.#doc;
    return true;
  }
  createDocumentType(name: string, publicId: string, systemId: string) {
    if ($argumentCount() < 3) core.tooFew(3);
    if (/[\0\t\n\f\r >]/.test(name)) throw domError("InvalidCharacterError", "The name is not valid.");
    return wrap(core.createDoctype(this.#doc, String(name), String(publicId), String(systemId)));
  }
  createDocument(namespace: string | null, name: string | null, doctype: any = null) {
    void this.#doc;
    if ($argumentCount() < 2) core.tooFew(2);
    const types = ["application/xhtml+xml", "image/svg+xml"];
    const document = wrap(createXmlDoc(types[core.namespaces.indexOf(namespace!)] ?? "application/xml").node);
    const root = name !== null && name !== "" ? document.createElementNS(namespace, name) : null;
    if (doctype !== null) document.appendChild(doctype);
    if (root !== null) document.appendChild(root);
    return document;
  }
  createHTMLDocument(title: string | undefined = undefined) {
    void this.#doc;
    const doc = createHtmlDoc();
    parsing.parseDocument(doc, title === undefined ? "<!doctype html>" : "<!doctype html><title></title>");
    if (title !== undefined) core.insert(core.createText(doc, String(title)), titleElement(doc)!, null);
    return wrap(doc.node);
  }
}
expose(DOMImplementation);

class DOMParser {
  #page: Page = core.realm.page;
  parseFromString(source: string, type: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    const isHtmlType = type === "text/html";
    if (!isHtmlType && !/^(?:text\/xml|application\/(?:xhtml\+)?xml|image\/svg\+xml)$/.test(type)) {
      throw new TypeError(`The provided value '${type}' is not a valid enum value of type DOMParserSupportedType.`);
    }
    const doc = isHtmlType ? createHtmlDoc() : createXmlDoc(type);
    doc.url = doc.baseUrl = this.#page.doc.url;
    (isHtmlType ? parsing.parseDocument : parsing.parseXmlDocument)(doc, String(source));
    return wrap(doc.node);
  }
}
expose(DOMParser);

/** The scripts, event handlers and `javascript:` URLs that a document came with, and its policies after a NUL. */
function inlineScriptsOf(source: string, xmlType: string | undefined) {
  const doc = xmlType === undefined ? createHtmlDoc() : createXmlDoc(xmlType);
  if (xmlType === undefined) parsing.parseDocument(doc, source, true, true);
  else parsing.parseXmlDocument(doc, source);
  const found = new Set<string>();
  const roots = [doc.node];
  for (const root of roots) {
    for (let node: N | null = root; node !== null; node = core.following(node, root)) {
      if (isHtml(node, "template")) roots.push(node.x);
      const { rare } = node;
      if (rare?.shadow) roots.push(rare.shadow);
      if (node.name === "script" && require("internal/desktop/dom/loader").scriptType(node) !== null)
        found.$add(core.childText(node));
      const attrs = node.attrs ?? [];
      for (let i = 0; i < attrs.length; i += 2) {
        const [name, value] = [attrs[i], attrs[i + 1]];
        if (name.startsWith("on")) found.$add(value);
        else if (name === "href" && value.startsWith("javascript:")) found.$add(value.slice("javascript:".length));
        else if (name === "content" && isHtml(node, "meta") && isHtml(node.parent, "head")) found.$add("\0" + value);
      }
    }
  }
  return found;
}

/** Of `XMLHttpRequest`. Null if it is not well-formed. */
function parseResponse(source: string, { isHtml, contentType, encoding, url, lastModified }: any) {
  const doc = isHtml ? createHtmlDoc() : createXmlDoc(contentType);
  Object.assign(doc, { url, baseUrl: url, encoding, lastModified });
  if (isHtml) parsing.parseDocument(doc, source);
  else if (!parsing.parseXmlDocument(doc, source)) return null;
  return wrap(doc.node);
}

class XMLSerializer {
  serializeToString(root: any) {
    return parsing.serializeXml(unwrap(root, "serializeToString"));
  }
}
expose(XMLSerializer);

export default { abortParser, createHtmlDoc, inlineScriptsOf, parseResponse, setReadyState, startParser, titleOf };
