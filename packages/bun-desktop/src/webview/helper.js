// The main script of the Electron process that renders the pages which the app does not trust. `wire` is above.
const electron = require("electron");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { app, BrowserWindow, Menu, MessageChannelMain, clipboard, ipcMain, nativeImage, nativeTheme, session } =
  electron;

// 3 and 4 are for the DevTools protocol.
const [COMMANDS, EVENTS, ANSWERS, FRAMES] = [5, 6, 7, 8];
const FRAME_CHANNEL = "bun:desktop:frame";

const views = new Map();
const sessions = new Map();
const objects = new Map();
const ids = new WeakMap();
/** The calls for the windows that a page is about to open. */
const expected = new Map();
const channels = new Set();
let nextId = 1;
const WebFrameMain = value =>
  typeof value.frameTreeNodeId === "number" && typeof value.executeJavaScript === "function";

let isOrphan = false;

/** `app.exit()` returns. */
function exit() {
  if (isOrphan) return;
  isOrphan = true;
  setTimeout(() => process.kill(process.pid, "SIGKILL"), 3000);
  fs.rmSync(settings.temporary, { recursive: true, force: true });
  app.exit(0);
}

function retry(operation) {
  while (true) {
    try {
      return operation();
    } catch (error) {
      if (error.code !== "EAGAIN") {
        exit();
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 0.2);
    }
  }
}

function idOf(object) {
  let id = ids.get(object);
  if (!id) ids.set(object, (id = nextId++));
  objects.set(id, object);
  return id;
}

function describeFrame(frame) {
  if (frame.isDestroyed()) return { id: idOf(frame), detached: true };
  const { url, origin, name, processId, routingId, frameToken, frameTreeNodeId, osProcessId, detached, parent } = frame;
  const view = views.get(ids.get(electron.webContents.fromFrame(frame) ?? {}))?.id;
  const rest = { url, origin, name, processId, routingId, frameToken, frameTreeNodeId, osProcessId, detached };
  return { id: idOf(frame), view, parent: parent && idOf(parent), ...rest };
}

function describeDownload(item) {
  const state = {};
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(item)).concat(Object.keys(item))) {
    if (/^(?:get|is|can|has)[A-Z]/.test(name) && typeof item[name] === "function") state[name] = item[name]();
  }
  return state;
}

function carryPort(port) {
  const id = idOf(port);
  port.on("message", ({ data, ports }) => send("port", id, data, ports));
  port.on("close", () => objects.delete(id) && send("portClosed", id));
  port.start();
  return id;
}

function handleOf(value) {
  if (typeof value === "function") return ["function", idOf(value)];
  if (typeof value !== "object") return;
  if (views.has(ids.get(value))) return ["view", ids.get(value)];
  if (sessions.has(ids.get(value))) return ["session", ids.get(value)];
  if (WebFrameMain(value)) return ["frame", describeFrame(value)];
  if (typeof value.startTask === "function")
    return ["worker", idOf(value), value.scope, value.scriptURL, value.versionId];
  if (typeof value.toPNG === "function") return ["image", value.toPNG()];
  if (typeof value.getReceivedBytes === "function") return ["download", idOf(value), describeDownload(value)];
  if (typeof value.postMessage === "function" && typeof value.start === "function") return ["port", carryPort(value)];
  if (typeof value.getOSProcessId === "function") return ["view", 0];
}

function fromHandle([kind, id]) {
  if (kind === "view") return views.get(id)?.webContents;
  if (kind === "image") return nativeImage.createFromBuffer(id);
  if (kind !== "port") return objects.get(id);
  const { port1, port2 } = new MessageChannelMain();
  ids.set(port1, id);
  carryPort(port1);
  return port2;
}

/** What comes from a page is data, whatever it looks like. */
class FromPage {
  constructor(value) {
    this.bytes = wire.encode(value);
  }
}

function write(fd, bytes) {
  for (let at = 0; at < bytes.length;) at += retry(() => fs.writeSync(fd, bytes, at));
}

function send(...message) {
  if (isOrphan) return;
  const bytes = wire.encode(message, value => (value instanceof FromPage ? ["data", value.bytes] : handleOf(value)));
  write(EVENTS, bytes);
}

function readAnswer() {
  const read = length => {
    const bytes = Buffer.alloc(length);
    for (let at = 0, count; at < length; at += count) {
      count = retry(() => fs.readSync(ANSWERS, bytes, at, length - at, null));
      if (count === 0) throw (exit(), new Error("The app has exited"));
    }
    return bytes;
  };
  return wire.decode(read(read(4).readUInt32LE(0)), fromHandle);
}

/** Blocks until the app has answered. */
function ask(...message) {
  send("ask", ...message);
  return readAnswer();
}

const waiting = new Map();
function request(...message) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    send("request", id, ...message);
  });
}

const preventable = new Set([
  "certificate-error",
  "content-bounds-updated",
  "file-system-access-restricted",
  "login",
  "select-bluetooth-device",
  "select-client-certificate",
  "select-hid-device",
  "select-serial-port",
  "select-usb-device",
  "select-webauthn-account",
  "will-attach-webview",
  "will-download",
  "will-frame-navigate",
  "will-navigate",
  "will-prevent-unload",
  "will-redirect",
]);
const notForwarded =
  /^(?:-.*|paint|cursor-changed|newListener|removeListener|focus|blur|close|destroyed|input-event|before-(?:input|mouse)-event|ipc-message.*|did-create-window)$/;

function forwardEvents(emitter, kind, id, before = () => {}) {
  const { emit } = emitter;
  emitter.emit = function (name, ...args) {
    if (typeof name !== "string" || notForwarded.test(name)) return emit.call(this, name, ...args);
    const [event] = args;
    before(event);
    const isEvent = typeof event?.preventDefault === "function";
    const details = {};
    if (isEvent) {
      for (const key of Object.getOwnPropertyNames(event)) {
        if (!/^(?:sender|preventDefault|defaultPrevented)$/.test(key)) details[key] = event[key];
      }
    }
    const message = ["event", kind, id, name, isEvent && details, args.slice(+isEvent)];
    if (!preventable.has(name)) send(...message);
    else {
      const { isPrevented, calls } = ask(...message);
      for (const call of calls) commands.call(0, ...call);
      if (isPrevented) event.preventDefault();
    }
    return emit.call(this, name, ...args);
  };
}

function sendState(view) {
  const { webContents: it, id } = view;
  if (it.isDestroyed()) return;
  const history = it.navigationHistory;
  const state = {
    url: it.getURL(),
    title: it.getTitle(),
    isLoading: it.isLoading(),
    isLoadingMainFrame: it.isLoadingMainFrame(),
    isWaitingForResponse: it.isWaitingForResponse(),
    isCrashed: it.isCrashed(),
    isCurrentlyAudible: it.isCurrentlyAudible(),
    isDevToolsOpened: it.isDevToolsOpened(),
    zoomLevel: it.getZoomLevel(),
    pid: it.getOSProcessId(),
    entries: history.getAllEntries().map(({ url, title }) => ({ url, title })),
    index: history.getActiveIndex(),
    frames: it.mainFrame.framesInSubtree.map(describeFrame),
    focusedFrame: it.focusedFrame && idOf(it.focusedFrame),
  };
  if (view.isFrame) state.url = state.entries = undefined;
  const text = JSON.stringify(state);
  if (text !== view.state) send("state", id, state);
  view.state = text;
}

function union(a, b) {
  const [x, y] = [Math.min(a.x, b.x), Math.min(a.y, b.y)];
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** One frame is under way at a time. */
function sendFrame(view) {
  const { image, dirty } = view;
  if (view.isPainting || !image) return;
  const { width, height } = image.getSize();
  const all = { x: 0, y: 0, width, height };
  const isResized = width !== view.width || height !== view.height;
  const isInside = dirty.x >= 0 && dirty.y >= 0 && dirty.x + dirty.width <= width && dirty.y + dirty.height <= height;
  const rect = isResized || !isInside ? all : dirty;
  view.image = view.dirty = undefined;
  if (rect.width <= 0 || rect.height <= 0) return;
  const pixels = (rect === all ? image : image.crop(rect)).toBitmap();
  const isSent = view.file === undefined;
  if (isSent) {
    write(FRAMES, new Uint8Array(Uint32Array.of(pixels.length).buffer));
    write(FRAMES, pixels);
  } else fs.writeSync(view.file, pixels, 0, undefined, 0);
  Object.assign(view, { width, height, isPainting: true });
  send("paint", view.id, { width, height, x: rect.x, y: rect.y, w: rect.width, h: rect.height, isSent });
}

const preferencesFor = ({ session: id, preferences, scale, isFrame }) => ({
  // `undefined` would count as false.
  ...Object.fromEntries(Object.entries(preferences).filter(it => it[1] !== undefined)),
  ...(isFrame && { preload: path.join(__dirname, "frame.js"), transparent: true }),
  session: sessions.get(id),
  offscreen: { deviceScaleFactor: scale },
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  webviewTag: false,
  disableHtmlFullscreenWindowResize: true,
});

/** Electron neither sizes what `window.open()` has made offscreen, nor emits "paint" before it has changed its process. */
function driveOpened(view, { width, height, scale }) {
  const { window, webContents } = view;
  window.setContentSize = async (width, height) => {
    BrowserWindow.prototype.setContentSize.call(window, width, height);
    const metrics = { width, height, deviceScaleFactor: scale, mobile: false };
    await inspectorOf(webContents.getOrCreateDevToolsTargetId()).sendCommand(
      "Emulation.setDeviceMetricsOverride",
      metrics,
    );
  };
  const subscribe = () =>
    webContents.beginFrameSubscription(image => {
      view.dirty = { x: 0, y: 0, ...image.getSize() };
      view.image = image;
      sendFrame(view);
    });
  const own = {
    invalidate: subscribe,
    startPainting: subscribe,
    stopPainting: () => webContents.endFrameSubscription(),
  };
  Object.assign(webContents, own);
  webContents.once("paint", () => {
    webContents.endFrameSubscription();
    for (const name in own) delete webContents[name];
  });
  window.setContentSize(width, height).catch(() => {});
  subscribe();
}

function createView(options, webContents) {
  const { id, width, height, file, isFrame, background } = options;
  const isOpened = !!webContents;
  const window = new BrowserWindow({
    show: false,
    frame: false,
    transparent: !background?.startsWith("#ff"),
    backgroundColor: background,
    skipTaskbar: true,
    fullscreenable: false,
    enableLargerThanScreen: true,
    useContentSize: true,
    width,
    height,
    webContents,
    webPreferences: preferencesFor(options),
  });
  const view = { id, window, webContents: window.webContents, isFrame, file: file && fs.openSync(file, "r+") };
  if (file) fs.rmSync(file, { force: true });
  webContents = view.webContents;
  views.set(id, view);
  ids.set(webContents, id);
  webContents.setFrameRate(options.frameRate);
  if (isOpened) driveOpened(view, options);
  webContents.on("paint", (_, dirty, image) => {
    view.dirty = view.dirty ? union(view.dirty, dirty) : dirty;
    view.image = image;
    sendFrame(view);
  });
  webContents.on("cursor-changed", (_, type) => send("cursor", id, type));
  webContents.on("console-message", () => {});
  webContents.on("input-event", () => (view.reachedPage = true));
  webContents.removeAllListeners("-run-dialog");
  webContents.removeAllListeners("-cancel-dialogs");
  webContents.on("-run-dialog", (info, callback) => send("dialog", id, { ...info }, callback));
  webContents.on("-cancel-dialogs", () => send("cancelDialogs", id));
  webContents.once("destroyed", () => {
    views.delete(id);
    if (file) fs.closeSync(view.file);
    send("destroyed", id);
  });
  webContents.setWindowOpenHandler(details => {
    const opened = ask("open", id, details);
    if (!opened) return { action: "deny" };
    commands.expect(opened.id);
    return {
      action: "allow",
      outlivesOpener: true,
      overrideBrowserWindowOptions: { show: false, webPreferences: preferencesFor(opened) },
      createWindow(given) {
        const guest = createView(opened, given.webContents);
        if (!given.webContents) guest.loadURL(details.url).catch(() => {});
        return guest;
      },
    };
  });
  forwardEvents(webContents, "view", id, () => sendState(view));
  send("created", id, webContents.getOrCreateDevToolsTargetId());
  sendState(view);
  const calls = expected.get(id);
  expected.delete(id);
  for (const call of calls ?? []) commands.call(...call);
  return webContents;
}

function handleInWorker(worker, channel) {
  worker.ipc.removeHandler(channel);
  worker.ipc.handle(channel, (_, ...args) => request("invokeFromWorker", worker, channel, new FromPage(args)));
}

const workers = new Set();
function sendWorkers(id, changed) {
  const { serviceWorkers } = sessions.get(id);
  const running = serviceWorkers.getAllRunning();
  for (const versionId of [changed, ...Object.keys(running)]) {
    const worker = versionId !== undefined && serviceWorkers.getWorkerFromVersionID(+versionId);
    if (!worker || workers.has(worker)) continue;
    workers.add(worker);
    for (const channel of channels) handleInWorker(worker, channel);
    worker.ipc.emit = (channel, event, ...args) => {
      if (event?.serviceWorker) send("ipcFromWorker", worker, channel, new FromPage(args), event.ports);
      if (Object.hasOwn(event ?? {}, "returnValue")) event.returnValue = null;
    };
    worker.session = id;
  }
  for (const worker of workers) if (worker.isDestroyed()) workers.delete(worker) && objects.delete(ids.get(worker));
  send(
    "workers",
    id,
    running,
    [...workers].filter(worker => worker.session === id),
  );
}

function serve(id, scheme) {
  return async given => {
    const { url, method, referrer, initiatorOrigin, signal } = given;
    const body = given.body && new Uint8Array(await given.arrayBuffer());
    const response = nextId++;
    signal?.addEventListener("abort", () => send("abort", response));
    const description = { url, method, referrer, initiatorOrigin, body, headers: [...given.headers] };
    const answer = await request("fetch", id, scheme, response, description);
    if (!answer) return Response.error();
    const stream = new ReadableStream({
      async pull(controller) {
        const chunk = await request("pull", response);
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel: () => send("abort", response),
    });
    return new Response(answer.hasBody ? stream : null, answer);
  };
}

/** For the requests of the app, which has applied the cookies and the listeners of the session. */
const networks = new Map();
const loads = new Map();
/** The `redirect` event leaves them out. */
const cookiesOfRedirects = new Map();

function createNetwork(id) {
  const network = session.fromPartition(`network-${id}`);
  network.webRequest.onHeadersReceived(({ url, statusCode, responseHeaders }, answer) => {
    const cookies = Object.entries(responseHeaders).filter(([name]) => /^set-cookie$/i.test(name));
    if (statusCode >= 300 && statusCode < 400) cookiesOfRedirects.set(`${id} ${url}`, Object.fromEntries(cookies));
    answer({});
  });
  return network;
}

function load(id, session, { url, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const options = {
      url,
      method,
      session: networks.get(session),
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
    };
    const sent = Object.fromEntries(headers);
    const site = sent["sec-fetch-site"];
    // Navigations are refused, and CORS would be checked a second time.
    if (sent["sec-fetch-mode"] === "navigate") delete sent["sec-fetch-dest"];
    if (sent["sec-fetch-mode"] === "navigate" || site !== "same-origin") sent["sec-fetch-mode"] = "no-cors";
    for (const name of ["host", "content-length", "accept-encoding", "sec-fetch-site", "sec-fetch-user"])
      delete sent[name];
    if (site === "same-origin") options.origin = new URL(url).origin;
    else if (site && site !== "none") options.origin = sent.origin ?? URL.parse(sent.referer)?.origin ?? "null";
    const request = electron.net.request({
      ...options,
      referrerPolicy: "unsafe-url",
      bypassCustomProtocolHandlers: true,
    });
    const isDecoded = name => /^content-(?:encoding|length)$/i.test(name);
    const pairs = all => Object.entries(all).flatMap(([name, values]) => [values].flat().map(value => [name, value]));
    for (const name in sent) request.setHeader(name, sent[name]);
    loads.set(id, { request });
    request.on("error", reject);
    request.on("close", () => cookiesOfRedirects.delete(`${session} ${url}`));
    request.on("redirect", (status, _, location, received) => {
      const all = pairs({ ...received, ...cookiesOfRedirects.get(`${session} ${url}`) });
      resolve({ status, headers: [...all.filter(([name]) => !/^location$/i.test(name)), ["location", location]] });
      commands.cancel(id);
    });
    request.on("response", response => {
      loads.set(id, { request, chunks: response[Symbol.asyncIterator]() });
      const isEncoded = "content-encoding" in response.headers;
      const received = pairs(response.headers).filter(([name]) => !(isEncoded && isDecoded(name)));
      resolve({ status: response.statusCode, statusText: response.statusMessage, headers: received, hasBody: true });
    });
    request.end(body);
  });
}

function ipcEvent(event) {
  const view = views.get(ids.get(event.sender));
  if (view) sendState(view);
  return view && event.senderFrame && !view.isFrame ? [view.id, event.senderFrame] : undefined;
}

ipcMain.emit = (channel, event, ...args) => {
  if (!event?.sender) return false;
  const view = views.get(ids.get(event.sender));
  if (view?.isFrame && channel === FRAME_CHANNEL && event.senderFrame === view.webContents.mainFrame) {
    sendState(view);
    send("frame", view.id, args[0]);
  }
  const isSync = Object.hasOwn(event, "returnValue");
  const from = ipcEvent(event);
  if (!from) event.returnValue = null;
  else if (!isSync) send("ipc", ...from, channel, new FromPage(args), !event.reply && event.ports);
  else request("ipcSync", ...from, channel, new FromPage(args)).then(value => (event.returnValue = value));
  return true;
};
const urlOf = ({ secure, domain, path }) => `http${secure ? "s" : ""}://${domain.replace(/^\./, "")}${path}`;
const targets = {
  view: id => views.get(id)?.webContents,
  window: id => views.get(id)?.window,
  session: id => sessions.get(id),
  object: id => objects.get(id),
  module: name => ({ app, clipboard, systemPreferences: electron.systemPreferences })[name],
};

let mediaWindow;

/** Those that return a promise hold up the ones after them. */
const inspectors = new Map();

/** Each session is a child of the one that Electron has for the page. */
function inspectorOf(targetId) {
  const inspector = electron.webContents.fromDevToolsTargetId(targetId).debugger;
  if (inspector.isAttached()) return inspector;
  inspector.attach();
  inspector.on("message", (_, method, params, sessionId) => {
    if (method === "Target.attachedToTarget") inspectors.set(params.sessionId, inspector);
    if (method === "Target.detachedFromTarget") inspectors.delete(params.sessionId);
    if (sessionId) send("inspected", JSON.stringify({ method, params, sessionId }));
  });
  inspector.once("detach", () => {
    inspector.removeAllListeners("message");
    for (const [id, it] of inspectors) if (it === inspector) inspectors.delete(id);
  });
  return inspector;
}

async function inspect({ method, params, sessionId }) {
  if (method === "Target.attachToTarget" && !sessionId) return inspectorOf(params.targetId).sendCommand(method, params);
  const inspector = inspectors.get(sessionId ?? params.sessionId);
  if (!inspector) throw new Error("Session with given id not found.");
  return inspector.sendCommand(method, params, sessionId);
}

const commands = {
  inspect(text) {
    const command = JSON.parse(text);
    const reply = outcome => send("inspected", JSON.stringify({ id: command.id, ...outcome }));
    inspect(command).then(
      result => reply({ result }),
      ({ message, code }) => reply({ error: { message, code } }),
    );
  },
  call(reply, kind, id, method, args, holdsUp) {
    if (expected.has(id)) return void expected.get(id).push([...arguments]);
    const names = method.split(".").filter(Boolean);
    const run = async () => {
      let [owner, target] = [undefined, targets[kind](id)];
      if (!target) throw new TypeError("Object has been destroyed");
      for (const name of names) [owner, target] = [target, target[name]];
      if (names.length === 0) objects.delete(id);
      // The `dirty` that it gives is not scaled.
      if (method === "invalidate") views.get(id).width = 0;
      if (kind === "session" && /^set(?:Proxy|SSLConfig)$/.test(method)) await networks.get(id)[method](...args);
      return target.apply(owner, args);
    };
    const settle = (isError, value) => {
      if (views.has(id)) sendState(views.get(id));
      if (!reply) return;
      const isFromPage = /^executeJavaScript/.test(method);
      send("reply", reply, isError, isFromPage ? new FromPage(value) : value, isError && { ...value });
    };
    const done = run().then(
      value => settle(false, value),
      error => settle(true, error),
    );
    if (holdsUp) return done;
  },
  answer(id, isError, value) {
    const { resolve, reject } = waiting.get(id);
    waiting.delete(id);
    if (isError) reject({ toString: () => value });
    else resolve(value);
  },
  async session(id, directory, cookies) {
    const it = directory ? session.fromPath(directory) : session.fromPartition(`memory-${id}`);
    sessions.set(id, it);
    networks.set(id, createNetwork(id));
    ids.set(it, id);
    await it.clearStorageData({ storages: ["cookies"] });
    await commands.cookies(id, cookies, []);
    it.cookies.on("changed", (_, cookie, cause, removed) => send("cookie", id, cookie, cause, removed));
    it.on("will-download", (_, item) => {
      for (const name of ["updated", "done"]) item.on(name, (_, state) => send("download", item, name, state));
      item.once("done", () => objects.delete(ids.get(item)));
    });
    forwardEvents(it, "session", id);
    forwardEvents(it.extensions, "extensions", id);
    forwardEvents(it.serviceWorkers, "serviceWorkers", id, details => sendWorkers(id, details?.versionId));
  },
  cookies(id, stored, removed) {
    const { cookies } = sessions.get(id);
    return Promise.allSettled([
      ...removed.map(cookie => cookies.remove(urlOf(cookie), cookie.name)),
      ...stored.map(({ hostOnly, session: _, domain, ...rest }) =>
        cookies.set({ ...rest, url: urlOf({ ...rest, domain }), domain: hostOnly ? undefined : domain }),
      ),
    ]);
  },
  async sendCookies(reply, id) {
    for (const cookie of await sessions.get(id).cookies.get({})) send("cookie", id, cookie, "inserted", false);
    send("reply", reply, false);
  },
  handler(id, name, isSet, isSync, options) {
    const handler = (...args) => (isSync ? ask : send)("handler", id, name, args);
    sessions.get(id)[name](isSet ? handler : null, options);
    if (name === "setCertificateVerifyProc") networks.get(id)[name](isSet ? handler : null);
  },
  webRequest(id, name, filter) {
    const listener = (details, callback) => {
      const isEmbedder = details.resourceType === "mainFrame" && views.get(ids.get(details.webContents ?? {}))?.isFrame;
      if (isEmbedder) return callback?.({});
      const { webContents, frame } = details;
      send("webRequest", id, name, { ...details, webContents, frame }, callback);
    };
    if (filter) sessions.get(id).webRequest[name]({ urls: ["<all_urls>"], ...filter }, listener);
    else sessions.get(id).webRequest[name](null);
  },
  protocol(id, scheme, isHandled) {
    const { protocol } = sessions.get(id);
    if (protocol.isProtocolHandled(scheme)) protocol.unhandle(scheme);
    if (isHandled) protocol.handle(scheme, serve(id, scheme));
  },
  load(reply, ...args) {
    load(...args).then(
      response => send("reply", reply, false, response),
      error => send("reply", reply, true, error),
    );
  },
  read(reply, id) {
    (loads.get(id)?.chunks.next() ?? Promise.resolve({})).then(
      ({ value }) => send("reply", reply, false, value ?? void loads.delete(id)),
      error => send("reply", reply, true, error),
    );
  },
  cancel(id) {
    loads.get(id)?.request.abort();
    loads.delete(id);
  },
  expect: id => void (views.has(id) || expected.has(id) || expected.set(id, [])),
  startTask: (worker, id) => void objects.set(id, objects.get(worker)?.startTask()),
  handle(given) {
    for (const channel of given) {
      if (channels.has(channel)) continue;
      channels.add(channel);
      for (const worker of workers) handleInWorker(worker, channel);
      ipcMain.handle(channel, (event, ...args) => {
        const from = ipcEvent(event);
        if (!from) throw new Error(`No handler registered for '${channel}'`);
        return request("invoke", ...from, channel, new FromPage(args));
      });
    }
  },
  theme: source => void (nativeTheme.themeSource = source),
  create: options => void createView(options),
  /** An empty page that may use the microphone. */
  async media(reply) {
    const it = session.fromPartition("persist:media");
    it.setPermissionCheckHandler(
      (_, name, __, { mediaType }) => name === "speaker-selection" || (name === "media" && mediaType === "audio"),
    );
    it.setPermissionRequestHandler((_, name, answer, { mediaTypes }) =>
      answer(name === "media" && !mediaTypes.includes("video")),
    );
    if (!it.protocol.isProtocolHandled("https"))
      it.protocol.handle("https", () => new Response("", { headers: { "content-type": "text/html" } }));
    const webPreferences = { session: it, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" };
    mediaWindow?.destroy();
    mediaWindow = new BrowserWindow({ show: false, width: 1, height: 1, webPreferences });
    await mediaWindow.loadURL("https://media.invalid/");
    send("reply", reply, false, mediaWindow.webContents.getOrCreateDevToolsTargetId());
  },
  destroy: id => void (expected.delete(id) || views.get(id)?.window.destroy()),
  painted(id) {
    const view = views.get(id);
    if (!view) return;
    view.isPainting = false;
    sendFrame(view);
  },
  /** For the list of a `<select>` and the like. The reply says whether the mouse was over it. */
  popupInput(reply, id, event) {
    const view = views.get(id);
    if (!view) return;
    view.reachedPage = false;
    view.webContents.sendInputEvent(event);
    send("reply", reply, false, !view.reachedPage);
  },
  frame: (id, bytes) => views.get(id)?.webContents.send(FRAME_CHANNEL, bytes),
  port: (id, data, ports) => objects.get(id)?.postMessage(data, ports),
  closePort(id) {
    const port = objects.get(id);
    objects.delete(id);
    port?.close();
  },
  release: id => void objects.delete(id),
};

const settings = readAnswer();
app.setName(settings.name);
app.setPath("userData", settings.directory);
if (settings.userAgent) app.userAgentFallback = settings.userAgent;
app.enableSandbox();
if (process.platform === "darwin") app.setActivationPolicy("accessory");
electron.protocol.registerSchemesAsPrivileged(settings.schemes);
Menu.setApplicationMenu(null);
app.on("window-all-closed", () => {});
app.on("session-created", it => it.setSpellCheckerDictionaryDownloadURL("data:,"));
process.on("uncaughtException", error => isOrphan || console.error(error));

app.whenReady().then(() => {
  let queue;
  const run = ([name, ...args]) => {
    const result = commands[name](...args);
    return result instanceof Promise ? result.catch(console.error) : undefined;
  };
  const enqueue = message => {
    const step = (queue = queue ? queue.then(() => run(message)) : run(message));
    step?.then(() => queue === step && (queue = undefined));
  };
  new net.Socket({ fd: COMMANDS, readable: true, writable: false })
    .on(
      "data",
      wire.splitter(bytes => enqueue(wire.decode(bytes, fromHandle))),
    )
    .on("close", exit);
});
