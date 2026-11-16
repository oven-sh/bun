// The node tree. A node is an `N`, which all have one shape. The object that scripts see is made on demand (`wrap`),
// and has its `N` in `$impl`. What is connected is mirrored in the document's engine (src/dom).
const { Engine } = require("internal/desktop/dom/engine");

type int32 = import("bun").int32;
type Engine = InstanceType<typeof Engine>;
type Page = $Dom.Page;

declare global {
  namespace $Dom {
    type N = NodeImpl;
    type Doc = DocImpl;
    type Interface = InterfaceImpl;
    type Listener = ListenerImpl;
    type Engine = InstanceType<typeof Engine>;
  }
}
type NodeImpl = N;
type DocImpl = Doc;
type InterfaceImpl = Interface;
type ListenerImpl = Listener;

const ELEMENT = 1;
const ATTRIBUTE = 2;
const TEXT = 3;
const CDATA = 4;
const INSTRUCTION = 7;
const COMMENT = 8;
const DOCUMENT = 9;
const DOCTYPE = 10;
const FRAGMENT = 11;

const HTML = 0;
const SVG = 1;
const MATHML = 2;
const OTHER = 3;
const namespaces = ["http://www.w3.org/1999/xhtml", "http://www.w3.org/2000/svg", "http://www.w3.org/1998/Math/MathML"];
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const enum F {
  Connected = 1,
  ShadowRoot = 1 << 1,
  Host = 1 << 2,
  /** On a shadow root and on what is in it. */
  UserAgent = 1 << 3,
  Custom = 1 << 4,
  Undefined = 1 << 5,
  /** The attribute does not say what `style` has. */
  StyleDirty = 1 << 6,
  Observed = 1 << 7,
  HasRanges = 1 << 8,
  ChildCache = 1 << 9,
  Slot = 1 << 10,
  TemporaryRoot = 1 << 11,
  HasId = 1 << 12,
  FailedCustom = 1 << 13,
  BlocksWheel = 1 << 14,
  /** For its size or its intersections. */
  Watched = 1 << 15,
  /** It can be a property of the document. */
  Named = 1 << 16,
  /** The engine does not know what `style` has. */
  StyleUnsent = 1 << 24,
  HasNamespacedAttr = 1 << 17,
  Autofocus = 1 << 18,
}
const flags = {
  CONNECTED: F.Connected,
  SHADOW_ROOT: F.ShadowRoot,
  HOST: F.Host,
  USER_AGENT: F.UserAgent,
  CUSTOM: F.Custom,
  UNDEFINED: F.Undefined,
  STYLE_DIRTY: F.StyleDirty,
  STYLE_UNSENT: F.StyleUnsent,
  AUTOFOCUS: F.Autofocus,
  OBSERVED: F.Observed,
  HAS_RANGES: F.HasRanges,
  CHILD_CACHE: F.ChildCache,
  SLOT: F.Slot,
  WATCHED: F.Watched,
  BLOCKS_WHEEL: F.BlocksWheel,
  FAILED_CUSTOM: F.FailedCustom,
};

/** `State` in src/dom/tree.rs */
const states = {
  HOVER: 1,
  ACTIVE: 1 << 1,
  FOCUS: 1 << 2,
  FOCUS_VISIBLE: 1 << 3,
  FOCUS_WITHIN: 1 << 4,
  CHECKED: 1 << 5,
  INDETERMINATE: 1 << 6,
  PLACEHOLDER_SHOWN: 1 << 7,
  VALID: 1 << 8,
  INVALID: 1 << 9,
  USER_VALID: 1 << 10,
  USER_INVALID: 1 << 11,
  IN_RANGE: 1 << 12,
  OUT_OF_RANGE: 1 << 13,
  DEFAULT: 1 << 14,
  MODAL: 1 << 15,
  POPOVER_OPEN: 1 << 16,
  UNDEFINED: 1 << 17,
  TARGET: 1 << 18,
  FULLSCREEN: 1 << 19,
  PICKER_OPEN: 1 << 20,
  FORM_ASSOCIATED: 1 << 21,
};
const INTERACTION = states.HOVER | states.ACTIVE | states.FOCUS | states.FOCUS_VISIBLE | states.FOCUS_WITHIN;

type Hooks = {
  /** Makes `x`. */
  created?(node: N): unknown;
  /** Builds the shadow tree of a control, before it is first rendered. */
  shadow?(node: N): unknown;
  attribute?(node: N, name: string, old: string | null, value: string | null): unknown;
  /** After it was connected. */
  inserted?(node: N, isMove: boolean): unknown;
  /** After it was disconnected. */
  removed?(node: N, scope: N, isMove: boolean): unknown;
  /** After its parent changed, connected or not. */
  moved?(node: N, oldParent: N | null): unknown;
  children?(node: N, isMove?: boolean): unknown;
  /** After the parser saw the end tag of an element that only has text. */
  parsed?(node: N): unknown;
  cloned?(from: N, to: N, deep: boolean): unknown;
  adopted?(node: N, old: Doc): unknown;
  /** After it got an id in the engine. */
  mirrored?(node: N): unknown;
  beforeActivate?(node: N): any;
  activate?(node: N, event: any, origin: N, saved: any): unknown;
  cancelActivate?(node: N, saved: any): unknown;
  /** The default action of a trusted event other than `click`. True if there is nothing more to do. */
  handle?(node: N, event: any, origin: N): boolean | void;
  /** For an element that has indexed properties. */
  list?(node: N): object;
};
type Hook<K extends keyof Hooks> = NonNullable<Hooks[K]> | null;

const lazyInterfaces = new Map<string, Interface>();

/** A constructor that a window has, and that is made when it is first needed. */
class Interface {
  name: string;
  make: () => any;
  ctor: any = null;
  steps: ((ctor: any) => void)[] | null = null;

  constructor(name: string, make: () => any) {
    this.name = name;
    this.make = make;
    lazyInterfaces.$set(name, this);
  }

  load(): any {
    if (this.ctor === null) {
      this.ctor = this.make();
      for (const step of this.steps ?? []) step(this.ctor);
      this.steps = null;
    }
    return this.ctor;
  }
}

/** Runs `step` with the constructor, now or when it is made. */
function extend(target: any, step: (ctor: any) => void) {
  if (!(target instanceof Interface)) step(target);
  else if (target.ctor !== null) step(target.ctor);
  else (target.steps ??= []).push(step);
}

const loaded = (target: any) => (target instanceof Interface ? target.load() : target);

/** What the nodes of one interface do. */
class Kind {
  /** Null until `load`, if it is made when it is first needed. */
  ctor: (new () => object) | null;
  lazy: Interface | null;
  created: Hook<"created">;
  shadow: Hook<"shadow">;
  attribute: Hook<"attribute">;
  inserted: Hook<"inserted">;
  removed: Hook<"removed">;
  moved: Hook<"moved">;
  children: Hook<"children">;
  parsed: Hook<"parsed">;
  cloned: Hook<"cloned">;
  adopted: Hook<"adopted">;
  mirrored: Hook<"mirrored">;
  beforeActivate: Hook<"beforeActivate">;
  activate: Hook<"activate">;
  cancelActivate: Hook<"cancelActivate">;
  handle: Hook<"handle">;
  list: Hook<"list">;

  constructor(ctor: any, hooks: Hooks = {}) {
    this.lazy = ctor instanceof Interface ? ctor : null;
    this.ctor = ctor instanceof Interface ? null : ctor;
    this.created = hooks.created ?? null;
    this.shadow = hooks.shadow ?? null;
    this.attribute = hooks.attribute ?? null;
    this.inserted = hooks.inserted ?? null;
    this.removed = hooks.removed ?? null;
    this.moved = hooks.moved ?? null;
    this.children = hooks.children ?? null;
    this.parsed = hooks.parsed ?? null;
    this.cloned = hooks.cloned ?? null;
    this.adopted = hooks.adopted ?? null;
    this.mirrored = hooks.mirrored ?? null;
    this.beforeActivate = hooks.beforeActivate ?? null;
    this.activate = hooks.activate ?? null;
    this.cancelActivate = hooks.cancelActivate ?? null;
    this.handle = hooks.handle ?? null;
    this.list = hooks.list ?? null;
  }

  load(): new () => object {
    return (this.ctor ??= this.lazy!.load());
  }
}

class Listener {
  /** From `eventType` in events.ts. */
  type: int32;
  flags: int32;
  /** A listener that was added while an event is at its target does not get that event. */
  serial: number;
  callback: any;
  next: Listener | null = null;

  constructor(type: int32, flags: int32, serial: number, callback: any) {
    this.type = type;
    this.flags = flags;
    this.serial = serial;
    this.callback = callback;
  }
}

class Observation {
  observer: $Dom.MutationObserver;
  types: int32;
  oldValues: int32;
  subtree: boolean;
  filter: Set<string> | null;
  /** It follows a node that was removed, until the observer is notified. */
  /** Of a transient one. */
  source: Observation | null = null;

  constructor(
    observer: $Dom.MutationObserver,
    types: number,
    oldValues: number,
    subtree: boolean,
    filter: Set<string> | null,
  ) {
    this.observer = observer;
    this.types = types | 0;
    this.oldValues = oldValues | 0;
    this.subtree = subtree;
    this.filter = filter;
  }
}

class Rare {
  prefix: string | null = null;
  namespace: string | null = null;
  attributeNodes: Map<string, N> | null = null;
  shadow: N | null = null;
  slot: N | null = null;
  manualSlot: N | null = null;
  childNodes: object | null = null;
  children: object | null = null;
  nodeCache: N[] | null = null;
  elementCache: N[] | null = null;
  classList: object | null = null;
  dataset: object | null = null;
  /** Other objects that a getter has to return again. */
  same: Map<string, any> | null = null;
  observers: Observation[] | null = null;
  ranges: $Dom.Range[] | null = null;
  definition: $Dom.Definition | null = null;
  reactions: any[] | null = null;
  isAnimated = false;
  watchers: $Dom.Watcher[] | null = null;
  /** The form that was open when the parser made a control outside of it. */
  parserForm: N | null = null;
  is: string | null = null;
  /** Scoped or null. Undefined: the global one of the document. */
  registry: any = undefined;
  isPrecustomized = false;
  customStates: Set<string> | null = null;
  pseudo: string | null = null;
  originator: N | null = null;
  popover: $Dom.Popover | null = null;
  references: Map<string, N[]> | null = null;
  nonce = "";
  isStyleRefused = false;
}

/** Also what an `EventTarget` that is not a node has, with a `type` of 0. */
class N {
  type: int32;
  flags: int32 = 0;
  id: int32 = 0;
  state: int32 = 0;
  ns: int32 = HTML;
  doc: Doc;
  kind: Kind;
  js: any = null;
  parent: N | null = null;
  first: N | null = null;
  last: N | null = null;
  prev: N | null = null;
  next: N | null = null;
  /** The document or the shadow root that it is in, while it is connected. */
  scope: N | null = null;
  name = "";
  /** Qualified names and values. */
  attrs: string[] | null = null;
  data = "";
  style: $Dom.InlineStyle | null = null;
  listeners: Listener | null = null;
  /** `bitOf` in events.ts, for each of them. */
  listensTo: int32 = 0;
  x: any = null;
  rare: Rare | null = null;

  constructor(type: int32, doc: Doc, kind: Kind) {
    this.type = type;
    this.doc = doc;
    this.kind = kind;
  }
}

/** The `x` of a document and of a shadow root. */
class Scope {
  ids = new Map<string, N | N[]>();
  styleNodes: N[] = [];
  adopted: any[] | null = null;
  styleSheets: object | null = null;
  host: N | null;
  mode = "open";
  delegatesFocus = false;
  manualSlots = false;
  clonable = false;
  serializable = false;
  declarative = false;
  referenceTarget: string | null = null;
  keepsRegistryNull = false;
  availableToInternals = false;
  slots: int32 = 0;
  slotFor: ((child: N) => string) | null = null;

  constructor(host: N | null) {
    this.host = host;
  }
}

class Slot {
  assigned: N[] = [];
  manual: N[] = [];
}

let scratch: { engine: Engine; nodes: (N | null)[] } | undefined;

class Doc {
  node: N;
  engine: Engine = null!;
  nodes: (N | null)[] = [];
  /** Null for a document without a window. */
  page: Page | null = null;
  /** For the objects of another realm. */
  mirror: any = realm.page?.mirror ?? null;
  /** The frame that shows it. */
  container: any = null;
  url = "about:blank";
  baseUrl = "about:blank";
  /** What an `about:blank` document inherits. */
  fallbackBaseUrl: string | null = null;
  contentType = "text/html";
  encoding = "utf-8";
  lastModified: string | null = null;
  /** The form-associated custom elements that have a `form` attribute. */
  customControls: Set<N> | null = null;
  isHtml = true;
  quirks = false;
  readyState = "complete";
  currentScript: N | null = null;
  ignoresDestructiveWrites = 0;
  forbidsMarkupInsertion = 0;
  wasParserAborted = false;
  checksStyleAttributes = false;
  version = 0;
  attributeVersion = 0;
  /** Each lets go of the nodes of a live collection, which may have been removed since. */
  cachedLists: ((evenIfCurrent: boolean) => boolean)[] = [];
  ranges = 0;
  iterators = new Set<$Dom.Traversal>();
  /** 1 childList, 2 attributes, 4 characterData */
  observed: int32 = 0;
  /** Those for which an observer wants the old value. */
  observedOldValues: int32 = 0;
  dirtyStyles: N[] = [];
  dirtyScopes = new Set<N>();
  isSelectionUnsent = false;
  dirtyControls = new Set<N>();
  /** What has `F.Named` in the tree of the document. */
  named = new Set<N>();
  exposedNames: Set<string> | null = null;
  openDialogs: N[] = [];
  hintParent: N | null = null;
  /** How many popovers are being shown or hidden. */
  popoverChanges: int32 = 0;
  hasAutofocused = false;
  needsSync = false;
  scheduled = true;
  templateDoc: Doc | null = null;
  registry: any = null;
  focused: N | null = null;
  selection: $Dom.Selection | null = null;
  topLayer: N[] = [];
  designMode = false;
  parser: $Dom.Parser | null = null;

  constructor() {
    this.node = new N(DOCUMENT, this, kinds.document);
    this.node.x = new Scope(null);
    this.node.flags = F.Connected;
    this.node.scope = this.node;
  }
}

function scopeOf(root: N): Scope {
  return root.x;
}

function hostOf(root: N): N {
  return (root.x as Scope).host!;
}

function slotOf(node: N): Slot {
  return node.x;
}

function prefixOf(node: N): string | null {
  return node.rare === null ? null : node.rare.prefix;
}

const noKind = new Kind(null);
const kinds = {
  html: new Map<string, Kind>(),
  svg: new Map<string, Kind>(),
  attr: noKind,
  cdata: noKind,
  comment: noKind,
  doctype: noKind,
  document: noKind,
  element: noKind,
  fragment: noKind,
  htmlElement: noKind,
  instruction: noKind,
  mathml: noKind,
  shadowRoot: noKind,
  svgElement: noKind,
  text: noKind,
  unknown: noKind,
  xmlDocument: noKind,
};

/** What the modules above this one provide. */
class Provided {
  attachInternals!: (node: N) => object;
  attrValue!: (attr: N) => string;
  beforeBlur!: (node: N) => void;
  beforeConstructing!: (parent: N, name: string, is: string | null) => void;
  formOf!: (node: N) => N | null;
  idChanged!: (doc: Doc, id: string) => void;
  blur!: (node: N) => void;
  watchedMirrored!: (node: N) => void;
  animatedMirrored!: (node: N) => void;
  animatedForgotten!: (node: N) => void;
  animationFor!: (target: N, id: number, pseudo: string) => object | null;
  pseudoElement!: (node: N, type: string) => object | null;
  takeEngineEvents!: (page: $Dom.Page) => void;
  canActivate!: (node: N) => boolean;
  createAttr!: (doc: Doc, name: string, prefix: string | null, namespace: string | null, value: string) => N;
  createCustomElement!: (
    doc: Doc,
    name: string,
    is: string | null,
    synchronous: boolean,
    registry: any,
    prefix: string | null,
  ) => N;
  fire!: (node: N, type: string, bubbles?: boolean) => boolean;
  framesChanged!: (page: $Dom.Page) => void;
  flushControls!: (doc: Doc) => void;
  flushSheets!: (doc: Doc) => void;
  importsChanged!: (sheet: any) => void;
  sendSelection!: (doc: Doc) => void;
  flushStyle!: (node: N) => void;
  sendStyle!: (node: N, id: number) => void;
  checkStyleAttribute!: (node: N, value: string | null) => void;
  focusFromScript!: (node: N, options?: object) => void;
  openWindow!: (page: $Dom.Page, url: unknown, target?: string, features?: string) => unknown;
  focusSelection!: (selection: $Dom.Selection) => void;
  expandRange!: (range: $Dom.Range, unit: string) => void;
  globalAttribute!: (node: N, name: string, old: string | null, value: string | null) => void;
  handlerAttribute!: (node: N, name: string, value: string | null) => void;
  hidePopover!: (node: N, throws: boolean) => void;
  invokedPopover!: (node: N) => N | null;
  takeFrameMargins!: (body: N) => void;
  showControls!: (root: N) => void;
  isDetailsSummary!: (node: N) => boolean;
  isDisabled!: (node: N) => boolean;
  isEditingHost!: (node: N) => boolean;
  isSkippedRadio!: (node: N) => boolean;
  iteratorsBeforeRemove!: (node: N) => void;
  labeledControl!: (label: N) => N | null;
  makeFormAssociated!: (node: N) => void;
  markFocus!: (doc: Doc, on: boolean) => void;
  modifySelection!: (selection: $Dom.Selection, alter: string, direction: string, granularity: string) => void;
  scopedRegistryConnected!: (node: N) => void;
  registryOption!: (value: unknown, doc: Doc) => any;
  exitPointerLock!: (page: Page) => void;
  loadInterface!: (name: string) => any;
  wrapAsList!: (node: N, list: object) => object;
  parseHtmlFragment!: (
    context: N,
    html: string,
    allowShadow: boolean,
    withScripts: boolean,
    registryFrom: N,
    isInert: boolean,
  ) => N;
  autofocusInserted!: (node: N) => void;
  invokesPopovers!: (node: N) => boolean;
  frameOf!: (node: N) => any;
  isBaseListBox!: (node: N) => boolean;
  pickerOf!: (node: N) => N | null;
  isFocusableOption!: (node: N) => boolean;
  isSkippedOption!: (node: N) => boolean;
  namesChanged!: (doc: Doc) => void;
  notifyObserver!: (observer: $Dom.MutationObserver) => void;
  parseFragment!: (context: N, html: string, allowShadow?: boolean, withScripts?: boolean, registryFrom?: N) => N;
  popoverRemoved!: (node: N) => void;
  popoverState!: (node: N) => string | null;
  rangesAdopted!: (node: N, old: Doc) => void;
  rangesAfterInsert!: (parent: N, index: number, count: number) => void;
  rangesAfterReplaceData!: (node: N, offset: number, count: number, length: number) => void;
  rangesAfterSplit!: (node: N, rest: N, offset: number) => void;
  rangesBeforeMerge!: (into: N, merged: N, length: number) => void;
  rangesBeforeRemove!: (node: N, parent: N) => void;
  revealCaret!: (node: N) => boolean;
  selectOnFocus!: (node: N, fromKeyboard: boolean) => void;
  serializeInner!: (node: N, options?: object) => string;
  serializeOuter!: (node: N) => string;
  showPopover!: (node: N, throws: boolean, invoker: N | null) => void;
  togglePopover!: (node: N, force: boolean | undefined, source: N | null) => boolean;
  topModal!: (doc: Doc) => N | null;
  tryUpgrade!: (node: N) => void;
  upgrade!: (node: N, definition: $Dom.Definition) => void;
}
const hooks = new Provided();

function domError(name: string, message: string) {
  const error = new DOMException(message, name);
  return realm.hasFrames ? (realm.page?.mirror?.adopt(error) ?? error) : error;
}

function tooFew(wanted: number): never {
  throw new TypeError(`${wanted} argument${wanted > 1 ? "s" : ""} required.`);
}

function isInterface(value: Function): boolean {
  return interfaces[value.name] === value || !!realm.page.mirror?.isInterface(value);
}

function illegalConstructor(): never {
  throw new TypeError("Illegal constructor");
}

/** What the constructor of `EventTarget` takes as its `$impl`. */
let pending: N | null = null;

function setPending(node: N) {
  pending = node;
}

function hasPending(): boolean {
  return pending !== null;
}

function takePending(): N | null {
  const node = pending;
  pending = null;
  return node;
}

function wrap(node: N): any {
  const js = node.js;
  if (js !== null) return js;
  const { kind } = node;
  const ctor = kind.ctor ?? kind.load();
  const { mirror } = node.doc;
  if (mirror !== null) mirror.constructorFor(ctor);
  pending = node;
  const made = mirror === null ? new ctor() : mirror.construct(ctor);
  return kind.list === null ? made : hooks.wrapAsList(node, kind.list(node));
}

function wrapOrNull(node: N | null | undefined): any {
  return node ? (node.js ?? wrap(node)) : null;
}

function nodeOf(value: any): N | null {
  const node = $isObject(value) ? value.$impl : undefined;
  return node instanceof N && node.type !== 0 ? node : null;
}

function unwrap(value: any, method: string, index = 1): N {
  const node = nodeOf(value);
  if (node === null) throw new TypeError(`Failed to execute '${method}': parameter ${index} is not of type 'Node'.`);
  return node;
}

function rare(node: N): Rare {
  return node.rare ?? (node.rare = new Rare());
}

function same(node: N, key: string, make: (node: N) => any) {
  const map = (rare(node).same ??= new Map());
  let value = map.$get(key);
  if (value === undefined) map.$set(key, (value = make(node)));
  return value;
}

function reportError(page: Page | null, error: unknown) {
  (page ?? realm.page).reportError(error);
}

// ───────────────────────────── creation ─────────────────────────────

function createDoc(page?: Page): Doc {
  const doc = new Doc();
  if (page) {
    doc.page = page;
    doc.mirror = page.mirror;
    doc.container = page.container;
    doc.url = doc.baseUrl = page.url;
    doc.engine = new Engine(page.fontScope, doc.url);
    doc.node.id = 1;
    doc.nodes = [null, doc.node];
    doc.scheduled = false;
  }
  return doc;
}

function isValidCustomName(name: string) {
  return (
    /^[a-z][^\t\n\f\r \0\/>A-Z]*$/.test(name) &&
    name.includes("-") &&
    !/^(?:annotation-xml|color-profile|font-face(?:-src|-uri|-format|-name)?|missing-glyph)$/.test(name)
  );
}

/** Without custom elements. */
let hasScopedRegistries = false;
/** `Rare.registry` of the elements that are made now. */
let creatingIn: any;

function noteScopedRegistry() {
  hasScopedRegistries = true;
  return null;
}

function registryOf(node: N) {
  const own = node.rare === null ? undefined : node.rare.registry;
  return own === undefined ? node.doc.registry : own;
}

/** Returns what to restore. */
function setRegistry(registry: any, doc?: Doc) {
  const before = creatingIn;
  creatingIn = registry === doc?.registry || registry?.$impl.doc ? undefined : registry;
  return before;
}

function createPlainElement(doc: Doc, name: string, ns: number): N {
  let kind: Kind | undefined;
  if (ns === HTML) kind = kinds.html.$get(name) ?? (isValidCustomName(name) ? kinds.htmlElement : kinds.unknown);
  else if (ns === SVG) kind = kinds.svg.$get(name) ?? kinds.svgElement;
  else kind = ns === MATHML ? kinds.mathml : kinds.element;
  const node = new N(ELEMENT, doc, kind!);
  node.name = name;
  node.ns = ns | 0;
  if (creatingIn !== undefined) rare(node).registry = creatingIn;
  if (kind!.created !== null) kind!.created(node);
  return node;
}

function createElement(
  doc: Doc,
  name: string,
  ns: number,
  is: string | null,
  synchronous: boolean,
  prefix: string | null = null,
): N {
  if (ns === HTML && (is !== null || (!kinds.html.$has(name) && isValidCustomName(name)))) {
    return hooks.createCustomElement(
      doc,
      name,
      is,
      synchronous,
      creatingIn === undefined ? doc.registry : creatingIn,
      prefix,
    );
  }
  const node = createPlainElement(doc, name, ns);
  if (prefix !== null) rare(node).prefix = prefix;
  if (is !== null) rare(node).is = is;
  return node;
}

function createElementNS(
  doc: Doc,
  namespace: string | null,
  prefix: string | null,
  name: string,
  is: string | null,
  synchronous: boolean,
): N {
  const index = namespaces.indexOf(namespace!);
  const node = createElement(doc, name, index < 0 ? OTHER : index, is, synchronous, prefix);
  if (index < 0) rare(node).namespace = namespace;
  return node;
}

function createData(doc: Doc, type: number, data: string, name = ""): N {
  const kind =
    type === TEXT ? kinds.text : type === COMMENT ? kinds.comment : type === CDATA ? kinds.cdata : kinds.instruction;
  const node = new N(type | 0, doc, kind);
  node.data = data;
  node.name = name;
  return node;
}

function createText(doc: Doc, data: string): N {
  const node = new N(TEXT, doc, kinds.text);
  node.data = data;
  return node;
}

function createFragment(doc: Doc): N {
  return new N(FRAGMENT, doc, kinds.fragment);
}

function createDoctype(doc: Doc, name: string, publicId: string, systemId: string): N {
  const node = new N(DOCTYPE, doc, kinds.doctype);
  node.name = name;
  node.x = { publicId, systemId };
  return node;
}

function templateDoc(doc: Doc): Doc {
  if (doc.templateDoc === null) {
    const inert = (doc.templateDoc = createDoc());
    inert.templateDoc = inert;
    inert.isHtml = doc.isHtml;
    inert.contentType = doc.contentType;
  }
  return doc.templateDoc;
}

function attachShadow(host: N, userAgent: boolean): N {
  const root = new N(FRAGMENT, host.doc, kinds.shadowRoot);
  root.flags = F.ShadowRoot | (userAgent ? F.UserAgent : 0) | (host.flags & F.Connected);
  root.x = new Scope(host);
  if (host.flags & F.Connected) root.scope = root;
  rare(host).shadow = root;
  host.flags |= F.Host;
  if (host.id !== 0) {
    const doc = host.doc;
    doc.nodes[(root.id = doc.engine.attachShadow(host.id, userAgent) | 0)] = root;
    invalidate(doc);
  }
  return root;
}

// ───────────────────────────── traversal ─────────────────────────────

function namespaceOf(node: N): string | null {
  return node.ns === OTHER ? (node.rare?.namespace ?? null) : namespaces[node.ns];
}

function qualifiedName(node: N): string {
  const prefix = prefixOf(node);
  return prefix === null ? node.name : prefix + ":" + node.name;
}

function isHtml(node: N | null, name: string): boolean {
  return node !== null && node.name === name && node.ns === HTML && node.type === ELEMENT;
}

function isText(node: N): boolean {
  return node.type === TEXT || node.type === CDATA;
}

function isData(node: N): boolean {
  const type = node.type;
  return type === TEXT || type === COMMENT || type === CDATA || type === INSTRUCTION;
}

/** The next node in tree order within `root`. */
function following(node: N, root: N | null): N | null {
  return node.first ?? followingSkip(node, root);
}

function followingSkip(node: N | null, root: N | null): N | null {
  for (; node !== null && node !== root; node = node.parent) {
    if (node.next !== null) return node.next;
  }
  return null;
}

function preceding(node: N, root: N | null): N | null {
  if (node === root) return null;
  let at = node.prev;
  if (at === null) return node.parent;
  while (at.last !== null) at = at.last;
  return at;
}

function parentElement(node: N): N | null {
  const parent = node.parent;
  return parent !== null && parent.type === ELEMENT ? parent : null;
}

function parentOrHost(node: N): N | null {
  return node.parent ?? (node.flags & F.ShadowRoot ? hostOf(node) : null);
}

function flatParent(node: N): N | null {
  const parent = node.parent;
  if (parent === null) return node.flags & F.ShadowRoot ? hostOf(node) : null;
  if (parent.flags & F.ShadowRoot) return hostOf(parent);
  return parent.flags & F.Host ? (node.rare?.slot ?? null) : parent;
}

function flatChildren(node: N): N[] {
  if (node.flags & F.Host) return childArray(node.rare!.shadow!);
  if (node.flags & F.Slot && slotOf(node).assigned.length > 0) return slotOf(node).assigned;
  return childArray(node);
}

function rootOf(node: N): N {
  if (node.scope !== null) return node.scope;
  while (node.parent !== null) node = node.parent;
  return node;
}

function composedRoot(node: N): N {
  node = rootOf(node);
  while (node.flags & F.ShadowRoot) node = rootOf(hostOf(node));
  return node;
}

function contains(ancestor: N, node: N | null): boolean {
  for (; node !== null; node = node.parent) if (node === ancestor) return true;
  return false;
}

function containsComposed(ancestor: N, node: N | null): boolean {
  for (; node !== null; node = parentOrHost(node)) if (node === ancestor) return true;
  return false;
}

function containsFlat(ancestor: N, node: N | null): boolean {
  for (; node !== null; node = flatParent(node)) if (node === ancestor) return true;
  return false;
}

/** `node` as seen from `against`. */
function retarget(node: N | null, against: N | null): N | null {
  while (node !== null) {
    const root = rootOf(node);
    if (!(root.flags & F.ShadowRoot) || (against !== null && containsComposed(root, against))) return node;
    node = hostOf(root);
  }
  return null;
}

/** The control, for what is in its shadow tree. */
function outOfControl(node: N): N {
  while (node.flags & F.UserAgent) node = hostOf(rootOf(node));
  return node;
}

function indexOf(node: N): number {
  let index = 0;
  for (let at = node.prev; at !== null; at = at.prev) index++;
  return index;
}

function childArray(node: N): N[] {
  const extra = rare(node);
  if (extra.nodeCache !== null) return extra.nodeCache;
  const list: N[] = [];
  for (let child = node.first; child !== null; child = child.next) list.push(child);
  node.flags |= F.ChildCache;
  return (extra.nodeCache = list);
}

function elementChildren(node: N): N[] {
  const extra = rare(node);
  if (extra.elementCache !== null) return extra.elementCache;
  const list: N[] = [];
  for (let child = node.first; child !== null; child = child.next) if (child.type === ELEMENT) list.push(child);
  node.flags |= F.ChildCache;
  return (extra.elementCache = list);
}

function childAt(node: N, index: number): N | null {
  let child = node.first;
  while (child !== null && index-- > 0) child = child.next;
  return child;
}

function lengthOf(node: N): number {
  if (isData(node)) return node.data.length;
  let count = 0;
  for (let child = node.first; child !== null; child = child.next) count++;
  return count;
}

function textContent(node: N): string {
  const first = node.first;
  if (first === null) return "";
  if (first === node.last && first.type === TEXT) return first.data;
  let text = "";
  for (let at: N | null = first; at !== null; at = following(at, node)) if (isText(at)) text += at.data;
  return text;
}

function childText(node: N): string {
  let text = "";
  for (let at = node.first; at !== null; at = at.next) if (isText(at)) text += at.data;
  return text;
}

/** Negative if `a` comes first. 0 for the same node, and for nodes of different trees. */
function compareOrder(a: N, b: N): number {
  if (a === b) return 0;
  let depthA = 0;
  let depthB = 0;
  for (let at = a.parent; at !== null; at = at.parent) depthA++;
  for (let at = b.parent; at !== null; at = at.parent) depthB++;
  let x = a;
  let y = b;
  for (; depthA > depthB; depthA--) x = x.parent!;
  for (; depthB > depthA; depthB--) y = y.parent!;
  if (x === y) return x === a ? -1 : 1;
  while (x.parent !== y.parent) {
    x = x.parent!;
    y = y.parent!;
  }
  if (x.parent === null) return 0;
  for (let forward = x.next, backward = x.prev; ;) {
    if (forward === y || backward === null) return -1;
    if (backward === y || forward === null) return 1;
    forward = forward.next;
    backward = backward.prev;
  }
}

function findDescendant(root: N, test: (node: N) => boolean): N | null {
  for (let at = root.first; at !== null; at = following(at, root)) if (at.type === ELEMENT && test(at)) return at;
  return null;
}

function filterDescendants(root: N, test: (node: N) => boolean): N[] {
  const found: N[] = [];
  for (let at = root.first; at !== null; at = following(at, root)) {
    if (at.type === ELEMENT && test(at)) found.push(at);
  }
  return found;
}

/** The element that a reference to `node` from outside of its shadow tree applies to. */
function referenceTarget(node: N | null): N | null {
  for (let root, id; (root = node?.rare?.shadow) && (id = scopeOf(root).referenceTarget) !== null;)
    node = elementById(root, id);
  return node;
}

/** In all the trees that can refer to `target`. */
function filterReferrers(target: N, test: (node: N) => boolean): N[] {
  let root = rootOf(target);
  let found = filterDescendants(root, test);
  while (root.flags & F.ShadowRoot && scopeOf(root).referenceTarget !== null) {
    const host = hostOf(root)!;
    if (referenceTarget(host) !== target) break;
    const outer = filterDescendants((root = rootOf(host)), it => it === host || test(it));
    const at = outer.indexOf(host);
    if (at < 0) break;
    found = [...outer.slice(0, test(host) ? at + 1 : at), ...found, ...outer.slice(at + 1)];
  }
  return found;
}

function closestHtml(node: N | null, name: string): N | null {
  while (node !== null && !isHtml(node, name)) node = node.parent;
  return node;
}

function documentElement(doc: Doc): N | null {
  let child = doc.node.first;
  while (child !== null && child.type !== ELEMENT) child = child.next;
  return child;
}

function rootChild(doc: Doc, name: string, other?: string): N | null {
  const root = documentElement(doc);
  if (!isHtml(root, "html")) return null;
  for (let child = root!.first; child !== null; child = child.next) {
    if (isHtml(child, name) || (other !== undefined && isHtml(child, other))) return child;
  }
  return null;
}

function bodyOf(doc: Doc): N | null {
  return rootChild(doc, "body", "frameset");
}

function elementById(root: N, id: string): N | null {
  if (id === "") return null;
  if (root.scope !== root) return findDescendant(root, node => getAttr(node, "id") === id);
  const found = scopeOf(root).ids.$get(id);
  if (found === undefined) return null;
  return $isJSArray(found) ? found.sort(compareOrder)[0] : found;
}

function addId(scope: N, id: string, node: N) {
  if (node.doc.customControls !== null) hooks.idChanged(node.doc, id);
  const ids = scopeOf(scope).ids;
  const found = ids.$get(id);
  if (found === undefined) ids.$set(id, node);
  else if ($isJSArray(found)) found.push(node);
  else ids.$set(id, [found, node]);
}

const nameable = new Set(["embed", "form", "iframe", "img", "object"]);

function noteNamed(node: N) {
  const { doc } = node;
  if (node.flags & F.Named && node.scope === doc.node) doc.named.$add(node);
  else if (!doc.named.$delete(node)) return;
  hooks.namesChanged(doc);
}

function nameChanged(node: N) {
  if (node.ns !== HTML || !nameable.$has(node.name)) return;
  const isNamed = !!getAttr(node, "name") || (node.name === "object" && (node.flags & F.HasId) !== 0);
  node.flags = isNamed ? node.flags | F.Named : node.flags & ~F.Named;
  noteNamed(node);
}

function removeId(scope: N, id: string, node: N) {
  const ids = scopeOf(scope).ids;
  const found = ids.$get(id);
  if (found === node) ids.$delete(id);
  else if ($isJSArray(found)) {
    found.splice(found.indexOf(node), 1);
    if (found.length === 1) ids.$set(id, found[0]);
  }
  if (node.doc.customControls !== null) hooks.idChanged(node.doc, id);
}

// ───────────────────────────── the mirror ─────────────────────────────

function invalidate(doc: Doc) {
  if (!doc.scheduled) {
    doc.scheduled = true;
    doc.page!.schedule();
  }
}

/** After a change that no style may depend on. */
function invalidateIfDirty(doc: Doc) {
  if (!doc.scheduled && (doc.engine.pending() !== 0 || doc.engine.isAnimating() || doc.page!.isAccessible))
    invalidate(doc);
}

/** The engine, after it was told what JavaScript had put off. */
function sync(doc: Doc): Engine {
  if (doc.container !== null) doc.container.measure();
  if (doc.needsSync) {
    doc.needsSync = false;
    const dirty = doc.dirtyStyles;
    if (dirty.length > 0) {
      doc.dirtyStyles = [];
      for (let i = 0; i < dirty.length; i++) if (dirty[i].flags & F.StyleUnsent) hooks.sendStyle(dirty[i], dirty[i].id);
    }
    if (doc.dirtyControls.size > 0) hooks.flushControls(doc);
    if (doc.dirtyScopes.size > 0) hooks.flushSheets(doc);
    if (doc.isSelectionUnsent) {
      doc.isSelectionUnsent = false;
      if (doc.page !== null) hooks.sendSelection(doc);
    }
  }
  return doc.engine;
}

let watchedVersion = 0;

/** The id of a node that is watched has changed. */
function watchedChanged() {
  watchedVersion++;
}

function mirrorOne(node: N, doc: Doc, engine: Engine): boolean {
  if (node.type === ELEMENT) {
    const id = engine.createElement(node.name, node.ns);
    const attrs = node.attrs;
    if (attrs !== null) {
      for (let i = 0; i < attrs.length; i += 2) {
        if (node.style !== null && attrs[i] === "style") hooks.sendStyle(node, id);
        else engine.setAttribute(id, node.flags & F.HasNamespacedAttr ? engineKey(attrs[i]) : attrs[i], attrs[i + 1]);
      }
    }
    if (node.flags & F.Watched) {
      hooks.watchedMirrored(node);
      watchedChanged();
    }
    if (node.flags & F.BlocksWheel) engine.setBlocksWheel(id, true);
    if (node.state !== 0) engine.setState(id, node.state, true);
    doc.nodes[(node.id = id | 0)] = node;
    const extra = node.rare;
    if (extra !== null) {
      if (node.ns === OTHER) engine.setAttribute(id, "\0", extra.namespace ?? "");
      if (extra.pseudo !== null) engine.setPseudo(id, extra.pseudo, extra.originator!.id);
      if (extra.isAnimated) afterMirror.push(node);
      if (extra.isStyleRefused) engine.removeAttribute(id, "style");
      if (extra.customStates !== null) for (const name of extra.customStates) engine.setCustomState(id, name, true);
    }
    if (node.kind.mirrored !== null) node.kind.mirrored(node);
    return true;
  }
  if (node.type !== TEXT && node.type !== CDATA) return false;
  doc.nodes[(node.id = engine.createText(node.data) | 0)] = node;
  return true;
}

let mirroredSlots: N[] = [];
const afterMirror: N[] = [];

function mirrorChildren(root: N, doc: Doc, engine: Engine) {
  for (let at: N | null = root; at !== null; at = following(at, root)) {
    if (at !== root) {
      if (!mirrorOne(at, doc, engine)) continue;
      engine.insert(at.parent!.id, at.id, 0);
    }
    if (at.flags & F.Host) {
      const shadow = at.rare!.shadow!;
      doc.nodes[(shadow.id = engine.attachShadow(at.id, (shadow.flags & F.UserAgent) !== 0) | 0)] = shadow;
      if (scopeOf(shadow).adopted !== null) dirtyScope(shadow);
      mirrorChildren(shadow, doc, engine);
    } else if (at.flags & F.Slot) mirroredSlots.push(at);
  }
}

function mirroredFrom(node: N | null): number {
  while (node !== null && node.id === 0) node = node.next;
  return node === null ? 0 : node.id;
}

function mirrorSlot(slot: N) {
  if (slot.id === 0) return;
  const ids: number[] = [];
  for (const node of slotOf(slot).assigned) if (node.id !== 0) ids.push(node.id);
  slot.doc.engine.assignSlot(slot.id, ids);
}

function mirrorSlots() {
  const slots = mirroredSlots;
  if (slots.length === 0) return;
  mirroredSlots = [];
  for (const slot of slots) if (slotOf(slot).assigned.length > 0) mirrorSlot(slot);
}

function mirror(node: N, parentId: number) {
  const doc = node.doc;
  const engine = doc.engine;
  if (!mirrorOne(node, doc, engine)) return;
  if (node.first !== null || node.flags & (F.Host | F.Slot)) mirrorChildren(node, doc, engine);
  engine.insert(parentId, node.id, mirroredFrom(node.next));
  mirrorSlots();
  if (afterMirror.length > 0) for (const it of afterMirror.splice(0)) if (it.scope !== null) hooks.animatedMirrored(it);
}

function forgetIds(root: N, nodes: (N | null)[]) {
  for (let at: N | null = root; at !== null; at = following(at, root)) {
    nodes[at.id] = null;
    at.id = 0;
    if (at.flags & F.Watched) watchedChanged();
    if (at.rare !== null && at.rare.isAnimated) hooks.animatedForgotten(at);
    if (at.flags & F.Host) {
      const shadow = at.rare!.shadow!;
      shadow.doc.dirtyScopes.$delete(shadow);
      for (const sheet of scopeOf(shadow).adopted ?? []) sheet.$impl.scopes.$delete(shadow);
      forgetIds(shadow, nodes);
    }
  }
}

function unmirror(node: N) {
  const { doc } = node;
  doc.engine.remove(node.id);
  if (doc.page !== null) hooks.takeEngineEvents(doc.page);
  forgetIds(node, doc.nodes);
}

let temporary: (N | number)[] = [];

function dropTemporary(root: N) {
  const index = temporary.indexOf(root);
  root.flags &= ~F.TemporaryRoot;
  root.doc.engine.remove(temporary[index + 1] as number);
  forgetIds(root, root.doc.nodes);
  temporary.splice(index, 2);
}

function dropAllTemporary() {
  while (temporary.length > 0) dropTemporary(temporary[temporary.length - 2] as N);
}

/** For a tree that is not rendered: the engine has it until the next microtask. */
function engineFor(node: N): Engine {
  const doc = node.doc;
  if (node.id !== 0) return sync(doc);
  if (doc.engine === null) {
    scratch ??= { engine: new Engine(0, "about:blank"), nodes: [] };
    doc.engine = scratch.engine;
    doc.nodes = scratch.nodes;
  }
  const engine = doc.engine;
  const root = composedRoot(node);
  const fragment = root.type === DOCUMENT ? engine.createDocument() : engine.createFragment();
  if (temporary.length === 0) queueMicrotask(dropAllTemporary);
  temporary.push(root, fragment);
  root.flags |= F.TemporaryRoot;
  if (root.type === ELEMENT) mirror(root, fragment);
  else {
    doc.nodes[(root.id = fragment | 0)] = root;
    mirrorChildren(root, doc, engine);
    mirrorSlots();
  }
  hooks.showControls(root);
  return engine;
}

function setState(node: N, bits: number, on: boolean) {
  const state = on ? node.state | bits : node.state & ~bits;
  if (state === node.state) return;
  node.state = state;
  if (node.id !== 0) {
    node.doc.engine.setState(node.id, bits, on);
    invalidateIfDirty(node.doc);
  }
}

/** 0 none, 1 limited, 2 all */
function setQuirks(doc: Doc, mode: number) {
  if (doc.url === "about:srcdoc") mode = 0;
  doc.quirks = mode === 2;
  if (doc.page !== null) doc.engine.setState(doc.node.id, mode, true);
}

function setPseudo(node: N, name: string, originator: N) {
  rare(node).pseudo = name;
  node.rare!.originator = originator;
  if (node.id !== 0) node.doc.engine.setPseudo(node.id, name, originator.id);
}

function dirtyScope(scope: N) {
  const doc = scope.doc;
  if (doc.page === null) return;
  doc.dirtyScopes.$add(scope);
  doc.needsSync = true;
  invalidate(doc);
}

function ensureShadow(node: N): N | null {
  if (node.kind.shadow !== null && !(node.flags & F.Host)) node.kind.shadow(node);
  return node.rare?.shadow ?? null;
}

// ───────────────────────────── reactions and observers ─────────────────────────────

/** The elements that have something in `rare.reactions`. */
let reactions: N[] = [];

function enqueue(node: N, callback: Function | null, argument: unknown) {
  (rare(node).reactions ??= []).push(callback, argument);
  if (reactions.push(node) === 1) queueMicrotask(react);
}

function enqueueReaction(node: N, name: string, a?: any, b?: any, c?: any, d?: any) {
  const callback = node.rare!.definition!.callbacks[name];
  if (callback !== undefined)
    enqueue(node, callback, a === undefined ? [] : b === undefined ? [a] : c === undefined ? [a, b] : [a, b, c, d]);
}

/** For an element whose reactions are running. */
function queueReaction(node: N, name: string, values: unknown[]) {
  const callback = node.rare!.definition!.callbacks[name];
  if (callback !== undefined) node.rare!.reactions!.push(callback, values);
}

function runReactionsOf(node: N) {
  const list = node.rare!.reactions!;
  while (list.length > 0) {
    const [callback, argument] = list.splice(0, 2);
    try {
      if (callback === null) hooks.upgrade(node, argument);
      else callback.$apply(wrap(node), argument);
    } catch (error) {
      const culprit = callback ?? argument.ctor;
      reportError((realm.hasFrames && pageOfCallback(culprit)) || node.doc.page, error);
    }
  }
}

function enqueueUpgrade(node: N, definition: $Dom.Definition) {
  enqueue(node, null, definition);
}

function runReactions() {
  const queue = reactions;
  const { page } = realm;
  reactions = [];
  realm.page = realm.root;
  for (const node of queue) runReactionsOf(node);
  realm.page = page;
}

/** At the end of what a script called. */
function react() {
  if (reactions.length !== 0) runReactions();
}

const activeObservers = new Set<$Dom.MutationObserver>();
let signaledSlots = new Set<N>();
let observersQueued = false;

function queueObservers() {
  if (observersQueued) return;
  observersQueued = true;
  queueMicrotask(notifyObservers);
}

function notifyObservers() {
  observersQueued = false;
  const observers = Array.from(activeObservers).sort((a, b) => a.serial - b.serial);
  const slots = signaledSlots;
  activeObservers.clear();
  signaledSlots = new Set();
  for (const observer of observers) hooks.notifyObserver(observer);
  for (const slot of slots) hooks.fire(slot, "slotchange", true);
}

function queueRecord(
  type: number,
  target: N,
  name: string | null,
  namespace: string | null,
  oldValue: string | null,
  added: N[] | null,
  removed: N[] | null,
  previous: N | null,
  next: N | null,
) {
  let first: Observation | null = null;
  let others: Observation[] | null = null;
  for (let node: N | null = target; node !== null; node = node.parent) {
    if (!(node.flags & F.Observed)) continue;
    for (const it of node.rare!.observers!) {
      if (!(it.types & type) || (node !== target && !it.subtree)) continue;
      if (type === 2 && it.filter !== null && (namespace !== null || !it.filter.$has(name!))) continue;
      if (first === null) first = it;
      else (others ??= [first]).push(it);
    }
  }
  if (first === null) return;
  const seen: $Dom.MutationObserver[] = [];
  for (const { observer } of others ?? [first]) {
    if (seen.includes(observer)) continue;
    seen.push(observer);
    const wantsOld = (others ?? [first]).some(it => it.observer === observer && (it.oldValues & type) !== 0);
    const old = wantsOld ? oldValue : null;
    observer.records.push({ type, target, name, namespace, oldValue: old, added, removed, previous, next });
    activeObservers.$add(observer);
  }
  queueObservers();
}

function observeTransiently(node: N, parent: N) {
  for (let at: N | null = parent; at !== null; at = at.parent) {
    if (!(at.flags & F.Observed)) continue;
    for (const source of at.rare!.observers!) {
      const { observer, types, oldValues, subtree, filter } = source;
      if (!subtree) continue;
      const transient = new Observation(observer, types, oldValues, true, filter);
      transient.source = source.source ?? source;
      (rare(node).observers ??= []).push(transient);
      node.flags |= F.Observed;
      observer.transient.push(node);
      activeObservers.$add(observer);
      queueObservers();
    }
  }
}

// ───────────────────────────── slots ─────────────────────────────

function signalSlot(slot: N) {
  if (slot.flags & F.UserAgent) return;
  signaledSlots.$add(slot);
  queueObservers();
}

function assignSlots(shadow: N) {
  const { manualSlots, slotFor } = scopeOf(shadow);
  const host = hostOf(shadow);
  const slots = scopeOf(shadow).slots > 0 ? filterDescendants(shadow, node => (node.flags & F.Slot) !== 0) : [];
  const byName = new Map<string, N>();
  const assigned = new Map<N, N[]>();
  for (const slot of slots) {
    const name = getAttr(slot, "name") ?? "";
    if (!byName.$has(name)) byName.$set(name, slot);
    assigned.$set(slot, []);
  }
  for (let child = host.first; child !== null; child = child.next) {
    if (child.type !== ELEMENT && child.type !== TEXT) continue;
    let slot: N | null | undefined;
    if (slotFor !== null) slot = byName.$get(slotFor(child));
    else if (manualSlots) slot = child.rare?.manualSlot;
    else slot = byName.$get((child.type === ELEMENT && getAttr(child, "slot")) || "");
    const list = slot ? assigned.$get(slot) : undefined;
    list?.push(child);
    if (list !== undefined || child.rare !== null) rare(child).slot = list !== undefined ? slot! : null;
  }
  for (const [slot, list] of assigned) {
    const old: N[] = slotOf(slot).assigned;
    if (manualSlots) list.sort((a, b) => slotOf(slot).manual.indexOf(a) - slotOf(slot).manual.indexOf(b));
    if (old.length === list.length && old.every((node, i) => node === list[i])) continue;
    slotOf(slot).assigned = list;
    mirrorSlot(slot);
    invalidate(slot.doc);
    signalSlot(slot);
  }
}

function countSlots(root: N): number {
  let count = 0;
  for (let at: N | null = root; at !== null; at = following(at, root)) if (at.flags & F.Slot) count++;
  return count;
}

let slotsExist = false;
function noteSlot(node: N) {
  node.flags |= F.Slot;
  node.x = new Slot();
  slotsExist = true;
}

function slotsAfterInsert(node: N, parent: N) {
  if (parent.flags & F.Host) assignSlots(parent.rare!.shadow!);
  const root = rootOf(parent);
  if (!(root.flags & F.ShadowRoot)) return;
  if (parent.flags & F.Slot && slotOf(parent).assigned.length === 0) signalSlot(parent);
  const count = countSlots(node);
  if (count > 0) {
    scopeOf(root).slots = (scopeOf(root).slots + count) | 0;
    assignSlots(root);
  }
}

function slotsAfterRemove(node: N, parent: N) {
  if (parent.flags & F.Host) {
    if (node.rare !== null) node.rare.slot = null;
    assignSlots(parent.rare!.shadow!);
  }
  const root = rootOf(parent);
  if (!(root.flags & F.ShadowRoot)) return;
  if (parent.flags & F.Slot && slotOf(parent).assigned.length === 0) signalSlot(parent);
  const count = countSlots(node);
  if (count > 0) {
    scopeOf(root).slots = (scopeOf(root).slots - count) | 0;
    for (let at: N | null = node; at !== null; at = following(at, node)) {
      if (at.flags & F.Slot && slotOf(at).assigned.length > 0) {
        slotOf(at).assigned = [];
        signalSlot(at);
      }
    }
    assignSlots(root);
  }
}

// ───────────────────────────── mutation ─────────────────────────────

function childrenChanged(parent: N) {
  parent.doc.version++;
  if (parent.flags & F.ChildCache) {
    parent.flags &= ~F.ChildCache;
    parent.rare!.nodeCache = parent.rare!.elementCache = null;
  }
}

function link(node: N, parent: N, before: N | null) {
  const previous = before === null ? parent.last : before.prev;
  node.parent = parent;
  node.prev = previous;
  node.next = before;
  if (previous === null) parent.first = node;
  else previous.next = node;
  if (before === null) parent.last = node;
  else before.prev = node;
  childrenChanged(parent);
}

function unlink(node: N, parent: N) {
  const { prev, next } = node;
  if (prev === null) parent.first = next;
  else prev.next = next;
  if (next === null) parent.last = prev;
  else next.prev = prev;
  node.parent = node.prev = node.next = null;
  childrenChanged(parent);
}

let afterInsert: N[] = [];
let beingInserted = afterInsert;

/** From the selectors of style sheets that may have been injected. */
function hideNonce(node: N) {
  const { nonce } = node.rare!;
  if (!getAttr(node, "nonce") || !node.doc.page?.host.hasPolicyFromHeader?.()) return;
  setAttr(node, "nonce", "");
  node.rare!.nonce = nonce;
}

function connect(root: N, scope: N, isMove: boolean) {
  const inControl = scope.flags & F.UserAgent;
  for (let at: N | null = root; at !== null; at = following(at, root)) {
    const before = at.flags;
    at.flags = before | F.Connected | inControl;
    at.scope = scope;
    if (at.type !== ELEMENT) continue;
    if (before & (F.HasId | F.Named | F.Autofocus)) {
      if (before & F.Autofocus && !isMove) hooks.autofocusInserted(at);
      if (before & F.HasId) addId(scope, getAttr(at, "id")!, at);
      if (before & F.Named) noteNamed(at);
    }
    if (at.rare !== null && at.rare.nonce !== "" && !isMove) hideNonce(at);
    const kind = at.kind;
    if (kind.shadow !== null && !(before & F.Host) && at.doc.page !== null) kind.shadow(at);
    else if (before & F.Host) connect(at.rare!.shadow!, at.rare!.shadow!, isMove);
    if (kind.inserted !== null) afterInsert.push(at);
    if (before & F.Custom) {
      if (isMove && at.rare!.definition!.callbacks.connectedMoveCallback) enqueueReaction(at, "connectedMoveCallback");
      else enqueueReaction(at, "connectedCallback");
    } else if (before & F.Undefined) {
      if (hasScopedRegistries && at.rare !== null) hooks.scopedRegistryConnected(at);
      hooks.tryUpgrade(at);
    }
  }
}

function disconnect(root: N, removed: N[], isMove: boolean) {
  for (let at: N | null = root; at !== null; at = following(at, root)) {
    const before = at.flags;
    const scope = at.scope!;
    at.flags = before & ~F.Connected;
    at.scope = null;
    if (at.type !== ELEMENT) continue;
    if (before & (F.HasId | F.Named)) {
      if (before & F.HasId) removeId(scope, getAttr(at, "id")!, at);
      if (before & F.Named) noteNamed(at);
    }
    if (before & F.Host) disconnect(at.rare!.shadow!, removed, isMove);
    if (at.kind.removed !== null || (at.rare !== null && at.rare.popover !== null)) removed.push(at, scope);
    if (at.state & INTERACTION && !isMove) setState(at, INTERACTION, false);
    if (before & F.Custom && !(isMove && at.rare!.definition!.callbacks.connectedMoveCallback)) {
      enqueueReaction(at, "disconnectedCallback");
    }
  }
}

function markControl(root: N) {
  for (let at: N | null = root; at !== null; at = following(at, root)) at.flags |= F.UserAgent;
}

function insertOne(node: N, parent: N, before: N | null, isMove: boolean) {
  link(node, parent, before);
  const parentFlags = parent.flags;
  if (parentFlags & F.Connected) connect(node, parent.scope!, isMove);
  else if (parentFlags & F.UserAgent) markControl(node);
  if (parent.id !== 0) {
    if (isMove && node.id !== 0) parent.doc.engine.moveNode(parent.id, node.id, mirroredFrom(before));
    else if (node.id !== 0) parent.doc.engine.insert(parent.id, node.id, mirroredFrom(before));
    else mirror(node, parent.id);
    invalidate(parent.doc);
  }
  if (slotsExist) slotsAfterInsert(node, parent);
  if (node.kind.moved !== null) node.kind.moved(node, null);
}

/** For the shadow trees of controls, which nothing observes. */
function append(parent: N, node: N, before: N | null = null): N {
  insertOne(node, parent, before, false);
  return node;
}

function runAfterInsert(isMove: boolean) {
  const list = (beingInserted = afterInsert);
  afterInsert = [];
  for (let i = 0; i < list.length; i++) if (list[i].flags & F.Connected) list[i].kind.inserted!(list[i], isMove);
  beingInserted = afterInsert;
}

/** https://dom.spec.whatwg.org/#concept-node-insert, with the adoption that comes before it. */
function insert(node: N, parent: N, before: N | null, suppress = false, isMove = false) {
  const doc = parent.doc;
  let nodes: N[] | null = null;
  if (node.type === FRAGMENT) {
    if (node.first === null) return;
    nodes = [];
    for (let child; (child = node.first) !== null;) {
      nodes.push(child);
      remove(child, true);
    }
    if (node.doc.observed & 1) queueRecord(1, node, null, null, null, null, nodes, null, null);
    if (node.doc !== doc) for (const child of nodes) adopt(child, doc);
  } else {
    if (node.parent !== null) {
      remove(node, false, node.scope !== null && node.scope === parent.scope && node.id !== 0, isMove);
    } else if (node.flags & F.TemporaryRoot) dropTemporary(node);
    if (node.doc !== doc) adopt(node, doc);
  }
  if (before !== null && parent.flags & F.HasRanges) {
    hooks.rangesAfterInsert(parent, indexOf(before), nodes === null ? 1 : nodes.length);
  }
  const previous = before === null ? parent.last : before.prev;
  if (nodes === null) insertOne(node, parent, before, isMove);
  else for (let i = 0; i < nodes.length; i++) insertOne(nodes[i], parent, before, false);
  if (doc.observed & 1 && !suppress) queueRecord(1, parent, null, null, null, nodes ?? [node], null, previous, before);
  if (parent.kind.children !== null) parent.kind.children(parent, isMove);
  if (afterInsert.length !== 0) runAfterInsert(isMove);
}

/** `keepMirror`: it is about to be inserted in the same scope. `isMove`: by `moveBefore`, which keeps its state. */
function remove(node: N, suppress = false, keepMirror = false, isMove = false) {
  const parent = node.parent!;
  const doc = node.doc;
  if (doc.ranges > 0) hooks.rangesBeforeRemove(node, parent);
  if (doc.iterators.size > 0) hooks.iteratorsBeforeRemove(node);
  const { prev, next } = node;
  const wasConnected = node.flags & F.Connected;
  if (wasConnected && doc.page !== null) doc.page.beforeRemove(node, isMove);
  if (node.parent !== parent) return;
  unlink(node, parent);
  let removed: N[] | undefined;
  if (wasConnected) disconnect(node, (removed = []), isMove);
  if (node.id !== 0 && !keepMirror) {
    unmirror(node);
    invalidate(doc);
  }
  if (slotsExist) slotsAfterRemove(node, parent);
  if (node.kind.moved !== null) node.kind.moved(node, parent);
  if (removed !== undefined) {
    for (let i = 0; i < removed.length; i += 2) {
      const it = removed[i];
      if (it.kind.removed !== null) it.kind.removed(it, removed[i + 1], isMove);
      if (it.rare?.popover && !isMove) hooks.popoverRemoved(it);
    }
  }
  if (doc.observed !== 0) {
    observeTransiently(node, parent);
    if (doc.observed & 1 && !suppress) queueRecord(1, parent, null, null, null, null, [node], prev, next);
  }
  if (parent.kind.children !== null) parent.kind.children(parent);
}

function adoptRegistry(node: N, old: Doc) {
  const own = node.rare?.registry;
  if ((own === undefined ? old.registry : own) !== null || !(node.type === ELEMENT || node.flags & F.ShadowRoot))
    return;
  const staysNull = node.type === ELEMENT ? node.parent?.rare?.registry !== undefined : scopeOf(node).keepsRegistryNull;
  if (staysNull) rare(node).registry = null;
  else if (own === null) node.rare!.registry = undefined;
}

function adoptTree(root: N, doc: Doc, old: Doc) {
  for (let at: N | null = root; at !== null; at = following(at, root)) {
    at.doc = doc;
    at.rare?.attributeNodes?.$forEach(attr => (attr.doc = doc));
    if (hasScopedRegistries) adoptRegistry(at, old);
    if (at.flags & F.HasRanges) hooks.rangesAdopted(at, old);
    if (at.flags & F.Observed) {
      doc.observed |= old.observed;
      doc.observedOldValues |= old.observedOldValues;
    }
    if (at.flags & F.Host) adoptTree(at.rare!.shadow!, doc, old);
    if (at.flags & F.Custom) enqueueReaction(at, "adoptedCallback", wrap(old.node), wrap(doc.node));
    if (at.kind.adopted !== null) at.kind.adopted(at, old);
  }
}

function adopt(node: N, doc: Doc) {
  if (node.parent !== null) remove(node);
  else if (node.flags & F.TemporaryRoot) dropTemporary(node);
  if (node.doc !== doc) adoptTree(node, doc, node.doc);
}

function hierarchyError(message: string) {
  return domError("HierarchyRequestError", message);
}

function countChildren(parent: N, type: number, except: N | null): number {
  let count = 0;
  for (let child = parent.first; child !== null; child = child.next)
    if (child.type === type && child !== except) count++;
  return count;
}

function siblingOfType(node: N | null, type: number, forward: boolean): boolean {
  for (; node !== null; node = forward ? node.next : node.prev) if (node.type === type) return true;
  return false;
}

function validateInsert(node: N, parent: N, child: N | null, replacing: boolean) {
  const parentType = parent.type;
  const type = node.type;
  if (parentType !== ELEMENT && parentType !== FRAGMENT && parentType !== DOCUMENT) {
    throw hierarchyError("This node type does not support this method.");
  }
  if (node === parent || node.first !== null || node.flags & F.Host || node.name === "template") {
    for (
      let at: N | null = parent;
      at !== null;
      at = at.parent ?? (at.type === FRAGMENT ? (at.x?.host ?? null) : null)
    ) {
      if (at === node) throw hierarchyError("The new child element contains the parent.");
    }
  }
  if (child !== null && child.parent !== parent) {
    throw domError(
      "NotFoundError",
      replacing
        ? "The node to be replaced is not a child of this node."
        : "The node before which the new node is to be inserted is not a child of this node.",
    );
  }
  if (type === DOCUMENT || type === ATTRIBUTE || (type === DOCTYPE && parentType !== DOCUMENT)) {
    throw hierarchyError("Nodes of this type may not be inserted inside nodes of that type.");
  }
  if (parentType !== DOCUMENT) return;
  const except = replacing ? child : null;
  let elements = type === ELEMENT ? 1 : 0;
  if (type === FRAGMENT) elements = countChildren(node, TEXT, null) > 0 ? 2 : countChildren(node, ELEMENT, null);
  if (
    isText(node) ||
    elements > 1 ||
    (elements === 1 &&
      (countChildren(parent, ELEMENT, except) > 0 || siblingOfType(replacing ? child!.next : child, DOCTYPE, true))) ||
    (type === DOCTYPE &&
      (countChildren(parent, DOCTYPE, except) > 0 ||
        siblingOfType(child === null ? parent.last : child.prev, ELEMENT, false)))
  ) {
    throw hierarchyError("A document has one doctype, one element after it, and no text.");
  }
}

function preInsert(node: N, parent: N, child: N | null) {
  validateInsert(node, parent, child, false);
  insert(node, parent, child === node ? node.next : child);
}

function replaceChild(child: N, node: N, parent: N) {
  validateInsert(node, parent, child, true);
  let before = child.next;
  if (before === node) before = node.next;
  let previous = child.prev;
  if (previous === node) previous = node.prev;
  const added = node.type === FRAGMENT ? childArray(node) : [node];
  let removed: N[] | null = null;
  if (node.parent !== null) remove(node);
  if (child.parent !== null) {
    removed = [child];
    remove(child, true);
  }
  insert(node, parent, before, true);
  if (parent.doc.observed & 1) queueRecord(1, parent, null, null, null, added, removed, previous, before);
}

function replaceAll(node: N | null, parent: N) {
  const observed = parent.doc.observed & 1;
  const removed = observed ? childArray(parent) : null;
  const added = !observed || node === null ? null : node.type === FRAGMENT ? childArray(node) : [node];
  for (let child; (child = parent.first) !== null;) remove(child, true);
  if (node !== null) insert(node, parent, null, true);
  if (observed && (removed!.length > 0 || added?.length)) {
    queueRecord(1, parent, null, null, null, added, removed, null, null);
  }
}

function replaceAllWithText(text: string, parent: N) {
  replaceAll(text === "" ? null : createText(parent.doc, text), parent);
}

function replaceData(node: N, offset: number, count: number, data: string) {
  const old = node.data;
  if (offset > old.length) throw domError("IndexSizeError", "The offset is greater than the node's length.");
  if (offset + count > old.length) count = old.length - offset;
  const doc = node.doc;
  if (doc.observed & 4) queueRecord(4, node, null, null, old, null, null, null, null);
  node.data = count === old.length ? data : old.slice(0, offset) + data + old.slice(offset + count);
  if (node.flags & F.HasRanges) hooks.rangesAfterReplaceData(node, offset, count, data.length);
  if (node.id !== 0) {
    doc.engine.setText(node.id, node.data);
    invalidate(doc);
  }
  const parent = node.parent;
  if (parent !== null && parent.kind.children !== null) parent.kind.children(parent);
}

function splitText(node: N, offset: number): N {
  if (offset > node.data.length) throw domError("IndexSizeError", "The offset is larger than the Text node's length.");
  const rest = createData(node.doc, node.type, node.data.slice(offset));
  const parent = node.parent;
  if (parent !== null) {
    insert(rest, parent, node.next);
    if (node.doc.ranges > 0) hooks.rangesAfterSplit(node, rest, offset);
  }
  replaceData(node, offset, node.data.length - offset, "");
  return rest;
}

function clone(node: N, doc: Doc, deep: boolean, parent: N | null = null, fallbackRegistry: any = null): N {
  let copy: N;
  switch (node.type) {
    case ELEMENT: {
      if (node.flags & F.StyleDirty) hooks.flushStyle(node);
      const byRegistry = hasScopedRegistries || node.doc.registry === null;
      const before = byRegistry ? setRegistry(registryOf(node) ?? fallbackRegistry, doc) : undefined;
      copy = createElement(doc, node.name, node.ns, node.rare?.is ?? null, false, prefixOf(node));
      creatingIn = before;
      if (node.ns === OTHER) rare(copy).namespace = namespaceOf(node);
      const attrs = node.attrs;
      if (attrs !== null) {
        copy.flags |= node.flags & F.HasNamespacedAttr;
        for (let i = 0; i < attrs.length; i += 2) setAttr(copy, attrs[i], attrs[i + 1]);
      }
      if (node.rare?.nonce) rare(copy).nonce = node.rare.nonce;
      break;
    }
    case DOCUMENT: {
      doc = createDoc();
      const from = node.doc;
      doc.url = from.url;
      doc.baseUrl = doc.fallbackBaseUrl = from.baseUrl;
      doc.contentType = from.contentType;
      doc.isHtml = from.isHtml;
      doc.quirks = from.quirks;
      copy = doc.node;
      copy.kind = node.kind;
      if (node.rare?.registry) rare(copy).registry = node.rare.registry;
      break;
    }
    case DOCTYPE:
      copy = createDoctype(doc, node.name, node.x.publicId, node.x.systemId);
      break;
    case FRAGMENT:
      copy = createFragment(doc);
      break;
    case ATTRIBUTE:
      return hooks.createAttr(doc, node.name, prefixOf(node), node.x.namespace, hooks.attrValue(node));
    default:
      copy = createData(doc, node.type, node.data, node.name);
  }
  if (node.kind.cloned !== null) node.kind.cloned(node, copy, deep);
  if (parent !== null) insert(copy, parent, null, true);
  if (deep)
    for (let child = node.first; child !== null; child = child.next) clone(child, doc, true, copy, fallbackRegistry);
  const shadow = node.rare?.shadow;
  if (shadow && scopeOf(shadow).clonable) {
    const root = attachShadow(copy, false);
    const [from, to] = [scopeOf(shadow), scopeOf(root)];
    to.mode = from.mode;
    to.delegatesFocus = from.delegatesFocus;
    to.manualSlots = from.manualSlots;
    to.clonable = true;
    to.serializable = from.serializable;
    to.declarative = from.declarative;
    to.referenceTarget = from.referenceTarget;
    to.keepsRegistryNull = from.keepsRegistryNull;
    if (shadow.rare?.registry !== undefined) rare(root).registry = shadow.rare.registry;
    for (let child = shadow.first; child !== null; child = child.next) clone(child, doc, true, root);
  }
  return copy;
}

// ───────────────────────────── attributes ─────────────────────────────

function attrIndex(node: N, name: string): number {
  const attrs = node.attrs;
  if (attrs !== null) for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === name) return i;
  return -1;
}

function getAttr(node: N, name: string): string | null {
  const attrs = node.attrs;
  if (attrs === null) return null;
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === name) {
      if (node.flags & F.StyleDirty && name === "style") hooks.flushStyle(node);
      return attrs[i + 1];
    }
  }
  return null;
}

function hasAttr(node: N, name: string): boolean {
  return attrIndex(node, name) >= 0;
}

/** The key of an attribute in `attrs` is its qualified name, and then a space and its namespace if it has one. */
function attrKey(name: string, namespace: string | null): string {
  return namespace === null ? name : name + " " + namespace;
}

function attrNamespace(key: string): string | null {
  const space = key.indexOf(" ");
  return space < 0 ? null : key.slice(space + 1);
}

function attrName(key: string): string {
  const space = key.indexOf(" ");
  return space < 0 ? key : key.slice(0, space);
}

function attrLocalName(key: string): string {
  const name = attrName(key);
  return name === key ? key : name.slice(name.indexOf(":") + 1);
}

function engineKey(key: string): string {
  return attrKey(attrLocalName(key), attrNamespace(key));
}

function findAttrNS(node: N, namespace: string | null, localName: string): string | null {
  const attrs = node.attrs;
  if (attrs === null) return null;
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrNamespace(attrs[i]) === namespace && attrLocalName(attrs[i]) === localName) return attrs[i];
  }
  return null;
}

function getAttrNS(node: N, namespace: string | null, localName: string): string | null {
  const key = findAttrNS(node, namespace, localName);
  return key === null ? null : getAttr(node, key);
}

/** The key of the first attribute with that qualified name, or of the one to add. */
function keyByName(node: N, name: string): string {
  if (!(node.flags & F.HasNamespacedAttr) && !name.includes(" ")) return name;
  const attrs = node.attrs ?? [];
  for (let i = 0; i < attrs.length; i += 2) if (attrName(attrs[i]) === name) return attrs[i];
  return name.includes(" ") ? "" : name;
}

function svgHref(node: N): string | null {
  return getAttr(node, "href") ?? getAttrNS(node, XLINK_NS, "href");
}

function namespacedAttributeChanged(node: N, key: string, old: string | null, value: string | null) {
  const { doc } = node;
  const [name, namespace] = [attrLocalName(key), attrNamespace(key)];
  doc.attributeVersion++;
  node.flags |= F.HasNamespacedAttr;
  if (doc.observed & 2) queueRecord(2, node, name, namespace, old, null, null, null, null);
  if (node.id !== 0 && old !== value) {
    if (value === null) doc.engine.removeAttribute(node.id, engineKey(key));
    else doc.engine.setAttribute(node.id, engineKey(key), value);
    invalidateIfDirty(doc);
  }
  if (node.flags & F.Custom && node.rare!.definition!.observed.$has(name)) {
    enqueueReaction(node, "attributeChangedCallback", name, old, value, namespace);
  }
  if (node.ns === SVG && namespace === XLINK_NS) node.kind.attribute?.(node, name, old, value);
}

function attributeChanged(node: N, name: string, old: string | null, value: string | null) {
  const doc = node.doc;
  doc.attributeVersion++;
  if (doc.observed & 2) queueRecord(2, node, name, null, old, null, null, null, null);
  if (node.id !== 0 && old !== value) {
    if (value === null) doc.engine.removeAttribute(node.id, name);
    else doc.engine.setAttribute(node.id, name, value);
    invalidateIfDirty(doc);
  }
  if (node.flags & F.Custom && node.rare!.definition!.observed.$has(name)) {
    enqueueReaction(node, "attributeChangedCallback", name, old, value, null);
  }
  switch (name) {
    case "class":
      return;
    case "id":
      if (node.scope !== null) {
        if (old) removeId(node.scope, old, node);
        if (value) addId(node.scope, value, node);
      }
      node.flags = value ? node.flags | F.HasId : node.flags & ~F.HasId;
      if (node.flags & F.Named || node.name === "object") nameChanged(node);
      break;
    case "name":
      nameChanged(node);
      break;
    case "style":
      if (node.style !== null) node.style.list = null;
      if (old !== value) node.flags &= ~F.StyleUnsent;
      if (doc.checksStyleAttributes) hooks.checkStyleAttribute(node, value);
      return;
    case "slot":
      if (node.parent !== null && node.parent.flags & F.Host) assignSlots(node.parent.rare!.shadow!);
      break;
    case "blocking":
      invalidate(doc);
      break;
    case "popover":
    case "nonce":
    case "autofocus":
    case "elementtiming":
      hooks.globalAttribute(node, name, old, value);
      break;
    default:
      if (name.charCodeAt(0) === 111 && name.charCodeAt(1) === 110) hooks.handlerAttribute(node, name, value);
      else if (node.rare !== null && node.rare.references !== null) node.rare.references.$delete(name);
  }
  if (node.kind.attribute !== null) node.kind.attribute(node, name, old, value);
}

function setAttrNS(node: N, name: string, value: string, namespace: string | null) {
  if (namespace !== null) node.flags |= F.HasNamespacedAttr;
  setAttr(node, attrKey(name, namespace), value);
}

function setAttr(node: N, name: string, value: string) {
  let old: string | null = null;
  const attrs = node.attrs;
  if (attrs === null) node.attrs = [name, value];
  else {
    const index = attrIndex(node, name);
    if (index < 0) attrs.push(name, value);
    else {
      if (node.flags & F.StyleDirty && name === "style") hooks.flushStyle(node);
      old = attrs[index + 1];
      attrs[index + 1] = value;
    }
  }
  if (node.flags & F.HasNamespacedAttr && name.includes(" ")) namespacedAttributeChanged(node, name, old, value);
  else attributeChanged(node, name, old, value);
}

function removeAttr(node: N, name: string): boolean {
  const index = attrIndex(node, name);
  if (index < 0) return false;
  if (node.flags & F.StyleDirty && name === "style") hooks.flushStyle(node);
  const old = node.attrs![index + 1];
  node.attrs!.splice(index, 2);
  const extra = node.rare;
  if (extra !== null) {
    const attr = extra.attributeNodes?.$get(name);
    if (attr !== undefined) {
      extra.attributeNodes!.$delete(name);
      attr.data = old;
      attr.x.element = null;
    }
  }
  if (node.flags & F.HasNamespacedAttr && name.includes(" ")) namespacedAttributeChanged(node, name, old, null);
  else attributeChanged(node, name, old, null);
  return true;
}

function toggleAttr(node: N, name: string, on: boolean) {
  if (!on) removeAttr(node, name);
  else if (!hasAttr(node, name)) setAttr(node, name, "");
}

function resolveUrl(doc: Doc, url: string): string | null {
  if (doc.encoding === "utf-8" || !/[^\0-\x7f]/.test(url)) return URL.parse(url, doc.baseUrl)?.href ?? null;
  return require("internal/desktop/web/encoding").parseUrl(url, doc.baseUrl, doc.encoding)?.href ?? null;
}

/** What scripts are told of a time in milliseconds. */
function coarse(time: number): number {
  return Math.floor(time * 10) / 10;
}

function asciiLower(text: string): string {
  return /[A-Z]/.test(text) ? text.replace(/[A-Z]+/g, it => it.toLowerCase()) : text;
}

function splitTokens(text: string | null): string[] {
  return text?.match(/[^\t\n\f\r ]+/g) ?? [];
}

const { makeEnumerable, windowOf } = require("internal/desktop/dom/exotic");

function expose<T extends { prototype: object; name: string }>(ctor: T, constants?: Record<string, number>): T {
  Object.defineProperty(ctor.prototype, Symbol.toStringTag, { value: ctor.name, configurable: true });
  for (const key in constants) {
    const descriptor = { value: constants[key], enumerable: true };
    Object.defineProperty(ctor, key, descriptor);
    Object.defineProperty(ctor.prototype, key, descriptor);
  }
  if (
    Object.getPrototypeOf(ctor.prototype) === Object.prototype &&
    $getByIdDirectPrivate(ctor.prototype, "cloner") === undefined
  ) {
    $putByIdDirectPrivate(ctor.prototype, "cloner", false);
  }
  makeEnumerable(ctor.prototype);
  makeEnumerable(ctor);
  interfaces[ctor.name] = ctor;
  return ctor;
}

function mixin(from: object, ...targets: any[]) {
  let descriptors: PropertyDescriptorMap | undefined;
  const step = (ctor: any) =>
    Object.defineProperties(ctor.prototype, (descriptors ??= Object.getOwnPropertyDescriptors(from)));
  for (const target of targets) extend(target, step);
}

function defineGetters(ctor: { prototype: object }, names: string[], read: (self: any, name: string) => unknown) {
  for (const name of names) {
    const member = {
      get [name]() {
        return read(this, name);
      },
    };
    Object.defineProperties(ctor.prototype, Object.getOwnPropertyDescriptors(member));
  }
}

function brand(self: any) {
  if (self?.$impl === undefined) throw new TypeError("Illegal invocation");
}

function accessor(target: object, name: string, get: () => any, set?: (value: any) => void) {
  Object.defineProperty(get, "name", { value: "get " + name });
  if (set !== undefined) Object.defineProperty(set, "name", { value: "set " + name });
  Object.defineProperty(get, "name", { value: "get " + name });
  if (set) Object.defineProperty(set, "name", { value: "set " + name });
  Object.defineProperty(target, name, { get, set, enumerable: true, configurable: true });
}

/** Accessors without functions of their own. See DesktopLazy.h. */
const setAccessorFamily = $newCppFunction("DesktopLazy.cpp", "jsFunctionDesktopSetAccessorFamily", 3);
const defineAccessors = $newCppFunction("DesktopLazy.cpp", "jsFunctionDesktopDefineAccessors", 4);
const families = { HANDLERS: 0, WINDOW_HANDLERS: 1, STYLE: 2, ARIA: 3 };

/** The constructors that a window has. */
const interfaces: Record<string, any> = {};

/** `root` is the page whose global object this realm has, or else the first one. `page` is the one that is calling. */
const realm = { page: null! as Page, root: null! as Page, pages: new Set<Page>(), hasFrames: false };

function pageOfCallback(callback: unknown): Page | null {
  return ($isObject(callback) && windowOf(callback)?.x) || null;
}

export default {
  NativeEvent: Event,
  NativeFormData: FormData,
  NativeEventTarget: EventTarget,
  ELEMENT,
  ATTRIBUTE,
  TEXT,
  CDATA,
  INSTRUCTION,
  COMMENT,
  DOCUMENT,
  DOCTYPE,
  FRAGMENT,
  HTML,
  SVG,
  MATHML,
  OTHER,
  XML_NS,
  XMLNS_NS,
  XLINK_NS,
  coarse,
  namespaces,
  flags,
  states,
  Kind,
  Listener,
  N,
  Observation,
  noKind,
  kinds,
  hooks,
  Interface,
  defineAccessors,
  defineGetters,
  families,
  setAccessorFamily,
  extend,
  interfaces,
  lazyInterfaces,
  loaded,
  realm,
  activeObservers,
  accessor,
  adopt,
  append,
  asciiLower,
  assignSlots,
  attachShadow,
  attrIndex,
  attrKey,
  attrLocalName,
  attrName,
  attrNamespace,
  bodyOf,
  childArray,
  childAt,
  childText,
  clone,
  closestHtml,
  compareOrder,
  composedRoot,
  contains,
  containsComposed,
  containsFlat,
  createData,
  createDoc,
  createDoctype,
  createElement,
  createElementNS,
  createFragment,
  createPlainElement,
  createText,
  dirtyScope,
  documentElement,
  domError,
  elementById,
  elementChildren,
  engineFor,
  enqueueReaction,
  enqueueUpgrade,
  ensureShadow,
  expose,
  filterDescendants,
  brand,
  filterReferrers,
  referenceTarget,
  findAttrNS,
  findDescendant,
  flatChildren,
  flatParent,
  following,
  followingSkip,
  getAttr,
  getAttrNS,
  hasAttr,
  hasScopedRegistries: () => hasScopedRegistries,
  hasSlots: () => slotsExist,
  hasPending,
  watchedVersion: () => watchedVersion,
  hostOf,
  illegalConstructor,
  indexOf,
  insert,
  invalidate,
  isBeingInserted: (node: N) => beingInserted.includes(node),
  isData,
  isHtml,
  isInterface,
  isText,
  isValidCustomName,
  keyByName,
  lengthOf,
  mirroredFrom,
  mixin,
  namespaceOf,
  nodeOf,
  noteScopedRegistry,
  noteSlot,
  outOfControl,
  pageOfCallback,
  parentElement,
  parentOrHost,
  preInsert,
  preceding,
  prefixOf,
  qualifiedName,
  queueReaction,
  queueRecord,
  rare,
  react,
  registryOf,
  remove,
  removeAttr,
  replaceAll,
  replaceAllWithText,
  replaceChild,
  replaceData,
  reportError,
  resolveUrl,
  retarget,
  rootChild,
  rootOf,
  runReactionsOf,
  same,
  scopeOf,
  setAttr,
  setAttrNS,
  setPending,
  setPseudo,
  setRegistry,
  setQuirks,
  setState,
  slotOf,
  splitText,
  splitTokens,
  svgHref,
  sync,
  takePending,
  templateDoc,
  textContent,
  toggleAttr,
  tooFew,
  unwrap,
  validateInsert,
  wrap,
  wrapOrNull,
};
