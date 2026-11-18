import * as b from "../codegen/bindgen-lib.ts";
import {
  anything,
  flag,
  flagIfAny,
  js,
  noticesListeners,
  numberIfAny,
  ownedTextIfAny,
  ownedTexts,
  returnsFlag,
  returnsObject,
  returnsPromise,
  returnsText,
  sharing,
  text,
  textIfAny,
  texts,
  withAccessors,
} from "./schema.ts";

export default b.module({ rustPath: "crate::app", feature: "Desktop", isCold: true, membersInTable: false });

export const RelaunchOptions = b.dictionary({ args: ownedTexts.nullable, execPath: ownedTextIfAny });
export const AppFocusOptions = b.dictionary({ steal: flag });
export const AboutPanelOptions = b.dictionary({
  applicationName: ownedTextIfAny,
  applicationVersion: ownedTextIfAny,
  credits: ownedTextIfAny,
  copyright: ownedTextIfAny,
});
export const LoginItemOptions = b.dictionary({
  openAtLogin: flag,
  enabled: flagIfAny,
  name: ownedTextIfAny,
  path: ownedTextIfAny,
  args: ownedTexts.nullable,
});
export const FileIconOptions = b.dictionary({ size: ownedTextIfAny });

export const DesktopCommandLine = b.interface("DesktopCommandLine", {
  ofModule: true,
  name: "CommandLine",
  namespace: true,
  static: {
    appendArgument: {},
    appendSwitch: { args: { name: text, value: text.default("") } },
    getSwitchValue: { args: { name: text }, returns: b.string.utf8 },
    hasSwitch: { args: { name: text }, returns: b.bool },
    removeSwitch: { args: { name: text } },
  },
});

export const DesktopDock = b.interface("DesktopDock", {
  ofModule: true,
  name: "Dock",
  namespace: true,
  static: {
    setBadge: { args: { text }, ...js },
    getBadge: { returns: b.string.utf8 },
    bounce: { args: { type: textIfAny }, returns: b.i32, ...js },
    cancelBounce: { args: { id: b.i32.wrap }, ...js },
    hide: js,
    show: returnsPromise,
    isVisible: { returns: b.bool },
    setMenu: { args: { menu: b.ref("DesktopMenu").nullable }, ...js },
    getMenu: { returns: b.any, capability: "heap" },
    downloadFinished: { args: { filePath: text }, ...js },
    setIcon: { args: { image: b.any }, ...js },
  },
});

/** The system answers slowly, and not every caller reads `openAtLogin`. */
export const DesktopLoginItemSettings = b.interface("DesktopLoginItemSettings", {
  ofModule: true,
  name: "LoginItemSettings",
  noInterfaceObject: true,
  proto: {
    openAtLogin: { getter: b.bool, unforgeable: true, ...js },
    executableWillLaunchAtLogin: { getter: b.bool, unforgeable: true, rustName: "open_at_login", ...js },
    status: { getter: b.string.utf8, unforgeable: true, ...js },
  },
});

const protocol = { protocol: b.any, path: textIfAny, args: ownedTexts.nullable.optional };

const globs = b.array(b.string.utf8.owned);
export const FramesToTrust = b.union({ urls: globs, all: b.bool.loose });
export const TrustOptions = b.dictionary({
  inFrames: FramesToTrust.optional,
  injectedScripts: b.bool.loose.default(false),
  except: globs.nullable,
  exceptWhenLoaded: globs.nullable,
});
export const CompiledScriptsOptions = b.dictionary({
  exclusive: b.bool.loose.default(false),
  source: b.callable.nullable,
});

export const DesktopApp = b.interface("DesktopApp", {
  ofModule: true,
  name: "App",
  namespace: true,
  prototypeBase: "EventEmitter",
  static: withAccessors({
    ...noticesListeners,
    name: { getter: text, setter: true, ...js },
    isPackaged: { getter: b.bool },
    identifier: { getter: b.string.utf8, ...js },
    badgeCount: { getter: numberIfAny, setter: true, rustName: "badge_count_property", ...js },
    applicationMenu: { getter: b.any, capability: "heap", setter: { type: b.ref("DesktopMenu").nullable, ...js } },
    dock: { getter: b.any, capability: "heap" },
    commandLine: { getter: b.any, capability: "heap" },
    userAgentFallback: { getter: text, setter: { capability: "none", throws: false }, ...js },
    runningUnderARM64Translation: { getter: b.bool, rustName: "running_under_arm64_translation" },
    accessibilitySupportEnabled: { getter: b.bool.loose, setter: js },

    whenReady: returnsObject,
    isReady: { returns: b.bool },
    prepare: js,
    quit: js,
    exit: { args: { exitCode: b.i32.wrap.default(0) }, ...js },
    relaunch: { args: { options: RelaunchOptions.nullable.optional }, ...js },
    focus: { args: { options: AppFocusOptions.nullable.optional }, ...js },
    hide: js,
    show: js,
    isHidden: returnsFlag,
    isActive: { returns: b.bool },
    getName: returnsText,
    setName: { args: { name: text }, ...js },
    getVersion: returnsText,
    getAppPath: returnsText,
    getPath: { args: { name: text }, ...returnsText },
    setPath: { args: { name: text, path: b.string.utf8 }, ...js },
    setAppLogsPath: { args: { path: b.string.utf8.optional }, ...js },
    isInApplicationsFolder: { returns: b.bool },
    moveToApplicationsFolder: { args: { options: anything }, ...returnsFlag },
    getLocale: returnsText,
    getSystemLocale: returnsText,
    getLocaleCountryCode: returnsText,
    getPreferredSystemLanguages: { returns: texts, ...js },
    setAppUserModelId: { args: { id: text }, ...js },
    setDesktopName: { args: { name: text }, ...js },
    getDesktopName: returnsObject,
    setActivationPolicy: { args: { policy: text }, ...js },
    setBadgeCount: { args: { count: numberIfAny }, ...returnsFlag },
    getBadgeCount: { returns: b.f64 },
    addRecentDocument: { args: { path: text }, ...js },
    clearRecentDocuments: js,
    getRecentDocuments: returnsObject,
    setAboutPanelOptions: { args: { options: AboutPanelOptions } },
    showAboutPanel: returnsPromise,
    showEmojiPanel: js,
    isEmojiPanelSupported: { returns: b.bool },
    requestSingleInstanceLock: { args: { additionalData: anything }, ...returnsFlag },
    hasSingleInstanceLock: { returns: b.bool },
    releaseSingleInstanceLock: {},
    setAsDefaultProtocolClient: { args: protocol, ...returnsFlag },
    isDefaultProtocolClient: { args: protocol, ...returnsFlag },
    removeAsDefaultProtocolClient: { args: protocol, ...returnsFlag },
    getApplicationNameForProtocol: { args: { url: text }, ...returnsText },
    getApplicationInfoForProtocol: { args: { url: text }, ...returnsPromise },
    getFileIcon: { args: { path: text, options: FileIconOptions.nullable.optional }, ...returnsPromise },
    getLoginItemSettings: { args: { options: LoginItemOptions.nullable.optional }, ...returnsObject },
    setLoginItemSettings: { args: { settings: LoginItemOptions }, ...js },
    getFonts: { returns: texts, ...js },
    disableHardwareAcceleration: {},
    isHardwareAccelerationEnabled: { returns: b.bool },
    getGPUFeatureStatus: { rustName: "get_gpu_feature_status", ...returnsObject },
    getGPUInfo: { rustName: "get_gpu_info", ...returnsPromise },
    getAppMetrics: returnsObject,
    enableSandbox: js,
    isAccessibilitySupportEnabled: { returns: b.bool, rustName: "get_accessibility_support_enabled" },
    setAccessibilitySupportEnabled: { args: { enabled: flag }, ...js },
    setAccessibilitySupportFeatures: { args: { features: b.array(b.string.utf8.owned) }, ...js },
    getAccessibilitySupportFeatures: { returns: texts },
    setUserActivity: { args: { type: text, userInfo: anything, webpageURL: textIfAny }, ...js },
    updateCurrentActivity: { args: { type: text, userInfo: anything }, ...js },
    resignCurrentActivity: js,
    setSecureKeyboardEntryEnabled: { args: { enabled: flag }, ...js },
    isSecureKeyboardEntryEnabled: { returns: b.bool },
    getCurrentActivityType: { returns: b.string.utf8 },
    invalidateCurrentActivity: js,
    getJumpListSettings: returnsObject,
    setJumpList: { args: { categories: b.any }, ...returnsText },
    setUserTasks: { args: { tasks: b.any }, ...returnsFlag },
    startAccessingSecurityScopedResource: returnsObject,
    resolveProxy: { args: { url: b.any }, ...returnsPromise },
    setProxy: { args: { config: b.any }, ...returnsPromise },
    setWebEngine: { args: { engine: b.any }, ...js },
    importCertificate: { args: { options: b.any, callback: b.any }, ...js },
    setCompiledScripts: { args: { roots: b.object, options: CompiledScriptsOptions.nullable.default({}) }, ...js },
    trustOrigins: { args: { patterns: globs, options: TrustOptions.nullable.default({}) } },
    ...sharing(
      "nothing",
      "configureHostResolver configureWebAuthn disableDomainBlockingFor3DAPIs " +
        "setClientCertRequestPasswordHandler setToastActivatorCLSID",
    ),
    ...sharing("no", "isUnityRunning", { returns: b.bool }),
  }),
});
