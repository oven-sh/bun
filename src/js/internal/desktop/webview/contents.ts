// A `WebContents` while its page is in the web engine.
const EventEmitter = require("node:events");
const native = require("internal/desktop/native");
const { app, Event } = require("internal/desktop/app");
const { IpcMain, MessagePortMain, ipcMain, unwrapPorts } = require("internal/desktop/electron/ipc");
const { Engine, running, start } = require("internal/desktop/webview/engine");
const { View } = require("internal/desktop/webview/view");
const sessions = require("internal/desktop/webview/sessions");
const system = () => require("internal/desktop/system").api;

/** The ids of the pages in this process are below it. */
const FIRST_PROCESS_ID = 1 << 20;
const kId = Symbol("id");

class WebFrameMain extends EventEmitter {
  #engine;
  #state: any = {};
  ipc = new IpcMain();
  [kId]: number;

  constructor(engine: any, id: number) {
    super();
    this.#engine = engine;
    this[kId] = id;
  }

  static update(engine: any, state: any) {
    const owner = engine.views.get(state.view);
    if (owner?.embedder && !state.parent) return owner.embedder;
    let frame: WebFrameMain = engine.objects.get(state.id);
    if (!frame) engine.objects.set(state.id, (frame = new WebFrameMain(engine, state.id)));
    Object.assign(frame.#state, state);
    return frame;
  }

  static detach(frame: WebFrameMain) {
    frame.#state.detached = true;
    frame.#engine.objects.delete(frame[kId]);
    frame.#engine.send("release", frame[kId]);
  }

  static {
    for (const name of ["url", "origin", "name", "routingId", "frameToken", "osProcessId"]) {
      Object.defineProperty(this.prototype, name, {
        get() {
          return this.#state[name];
        },
      });
    }
  }

  get #owner() {
    return this.#engine.views.get(this.#state.view);
  }

  get processId() {
    return FIRST_PROCESS_ID + this.#state.processId;
  }

  get frameTreeNodeId() {
    return FIRST_PROCESS_ID + this.#state.frameTreeNodeId;
  }

  get parent() {
    return this.#state.parent ? (this.#engine.objects.get(this.#state.parent) ?? this.#owner?.embedder ?? null) : null;
  }

  get top() {
    return this.parent?.top ?? this;
  }

  get frames(): WebFrameMain[] {
    return this.#owner?.frames.filter(frame => frame.parent === this) ?? [];
  }

  get framesInSubtree(): WebFrameMain[] {
    return [this, ...this.frames.flatMap(frame => frame.framesInSubtree)];
  }

  get detached() {
    return !!this.#state.detached || !this.#owner;
  }

  get visibilityState() {
    return this.#owner?.state.isVisible() ? "visible" : "hidden";
  }

  isDestroyed() {
    return this.detached;
  }

  send(channel: string, ...args: unknown[]) {
    if (typeof channel !== "string") throw new TypeError("Missing required channel argument");
    this.#engine.tell("object", this[kId], "send", [channel, ...args]);
  }

  postMessage(channel: string, message: unknown, transfer?: unknown[]) {
    this.#engine.tell("object", this[kId], "postMessage", [channel, message, transfer]);
  }

  reload() {
    this.#engine.tell("object", this[kId], "reload");
    return true;
  }
}
for (const name of ["collectJavaScriptCallStack", "executeJavaScript", "printToPDF"]) {
  WebFrameMain.prototype[name] = function (...args: unknown[]) {
    return start().perform("object", this[kId], name, args);
  };
}

class Debugger extends EventEmitter {
  #guest;
  #session: Promise<string> | undefined;
  #sessions = new Set<string>();

  constructor(guest: Guest) {
    super();
    this.#guest = guest;
  }

  #listen(id: string, isRoot: boolean) {
    this.#sessions.$add(id);
    this.#guest.engine.inspected.set(id, (method: string, params: any) => {
      if (method === "Target.attachedToTarget") this.#listen(params.sessionId, false);
      if (method === "Target.detachedFromTarget" && this.#sessions.$delete(params.sessionId)) {
        this.#guest.engine.inspected.delete(params.sessionId);
      }
      this.emit("message", new Event(), method, params, isRoot ? "" : id);
    });
  }

  attach() {
    if (this.#session) throw new Error("Debugger is already attached to the target");
    const { engine, view } = this.#guest;
    this.#session = view.targetId.then(async (targetId: string) => {
      const { sessionId } = await engine.inspect("Target.attachToTarget", { targetId, flatten: true });
      this.#listen(sessionId, true);
      return sessionId;
    });
    this.#session!.catch(() => this.detach());
  }

  isAttached() {
    return this.#session !== undefined;
  }

  detach() {
    if (!this.#session) return;
    const { engine } = this.#guest;
    this.#session.then(sessionId => engine.inspect("Target.detachFromTarget", { sessionId })).catch(() => {});
    this.#session = undefined;
    this.#sessions.$forEach(id => engine.inspected.delete(id));
    this.#sessions.$clear();
    this.emit("detach", new Event(), "target closed");
  }

  async sendCommand(method: string, params?: object, sessionId?: string) {
    if (!this.#session) throw new Error("No target available");
    const root = await this.#session;
    if (sessionId && !this.#sessions.$has(sessionId)) throw new Error("Session with given id not found.");
    this.#guest.view.wake();
    return this.#guest.engine.inspect(method, params, sessionId || root);
  }
}

/** What a `WebContents` and an `<iframe>` have in common. */
class Remote {
  engine: any;
  session: number;
  view: any;
  frames: WebFrameMain[] = [];
  mirrored: any = {};
  cleanups = new Set<() => void>();
  #dialog: AbortController | undefined;

  constructor(
    readonly webContents: any,
    readonly state: any,
  ) {
    ({ engine: this.engine, id: this.session } = sessions.link(webContents.session));
  }

  tell(method: string, ...args: unknown[]) {
    this.engine.tell("view", this.view.id, method, args);
  }

  perform(method: string, ...args: unknown[]) {
    this.view.wake();
    return this.engine.perform("view", this.view.id, method, args);
  }

  update(mirrored: any) {
    this.mirrored = mirrored;
    const before = this.frames;
    this.frames = mirrored.frames.map(frame => WebFrameMain.update(this.engine, frame)).filter(it => it[kId]);
    for (const frame of before) if (!this.frames.includes(frame)) WebFrameMain.detach(frame);
  }

  async dialog({ dialogType, messageText, frame }: any, callback: Function) {
    if (dialogType === "prompt" || this.state.preferences.disableDialogs) return callback(false, "");
    const { signal } = (this.#dialog = new AbortController());
    const buttons = dialogType === "confirm" ? ["OK", "Cancel"] : ["OK"];
    // It must not pass for a dialog of the app.
    const options = {
      message: `${frame?.origin} says`,
      detail: messageText,
      buttons,
      cancelId: buttons.length - 1,
      signal,
    };
    const { response } = await require("internal/desktop/dialog").showMessageBox(this.state.window(), options);
    if (!signal.aborted) callback(response === 0, "");
  }

  cancelDialogs() {
    this.#dialog?.abort();
  }

  open(details: object) {
    const { frames, webContents, cleanups } = this;
    return this.state.open({ handle: frames[0], webContents, cleanups }, details)?.describe();
  }

  destroy() {
    this.cancelDialogs();
    for (const cleanup of [...this.cleanups]) cleanup();
    this.view.destroy();
    this.frames.splice(0).forEach(WebFrameMain.detach);
  }
}

const withFrameIds =
  /^did-(?:frame-.*|fail-.*|navigate-in-page|start-navigation|redirect-navigation)$|^will-(?:navigate|redirect|frame-navigate)$/;
const alsoOnApp = /^(?:certificate-error|login|select-client-certificate|render-process-gone)$/;

class Guest extends Remote {
  debugger = new Debugger(this);
  /** The entries of the history around its own. */
  #before: object[];
  #after: object[];
  #firstEntries = 1;
  #isShown = false;
  #isDestroyed = false;
  #nextFind = 1;
  onFrame: (() => void) | undefined;

  constructor(
    webContents: any,
    state: any,
    history: string | number = "push",
    readonly isOpenedByPage = false,
  ) {
    super(webContents, state);
    const { width = 800, height = 600, scale = system().screen.getPrimaryDisplay().scaleFactor } = state.size() ?? {};
    const index = typeof history === "number" ? history : state.index + +(history === "push");
    this.#before = state.entries.slice(0, index);
    this.#after = history === "push" ? [] : state.entries.slice(index + 1);
    const owner = {
      surface: state.surface,
      window: state.window,
      mayDragWindow: () => require("internal/desktop/electron/policy").isTrustedOrigin(this.mainFrame?.origin),
      toSurface: (x: number, y: number) => [x * this.view.zoom, y * this.view.zoom],
      painted: () => {
        this.onFrame?.();
        if (this.#isShown) return;
        this.#isShown = true;
        webContents.emit("ready-to-show", new Event());
      },
      shortcutFor: (event: object) => (state.ignoresMenuShortcuts ? undefined : state.window()?.deferShortcut(event)),
    };
    this.view = new View(this.engine, owner, { width, height }, scale, false);
    this.engine.views.set(this.view.id, this);
    this.engine.send("handle", [...ipcMain._invokeHandlers.keys(), ...webContents.ipc._invokeHandlers.keys()]);
    if (isOpenedByPage) this.engine.send("expect", this.view.id);
    else this.engine.send("create", this.describe());
    this.view.mayRest = state.preferences.backgroundThrottling !== false;
    state.settings.forEach((args: unknown[], method: string) => this.set(method, args));
  }

  set(method: string, args: any[]) {
    this.tell(method, ...args);
    if (method === "setZoomLevel") this.mirrored.zoomLevel = args[0];
    if (method === "setFrameRate") this.view.frameRate = args[0];
    if (method === "setBackgroundThrottling") {
      this.view.mayRest = args[0];
      this.view.wake();
    }
  }

  /** It takes the place of what the `WebContents` shows. */
  commit() {
    const { state } = this;
    if (state.guest === this) return this;
    state.guest?.destroy();
    state.leavePage();
    state.guest = this;
    native.send("webview.show", { id: this.view.image, surface: state.surface });
    if (this.webContents.isFocused()) this.view.input({ t: "focus" });
    if (this.mirrored.entries) this.update(this.mirrored);
    for (const observer of [...state.observers]) observer.guestCommitted?.();
    return this;
  }

  describe() {
    const { session: _, partition: __, preload, ...rest } = this.state.preferences;
    return this.view.describe(this.session, { ...rest, preload: preload && sessions.readable(this.engine, preload) });
  }

  get mainFrame() {
    return this.frames[0];
  }

  get focusedFrame() {
    return this.engine.objects.get(this.mirrored.focusedFrame);
  }

  update(mirrored: any) {
    super.update(mirrored);
    this.view.zoom = 1.2 ** mirrored.zoomLevel;
    const entries = mirrored.entries.map((entry, index) => ({ ...entry, document: this, index }));
    if (this.state.guest !== this || !entries[0]?.url) return;
    if (entries.length !== this.#firstEntries) this.#after = [];
    this.state.entries = [...this.#before, ...entries, ...this.#after];
    this.state.index = this.#before.length + mirrored.index;
  }

  /** The news of a cookie can be later than that of the navigation. */
  fetchCookies() {
    return this.engine.request("sendCookies", this.session);
  }

  clearHistory() {
    this.#before = this.#after = [];
    this.tell("navigationHistory.clear");
  }

  removeEntry(index: number) {
    const entry = this.state.entries[index];
    if (entry.document === this) return this.tell("navigationHistory.removeEntryAtIndex", entry.index);
    [this.#before, this.#after] = [this.#before, this.#after].map(list => list.filter(it => it !== entry));
  }

  /** Goes to an entry of the history, and takes over those around it that are for the web engine too. */
  traverse(url: string, navigation: any, isForGuest: (url: string) => boolean) {
    if (this.engine.type !== "electron") return this.load(url, navigation);
    const { entries } = this.state;
    let [first, end] = [navigation.history, navigation.history + 1];
    while (first > 0 && isForGuest(entries[first - 1].url)) first--;
    while (end < entries.length && isForGuest(entries[end].url)) end++;
    [this.#before, this.#after, this.#firstEntries] = [entries.slice(0, first), entries.slice(end), end - first];
    const own = entries.slice(first, end).map(({ url, title = "" }) => ({ url, title }));
    return this.perform("navigationHistory.restore", { entries: own, index: navigation.history - first });
  }

  load(url: string, { headers = [], body, referrer, userAgent, options }: any) {
    return this.perform("loadURL", url, {
      extraHeaders: headers.map(header => header.join(": ")).join("\n"),
      postData: body && [{ type: "rawData", bytes: Buffer.from(body) }],
      httpReferrer: referrer,
      userAgent,
      baseURLForDataURL: options?.baseURLForDataURL,
    });
  }

  handleEvent(event: any) {
    if (event.t === "resize") {
      this.view.shownAt = this.view.scale;
      return this.view.resize(event.width, event.height);
    }
    if (event.t === "key" && this.state.beforeInput(event)) return native.keyHandled();
    const { zoom } = this.view;
    this.view.input("x" in event ? { ...event, x: event.x / zoom, y: event.y / zoom } : event);
  }

  environmentChanged() {
    this.view.setVisible(this.state.isVisible() || !this.#isShown);
  }

  /** It fails until the engine has started to paint. */
  async capture(args: unknown[]) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const image = await this.perform("capturePage", ...args).catch(() => Bun.sleep(100));
      if (image) return image;
    }
    return this.perform("capturePage", ...args);
  }

  subscribe(callback: Function) {
    this.onFrame = () => {
      const { blob } = native.ask("surface.capture", { id: this.state.surface, format: "png" });
      const image = system().nativeImage.createFromBuffer(native.takeBlob(blob));
      callback(image, { x: 0, y: 0, ...image.getSize() });
    };
  }

  findInPage(...args: unknown[]) {
    this.tell("findInPage", ...args);
    return this.#nextFind++;
  }

  emit(name: string, event: any, args: any[]) {
    if (name === "ready-to-show") return;
    if (name === "did-frame-navigate" || (name === "did-fail-load" && args[0] !== -3)) this.commit();
    if (name === "dom-ready") this.mainFrame?.emit(name);
    if (name === "did-stop-loading") this.view.accessibilityChanged();
    if (/-html-full-screen$/.test(name)) {
      this.state.window()?.setFullScreen(name.startsWith("enter"));
      this.state.window()?.emit(name);
    }
    emitOn(this.webContents, name, event, args);
    const returns = /^will-(?:navigate|redirect)$/.test(name) && event.isMainFrame && !event.defaultPrevented;
    if (returns && this.state.takeOver(event.url, this.mainFrame)) event.preventDefault();
    const hasArrived = name === "did-navigate" ? args[1] < 300 : name === "did-navigate-in-page" && args[1];
    if (hasArrived && !this.#isDestroyed) this.state.takeOver(args[0], this.mainFrame, this.state.index);
  }

  destroyed() {
    if (this.state.guest === this) this.webContents.close();
  }

  engineClosed() {
    this.destroy();
    emitOn(this.webContents, "render-process-gone", new Event(), [{ reason: "crashed", exitCode: -1 }]);
  }

  destroy() {
    if (this.#isDestroyed) return;
    this.#isDestroyed = true;
    if (this.state.guest === this) this.state.guest = undefined;
    this.debugger.detach();
    super.destroy();
  }
}

function emitOn(webContents: any, name: string, event: any, args: any[]) {
  if (withFrameIds.test(name) && args.at(-2) > 0) args[args.length - 2] += FIRST_PROCESS_ID;
  webContents.emit(name, ...(event ? [event] : []), ...args);
  if (alsoOnApp.test(name) && !event.defaultPrevented) app.emit(name, event, webContents, ...args);
}

function ipcEvent(guest: Guest, frame: WebFrameMain, more?: object) {
  const details = {
    type: "frame",
    sender: guest.webContents,
    frameId: frame.routingId,
    processId: frame.processId,
    ...more,
  };
  const senderFrame = { get: () => (frame.detached ? null : frame), enumerable: true };
  return Object.defineProperty(new Event(details), "senderFrame", senderFrame);
}

function dispatch(
  guest: Guest,
  frame: WebFrameMain,
  name: string | undefined,
  event: any,
  channel: string,
  args: unknown[],
) {
  event.reply = (channel: string, ...args: unknown[]) => frame.send(channel, ...args);
  if (name) guest.webContents.emit(name, event, channel, ...args);
  for (const ipc of [frame.ipc, guest.webContents.ipc, ipcMain]) ipc.emit(channel, event, ...args);
}

function carry(engine: any, id: number, port: any) {
  const engineClosed = () => port.close();
  engine.objects.set(id, { port, engineClosed });
  port.onmessage = ({ data, ports }) =>
    engine.send(
      "port",
      id,
      data,
      ports.map(it => new MessagePortMain(it)),
    );
  port.addEventListener("close", () => engine.objects.delete(id) && engine.send("closePort", id));
  port.unref();
}

IpcMain.observe = (channel: string) => running()?.send("handle", [channel]);

Engine.handleOf.push(function (this: any, value: any) {
  if (value instanceof WebFrameMain) return ["frame", value[kId]];
  if (typeof value.toPNG === "function") return ["image", value.toPNG()];
  if (!(value instanceof MessagePortMain)) return;
  const id = this.newId();
  carry(this, id, structuredClone(unwrapPorts([value]), { transfer: unwrapPorts([value]) })[0]);
  return ["port", id];
});

Object.assign(Engine.handles, {
  view: (engine: any, id: number) => engine.views.get(id)?.webContents ?? null,
  frame: WebFrameMain.update,
  port(engine: any, id: number) {
    const { port1, port2 } = new MessageChannel();
    carry(engine, id, port1);
    return new MessagePortMain(port2);
  },
});

const forView =
  (name: string) =>
  (engine: any, id: number, ...args: unknown[]) =>
    engine.views.get(id)?.[name](...args);

Object.assign(Engine.handlers, {
  state: forView("update"),
  dialog: forView("dialog"),
  cancelDialogs: forView("cancelDialogs"),
  destroyed: forView("destroyed"),
  open: forView("open"),
  frame: forView("receive"),
  event(engine: any, kind: string, id: number, name: string, details: object | false, args: unknown[]) {
    const event = details ? new Event(details) : undefined;
    const calls = (engine.collected = /^(?:will-download|select-|login|certificate-|file-system-)/.test(name)
      ? []
      : undefined);
    try {
      const session = engine.sessions.get(id)?.session;
      if (kind === "view") engine.views.get(id)?.emit(name, event, args);
      else (kind === "session" ? session : session[kind]).emit(name, ...(event ? [event] : []), ...args);
      if (name === "will-download" && !event!.defaultPrevented) (args[0] as any).askWhereToSave(session, args[1]);
    } finally {
      engine.collected = undefined;
    }
    return { isPrevented: !!event?.defaultPrevented, calls: calls ?? [] };
  },
  ipc(engine: any, id: number, frame: WebFrameMain, channel: string, args: unknown[], ports: object[] | false) {
    const guest = engine.views.get(id);
    if (guest)
      dispatch(
        guest,
        frame,
        ports ? undefined : "ipc-message",
        ipcEvent(guest, frame, { ports: ports || [] }),
        channel,
        args,
      );
  },
  ipcSync(engine: any, id: number, frame: WebFrameMain, channel: string, args: unknown[]) {
    const guest = engine.views.get(id);
    return new Promise(set => {
      const event = Object.defineProperty(ipcEvent(guest, frame), "returnValue", { get() {}, set });
      dispatch(guest, frame, "ipc-message-sync", event, channel, args);
    });
  },
  invoke(engine: any, id: number, frame: WebFrameMain, channel: string, args: unknown[]) {
    const guest = engine.views.get(id);
    const target = [frame.ipc, guest.webContents.ipc, ipcMain].find(ipc => ipc._invokeHandlers.has(channel));
    if (!target) throw new Error(`No handler registered for '${channel}'`);
    return target._invokeHandlers.get(channel)(ipcEvent(guest, frame), ...args);
  },
  port: (engine: any, id: number, data: unknown, ports: object[]) =>
    engine.objects.get(id)?.port.postMessage(data, unwrapPorts(ports)),
  portClosed(engine: any, id: number) {
    const carried = engine.objects.get(id);
    engine.objects.delete(id);
    carried?.port.close();
  },
});

export default { Guest, Remote, emitOn };
