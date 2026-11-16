const EventEmitter = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const native = require("internal/desktop/native");
const accelerator = require("internal/desktop/accelerator");
const { app, theme, Event, systemEvents } = require("internal/desktop/app");

type Rectangle = { x: number; y: number; width: number; height: number };

const paths = new WeakMap<NativeImage, string>();

class NativeImage {
  #bytes: Buffer;
  #size: { width: number; height: number } | undefined;
  #template: boolean;

  constructor(bytes: Buffer = Buffer.alloc(0), template = false) {
    this.#bytes = bytes;
    this.#template = template;
  }

  #convert(options: object) {
    return native.ask("image", { blob: native.putBlob(this.#bytes), ...options });
  }

  #encode(options: object): Buffer {
    return this.isEmpty() ? Buffer.alloc(0) : native.takeBlob(this.#convert(options));
  }

  isEmpty() {
    if (this.#bytes.length === 0) return true;
    try {
      this.#size ??= this.#convert({});
      return false;
    } catch {
      this.#bytes = Buffer.alloc(0);
      return true;
    }
  }

  getSize() {
    return this.isEmpty() ? { width: 0, height: 0 } : { ...this.#size! };
  }

  getAspectRatio() {
    const { width, height } = this.getSize();
    return height ? width / height : 1;
  }

  toPNG() {
    return this.#bytes.toString("latin1", 1, 4) === "PNG" ? Buffer.from(this.#bytes) : this.#encode({ format: "png" });
  }

  toJPEG(quality: number) {
    return this.#encode({ format: "jpeg", quality });
  }

  toDataURL() {
    return "data:image/png;base64," + this.toPNG().toString("base64");
  }

  resize({ width, height }: { width?: number; height?: number }) {
    const ratio = this.getAspectRatio();
    if (width === undefined && height === undefined) return this;
    const resize = [Math.round(width ?? height! * ratio), Math.round(height ?? width! / ratio)];
    return new NativeImage(this.#encode({ format: "png", resize }), this.#template);
  }

  crop({ x, y, width, height }: Rectangle) {
    return new NativeImage(this.#encode({ format: "png", crop: [x, y, width, height] }), this.#template);
  }

  isTemplateImage() {
    return this.#template;
  }

  setTemplateImage(template: boolean) {
    this.#template = !!template;
  }
}

const nativeImage = {
  createEmpty: () => new NativeImage(),
  createFromBuffer: (bytes: Uint8Array) => new NativeImage(Buffer.from(bytes)),
  createFromDataURL: (url: string) => new NativeImage(Buffer.from(url.slice(url.indexOf(",") + 1), "base64")),
  createFromPath(file: string) {
    try {
      const image = new NativeImage(fs.readFileSync(file), /Template(?:@\dx)?\.\w+$/.test(file));
      paths.set(image, file);
      return image;
    } catch {
      return new NativeImage();
    }
  },
};

function toImage(image: NativeImage | Uint8Array | string): NativeImage {
  if (image instanceof NativeImage) return image;
  return typeof image === "string" ? nativeImage.createFromPath(image) : nativeImage.createFromBuffer(image);
}

const imageBytes = (image: NativeImage | Uint8Array | string) => toImage(image).toPNG();

/** For what the platform scales to a size that it knows. */
function sharpestBytes(image: NativeImage) {
  const sharper = process.platform === "darwin" ? paths.get(image)?.replace(/(?<!@\dx)(\.\w+)$/, "@2x$1") : undefined;
  return sharper && fs.existsSync(sharper) ? fs.readFileSync(sharper) : image.toPNG();
}

/** Without a display, there is only this one. */
let ownClipboard: { text?: string; html?: string; image?: Buffer } = {};

function writeClipboard(contents: typeof ownClipboard, type?: string) {
  const selection = type === "selection";
  if (!native.options.headless) {
    native.ask("writeClipboard", { ...contents, image: contents.image && native.putBlob(contents.image), selection });
  } else if (!selection) ownClipboard = contents;
}

function readClipboard(type?: string) {
  if (native.options.headless)
    return { text: "", html: "", files: [], image: undefined, ...(type !== "selection" && ownClipboard) };
  const { text = "", html = "", files = [], image } = native.ask("readClipboard", type);
  return { text, html, files, image: image === undefined ? undefined : native.takeBlob(image) };
}

const clipboard = {
  readText: (type?: string): string => readClipboard(type ?? "text").text,
  readImage: (type?: string) => new NativeImage(readClipboard(type).image),
  readHTML: (type?: string): string => readClipboard(type).html,
  readFilePaths: (type?: string): string[] => readClipboard(type).files,
  write({ text, html, image }: { text?: string; html?: string; image?: NativeImage }, type?: string) {
    const bytes = image && imageBytes(image);
    writeClipboard({ text: bytes && text === undefined ? undefined : String(text ?? ""), html, image: bytes }, type);
  },
  writeText(text: string, type?: string) {
    writeClipboard({ text: String(text) }, type);
  },
  writeImage(image: NativeImage | Uint8Array | string, type?: string) {
    writeClipboard({ image: imageBytes(image) }, type);
  },
  availableFormats(type?: string) {
    const { text, html, files, image } = readClipboard(type);
    return [
      text && "text/plain",
      html && "text/html",
      files.length > 0 && "text/uri-list",
      image && "image/png",
    ].filter(Boolean);
  },
  clear: (type?: string) => clipboard.writeText("", type),
};

const shell = {
  async openExternal(url: string) {
    native.ask("openUrl", new URL(url).href);
  },
  async openPath(file: string) {
    if (!fs.existsSync(file)) return `${file} does not exist`;
    native.ask("openPath", path.resolve(file));
    return "";
  },
  showItemInFolder(file: string) {
    native.ask("revealPath", path.resolve(file));
  },
  async trashItem(file: string) {
    await native.request("trash", path.resolve(file));
  },
  beep() {
    const [window] = require("internal/desktop/window").Window.getAllWindows();
    if (window) native.send("window.beep", { id: window.id });
    else process.stdout.write("\x07");
  },
};

/** The UI thread has to run for a listener to be called. */
function systemEmitter<T extends object>(members: T & ThisType<any>): any {
  const emitter = Object.defineProperties(new EventEmitter(), Object.getOwnPropertyDescriptors(members));
  return emitter.on("newListener", () => native.start());
}

function overlap(a: Rectangle, b: Rectangle) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.max(width, 0) * Math.max(height, 0);
}

function best(displays: any[], score: (display: any) => number) {
  return displays.reduce((a, b) => (score(b) > score(a) ? b : a), displays[0]);
}

const screen = systemEmitter({
  getAllDisplays() {
    const displays = native.ask("displays").sort((a, b) => b.primary - a.primary);
    return displays.map(({ primary: _primary, ...display }) => ({
      ...display,
      size: { width: display.bounds.width, height: display.bounds.height },
      workAreaSize: { width: display.workArea.width, height: display.workArea.height },
    }));
  },
  getPrimaryDisplay: () => screen.getAllDisplays()[0],
  getCursorScreenPoint: () => native.ask("cursor"),
  getDisplayNearestPoint({ x, y }: { x: number; y: number }) {
    return best(screen.getAllDisplays(), ({ bounds }) => {
      const dx = Math.max(bounds.x - x, 0, x - bounds.x - bounds.width);
      const dy = Math.max(bounds.y - y, 0, y - bounds.y - bounds.height);
      return -Math.hypot(dx, dy);
    });
  },
  getDisplayMatching: (rectangle: Rectangle) =>
    best(screen.getAllDisplays(), display => overlap(display.bounds, rectangle)),
});
for (const name of ["display-added", "display-removed", "display-metrics-changed"]) {
  systemEvents[name] = id =>
    screen.emit(name, new Event(), screen.getAllDisplays().find(display => display.id === id) ?? { id });
}

let themeSource = "system";

function setDark(dark: boolean) {
  if (dark === theme.dark) return;
  theme.dark = dark;
  require("internal/desktop/window").Window.themeChanged();
  nativeTheme.emit("updated");
}

const nativeTheme = systemEmitter({
  get shouldUseDarkColors() {
    native.start();
    return theme.dark;
  },
  get themeSource() {
    return themeSource;
  },
  set themeSource(source: string) {
    if (source !== "system" && source !== "light" && source !== "dark") {
      throw $ERR_INVALID_ARG_VALUE("themeSource", source, 'must be "system", "light" or "dark"');
    }
    setDark(native.ask("themeSource", (themeSource = source)));
  },
});
native.handlers.theme = event => setDark(event.dark);

const shown = new Map<string, Notification>();
let nextNotification = 1;

class Notification extends EventEmitter {
  title: string;
  subtitle: string;
  body: string;
  actions: { type: string; text: string }[];
  #tag = `${process.pid}-${nextNotification++}`;

  static isSupported() {
    // UNUserNotificationCenter serves apps that have a bundle.
    return process.platform !== "darwin" || app.isPackaged;
  }

  constructor(options: Record<string, any> = {}) {
    super();
    this.title = options.title ?? "";
    this.subtitle = options.subtitle ?? "";
    this.body = options.body ?? "";
    this.actions = options.actions ?? [];
  }

  show() {
    // Not every platform says when one went away.
    if (shown.size >= 256) shown.$delete(shown.$keys().next().value!);
    shown.$set(this.#tag, this);
    native.ask("notify", {
      tag: this.#tag,
      title: this.title,
      body: this.subtitle ? `${this.subtitle}\n${this.body}` : this.body,
      actions: this.actions.map(action => action.text),
    });
    this.emit("show", new Event());
  }

  close() {
    if (!shown.$delete(this.#tag)) return;
    native.send("dismissNotification", this.#tag);
    this.emit("close", new Event());
  }
}

native.handlers.notification = ({ tag, action }) => {
  const notification = shown.$get(tag);
  shown.$delete(tag);
  if (action === null) notification?.emit("click", new Event());
  else notification?.emit("action", new Event(), +action);
};

const powerMonitor = systemEmitter({
  getSystemIdleTime: (): number => Math.floor(native.ask("idleSeconds")),
  getSystemIdleState(threshold: number) {
    try {
      return powerMonitor.getSystemIdleTime() >= threshold ? "idle" : "active";
    } catch {
      return "unknown";
    }
  },
  getCurrentThermalState: () => native.ask("info").thermalState,
  isOnBatteryPower: (): boolean => native.ask("onBattery"),
  get onBatteryPower(): boolean {
    return native.ask("onBattery");
  },
});
systemEvents.suspend = () => powerMonitor.emit("suspend");
systemEvents.resume = () => powerMonitor.emit("resume");
systemEvents["thermal-state-change"] = state => powerMonitor.emit("thermal-state-change", { state });

const blockers = new Set<number>();
let nextBlocker = 0;

const powerSaveBlocker = {
  start(type: string) {
    if (type !== "prevent-app-suspension") {
      throw $ERR_INVALID_ARG_VALUE("type", type, 'must be "prevent-app-suspension"');
    }
    blockers.$add(nextBlocker);
    native.send("preventSleep", { id: nextBlocker, reason: `${app.name} is working` });
    return nextBlocker++;
  },
  stop(id: number) {
    if (!blockers.$delete(id)) return false;
    native.send("allowSleep", id);
    return true;
  },
  isStarted: (id: number) => blockers.$has(id),
};

const shortcuts = new Map<string, { id: number; callback: () => void }>();
const hotkey = (text: string) => accelerator.toGlobalHotkey(accelerator.parse(text));

function unregister(key: string) {
  if (!shortcuts.$delete(key)) return;
  native.ask("hotkey", { accelerator: key, on: false });
  native.release();
}

const globalShortcut = {
  register(text: string, callback: () => void) {
    const key = hotkey(text);
    if (shortcuts.$has(key)) return false;
    native.start();
    try {
      shortcuts.$set(key, { id: native.ask("hotkey", { accelerator: key, on: true }), callback });
    } catch {
      return false;
    }
    native.hold();
    return true;
  },
  registerAll(texts: string[], callback: () => void) {
    for (const text of texts) globalShortcut.register(text, callback);
  },
  isRegistered: (text: string) => shortcuts.$has(hotkey(text)),
  unregister: (text: string) => unregister(hotkey(text)),
  unregisterAll() {
    for (const key of Array.from(shortcuts.$keys())) unregister(key);
  },
};

native.handlers.hotkey = event => {
  for (const { id, callback } of shortcuts.values()) if (id === event.id) callback();
};

const trays = new Map<number, Tray>();
let nextTray = 1;

class Tray extends EventEmitter {
  #id = nextTray++;
  #menu: any;
  #closeMenu?: () => void;
  #title = "";

  constructor(image: NativeImage | Uint8Array | string) {
    super();
    this.#sendImage("create", image);
    trays.$set(this.#id, this);
    native.hold();
  }

  #ask(op: string, value?: unknown, more?: object) {
    return native.ask("tray", { id: this.#id, op, value, ...more });
  }

  #sendImage(op: string, image: NativeImage | Uint8Array | string) {
    image = toImage(image);
    this.#ask(op, native.putBlob(sharpestBytes(image)), {
      name: app.name,
      template: image.isTemplateImage(),
      size: image.getSize(),
    });
  }

  setImage(image: NativeImage | Uint8Array | string) {
    this.#sendImage("image", image);
  }

  setToolTip(toolTip: string) {
    this.#ask("tooltip", String(toolTip));
  }

  setTitle(title: string) {
    this.#ask("title", (this.#title = String(title)));
  }

  getTitle() {
    return this.#title;
  }

  popUpContextMenu(menu = this.#menu) {
    if (process.platform !== "darwin" || !menu) return;
    this.#closeMenu = require("internal/desktop/menu").popUpUnderTray(menu, this.#id);
  }

  closeContextMenu() {
    this.#closeMenu?.();
  }

  setContextMenu(menu: any) {
    this.#menu = menu;
    require("internal/desktop/menu").attach(this, menu, template => this.#ask("menu", template));
  }

  getBounds() {
    const [x, y, width, height] = this.#ask("bounds") ?? [0, 0, 0, 0];
    return { x, y, width, height };
  }

  destroy() {
    if (!trays.$delete(this.#id)) return;
    require("internal/desktop/menu").attach(this, null);
    this.#ask("destroy");
    native.release();
  }

  isDestroyed() {
    return !trays.$has(this.#id);
  }
}

native.handlers.tray = ({ id, e, x, y }) => {
  const tray = trays.$get(id);
  tray?.emit(e, new Event(), tray.getBounds(), { x, y });
};

let key: Buffer | undefined;
let loadingKey: Promise<Buffer> | undefined;

async function readOrCreateKey() {
  const entry = { service: `${app.name} Safe Storage`, name: app.identifier };
  let stored = await Bun.secrets.get(entry);
  if (stored === null) {
    stored = require("node:crypto").randomBytes(32).toString("base64") as string;
    await Bun.secrets.set({ ...entry, value: stored });
  }
  return (key = Buffer.from(stored, "base64"));
}

function loadKey() {
  return (loadingKey ??= readOrCreateKey().catch(error => {
    loadingKey = undefined;
    throw error;
  }));
}

function loadedKey() {
  if (key) return key;
  throw new Error("The key has not been read yet. Wait for safeStorage.isAsyncEncryptionAvailable() first.");
}

const PREFIX = Buffer.from("b1");
const NONCE = 12;
const TAG = 16;

const safeStorage = {
  isEncryptionAvailable: () => key !== undefined,
  isAsyncEncryptionAvailable: () =>
    loadKey().then(
      () => true,
      () => false,
    ),
  encryptString(text: string) {
    const { createCipheriv, randomBytes } = require("node:crypto");
    const nonce = randomBytes(NONCE);
    const cipher = createCipheriv("aes-256-gcm", loadedKey(), nonce, { authTagLength: TAG });
    return Buffer.concat([PREFIX, nonce, cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]);
  },
  decryptString(encrypted: Uint8Array) {
    const start = PREFIX.length + NONCE;
    if (encrypted.length < start + TAG || !PREFIX.equals(encrypted.subarray(0, PREFIX.length))) {
      throw $ERR_INVALID_ARG_VALUE("encrypted", encrypted, "was not made by safeStorage");
    }
    const decipher = require("node:crypto").createDecipheriv(
      "aes-256-gcm",
      loadedKey(),
      encrypted.subarray(PREFIX.length, start),
      { authTagLength: TAG },
    );
    decipher.setAuthTag(encrypted.subarray(-TAG));
    return Buffer.concat([decipher.update(encrypted.subarray(start, -TAG)), decipher.final()]).toString();
  },
  async encryptStringAsync(text: string) {
    await loadKey();
    return safeStorage.encryptString(text);
  },
  async decryptStringAsync(encrypted: Uint8Array) {
    await loadKey();
    return { result: safeStorage.decryptString(encrypted), shouldReEncrypt: false };
  },
};

type Settings = {
  accent?: number;
  overlayScrollbars?: boolean;
  moreContrast?: boolean;
  reducedTransparency?: boolean;
  invertedColors?: boolean;
};
let knownSettings: Settings | undefined;
const settings = (): Settings => (knownSettings ??= process.platform === "darwin" ? native.ask("systemSettings") : {});
systemEvents["system-settings"] = (now: Settings) => {
  knownSettings = now;
  require("internal/desktop/window").Window.themeChanged();
  nativeTheme.emit("updated");
};

const systemPreferences = {
  getAnimationSettings() {
    const { reduceMotion, lowPower } = native.ask("info");
    return { prefersReducedMotion: reduceMotion, shouldRenderRichAnimation: !reduceMotion && !lowPower };
  },
  isTrustedAccessibilityClient(prompt: boolean): boolean {
    return process.platform !== "darwin" || native.ask("isTrustedAccessibilityClient", !!prompt);
  },
};

const net = {
  fetch: (input: any, init?: any) => fetch(input, init),
  isOnline() {
    const addresses: any[] = Object.values(os.networkInterfaces()).flat();
    return addresses.some(address => !address.internal);
  },
  get online() {
    return net.isOnline();
  },
};

export default {
  imageBytes,
  settings,
  sharpestBytes,
  toImage,
  api: {
    Notification,
    Tray,
    clipboard,
    globalShortcut,
    nativeImage,
    nativeTheme,
    net,
    powerMonitor,
    powerSaveBlocker,
    safeStorage,
    screen,
    shell,
    systemPreferences,
  },
  screen,
};
