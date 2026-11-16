const EventEmitter = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const native = require("internal/desktop/native");

const writeToUnixSocket = $bindgen("desktop.bind.ts", "writeToUnixSocket");

class Event {
  defaultPrevented = false;

  constructor(fields?: object) {
    Object.assign(this, fields);
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

/** False if a listener called `preventDefault()`. */
function emitCancelable(emitter: any, name: string, ...rest: unknown[]) {
  const event = new Event();
  emitter.emit(name, event, ...rest);
  return !event.defaultPrevented;
}

const resources: string | null = native.resourcesPath();

function readJson(file: string) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
}

type Manifest = { name: string; version: string; identifier?: string; root: string };
let manifest: Manifest | undefined;

function getManifest(): Manifest {
  if (manifest) return manifest;
  if (resources !== null) {
    const name = path.basename(process.execPath, ".exe");
    return (manifest = { name, version: "0.0.0", root: resources, ...readJson(path.join(resources, "desktop.json")) });
  }
  const start = path.dirname(Bun.main);
  for (let directory = start; ; directory = path.dirname(directory)) {
    const json = readJson(path.join(directory, "package.json"));
    if (json) {
      return (manifest = {
        name: json.desktop?.name ?? json.productName ?? (json.name && path.posix.basename(json.name)) ?? "Bun",
        version: json.desktop?.version ?? json.version ?? "0.0.0",
        identifier: json.desktop?.identifier,
        root: directory,
      });
    }
    if (directory === path.dirname(directory)) return (manifest = { name: "Bun", version: "0.0.0", root: start });
  }
}

const fileName = (name: string) => name.replace(/[<>:"/\\|?*\0-\x1f]/g, "-");

/** The same as `default_identifier` in src/runtime/cli/desktop_bundle.rs. */
function identifier(): string {
  const { name, identifier } = getManifest();
  const words = name.toLowerCase().match(/[a-z0-9]+/g) ?? ["app"];
  return identifier ?? "sh.bun.app." + words.join("-");
}

function userDirectory(variable: string, fallback: string) {
  if (process.platform === "linux") {
    try {
      const config = fs.readFileSync(path.join(getPath("appData"), "user-dirs.dirs"), "utf8");
      const match = new RegExp(`^XDG_${variable}_DIR="(.*)"$`, "m").exec(config);
      if (match) return match[1].replace(/^\$HOME/, () => os.homedir());
    } catch {}
  }
  return path.join(os.homedir(), fallback);
}

const overriddenPaths: Record<string, string> = Object.create(null);

function getPath(name: string): string {
  if (overriddenPaths[name] !== undefined) return overriddenPaths[name];
  const home = os.homedir();
  switch (name) {
    case "home":
      return home;
    case "appData":
      if (process.platform === "darwin") return path.join(home, "Library", "Application Support");
      if (process.platform === "win32") return process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
      return process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    case "userData":
      return path.join(getPath("appData"), fileName(getManifest().name));
    case "sessionData":
      return getPath("userData");
    case "cache":
      if (process.platform === "darwin") return path.join(home, "Library", "Caches");
      if (process.platform === "win32") return process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
      return process.env.XDG_CACHE_HOME || path.join(home, ".cache");
    case "logs":
      if (process.platform === "darwin") return path.join(home, "Library", "Logs", fileName(getManifest().name));
      return path.join(getPath("userData"), "logs");
    case "crashDumps":
      return path.join(getPath("userData"), "Crashpad");
    case "temp":
      return os.tmpdir();
    case "exe":
    case "module":
      return process.execPath;
    case "resources":
      return getManifest().root;
    case "desktop":
      return userDirectory("DESKTOP", "Desktop");
    case "documents":
      return userDirectory("DOCUMENTS", "Documents");
    case "downloads":
      return userDirectory("DOWNLOAD", "Downloads");
    case "music":
      return userDirectory("MUSIC", "Music");
    case "pictures":
      return userDirectory("PICTURES", "Pictures");
    case "videos":
      return userDirectory("VIDEOS", process.platform === "darwin" ? "Movies" : "Videos");
  }
  throw $ERR_INVALID_ARG_VALUE("name", name, "is not the name of a path");
}

/** What starts this app again. */
function launchCommand(): string[] {
  if (resources !== null) return [process.env.APPIMAGE ?? process.execPath];
  return [process.execPath, ...process.execArgv, Bun.main];
}

function validateScheme(scheme: unknown) {
  if (typeof scheme !== "string" || !/^[a-z][a-z0-9+.-]*$/i.test(scheme)) {
    throw $ERR_INVALID_ARG_VALUE("protocol", scheme, "is not a URL scheme");
  }
}

/** For the `Exec` key of a desktop entry, which is unescaped twice. */
function desktopExec(command: string[]) {
  const quoted = command.map(argument => '"' + argument.replace(/[\\"`$]/g, "\\$&").replaceAll("%", "%%") + '"');
  return desktopValue(quoted.join(" "));
}

const desktopValue = (text: string) => text.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r");

function writeDesktopEntry(file: string, exec: string, more = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `[Desktop Entry]\nType=Application\nName=${desktopValue(getManifest().name)}\nExec=${exec}\nIcon=${identifier()}\n${more}`,
  );
}

const autostartEntry = () => path.join(getPath("appData"), "autostart", identifier() + ".desktop");
const handlerEntry = (scheme: string) => `${identifier()}.${scheme}-handler.desktop`;
const applicationsDirectory = () =>
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "applications");
const windowsCommand = (command: string[]) => command.map(argument => `"${argument}"`).join(" ");

function applicationDirectories(): string[] {
  const shared = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":");
  return [applicationsDirectory(), ...shared.map(it => path.join(it, "applications"))];
}

/** What `xdg-mime query default` prints, which takes a hundred times as long. */
function defaultApplication(type: string): string | undefined {
  const { XDG_CONFIG_DIRS, XDG_CURRENT_DESKTOP } = process.env;
  const applications = applicationDirectories();
  const lists = [
    ...(XDG_CURRENT_DESKTOP?.toLowerCase().split(":") ?? []).map(it => it + "-mimeapps.list"),
    "mimeapps.list",
  ];
  function find(file: string, group: string) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return;
    }
    const lines: string[] = text.split(`[${group}]`)[1]?.split(/^\[/m)[0].split("\n") ?? [];
    const entries =
      lines
        .find(line => line.startsWith(type + "="))
        ?.slice(type.length + 1)
        .trim()
        .split(";") ?? [];
    return entries.find(entry => entry && applications.some(it => fs.existsSync(path.join(it, entry))));
  }
  for (const directory of [getPath("appData"), ...(XDG_CONFIG_DIRS || "/etc/xdg").split(":"), ...applications]) {
    for (const list of lists) {
      const entry = find(path.join(directory, list), "Default Applications");
      if (entry) return entry;
    }
  }
  for (const directory of applications) {
    const entry = find(path.join(directory, "mimeinfo.cache"), "MIME Cache");
    if (entry) return entry;
  }
}

function run(command: string[]): string | undefined {
  try {
    const result = Bun.spawnSync({ cmd: command, stdin: "ignore", stderr: "ignore" });
    if (result.success) return result.stdout.toString().trim();
  } catch {}
}

function lockPath() {
  const key = Bun.hash(getPath("userData")).toString(36);
  if (process.platform === "win32") return `\\\\.\\pipe\\bun-desktop-${key}`;
  // The path of a socket has about 100 bytes. macOS gives each user a temporary directory of their own.
  const directory = process.platform === "darwin" ? os.tmpdir() : (process.env.XDG_RUNTIME_DIR ?? getPath("userData"));
  return path.join(directory, `bun-desktop-${key}.sock`);
}

/** Hands the arguments to the instance that holds the lock. False if there is none. */
function notifyFirstInstance(socketPath: string, message: string): boolean {
  if (process.platform !== "win32") return writeToUnixSocket(socketPath, message);
  try {
    fs.writeFileSync(socketPath, message);
    return true;
  } catch {
    return false;
  }
}

let ready = false;
let quitting = false;
let staysOpen = false;
let badgeCount = 0;
let lock: any;
let relaunchWith: string[] | undefined;
let aboutPanel: Record<string, string> = {};
let dockMenu: any = null;
let dockVisible = true;
let dockBadge = "";
const readiness = Promise.withResolvers<void>();

function startSoon() {
  if (ready) return;
  queueMicrotask(() => {
    try {
      native.start();
    } catch (error) {
      if (app.listenerCount("ready") > 0) throw error;
      readiness.reject(error);
    }
  });
}

class App extends EventEmitter {
  get name() {
    return getManifest().name;
  }

  set name(name: string) {
    this.setName(name);
  }

  get isPackaged() {
    return resources !== null;
  }

  get identifier() {
    return identifier();
  }

  get badgeCount() {
    return badgeCount;
  }

  set badgeCount(count: number) {
    this.setBadgeCount(count);
  }

  get applicationMenu() {
    return require("internal/desktop/menu").Menu.getApplicationMenu();
  }

  set applicationMenu(menu) {
    require("internal/desktop/menu").Menu.setApplicationMenu(menu);
  }

  dock = process.platform === "darwin" ? dock : undefined;

  whenReady() {
    startSoon();
    return readiness.promise;
  }

  isReady() {
    return ready;
  }

  quit() {
    if (quitting || !emitCancelable(this, "before-quit")) return;
    quitting = true;
    const windows = require("internal/desktop/window").Window.getAllWindows();
    if (windows.length === 0) return allWindowsClosed();
    for (const window of windows) window.close();
  }

  exit(code = 0) {
    this.emit("quit", new Event(), code);
    process.exit(code);
  }

  relaunch(options?: { args?: string[]; execPath?: string }) {
    const first = relaunchWith === undefined;
    relaunchWith = [
      ...(options?.execPath ? [options.execPath] : launchCommand()),
      ...(options?.args ?? process.argv.slice(2)),
    ];
    if (!first) return;
    process.once("exit", () => {
      this.releaseSingleInstanceLock();
      Bun.spawn({ cmd: relaunchWith!, stdio: ["ignore", "inherit", "inherit"], detached: true }).unref();
    });
  }

  focus(options?: { steal?: boolean }) {
    if (process.platform === "darwin") native.send("activate", !!options?.steal);
    else
      require("internal/desktop/window")
        .Window.getAllWindows()
        .find(window => window.isVisible())
        ?.focus();
  }

  hide() {
    native.send("hide");
  }

  show() {
    native.send("activate", false);
  }

  getName() {
    return getManifest().name;
  }

  setName(name: string) {
    getManifest().name = String(name);
  }

  getVersion() {
    return getManifest().version;
  }

  getAppPath() {
    return getManifest().root;
  }

  getPath(name: string) {
    return getPath(name);
  }

  setPath(name: string, value: string) {
    if (!path.isAbsolute(value)) throw $ERR_INVALID_ARG_VALUE("path", value, "must be absolute");
    overriddenPaths[name] = value;
  }

  setAppLogsPath(value?: string) {
    if (value !== undefined) this.setPath("logs", value);
    fs.mkdirSync(getPath("logs"), { recursive: true });
  }

  getLocale() {
    return this.getPreferredSystemLanguages()[0];
  }

  getSystemLocale(): string {
    const chosen = process.platform === "darwin" ? native.ask("defaults.get", ["AppleLocale"]) : null;
    return chosen?.replace(/@.*/, "").replaceAll("_", "-") ?? Intl.DateTimeFormat().resolvedOptions().locale;
  }

  getLocaleCountryCode() {
    return new Intl.Locale(this.getSystemLocale()).region ?? "";
  }

  getPreferredSystemLanguages(): string[] {
    const chosen = process.platform === "darwin" ? native.ask("defaults.get", ["AppleLanguages"]) : null;
    return chosen?.length > 0 ? chosen : [this.getSystemLocale()];
  }

  setWebEngine(engine: object | null) {
    require("internal/desktop/webview/engine").choose(engine);
  }

  setAppUserModelId(id: string) {
    getManifest().identifier = String(id);
    if (ready) native.send("identity", { id: identifier(), name: this.name });
  }

  setActivationPolicy(policy: string) {
    dockVisible = policy === "regular";
    if (native.isStarted()) native.send("activationPolicy", policy);
    else native.options.accessory = !dockVisible;
  }

  setBadgeCount(count?: number) {
    badgeCount = count ?? 0;
    native.send("badge", { text: count === undefined ? "•" : count ? String(count) : "", appId: identifier() });
    return process.platform !== "win32";
  }

  getBadgeCount() {
    return badgeCount;
  }

  addRecentDocument(file: string) {
    native.send("recentDocument", path.resolve(file));
  }

  setAboutPanelOptions(options: Record<string, string>) {
    aboutPanel = { ...options };
  }

  showAboutPanel() {
    const version = aboutPanel.applicationVersion ?? this.getVersion();
    return require("internal/desktop/dialog").showMessageBox({
      message: aboutPanel.applicationName ?? this.name,
      detail: [`Version ${version}`, aboutPanel.credits, aboutPanel.copyright].filter(Boolean).join("\n"),
    });
  }

  showEmojiPanel() {
    const window = require("internal/desktop/window").Window.getFocusedWindow();
    if (window) native.send("window.characterPalette", { id: window.id });
  }

  isEmojiPanelSupported() {
    return process.platform !== "linux";
  }

  requestSingleInstanceLock(additionalData: unknown = {}) {
    if (lock) return true;
    const socketPath = lockPath();
    const message = JSON.stringify({ argv: process.argv, cwd: process.cwd(), additionalData });
    if (notifyFirstInstance(socketPath, message)) return false;
    if (process.platform !== "win32") {
      fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
      // Left by an instance that was killed.
      fs.rmSync(socketPath, { force: true });
    }
    lock = require("node:net").createServer(socket => {
      let text = "";
      socket.setEncoding("utf8");
      socket.on("error", () => {});
      socket.on("data", chunk => {
        if ((text += chunk).length > 1 << 20) socket.destroy();
      });
      socket.on("end", () => {
        let received;
        try {
          received = JSON.parse(text);
        } catch {}
        if ($isArray(received?.argv)) {
          this.emit("second-instance", new Event(), received.argv, received.cwd, received.additionalData);
        }
      });
    });
    lock.listen(socketPath).unref();
    process.once("exit", () => this.releaseSingleInstanceLock());
    return true;
  }

  hasSingleInstanceLock() {
    return lock !== undefined;
  }

  releaseSingleInstanceLock() {
    lock?.close();
    lock = undefined;
  }

  setAsDefaultProtocolClient(protocol: string, executable?: string, args: string[] = []) {
    validateScheme(protocol);
    const command = executable ? [executable, ...args] : launchCommand();
    if (process.platform === "darwin") {
      native.request("registerUrlScheme", protocol).catch(error => process.emitWarning(error));
      return true;
    }
    if (process.platform === "win32") {
      native.ask("setProtocolCommand", { scheme: protocol, command: `${windowsCommand(command)} "%1"` });
      return true;
    }
    const installed = identifier() + ".desktop";
    if (!executable && applicationDirectories().some(it => fs.existsSync(path.join(it, installed)))) {
      return run(["xdg-mime", "default", installed, `x-scheme-handler/${protocol}`]) !== undefined;
    }
    writeDesktopEntry(
      path.join(applicationsDirectory(), handlerEntry(protocol)),
      `${desktopExec(command)} %u`,
      `NoDisplay=true\nMimeType=x-scheme-handler/${protocol};\n`,
    );
    return run(["xdg-mime", "default", handlerEntry(protocol), `x-scheme-handler/${protocol}`]) !== undefined;
  }

  isDefaultProtocolClient(protocol: string, executable?: string, args: string[] = []) {
    validateScheme(protocol);
    if (process.platform === "darwin") return native.ask("protocolHandler", protocol) === identifier();
    if (process.platform === "win32") {
      const command = executable ? [executable, ...args] : launchCommand();
      return native.ask("protocolCommand", protocol) === `${windowsCommand(command)} "%1"`;
    }
    const entry = defaultApplication(`x-scheme-handler/${protocol}`);
    return entry === handlerEntry(protocol) || entry === identifier() + ".desktop";
  }

  removeAsDefaultProtocolClient(protocol: string, executable?: string, args?: string[]) {
    if (process.platform === "darwin" || !this.isDefaultProtocolClient(protocol, executable, args)) return false;
    if (process.platform === "win32") native.ask("setProtocolCommand", { scheme: protocol, command: null });
    else fs.rmSync(path.join(applicationsDirectory(), handlerEntry(protocol)), { force: true });
    return true;
  }

  getLoginItemSettings() {
    if (process.platform === "linux") return { openAtLogin: fs.existsSync(autostartEntry()) };
    // The system answers slowly, and not every caller of Electron's version reads this field.
    return {
      get openAtLogin(): boolean {
        return native.ask("opensAtLogin", identifier());
      },
    };
  }

  setLoginItemSettings(settings: { openAtLogin?: boolean; path?: string; args?: string[] }) {
    const command = [...(settings.path ? [settings.path] : launchCommand()), ...(settings.args ?? [])];
    if (process.platform !== "linux") {
      native.ask("setOpensAtLogin", {
        name: identifier(),
        command: windowsCommand(command),
        on: !!settings.openAtLogin,
      });
    } else if (settings.openAtLogin) writeDesktopEntry(autostartEntry(), desktopExec(command));
    else fs.rmSync(autostartEntry(), { force: true });
  }

  getFonts(): string[] {
    return native.ask("font.families");
  }
}

const dock = {
  setBadge(text: string) {
    native.send("badge", { text: (dockBadge = String(text)), appId: identifier() });
  },
  getBadge: () => dockBadge,
  bounce() {
    require("internal/desktop/window").Window.getAllWindows()[0]?.flashFrame(true);
    return 0;
  },
  cancelBounce() {},
  hide: () => app.setActivationPolicy("accessory"),
  show: async () => app.setActivationPolicy("regular"),
  isVisible: () => dockVisible,
  setMenu(menu: any) {
    dockMenu = menu;
    require("internal/desktop/menu").attach("dock", menu, template => native.send("dockMenu", template ?? []));
  },
  getMenu: () => dockMenu,
};

const app = new App();

app.on("newListener", (name: string) => {
  if (name === "ready" || name === "open-url" || name === "open-file" || name === "activate") startSoon();
});

function closeCancelled() {
  quitting = false;
}

function allWindowsClosed() {
  if (quitting) {
    if (!emitCancelable(app, "will-quit")) return closeCancelled();
    app.emit("quit", new Event(), process.exitCode ?? 0);
    process.exit();
  }
  if (app.listenerCount("window-all-closed") === 0) return app.quit();
  if (!staysOpen) {
    staysOpen = true;
    native.hold();
  }
  app.emit("window-all-closed");
}

let compositor = "";
const theme = { dark: false };

native.hooks.started = () => {
  const info = native.ask("info");
  compositor = info.compositor;
  theme.dark = info.dark;
  native.send("identity", { id: identifier(), name: app.name });
  if (process.platform === "darwin") require("internal/desktop/menu").setDefaultApplicationMenu();
  ready = true;
  readiness.resolve();
  queueMicrotask(() => app.emit("ready", new Event(), {}));
};

/** Who emits which of the events of the system. `internal/desktop/system` adds to it. */
const systemEvents: Record<string, (value: any) => void> = {
  __proto__: null as any,
  "open-urls"(urls: string[]) {
    for (const url of urls) {
      if (url.startsWith("file://")) app.emit("open-file", new Event(), Bun.fileURLToPath(url));
      else app.emit("open-url", new Event(), url);
    }
  },
  activate: (hasVisibleWindows: boolean) => void app.emit("activate", new Event(), hasVisibleWindows),
  quit() {
    app.quit();
    // Apps put off quitting to clean up, which is no reason to interrupt a logout.
    setTimeout(() => native.send("cancelQuit"), 5000).unref();
  },
  "did-become-active": () => void app.emit("did-become-active", new Event()),
  "did-resign-active": () => void app.emit("did-resign-active", new Event()),
  "session-end"() {
    app.emit("session-end", new Event());
    app.exit();
  },
};
native.handlers.app = event => systemEvents[event.e]?.(event.v);

export default {
  app,
  Event,
  emitCancelable,
  allWindowsClosed,
  closeCancelled,
  systemEvents,
  theme,
  hasDisplay: () => compositor !== "headless" || native.options.headless,
};
