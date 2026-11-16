// A frame whose document is in this process, and the windows of other origins.
const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const interactive = require("internal/desktop/dom/interactive");
const focusing = require("internal/desktop/dom/focus");
const html = require("internal/desktop/dom/html");
const exotic = require("internal/desktop/dom/exotic");
const { arrayIndex } = require("internal/desktop/dom/node");

const { domError, getAttr, invalidate, isHtml, resolveUrl, sync } = core;

type N = $Dom.N;
type Page = $Dom.Page;

const matchesBlank = /^about:blank(?:[?#]|$)/;
const LAZY_MARGIN = 1250;
const fallbacks: PropertyKey[] = ["then", Symbol.toStringTag, Symbol.hasInstance, Symbol.isConcatSpreadable];

/** The page of the script that is calling. */
function caller(): Page {
  return exotic.callingWindow(false)?.x ?? core.realm.page;
}

/** https://html.spec.whatwg.org/#cross-origin-objects */
function crossOrigin(members: object, child?: (key: number | string) => unknown, length?: () => number) {
  const refuse = (): never => {
    throw domError("SecurityError", "Blocked a frame from accessing a cross-origin frame.");
  };
  function describe(key: PropertyKey): PropertyDescriptor {
    const index = child !== undefined && typeof key === "string" ? arrayIndex(key) : -1;
    if (index >= 0) return { value: child!(index) ?? refuse(), writable: false, enumerable: true, configurable: true };
    const own = Object.getOwnPropertyDescriptor(members, key);
    if (own !== undefined) return { ...own, enumerable: false, ...("value" in own && { writable: false }) };
    const value = typeof key === "string" ? child?.(key) : undefined;
    if (value === undefined && !fallbacks.includes(key)) refuse();
    return { value, writable: false, enumerable: false, configurable: true };
  }
  return new Proxy(Object.create(null), {
    get(_, key, receiver) {
      const found = describe(key);
      return "value" in found ? found.value : (found.get ?? refuse).$call(receiver);
    },
    set(_, key, value, receiver) {
      (describe(key).set ?? refuse).$call(receiver, value);
      return true;
    },
    has: (_, key) => !!describe(key),
    getOwnPropertyDescriptor: (_, key) => describe(key),
    ownKeys: () =>
      [
        ...Array.from({ length: length?.() ?? 0 }, (_, index) => `${index}`),
        ...Object.keys(members),
        ...fallbacks,
      ] as string[],
    defineProperty: refuse,
    deleteProperty: refuse,
    getPrototypeOf: () => null,
    setPrototypeOf: (_, prototype) => prototype === null,
    preventExtensions: () => false,
  });
}

function remoteWindow(remote: any, existing?: object) {
  function go(url: unknown, replace: boolean) {
    const source = caller();
    const resolved = resolveUrl(source.doc, `${url}`);
    if (resolved === null) throw domError("SyntaxError", `'${url}' is not a valid URL.`);
    if (remote.navigate(source.host.owner, resolved, replace)) return;
    throw domError("SecurityError", "The current window does not have permission to navigate the target frame.");
  }
  const location = crossOrigin({
    set href(url: unknown) {
      go(url, false);
    },
    replace(url: unknown) {
      if (arguments.length < 1) throw new TypeError("1 argument required, but only 0 present.");
      go(url, true);
    },
  });
  const members = {
    get window() {
      return window;
    },
    get self() {
      return window;
    },
    get location(): unknown {
      return location;
    },
    set location(url: unknown) {
      go(url, false);
    },
    close() {
      remote.close();
    },
    get closed() {
      return remote.isClosed();
    },
    focus() {
      remote.focus();
    },
    blur() {},
    get frames() {
      return window;
    },
    get length() {
      return remote.length();
    },
    get top() {
      return remote.top();
    },
    get opener() {
      return remote.opener();
    },
    get parent() {
      return remote.parent();
    },
    postMessage(message: unknown) {
      if (arguments.length < 1) throw new TypeError("1 argument required, but only 0 present.");
      postMessage(remote, message, arguments[1], arguments[2]);
    },
  };
  const window = exotic.remoteWindow(crossOrigin(members, remote.child, remote.length), existing);
  return window;
}

function postMessage(target: any, message: unknown, options: any, transfer: any) {
  const isDictionary = transfer === undefined && (options == null || $isObject(options));
  const origin = `${isDictionary ? (options?.targetOrigin === undefined ? "/" : options.targetOrigin) : options}`;
  if (transfer !== undefined && transfer?.[Symbol.iterator] == null)
    throw new TypeError("The provided value cannot be converted to a sequence.");
  const moved = core.realm.page.host.messaging().transferList(isDictionary ? options : transfer, !isDictionary);
  if (origin !== "*" && origin !== "/" && !URL.canParse(origin)) {
    throw domError("SyntaxError", `Invalid target origin '${origin}' in a call to 'postMessage'.`);
  }
  target.postMessage(caller().host.owner, message, origin, moved);
}

const loader = () => require("internal/desktop/dom/loader");
const isLazy = (node: N) => getAttr(node, "loading")?.toLowerCase() === "lazy";
const absoluteLength = /^\s*\+?(\d*\.?\d+(?:e[-+]?\d+)?)(px|in|cm|mm|pt|pc|em|)\s*$/i;
const pixelsIn = { "": 1, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16, em: 16 };

function svgLength(text: string | null): number {
  const match = absoluteLength.exec(text ?? "");
  return match === null ? NaN : +match[1] * pixelsIn[match[2].toLowerCase()];
}

class LocalFrame {
  isRemote = true;
  isLocal = true;
  /** Where its content is in the viewport, and by how much a transform scales it. */
  box = [0, 0, 0, 0];
  scale = 1;
  local: any;
  #node: N;
  #page: Page;
  #waiting: (() => void) | null = null;
  #delaysLoad = false;
  #isMeasuring = false;
  #colorScheme = 0;
  naturalWidth = 300;
  naturalHeight = 150;

  constructor(node: N, page: Page) {
    this.#node = node;
    this.#page = page;
    const isPlugin = node.name === "object" || node.name === "embed";
    this.local = page.host.createLocalFrame({
      node,
      page,
      self: () => core.wrap(node),
      kind: node.name,
      name: getAttr(node, "name") ?? "",
      attribute: (name: string) => getAttr(node, name),
      baseUrl: () => node.doc.baseUrl,
      loading: () => this.#delayLoad(true),
      navigating: () => (this.#waiting = null),
      loaded: (fires: boolean) =>
        page.queueTask(() => {
          if (node.x !== this) return;
          if (isPlugin) {
            if (!fires && this.local.context.page.isInitial) loader().failPlugin(node);
            else loader().showPlugin(node);
          }
          if (fires) events.fire(node, "load");
          this.#delayLoad(false);
        }),
      navigated: () => {
        if (this.local.document() === null) this.#fit(false);
        core.hooks.framesChanged(page);
      },
      useWebEngine: (url: string) => page.queueTask(() => node.x === this && loader().openRemoteFrame(node, page, url)),
      showImage: (url: string) => node.x === this && loader().showPluginImage(node, url),
      schedule() {
        page.hasDirtyFrames = true;
        invalidate(node.doc);
      },
      measure: () => this.#measure(),
      fit: (followsContents: boolean) => this.#fit(followsContents),
      scroll(x: number, y: number) {
        if (sync(node.doc).userScroll(node.id, x, y, 0, false) !== 0) invalidate(node.doc);
        else page.container?.scroll(x, y);
      },
      reveal: () => html.scrollIntoView(node, 3, 3),
      tab: (backward: boolean) => focusing.moveFocus(node.doc, backward),
      focus: () => node.x === this && focusing.focusFrame(node),
      activated: (isMouse: boolean) => page.noteActivationBelow(isMouse),
      isFocused: () => page.isFocused && page.focusedFrame === node,
      isInert: () => focusing.isInert(node),
      enterFullscreen: () => interactive.enterFullscreen(node),
      leaveFullscreen: () => interactive.leaveFullscreen(node.doc, node),
      origin: () => this.box,
      colorScheme: () => (node.id === 0 ? 0 : sync(node.doc).styleBits(node.id, 3 << 17)),
    });
  }

  get window() {
    return this.local.window();
  }

  get image() {
    return this.local.image;
  }

  #delayLoad(delays: boolean) {
    if (delays === this.#delaysLoad) return;
    this.#delaysLoad = delays;
    if (delays) this.#page.delayLoad();
    else this.#page.allowLoad();
  }

  /** https://html.spec.whatwg.org/#process-the-iframe-attributes */
  navigate(isInitial = false) {
    const node = this.#node;
    const isIframe = isHtml(node, "iframe");
    const srcdoc = isIframe ? getAttr(node, "srcdoc") : null;
    const source = getAttr(node, isHtml(node, "object") ? "data" : "src");
    const url = srcdoc !== null ? "about:srcdoc" : (source && resolveUrl(node.doc, source)) || "about:blank";
    this.#waiting = null;
    if (isInitial && matchesBlank.test(url)) {
      if (url !== "about:blank") this.local.context.page.setInitialUrl(url);
      if (isIframe) events.fire(node, "load");
      else this.#page.queueTask(() => events.fire(node, "load"));
      return;
    }
    if (this.#isRecursive(url)) return;
    const start = () => {
      this.#waiting = null;
      this.local.navigate(url, srcdoc ?? undefined, getAttr(node, "referrerpolicy") ?? "");
    };
    if (!isIframe || !isLazy(node) || this.#isNear()) return start();
    this.#waiting = start;
    this.#page.layoutVersion = -1;
  }

  /** An SVG document has one. */
  naturalSize(): number[] {
    const doc = this.local.page()?.doc;
    const root = doc && core.documentElement(doc);
    if (root?.ns !== core.SVG) return [300, 150, NaN];
    const [width, height] = [svgLength(getAttr(root, "width")), svgLength(getAttr(root, "height"))];
    const box = (getAttr(root, "viewBox") ?? "").trim().split(/[\s,]+/);
    return [width, height, width / height || +box[2] / +box[3]];
  }

  #isRecursive(url: string) {
    if (url.startsWith("about:")) return false;
    let depth = 0;
    for (let it = this.local.context.parent; it !== null; it = it.parent, depth++) {
      if (it.page.url.split("#")[0] === url.split("#")[0]) return true;
    }
    return depth > 64;
  }

  attributeChanged(name: string) {
    if (name === "name") this.local.context.name = getAttr(this.#node, name) ?? "";
    else if (name === "loading" && !isLazy(this.#node)) this.#waiting?.();
    else if (name === "marginwidth" || name === "marginheight") this.local.page()?.frameMarginsChanged();
    else if (name === "scrolling") this.local.page()?.readEnvironment();
  }

  #isNear() {
    const [x, y, width, height] = this.box;
    const isInside = x < this.#page.width + LAZY_MARGIN && y < this.#page.height + LAZY_MARGIN;
    return width * height > 0 && isInside && x + width > -LAZY_MARGIN && y + height > -LAZY_MARGIN;
  }

  #measure() {
    const node = this.#node;
    if (this.#isMeasuring || node.x !== this || node.id === 0) return;
    this.#isMeasuring = true;
    html.boundingRect(node);
    const [, , width, height] = node.doc.engine.boxSizes(node.id);
    const { zoom, surfaceScale } = this.#page;
    this.local.place(width * zoom, height * zoom, surfaceScale, width * height > 0);
    this.#isMeasuring = false;
    const scheme = node.doc.engine.styleBits(node.id, 3 << 17);
    if (scheme !== this.#colorScheme) this.local.environmentChanged();
    this.#colorScheme = scheme;
  }

  #setNaturalSize(width: number, height: number) {
    const node = this.#node;
    this.naturalWidth = width;
    this.naturalHeight = height;
    node.doc.engine.setReplaced(node.id, this.image, width, height, NaN);
    invalidate(node.doc);
  }

  /** The contents are measured in the viewport that they would have if they did not count. */
  #fit(followsContents: boolean) {
    const node = this.#node;
    if (node.x !== this || node.id === 0 || node.name !== "iframe") return;
    if (this.naturalWidth !== 300 || this.naturalHeight !== 150) this.#setNaturalSize(300, 150);
    if (!followsContents) return;
    const { doc } = this.local.page();
    sync(doc).updateLayout();
    const [width, height] = doc.engine.boxSizes(1);
    this.#setNaturalSize(width, height);
    this.#measure();
  }

  setRect({ x, y, width, height }: any) {
    const node = this.#node;
    const [left, top, outerWidth] = html.boundingRect(node);
    const scale = (this.scale = outerWidth / core.wrap(node).offsetWidth || 1);
    this.box = [left + (x - left) * scale, top + (y - top) * scale, width * scale, height * scale];
    this.#measure();
    const inner: Page | undefined = this.#page.isObservedFromFrames ? this.local.page() : undefined;
    for (const page of inner ? [inner, ...inner.below()] : []) {
      if (page.watched.acrossFrames.length === 0) continue;
      page.hasNewObservations = true;
      invalidate(page.doc);
    }
    if (this.#waiting !== null && this.#isNear()) this.#waiting();
  }

  contains(x: number, y: number) {
    const [left, top, width, height] = this.box;
    return x >= left && y >= top && x < left + width && y < top + height;
  }

  input(event: any) {
    const { zoom } = this.#page;
    const [left, top] = this.box;
    const moved = (it: any) => ({ ...it, x: (it.x - left * zoom) / this.scale, y: (it.y - top * zoom) / this.scale });
    if (event.points) return this.local.input({ ...event, points: event.points.map(moved) });
    this.local.input("x" in event ? moved(event) : event);
  }

  focusedFrame() {
    return this.local.focusedFrame();
  }

  edit(name: string) {
    return this.local.edit(name);
  }

  dispose() {
    const page = this.#page;
    if (page.frameUnderMouse === this.#node) page.frameUnderMouse = null;
    this.local.dispose();
    this.#delayLoad(false);
  }
}

export default { LocalFrame, caller, postMessage, remoteWindow };
