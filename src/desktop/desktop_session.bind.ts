import * as b from "../codegen/bindgen-lib.ts";
import {
  anything,
  flag,
  flagIfAny,
  js,
  number,
  ownedTexts,
  returnsFlag,
  returnsObject,
  returnsPromise,
  returnsText,
  sharing,
  text,
  textIfAny,
} from "./schema.ts";

export default b.module({ feature: "Desktop", isCold: true, membersInTable: false });

const maybe = b.string.utf8.nullable;
const property = { getter: b.any, ...js };
const cached = { ...property, cache: true };
const handler = b.callable.nullable;
const values = b.rest(b.any);
const each = (names: string, signature: object) =>
  Object.fromEntries(
    names
      .split(" ")
      .map(name => [name, { rustName: name.replace(/[A-Z]+[a-z]*/g, it => "_" + it.toLowerCase()), ...signature }]),
  );
const part = (name: string, rustPath: string) =>
  ({ ofModule: true, name, rustPath: `crate::session::${rustPath}` }) as const;
const emitter = { prototypeBase: "EventEmitter" } as const;

export const CookieDetails = b.dictionary({
  url: maybe,
  name: maybe,
  value: maybe,
  domain: maybe,
  path: maybe,
  secure: flagIfAny,
  httpOnly: flag,
  expirationDate: b.f64.nullable,
  sameSite: maybe,
});

export const CookieFilter = b.dictionary({
  url: maybe,
  name: maybe,
  domain: maybe,
  path: maybe,
  secure: flagIfAny,
  session: flagIfAny,
  httpOnly: flagIfAny,
});

export const ElectronCookies = b.interface("ElectronCookies", {
  ...part("Cookies", "cookies::Cookies"),
  ...emitter,
  proto: {
    get: { args: { filter: CookieFilter.nullable.default({}) }, ...returnsPromise },
    set: { args: { details: CookieDetails }, ...returnsPromise },
    remove: { args: { url: text, name: text }, ...returnsPromise },
    flushStore: returnsPromise,
  },
});

export const ElectronWebRequest = b.interface("ElectronWebRequest", {
  ...part("WebRequest", "parts::WebRequest"),
  proto: each(
    "onBeforeRequest onBeforeSendHeaders onSendHeaders onHeadersReceived onResponseStarted onBeforeRedirect onCompleted onErrorOccurred",
    { args: { values }, ...js },
  ),
});

const legacy = { args: { scheme: text, handler: b.callable }, ...returnsFlag };
const aboutScheme = { args: { scheme: text }, returns: b.bool };

export const ElectronProtocol = b.interface("ElectronProtocol", {
  ...part("Protocol", "protocol::Protocol"),
  proto: {
    registerSchemesAsPrivileged: { args: { customSchemes: b.object }, ...js },
    handle: { args: { scheme: text, handler: b.callable }, ...js },
    unhandle: { args: { scheme: text }, ...js },
    serve: { args: { origin: text, server: handler }, ...js },
    registerSource: { args: { scheme: text, source: b.object }, ...js },
    getSource: { args: { scheme: text }, ...returnsObject },
    ...sharing("is_protocol_handled", "isProtocolHandled isProtocolRegistered isProtocolIntercepted", aboutScheme),
    ...sharing("unregister_protocol", "unregisterProtocol uninterceptProtocol", { ...aboutScheme, ...js }),
    ...sharing("register_string", "registerStringProtocol interceptStringProtocol", legacy),
    ...sharing("register_buffer", "registerBufferProtocol interceptBufferProtocol", legacy),
    ...sharing("register_stream", "registerStreamProtocol interceptStreamProtocol", legacy),
    ...sharing("register_file", "registerFileProtocol interceptFileProtocol", legacy),
    ...sharing("register_http", "registerHttpProtocol interceptHttpProtocol", legacy),
  },
});

export const ElectronServiceWorkers = b.interface("ElectronServiceWorkers", {
  ...part("ServiceWorkers", "parts::ServiceWorkers"),
  ...emitter,
  proto: {
    getAllRunning: returnsObject,
    getWorkerFromVersionID: { args: { versionId: number }, rustName: "get_worker", ...returnsObject },
    ...sharing("get_info", "getInfoFromVersionID getFromVersionID", { args: { versionId: number }, ...returnsObject }),
    startWorkerForScope: { args: { scope: text }, ...returnsPromise },
  },
});

const extensions = {
  getAllExtensions: returnsObject,
  getExtension: { args: { extensionId: text }, ...returnsObject },
  loadExtension: { args: { values }, ...returnsPromise },
  removeExtension: { args: { extensionId: text } },
};

export const ElectronExtensions = b.interface("ElectronExtensions", {
  ...part("Extensions", "parts::Extensions"),
  ...emitter,
  proto: extensions,
});

export const ElectronNetLog = b.interface("ElectronNetLog", {
  ofModule: true,
  name: "NetLog",
  namespace: true,
  static: { currentlyLogging: { getter: b.bool }, startLogging: returnsPromise, stopLogging: returnsPromise },
});

export const ElectronDownloadItem = b.interface("ElectronDownloadItem", {
  ...part("DownloadItem", "download::DownloadItem"),
  ...emitter,
  internalFields: { dialogOptions: b.any },
  proto: {
    savePath: { getter: text, setter: true },
    getSavePath: { returns: b.string.utf8, rustName: "get_save_path" },
    setSavePath: { args: { path: text }, rustName: "set_save_path" },
    getSaveDialogOptions: returnsObject,
    setSaveDialogOptions: { args: { options: b.object } },
    pause: {},
    resume: {},
    cancel: {},
    ...each(
      "isPaused canResume getURL getURLChain getInitiatorOrigin getMimeType hasUserGesture getFilename getTotalBytes getReceivedBytes getPercentComplete getCurrentBytesPerSecond getContentDisposition getState getLastModifiedTime getETag getStartTime getEndTime",
      returnsObject,
    ),
  },
});

export const ElectronSession = b.interface("ElectronSession", {
  ...part("Session", "Session"),
  ...emitter,
  internalFields: { handlers: b.any },
  proto: {
    cookies: cached,
    protocol: cached,
    webRequest: cached,
    serviceWorkers: cached,
    extensions: cached,
    netLog: { getter: b.any, capability: "heap" },
    storagePath: { getter: maybe },
    availableSpellCheckerLanguages: cached,
    spellCheckerEnabled: { getter: b.bool.loose, setter: true },
    fetch: { args: { input: b.any, init: anything }, ...returnsPromise },
    isPersistent: { returns: b.bool },
    getStoragePath: { returns: maybe, rustName: "get_storage_path" },
    getUserAgent: returnsText,
    setUserAgent: { args: { userAgent: text, acceptLanguages: textIfAny } },
    setProxy: { args: { config: b.object }, ...returnsPromise },
    resolveProxy: { args: { url: text }, ...returnsPromise },
    resolveHost: { args: { host: text, options: anything }, ...returnsPromise },
    allowNTLMCredentialsForDomains: { args: { domains: text }, rustName: "allow_ntlm_credentials_for_domains", ...js },
    setDownloadPath: { args: { path: text } },
    setWebEngineHosts: { args: { hosts: ownedTexts } },
    ...each(
      "setBluetoothPairingHandler setCertificateVerifyProc setDevicePermissionHandler setDisplayMediaRequestHandler setPermissionCheckHandler setPermissionRequestHandler",
      { args: { handler: b.any, options: anything }, ...js },
    ),
    setUSBProtectedClassesHandler: {
      args: { handler: b.any, options: anything },
      rustName: "set_usb_protected_classes_handler",
      ...js,
    },
    ...each("disableNetworkEmulation enableNetworkEmulation setSpellCheckerDictionaryDownloadURL", {
      args: { values },
      ...js,
    }),
    setSSLConfig: { args: { values }, rustName: "set_ssl_config", ...js },
    ...each(
      "clearAuthCache clearCache clearCodeCaches clearData clearHostResolverCache clearSharedDictionaryCache clearSharedDictionaryCacheForIsolationKey clearStorageData closeAllConnections forceReloadProxyConfig getCacheSize",
      { args: { values }, ...returnsPromise },
    ),
    ...sharing(
      "nothing_to_list",
      "getSharedDictionaryInfo getSharedDictionaryUsageInfo listWordsInSpellCheckerDictionary",
      returnsPromise,
    ),
    ...sharing("nothing", "preconnect registerLocalAIHandler"),
    setCodeCachePath: { args: { path: text }, ...js },
    getBlobData: returnsPromise,
    flushStorageData: {},
    registerPreloadScript: { args: { script: b.object }, ...returnsText },
    unregisterPreloadScript: { args: { id: text }, ...js },
    getPreloadScripts: returnsObject,
    setPreloads: { args: { preloads: ownedTexts }, ...js },
    getPreloads: returnsObject,
    downloadURL: {
      args: { url: text, options: anything, webContents: anything, fileName: textIfAny },
      rustName: "download_url",
      ...js,
    },
    createInterruptedDownload: { args: { options: b.object }, ...js },
    setSpellCheckerEnabled: { args: { enable: flag }, rustName: "set_spell_checker_enabled" },
    isSpellCheckerEnabled: { returns: b.bool, rustName: "get_spell_checker_enabled" },
    addWordToSpellCheckerDictionary: { args: { word: text }, ...returnsFlag },
    removeWordFromSpellCheckerDictionary: { returns: b.bool },
    setSpellCheckerLanguages: { args: { languages: ownedTexts } },
    getSpellCheckerLanguages: returnsObject,
    ...extensions,
  },
});

export const ElectronSessions = b.interface("ElectronSessions", {
  ofModule: true,
  name: "Sessions",
  namespace: true,
  static: {
    fromPartition: { args: { partition: text.default("") }, returns: ElectronSession, ...js },
    fromPath: { args: { path: text }, returns: ElectronSession, ...js },
    defaultSession: { getter: ElectronSession, ...js },
  },
});

export const ElectronIncomingMessage = b.interface("ElectronIncomingMessage", {
  ...part("IncomingMessage", "net::IncomingMessage"),
  prototypeBase: "Readable",
  proto: {
    _read: { rustName: "read", ...js },
    _destroy: { args: { error: b.any, callback: b.callable }, rustName: "destroy", ...js },
  },
});

export const ElectronClientRequest = b.interface("ElectronClientRequest", {
  ...part("ClientRequest", "net::ClientRequest"),
  prototypeBase: "Writable",
  internalFields: { response: ElectronIncomingMessage, given: b.any },
  proto: {
    chunkedEncoding: { getter: b.bool.loose, setter: js },
    setHeader: { args: { name: anything, value: anything }, ...js },
    getHeader: { args: { name: textIfAny }, ...returnsObject },
    removeHeader: { args: { name: textIfAny }, ...js },
    followRedirect: js,
    getUploadProgress: returnsObject,
    abort: js,
    _write: { args: { chunk: b.any, encoding: b.any, callback: b.callable }, rustName: "write", ...js },
    _final: { args: { callback: b.callable }, rustName: "finish", ...js },
  },
});

export const SocketBinaryType = b.enumeration({ NodeBuffer: "nodebuffer", ArrayBuffer: "arraybuffer", Blob: "blob" });
const eventHandler = { ...property, setter: js };

export const ElectronWebSocket = b.interface("ElectronWebSocket", {
  ...part("WebSocket", "socket::WebSocket"),
  prototypeBase: "EventTarget",
  internalFields: { target: b.any },
  constants: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
  construct: { args: { url: anything, options: anything }, passNewTarget: true, ...js },
  proto: {
    onopen: eventHandler,
    onmessage: eventHandler,
    onerror: eventHandler,
    onclose: eventHandler,
    url: { getter: b.string.utf8 },
    readyState: { getter: b.u16 },
    bufferedAmount: { getter: b.f64 },
    protocol: { getter: b.string.utf8 },
    extensions: { getter: b.string.utf8 },
    binaryType: { getter: SocketBinaryType, setter: true, ignoreInvalid: true },
    close: { args: { code: b.u16.clamp.optional, reason: b.USVString.utf8.optional }, ...js },
    send: { args: { data: anything }, ...js },
  },
});

export const ElectronNet = b.interface("ElectronNet", {
  ofModule: true,
  name: "Net",
  namespace: true,
  static: {
    WebSocket: { getter: b.any, capability: "heap" },
    online: { getter: b.bool, ...js },
    isOnline: { ...returnsFlag, rustName: "get_online" },
    fetch: { args: { input: b.any, init: anything }, ...returnsPromise },
    request: { args: { options: b.any, callback: anything }, returns: ElectronClientRequest, ...js },
    resolveHost: { args: { host: text, options: anything }, ...returnsPromise },
  },
});
