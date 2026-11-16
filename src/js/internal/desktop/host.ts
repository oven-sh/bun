// The pages of the main realm, and what they get from outside.
const { createPage } = require("internal/desktop/dom/page");

type Page = ReturnType<typeof createPage>;

const system = () => require("internal/desktop/system").api;

async function fetchResource(url: string) {
  const file = url.startsWith("file:") ? Bun.file(new URL(url)) : null;
  if (file !== null) return { ok: true, status: 200, url, mime: file.type.split(";")[0], bytes: await file.bytes() };
  const response = await fetch(url);
  const mime = (response.headers.get("content-type") ?? "").split(";")[0];
  return { ok: response.ok, status: response.status, url: response.url || url, mime, bytes: await response.bytes() };
}

function fileFromPath(path: string) {
  const fs = require("node:fs");
  const stat = fs.statSync(path);
  const options = { type: Bun.file(path).type.split(";")[0], lastModified: Math.floor(stat.mtimeMs) };
  return new File(stat.isFile() ? [fs.readFileSync(path)] : [], require("node:path").basename(path), options);
}

const isExternal = /^(?:https?|mailto):/;

/** `internal/desktop/web/messaging`, for the classes of this realm. */
const messaging = {
  isPort: (value: unknown) => value instanceof MessagePort,
  adopt: (port: MessagePort) => port,
  release: (port: MessagePort) => port,
  hide() {},
  transferList: (options: any) => [...(options?.transfer ?? options?.[Symbol.iterator]?.() ?? [])],
  cloneInto: (_: unknown, message: unknown, transfer: Bun.Transferable[]) =>
    structuredClone([transfer, message], { transfer }),
  messageEvent: (type: string, data: unknown, origin: string, source: unknown, ports: MessagePort[]) =>
    Object.defineProperty(new MessageEvent(type, { data, origin, ports } as any), "source", { value: source }),
  inbox: {
    deliver: (target: EventTarget, [list, data]: [object[], unknown], origin: string, source: unknown) =>
      target.dispatchEvent(
        messaging.messageEvent("message", data, origin, source, list.filter(messaging.isPort) as any),
      ),
  },
};

let localStorage: object | undefined;

function openLocalStorage() {
  const fs = require("node:fs");
  const directory = require("internal/desktop/app").app.getPath("userData");
  const file = require("node:path").join(directory, "localStorage.json");
  let items = new Map<string, string>();
  let isDirty = false;
  try {
    items = new Map(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {}
  const save = () => {
    if (!isDirty) return;
    isDirty = false;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify([...items]));
    fs.renameSync(file + ".tmp", file);
  };
  const changed = () => {
    if (!isDirty) setTimeout(save, 500).unref();
    isDirty = true;
  };
  process.on("exit", save);
  return {
    keys: () => items.keys(),
    get: (key: string) => items.$get(key),
    set: (key: string, value: string) => (items.$set(key, value), changed()),
    remove: (key: string) => items.$delete(key) && changed(),
    clear: () => (items.$clear(), changed()),
  };
}

/** Scripts run in the global scope, so only the page that has the global object runs them. */
const evaluate = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmEvaluate", 2);
const importModule = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmImport", 1);
const scripts = {
  runClassicScript(source: string, url: string, element?: { inline?: boolean }) {
    if (element?.inline || isOfApp(url)) evaluate(source, url);
  },
  async prepareModule(url: string) {
    if (!isOfApp(url)) throw new TypeError(`Refused to run ${url}, which is not a file of the app`);
    return () => void importModule(url).catch(reportError);
  },
  async prepareInlineModule(source: string) {
    return () => {
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      importModule(url)
        .catch(reportError)
        .finally(() => URL.revokeObjectURL(url));
    };
  },
  messaging: () => messaging,
};

const policy = () => require("internal/desktop/electron/policy");
/** The directories of the markup that the app has loaded. */
const loadedFrom = new Set<string>();

function willLoad(url: string) {
  if (url.startsWith("file:")) loadedFrom.$add(new URL(".", url).href);
}

function create(host: any, options?: object): Page {
  host.allowsInline = (kind: string, text: string) => kind !== "script" || page.cameWith(text);
  host.allowsInlineScript = (source: string) => page.cameWith(source);
  const page = createPage(host, options);
  page.parseHTML("<!doctype html>");
  return page;
}

function isOfApp(url: string) {
  const appPath = require("internal/desktop/app").app.getAppPath();
  return policy().isTrusted(url, appPath) || [...loadedFrom].some(directory => url.startsWith(directory));
}

function message(window: any, kind: string, text: string) {
  if (kind === "prompt") throw new Error("prompt() is not supported");
  const buttons = kind === "confirm" ? ["OK", "Cancel"] : ["OK"];
  const options = { message: text, buttons, cancelId: buttons.length - 1 };
  return require("internal/desktop/dialog").showMessageBoxSync(window, options) === 0;
}

function hostFor(window: any, surface: number) {
  const { Window } = require("internal/desktop/window");
  const { Event, app } = require("internal/desktop/app");
  return {
    native: require("internal/desktop/native"),
    surface,
    messaging: scripts.messaging,
    fetchResource,
    fileFromPath,
    createRemoteFrame(element: object) {
      return require("internal/desktop/webview/frames").createIn(window, surface, this, element);
    },
    get clipboard() {
      return system().clipboard;
    },
    storage: (kind: string) => (kind === "local" ? (localStorage ??= openLocalStorage()) : undefined),
    environment() {
      const bounds = window.getBounds();
      return {
        dark: system().nativeTheme.shouldUseDarkColors,
        reducedMotion: system().systemPreferences.getAnimationSettings().prefersReducedMotion,
        screen: system().screen.getDisplayMatching(bounds),
        windowBounds: bounds,
        zoom: window.getZoomFactor(),
        active: window.isFocused(),
        visible:
          window.isVisible() && !window.isMinimized() && !window[require("internal/desktop/window").kIsOccluded](),
        ...require("internal/desktop/system").settings(),
        fullscreen: window.isFullScreen(),
        transparent: window.hasBackground(),
        languages: app.getPreferredSystemLanguages(),
      };
    },
    navigate(url: string) {
      const event = new Event();
      window.emit("will-navigate", event, url);
      if (!event.defaultPrevented && isExternal.test(url)) system().shell.openExternal(url);
    },
    open(url: string, _target: string, features: string) {
      if (url !== "about:blank") return void this.navigate(url);
      const values = new URLSearchParams(features.replace(/\s*,\s*/g, "&"));
      const size = (name: string) => +values.get(name)! || undefined;
      return new Window({ width: size("width"), height: size("height"), x: size("left"), y: size("top") }).window;
    },
    async pickFiles({ multiple, directory, accept }: { multiple: boolean; directory: boolean; accept: string[] }) {
      const extensions = accept.filter(it => it[0] === ".").map(it => it.slice(1));
      const { filePaths } = await require("internal/desktop/dialog").showOpenDialog(window, {
        properties: [directory ? "openDirectory" : "openFile", ...(multiple ? ["multiSelections"] : [])],
        filters: extensions.length > 0 && extensions.length === accept.length ? [{ name: "Files", extensions }] : [],
      });
      return filePaths;
    },
    dialog: (kind: string, text: string) => message(window, kind, text),
    close: () => setImmediate(() => window.close()),
    titleChanged: (title: string) => window.setTitle(title),
    contextMenu: (params: object) => window.emit("context-menu", new Event(), params),
    checksSpelling: process.platform === "darwin" ? () => true : undefined,
    unhandledKey: (event: object) => window.handleShortcut(event),
    fullscreen: (on: boolean) => window.setFullScreen(on),
    focusWindow: () => window.focus(),
    moveWindow: (bounds: object) => window.setBounds(bounds),
    loaded: (stage: string) => window.emit(stage === "load" ? "did-finish-load" : stage),
    firstPaint: () => setImmediate(() => window.isDestroyed() || window.emit("ready-to-show")),
  };
}

/** The page of the global object, until a window shows it. */
let unshown: { page: Page; host: object } | undefined;

function installGlobals() {
  const host = { native: null, surface: 0, fontScope: 0x7fffffff, fetchResource, fileFromPath, ...scripts };
  const page = create(host, { global: globalThis });
  unshown = { page, host };
  return page;
}

function pageFor(window: any, surface: number, mayBeGlobal: boolean): Page {
  const host = hostFor(window, surface);
  if (unshown === undefined || !mayBeGlobal) return create(host);
  const { page } = unshown;
  Object.defineProperties(unshown.host, Object.getOwnPropertyDescriptors(host));
  unshown = undefined;
  page.attach(surface);
  return page;
}

export default { installGlobals, pageFor, willLoad };
