// What Electron has beyond the modules of bun:desktop.
const EventEmitter = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const native = require("internal/desktop/native");
const { api, settings } = require("internal/desktop/system");
const menus = require("internal/desktop/menu");
const { Event } = require("internal/desktop/app");
const { inert, properties, unsupported } = require("internal/desktop/electron/stubs");

const { nativeImage, nativeTheme, powerSaveBlocker, screen, shell, systemPreferences } = api;
const isMac = process.platform === "darwin";
let macVersion: string | undefined;
const readMacVersion = () =>
  /<key>ProductVersion<\/key>\s*<string>([^<]+)/.exec(
    fs.readFileSync("/System/Library/CoreServices/SystemVersion.plist", "latin1"),
  )?.[1] ?? "";

class ClipboardItem {
  #items;

  constructor(items: Record<string, unknown>) {
    this.#items = { ...items };
  }

  get types() {
    return Object.keys(this.#items);
  }

  async getType(type: string) {
    if (!(type in this.#items)) throw new Error(`The type '${type}' was not found in the ClipboardItem`);
    const value = await this.#items[type];
    return typeof value === "string" ? new Blob([value], { type }) : value;
  }
}

function createClipboard(kind?: string) {
  const system = api.clipboard;
  return {
    clear: () => system.clear(kind),
    has: async (type: string) => system.availableFormats(kind).includes(type),
    readText: async () => system.readText(kind),
    writeText: async (text: string) => system.writeText(text, kind),
    async read() {
      const read = {
        "text/plain": () => system.readText(kind),
        "text/html": () => system.readHTML(kind),
        "text/uri-list": () =>
          system
            .readFilePaths(kind)
            .map(file => Bun.pathToFileURL(file).href)
            .join("\r\n"),
        "image/png": () => new Blob([system.readImage(kind).toPNG()], { type: "image/png" }),
      };
      const types = system.availableFormats(kind);
      return types.length === 0 ? [] : [new ClipboardItem(Object.fromEntries(types.map(type => [type, read[type]()])))];
    },
    async write([item]: ClipboardItem[]) {
      const image = item?.types.find(type => type.startsWith("image/"));
      if (image) return system.writeImage(await ((await item.getType(image)) as Blob).bytes(), kind);
      const get = async (type: string) =>
        item?.types.includes(type) ? ((await item.getType(type)) as Blob).text() : undefined;
      system.write(
        { text: (await get("text/plain")) ?? (await get("text/uri-list")), html: await get("text/html") },
        kind,
      );
    },
  };
}
const clipboard = {
  ...createClipboard(),
  selection: process.platform === "linux" ? createClipboard("selection") : undefined,
};

function encodePng(bgra: Uint8Array, width: number, height: number) {
  const { crc32, deflateSync } = require("node:zlib");
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0, from = 0, to = 0; y < height; y++) {
    to++;
    for (let x = 0; x < width; x++, from += 4, to += 4) {
      const alpha = bgra[from + 3];
      const scale = alpha === 0 ? 0 : 255 / alpha;
      rows[to] = Math.min(Math.round(bgra[from + 2] * scale), 255);
      rows[to + 1] = Math.min(Math.round(bgra[from + 1] * scale), 255);
      rows[to + 2] = Math.min(Math.round(bgra[from] * scale), 255);
      rows[to + 3] = alpha;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const result = Buffer.concat([Buffer.alloc(4), Buffer.from(type), data, Buffer.alloc(4)]);
    result.writeUInt32BE(data.length);
    result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
    return result;
  };
  const header = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 8, 6, 0, 0, 0]);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 1 }) as any),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const { createFromBuffer } = nativeImage;
inert(nativeImage, {
  createFromBitmap: (bitmap: Uint8Array, { width, height }: any) => createFromBuffer(encodePng(bitmap, width, height)),
  createFromNamedImage: nativeImage.createEmpty,
  async createThumbnailFromPath(file: string, { width }: { width: number }) {
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) throw new Error("Unable to retrieve thumbnail preview image for the given path");
    return image.resize({ width: Math.min(width, image.getSize().width) });
  },
});
const imagePrototype = Object.getPrototypeOf(nativeImage.createEmpty());
inert(imagePrototype, {
  addRepresentation: undefined,
  getScaleFactors(this: any) {
    return this.isEmpty() ? [] : [1];
  },
  toBitmap(this: any) {
    if (this.isEmpty()) return Buffer.alloc(0);
    const pixels = native.takeBlob(native.ask("image", { blob: native.putBlob(this.toPNG()), format: "rgba" }));
    for (let i = 0; i < pixels.length; i += 4) {
      const [red, alpha] = [pixels[i], pixels[i + 3] / 255];
      pixels[i] = Math.round(pixels[i + 2] * alpha);
      pixels[i + 1] = Math.round(pixels[i + 1] * alpha);
      pixels[i + 2] = Math.round(red * alpha);
    }
    return pixels;
  },
  getBitmap(this: any) {
    return this.toBitmap();
  },
});
properties(imagePrototype, { isMacTemplateImage: ["isTemplateImage", "setTemplateImage"] });

const { getAllDisplays } = screen;
function displays() {
  const found = getAllDisplays();
  if (found.length > 0) return found;
  const size = { width: 1280, height: 800 };
  const bounds = { x: 0, y: 0, ...size };
  return [{ id: 1, bounds, workArea: bounds, size, workAreaSize: size }];
}
screen.getAllDisplays = () =>
  displays().map(display => ({
    accelerometerSupport: "unknown",
    colorDepth: 24,
    colorSpace: "{primaries:BT709, transfer:SRGB, matrix:RGB, range:FULL}",
    depthPerComponent: 8,
    detected: true,
    displayFrequency: 60,
    internal: false,
    label: "",
    maximumCursorSize: { width: 0, height: 0 },
    monochrome: false,
    nativeOrigin: { x: display.bounds.x, y: display.bounds.y },
    rotation: 0,
    scaleFactor: 1,
    touchSupport: "unknown",
    ...display,
  }));
function scaled(value: any, power: number) {
  const scale = screen.getDisplayNearestPoint(value).scaleFactor ** power;
  return Object.fromEntries(Object.entries(value).map(([name, number]: any) => [name, Math.round(number * scale)]));
}
if (!isMac) {
  inert(screen, {
    dipToScreenPoint: (point: object) => scaled(point, 1),
    dipToScreenRect: (_: unknown, rectangle: object) => scaled(rectangle, 1),
    screenToDipPoint: (point: object) => scaled(point, -1),
    screenToDipRect: (_: unknown, rectangle: object) => scaled(rectangle, -1),
  });
}

Object.defineProperties(nativeTheme, {
  inForcedColorsMode: { value: false },
  prefersReducedTransparency: { get: () => !!settings().reducedTransparency },
  shouldUseDarkColorsForSystemIntegratedUI: { get: () => nativeTheme.shouldUseDarkColors },
  shouldUseHighContrastColors: { get: () => !!settings().moreContrast },
  shouldUseInvertedColorScheme: { get: () => !!settings().invertedColors },
});

const { start } = powerSaveBlocker;
powerSaveBlocker.start = () => start("prevent-app-suspension");

inert(shell, {
  readShortcutLink: unsupported.throws("readShortcutLink"),
  writeShortcutLink: false,
});

const observed = new Set<string>();
const subscriptions = new Map<number, [name: string, callback: Function]>();
let lastSubscription = 0;
function subscribe(center: string, name: string, callback: Function) {
  if (!observed.$has(name)) native.send("observe", [center, name]);
  observed.$add(name);
  subscriptions.$set(++lastSubscription, [name, callback]);
  return lastSubscription;
}
const unsubscribe = (id: number) => void subscriptions.$delete(id);
require("internal/desktop/app").systemEvents.notification = (name: string) => {
  for (const [wanted, callback] of Array.from(subscriptions.values())) if (wanted === name) callback(name, {}, "");
};

const sessionEvents = {
  __proto__: null,
  "lock-screen": ["distributed", "com.apple.screenIsLocked"],
  "unlock-screen": ["distributed", "com.apple.screenIsUnlocked"],
  "user-did-become-active": ["workspace", "NSWorkspaceSessionDidBecomeActiveNotification"],
  "user-did-resign-active": ["workspace", "NSWorkspaceSessionDidResignActiveNotification"],
  "shutdown": ["workspace", "NSWorkspaceWillPowerOffNotification"],
};
if (isMac) {
  api.powerMonitor.on("newListener", (event: string) => {
    const source = sessionEvents[event];
    delete sessionEvents[event];
    if (source) subscribe(source[0], source[1], () => api.powerMonitor.emit(event, new Event()));
  });
}

Object.setPrototypeOf(systemPreferences, new EventEmitter());
inert(systemPreferences, {
  askForMediaAccess: async (type: string) => isMac && require("internal/desktop/webview/media").askForAccess(type),
  canPromptTouchID: false,
  getAccentColor: () => settings().accent?.toString(16).padStart(8, "0") ?? "",
  getColor: unsupported.throws("getColor"),
  getMediaAccessStatus: (type: string) =>
    isMac ? (require("internal/desktop/webview/media").accessTo(type) ?? "not-determined") : "granted",
  ...(isMac && {
    getUserDefault(key: string, type: string) {
      const value = native.ask("defaults.get", [key]);
      if (type === "boolean") return value === true || +value > 0 || /^(?:yes|true)$/i.test(value);
      if (type === "array") return $isArray(value) ? value : [];
      if (type === "dictionary") return $isObject(value) && !$isArray(value) ? value : {};
      return type === "string" || type === "url" ? String(value ?? "") : +value || 0;
    },
    registerDefaults(defaults: object) {
      for (const entry of Object.entries(defaults)) native.ask("defaults.register", entry);
    },
    removeUserDefault: (key: string) => void native.ask("defaults.remove", [key]),
    setUserDefault: (key: string, _type: string, value: unknown) => void native.ask("defaults.set", [key, value]),
    subscribeLocalNotification: (name: string, callback: Function) => subscribe("local", name, callback),
    subscribeNotification: (name: string, callback: Function) => subscribe("distributed", name, callback),
    subscribeWorkspaceNotification: (name: string, callback: Function) => subscribe("workspace", name, callback),
    unsubscribeLocalNotification: unsubscribe,
    unsubscribeNotification: unsubscribe,
    unsubscribeWorkspaceNotification: unsubscribe,
  }),
  promptTouchID: unsupported.rejects("promptTouchID"),
});

inert(api.globalShortcut, { isSuspended: false, setSuspended: undefined });

class Notification extends api.Notification {
  constructor(options: any = {}) {
    super(options);
    const {
      id = crypto.randomUUID(),
      groupId = "",
      silent = false,
      sound = "",
      urgency = "normal",
      hasReply = false,
    } = options;
    Object.assign(this, {
      id,
      groupId,
      silent,
      sound,
      urgency,
      hasReply,
      timeoutType: options.timeoutType ?? "default",
    });
  }

  show() {
    try {
      super.show();
    } catch (error: any) {
      this.emit("failed", new (require("internal/desktop/app").Event)(), error.message);
    }
  }
}
inert(Notification, { getHistory: async () => [], remove: undefined, removeAll: undefined, removeGroup: undefined });

inert(api.Tray.prototype, {
  displayBalloon({ title, content }: any) {
    new Notification({ title, body: content }).show();
  },
  focus: undefined,
  getGUID: null,
  removeBalloon: undefined,
  setIgnoreDoubleClickEvents: undefined,
  setPressedImage: undefined,
});

/** A desktop that has no tray shows no icon. */
class Tray extends api.Tray {
  constructor(image: unknown) {
    try {
      super(image as any);
    } catch {
      let isDestroyed = false;
      const tray = inert(new EventEmitter(), {
        destroy: () => void (isDestroyed = true),
        getBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }),
        getTitle: "",
        isDestroyed: () => isDestroyed,
      });
      for (const name of Object.getOwnPropertyNames(api.Tray.prototype)) inert(tray, { [name]: undefined });
      return tray as any;
    }
  }
}

const onPage = (label: string, method: string, accelerator?: string) => ({
  label,
  accelerator,
  click: (_: unknown, window: any) => window && require("internal/desktop/electron/views").target(window)?.[method](),
});
const moreRoles = {
  __proto__: null,
  delete: onPage("Delete", "delete"),
  forcereload: onPage("Force Reload", "reloadIgnoringCache", "Shift+CmdOrCtrl+R"),
  pasteandmatchstyle: onPage("Paste and Match Style", "pasteAndMatchStyle", isMac ? "Cmd+Alt+Shift+V" : "Ctrl+Shift+V"),
  reload: onPage("Reload", "reload", "CmdOrCtrl+R"),
  startspeaking: { label: "Start Speaking", enabled: false },
  stopspeaking: { label: "Stop Speaking", enabled: false },
  toggledevtools: onPage("Toggle Developer Tools", "openDevTools", isMac ? "Alt+Cmd+I" : "Ctrl+Shift+I"),
  togglespellchecker: { label: "Check Spelling While Typing", enabled: false },
};

class MenuItem extends menus.MenuItem {
  constructor(options: any) {
    const more = moreRoles[options.role?.toLowerCase()];
    const submenu = $isArray(options.submenu) ? Menu.buildFromTemplate(options.submenu) : options.submenu;
    const own = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
    super({ ...more, ...own, submenu, ...(more && { role: undefined, click: more.click }) });
    for (const name in options) if (!(name in this)) this[name] = options[name];
    (this as any).registerAccelerator = options.registerAccelerator ?? true;
  }
}

/** `before` and `after` */
function order(items: any[]) {
  const result = [...items];
  for (const item of items) {
    for (const [ids = [], offset] of [
      [item.before, 0],
      [item.after, 1],
    ]) {
      const anchor = result.find(other => other !== item && ids.includes(other.id));
      if (!anchor) continue;
      result.splice(result.indexOf(item), 1);
      result.splice(result.indexOf(anchor) + offset, 0, item);
    }
  }
  return result;
}

class Menu extends menus.Menu {
  static buildFromTemplate(template: any[]) {
    if (!$isArray(template)) throw new TypeError("Invalid template for Menu: Menu template must be an array");
    const isValid = item =>
      item && typeof item === "object" && ("label" in item || "role" in item || item.type === "separator");
    if (!template.every(isValid)) {
      throw new TypeError("Invalid template for MenuItem: must have at least one of label, role or type");
    }
    const isSeparator = item => item.type === "separator";
    const items = order(template).filter((item, index, all) => {
      if (!isSeparator(item)) return true;
      const before = all.slice(0, index).findLast(other => other.visible !== false);
      return (
        before && !isSeparator(before) && all.slice(index).some(other => other.visible !== false && !isSeparator(other))
      );
    });
    const menu = new Menu();
    for (const item of items) menu.append(item instanceof menus.MenuItem ? item : new MenuItem(item));
    return menu;
  }

  static sendActionToFirstResponder(action: string) {
    if (!isMac) return;
    const window = require("internal/desktop/window").Window.getFocusedWindow();
    const edit = /^(undo|redo|cut|copy|paste|delete|selectAll):$/.exec(action)?.[1];
    if (window && edit) window[edit]();
    else if (window && action === "performClose:") window.close();
    else native.send("sendAction", action);
  }
}

const parameters: Record<string, string> = {};
let uploads = false;
const crashReporter = {
  start(options: any = {}) {
    Object.assign(parameters, options.extra);
    uploads = options.uploadToServer ?? true;
  },
  addExtraParameter: (name: string, value: string) => void (parameters[name] = value),
  removeExtraParameter: (name: string) => void delete parameters[name],
  getParameters: () => ({ ...parameters }),
  getLastCrashReport: () => null,
  getUploadedReports: () => [],
  getUploadToServer: () => uploads,
  setUploadToServer: (value: boolean) => void (uploads = value),
};

let feed = "";
const autoUpdater = Object.assign(new EventEmitter(), {
  setFeedURL: (options: any) => void (feed = options.url ?? options),
  getFeedURL: () => feed,
  checkForUpdates() {
    const error = unsupported.error("autoUpdater");
    setImmediate(() => autoUpdater.emit("error", error, error.message));
  },
  quitAndInstall: () => autoUpdater.checkForUpdates(),
});

let cpuBefore = { time: performance.now(), ...process.cpuUsage() };
const kilobytes = (bytes: number) => Math.round(bytes / 1024);
const processMethods = {
  crash: () => process.abort(),
  hang() {
    while (true);
  },
  getBlinkMemoryInfo: () => ({ allocated: 0, total: 0 }),
  getCPUUsage() {
    const now = { time: performance.now(), ...process.cpuUsage() };
    const used = (now.user + now.system - cpuBefore.user - cpuBefore.system) / 1000;
    const percentCPUUsage = (100 * used) / (now.time - cpuBefore.time || 1) / os.availableParallelism();
    cpuBefore = now;
    return { percentCPUUsage, cumulativeCPUUsage: (now.user + now.system) / 1e6, idleWakeupsPerSecond: 0 };
  },
  getCreationTime: () => Math.floor(performance.timeOrigin),
  getHeapStatistics() {
    const { heapTotal, heapUsed } = process.memoryUsage();
    return {
      totalHeapSize: kilobytes(heapTotal),
      totalHeapSizeExecutable: 0,
      totalPhysicalSize: kilobytes(heapTotal),
      totalAvailableSize: kilobytes(os.freemem()),
      usedHeapSize: kilobytes(heapUsed),
      heapSizeLimit: kilobytes(os.totalmem()),
      mallocedMemory: 0,
      peakMallocedMemory: 0,
      doesZapGarbage: false,
    };
  },
  async getProcessMemoryInfo() {
    const residentSet = kilobytes(process.memoryUsage.rss());
    return { residentSet, private: residentSet, shared: 0 };
  },
  getSystemMemoryInfo() {
    const result = { total: kilobytes(os.totalmem()), free: kilobytes(os.freemem()) };
    if (process.platform !== "linux") return { ...result, swapTotal: 0, swapFree: 0 };
    const text = fs.readFileSync("/proc/meminfo", "latin1");
    const read = (name: string) => +(new RegExp(`^${name}:\\s+(\\d+)`, "m").exec(text)?.[1] ?? 0);
    return {
      ...result,
      free: read("MemFree"),
      available: read("MemAvailable"),
      swapTotal: read("SwapTotal"),
      swapFree: read("SwapFree"),
    };
  },
  getSystemVersion: () => (isMac ? (macVersion ??= readMacVersion()) : os.release()),
  setFdLimit() {},
  takeHeapSnapshot: (file: string) => !!require("node:v8").writeHeapSnapshot(file, undefined),
};

export default {
  clipboard,
  processMethods,
  exports: {
    ClipboardItem,
    Menu,
    MenuItem,
    Notification,
    ShareMenu: unsupported.constructs("ShareMenu"),
    TouchBar: unsupported.constructs("TouchBar"),
    Tray,
    autoUpdater,
    clipboard,
    contentTracing: {
      getCategories: async () => [],
      getTraceBufferUsage: async () => ({ value: 0, percentage: 0 }),
      startRecording: unsupported.rejects("contentTracing"),
      stopRecording: unsupported.rejects("contentTracing"),
    },
    crashReporter,
    desktopCapturer: { getSources: unsupported.rejects("desktopCapturer") },
    dialog: inert(
      { ...require("internal/desktop/dialog") },
      { showCertificateTrustDialog: unsupported.rejects("showCertificateTrustDialog") },
    ),
    globalShortcut: api.globalShortcut,
    inAppPurchase: inert(new EventEmitter(), { canMakePayments: false }),
    nativeImage,
    nativeTheme,
    powerMonitor: api.powerMonitor,
    powerSaveBlocker,
    pushNotifications: inert(new EventEmitter(), {
      registerForAPNSNotifications: unsupported.rejects("pushNotifications"),
      unregisterForAPNSNotifications: undefined,
    }),
    safeStorage: require("internal/desktop/electron/os_crypt").safeStorage,
    screen,
    shell,
    systemPreferences,
  },
};
