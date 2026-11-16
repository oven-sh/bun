// `history`, `location` and `navigation`.
const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const focusing = require("internal/desktop/dom/focus");
const html = require("internal/desktop/dom/html");

const { domError, expose } = core;

type N = $Dom.N;
type Page = $Dom.Page;
type Entry = $Dom.Entry;
type Options = {
  replace?: boolean;
  /** If this is the target. */
  replaceIn?: Page | null;
  /** Even if the URL is the same. */
  push?: boolean;
  source?: string;
  element?: N;
  isByUser?: boolean;
  hasTextActivation?: boolean;
  method?: string;
  body?: any;
  contentType?: string;
  formData?: object;
  download?: string;
  /** Serialized. */
  navigationState?: unknown;
  initiator?: any;
  srcdoc?: string;
  /** For a `javascript:` URL. */
  noDocument?: () => void;
  noopener?: boolean;
};

const withoutFragment = (url: string) => url.split("#")[0];
const fragmentOf = (url: string) => (url.includes("#") ? url.slice(url.indexOf("#") + 1) : null);
const serialize = (page: Page, value: unknown) => (page.host.serialize ?? structuredClone)(value);
const deserialize = (page: Page, stored: unknown) => (page.host.deserialize ?? structuredClone)(stored);
const isActive = (page: Page) => !page.isDisposed && (page.host.isActive?.() ?? true);
const invalidState = (message: string) => domError("InvalidStateError", message);

function need(given: number, wanted: number) {
  if (given < wanted) throw new TypeError(`${wanted} argument required, but only ${given} present.`);
}

function dictionary(value: any): any {
  if (value != null && !$isObject(value)) throw new TypeError("The provided value is not a dictionary.");
  return value ?? {};
}

function oneOf(value: unknown, ...allowed: string[]) {
  if (value === undefined || allowed.includes(`${value}`)) return value === undefined ? value : `${value}`;
  throw new TypeError(`The provided value '${value}' is not a valid enum value.`);
}

function callback(value: unknown): Function | undefined {
  if (value !== undefined && !$isCallable(value)) throw new TypeError("The provided callback is not a function.");
  return value as Function;
}

function createEntry(url: string, from: Partial<Entry> = {}): Entry {
  const { key = crypto.randomUUID(), id = crypto.randomUUID(), state, navigationState, scroll } = from;
  const { scrollRestoration = "auto", isOfDocument = true } = from;
  return { key, id, url, state, navigationState, scroll, scrollRestoration, isOfDocument, js: null };
}

/** The host keeps it in its own list, which outlives the page. */
function save(page: Page, { js, isOfDocument, url, ...kept }: Entry, how: string) {
  page.host.historyChanged?.(url, { replace: how !== "push", isQuiet: how === "update", state: kept });
}

function initialize(page: Page) {
  const { entries = [], index = 0 } = page.host.historyEntries?.() ?? {};
  page.entries = Array.from(entries, (entry: Entry) => createEntry(entry.url, entry));
  page.entryIndex = index;
  page.entries[index] ??= createEntry(page.doc.url);
}

const currentOf = (page: Page): Entry => page.entries[page.entryIndex];

function setUrl(page: Page, url: string) {
  const { doc } = page;
  const hasBase = doc.baseUrl !== doc.url;
  doc.url = url;
  if (!hasBase) doc.engine.setBaseUrl((doc.baseUrl = url));
}

function rememberScroll(page: Page) {
  const entry = currentOf(page);
  entry.scroll = [page.scroll(0), page.scroll(1)];
  save(page, entry, "update");
}

function restoreScroll(page: Page) {
  const { scroll, scrollRestoration } = currentOf(page);
  if (scrollRestoration !== "auto" || (page.host.loadsAtTop && page.doc.readyState !== "complete")) return;
  if (scroll) html.scroll(page.doc, 1, scroll[0], scroll[1], false, 1);
  else page.scrollToFragment();
}

/** https://html.spec.whatwg.org/#url-and-history-update-steps */
function commit(page: Page, url: string, replace: boolean, state?: unknown, navigationState?: unknown) {
  const from = currentOf(page);
  if (!replace) rememberScroll(page);
  const key = replace ? from.key : undefined;
  const entry = createEntry(url, { key, state, navigationState, scrollRestoration: from.scrollRestoration });
  const dropped = replace ? [from] : page.entries.splice(++page.entryIndex);
  page.entries[page.entryIndex] = entry;
  page.same.$delete("state");
  setUrl(page, url);
  save(page, entry, replace ? "replace" : "push");
  navigationOf(page)?.committed(from, replace ? "replace" : "push", dropped);
}

function replaceUrl(page: Page, url: string) {
  commit(page, url, true, currentOf(page).state, currentOf(page).navigationState);
}

function fireHashChange(page: Page, oldURL: string, newURL: string) {
  if (fragmentOf(oldURL) === fragmentOf(newURL) || withoutFragment(oldURL) !== withoutFragment(newURL)) return;
  page.queueTask(() => events.dispatch(page.target, new events.HashChangeEvent("hashchange", { oldURL, newURL })));
}

function canRewriteUrl(page: Page, href: string) {
  const [url, current] = [new URL(href), new URL(page.doc.url)];
  if (["protocol", "username", "password", "host"].some(part => url[part] !== current[part])) return false;
  if (url.protocol !== "file:" && url.host !== "" && page.host.origin !== "null") return true;
  return url.pathname === current.pathname && (url.protocol === "file:" || url.search === current.search);
}

async function leave(page: Page, url: string, { element, formData, replaceIn, ...options }: Options) {
  if (options.download === undefined && page.host.mayUnload?.() === false) return abortNavigation(page);
  if (!isActive(page)) return;
  Object.assign(options, { mayUnload: true });
  if (options.body === undefined || options.contentType !== undefined) return page.host.navigate?.(url, options);
  const encoded = new Response(options.body);
  const contentType = encoded.headers.get("content-type");
  page.host.navigate?.(url, { ...options, contentType, body: await encoded.bytes() });
}

function runJavaScriptUrl(page: Page, url: string, { initiator, noDocument }: Options) {
  const { host } = page;
  const escaped = url
    .slice("javascript:".length)
    .replace(/%([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  let source = Buffer.from(escaped, "latin1").toString();
  page.delayLoad();
  const evaluate = () => {
    if (host.runsScripts === false) return;
    try {
      if (page.trusted !== null) source = page.trusted("script", source, "Location href");
    } catch {
      return;
    }
    if (host.allowsInlineScript?.(source, "navigation", undefined, initiator) === false) return;
    return host.runClassicScript?.(source, page.doc.url, { inline: true, base: page.doc.baseUrl });
  };
  const serial = page.navigationSerial;
  page.queueTask(() => {
    page.allowLoad();
    if (serial !== page.navigationSerial) return;
    let result: unknown;
    events.callBack(page, () => (result = evaluate()), undefined);
    if (typeof result === "string") host.navigate?.(page.doc.url, { replace: true, markup: result, initiator });
    else noDocument?.();
  });
}

const refreshing = /^[\t\n\f\r ]*(?:(\d+)|(?=[.]))[\d.]*(?:$|(?=[;,\t\n\f\r ])[\t\n\f\r ]*[;,]?[\t\n\f\r ]*([^]*)$)/;
const urlEquals = /^url[\t\n\f\r ]*=[\t\n\f\r ]*/i;

/** https://html.spec.whatwg.org/#shared-declarative-refresh-steps */
function refresh(page: Page, input: string, isFromMeta: boolean) {
  const match = refreshing.exec(input);
  if (match === null || page.same.$has("refresh") || (isFromMeta && page.host.isSandboxed?.("allow-scripts"))) return;
  let given = (match[2] ?? "").replace(urlEquals, "");
  const quote = given[0];
  if (quote === "'" || quote === '"') given = given.slice(1).split(quote)[0];
  const url = match[2] ? core.resolveUrl(page.doc, given) : page.doc.url;
  if (url === null || url.startsWith("javascript:")) return;
  const { doc } = page;
  const seconds = +(match[1] ?? 0);
  const go = () => {
    if (page.doc !== doc) return;
    if (url === doc.url && !url.includes("#")) reload(page);
    else navigate(page, url, { replace: seconds <= 1, source: "refresh" });
  };
  const start = () => void setTimeout(() => page.queueTask(go), seconds * 1000).unref();
  page.same.$set("refresh", start);
  if (doc.readyState === "complete") start();
}

function navigate(page: Page, url: string, options: Options, target = "") {
  if (!options.initiator) options = { ...options, hasTextActivation: page.isActive() || page.host.hasTextActivation };
  if (!/^(?:_self)?$/i.test(target) && options.download === undefined) {
    if (page.host.navigateOther?.(target, url, options)) return;
    const isDetached = options.noopener ?? (!page.host.navigateOther || target.toLowerCase() === "_blank");
    if (!/^_(?:parent|top)$/i.test(target)) {
      return void page.host.open?.(url, target, isDetached ? "noopener" : "", page.createPage, options);
    }
  }
  if (page.isUnloading || !isActive(page)) return;
  page.navigationSerial++;
  const old = page.doc.url;
  const isBySameOrigin = !options.initiator || options.initiator.origin === page.host.origin;
  const replace =
    !!options.replace ||
    options.replaceIn === page ||
    (url === old && isBySameOrigin && !options.push) ||
    !!page.host.isInitial?.();
  const type = replace ? "replace" : "push";
  if (url.startsWith("javascript:")) return runJavaScriptUrl(page, url, options);
  const isPlain = options.body === undefined && options.download === undefined && options.srcdoc === undefined;
  const isFragment = isPlain && url.includes("#") && withoutFragment(url) === withoutFragment(old);
  if (!isFragment) page.host.cancelNavigation?.();
  const directive = isFragment ? url.indexOf(":~:", url.indexOf("#")) : -1;
  const textDirectives = directive >= 0 && isBySameOrigin ? url.slice(directive + 3) : undefined;
  if (directive >= 0) url = url.slice(0, directive);
  const navigationState = options.navigationState ?? (isFragment ? currentOf(page).navigationState : undefined);
  const navigation = isBySameOrigin || isFragment ? navigationOf(page) : undefined;
  if (navigation?.fire(type, url, isFragment, { ...options, navigationState }) === false) return;
  if (!isFragment) return void leave(page, url, { ...options, replace });
  commit(page, url, replace, undefined, navigationState);
  events.dispatchFromScript(page.target, new events.PopStateEvent("popstate"), true);
  fireHashChange(page, old, url);
  page.host.textDirectives = textDirectives;
  page.scrollToFragment();
}

function reload(page: Page, navigationState?: unknown) {
  if (page.isUnloading || !isActive(page)) return;
  const entry = currentOf(page);
  const options = { navigationState: navigationState ?? entry.navigationState };
  if (navigationOf(page)?.fire("reload", page.doc.url, false, options) === false) return;
  if (navigationState !== undefined) save(page, { ...entry, navigationState }, "update");
  if (page.host.mayUnload?.() === false) return abortNavigation(page);
  page.host.reload?.();
}

function pushState(page: Page, state: unknown, given: unknown, replace: boolean) {
  const stored = serialize(page, state);
  const url = given == null || given === "" ? page.doc.url : core.resolveUrl(page.doc, `${given}`);
  if (url === null || !canRewriteUrl(page, url)) {
    throw domError("SecurityError", `A history state object with URL '${given}' cannot be created in this document.`);
  }
  replace ||= !!page.host.isInitial?.();
  if (navigationOf(page)?.fire(replace ? "replace" : "push", url, true, {}, stored) === false) return;
  commit(page, url, replace, stored);
}

function stateOf(page: Page) {
  if (!page.same.$has("state")) {
    const { state } = currentOf(page);
    page.same.$set("state", state === undefined ? null : deserialize(page, state));
  }
  return page.same.$get("state");
}

/** The host wants to go to the entry, and does in `proceed`. */
function willTraverse(page: Page, key: string, isByUser: boolean, proceed: () => void) {
  const entry = page.entries.find(entry => entry.key === key);
  rememberScroll(page);
  const navigation = entry && navigationOf(page);
  if (!navigation) return proceed();
  navigation.resumeTraversal = proceed;
  if (navigation.fire("traverse", entry.url, entry.isOfDocument, { isByUser }, undefined, entry)) proceed();
}

/** The host went to another entry of the same document, or to a fragment. */
function popState(page: Page, url: string, key?: string) {
  const old = page.doc.url;
  const from = currentOf(page);
  const index = page.entries.findIndex(entry => entry.key === key);
  if (index >= 0) page.entryIndex = index;
  else {
    page.entries.splice(++page.entryIndex, Infinity, createEntry(url, { key }));
    save(page, currentOf(page), "update");
  }
  page.same.$delete("state");
  setUrl(page, url);
  const navigation = navigationOf(page);
  navigation?.committed(from, index >= 0 ? "traverse" : "push", []);
  events.dispatch(page.target, new events.PopStateEvent("popstate", { state: stateOf(page) }));
  if (!navigation?.suppressesScroll) restoreScroll(page);
  fireHashChange(page, old, url);
}

function traverse(page: Page, delta: number) {
  if (delta === 0) return reload(page);
  if (page.host.traverse) return page.host.traverse(delta);
  page.queueTask(() => {
    const entry = page.entries[page.entryIndex + delta];
    if (entry !== undefined) willTraverse(page, entry.key, false, () => popState(page, entry.url, entry.key));
  });
}

class History {
  #page: Page;

  constructor(page: any = undefined) {
    if (page?.entries === undefined) core.illegalConstructor();
    this.#page = page;
  }
  #active() {
    if (isActive(this.#page)) return this.#page;
    throw domError("SecurityError", "May not use a History object associated with a Document that is not fully active");
  }
  get length() {
    return this.#active().host.historyLength?.() ?? this.#page.entries.length;
  }
  get scrollRestoration() {
    return currentOf(this.#active()).scrollRestoration;
  }
  set scrollRestoration(value) {
    value = `${value}`;
    if (value !== "auto" && value !== "manual") return;
    const entry = currentOf(this.#active());
    entry.scrollRestoration = value;
    save(this.#page, entry, "update");
  }
  get state() {
    return stateOf(this.#active());
  }
  go(delta = 0) {
    traverse(this.#active(), delta | 0);
  }
  back() {
    traverse(this.#active(), -1);
  }
  forward() {
    traverse(this.#active(), 1);
  }
  pushState(state: unknown, _title: string, url: unknown = null) {
    need(arguments.length, 2);
    pushState(this.#active(), state, url, false);
  }
  replaceState(state: unknown, _title: string, url: unknown = null) {
    need(arguments.length, 2);
    pushState(this.#active(), state, url, true);
  }
}
expose(History);

class Location {
  constructor() {
    core.illegalConstructor();
  }
}
expose(Location);

/** Its members are its own properties. */
function createLocation(page: Page) {
  let parsed = new URL(page.doc.url);
  let parsedFrom = page.doc.url;
  function current() {
    const url = page.isDisposed ? "about:blank" : page.doc.url;
    if (url !== parsedFrom) parsed = new URL((parsedFrom = url));
    return parsed;
  }
  const caller = (): Page => (page.host.owner ? require("internal/desktop/dom/local_frame").caller() : page);
  function go(url: string, replace: boolean) {
    const source = caller();
    replace ||= !page.isCompletelyLoaded && !source.hasActivation();
    const options = { replace, source: "script" };
    if (source === page) return page.navigate(url, options);
    if (page.host.navigateFrom(source.host.owner, url, options)) return;
    throw domError("SecurityError", "The current window does not have permission to navigate the target frame.");
  }
  function goTo(url: unknown, replace: boolean) {
    const text = `${url}`.toWellFormed();
    if (page.isDisposed) return;
    const resolved = core.resolveUrl(caller().doc, text);
    if (resolved === null) throw domError("SyntaxError", `'${text}' is not a valid URL.`);
    go(resolved, replace);
  }
  function change(part: string, value: unknown) {
    const text = `${value}`.toWellFormed();
    if (page.isDisposed) return;
    const url = new URL(page.doc.url);
    if (part === "protocol" && !/^[a-z][a-z\d+.-]*(?::|$)/i.test(text.replace(/[\t\n\r]/g, ""))) {
      throw domError("SyntaxError", `'${text}' is an invalid protocol.`);
    }
    const isOpaque = url.pathname[0] !== "/" && url.host === "";
    if (isOpaque && part !== "hash" && part !== "search" && part !== "protocol") return;
    if (part === "port" && (url.host === "" || url.protocol === "file:")) return;
    url[part] = part === "hash" ? text || "#" : text;
    if (part === "protocol" && url.protocol !== "http:" && url.protocol !== "https:") return;
    if (part !== "hash" || url.hash !== current().hash) go(url.href, false);
  }
  let ancestorOrigins: object | undefined;
  let noOrigins: object | undefined;
  const members = {
    get ancestorOrigins() {
      if (!isActive(page)) return (noOrigins ??= events.stringList([]));
      return (ancestorOrigins ??= events.stringList(page.host.ancestorOrigins?.() ?? []));
    },
    get href() {
      return current().href;
    },
    set href(url) {
      goTo(url, false);
    },
    get origin() {
      const { origin, protocol } = current();
      return origin !== "null" || protocol === "about:" ? origin : (page.host.originOf?.(parsedFrom) ?? origin);
    },
    assign(url: string) {
      need(arguments.length, 1);
      goTo(url, false);
    },
    replace(url: string) {
      need(arguments.length, 1);
      goTo(url, true);
    },
    reload() {
      reload(page);
    },
    toString() {
      if (this !== location) throw new TypeError("Illegal invocation");
      return current().href;
    },
  };
  for (const part of ["protocol", "host", "hostname", "port", "pathname", "search", "hash"]) {
    const accessor = {
      get [part]() {
        return current()[part];
      },
      set [part](value) {
        change(part, value);
      },
    };
    Object.defineProperties(members, Object.getOwnPropertyDescriptors(accessor));
  }
  const location = Object.create(Location.prototype);
  for (const [name, member] of Object.entries(Object.getOwnPropertyDescriptors(members))) {
    Object.defineProperty(location, name, {
      ...member,
      configurable: false,
      ...("value" in member && { writable: false }),
    });
  }
  return Object.defineProperties(location, {
    valueOf: { value: Object.prototype.valueOf },
    [Symbol.toPrimitive]: { value: undefined },
  });
}

// ───────────────────────────── the Navigation API ─────────────────────────────

/** An interface that only has read-only attributes, which are in `$impl`. */
function record(name: string, attributes: string, methods: object = {}): any {
  const ctor = {
    [name]: class {
      constructor() {
        core.illegalConstructor();
      }
    },
  }[name];
  defineAttributes(ctor, attributes, self => self.$impl);
  Object.assign(ctor.prototype, methods);
  expose(ctor);
  return (values: object) => {
    const made = Object.create(ctor.prototype);
    $putByIdDirectPrivate(made, "impl", values);
    return made;
  };
}

function defineAttributes(ctor: any, names: string, valuesOf: (self: any) => any) {
  for (const name of core.splitTokens(names)) {
    const holder = {
      get [name]() {
        const values = valuesOf(this);
        if (values === undefined) throw new TypeError("Illegal invocation");
        return values[name];
      },
    };
    Object.defineProperties(ctor.prototype, Object.getOwnPropertyDescriptors(holder));
  }
}

const createDestination = record("NavigationDestination", "url key id index sameDocument", {
  getState(this: any) {
    return this.$impl.getState();
  },
});
const createTransition = record("NavigationTransition", "navigationType from to committed finished");
const createActivation = record("NavigationActivation", "from entry navigationType");
const createPrecommitController = record("NavigationPrecommitController", "", {
  redirect(this: any, url: string, options: unknown = undefined) {
    need(arguments.length, 1);
    this.$impl.redirect(`${url}`.toWellFormed(), dictionary(options));
  },
  addHandler(this: any, handler: Function) {
    need(arguments.length, 1);
    this.$impl.addHandler(callback(handler));
  },
});

const isA = (value: unknown, name: string) => Object.prototype.toString.$call(value) === `[object ${name}]`;

function required(init: any, member: string, name: string, isNullable = false) {
  const value = init[member];
  if (isA(value, name) || (isNullable && value == null)) return value ?? null;
  throw new TypeError(`Failed to read the '${member}' property: it is not of type '${name}'.`);
}

const navigationTypes = ["push", "replace", "reload", "traverse"];
let detailsOf: (event: any) => any;

class NavigateEvent extends events.Event {
  #it: any;

  static {
    detailsOf = event => event.#it;
  }

  constructor(type: string, init: any) {
    need(arguments.length, 2);
    init = dictionary(init);
    super(type, init);
    const { downloadRequest = null, sourceElement = null } = init;
    if (sourceElement !== null && core.nodeOf(sourceElement)?.type !== core.ELEMENT)
      throw new TypeError("Not an element.");
    this.#it = {
      navigationType: oneOf(init.navigationType, ...navigationTypes) ?? "push",
      destination: required(init, "destination", "NavigationDestination"),
      canIntercept: !!init.canIntercept,
      userInitiated: !!init.userInitiated,
      hashChange: !!init.hashChange,
      signal: required(init, "signal", "AbortSignal"),
      formData: required(init, "formData", "FormData", true),
      downloadRequest: downloadRequest === null ? null : `${downloadRequest}`,
      info: init.info,
      hasUAVisualTransition: !!init.hasUAVisualTransition,
      sourceElement,
      interception: "none",
      handlers: [],
      precommitHandlers: [],
    };
  }

  #check() {
    const { page } = this.#it;
    if (!this.isTrusted) throw domError("SecurityError", "This may only be called on a trusted event.");
    if (!isActive(page)) throw invalidState("The window is detached.");
    if (this.defaultPrevented) throw invalidState("The event has been canceled.");
  }

  intercept(options: unknown = undefined) {
    const it = this.#it;
    const given = dictionary(options);
    const focusReset = oneOf(given.focusReset, "after-transition", "manual");
    const [handler, precommitHandler] = [callback(given.handler), callback(given.precommitHandler)];
    const scroll = oneOf(given.scroll, "after-transition", "manual");
    this.#check();
    if (!it.canIntercept) throw domError("SecurityError", "This navigation cannot be intercepted.");
    if (this.eventPhase === 0)
      throw invalidState("intercept() may only be called while the event is being dispatched.");
    if (precommitHandler && !this.cancelable) throw invalidState("A precommitHandler needs a cancelable event.");
    it.interception = "intercepted";
    if (precommitHandler) it.precommitHandlers.push(precommitHandler);
    if (handler) it.handlers.push(handler);
    it.focusReset = focusReset ?? it.focusReset;
    it.scroll = scroll ?? it.scroll;
  }

  scroll() {
    this.#check();
    if (this.#it.interception !== "committed") throw invalidState("scroll() cannot be called now.");
    processScroll(this.#it);
  }
}
defineAttributes(
  NavigateEvent,
  `navigationType destination canIntercept userInitiated hashChange signal formData downloadRequest info
  hasUAVisualTransition sourceElement`,
  detailsOf!,
);

function processScroll(it: any) {
  const { page, navigationType } = it;
  it.interception = "scrolled";
  if (navigationType === "traverse" || navigationType === "reload") restoreScroll(page);
  else if (!page.scrollToFragment()) html.scroll(page.doc, 1, 0, 0, false);
}

function resetFocus({ doc }: Page) {
  const target = core.findDescendant(doc.node, node => core.hasAttr(node, "autofocus") && focusing.isFocusable(node));
  if (target !== null) return focusing.focus(target, focusing.SCRIPT);
  focusing.setFocus(doc, null, focusing.SCRIPT);
  doc.page!.tabStart = null;
}

class NavigationCurrentEntryChangeEvent extends events.Event {
  #navigationType: unknown;
  #from: object;

  constructor(type: string, init: any) {
    need(arguments.length, 2);
    init = dictionary(init);
    super(type, init);
    this.#from = required(init, "from", "NavigationHistoryEntry");
    this.#navigationType = oneOf(init.navigationType ?? undefined, ...navigationTypes) ?? null;
  }
  get navigationType() {
    return this.#navigationType;
  }
  get from() {
    return this.#from;
  }
}

class NavigationHistoryEntry extends events.EventTarget {
  #page: Page;
  #entry: Entry;

  constructor(page: any = undefined, entry?: Entry) {
    if (page?.entries === undefined) core.illegalConstructor();
    super();
    this.#page = page;
    this.#entry = entry!;
  }
  get key() {
    return isActive(this.#page) ? this.#entry.key : "";
  }
  get id() {
    return isActive(this.#page) ? this.#entry.id : "";
  }
  get url() {
    return isActive(this.#page) ? this.#entry.url : "";
  }
  get index() {
    return isActive(this.#page) ? this.#page.entries.indexOf(this.#entry) : -1;
  }
  get sameDocument() {
    return isActive(this.#page) && this.#entry.isOfDocument;
  }
  getState() {
    const { navigationState } = this.#entry;
    if (isActive(this.#page) && navigationState !== undefined) return deserialize(this.#page, navigationState);
  }
}
events.defineHandlers(NavigationHistoryEntry.prototype, ["dispose"]);

function wrapEntry(page: Page, entry: Entry): NavigationHistoryEntry {
  if (entry.js !== null) return entry.js;
  entry.js = new NavigationHistoryEntry(page, entry);
  page.mirror?.adopt(entry.js);
  return entry.js;
}

function handled<T>() {
  const deferred = Promise.withResolvers<T>();
  $pokePromiseAsHandled(deferred.promise);
  return deferred;
}

/** https://html.spec.whatwg.org/#navigation-api-method-tracker */
class Tracker {
  committed = Promise.withResolvers<object>();
  finished = handled<object>();
  entry: object | undefined;

  constructor(
    public info: unknown,
    public state?: unknown,
    readonly key?: string,
  ) {}

  result() {
    return { committed: this.committed.promise, finished: this.finished.promise };
  }

  reject(error: unknown) {
    this.committed.reject(error);
    this.finished.reject(error);
  }
}

const earlyError = (error: unknown) => ({ committed: Promise.$reject(error), finished: Promise.$reject(error) });

function whenAll(results: unknown[], success: () => void, failure: (reason: unknown) => void) {
  let left = results.length;
  for (const result of results) Promise.$resolve(result).then(() => --left === 0 && success(), failure);
}

function invoke(handler: Function, ...args: unknown[]) {
  try {
    return handler(...args);
  } catch (error) {
    return Promise.$reject(error);
  }
}

class NavigationState {
  page: Page;
  js: Navigation;
  activation: object | null = null;
  transition: any = null;
  event: any = null;
  suppressesScroll = false;
  ongoing: Tracker | null = null;
  upcoming: Tracker | null = null;
  traversals = new Map<string, Tracker>();
  resumeTraversal: (() => void) | undefined;

  constructor(page: Page, js: Navigation) {
    this.page = page;
    this.js = js;
  }

  isDisabled() {
    const { host } = this.page;
    return !isActive(this.page) || host.origin === "null" || !!host.isInitial?.();
  }

  #dispatch(event: object) {
    this.page.mirror?.adopt(event);
    return events.dispatchFromScript(this.js.$impl, event, true);
  }

  #forget(tracker: Tracker) {
    if (this.ongoing === tracker) this.ongoing = null;
  }

  /** https://html.spec.whatwg.org/#update-the-navigation-api-entries-for-a-same-document-navigation */
  committed(from: Entry, navigationType: string | null, dropped: Entry[]) {
    if (this.isDisabled()) return;
    const { page, ongoing, event } = this;
    const current = currentOf(page);
    if (ongoing !== null && navigationType !== null) {
      ongoing.entry = wrapEntry(page, current);
      if (ongoing.state !== undefined) save(page, Object.assign(current, { navigationState: ongoing.state }), "update");
      ongoing.committed.resolve(ongoing.entry);
    }
    this.#dispatch(
      new NavigationCurrentEntryChangeEvent("currententrychange", { navigationType, from: wrapEntry(page, from) }),
    );
    for (const it of dropped) {
      if (it.key !== current.key) this.giveUpTraversal(it.key);
      if (it.js !== null) events.dispatchFromScript(it.js.$impl, new events.Event("dispose"), true);
    }
    if (navigationType === "traverse" && event !== null && event === this.event) this.#runHandlers(event);
  }

  /** https://html.spec.whatwg.org/#inner-navigate-event-firing-algorithm. False if there is nothing else to do. */
  fire(
    navigationType: string,
    url: string,
    sameDocument: boolean,
    options: Options,
    classicState?: unknown,
    entry?: Entry,
  ) {
    const { page } = this;
    if (this.isDisabled()) return true;
    const { upcoming } = this;
    this.upcoming = null;
    this.abort();
    const tracker = (this.ongoing = entry ? (this.traversals.$get(entry.key) ?? null) : upcoming);
    if (entry) this.traversals.$delete(entry.key);
    if (!isActive(page)) {
      tracker?.reject(domError("AbortError", "Navigation was aborted"));
      return false;
    }
    const isTraversal = navigationType === "traverse";
    const destination = {
      url,
      sameDocument,
      get key() {
        return entry && isActive(page) ? entry.key : "";
      },
      get id() {
        return entry && isActive(page) ? entry.id : "";
      },
      state: entry ? entry.navigationState : options.navigationState,
      get index() {
        return entry && isActive(page) ? page.entries.indexOf(entry) : -1;
      },
      getState: () => (destination.state === undefined ? undefined : deserialize(page, destination.state)),
    };
    const controller = new page.window.AbortController();
    const old = page.doc.url;
    const event = new NavigateEvent("navigate", {
      cancelable: !isTraversal || (sameDocument && !page.host.container && (!options.isByUser || page.hasActivation())),
      navigationType,
      destination: createDestination(destination),
      canIntercept: canRewriteUrl(page, url) && (sameDocument || !isTraversal),
      userInitiated: !!options.isByUser,
      hashChange:
        classicState === undefined &&
        sameDocument &&
        withoutFragment(url) === withoutFragment(old) &&
        fragmentOf(url) !== fragmentOf(old),
      signal: controller.signal,
      formData: options.formData,
      downloadRequest: options.download,
      info: tracker?.info,
      sourceElement: options.element ? core.wrap(options.element) : null,
    });
    const it = Object.assign(detailsOf(event), {
      page,
      controller,
      tracker,
      classicState,
      focusSerial: page.focusSerial,
    });
    if (tracker) tracker.info = undefined;
    this.event = event;
    this.suppressesScroll = false;
    if (!this.#dispatch(event)) {
      if (!controller.signal.aborted) this.abort();
      return false;
    }
    if (it.interception !== "none") {
      const [committed, finished] = [handled(), handled()];
      const from = wrapEntry(page, currentOf(page));
      const values = {
        navigationType,
        from,
        to: it.destination,
        committed: committed.promise,
        finished: finished.promise,
      };
      this.transition = { js: createTransition(values), committed, finished };
    }
    if (it.precommitHandlers.length === 0) this.#commit(event);
    else {
      const precommit = createPrecommitController({
        redirect: (url: string, options: object) => this.#redirect(event, url, options),
        addHandler: (handler: Function) => this.#requirePrecommit(event).handlers.push(handler),
      });
      whenAll(
        it.precommitHandlers.map(handler => invoke(handler, precommit)),
        () => this.#commit(event),
        reason => this.#fail(event, reason),
      );
    }
    return it.interception === "none";
  }

  #requirePrecommit(event: any) {
    const it = detailsOf(event);
    if (!isActive(this.page) || event.defaultPrevented || it.interception !== "intercepted") {
      throw invalidState("The navigation has been committed or canceled.");
    }
    return it;
  }

  #redirect(event: any, given: string, { history, info, state }: any) {
    const { page } = this;
    history = oneOf(history, "auto", "push", "replace");
    const it = this.#requirePrecommit(event);
    if (it.navigationType !== "push" && it.navigationType !== "replace")
      throw invalidState("This navigation cannot be redirected.");
    const url = core.resolveUrl(page.doc, given);
    if (url === null) throw domError("SyntaxError", `Invalid URL '${given}'.`);
    if (!canRewriteUrl(page, url)) throw domError("SecurityError", `Cannot redirect to '${url}'.`);
    if (history === "push" || history === "replace") it.navigationType = history;
    if (state !== undefined) {
      it.destination.$impl.state = serialize(page, state);
      if (it.tracker) it.tracker.state = it.destination.$impl.state;
    }
    it.destination.$impl.url = url;
    if (info !== undefined) it.info = info;
  }

  #isOver({ controller }: any) {
    return !isActive(this.page) || controller.signal.aborted;
  }

  #commit(event: any) {
    const it = detailsOf(event);
    const { page } = this;
    const { url, state, sameDocument } = it.destination.$impl;
    if (this.#isOver(it)) return;
    const isIntercepted = it.interception !== "none";
    if (isIntercepted) it.interception = "committed";
    if (it.navigationType === "traverse") {
      if (!sameDocument && it.tracker) this.#forget(it.tracker);
      this.suppressesScroll = isIntercepted;
      return void (isIntercepted && this.resumeTraversal!());
    }
    if (isIntercepted && it.navigationType !== "reload")
      commit(page, url, it.navigationType === "replace", it.classicState, state);
    else if (isIntercepted) {
      rememberScroll(page);
      this.committed(currentOf(page), "reload", []);
    }
    if ((isIntercepted || sameDocument) && !this.#isOver(it)) this.#runHandlers(event);
  }

  #runHandlers(event: any) {
    const it = detailsOf(event);
    this.transition?.committed.resolve();
    const results = it.handlers.map(handler => invoke(handler));
    whenAll(
      results.length > 0 ? results : [undefined],
      () => {
        if (this.#isOver(it)) return;
        const { transition } = this;
        this.event = null;
        this.#finish(it, true);
        if (it.tracker) {
          this.#forget(it.tracker);
          it.tracker.finished.resolve(it.tracker.entry);
        }
        this.#dispatch(new events.Event("navigatesuccess"));
        transition?.finished.resolve();
        if (this.transition === transition) this.transition = null;
      },
      reason => this.#fail(event, reason),
    );
  }

  #finish(it: any, didFulfill: boolean) {
    if (it.interception === "none") return;
    if (it.interception !== "intercepted") {
      if (it.focusReset !== "manual" && it.focusSerial === this.page.focusSerial) resetFocus(this.page);
      if (didFulfill && it.interception === "committed" && it.scroll !== "manual") processScroll(it);
    }
    it.interception = "finished";
  }

  #fail(event: any, reason: unknown) {
    const it = detailsOf(event);
    if (this.#isOver(it)) return;
    this.#finish(it, false);
    this.#end(event, reason);
  }

  #end(event: any, error: any) {
    const { controller, tracker } = detailsOf(event);
    const { transition } = this;
    this.event = null;
    controller.abort(error);
    if (tracker) this.#forget(tracker);
    const init = this.page.host.describeError?.(error) ?? { error };
    this.#dispatch(new events.ErrorEvent("navigateerror", init));
    tracker?.reject(error);
    transition?.committed.reject(error);
    transition?.finished.reject(error);
    if (this.transition === transition) this.transition = null;
  }

  /** https://html.spec.whatwg.org/#inform-the-navigation-api-about-aborting-navigation */
  abort() {
    while (this.event !== null) {
      this.suppressesScroll = false;
      if (this.event.eventPhase !== 0) events.forceCancel(this.event);
      this.#end(this.event, domError("AbortError", "Navigation was aborted"));
    }
  }

  giveUpTraversal(key: string | undefined, error = domError("AbortError", "Navigation was aborted")) {
    this.page.mirror?.adopt(error);
    for (const [other, tracker] of this.traversals) {
      if (key !== undefined && key !== other) continue;
      this.traversals.$delete(other);
      tracker.reject(error);
    }
  }

  /** `start` may fire the `navigate` event. */
  track(info: unknown, state: unknown, start: () => void) {
    const tracker = new Tracker(info, state);
    if (!this.isDisabled()) this.upcoming = tracker;
    start();
    if (this.upcoming !== tracker) return tracker.result();
    this.upcoming = null;
    return earlyError(domError("AbortError", "Navigation was aborted"));
  }

  requireNavigable() {
    if (!isActive(this.page)) throw invalidState("The window is detached.");
    if (this.page.isUnloading) throw invalidState("The document is being unloaded.");
  }

  traverseTo(entry: Entry | undefined, options: unknown) {
    const { page, traversals } = this;
    const { info } = dictionary(options);
    try {
      if (entry === undefined || this.isDisabled()) throw invalidState("There is no such entry.");
      this.requireNavigable();
    } catch (error) {
      return earlyError(error);
    }
    const { key } = entry;
    if (entry === currentOf(page)) {
      const current = wrapEntry(page, entry);
      return { committed: Promise.$resolve(current), finished: Promise.$resolve(current) };
    }
    if (traversals.$has(key)) return traversals.$get(key)!.result();
    const tracker = new Tracker(info, undefined, key);
    traversals.$set(key, tracker);
    if (!page.host.traverseTo) traverse(page, page.entries.indexOf(entry) - page.entryIndex);
    else
      page.host.traverseTo(key, (name: string) => this.giveUpTraversal(key, domError(name, "The traversal failed.")));
    return tracker.result();
  }
}

let navigationOf: (page: Page) => NavigationState | undefined;

class Navigation extends events.EventTarget {
  #it: NavigationState;

  static {
    navigationOf = page => {
      const navigation: Navigation | undefined = page.same.$get("navigation");
      return navigation && navigation.#it;
    };
  }

  constructor(page: any = undefined) {
    if (page?.entries === undefined) core.illegalConstructor();
    super();
    this.#it = new NavigationState(page, this);
  }
  /** The window may have got another document. */
  #page() {
    const { page } = this.#it;
    page.history();
    return page;
  }
  entries() {
    const page = this.#page();
    return this.#it.isDisabled() ? [] : page.entries.map(entry => wrapEntry(page, entry));
  }
  get currentEntry() {
    return this.#it.isDisabled() ? null : wrapEntry(this.#page(), currentOf(this.#it.page));
  }
  updateCurrentEntry(options: any) {
    const page = this.#page();
    const { state } = dictionary(options);
    if (state === undefined) throw new TypeError("Required member state is undefined.");
    if (this.#it.isDisabled()) throw invalidState("There is no current entry.");
    const entry = currentOf(page);
    entry.navigationState = serialize(page, state);
    save(page, entry, "update");
    this.#it.committed(entry, null, []);
  }
  get transition() {
    return this.#it.transition?.js ?? null;
  }
  get activation() {
    const it = this.#it;
    if (it.isDisabled()) return null;
    if (it.activation !== null) return it.activation;
    const page = this.#page();
    const { from, entry = currentOf(page), type = "push" } = page.host.activation?.() ?? {};
    const find = (wanted: Entry) =>
      wrapEntry(
        page,
        page.entries.find(it => it.id === wanted.id) ?? createEntry(wanted.url, { isOfDocument: false, ...wanted }),
      );
    return (it.activation = createActivation({
      from: from ? find(from) : null,
      entry: find(entry),
      navigationType: type,
    }));
  }
  get canGoBack() {
    return !this.#it.isDisabled() && this.#page().entryIndex > 0;
  }
  get canGoForward() {
    return !this.#it.isDisabled() && this.#page().entryIndex < this.#it.page.entries.length - 1;
  }
  navigate(url: string, options: unknown = undefined) {
    const page = this.#page();
    need(arguments.length, 1);
    url = `${url}`.toWellFormed();
    const { history: given, info, state } = dictionary(options);
    const history = oneOf(given, "auto", "push", "replace");
    try {
      const resolved = URL.parse(url, page.doc.baseUrl)?.href;
      if (resolved === undefined) throw domError("SyntaxError", `Invalid URL '${url}'.`);
      if (resolved.startsWith("javascript:") || (history === "push" && page.host.isInitial?.())) {
        throw domError("NotSupportedError", "This navigation is not supported.");
      }
      const navigationState = serialize(page, state);
      this.#it.requireNavigable();
      const how = { replace: history === "replace", push: history === "push", source: "script", navigationState };
      return this.#it.track(info, navigationState, () => navigate(page, resolved, how));
    } catch (error) {
      return earlyError(error);
    }
  }
  reload(options: unknown = undefined) {
    const page = this.#page();
    const { info, state } = dictionary(options);
    try {
      const navigationState = state === undefined ? state : serialize(page, state);
      this.#it.requireNavigable();
      return this.#it.track(info, navigationState, () => reload(page, navigationState));
    } catch (error) {
      return earlyError(error);
    }
  }
  traverseTo(key: string, options: unknown = undefined) {
    const { entries } = this.#page();
    need(arguments.length, 1);
    key = `${key}`;
    return this.#it.traverseTo(
      entries.find(entry => entry.key === key),
      options,
    );
  }
  back(options: unknown = undefined) {
    const { entries, entryIndex } = this.#page();
    return this.#it.traverseTo(entries[entryIndex - 1], options);
  }
  forward(options: unknown = undefined) {
    const { entries, entryIndex } = this.#page();
    return this.#it.traverseTo(entries[entryIndex + 1], options);
  }
}
events.defineHandlers(Navigation.prototype, ["navigate", "navigatesuccess", "navigateerror", "currententrychange"]);
for (const ctor of [NavigateEvent, Navigation, NavigationCurrentEntryChangeEvent, NavigationHistoryEntry]) {
  expose(ctor);
}

/** `to` is undefined if the next document is of another origin. */
function willSwap(page: Page, navigationType: string, to?: Entry): number {
  const fire = (viewTransition: object | null) => firePageSwap(page, navigationType, to, viewTransition);
  if (to === undefined || navigationType === "reload") return (fire(null), 0);
  return require("internal/desktop/dom/view_transition").swap(page, page.canvasColor(), fire);
}

function firePageSwap(page: Page, navigationType: string, to: Entry | undefined, viewTransition: object | null) {
  if (!events.hasListeners(page.target, "pageswap")) return;
  const entry = to && (page.entries.find(it => it.id === to.id) ?? createEntry(to.url, { ...to, isOfDocument: false }));
  const activation =
    entry &&
    createActivation({ from: wrapEntry(page, currentOf(page)), entry: wrapEntry(page, entry), navigationType });
  events.dispatch(page.target, new events.PageSwapEvent("pageswap", { activation, viewTransition }));
}

/** `isRemoved`: its frame is gone. */
function abortNavigation(page: Page, isRemoved = false) {
  const navigation = navigationOf(page);
  navigation?.abort();
  if (isRemoved) navigation?.giveUpTraversal(undefined);
}

/** A frame has pushed an entry, or the app has removed some. */
function keepEntries(page: Page, keys: string[]) {
  const current = currentOf(page);
  const dropped = page.entries.filter(entry => !keys.includes(entry.key));
  page.entries = page.entries.filter(entry => keys.includes(entry.key));
  page.entryIndex = page.entries.indexOf(current);
  for (const it of dropped) {
    navigationOf(page)?.giveUpTraversal(it.key);
    if (it.js !== null) events.fire(it.js.$impl, "dispose");
  }
}

export default {
  History,
  Navigation,
  abortNavigation,
  createLocation,
  initialize,
  keepEntries,
  navigate,
  popState,
  refresh,
  rememberScroll,
  replaceUrl,
  restoreScroll,
  traverse,
  willSwap,
  willTraverse,
};
