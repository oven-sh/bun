const EventEmitter = require("node:events");
const path = require("node:path");
const native = require("internal/desktop/native");
const { app, Event } = require("internal/desktop/app");
const policy = require("internal/desktop/electron/policy");
const { inert, properties, unsupported } = require("internal/desktop/electron/stubs");

const switches = new Map<string, string>();
for (const argument of process.argv.slice(1)) {
  if (argument === "--") break;
  const [, name, value = ""] = /^--?([^=]+)(?:=(.*))?$/s.exec(argument) ?? [];
  if (name) switches.$set(name, value);
}
if (switches.$get("user-data-dir")) app.setPath("userData", path.resolve(switches.$get("user-data-dir")));

if (app.isPackaged) {
  const resources = (process as any).resourcesPath;
  const found = ["app.asar", "app"].map(name => path.join(resources, name)).find(require("node:fs").existsSync);
  if (found) app.getAppPath = () => found;
}

const system =
  { darwin: "Macintosh; Intel Mac OS X 10_15_7", win32: "Windows NT 10.0; Win64; x64" }[process.platform] ??
  "X11; Linux x86_64";
let userAgent: string | undefined;
let isHidden = false;
let activity = "";
let locale: string | undefined;
let systemLocale: string | undefined;
let desktopName: string | undefined;
const defaultSession = () => require("internal/desktop/electron/session").session.defaultSession;
const windows = () => require("internal/desktop/window").Window;

// The key of `safeStorage` can only be read asynchronously, and has to be there when the app is ready.
const ready = Promise.withResolvers<void>();
let isReady = false;
const loadKey = (): Promise<unknown> =>
  switches.$get("password-store") !== "basic" && !native.options.headless
    ? require("internal/desktop/electron/os_crypt").load()
    : Promise.$resolve();
const isLoadingEntryPoint = $bindgen("desktop.bind.ts", "isLoadingEntryPoint");
// The main script may be waiting for it at its top level.
let isAwaited = false;
const { emit } = EventEmitter.prototype;
app.emit = function (name: string, ...args: unknown[]) {
  if (name !== "ready" || isReady) return emit.$call(this, name, ...args);
  if (!isAwaited && isLoadingEntryPoint()) {
    setTimeout(() => this.emit(name, ...args), 1);
    return true;
  }
  const { nativeTheme } = require("internal/desktop/system").api;
  loadKey().then(() => {
    isReady = true;
    emit.$call(this, "will-finish-launching");
    nativeTheme.on("updated", () => {
      const { kPrivate, webContents } = require("internal/desktop/electron/web_contents");
      for (const contents of webContents.getAllWebContents()) contents[kPrivate].environmentChanged();
    });
    defaultSession();
    if (switches.$has("remote-debugging-port")) {
      require("internal/desktop/electron/devtools").listen(+switches.$get("remote-debugging-port")!);
    }
    ready.resolve();
    emit.$call(this, name, ...args);
  });
  return true;
};
const startSoon = app.whenReady.bind(app);
app.whenReady = () => {
  isAwaited = true;
  return ready.promise;
};
app.isReady = () => isReady;

const { hide, show, getLocale, getSystemLocale } = app;
Object.assign(app, {
  /** The name, the paths and the switches are final: what `ready` waits for can begin while the app is being loaded. */
  prepare() {
    startSoon();
    loadKey();
  },
  hide() {
    isHidden = true;
    hide.$call(app);
  },
  show() {
    isHidden = false;
    show.$call(app);
  },
  getLocale: () => switches.$get("lang") || (locale ??= getLocale.$call(app)),
  getSystemLocale: () => (systemLocale ??= getSystemLocale.$call(app)),
});
app.on("window-focus", () => {
  isHidden = false;
});

if (process.platform === "darwin") {
  Object.assign(app, {
    async getApplicationInfoForProtocol(url: string) {
      const found = native.ask("applicationFor", url);
      if (!found) throw new Error("Unable to retrieve installation path to app");
      return { ...found, icon: await (app as any).getFileIcon(found.path) };
    },
    getApplicationNameForProtocol: (url: string) => native.ask("applicationFor", url)?.name ?? "",
    async getFileIcon(file: string, { size = "normal" } = {}) {
      const { nativeImage } = require("internal/desktop/system").api;
      const icon = native.ask("fileIcon", [file, size === "small" ? 32 : 64]);
      return icon === null ? nativeImage.createEmpty() : nativeImage.createFromBuffer(native.takeBlob(icon));
    },
    isHidden: () => native.ask("isHidden"),
  });
}

inert(app, {
  clearRecentDocuments: undefined,
  configureHostResolver: undefined,
  configureWebAuthn: undefined,
  disableDomainBlockingFor3DAPIs: undefined,
  disableHardwareAcceleration: () => void switches.$set("disable-gpu", ""),
  enableSandbox: unsupported.throws("enableSandbox"),
  getAccessibilitySupportFeatures: () => [],
  getAppMetrics() {
    const workingSetSize = Math.round(process.memoryUsage.rss() / 1024);
    const utilities = [...require("internal/desktop/electron/utility").running].filter(([child]) => child.pid);
    const engine = require("internal/desktop/webview/engine").running();
    if (engine?.pid) utilities.push([engine, { serviceName: "Web Engine", creationTime: engine.creationTime }]);
    return [
      {
        pid: process.pid,
        type: "Browser",
        cpu: (process as any).getCPUUsage(),
        creationTime: performance.timeOrigin,
        memory: { workingSetSize, peakWorkingSetSize: Math.max(process.resourceUsage().maxRSS, workingSetSize) },
      },
      ...utilities.map(([{ pid }, { serviceName, creationTime }]) => ({
        pid,
        type: "Utility",
        name: serviceName,
        serviceName: "node.mojom.NodeService",
        cpu: { percentCPUUsage: 0, idleWakeupsPerSecond: 0 },
        creationTime,
        memory: { workingSetSize: 0, peakWorkingSetSize: 0 },
      })),
    ];
  },
  getApplicationInfoForProtocol: unsupported.rejects("getApplicationInfoForProtocol"),
  getApplicationNameForProtocol: "",
  getCurrentActivityType: () => activity,
  getFileIcon: async () => require("internal/desktop/system").api.nativeImage.createEmpty(),
  getGPUFeatureStatus: () => ({ gpu_compositing: "enabled", webgl: "unavailable_off", webgpu: "unavailable_off" }),
  getGPUInfo: async () => ({ auxAttributes: {}, gpuDevice: [] }),
  getJumpListSettings: () => ({ minItems: 0, removedItems: [] }),
  getRecentDocuments: () => [],
  invalidateCurrentActivity: () => void (activity = ""),
  isAccessibilitySupportEnabled: false,
  isActive: () => windows().getFocusedWindow() !== null,
  isHardwareAccelerationEnabled: () => !switches.$has("disable-gpu"),
  isHidden: () => isHidden,
  isInApplicationsFolder: () => process.execPath.includes("/Applications/"),
  isSecureKeyboardEntryEnabled: false,
  isUnityRunning: false,
  moveToApplicationsFolder: unsupported.throws("moveToApplicationsFolder"),
  resignCurrentActivity: undefined,
  resolveProxy: (url: string) => defaultSession().resolveProxy(url),
  setAccessibilitySupportEnabled: undefined,
  setAccessibilitySupportFeatures: undefined,
  setClientCertRequestPasswordHandler: undefined,
  setDesktopName: (name: string) => app.setAppUserModelId((desktopName = name).replace(/\.desktop$/, "")),
  getDesktopName: () => desktopName,
  setJumpList: "error",
  setProxy: async () => {},
  setSecureKeyboardEntryEnabled: undefined,
  setToastActivatorCLSID: undefined,
  setUserActivity: (type: string) => void (activity = type),
  setUserTasks: false,
  startAccessingSecurityScopedResource: () => () => {},
  setCompiledScripts(
    roots: Record<string, string>,
    options?: { exclusive?: boolean; source?: (url: string) => unknown },
  ) {
    const compiled = require("internal/desktop/electron/compiled");
    compiled.roots.push(...Object.entries(roots));
    compiled.isExclusive ||= !!options?.exclusive;
    compiled.sourceOf = options?.source ?? compiled.sourceOf;
  },
  trustOrigins: (patterns: string[], options?: object) => policy.trust(patterns, options),
  updateCurrentActivity: undefined,
});
if (app.dock) inert(app.dock, { downloadFinished: undefined, setIcon: undefined });
properties(app, { accessibilitySupportEnabled: ["isAccessibilitySupportEnabled", "setAccessibilitySupportEnabled"] });
Object.defineProperties(app, {
  runningUnderARM64Translation: { value: false, enumerable: true },
  userAgentFallback: {
    get() {
      const { chrome, electron } = process.versions;
      const name = app.name.replace(/[^\x21-\x7e]/g, "");
      return (
        userAgent ??
        `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) ${name}/${app.getVersion()} Chrome/${chrome} Electron/${electron} Bun/${Bun.version} Safari/537.36`
      );
    },
    set: (value: string) => void (userAgent = String(value)),
    enumerable: true,
  },
  commandLine: {
    enumerable: true,
    value: {
      appended: switches,
      appendArgument() {},
      appendSwitch: (name: string, value = "") => void switches.$set(name, String(value)),
      getSwitchValue: (name: string) => switches.$get(name) ?? "",
      hasSwitch: (name: string) => switches.$has(name),
      removeSwitch: (name: string) => void switches.$delete(name),
    },
  },
});

export default { app, startSoon };
