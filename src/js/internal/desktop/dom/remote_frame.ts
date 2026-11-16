// An `<iframe>` whose document is in another process.
const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const focusing = require("internal/desktop/dom/focus");
const html = require("internal/desktop/dom/html");
const input = require("internal/desktop/dom/input");

const { domError, getAttr, invalidate, resolveUrl, splitTokens } = core;

type N = $Dom.N;
type Page = $Dom.Page;

const LAZY_MARGIN = 1250;
const interactive = () => require("internal/desktop/dom/interactive");
const copied = splitTokens(
  "allow allowfullscreen credentialless csp name referrerpolicy sandbox scrolling srcdoc title",
);
const harmless = new Set<PropertyKey>(["then", Symbol.toStringTag, Symbol.hasInstance, Symbol.isConcatSpreadable]);

function crossOrigin(members: object, indexed?: (index: number) => unknown) {
  const refuse = (): never => {
    throw domError("SecurityError", "Blocked a frame from accessing a cross-origin frame.");
  };
  const toIndex = (key: PropertyKey) => (typeof key === "string" && /^\d+$/.test(key) ? indexed?.(+key) : undefined);
  return new Proxy(members, {
    get: (_, key) => (key in members ? members[key] : harmless.$has(key) ? undefined : (toIndex(key) ?? refuse())),
    has: (_, key) => key in members || harmless.$has(key) || toIndex(key) !== undefined || refuse(),
    set: (_, key, value) => (key === "href" || key === "location" ? ((members[key] = value), true) : refuse()),
    defineProperty: refuse,
    deleteProperty: refuse,
    getPrototypeOf: () => null,
    setPrototypeOf: refuse,
    preventExtensions: refuse,
  });
}

function deliver(page: Page, data: unknown, origin: string, source: object | null, ports: MessagePort[]) {
  const { adopt, messageEvent } = page.host.messaging();
  events.dispatchFromScript(page.target, messageEvent("message", data, origin, source, Array.from(ports, adopt)), true);
}

function poster(post: (message: unknown, targetOrigin: string, transfer: object[]) => void) {
  return function postMessage(message: unknown, options?: any, transfer?: object[]) {
    const isObject = $isObject(options);
    const targetOrigin = String((isObject ? options.targetOrigin : options) ?? "/");
    if (targetOrigin !== "*" && targetOrigin !== "/" && !URL.canParse(targetOrigin)) {
      throw domError("SyntaxError", `Invalid target origin '${targetOrigin}' in a call to 'postMessage'.`);
    }
    const { cloneInto, inbox, isPort, release, transferList } = core.realm.page.host.messaging();
    const [moved, copy] = cloneInto(
      inbox.clone,
      message,
      isObject ? transferList(options, false) : transferList(transfer),
    );
    post(
      copy,
      targetOrigin,
      moved.map(it => (isPort(it) ? release(it) : it)),
    );
  };
}

/** What `window.open()` returns for a document that is not in this realm. */
function popup(page: Page, handle: any) {
  const ignore = () => {};
  const remote = handle.connect({
    message: (data: unknown, origin: string, path: number[], ports: MessagePort[]) =>
      deliver(page, data, origin, path.length === 0 ? window : null, ports),
    ...{ loaded: ignore, painted: ignore, scroll: ignore, tab: ignore, tooltip: ignore, fullscreen: ignore },
    origin: () => [0, 0],
    scale: () => 1,
  });
  const window = crossOrigin({
    __proto__: null,
    get closed() {
      return handle.isClosed();
    },
    set location(url: unknown) {
      remote?.location([], "assign", resolveUrl(page.doc, String(url)));
    },
    opener: page.window,
    postMessage: poster((...args) => handle.isClosed() || remote?.post([], ...args)),
    close: () => void handle.close(),
    focus: () => void handle.focus(),
    blur: ignore,
  });
  return window;
}

class RemoteFrame {
  isRemote = true;
  window: object;
  image = 0;
  /** Where its content is in the viewport, and by how much a transform scales it. */
  box = [0, 0, 0, 0];
  scale = 1;
  #node: N;
  #page: Page;
  #remote: any;
  #windows = new Map<string, object>();
  #length = 0;
  #isClosed = false;
  #waits = false;
  #isFullscreen = false;

  constructor(node: N, page: Page) {
    this.#node = node;
    this.#page = page;
    this.window = this.#windowAt([]);
    this.#remote = page.host.createRemoteFrame!({
      self: () => core.wrap(node),
      message: (data: unknown, origin: string, path: number[], ports: MessagePort[]) =>
        deliver(page, data, origin, this.#windowAt(path), ports),
      loaded: (length: number) => {
        this.#length = length;
        events.fire(node, "load");
      },
      painted: (image: number) => {
        node.doc.engine.setReplaced(node.id, (this.image = image), 300, 150, NaN);
        invalidate(node.doc);
      },
      scroll: (x: number, y: number) => input.scrollAround(page, node, x, y),
      fullscreen: (on: boolean) => {
        this.#isFullscreen = on;
        if (on) interactive().enterFullscreen(node);
        else interactive().leaveFullscreen(node.doc, node);
      },
      tab: (direction: number) => node.doc.focused === node && focusing.moveFocus(node.doc, direction < 0),
      tooltip: (text: string) => (text ? page.showBubbleAt(page.mouse.x, page.mouse.y + 20, text) : page.hideBubble()),
      origin: () => page.offsetInTop().map((it, axis) => it + this.box[axis]),
      box: () => this.box,
      scale: () => page.surfaceScale,
    });
  }

  #windowAt(path: number[]): object {
    const key = path.join();
    let found = this.#windows.$get(key);
    if (found) return found;
    const [frame, node, page] = [this, this.#node, this.#page];
    const go = (method: string, url: unknown) => this.#remote.location(path, method, resolveUrl(node.doc, String(url)));
    const location = crossOrigin({
      __proto__: null,
      set href(url: unknown) {
        go("assign", url);
      },
      get href(): unknown {
        throw domError("SecurityError", "Blocked a frame from accessing a cross-origin frame.");
      },
      replace: (url: unknown) => go("replace", url),
    });
    const members = {
      __proto__: null,
      get closed() {
        return frame.#isClosed;
      },
      get length() {
        return path.length === 0 ? frame.#length : 0;
      },
      get location(): unknown {
        return location;
      },
      set location(url: unknown) {
        go("assign", url);
      },
      get parent() {
        return path.length === 0 ? page.window : frame.#windowAt(path.slice(0, -1));
      },
      top: page.host.top?.() ?? page.window,
      opener: null,
      postMessage: poster((...args) => this.#isClosed || this.#remote.post(path, ...args)),
      focus: () => core.hooks.focusFromScript(node, { preventScroll: true }),
      blur() {},
      close() {},
    };
    found = crossOrigin(members, index =>
      path.length === 0 && index < this.#length ? this.#windowAt([index]) : undefined,
    );
    Object.assign(members, { window: found, self: found, frames: found });
    this.#windows.$set(key, found!);
    return found!;
  }

  navigate() {
    const node = this.#node;
    this.#waits = getAttr(node, "loading")?.toLowerCase() === "lazy" && !this.#isNear();
    if (this.#waits) return;
    const attributes = {};
    for (const name of copied) attributes[name] = getAttr(node, name) ?? undefined;
    attributes["src"] = resolveUrl(node.doc, getAttr(node, "src") || "about:blank");
    this.#remote.navigate(attributes);
  }

  attributeChanged(name: string) {
    if (copied.includes(name)) this.#remote.attribute(name, getAttr(this.#node, name));
  }

  #isNear(margin = LAZY_MARGIN) {
    const [x, y, width, height] = this.box;
    const isInside = x < this.#page.width + margin && y < this.#page.height + margin;
    return width * height > 0 && isInside && x + width > -margin && y + height > -margin;
  }

  setRect({ x, y, width, height }: any, isVisible: boolean) {
    const [node, page] = [this.#node, this.#page];
    const [left, top, outerWidth] = html.boundingRect(node);
    const scale = (this.scale = outerWidth / core.wrap(node).offsetWidth || 1);
    this.box = [left + (x - left) * scale, top + (y - top) * scale, width * scale, height * scale];
    const colorScheme = node.doc.engine.computedStyle(node.id, "", "color-scheme");
    this.#remote.place(width, height, isVisible && this.#isNear(0) && page.isVisible, colorScheme, page.zoom);
    if (this.#waits) this.navigate();
    if (this.#isFullscreen && !(node.state & core.states.FULLSCREEN)) {
      this.#isFullscreen = false;
      this.#remote.exitFullscreen();
    }
  }

  contains(x: number, y: number) {
    const [left, top, width, height] = this.box;
    return x >= left && y >= top && x < left + width && y < top + height;
  }

  input(event: any) {
    if (!("x" in event)) return this.#remote.input(event);
    const { zoom } = this.#page;
    const [left, top] = this.box;
    this.#remote.input({ ...event, x: (event.x / zoom - left) / this.scale, y: (event.y / zoom - top) / this.scale });
  }

  edit(name: string) {
    this.#remote.edit(name);
    return true;
  }

  dispose() {
    const page = this.#page;
    this.#isClosed = true;
    this.image = 0;
    if (page.frameUnderMouse === this.#node) page.frameUnderMouse = null;
    this.#remote.dispose();
  }
}

function frameAt(page: Page, event: any): N | null {
  const { mouse, zoom } = page;
  if (mouse.buttons !== 0 || mouse.drag !== null) return null;
  const found = input.elementAt(page, event.x / zoom, event.y / zoom);
  return found?.x?.isRemote && found.x.contains(event.x / zoom, event.y / zoom) ? found : null;
}

function routePointer(page: Page, event: any) {
  const old: N | null = page.frameUnderMouse;
  const isHeld = old !== null && page.isHeldInFrame;
  if (event.t === "wheel" && !isHeld && input.isScrollingPage(page)) return false;
  const node = isHeld ? old : event.e === "leave" ? null : frameAt(page, event);
  if (event.t !== "wheel" && event.t !== "pinch") {
    if (old !== node) old?.x.input({ ...event, e: "leave" });
    page.frameUnderMouse = node;
  }
  if (node === null) return false;
  if (event.t === "mouse" || event.t === "pen") {
    page.isHeldInFrame = event.buttons > 0;
    if (!isHeld) input.enterFrame(page, event, node);
    if (event.e === "down") {
      if (!node.x.isLocal) page.noteUserActivation(true);
      page.endComposition();
      focusing.focusOnMouseDown(page.doc, node);
      page.renderNow();
    }
  }
  node.x?.input(event);
  return true;
}

/** All fingers go where the first one went. */
function routeTouch(page: Page, event: any) {
  if (event.e === "start") {
    if (page.fingersDown === 0) page.touchedFrame = frameAt(page, event.points[0]);
    page.fingersDown += event.points.length;
  } else if (event.e !== "move") page.fingersDown -= event.points.length;
  page.touchedFrame?.x?.input(event);
  return page.touchedFrame !== null;
}

/** True if the event is not for the page. */
function route(page: Page, event: any): boolean {
  const focused: N | null = page.focusedFrame;
  switch (event.t) {
    case "touch":
      return routeTouch(page, event);
    case "mouse":
    case "pen":
    case "wheel":
    case "pinch":
    case "drag":
      return routePointer(page, event);
    case "key":
      if (focused === null) return false;
      const leaves = event.key === "Escape" && event.e === "down";
      if (page.host.beforeInput?.(event) || (leaves && interactive().exitFullscreenFully(page)))
        page.native?.keyHandled();
      else focused.x?.input(event);
      return true;
    case "text":
    case "compose":
    case "composeEnd":
      focused?.x?.input(event);
      return focused !== null;
    case "focus":
    case "blur":
      focused?.x?.input(event);
  }
  return false;
}

/** The window loses the focus to a frame in it. */
function focusChanged(page: Page) {
  const { focused } = page.doc;
  const [old, node] = [page.focusedFrame, focused?.x?.isRemote ? focused : null];
  if (old === node) return;
  page.focusedFrame = node;
  if (node !== null) core.setState(node, core.states.FOCUS_VISIBLE, false);
  page.inputMethodState.forget();
  old?.x?.input({ t: "blur" });
  if (!page.isFocused) return;
  const direction = page.lastInputWasMouse ? 0 : page.mouse.modifiers & 1 ? -1 : 1;
  node?.x.input({ t: "focus", direction: page.isTabbing ? direction : 0 });
  if (old !== null && node !== null) return;
  events.dispatch(page.target, new events.FocusEvent(node === null ? "focus" : "blur", { view: page.window }));
}

export default { RemoteFrame, focusChanged, popup, route };
