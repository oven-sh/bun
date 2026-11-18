// What only Electron has.
import * as b from "../codegen/bindgen-lib.ts";
import {
  anything,
  flag,
  flagIfAny,
  js,
  returnsObject,
  returnsPromise,
  returnsText,
  text,
  textIfAny,
  texts,
} from "./schema.ts";

export default b.module({ feature: "Desktop", isCold: true, membersInTable: false });

const emitter = { namespace: true, prototypeBase: "EventEmitter" } as const;

export const DesktopProcess = b.interface("DesktopProcess", {
  ofModule: true,
  namespace: true,
  static: {
    crash: {},
    hang: {},
    getBlinkMemoryInfo: returnsObject,
    getCPUUsage: { rustName: "get_cpu_usage", ...returnsObject },
    getCreationTime: { returns: b.f64 },
    getHeapStatistics: returnsObject,
    getProcessMemoryInfo: returnsPromise,
    getSystemMemoryInfo: returnsObject,
    getSystemVersion: { returns: b.string.utf8 },
    setFdLimit: { args: { maxDescriptors: b.u32.clamp } },
    takeHeapSnapshot: { args: { filePath: b.string.utf8 }, returns: b.bool, capability: "js" },
  },
});

export const ElectronClipboardItem = b.interface("ElectronClipboardItem", {
  ofModule: true,
  name: "ClipboardItem",
  rustPath: "crate::clipboard::ClipboardItem",
  internalFields: ["values"],
  construct: { args: { items: b.recordOf(b.DOMString, b.any) }, passStructure: true, ...js },
  proto: { types: { getter: texts }, getType: { args: { type: text }, ...returnsPromise } },
});

export const ElectronClipboard = b.interface("ElectronClipboard", {
  ofModule: true,
  name: "Clipboard",
  rustPath: "crate::clipboard::Clipboard",
  noInterfaceObject: true,
  internalFields: ["selection"],
  proto: {
    selection: { getter: b.any },
    clear: js,
    has: { args: { type: text }, ...returnsPromise },
    readText: returnsPromise,
    writeText: { args: { text }, ...returnsPromise },
    read: returnsPromise,
    write: { args: { items: b.sequence(ElectronClipboardItem) }, ...returnsPromise },
  },
});

export const ElectronSafeStorage = b.interface("ElectronSafeStorage", {
  ofModule: true,
  name: "SafeStorage",
  namespace: true,
  static: {
    isEncryptionAvailable: { returns: b.bool },
    isAsyncEncryptionAvailable: returnsPromise,
    encryptString: { args: { plainText: text }, ...returnsObject },
    decryptString: { args: { encrypted: anything }, ...returnsText },
    encryptStringAsync: { args: { plainText: text }, ...returnsPromise },
    decryptStringAsync: { args: { encrypted: anything }, ...returnsPromise },
    setUsePlainTextEncryption: { args: { usePlainText: flag } },
    getSelectedStorageBackend: { returns: b.string.utf8 },
  },
});

export const CrashReporterOptions = b.dictionary(
  {
    submitURL: textIfAny,
    productName: textIfAny,
    companyName: textIfAny,
    uploadToServer: flagIfAny,
    rateLimit: flag,
    compress: flagIfAny,
    extra: b.recordOf(b.DOMString, b.DOMString).optional,
    globalExtra: b.recordOf(b.DOMString, b.DOMString).optional,
  },
  { webidl: true },
);

export const ElectronCrashReporter = b.interface("ElectronCrashReporter", {
  ofModule: true,
  name: "CrashReporter",
  namespace: true,
  static: {
    start: { args: { options: CrashReporterOptions.default({}) }, ...js },
    addExtraParameter: { args: { key: text, value: text } },
    removeExtraParameter: { args: { key: text } },
    getParameters: returnsObject,
    getLastCrashReport: { returns: b.any, ...js },
    getUploadedReports: returnsObject,
    getUploadToServer: { returns: b.bool },
    setUploadToServer: { args: { uploadToServer: flag } },
  },
});

export const ElectronAutoUpdater = b.interface("ElectronAutoUpdater", {
  ofModule: true,
  name: "AutoUpdater",
  ...emitter,
  static: {
    setFeedURL: { args: { options: anything, headers: anything }, rustName: "set_feed_url", ...js },
    getFeedURL: { returns: b.string.utf8, rustName: "get_feed_url" },
    checkForUpdates: js,
    quitAndInstall: js,
  },
});

export const ElectronContentTracing = b.interface("ElectronContentTracing", {
  ofModule: true,
  name: "ContentTracing",
  namespace: true,
  static: {
    getCategories: returnsPromise,
    getTraceBufferUsage: returnsPromise,
    startRecording: { args: { options: anything }, ...returnsPromise },
    stopRecording: { args: { resultFilePath: textIfAny }, ...returnsObject },
  },
});

export const ElectronDesktopCapturer = b.interface("ElectronDesktopCapturer", {
  ofModule: true,
  name: "DesktopCapturer",
  namespace: true,
  static: { getSources: { args: { options: anything }, ...returnsPromise } },
});

export const ElectronInAppPurchase = b.interface("ElectronInAppPurchase", {
  ofModule: true,
  name: "InAppPurchase",
  ...emitter,
  static: { canMakePayments: { returns: b.bool } },
});

export const ElectronPushNotifications = b.interface("ElectronPushNotifications", {
  ofModule: true,
  name: "PushNotifications",
  ...emitter,
  static: {
    registerForAPNSNotifications: { rustName: "register", ...returnsPromise },
    unregisterForAPNSNotifications: { rustName: "unregister", ...js },
  },
});
