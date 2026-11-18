import * as b from "../codegen/bindgen-lib.ts";
import {
  anything,
  flag,
  js,
  number,
  numberIfAny,
  ownedTexts,
  returnsFlag,
  returnsObject,
  returnsPromise,
  returnsText,
  sharing,
  text,
  textIfAny,
  withAccessors,
} from "./schema.ts";

export default b.module({ feature: "Desktop", isCold: true, membersInTable: false });

const values = b.rest(b.any);
const property = { getter: b.any, ...js };
const cached = { ...property, cache: true };
const returnsNumber = { returns: b.f64, ...js };
const each = (names: string, signature: object) =>
  Object.fromEntries(
    names
      .split(/\s+/)
      .map(name => [name, { rustName: name.replace(/[A-Z]+[a-z]*/g, it => "_" + it.toLowerCase()), ...signature }]),
  );
const part = (name: string, rustPath: string) =>
  ({ ofModule: true, name, rustPath: `crate::contents::${rustPath}`, noInterfaceObject: true }) as const;
const emitter = { prototypeBase: "EventEmitter" } as const;
const contents = b.ref("ElectronWebContents");
const page = b.ref("ElectronPage");

export const LoadUrlOptions = b.dictionary({
  extraHeaders: textIfAny,
  postData: b.any,
  httpReferrer: b.any,
  userAgent: textIfAny,
  baseURLForDataURL: textIfAny,
  webEngine: flag,
});

export const LoadFileOptions = b.dictionary({ query: b.any, search: textIfAny, hash: textIfAny });

export const CloseOptions = b.dictionary({ waitForBeforeUnload: flag });

export const ContentsInput = b.dictionary({
  type: text,
  modifiers: ownedTexts.nullable,
  x: number.default(0),
  y: number.default(0),
  globalX: numberIfAny,
  globalY: numberIfAny,
  deltaX: number.default(0),
  deltaY: number.default(0),
  button: textIfAny,
  clickCount: number.default(1),
  keyCode: text.default(""),
});

export const ElectronDebugger = b.interface("ElectronDebugger", {
  ...part("Debugger", "parts::Debugger"),
  rustPath: "crate::devtools::debugger::Debugger",
  ...emitter,
  internalFields: { contents },
  proto: {
    attach: js,
    isAttached: { returns: b.bool },
    detach: js,
    sendCommand: { args: { method: text, params: anything }, ...returnsPromise },
  },
});

export const ElectronWebFrameMain = b.interface("ElectronWebFrameMain", {
  ...part("WebFrameMain", "parts::WebFrameMain"),
  ...emitter,
  internalFields: { page, ipc: b.any },
  proto: {
    ipc: property,
    name: { getter: b.string.utf8, ...js },
    url: { getter: b.string.utf8, ...js },
    origin: { getter: b.string.utf8, ...js },
    parent: property,
    top: property,
    frames: property,
    framesInSubtree: property,
    detached: { getter: b.bool },
    osProcessId: { getter: b.u32, ...js },
    processId: { getter: b.u32, ...js },
    routingId: { getter: b.u32, ...js },
    frameToken: { getter: b.string.utf8, ...js },
    frameTreeNodeId: { getter: b.u32 },
    visibilityState: { getter: b.string.utf8, ...js },
    isDestroyed: { returns: b.bool },
    executeJavaScript: {
      args: { code: b.any, userGesture: b.bool.loose.default(false) },
      rustName: "execute_java_script",
      ...returnsPromise,
    },
    send: { args: { channel: anything, values }, ...js },
    postMessage: { args: { channel: b.DOMString, message: anything, transfer: anything }, ...js },
    reload: returnsFlag,
    collectJavaScriptCallStack: { rustName: "collect_java_script_call_stack", ...returnsPromise },
    printToPDF: { args: { options: anything }, rustName: "print_to_pdf", ...returnsPromise },
    ...sharing("nothing", "copyVideoFrameAt saveVideoFrameAs"),
  },
});

const setting = (getter: object) => ({ getter, setter: { type: b.any, ...js }, ...js });

export const ElectronWebContents = b.interface("ElectronWebContents", {
  ...part("WebContents", "Contents"),
  ...emitter,
  internalFields: {
    owner: contents,
    parent: contents,
    openedBy: contents,
    page,
    embedder: page,
    view: b.ref("DesktopView"),
    guest: b.ref("WebEngineRemote"),
    pendingGuest: b.ref("WebEngineRemote"),
    inspector: ElectronDebugger,
    opener: b.any,
    preferences: b.any,
    openHandler: b.any,
    settings: b.any,
    subscriber: b.any,
  },
  proto: withAccessors({
    id: { getter: b.u32 },
    ipc: cached,
    session: { getter: b.ref("ElectronSession") },
    navigationHistory: cached,
    hostWebContents: { getter: b.any, rustName: "nobody" },
    devToolsWebContents: { getter: b.any, rustName: "nobody" },
    mainFrame: property,
    focusedFrame: property,
    opener: property,
    debugger: property,
    audioMuted: setting(b.bool),
    backgroundThrottling: setting(b.bool),
    caretBrowsingEnabled: setting(b.bool),
    frameRate: setting(b.f64),
    userAgent: setting(b.string.utf8),
    zoomFactor: setting(b.f64),
    zoomLevel: setting(b.f64),
    zoomMode: setting(b.string.utf8),
    isAudioMuted: { rustName: "get_audio_muted", ...returnsFlag },
    isCaretBrowsingEnabled: { rustName: "get_caret_browsing_enabled", ...returnsFlag },
    getBackgroundThrottling: returnsFlag,
    getFrameRate: returnsNumber,
    getUserAgent: returnsText,
    getZoomFactor: returnsNumber,
    getZoomLevel: returnsNumber,
    getZoomMode: returnsText,
    ...each(
      "setAudioMuted setBackgroundThrottling setCaretBrowsingEnabled setFrameRate setUserAgent setZoomFactor setZoomLevel setZoomMode",
      { args: { value: anything }, ...js },
    ),

    ...each("canGoBack canGoForward", { returns: b.bool }),
    canGoToOffset: { args: { offset: b.i32.wrap.default(0) }, returns: b.bool },
    ...each("goBack goForward clearHistory", js),
    goToOffset: { args: { offset: b.i32.wrap.default(0) }, ...js },
    goToIndex: { args: { index: b.i32.wrap.default(-1) }, ...js },
    loadURL: {
      args: { url: text, options: LoadUrlOptions.nullable.default({}) },
      rustName: "load_url",
      ...returnsObject,
    },
    loadFile: { args: { file: anything, options: LoadFileOptions.nullable.default({}) }, ...returnsObject },
    ...each("reload reloadIgnoringCache stop destroy focus forcefullyCrashRenderer invalidate", js),
    close: { args: { options: CloseOptions.nullable.default({}) }, ...js },
    ...each("getURL getTitle getType getMediaSourceId getWebRTCIPHandlingPolicy getDevToolsTitle", returnsText),
    ...each("isLoading isWaitingForResponse isCrashed isCurrentlyAudible isDevToolsOpened", returnsFlag),
    isLoadingMainFrame: returnsFlag,
    isDestroyed: { returns: b.bool },
    isFocused: { returns: b.bool },
    ...sharing("no", "isBeingCaptured isDevToolsFocused isOffscreen isPainting", { returns: b.bool }),
    ...sharing("nothing", "addWorkSpace removeWorkSpace setDevToolsWebContents startPainting stopPainting"),
    clone: { rustName: "duplicate", ...returnsObject },
    getWebRTCUDPPortRange: { rustName: "get_udp_ports", ...returnsObject },
    ...each(
      "getOSProcessId getProcessId getOwnerBrowserWindow getLastWebPreferences getOrCreateDevToolsTargetId getAllSharedWorkers",
      returnsObject,
    ),
    ...each("undo redo cut copy paste pasteAndMatchStyle delete selectAll unselect", js),
    ...each("endFrameSubscription showDefinitionForSelection", js),
    startDrag: { args: { item: b.object }, ...js },
    ...each(
      `send postMessage downloadURL copyImageAt replace replaceMisspelling stopFindInPage print beginFrameSubscription
      adjustSelection centerSelection closeDevTools inspectElement scrollToBottom scrollToTop openDevTools toggleDevTools
      disableDeviceEmulation enableDeviceEmulation setImageAnimationPolicy setDevToolsTitle
      setWebRTCIPHandlingPolicy setWebRTCUDPPortRange copyVideoFrameAt saveVideoFrameAs
      inspectServiceWorker inspectSharedWorker inspectSharedWorkerById`,
      { args: { values }, ...js },
    ),
    ...each(
      `executeJavaScript executeJavaScriptInIsolatedWorld insertCSS removeInsertedCSS insertText capturePage
      getPrintersAsync printToPDF savePage setVisualZoomLevelLimits takeHeapSnapshot`,
      { args: { values }, ...returnsPromise },
    ),
    sendToFrame: { args: { frame: b.any, values }, ...returnsFlag },
    findInPage: { args: { values }, returns: b.u32, ...js },
    sendInputEvent: { args: { event: ContentsInput }, ...js },
    setIgnoreMenuShortcuts: { args: { ignores: flag } },
    setWindowOpenHandler: { args: { handler: b.callable.nullable } },
  }),
});

const module = (name: string, members: object) =>
  b.interface(name, { ofModule: true, namespace: true, static: members } as any);

export const ElectronWebContentsModule = module("ElectronWebContentsModule", {
  create: { args: { preferences: anything }, ...returnsObject },
  fromId: { args: { id: numberIfAny }, ...returnsObject },
  fromFrame: { args: { frame: b.object }, ...returnsObject },
  fromDevToolsTargetId: { args: { id: anything }, ...returnsObject },
  getAllWebContents: { rustName: "all", ...returnsObject },
  getFocusedWebContents: { rustName: "focused", ...returnsObject },
});

export const ElectronWebFrameMainModule = module("ElectronWebFrameMainModule", {
  fromId: { args: { processId: anything, routingId: anything }, ...returnsObject },
  fromFrameToken: { args: { processId: anything, token: anything }, ...returnsObject },
});

/** A document, as the realm of the app sees it. */
export const ElectronPage = b.interface("ElectronPage", {
  ...part("Page", "page::Page"),
  internalFields: {
    contents,
    parent: page,
    opener: page,
    handle: ElectronWebFrameMain,
    document: b.ref("RendererDocument"),
    numbered: b.any,
    frames: b.any,
    cleanups: b.any,
    notifications: b.any,
  },
  proto: {},
});
