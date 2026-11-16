const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");

const { ELEMENT, ATTRIBUTE, TEXT, CDATA, INSTRUCTION, COMMENT, DOCUMENT, DOCTYPE, FRAGMENT, HTML } = core;
const { Kind, N, kinds, hooks, flags, realm, XML_NS, XMLNS_NS } = core;
const { domError, expose, getAttr, illegalConstructor, rare, react, setAttr, unwrap, wrap, wrapOrNull } = core;
const { hasPending, prefixOf, scopeOf, setPending } = core;
const { asciiLower, engineFor, following, isData, isText, qualifiedName, same, splitTokens, sync } = core;
const { CONNECTED, HOST, SHADOW_ROOT, USER_AGENT } = flags;

type N = $Dom.N;
type Doc = $Dom.Doc;
type Page = $Dom.Page;

// ───────────────────────────── collections ─────────────────────────────

/** The state of an object that is behind a proxy, which has no `$impl`. */
const kList = Symbol("list");

function arrayIndex(key: string): number {
  const code = key.charCodeAt(0);
  if (!(code >= 48 && code <= 57)) return -1;
  const index = +key;
  return index >>> 0 === index && index !== 0xffffffff && (code !== 48 || key.length === 1) ? index : -1;
}

type List = {
  size(): number;
  at(index: number): any;
  named?(name: string): any;
  names?(): string[];
  set?(index: number, value: any): void;
  overridesBuiltIns?: boolean;
};

/** https://webidl.spec.whatwg.org/#dfn-named-property-visibility */
function visiblyNamed(target: any, key: string) {
  const list: List = target[kList];
  if (list.named === undefined || (list.overridesBuiltIns ? Object.hasOwn(target, key) : key in target)) return null;
  return list.named(key);
}

const indexed: ProxyHandler<any> = {
  get(target, key, receiver) {
    if (typeof key === "string") {
      const index = arrayIndex(key);
      if (index >= 0) return target[kList].at(index) ?? Reflect.get(target, key, receiver);
      if (key === "length" && !target[kList].overridesBuiltIns) return target[kList].size();
      const named = visiblyNamed(target, key);
      if (named != null) return named;
    }
    return Reflect.get(target, key, receiver);
  },
  has(target, key) {
    return indexed.getOwnPropertyDescriptor!(target, key) !== undefined || key in target;
  },
  set(target, key, value, receiver) {
    const isItem = typeof key === "string" && (arrayIndex(key) >= 0 || visiblyNamed(target, key) != null);
    if (!isItem) return Reflect.set(target, key, value, receiver);
    if (arrayIndex(key) < 0) return false;
    const list: List = target[kList];
    if (list.set === undefined && arrayIndex(key) < list.size()) return false;
    return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true });
  },
  deleteProperty(target, key) {
    if (typeof key !== "string") return Reflect.deleteProperty(target, key);
    if (arrayIndex(key) >= 0) return arrayIndex(key) >= target[kList].size();
    return visiblyNamed(target, key) == null && Reflect.deleteProperty(target, key);
  },
  defineProperty(target, key, descriptor) {
    const list: List = target[kList];
    if (typeof key === "string" && arrayIndex(key) >= 0) {
      if (list.set === undefined || "get" in descriptor || "set" in descriptor) return false;
      list.set(arrayIndex(key), descriptor.value);
      return true;
    }
    const isItem =
      typeof key === "string" && (list.overridesBuiltIns || !Object.hasOwn(target, key)) && list.named?.(key) != null;
    return !isItem && Reflect.defineProperty(target, key, descriptor);
  },
  preventExtensions: () => false,
  ownKeys(target) {
    const list: List = target[kList];
    const keys = Array.from({ length: list.size() }, (_, index) => "" + index);
    const names = list.names?.().filter(name => arrayIndex(name) < 0 && visiblyNamed(target, name) != null) ?? [];
    return [...new Set([...keys, ...names, ...Reflect.ownKeys(target)])].filter(key => key !== kList);
  },
  getOwnPropertyDescriptor(target, key) {
    if (typeof key === "string") {
      const list: List = target[kList];
      const index = arrayIndex(key);
      const value = index >= 0 ? list.at(index) : visiblyNamed(target, key);
      const writable = index >= 0 && list.set !== undefined;
      if (value != null) return { value, writable, enumerable: index >= 0, configurable: true };
    }
    return key === kList ? undefined : Reflect.getOwnPropertyDescriptor(target, key);
  },
};

hooks.wrapAsList = (node, list) => {
  Object.defineProperty(node.js, kList, { value: list, configurable: true });
  const facade = require("internal/desktop/dom/exotic").facade(new Proxy(node.js, indexed), node);
  return facade.$impl === node ? (node.js = facade) : node.js;
};

function makeList<T extends List>(ctor: any, list: T) {
  const target = Object.create(ctor.prototype);
  Object.defineProperty(target, kList, { value: list, configurable: true });
  return new Proxy(target, indexed);
}

/**
 * For what is not worth a proxy, when its `length` is read. Accessors for indexes on a prototype would make all arrays
 * slow.
 */
function setIndexes(object: object, values: ArrayLike<unknown>): number {
  for (let i = 0; i < values.length; i++) object[i] = values[i];
  for (let i = values.length; i in object; i++) delete object[i];
  return values.length;
}

function iterable(ctor: any, withForEach: boolean): void {
  if (ctor instanceof core.Interface) return core.extend(ctor, it => iterable(it, withForEach));
  const { entries, keys, values, forEach } = Array.prototype;
  if (withForEach) Object.assign(ctor.prototype, { entries, keys, values, forEach });
  Object.defineProperty(ctor.prototype, Symbol.iterator, { value: values, writable: true, configurable: true });
}

class Nodes {
  items: () => N[];
  constructor(items: () => N[]) {
    this.items = items;
  }
  size() {
    return this.items().length;
  }
  at(index: number) {
    const node = this.items()[index];
    return node === undefined ? undefined : (node.js ?? wrap(node));
  }
}

class Elements extends Nodes {
  named(name: string) {
    if (name === "") return null;
    const matches = (node: N) => getAttr(node, "id") === name || (node.ns === HTML && getAttr(node, "name") === name);
    return wrapOrNull(this.items().find(matches));
  }
  names() {
    return this.items().flatMap(
      node => [getAttr(node, "id"), node.ns === HTML && getAttr(node, "name")].filter(it => !!it) as string[],
    );
  }
}

class NodeList {
  constructor() {
    illegalConstructor();
  }
  get length() {
    return this[kList].size();
  }
  item(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].at(index >>> 0) ?? null;
  }
}
iterable(NodeList, true);
expose(NodeList);

class HTMLCollection {
  constructor() {
    illegalConstructor();
  }
  get length() {
    return this[kList].size();
  }
  item(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].at(index >>> 0) ?? null;
  }
  namedItem(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].named(String(name)) ?? null;
  }
}
iterable(HTMLCollection, false);
expose(HTMLCollection);

function staticList(nodes: N[]) {
  const list = Object.create(NodeList.prototype);
  Object.defineProperty(list, kList, { value: new Nodes(() => nodes) });
  for (let i = 0; i < nodes.length; i++) list[i] = nodes[i].js ?? wrap(nodes[i]);
  return list;
}

/** `compute` runs again after the document changed. */
function cached(root: N, compute: () => N[], readsAttributes = true): () => N[] {
  let doc: Doc;
  let version = -1;
  let items: N[];
  const forget = (evenIfCurrent: boolean) => {
    if (!evenIfCurrent && doc === root.doc && version === doc.version + (readsAttributes ? doc.attributeVersion : 0))
      return false;
    items = [];
    version = -1;
    return true;
  };
  return () => {
    const now = root.doc.version + (readsAttributes ? root.doc.attributeVersion : 0);
    if (now !== version || doc !== root.doc) {
      if (version === -1 && root.doc.page !== null) root.doc.cachedLists.push(forget);
      items = compute();
      version = now;
      doc = root.doc;
    }
    return items;
  };
}

function liveElements(root: N, test: (node: N) => boolean, readsAttributes = true) {
  const items = cached(root, () => core.filterDescendants(root, test), readsAttributes);
  return makeList(HTMLCollection, new Elements(items));
}

function collectionOf(root: N, compute: () => N[], ctor: any = HTMLCollection, Kind: any = Elements) {
  return makeList(ctor, new Kind(cached(root, compute)));
}

function byTagName(root: N, name: string) {
  return same(root, (root.doc.isHtml ? "tag " : "xml tag ") + name, () => {
    if (name === "*") return liveElements(root, () => true, false);
    const lower = root.doc.isHtml ? asciiLower(name) : name;
    return liveElements(root, node => qualifiedName(node) === (node.ns === HTML ? lower : name), false);
  });
}

function byTagNameNS(root: N, namespace: string | null, name: string) {
  namespace ||= null;
  const test = (node: N) =>
    (namespace === "*" || core.namespaceOf(node) === namespace) && (name === "*" || node.name === name);
  return liveElements(root, test, false);
}

function byClassName(root: N, names: string) {
  return same(root, "class " + names, () => {
    const wanted = splitTokens(names);
    return liveElements(root, node => {
      const value = getAttr(node, "class");
      if (value === null || wanted.length === 0) return false;
      if (node.doc.quirks) return wanted.every(name => splitTokens(asciiLower(value)).includes(asciiLower(name)));
      if (!value.includes(wanted[0])) return false;
      const tokens = splitTokens(value);
      return wanted.every(name => tokens.includes(name));
    });
  });
}

class Tokens {
  node: N;
  attribute: string;
  supported: string[] | undefined;
  source: string | null = null;
  tokens: string[] = [];
  constructor(node: N, attribute: string, supported?: string[]) {
    this.node = node;
    this.attribute = attribute;
    this.supported = supported;
  }
  items(): string[] {
    const source = getAttr(this.node, this.attribute);
    if (source !== this.source) {
      this.source = source;
      this.tokens = [...new Set<string>(splitTokens(source))];
    }
    return this.tokens;
  }
  size() {
    return this.items().length;
  }
  at(index: number) {
    return this.items()[index];
  }
  update(tokens: string[]) {
    if (this.source === null && tokens.length === 0) return;
    setAttr(this.node, this.attribute, tokens.join(" "));
    react();
  }
}

function validToken(token: any): string {
  token = String(token);
  if (token === "") throw domError("SyntaxError", "The token provided must not be empty.");
  if (/[\t\n\f\r ]/.test(token)) {
    throw domError("InvalidCharacterError", `The token provided ('${token}') contains HTML space characters.`);
  }
  return token;
}

class DOMTokenList {
  constructor() {
    illegalConstructor();
  }
  get length() {
    return this[kList].size();
  }
  get value() {
    return getAttr(this[kList].node, this[kList].attribute) ?? "";
  }
  set value(value) {
    setAttr(this[kList].node, this[kList].attribute, String(value));
    react();
  }
  item(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].at(index >>> 0) ?? null;
  }
  contains(token: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].items().includes(String(token));
  }
  add(...tokens: string[]) {
    this[kList].update([...new Set([...this[kList].items(), ...tokens.map(validToken)])]);
  }
  remove(...tokens: string[]) {
    tokens = tokens.map(validToken);
    this[kList].update(this[kList].items().filter(token => !tokens.includes(token)));
  }
  toggle(token: string, force: boolean | undefined = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    token = validToken(token);
    const items: string[] = this[kList].items();
    const has = items.includes(token);
    const wanted = force === undefined ? !has : !!force;
    if (wanted !== has) this[kList].update(wanted ? [...items, token] : items.filter(it => it !== token));
    return wanted;
  }
  replace(token: string, replacement: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    [token, replacement] = [String(token), String(replacement)];
    if (replacement === "") validToken(replacement);
    validToken(token);
    validToken(replacement);
    const items: string[] = this[kList].items();
    if (!items.includes(token)) return false;
    this[kList].update([...new Set(items.map(it => (it === token ? replacement : it)))]);
    return true;
  }
  supports(token: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    const { supported } = this[kList];
    if (supported === undefined) throw new TypeError("DOMTokenList has no supported tokens.");
    return supported.includes(asciiLower(String(token)));
  }
  toString() {
    return this.value;
  }
}
iterable(DOMTokenList, true);
expose(DOMTokenList);

function tokenList(node: N, attribute: string, supported?: string[]) {
  return makeList(DOMTokenList, new Tokens(node, attribute, supported));
}

function defineTokenList(ctor: any, property: string, attribute: string, supported?: string[]): void {
  if (ctor instanceof core.Interface)
    return core.extend(ctor, it => defineTokenList(it, property, attribute, supported));
  core.accessor(
    ctor.prototype,
    property,
    function (this: any) {
      return same(this.$impl, property, node => tokenList(node, attribute, supported));
    },
    function (this: any, value) {
      setAttr(this.$impl, attribute, String(value));
      react();
    },
  );
}

class DOMStringMap {
  constructor() {
    illegalConstructor();
  }
}
expose(DOMStringMap);

const dataAttribute = (key: string) =>
  (/-[a-z]/.test(key) ? " " : "data-") + key.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase());
const datasetHandler: ProxyHandler<any> = {
  get(target, key) {
    return (typeof key === "string" ? getAttr(target[kList], dataAttribute(key)) : null) ?? target[key];
  },
  set(target, key, value) {
    if (typeof key !== "string") return Reflect.set(target, key, value);
    if (/-[a-z]/.test(key)) throw domError("SyntaxError", `'${key}' is not a valid property name.`);
    validateAttributeName(dataAttribute(key));
    setAttr(target[kList], dataAttribute(key), String(value));
    react();
    return true;
  },
  has(target, key) {
    return (typeof key === "string" && core.hasAttr(target[kList], dataAttribute(key))) || key in target;
  },
  deleteProperty(target, key) {
    if (typeof key === "string") core.removeAttr(target[kList], dataAttribute(key));
    react();
    return true;
  },
  ownKeys(target) {
    return attributeKeys(target[kList])
      .filter(name => /^data-[^A-Z ]*$/.test(name))
      .map(name => name.slice(5).replace(/-[a-z]/g, it => it[1].toUpperCase()));
  },
  getOwnPropertyDescriptor(target, key) {
    const value = typeof key === "string" ? getAttr(target[kList], dataAttribute(key)) : null;
    return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true };
  },
};

function datasetOf(node: N) {
  const target = Object.create(DOMStringMap.prototype);
  Object.defineProperty(target, kList, { value: node, configurable: true });
  return new Proxy(target, datasetHandler);
}

// ───────────────────────────── names ─────────────────────────────

function invalidName(name: string) {
  return domError("InvalidCharacterError", `'${name}' is not a valid name.`);
}

function validateElementName(name: string) {
  if (!/^(?:[A-Za-z][^\0\t\n\f\r \/>]*|[:_\u0080-\u{10FFFF}][\w\-.:\u0080-\u{10FFFF}]*)$/u.test(name)) {
    throw invalidName(name);
  }
}

function validateAttributeName(name: string) {
  if (!/^[^\0\t\n\f\r \/=>]+$/.test(name)) throw invalidName(name);
}

function splitName(namespace: string | null, name: string, isElement: boolean): [string | null, string | null, string] {
  namespace = namespace == null || namespace === "" ? null : String(namespace);
  const colon = name.indexOf(":");
  const prefix = colon < 0 ? null : name.slice(0, colon);
  const local = name.slice(colon + 1);
  if (prefix !== null && !/^[^\0\t\n\f\r \/>]+$/.test(prefix)) throw invalidName(name);
  (isElement ? validateElementName : validateAttributeName)(local);
  if (
    (prefix !== null && namespace === null) ||
    (prefix === "xml" && namespace !== XML_NS) ||
    (name === "xmlns" || prefix === "xmlns") !== (namespace === XMLNS_NS)
  ) {
    throw domError("NamespaceError", `The name '${name}' and the namespace do not go together.`);
  }
  return [namespace, prefix, local];
}

function lowerIfHtml(node: N, name: any): string {
  if (typeof name !== "string") name = `${name}`;
  return node.ns === HTML && node.doc.isHtml ? asciiLower(name) : name;
}

function keyFor(node: N, name: any): string {
  return core.keyByName(node, lowerIfHtml(node, name));
}

function keyForNS(node: N, namespace: unknown, name: unknown): string | null {
  return core.findAttrNS(node, namespace == null ? null : `${namespace}` || null, `${name}`);
}

function keyOf(attr: N): string {
  return core.attrKey(qualifiedName(attr), attr.x.namespace);
}

const upperNames = new Map<string, string>();
function tagName(node: N): string {
  const name = qualifiedName(node);
  if (node.ns !== HTML || !node.doc.isHtml) return name;
  let upper = upperNames.$get(name);
  if (upper === undefined) upperNames.$set(name, (upper = name.replace(/[a-z]+/g, it => it.toUpperCase())));
  return upper;
}

function attributeKeys(node: N): string[] {
  const names: string[] = [];
  const attrs = node.attrs;
  if (attrs !== null) for (let i = 0; i < attrs.length; i += 2) names.push(attrs[i]);
  return names;
}

function locateNamespace(node: N | null, prefix: string | null): string | null {
  if (node!.type === DOCUMENT) node = core.documentElement(node!.doc);
  else if (node!.type === ATTRIBUTE) node = node!.x.element;
  else if (node!.type !== ELEMENT) node = core.parentElement(node!);
  if (node === null) return null;
  if (prefix === "xml") return XML_NS;
  if (prefix === "xmlns") return XMLNS_NS;
  for (; node !== null; node = core.parentElement(node)) {
    if (prefixOf(node) === prefix && core.namespaceOf(node) !== null) return core.namespaceOf(node);
    const declared = getAttr(node, core.attrKey(prefix === null ? "xmlns" : "xmlns:" + prefix, XMLNS_NS));
    if (declared !== null) return declared || null;
  }
  return null;
}

function isEqual(a: N, b: N): boolean {
  if (a.type !== b.type || a.name !== b.name) return false;
  if (a.type === ATTRIBUTE) return a.x.namespace === b.x.namespace && attrValue(a) === attrValue(b);
  if (a.type === DOCTYPE) return a.x.publicId === b.x.publicId && a.x.systemId === b.x.systemId;
  if (a.data !== b.data) return false;
  if (a.type === ELEMENT) {
    const keys = attributeKeys(a);
    if (
      core.namespaceOf(a) !== core.namespaceOf(b) ||
      prefixOf(a) !== prefixOf(b) ||
      keys.length * 2 !== (b.attrs?.length ?? 0)
    )
      return false;
    if (keys.some(key => getAttr(a, key) !== core.getAttrNS(b, core.attrNamespace(key), core.attrLocalName(key))))
      return false;
  }
  let x = a.first;
  let y = b.first;
  for (; x !== null && y !== null; x = x.next, y = y.next) if (!isEqual(x, y)) return false;
  return x === y;
}

function normalize(root: N) {
  for (let node = root.first; node !== null;) {
    if (node.type !== TEXT) {
      node = following(node, root);
      continue;
    }
    if (node.data === "") {
      const next = following(node, root);
      core.remove(node);
      node = next;
      continue;
    }
    for (let next; (next = node.next) !== null && next.type === TEXT;) {
      const length = node.data.length;
      core.replaceData(node, length, 0, next.data);
      if (node.doc.ranges > 0) hooks.rangesBeforeMerge(node, next, length);
      core.remove(next);
    }
    node = following(node, root);
  }
}

// ───────────────────────────── Node ─────────────────────────────

class Node extends events.EventTarget {
  constructor() {
    if (!hasPending()) illegalConstructor();
    super();
  }
  get nodeType() {
    return this.$impl.type;
  }
  get nodeName() {
    const node = this.$impl;
    switch (node.type) {
      case ELEMENT:
        return tagName(node);
      case TEXT:
        return "#text";
      case COMMENT:
        return "#comment";
      case CDATA:
        return "#cdata-section";
      case DOCUMENT:
        return "#document";
      case FRAGMENT:
        return "#document-fragment";
      default:
        return qualifiedName(node);
    }
  }
  get baseURI() {
    return this.$impl.doc.baseUrl;
  }
  get isConnected() {
    return (this.$impl.flags & CONNECTED) !== 0;
  }
  get ownerDocument() {
    const node = this.$impl;
    return node.type === DOCUMENT ? null : wrap(node.doc.node);
  }
  get parentNode() {
    return wrapOrNull(this.$impl.parent);
  }
  get parentElement() {
    const parent = this.$impl.parent;
    return parent !== null && parent.type === ELEMENT ? wrap(parent) : null;
  }
  get childNodes() {
    const node = this.$impl;
    return (rare(node).childNodes ??= makeList(NodeList, new Nodes(() => core.childArray(node))));
  }
  get firstChild() {
    return wrapOrNull(this.$impl.first);
  }
  get lastChild() {
    return wrapOrNull(this.$impl.last);
  }
  get previousSibling() {
    return wrapOrNull(this.$impl.prev);
  }
  get nextSibling() {
    return wrapOrNull(this.$impl.next);
  }
  get nodeValue() {
    const node = this.$impl;
    return isData(node) ? node.data : node.type === ATTRIBUTE ? attrValue(node) : null;
  }
  set nodeValue(value) {
    const node = this.$impl;
    value = value == null ? "" : `${value}`;
    if (isData(node)) core.replaceData(node, 0, node.data.length, value);
    else if (node.type === ATTRIBUTE) setAttrValue(node, value);
    react();
  }
  get textContent() {
    const node = this.$impl;
    return node.type === ELEMENT || node.type === FRAGMENT ? core.textContent(node) : this.nodeValue;
  }
  set textContent(value) {
    const node = this.$impl;
    if (node.type !== ELEMENT && node.type !== FRAGMENT) this.nodeValue = value ?? null;
    else core.replaceAllWithText(value == null ? "" : String(value), node);
    react();
  }
  getRootNode(options: { composed?: boolean } | undefined = undefined) {
    return wrap(options?.composed ? core.composedRoot(this.$impl) : core.rootOf(this.$impl));
  }
  hasChildNodes() {
    return this.$impl.first !== null;
  }
  normalize() {
    normalize(this.$impl);
    react();
  }
  cloneNode(deep = false) {
    const node = this.$impl;
    if (node.flags & SHADOW_ROOT) throw domError("NotSupportedError", "ShadowRoot nodes are not clonable.");
    const copy = core.clone(node, node.doc, !!deep);
    react();
    return wrap(copy);
  }
  isEqualNode(other: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    core.brand(this);
    return other != null && isEqual(this.$impl, unwrap(other, "isEqualNode"));
  }
  isSameNode(other: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    core.brand(this);
    return this === other;
  }
  compareDocumentPosition(value: any) {
    let self = this.$impl;
    let other = unwrap(value, "compareDocumentPosition");
    if (self === other) return 0;
    const selfIsAttr = self.type === ATTRIBUTE;
    const otherIsAttr = other.type === ATTRIBUTE;
    if (selfIsAttr && otherIsAttr && self.x.element !== null && self.x.element === other.x.element) {
      const index = (attr: N) => core.attrIndex(attr.x.element, keyOf(attr));
      return 32 | (index(other) < index(self) ? 2 : 4);
    }
    if (selfIsAttr) self = self.x.element ?? self;
    if (otherIsAttr) other = other.x.element ?? other;
    if (self === other) return selfIsAttr ? 10 : 20;
    const order = core.compareOrder(other, self);
    if (order === 0) return 33 | (disconnectedOrder(other) < disconnectedOrder(self) ? 2 : 4);
    if (order < 0) return !otherIsAttr && core.contains(other, self) ? 10 : 2;
    return !selfIsAttr && core.contains(self, other) ? 20 : 4;
  }
  contains(other: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (other != null) return core.contains(this.$impl, unwrap(other, "contains"));
    core.brand(this);
    return false;
  }
  lookupPrefix(namespace: string | null) {
    if ($argumentCount() < 1) core.tooFew(1);
    let node: N | null = this.$impl;
    if (node.type === DOCUMENT) node = core.documentElement(node.doc);
    else if (node.type === ATTRIBUTE) node = node.x.element;
    else if (node.type === DOCTYPE) return null;
    namespace = namespace == null ? null : `${namespace}`;
    for (; namespace && node !== null; node = node.parent) {
      if (node.type !== ELEMENT) continue;
      if (prefixOf(node) !== null && core.namespaceOf(node) === namespace) return prefixOf(node);
      const found = attributeKeys(node).find(key => /^xmlns:\S* /.test(key) && getAttr(node!, key) === namespace);
      if (found) return core.attrLocalName(found);
    }
    return null;
  }
  lookupNamespaceURI(prefix: string | null) {
    if ($argumentCount() < 1) core.tooFew(1);
    return locateNamespace(this.$impl, prefix == null ? null : `${prefix}` || null);
  }
  isDefaultNamespace(namespace: string | null) {
    if ($argumentCount() < 1) core.tooFew(1);
    return locateNamespace(this.$impl, null) === (namespace == null ? null : `${namespace}` || null);
  }
  insertBefore(node: any, child: any) {
    if (arguments.length < 2) throw new TypeError("Failed to execute 'insertBefore': 2 arguments required.");
    core.preInsert(unwrap(node, "insertBefore"), this.$impl, child == null ? null : unwrap(child, "insertBefore", 2));
    react();
    return node;
  }
  appendChild(node: any) {
    core.preInsert(unwrap(node, "appendChild"), this.$impl, null);
    react();
    return node;
  }
  replaceChild(node: any, child: any) {
    if ($argumentCount() < 2) core.tooFew(2);
    core.replaceChild(unwrap(child, "replaceChild", 2), unwrap(node, "replaceChild"), this.$impl);
    react();
    return child;
  }
  removeChild(child: any) {
    const node = unwrap(child, "removeChild");
    if (node.parent !== this.$impl) {
      core.brand(this);
      throw domError("NotFoundError", "The node to be removed is not a child of this node.");
    }
    core.remove(node);
    react();
    return child;
  }
}
expose(Node, {
  ELEMENT_NODE: 1,
  ATTRIBUTE_NODE: 2,
  TEXT_NODE: 3,
  CDATA_SECTION_NODE: 4,
  ENTITY_REFERENCE_NODE: 5,
  ENTITY_NODE: 6,
  PROCESSING_INSTRUCTION_NODE: 7,
  COMMENT_NODE: 8,
  DOCUMENT_NODE: 9,
  DOCUMENT_TYPE_NODE: 10,
  DOCUMENT_FRAGMENT_NODE: 11,
  NOTATION_NODE: 12,
  DOCUMENT_POSITION_DISCONNECTED: 1,
  DOCUMENT_POSITION_PRECEDING: 2,
  DOCUMENT_POSITION_FOLLOWING: 4,
  DOCUMENT_POSITION_CONTAINS: 8,
  DOCUMENT_POSITION_CONTAINED_BY: 16,
  DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32,
});
Object.defineProperty(Node.prototype, Symbol.for("nodejs.util.inspect.custom"), {
  value(this: any) {
    const node = this.$impl;
    if (node === undefined) return this;
    if (node.type === ELEMENT) return hooks.serializeOuter(node);
    return isData(node) ? `${this.nodeName} ${JSON.stringify(node.data)}` : this.nodeName;
  },
  configurable: true,
  writable: true,
});

let nextSerial = 0;
function disconnectedOrder(node: N): number {
  return same(core.rootOf(node), "serial", () => ++nextSerial);
}

function toNode(values: any[], doc: Doc): N {
  const convert = (value: any) => core.nodeOf(value) ?? core.createText(doc, String(value));
  if (values.length === 1) return convert(values[0]);
  const fragment = core.createFragment(doc);
  for (const node of values.map(convert)) core.preInsert(node, fragment, null);
  return fragment;
}

function viableSibling(from: N, values: any[], forward: boolean): N | null {
  let node: N | null = from;
  do node = forward ? node!.next : node!.prev;
  while (node !== null && node.js !== null && values.includes(node.js));
  return node;
}

const childNode = {
  before(this: any, ...values: any[]) {
    const { parent, doc } = this.$impl;
    if (parent === null) return;
    const previous = viableSibling(this.$impl, values, false);
    try {
      const node = toNode(values, doc);
      core.preInsert(node, parent, previous === null ? parent.first : previous.next);
    } finally {
      react();
    }
  },
  after(this: any, ...values: any[]) {
    const { parent, doc } = this.$impl;
    if (parent === null) return;
    const next = viableSibling(this.$impl, values, true);
    core.preInsert(toNode(values, doc), parent, next);
    react();
  },
  replaceWith(this: any, ...values: any[]) {
    const self = this.$impl;
    const parent = self.parent;
    if (parent === null) return;
    const next = viableSibling(self, values, true);
    const node = toNode(values, self.doc);
    if (self.parent === parent) core.replaceChild(self, node, parent);
    else core.preInsert(node, parent, next);
    react();
  },
  remove(this: any) {
    if (this.$impl.parent !== null) core.remove(this.$impl);
    react();
  },
};

function elementFrom(node: N | null, forward: boolean) {
  while (node !== null && node.type !== ELEMENT) node = forward ? node.next : node.prev;
  return wrapOrNull(node);
}

const elementSiblings = {
  get previousElementSibling() {
    return elementFrom((this as any).$impl.prev, false);
  },
  get nextElementSibling() {
    return elementFrom((this as any).$impl.next, true);
  },
};

const slottable = {
  get assignedSlot() {
    const slot = (this as any).$impl.rare?.slot;
    return slot && !(slot.flags & USER_AGENT) && scopeOf(core.rootOf(slot)).mode === "open" ? wrap(slot) : null;
  },
};

function invalidSelector(selector: string) {
  return domError("SyntaxError", `'${selector}' is not a valid selector.`);
}

/** A tag name or "", then pairs of an attribute's name and the value it must have. Null is any value, and a class is a token. */
type Compound = (string | null)[];

const NAME = "[a-z_][\\w-]*";
const COMPOUND = new RegExp(
  `^(\\*|[a-z][a-z0-9-]*)?((?:[.#]-?${NAME}|\\[[a-z][a-z-]*(?:=(?:"[^"\\\\\\n]*"|${NAME}))?\\])*)$`,
);
const PART = /([.#])([\w-]+)|\[([a-z-]+)(?:=(?:"([^"]*)"|([\w-]+)))?\]/g;
const CASE_SENSITIVE_VALUE = /^(?:data-|aria-|role$|id$|name$|href$|src$)/;
const compoundLists = new Map<string, Compound[] | null>();

function parseCompounds(selector: string): Compound[] | null {
  if (selector.includes('"') && selector.includes(",")) return null;
  const list: Compound[] = [];
  for (const text of selector.split(",")) {
    const found = COMPOUND.exec(text.replace(/^ +| +$/g, ""));
    if (found === null || found[0] === "") return null;
    const compound: Compound = [found[1] === undefined || found[1] === "*" ? "" : found[1]];
    for (const part of found[2].matchAll(PART)) {
      if (part[1] !== undefined) compound.push(part[1] === "." ? "." : "id", part[2]);
      else {
        const value = part[4] ?? part[5] ?? null;
        if (value !== null && !CASE_SENSITIVE_VALUE.test(part[3])) return null;
        compound.push(part[3], value);
      }
    }
    list.push(compound);
  }
  return list;
}

/** For a node that the engine does not know: it would have to be told of the node's whole tree to answer. */
function compoundsFor(node: N, selector: string): Compound[] | null {
  if (node.id !== 0 || node.doc.quirks) return null;
  let list = compoundLists.$get(selector);
  if (list === undefined) {
    if (compoundLists.$size > 500) compoundLists.$clear();
    compoundLists.$set(selector, (list = parseCompounds(selector)));
  }
  return list;
}

function matchesCompounds(node: N, list: Compound[]): boolean {
  next: for (let i = 0; i < list.length; i++) {
    const compound = list[i];
    if (compound[0] !== "" && compound[0] !== node.name) continue;
    for (let at = 1; at < compound.length; at += 2) {
      const isClass = compound[at] === ".";
      const value = getAttr(node, isClass ? "class" : compound[at]!);
      const wanted = compound[at + 1];
      if (value === null) continue next;
      if (wanted === null || value === wanted) continue;
      if (!isClass || !value.includes(wanted) || !splitTokens(value).includes(wanted)) continue next;
    }
    return true;
  }
  return false;
}

function matches(node: N, selector: string): boolean {
  const list = compoundsFor(node, selector);
  if (list !== null) return matchesCompounds(node, list);
  const result = engineFor(node).matches(node.id, selector);
  if (result < 0) throw invalidSelector(selector);
  return result === 1;
}

function querySelector(root: N, selector: string): N | null {
  const list = compoundsFor(root, selector);
  if (list !== null) {
    let at = following(root, root);
    while (at !== null && !(at.type === ELEMENT && matchesCompounds(at, list))) at = following(at, root);
    return at;
  }
  const id = engineFor(root).querySelector(root.id, selector);
  if (id < 0) throw invalidSelector(selector);
  return id === 0 ? null : (root.doc.nodes[id] ?? null);
}

function querySelectorAll(root: N, selector: string): N[] {
  const list = compoundsFor(root, selector);
  if (list !== null) {
    const all: N[] = [];
    for (let at = following(root, root); at !== null; at = following(at, root))
      if (at.type === ELEMENT && matchesCompounds(at, list)) all.push(at);
    return all;
  }
  const found = engineFor(root).querySelectorAll(root.id, selector);
  if (found === null) throw invalidSelector(selector);
  const nodes = root.doc.nodes;
  // The tooltip is the last child of the document, for the engine only.
  if (found.length > 0 && !nodes[found[found.length - 1]]) found.pop();
  return found.map(id => nodes[id]!);
}

const parentNode = {
  get children() {
    const node = (this as any).$impl;
    return (rare(node).children ??= makeList(HTMLCollection, new Elements(() => core.elementChildren(node))));
  },
  get firstElementChild() {
    return elementFrom((this as any).$impl.first, true);
  },
  get lastElementChild() {
    return elementFrom((this as any).$impl.last, false);
  },
  get childElementCount() {
    return core.elementChildren((this as any).$impl).length;
  },
  prepend(this: any, ...values: any[]) {
    const node = toNode(values, this.$impl.doc);
    core.preInsert(node, this.$impl, this.$impl.first);
    react();
  },
  append(this: any, ...values: any[]) {
    core.preInsert(toNode(values, this.$impl.doc), this.$impl, null);
    react();
  },
  replaceChildren(this: any, ...values: any[]) {
    const node = toNode(values, this.$impl.doc);
    const isDocument = this.$impl.type === DOCUMENT;
    core.validateInsert(node, isDocument ? core.createDoc().node : this.$impl, null, false);
    core.replaceAll(node, this.$impl);
    react();
  },
  moveBefore(this: any, value: any, reference: any) {
    if ($argumentCount() < 2) core.tooFew(2);
    const parent = this.$impl;
    const node = unwrap(value, "moveBefore");
    const child = reference == null ? null : unwrap(reference, "moveBefore", 2);
    if (core.composedRoot(node) !== core.composedRoot(parent) || (node.type !== ELEMENT && !isData(node))) {
      throw domError("HierarchyRequestError", "State-preserving atomic move cannot be performed on these nodes.");
    }
    core.validateInsert(node, parent, child, false);
    const hasFocus = core.containsComposed(node, node.doc.focused);
    if (hasFocus) hooks.markFocus(node.doc, false);
    core.insert(node, parent, child === node ? node.next : child, false, true);
    if (hasFocus) hooks.markFocus(node.doc, true);
    react();
  },
  querySelector(this: any, selector: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return wrapOrNull(querySelector(this.$impl, String(selector)));
  },
  querySelectorAll(this: any, selector: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return staticList(querySelectorAll(this.$impl, String(selector)));
  },
};

const elementLookups = {
  getElementsByTagName(this: any, name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return byTagName(this.$impl, String(name));
  },
  getElementsByTagNameNS(this: any, namespace: string | null, name: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    core.brand(this);
    return byTagNameNS(this.$impl, namespace, String(name));
  },
  getElementsByClassName(this: any, names: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return byClassName(this.$impl, String(names));
  },
};

const elementById = {
  getElementById(this: any, id: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return wrapOrNull(core.elementById(this.$impl, String(id)));
  },
};

class CharacterData extends Node {
  get data() {
    return this.$impl.data;
  }
  set data(value) {
    core.replaceData(this.$impl, 0, this.$impl.data.length, value === null ? "" : String(value));
  }
  get length() {
    return this.$impl.data.length;
  }
  substringData(offset: number, count: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    const { data } = this.$impl;
    if (offset >>> 0 > data.length) throw domError("IndexSizeError", "The offset is greater than the node's length.");
    return data.substr(offset >>> 0, count >>> 0);
  }
  appendData(data: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    core.replaceData(this.$impl, this.$impl.data.length, 0, String(data));
  }
  insertData(offset: number, data: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    core.replaceData(this.$impl, offset >>> 0, 0, String(data));
  }
  deleteData(offset: number, count: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    core.replaceData(this.$impl, offset >>> 0, count >>> 0, "");
  }
  replaceData(offset: number, count: number, data: string) {
    if ($argumentCount() < 3) core.tooFew(3);
    core.replaceData(this.$impl, offset >>> 0, count >>> 0, String(data));
  }
}

class Text extends CharacterData {
  constructor(data = "") {
    if (!hasPending()) setPending(core.createText(realm.page.doc, String(data)));
    super();
  }
  splitText(offset: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    return wrap(core.splitText(this.$impl, offset >>> 0));
  }
  get wholeText() {
    let node: N | null = this.$impl;
    let text = "";
    while (node.prev !== null && isText(node.prev)) node = node.prev;
    for (; node !== null && isText(node); node = node.next) text += node.data;
    return text;
  }
}

class CDATASection extends Text {
  constructor() {
    if (!hasPending()) illegalConstructor();
    super();
  }
}

class Comment extends CharacterData {
  constructor(data = "") {
    if (!hasPending()) setPending(core.createData(realm.page.doc, COMMENT, String(data)));
    super();
  }
}

const pseudoAttribute =
  /[\t\n\f\r ]*([^\0\t\n\f\r \/=>]+)[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"<]*)"|'([^'<]*)')(?=[\t\n\f\r ]|$)/y;
const xmlReference = /&(?:#x([\da-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g;
const xmlEntities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const needsReference = /[&<>"]/g;

/** https://www.w3.org/TR/xml-stylesheet/#dt-parsing */
function pseudoAttributes({ data }: N): Map<string, string> {
  const found = new Map<string, string>();
  const decode = (all: string, hex?: string, decimal?: string, name?: string) => {
    if (name !== undefined) return xmlEntities[name];
    const code = parseInt(hex ?? decimal!, hex === undefined ? 10 : 16);
    return code > 0x10ffff ? all : String.fromCodePoint(code);
  };
  let at = 0;
  pseudoAttribute.lastIndex = 0;
  for (let match; (match = pseudoAttribute.exec(data)) !== null; at = pseudoAttribute.lastIndex) {
    if (found.$has(match[1])) break;
    found.$set(match[1], (match[2] ?? match[3]).replace(xmlReference, decode));
  }
  if (splitTokens(data.slice(at)).length > 0) found.clear();
  return found;
}

function changePseudoAttribute(node: N, name: string, value: string | null) {
  const all = pseudoAttributes(node);
  if (value !== null) all.$set(name, value);
  else if (!all.$delete(name)) return;
  const escape = (it: string) => (it === "&" ? "&amp;" : it === "<" ? "&lt;" : it === ">" ? "&gt;" : "&quot;");
  const data = Array.from(all, ([key, text]) => key + '="' + text.replace(needsReference, escape) + '"').join(" ");
  core.replaceData(node, 0, node.data.length, data);
}

class ProcessingInstruction extends CharacterData {
  hasAttributes() {
    return pseudoAttributes(this.$impl).size > 0;
  }
  getAttributeNames() {
    return Array.from(pseudoAttributes(this.$impl).keys());
  }
  getAttribute(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return pseudoAttributes(this.$impl).$get(`${name}`) ?? null;
  }
  hasAttribute(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return pseudoAttributes(this.$impl).$has(`${name}`);
  }
  setAttribute(name: string, value: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    validateAttributeName((name = `${name}`));
    changePseudoAttribute(this.$impl, name, `${value}`);
  }
  removeAttribute(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    changePseudoAttribute(this.$impl, `${name}`, null);
  }
  toggleAttribute(name: string, force: unknown = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    validateAttributeName((name = `${name}`));
    const has = pseudoAttributes(this.$impl).$has(name);
    const wants = force === undefined ? !has : !!force;
    if (wants !== has) changePseudoAttribute(this.$impl, name, wants ? "" : null);
    return wants;
  }
  get target() {
    return this.$impl.name;
  }
  get sheet() {
    return this.$impl.x?.sheet?.js ?? null;
  }
}

class DocumentType extends Node {
  get name() {
    return this.$impl.name;
  }
  get publicId() {
    return this.$impl.x.publicId;
  }
  get systemId() {
    return this.$impl.x.systemId;
  }
}

class DocumentFragment extends Node {
  constructor() {
    if (!hasPending()) setPending(core.createFragment(realm.page.doc));
    super();
  }
}

function sanitizerFor(options: any, isSafe: boolean) {
  if (options !== null && !$isObject(options)) throw new TypeError("The options are not a dictionary.");
  const given = options?.sanitizer;
  return isSafe || given !== undefined ? require("internal/desktop/dom/sanitizer").fromOption(given, isSafe) : null;
}

function setHtml(target: N, context: N, html: string, options: any, isSafe: boolean) {
  const sanitize = sanitizerFor(options, isSafe);
  if (isSafe && context.name === "script" && (context.ns === HTML || context.ns === core.SVG)) return;
  const fragment = hooks.parseHtmlFragment(
    context,
    html,
    true,
    !isSafe && !!options?.runScripts,
    target,
    sanitize !== null,
  );
  sanitize?.(fragment);
  core.replaceAll(fragment, contentOf(target));
  react();
}

class ShadowRoot extends DocumentFragment {
  constructor() {
    if (!hasPending()) illegalConstructor();
    super();
  }
  get mode() {
    return scopeOf(this.$impl).mode;
  }
  get host() {
    return wrap(core.hostOf(this.$impl));
  }
  get delegatesFocus() {
    return scopeOf(this.$impl).delegatesFocus;
  }
  get slotAssignment() {
    return scopeOf(this.$impl).manualSlots ? "manual" : "named";
  }
  get clonable() {
    return scopeOf(this.$impl).clonable;
  }
  get serializable() {
    return scopeOf(this.$impl).serializable;
  }
  get referenceTarget() {
    return scopeOf(this.$impl).referenceTarget;
  }
  set referenceTarget(value) {
    scopeOf(this.$impl).referenceTarget = value == null ? null : `${value}`;
    this.$impl.doc.attributeVersion++;
    this.$impl.doc.attributeVersion++;
  }
  get innerHTML() {
    return hooks.serializeInner(this.$impl);
  }
  set innerHTML(html) {
    const root = this.$impl;
    core.replaceAll(hooks.parseFragment(core.hostOf(root), html === null ? "" : `${html}`, false, false, root), root);
    react();
  }
  getHTML(options: object | undefined = undefined) {
    return hooks.serializeInner(this.$impl, options);
  }
  setHTML(html: string, options: any = {}) {
    if ($argumentCount() < 1) core.tooFew(1);
    setHtml(this.$impl, core.hostOf(this.$impl), `${html}`, options, true);
  }
  setHTMLUnsafe(html: string, options: any = {}) {
    if ($argumentCount() < 1) core.tooFew(1);
    setHtml(this.$impl, core.hostOf(this.$impl), `${html}`, options, false);
  }
}
events.defineHandlers(ShadowRoot.prototype, ["slotchange"]);

// ───────────────────────────── attributes ─────────────────────────────

function createAttr(doc: Doc, name: string, prefix: string | null, namespace: string | null, value: string): N {
  const attr = new N(ATTRIBUTE | 0, doc, kinds.attr);
  attr.name = name;
  rare(attr).prefix = prefix;
  attr.data = value;
  attr.x = { element: null, namespace };
  return attr;
}

function attrValue(attr: N): string {
  return attr.x.element === null ? attr.data : getAttr(attr.x.element, keyOf(attr))!;
}

function setAttrValue(attr: N, value: string) {
  if (attr.x.element === null) attr.data = value;
  else setAttr(attr.x.element, keyOf(attr), value);
}

function attrNode(element: N, name: string | null): N | null {
  if (name === null || !core.hasAttr(element, name)) return null;
  const known = (rare(element).attributeNodes ??= new Map());
  let attr = known.$get(name);
  if (attr === undefined) {
    const local = core.attrLocalName(name);
    const prefix = local === core.attrName(name) ? null : name.slice(0, name.indexOf(":"));
    attr = createAttr(element.doc, local, prefix, core.attrNamespace(name), "");
    attr.x.element = element;
    known.$set(name, attr);
  }
  return attr;
}

function unwrapAttr(value: any): N {
  const attr = core.nodeOf(value);
  if (attr?.type !== ATTRIBUTE) throw new TypeError("parameter 1 is not of type 'Attr'.");
  return attr!;
}

function setAttrNode(element: N, value: any) {
  const attr = unwrapAttr(value);
  if (attr.x.element === element) return value;
  if (attr.x.element !== null) throw domError("InUseAttributeError", "The attribute is in use by another element.");
  const oldKey = core.findAttrNS(element, attr.x.namespace, attr.name);
  const old = attrNode(element, oldKey);
  if (old !== null) {
    old.data = attrValue(old);
    old.x.element = null;
    element.rare!.attributeNodes!.$delete(oldKey!);
    element.attrs![core.attrIndex(element, oldKey!)] = keyOf(attr);
  }
  (rare(element).attributeNodes ??= new Map()).$set(keyOf(attr), attr);
  attr.x.element = element;
  attr.doc = element.doc;
  core.setAttrNS(element, qualifiedName(attr), attr.data, attr.x.namespace);
  react();
  return wrapOrNull(old);
}

function removeAttrNode(element: N, attr: N | null) {
  if (attr === null || attr.x.element !== element) throw domError("NotFoundError", "The attribute was not found.");
  core.removeAttr(element, keyOf(attr));
  react();
  return wrap(attr);
}

class Attr extends Node {
  get namespaceURI() {
    return this.$impl.x.namespace;
  }
  get prefix() {
    return prefixOf(this.$impl);
  }
  get localName() {
    return this.$impl.name;
  }
  get name() {
    return qualifiedName(this.$impl);
  }
  get value() {
    return attrValue(this.$impl);
  }
  set value(value) {
    setAttrValue(this.$impl, String(value));
    react();
  }
  get ownerElement() {
    return wrapOrNull(this.$impl.x.element);
  }
  get specified() {
    core.brand(this);
    return true;
  }
}

class Attributes {
  node: N;
  constructor(node: N) {
    this.node = node;
  }
  size() {
    return (this.node.attrs?.length ?? 0) / 2;
  }
  at(index: number) {
    return wrapOrNull(attrNode(this.node, this.node.attrs?.[index * 2] ?? null)) ?? undefined;
  }
  named(name: string) {
    return wrapOrNull(attrNode(this.node, core.keyByName(this.node, name)));
  }
  names() {
    return attributeKeys(this.node)
      .map(core.attrName)
      .filter(name => lowerIfHtml(this.node, name) === name);
  }
}

class NamedNodeMap {
  constructor() {
    illegalConstructor();
  }
  get length() {
    return this[kList].size();
  }
  item(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].at(index >>> 0) ?? null;
  }
  getNamedItem(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].named(lowerIfHtml(this[kList].node, name));
  }
  getNamedItemNS(namespace: string | null, name: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    return wrapOrNull(attrNode(this[kList].node, keyForNS(this[kList].node, namespace, name)));
  }
  setNamedItem(attr: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    return setAttrNode(this[kList].node, attr);
  }
  setNamedItemNS(attr: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    return setAttrNode(this[kList].node, attr);
  }
  removeNamedItem(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    const { node } = this[kList];
    return removeAttrNode(node, attrNode(node, keyFor(node, name)));
  }
  removeNamedItemNS(namespace: string | null, name: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    const { node } = this[kList];
    return removeAttrNode(node, attrNode(node, keyForNS(node, namespace, name)));
  }
}
iterable(NamedNodeMap, false);
expose(NamedNodeMap);

// ───────────────────────────── Element ─────────────────────────────

function insertAdjacent(element: N, where: string, node: N): boolean {
  const parent = element.parent;
  switch (asciiLower(String(where))) {
    case "beforebegin":
      if (parent !== null) core.preInsert(node, parent, element);
      return parent !== null;
    case "afterbegin":
      core.preInsert(node, element, element.first);
      return true;
    case "beforeend":
      core.preInsert(node, element, null);
      return true;
    case "afterend":
      if (parent !== null) core.preInsert(node, parent, element.next);
      return parent !== null;
  }
  throw domError("SyntaxError", `'${where}' is not 'beforeBegin', 'afterBegin', 'beforeEnd' or 'afterEnd'.`);
}

const shadowHosts = new Set(
  splitTokens("article aside blockquote body div footer h1 h2 h3 h4 h5 h6 header main nav p section span"),
);

function attachShadow(host: N, init: any): N {
  if (
    host.ns !== HTML ||
    !(shadowHosts.$has(host.name) || core.isValidCustomName(host.name)) ||
    host.rare?.definition?.disabledFeatures.includes("shadow")
  ) {
    throw domError("NotSupportedError", "This element does not support attachShadow");
  }
  if (host.flags & HOST) {
    const existing = host.rare!.shadow;
    if (!scopeOf(existing!).declarative || scopeOf(existing!).mode !== init.mode) {
      throw domError("NotSupportedError", "Shadow root cannot be created on a host which already hosts a shadow tree.");
    }
    core.replaceAll(null, existing!);
    scopeOf(existing!).declarative = false;
    return existing!;
  }
  const root = core.attachShadow(host, false);
  if (init.registry !== host.doc.registry) rare(root).registry = init.registry;
  scopeOf(root).availableToInternals = (host.flags & flags.CUSTOM) !== 0 || host.rare!.isPrecustomized;
  scopeOf(root).referenceTarget = init.referenceTarget == null ? null : `${init.referenceTarget}`;
  scopeOf(root).mode = init.mode;
  scopeOf(root).delegatesFocus = !!init.delegatesFocus;
  scopeOf(root).manualSlots = init.slotAssignment === "manual";
  scopeOf(root).clonable = !!init.clonable;
  scopeOf(root).serializable = !!init.serializable;
  return root;
}

function contentOf(node: N): N {
  return core.isHtml(node, "template") ? node.x : node;
}

function contextOf(parent: N, doc: Doc): N {
  if (parent.type === ELEMENT && !(doc.isHtml && core.isHtml(parent, "html"))) return parent;
  const body = core.createPlainElement(doc, "body", HTML);
  if (parent.rare?.registry !== undefined) rare(body).registry = parent.rare.registry;
  return body;
}

class Element extends Node {
  get elementTiming() {
    return core.getAttr(this.$impl, "elementtiming") ?? "";
  }
  set elementTiming(value) {
    core.setAttr(this.$impl, "elementtiming", `${value}`);
    core.react();
  }
  get namespaceURI() {
    return core.namespaceOf(this.$impl);
  }
  get prefix() {
    return prefixOf(this.$impl);
  }
  get localName() {
    return this.$impl.name;
  }
  get tagName() {
    return tagName(this.$impl);
  }
  get id() {
    return getAttr(this.$impl, "id") ?? "";
  }
  set id(value) {
    setAttr(this.$impl, "id", String(value));
    react();
  }
  get className() {
    return getAttr(this.$impl, "class") ?? "";
  }
  set className(value) {
    setAttr(this.$impl, "class", String(value));
    react();
  }
  get classList() {
    return (rare(this.$impl).classList ??= tokenList(this.$impl, "class"));
  }
  set classList(value) {
    setAttr(this.$impl, "class", String(value));
    react();
  }
  get slot() {
    return getAttr(this.$impl, "slot") ?? "";
  }
  set slot(value) {
    setAttr(this.$impl, "slot", String(value));
    react();
  }
  get attributes() {
    return same(this.$impl, "attributes", node => makeList(NamedNodeMap, new Attributes(node)));
  }
  get shadowRoot() {
    const root = this.$impl.rare?.shadow;
    return root && !(root.flags & USER_AGENT) && scopeOf(root).mode === "open" ? wrap(root) : null;
  }
  get customElementRegistry() {
    return core.registryOf(this.$impl);
  }
  hasAttributes() {
    return this.$impl.attrs !== null && this.$impl.attrs.length > 0;
  }
  getAttributeNames() {
    return attributeKeys(this.$impl).map(core.attrName);
  }
  getAttribute(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return getAttr(this.$impl, keyFor(this.$impl, name));
  }
  getAttributeNS(namespace: string | null, name: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    const found = keyForNS(this.$impl, namespace, name);
    return found === null ? null : getAttr(this.$impl, found);
  }
  setAttribute(name: string, value: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    const node = this.$impl;
    name = lowerIfHtml(node, name);
    validateAttributeName(name);
    setAttr(node, core.keyByName(node, name), typeof value === "string" ? value : `${value}`);
    react();
  }
  setAttributeNS(namespace: string | null, name: string, value: string) {
    if ($argumentCount() < 3) core.tooFew(3);
    const [space, , local] = splitName(namespace, (name = `${name}`), false);
    core.setAttrNS(this.$impl, core.attrName(core.findAttrNS(this.$impl, space, local) ?? name), `${value}`, space);
    react();
  }
  removeAttribute(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    core.removeAttr(this.$impl, keyFor(this.$impl, name));
    react();
  }
  removeAttributeNS(namespace: string | null, name: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    const found = keyForNS(this.$impl, namespace, name);
    if (found !== null) core.removeAttr(this.$impl, found);
    react();
  }
  toggleAttribute(name: string, force: boolean | undefined = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    name = lowerIfHtml(this.$impl, name);
    validateAttributeName(name);
    name = core.keyByName(this.$impl, name);
    const on = force === undefined ? !core.hasAttr(this.$impl, name) : !!force;
    core.toggleAttr(this.$impl, name, on);
    react();
    return on;
  }
  hasAttribute(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return core.hasAttr(this.$impl, keyFor(this.$impl, name));
  }
  hasAttributeNS(namespace: string | null, name: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    return keyForNS(this.$impl, namespace, name) !== null;
  }
  getAttributeNode(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return wrapOrNull(attrNode(this.$impl, keyFor(this.$impl, name)));
  }
  getAttributeNodeNS(namespace: string | null, name: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    return wrapOrNull(attrNode(this.$impl, keyForNS(this.$impl, namespace, name)));
  }
  setAttributeNode(attr: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    return setAttrNode(this.$impl, attr);
  }
  setAttributeNodeNS(attr: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    return setAttrNode(this.$impl, attr);
  }
  removeAttributeNode(attr: any) {
    return removeAttrNode(this.$impl, unwrapAttr(attr));
  }
  attachShadow(init: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    const node = this.$impl;
    const {
      clonable,
      customElementRegistry,
      delegatesFocus,
      mode,
      referenceTarget,
      serializable,
      slotAssignment = "named",
    } = init ?? {};
    if (!["open", "closed"].includes(`${mode}`) || !["named", "manual"].includes(`${slotAssignment}`)) {
      throw new TypeError("Failed to execute 'attachShadow': The provided value is not a valid enum value.");
    }
    const registry = hooks.registryOption(customElementRegistry, node.doc);
    const converted = {
      clonable,
      delegatesFocus,
      mode: `${mode}`,
      referenceTarget,
      registry,
      serializable,
      slotAssignment: `${slotAssignment}`,
    };
    return wrap(attachShadow(node, converted));
  }
  matches(selector: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return matches(this.$impl, String(selector));
  }
  webkitMatchesSelector(selector: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return matches(this.$impl, String(selector));
  }
  closest(selector: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    const node = this.$impl;
    const list = compoundsFor(node, (selector = String(selector)));
    if (list !== null) {
      let at: N | null = node;
      while (at !== null && at.type === ELEMENT && !matchesCompounds(at, list)) at = at.parent;
      return at !== null && at.type === ELEMENT ? wrap(at) : null;
    }
    const id = engineFor(node).closest(node.id, selector);
    if (id < 0) throw invalidSelector(selector);
    return id === 0 ? null : wrap(node.doc.nodes[id]!);
  }
  insertAdjacentElement(where: string, element: any) {
    if ($argumentCount() < 2) core.tooFew(2);
    const inserted = insertAdjacent(this.$impl, where, unwrap(element, "insertAdjacentElement", 2));
    react();
    return inserted ? element : null;
  }
  insertAdjacentText(where: string, data: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    insertAdjacent(this.$impl, where, core.createText(this.$impl.doc, String(data)));
  }
  insertAdjacentHTML(where: string, html: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    const node = this.$impl;
    const context = /^(?:beforebegin|afterend)$/i.test(where) ? node.parent : node;
    if (context === null || context.type === DOCUMENT) {
      throw domError("NoModificationAllowedError", "The element has no parent.");
    }
    insertAdjacent(node, where, hooks.parseFragment(contextOf(context, node.doc), String(html)));
    react();
  }
  get innerHTML() {
    return hooks.serializeInner(this.$impl);
  }
  set innerHTML(html) {
    const node = this.$impl;
    html = html === null ? "" : String(html);
    core.replaceAll(html === "" && node.name !== "html" ? null : hooks.parseFragment(node, html), contentOf(node));
    react();
  }
  get outerHTML() {
    return hooks.serializeOuter(this.$impl);
  }
  set outerHTML(html) {
    const node = this.$impl;
    const parent = node.parent;
    if (parent === null) return;
    if (parent.type === DOCUMENT) throw domError("NoModificationAllowedError", "The parent is the document.");
    const context = parent.type === FRAGMENT ? contextOf(parent, node.doc) : parent;
    core.replaceChild(node, hooks.parseFragment(context, html === null ? "" : String(html)), parent);
    react();
  }
  getHTML(options: object | undefined = undefined) {
    return hooks.serializeInner(this.$impl, options);
  }
  setHTML(html: string, options: any = {}) {
    if ($argumentCount() < 1) core.tooFew(1);
    setHtml(this.$impl, this.$impl, `${html}`, options, true);
  }
  setHTMLUnsafe(html: string, options: any = {}) {
    if ($argumentCount() < 1) core.tooFew(1);
    setHtml(this.$impl, this.$impl, `${html}`, options, false);
  }
}
defineTokenList(Element, "part", "part");

const ariaStrings = splitTokens(`Atomic AutoComplete BrailleLabel BrailleRoleDescription Busy Checked ColCount ColIndex
  ColIndexText ColSpan Current Description Disabled Expanded HasPopup Hidden Invalid KeyShortcuts Label Level Live Modal
  MultiLine MultiSelectable Orientation Placeholder PosInSet Pressed ReadOnly Relevant Required RoleDescription RowCount
  RowIndex RowIndexText RowSpan Selected SetSize Sort ValueMax ValueMin ValueNow ValueText`);
const ariaNames = ["role", ...ariaStrings.map(name => "aria" + name)];
const ariaAttribute = (property: string) =>
  property === "role" ? property : "aria-" + property.slice(4).toLowerCase();
core.setAccessorFamily(
  core.families.ARIA,
  (self: unknown, property: string) => getAttr(unwrap(self, property), ariaAttribute(property)),
  (self: unknown, property: string, value: unknown) => {
    if (value == null) core.removeAttr(unwrap(self, property), ariaAttribute(property));
    else setAttr(unwrap(self, property), ariaAttribute(property), String(value));
    react();
  },
);
core.defineAccessors(Element.prototype, ariaNames, core.families.ARIA, true);

/** The elements that an attribute of ids refers to, or that a script put in its place. */
function referenced(node: N, attribute: string): N[] | null {
  const explicit = node.rare?.references?.$get(attribute);
  if (explicit !== undefined) return explicit.filter(it => core.containsComposed(core.rootOf(it), node));
  const value = getAttr(node, attribute);
  if (value === null) return null;
  const root = core.rootOf(node);
  return splitTokens(value)
    .map(id => core.elementById(root, id))
    .filter(it => it !== null);
}

function referenceTargets(node: N, attribute: string): N[] | null {
  return (
    referenced(node, attribute)
      ?.map(core.referenceTarget)
      .filter(it => it !== null) ?? null
  );
}

function elementsOf(value: any, isList: boolean): N[] {
  const nodes = (isList ? [...($isObject(value) ? value : [null])] : [value]).map(core.nodeOf);
  if (nodes.some(it => it?.type !== ELEMENT)) throw new TypeError("The value is not of type 'Element'.");
  return nodes as N[];
}

/** The same array for as long as the elements are the same. */
function frozenList(node: N, key: string, nodes: N[] | null) {
  const cache = (rare(node).same ??= new Map());
  const old = cache.$get(key);
  if (nodes !== null && old?.length === nodes.length && nodes.every((it, i) => wrap(it) === old[i])) return old;
  const list = nodes && Object.freeze(nodes.map(wrap));
  cache.$set(key, list);
  return list;
}

function defineReference(ctor: any, property: string, attribute: string, isList: boolean): void {
  if (ctor instanceof core.Interface) return core.extend(ctor, it => defineReference(it, property, attribute, isList));
  core.accessor(
    ctor.prototype,
    property,
    function (this: any) {
      const nodes = referenced(this.$impl, attribute);
      return isList ? frozenList(this.$impl, property, nodes) : wrapOrNull(nodes?.[0]);
    },
    function (this: any, value) {
      if (value == null) core.removeAttr(this.$impl, attribute);
      else {
        const nodes = elementsOf(value, isList);
        setAttr(this.$impl, attribute, "");
        (rare(this.$impl).references ??= new Map()).$set(attribute, nodes);
      }
      react();
    },
  );
}
defineReference(Element, "ariaActiveDescendantElement", "aria-activedescendant", false);
for (const name of splitTokens("Controls DescribedBy Details ErrorMessage FlowTo LabelledBy Owns")) {
  defineReference(Element, `aria${name}Elements`, "aria-" + name.toLowerCase(), true);
}
events.defineHandlers(Element.prototype, [
  ...events.clipboardHandlers,
  "fullscreenchange",
  "fullscreenerror",
  "webkitfullscreenchange",
  "webkitfullscreenerror",
  "search",
]);

core.mixin(childNode, Element, CharacterData, DocumentType);
core.mixin(elementSiblings, Element, CharacterData);
core.mixin(slottable, Element, Text);
core.mixin(parentNode, Element, DocumentFragment);
core.mixin(elementLookups, Element);
core.mixin(elementById, DocumentFragment);
for (const ctor of [CharacterData, Text, CDATASection, Comment, ProcessingInstruction, DocumentType]) expose(ctor);
for (const ctor of [DocumentFragment, ShadowRoot, Attr, Element]) expose(ctor);
for (const [ctor, names] of [
  [Element, "after append before prepend remove replaceChildren replaceWith slot"],
  [CharacterData, "after before remove replaceWith"],
  [DocumentType, "after before remove replaceWith"],
  [DocumentFragment, "append prepend replaceChildren"],
] as const) {
  const value = Object.assign(Object.create(null), Object.fromEntries(splitTokens(names).map(name => [name, true])));
  Object.defineProperty(ctor.prototype, Symbol.unscopables, { value, configurable: true });
}

kinds.text = new Kind(Text);
kinds.cdata = new Kind(CDATASection);
kinds.comment = new Kind(Comment);
kinds.instruction = new Kind(ProcessingInstruction);
kinds.doctype = new Kind(DocumentType);
kinds.fragment = new Kind(DocumentFragment);
kinds.shadowRoot = new Kind(ShadowRoot);
kinds.attr = new Kind(Attr);
kinds.element = new Kind(Element);
hooks.createAttr = createAttr;
hooks.attrValue = attrValue;

export default {
  Element,
  Elements,
  HTMLCollection,
  Node,
  NodeList,
  Nodes,
  ShadowRoot,
  ariaNames,
  elementsOf,
  frozenList,
  arrayIndex,
  attachShadow,
  attrNode,
  attributeKeys,
  cached,
  collectionOf,
  contextOf,
  createAttr,
  datasetOf,
  defineReference,
  defineTokenList,
  elementById,
  elementLookups,
  iterable,
  kList,
  keyOf,
  liveElements,
  locateNamespace,
  pseudoAttributes,
  makeList,
  matches,
  parentNode,
  querySelector,
  querySelectorAll,
  referenced: referenceTargets,
  sanitizerFor,
  setIndexes,
  splitName,
  staticList,
  tagName,
  validateAttributeName,
  validateElementName,
};
