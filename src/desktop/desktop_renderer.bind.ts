// What a preload script sees. Each realm has its own.
import * as b from "../codegen/bindgen-lib.ts";
import { anything, flag, js, number, returnsObject, returnsPromise, sharing } from "./schema.ts";

export default b.module({ feature: "Desktop", isCold: true, membersInTable: false });

const emitter = { ofModule: true, namespace: true, prototypeBase: "EventEmitter" } as const;
const value = { getter: b.any, capability: "heap" } as const;
const message = { channel: anything, args: b.rest(b.any) };

export const BridgeLink = b.interface("BridgeLink", {
  ofModule: true,
  rustPath: "crate::bridge::Ends",
  noInterfaceObject: true,
  internalFields: ["first", "second"],
});

export const BridgedFunction = b.interface("BridgedFunction", {
  ofModule: true,
  name: "Function",
  rustPath: "crate::bridge::Bridged",
  noInterfaceObject: true,
  internalFields: { target: b.any, receiver: b.any, link: BridgeLink },
  callInstance: { args: { values: b.rest(b.any) }, ...returnsObject },
});

export const RendererPreload = b.interface("RendererPreload", {
  ofModule: true,
  rustPath: "crate::renderer::preload::Preload",
  noInterfaceObject: true,
  internalFields: { global: b.any, document: b.ref("RendererDocument"), process: b.any, frame: b.any, pending: b.any },
  proto: {},
});

export const RendererDocument = b.interface("RendererDocument", {
  ofModule: true,
  rustPath: "crate::renderer::Document",
  noInterfaceObject: true,
  internalFields: {
    preload: RendererPreload,
    controller: b.any,
    inspected: b.any,
    worlds: b.any,
    needed: b.any,
    owner: b.any,
  },
  proto: {},
});

export const RendererIpc = b.interface("RendererIpc", {
  name: "IpcRenderer",
  ...emitter,
  static: {
    send: { args: message, ...js },
    sendSync: { args: message, ...returnsObject },
    sendToHost: {},
    invoke: { args: message, ...returnsPromise },
    postMessage: { args: { channel: anything, message: anything, transfer: b.sequence(b.object).optional }, ...js },
  },
});

export const ExecutionScript = b.dictionary({ func: b.callable, args: b.object.optional });

export const RendererContextBridge = b.interface("RendererContextBridge", {
  ofModule: true,
  name: "ContextBridge",
  namespace: true,
  static: {
    exposeInMainWorld: { args: { apiKey: b.DOMString, api: anything }, ...js },
    exposeInIsolatedWorld: { args: { worldId: b.u32.wrap, apiKey: b.DOMString, api: anything }, ...js },
    executeInMainWorld: { args: { executionScript: ExecutionScript }, ...returnsObject },
  },
});

export const WebSource = b.dictionary({ code: b.string.loose.utf8.owned });

export const RendererWebFrame = b.interface("RendererWebFrame", {
  ofModule: true,
  name: "WebFrame",
  rustPath: "crate::renderer::preload::WebFrame",
  noInterfaceObject: true,
  prototypeBase: "EventEmitter",
  proto: {
    ...Object.fromEntries(
      "routingId frameToken top parent opener firstChild nextSibling"
        .split(" ")
        .map(it => [it, { getter: b.any, ...js }]),
    ),
    getZoomFactor: { returns: b.f64, ...js },
    setZoomFactor: { args: { factor: number }, ...js },
    getZoomLevel: { returns: b.f64, ...js },
    setZoomLevel: { args: { level: number }, ...js },
    insertCSS: { args: { css: b.DOMString, options: anything }, rustName: "insert_css", ...returnsObject },
    removeInsertedCSS: { args: { key: b.DOMString }, rustName: "remove_inserted_css", ...js },
    insertText: { args: { text: b.DOMString }, ...js },
    executeJavaScript: { args: { code: b.DOMString, userGesture: anything, callback: anything }, ...returnsPromise },
    executeJavaScriptInIsolatedWorld: {
      args: { worldId: b.u32.wrap, scripts: b.sequenceVec(WebSource), userGesture: flag, callback: anything },
      ...returnsPromise,
    },
    getResourceUsage: returnsObject,
    getIsolatedWorlds: returnsObject,
    findFrameByRoutingId: { args: { routingId: number }, ...returnsObject },
    findFrameByToken: { args: { frameToken: b.DOMString }, ...returnsObject },
    findFrameByName: { args: { name: b.DOMString }, ...returnsObject },
    getFrameForSelector: { args: { selector: b.DOMString }, ...returnsObject },
    isWordMisspelled: { returns: b.bool },
    getWordSuggestions: returnsObject,
    ...sharing("nothing", "clearCache setIsolatedWorldInfo setSpellCheckProvider setVisualZoomLevelLimits"),
  },
});

export const RendererWebUtils = b.interface("RendererWebUtils", {
  ofModule: true,
  name: "WebUtils",
  namespace: true,
  static: { getPathForFile: { args: { file: b.any }, ...returnsObject } },
});

export const RendererCrashReporter = b.interface("RendererCrashReporter", {
  ofModule: true,
  name: "CrashReporter",
  namespace: true,
  static: { getParameters: returnsObject, ...sharing("nothing", "addExtraParameter removeExtraParameter") },
});

export const RendererElectron = b.interface("RendererElectron", {
  ofModule: true,
  name: "Electron",
  namespace: true,
  static: {
    clipboard: { getter: b.any, capability: "js" },
    contextBridge: value,
    crashReporter: value,
    ipcRenderer: value,
    nativeImage: value,
    shell: { getter: b.any, capability: "js" },
    webFrame: { getter: b.any, ...js },
    webUtils: value,
  },
});

export const RendererProcess = b.interface("RendererProcess", {
  name: "process",
  ...emitter,
  static: {
    nextTick: { args: { callback: b.callable, args: b.rest(b.any) }, ...js },
    emitWarning: { args: { warning: b.DOMString }, rustName: "warn", ...js },
    uptime: { returns: b.f64, capability: "js" },
    cwd: { returns: b.string.utf8 },
    crash: js,
    hang: js,
    getBlinkMemoryInfo: returnsObject,
    getCPUUsage: { rustName: "get_cpu_usage", ...returnsObject },
    getCreationTime: { returns: b.f64 },
    getHeapStatistics: returnsObject,
    getProcessMemoryInfo: returnsPromise,
    getSystemMemoryInfo: returnsObject,
    getSystemVersion: { returns: b.string.utf8 },
  },
});
