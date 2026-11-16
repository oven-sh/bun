// An `<iframe>` of a page of the app. The web engine has it in an empty document with the origin and the policies of the page.
const { carryPorts } = require("internal/desktop/electron/ipc");
const { originOf, resolveBlob } = require("internal/desktop/electron/policy");
const { ContentSecurityPolicy } = require("internal/desktop/web/csp");
const { queueTask } = require("internal/desktop/electron/stubs");
const { isAvailable } = require("internal/desktop/webview/engine");
const { Remote, emitOn } = require("internal/desktop/webview/contents");
const { View } = require("internal/desktop/webview/view");
const wire = require("internal/desktop/webview/wire");

/** What the `<iframe>` element does. Its arguments are copied into the realm of the page. */
type Element = {
  self(): object;
  message(data: unknown, origin: string, path: number[], ports: MessagePort[]): void;
  loaded(frames: number): void;
  painted(image: number): void;
  scroll(x: number, y: number): void;
  tab(direction: number): void;
  tooltip(text: string): void;
  origin(): number[];
  box(): number[];
  scale(): number;
};

const toBlob = ([bytes, type, name, lastModified]: any[]) =>
  name === undefined ? new Blob([bytes], { type }) : new File([bytes], name, { type, lastModified });
const ofSubframes =
  /^(?:will-(?:frame-navigate|redirect)|did-(?:frame-.*|fail-.*|navigate-in-page|start-navigation|redirect-navigation)|frame-created)$/;
const ofAnyFrame =
  /^(?:certificate-error|console-message|context-menu|login|media-.*|audio-state-changed|select-.*|update-target-url)$/;

/** Without what the page does not have, or may not delegate. */
function restrict(allow = "", page: any) {
  const lists = new Map<string, string>();
  for (const [, name, list] of (page.permissionsPolicy ?? "").matchAll(/([\w-]+)=\(([^)]*)\)/g)) lists.$set(name, list);
  const kept = allow.split(";").filter(it => {
    const name = it.trim().split(/\s/)[0];
    return !lists.$has(name) && page.allowsFeature?.(name) !== false;
  });
  const asked = new Map(allow.split(";").map(it => [it.trim().split(/\s/)[0], it.trim().split(/\s+/).slice(1)]));
  lists.$forEach((list, name) => {
    const origins = Array.from(list.matchAll(/\x22([^\x22]*)\x22/g), match => match[1]);
    const wanted = asked.$get(name)?.filter(it => it !== "'src'");
    const granted = wanted
      ? origins.filter(it => wanted.length === 0 || wanted.includes("*") || wanted.includes(it))
      : [];
    kept.push(`${name} ${granted.join(" ") || "'none'"}`);
  });
  return kept.join(";");
}

/** What the attribute allows of what the page is allowed. */
function confine(attribute: string | null | undefined, { sandbox }: any) {
  if (sandbox === undefined) return attribute;
  const own = attribute?.toLowerCase().split(/\s+/);
  return [...sandbox].filter(flag => own?.includes(flag) ?? true).join(" ");
}

class Frame extends Remote {
  embedder;
  #page;
  #element: Element;
  #channel;
  #sent: Promise<unknown>;
  #ready!: () => void;
  hasCrashed = false;
  #hasPainted = false;
  #style = "";
  #popup: any;

  constructor(page: any, state: any, element: Element) {
    super(page.webContents, state);
    this.#page = page;
    this.#element = element;
    this.embedder = page.handle;
    const owner = {
      surface: state.container?.surface ?? state.surface,
      window: state.window,
      toSurface: (x: number, y: number) => [x, y].map((it, axis) => (it + element.origin()[axis]) * this.view.zoom),
      painted: (frame: any) => {
        if (this.#hasPainted) return state.container?.painted(element.scale(), this.#changedBy(frame));
        this.#hasPainted = true;
        element.painted(this.view.image);
      },
      shortcutFor: (event: object) => (state.ignoresMenuShortcuts ? undefined : state.window()?.deferShortcut(event)),
      tooltip: element.tooltip,
    };
    this.view = new View(this.engine, owner, { width: 300, height: 150 }, element.scale(), true);
    this.engine.views.set(this.view.id, this);
    const { javascript, images, webSecurity, spellcheck, plugins, autoplayPolicy, disableDialogs } = state.preferences;
    const preferences = { images, webSecurity, spellcheck, plugins, autoplayPolicy, disableDialogs };
    this.engine.send("create", this.view.describe(this.session, { ...preferences, javascript }));
    for (const [method, args] of state.settings) if (!/Zoom|Emulation/.test(method)) this.tell(method, ...args);
    this.tell("setZoomMode", "isolated");
    this.#sent = new Promise<void>(resolve => (this.#ready = resolve));
    this.#channel = carryPorts(
      (packet: unknown[]) => this.#send("packet", packet),
      0,
      ({ message, origin, path }: any, ports: MessagePort[]) => {
        const copies = page.world(0).clone([message, Array.from(path, Number), ports], ports);
        element.message(copies[0], this.engine.fromEngine(String(origin)), copies[1], copies[2]);
      },
    );
    const meta = (name: string, value: string) => `<meta ${name} content="${Bun.escapeHTML(value)}">`;
    const policies = String(page.csp).split(",").filter(Boolean);
    const head = policies.map(it => meta("http-equiv=Content-Security-Policy", it));
    if (page.referrerPolicy) head.push(meta("name=referrer", page.referrerPolicy));
    const html = encodeURIComponent(`<!doctype html>${head.join("")}<body>`);
    const base = page.url.startsWith("about:") ? page.origin + "/" : page.url;
    this.tell("loadURL", `data:text/html,${html}`, { baseURLForDataURL: page.origin === "null" ? undefined : base });
  }

  get focusedFrame() {
    return this.engine.objects.get(this.mirrored.focusedFrame) ?? this.frames[0];
  }

  /** In the surface of the page. */
  #changedBy({ x, y, w, h, width, height }: any) {
    if (!w) return {};
    const [left, top, across, down] = this.#element.box().map(it => it * this.view.zoom);
    const [byX, byY] = [across / width, down / height];
    return { x: left + x * byX - 1, y: top + y * byY - 1, width: w * byX + 2, height: h * byY + 2 };
  }

  get element() {
    return this.#element;
  }

  /** Blobs are read asynchronously, and the messages stay in order. */
  #send(...message: unknown[]) {
    this.#sent = this.#sent.then(async () => {
      const blobs = new Map<any, unknown>();
      wire.encode(message, it => (it instanceof Blob ? void blobs.$set(it, 0) || 0 : undefined));
      for (const blob of blobs.keys()) {
        blobs.$set(blob, [await blob.arrayBuffer(), blob.type, blob.name, blob.lastModified]);
      }
      this.engine.send(
        "frame",
        this.view.id,
        wire.encode(message, it => blobs.$get(it)),
      );
    });
    this.#sent = this.#sent.catch(() => {});
  }

  /** From a process that may have been taken over. */
  receive(bytes: Uint8Array) {
    let name, first, second;
    try {
      [name, first, second] = wire.decode(bytes.subarray(4), toBlob);
      if (name === "packet") return this.#channel.accept(first);
    } catch {
      return;
    }
    if (name === "ready") this.#ready();
    else if (name === "load") this.#element.loaded(+first);
    else if (name === "scroll") this.#element.scroll(+first, +second);
    else if (name === "tab") this.#element.tab(+first);
    else if (name === "entered") this.view.input({ t: "key", e: "down", key: "Tab", code: "Tab", m: +(first < 0) });
  }

  emit(name: string, event: any, args: any[]) {
    if (name === "will-navigate") {
      event.preventDefault();
      const top = this.state.container && this.state.context.top;
      return (top?.state ?? this.state).navigateFrom(top?.page ?? this.#page, event.url, event.initiator);
    }
    if (name === "render-process-gone") return this.engineClosed();
    if (name.endsWith("-html-full-screen")) return this.#element.fullscreen(name.startsWith("enter"));
    const isOfPage =
      name === "frame-created" ? args[0].frame === this.embedder : (event?.isMainFrame ?? args.at(-3) === true);
    if (ofSubframes.test(name) ? isOfPage : !ofAnyFrame.test(name)) return;
    if (name === "context-menu") {
      [args[0].x, args[0].y] = this.view.owner.toSurface(args[0].x / this.view.zoom, args[0].y / this.view.zoom);
      args[0].pageURL = this.#page.url;
    }
    emitOn(this.webContents, name, event, args);
  }

  destroyed() {}

  engineClosed() {
    this.hasCrashed = true;
    this.#hasPainted = false;
    this.#element.painted(0);
  }

  navigate(given: Record<string, string>) {
    const attributes = { ...given, src: this.engine.toEngine(given.src), allow: restrict(given.allow, this.#page) };
    const sandbox = confine(given.sandbox, this.#page);
    if (sandbox != null) (attributes as any).sandbox = sandbox;
    const isBlob = given.src.startsWith("blob:") && originOf(given.src) === this.#page.origin;
    this.#send("navigate", attributes, isBlob && resolveBlob(given.src));
  }

  /** It is `window.opener` to the page that `guest` is for. */
  openPopup(guest: any, url: string, name: string) {
    this.#popup = guest;
    this.view.setVisible(false);
    this.#send("open", this.engine.toEngine(url), name);
  }

  open(details: object) {
    const popup = this.#popup;
    this.#popup = undefined;
    return popup ? popup.describe() : super.open(details);
  }

  attribute(name: string, value: string | null) {
    this.#send(
      "attribute",
      name,
      name === "allow" ? restrict(value ?? "", this.#page) : name === "sandbox" ? confine(value, this.#page) : value,
    );
  }

  location(path: number[], method: string, url: string) {
    this.#send("location", path, method, this.engine.toEngine(url));
  }

  post(data: any, ports: MessagePort[]) {
    this.#channel.post({ ...data, targetOrigin: this.engine.toEngine(data.targetOrigin) }, ports);
  }

  place(width: number, height: number, isVisible: boolean, colorScheme: string, zoom: number) {
    if (zoom !== this.view.zoom) this.tell("setZoomFactor", (this.view.zoom = zoom));
    this.view.shownAt = zoom * this.view.scale;
    this.view.resize(width * zoom, height * zoom);
    this.view.setVisible(isVisible);
    const style = JSON.stringify({ display: width && height ? "" : "none", colorScheme });
    if (style !== this.#style) this.#send("style", JSON.parse((this.#style = style)));
  }

  exitFullscreen() {
    this.#send("exitFullscreen");
  }

  input(event: any) {
    if (event.t === "focus") this.#send("focus", event.direction);
    this.view.input(event);
  }

  destroy() {
    this.#channel.close();
    super.destroy();
  }
}

/** What the element calls. The engine does not start for a frame that shows nothing. */
function create(page: any, state: any, element: Element) {
  let frame: Frame | undefined;
  let placement: Parameters<Frame["place"]> | undefined;
  function dispose() {
    page.cleanups.delete(dispose);
    if (!page.frames.delete(frame)) return;
    frame!.destroy();
    changed();
  }
  const changed = () => state.observers?.forEach(it => it.framesChanged?.());
  page.cleanups.add(dispose);
  return {
    navigate(given: Record<string, string>) {
      if (frame?.hasCrashed) {
        page.frames.delete(frame);
        frame.destroy();
        frame = undefined;
      }
      if (!frame) {
        const isAllowed = given.srcdoc !== undefined || page.csp.allowsUrl(given.src, "iframe");
        if (!isAllowed || !isAvailable()) {
          const reason = isAllowed ? "there is no web engine" : "it violates the Content Security Policy";
          page.log("error", `Refused to frame ${given.src} because ${reason}`);
          return queueTask(() => page.disposed || element.loaded(0));
        }
        page.frames.add((frame = new Frame(page, state, element)));
        if (placement) frame.place(...placement);
        changed();
      }
      frame.navigate(structuredClone(given));
    },
    openPopup(guest: any, url: string, name: string) {
      page.frames.add((frame = new Frame(page, state, element)));
      frame.openPopup(guest, url, name);
      guest.webContents.once("destroyed", dispose);
    },
    attribute: (name: string, value: string | null) => frame?.attribute(name, value),
    location: (path: number[], method: string, url: string) => frame?.location([...path], method, url),
    post(path: number[], message: unknown, targetOrigin: string, transfer: object[]) {
      const [data, moved] = structuredClone([{ path, message, targetOrigin }, transfer], { transfer } as object) as any;
      const ports = moved.filter(it => it instanceof MessagePort);
      frame?.post(data, ports);
    },
    place: (...args: Parameters<Frame["place"]>) => frame?.place(...(placement = args)) ?? void (placement = args),
    input: (event: object) => frame?.input({ ...event }),
    exitFullscreen: () => frame?.exitFullscreen(),
    edit: (name: string) => frame?.view.edit(name),
    focusedFrame: () => frame?.focusedFrame,
    dispose,
  };
}

let sessionOfWindows: any;

/** For a `Window` of `bun:desktop`, whose document is in this realm. */
function createIn(window: any, surface: number, host: { navigate(url: string): void }, element: Element) {
  if (!sessionOfWindows) {
    sessionOfWindows = require("internal/desktop/electron/session").fromPartition("frames");
    sessionOfWindows.setPermissionRequestHandler((_: unknown, __: unknown, answer: Function) => answer(false));
    sessionOfWindows.setPermissionCheckHandler(() => false);
    sessionOfWindows.on("will-download", (event: any) => event.preventDefault());
  }
  const url = window.document.URL;
  const origin = originOf(url);
  const page = {
    url,
    origin,
    handle: { url, origin, parent: null },
    webContents: {
      session: sessionOfWindows,
      emit: (name: string, ...args: unknown[]) => name === "context-menu" && window.emit(name, ...args),
    },
    csp: new ContentSecurityPolicy(url),
    frames: new Set(),
    cleanups: new Set(),
    world: () => ({ clone: (value: unknown) => value }),
    log: (_: string, message: string) => process.emitWarning(message, "DesktopWarning"),
  };
  const state = {
    surface,
    window: () => window,
    isVisible: () => window.isVisible(),
    preferences: {},
    settings: new Map(),
    open: (_: unknown, { url }: any) => void host.navigate(url),
    navigateFrom: (_: unknown, url: string) => host.navigate(url),
  };
  return create(page, state, element);
}

export default { create, createIn };
