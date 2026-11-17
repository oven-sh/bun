import * as b from "../../../codegen/bindgen-lib.ts";
import { ImageBitmapFactories } from "../canvas/canvas.bind.ts";
import { DesktopEventTarget } from "../core/core.bind.ts";
import { OnEvent, WindowTarget } from "../events/events.bind.ts";

export default b.module({ rustPath: "crate::api::window", feature: "Desktop", isCold: true, membersInTable: false });

const path = "crate::api::window";
const heap = { capability: "heap" } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const string = b.DOMString.impl.as("crate::api::core::DomString");
const usv = b.USVString.impl.as("crate::api::core::DomString");
const text = b.DOMString.utf8;
const utf8 = b.string.utf8;
const long = b.i32.wrap;
const promise = { returns: b.any.returning("Promise"), rejects: true, ...js } as const;
const inWindows = ["Window"] as const;
const everywhere = ["Window", "Worker"] as const;
const words = (names: string) => names.trim().split(/\s+/);
const each = <T>(names: string, member: T) => Object.fromEntries(words(names).map(name => [name, member]));
const handlers = (events: string) =>
  Object.fromEntries(
    words(events).map(it => [
      `on${it.toLowerCase()}`,
      OnEvent.of(`crate::api::core::atom!("${it}")`, { lenientThis: it === "mouseenter" || it === "mouseleave" }),
    ]),
  );
const ofWindow = { internalFields: { window: b.ref("DomWindow") } } as const;
const ofScope = { internalFields: { scope: WindowTarget } } as const;

const startTimer = {
  args: { handler: b.any, timeout: long.default(0), arguments: b.any.variadic },
  returns: b.i32,
  requiredArguments: 1,
  length: 1,
  runsUnseenCode: true,
  ...js,
} as const;
const clearTimer = { args: { id: long.default(0) }, rustName: "clear_timer", ...runs } as const;

export const WindowOrWorkerGlobalScope = b.mixin("WindowOrWorkerGlobalScope", {
  on: WindowTarget,
  proto: {
    origin: { getter: string, replaceable: true, ...heap },
    performance: { getter: b.ref("DomPerformance"), replaceable: true, ...runs },
    caches: { getter: b.ref("CacheStorage"), secure: true, ...heap },
    isSecureContext: { getter: b.bool, ...heap },
    crossOriginIsolated: { getter: b.bool, ...heap },
    trustedTypes: { getter: b.ref("TrustedTypePolicyFactory"), ...heap },
    reportError: { args: { error: b.any }, length: 1, requiredArguments: 1, ...runs },
    setTimeout: startTimer,
    setInterval: startTimer,
    clearTimeout: clearTimer,
    clearInterval: clearTimer,
  },
});

const indexedDB = { getter: b.ref("IDBFactory"), cache: true, rustName: "indexed_db", ...heap } as const;
const data = b.rest(b.any);
const label = text.default("default");

export const ConsoleNamespace = b.interface("ConsoleNamespace", {
  exposed: everywhere,
  name: "console",
  namespace: true,
  rustPath: `${path}::Console`,
  static: {
    assert: { args: { condition: b.bool.loose.default(false), data }, ...runs },
    ...each("debug dir dirxml error group groupCollapsed info log table trace warn", { args: { data }, ...runs }),
    ...each("clear groupEnd profile profileEnd timeStamp", { rustName: "nothing" }),
    ...each("count countReset time timeEnd", { args: { label }, ...runs }),
    timeLog: { args: { label, data }, ...runs },
  },
});

export const IdleRequestOptions = b.dictionary({ timeout: b.u32.wrap.default(0) }, { webidl: true });

const scheduler = { getter: b.ref("Scheduler"), cache: true, replaceable: true, ...heap } as const;
const itself = { getter: b.any, rustName: "itself", ...heap } as const;
const bar = { getter: b.ref("BarProp"), cache: true, replaceable: true, rustName: "bar", ...heap } as const;
const measure = (rustName: string, getter: any) => ({ getter, replaceable: true, rustName, ...runs }) as const;
const requestFrame = {
  args: { callback: b.callable, phase: b.any.omittable },
  returns: b.u32,
  rustName: "request_animation_frame",
  ...runs,
} as const;
const cancelFrame = { args: { handle: b.u32.wrap }, rustName: "cancel_animation_frame", ...heap } as const;
const flag = b.bool.loose.default(false);

export const DomWindow = b.interface("DomWindow", {
  name: "Window",
  extends: WindowTarget,
  rustPath: `${path}::Window`,
  global: true,
  namedPropertiesObject: "Bun::createWindowProperties",
  exposed: inWindows,
  includes: [ImageBitmapFactories, WindowOrWorkerGlobalScope],
  internalFields: {
    emptyFrame: b.any,
    frameCallbacks: b.any,
    idleCallbacks: b.any,
    beforeFrame: b.any,
    localStorage: b.ref("WebStorage"),
    sessionStorage: b.ref("WebStorage"),
  },
  constants: { TEMPORARY: 0, PERSISTENT: 1 },
  proto: {
    window: { ...itself, unforgeable: true },
    self: { ...itself, replaceable: true },
    frames: { ...itself, replaceable: true },
    document: { getter: b.ref("Doc").nullable, unforgeable: true, field: "document" },
    name: { getter: string, setter: true, ...runs },
    location: { getter: b.ref("Location"), cache: true, putForwards: "href", unforgeable: true, ...heap },
    history: { getter: b.ref("History"), cache: true, ...heap },
    navigation: { getter: b.ref("Navigation"), cache: true, replaceable: true, ...heap },
    close: runs,
    closed: { getter: b.bool, ...runs },
    focus: runs,
    requestResize: { ...runs, throws: true },
    print: js,
    stop: runs,
    length: { getter: b.u32, replaceable: true },
    top: { getter: b.any, unforgeable: true, ...runs },
    opener: { getter: b.any, setter: js, ...runs },
    parent: { getter: b.any, replaceable: true, ...runs },
    frameElement: { getter: b.ref("DomElement").nullable, ...runs },
    open: {
      args: {
        url: usv.default(""),
        target: string.default("_blank"),
        features: b.DOMString.nullToEmpty.impl.as("crate::api::core::DomString").default(""),
      },
      returns: b.any,
      ...js,
    },
    customElements: { getter: b.any, ...heap },
    ...each("locationbar menubar personalbar scrollbars statusbar toolbar", bar),
    status: { getter: string, setter: true, ...heap },
    navigator: { getter: b.ref("DomNavigator"), cache: true, ...heap },
    clientInformation: { getter: b.ref("DomNavigator"), replaceable: true, ...heap },
    indexedDB,
    localStorage: { getter: b.ref("WebStorage"), cache: "localStorage", ...js },
    sessionStorage: { getter: b.ref("WebStorage"), cache: "sessionStorage", ...js },
    originAgentCluster: { getter: b.bool },
    external: { getter: b.ref("External"), cache: true, replaceable: true, ...heap },
    event: { getter: b.any, replaceable: true, rustName: "current_event", ...heap },
    scheduler,
    screen: { getter: b.ref("Screen"), cache: true, replaceable: true, ...heap },
    visualViewport: { getter: b.ref("VisualViewport"), cache: true, replaceable: true, ...heap },
    devicePixelRatio: measure("device_pixel_ratio", b.f64),
    innerWidth: measure("inner_width", b.i32),
    innerHeight: measure("inner_height", b.i32),
    outerWidth: measure("outer_width", b.i32),
    outerHeight: measure("outer_height", b.i32),
    ...each("screenX screenLeft", measure("screen_x", b.i32)),
    ...each("screenY screenTop", measure("screen_y", b.i32)),
    ...each("scrollX pageXOffset", measure("scroll_x", b.f64)),
    ...each("scrollY pageYOffset", measure("scroll_y", b.f64)),
    ...each("moveTo moveBy", { args: { x: long, y: long } }),
    ...each("resizeTo resizeBy", { args: { width: long, height: long } }),
    alert: { args: { message: string.default("") }, ...js },
    confirm: { args: { message: string.default("") }, returns: b.bool, ...js },
    prompt: { args: { message: string.default(""), initial: string.default("") }, returns: string.nullable, ...js },
    ...each("blur captureEvents releaseEvents", { rustName: "do_nothing" }),
    ...each("requestAnimationFrame webkitRequestAnimationFrame", requestFrame),
    ...each("cancelAnimationFrame webkitCancelAnimationFrame", cancelFrame),
    paintNow: { args: { deliversResizes: flag }, ...runs },
    requestIdleCallback: {
      args: { callback: b.callable, options: IdleRequestOptions.default({}) },
      returns: b.u32,
      ...heap,
    },
    cancelIdleCallback: { args: { handle: b.u32.wrap }, ...heap },
    getSelection: { returns: b.ref("Selection").nullable, ...heap },
    find: {
      args: { text: text.default(""), caseSensitive: flag, backwards: flag, wrap: flag },
      returns: b.bool,
      ...runs,
    },
    ...handlers(`abort afterprint animationcancel animationend animationiteration animationstart auxclick beforeinput
      beforematch beforeprint beforetoggle beforeunload beforexrselect blur cancel canplay canplaythrough change click
      close command contentvisibilityautostatechange contextlost contextmenu contextrestored cuechange dblclick drag
      dragend dragenter dragleave dragover dragstart drop durationchange emptied ended error focus formdata
      gotpointercapture hashchange input invalid keydown keypress keyup languagechange load loadeddata loadedmetadata
      loadstart lostpointercapture message messageerror mousedown mouseenter mouseleave mousemove mouseout mouseover
      mouseup mousewheel offline online pagehide pagereveal pageshow pageswap pause play playing pointercancel
      pointerdown pointerenter pointerleave pointermove pointerout pointerover pointerrawupdate pointerup popstate
      progress ratechange rejectionhandled reset resize scroll scrollend scrollsnapchange scrollsnapchanging
      securitypolicyviolation seeked seeking select selectionchange selectstart slotchange stalled storage submit
      suspend timeupdate toggle transitioncancel transitionend transitionrun transitionstart unhandledrejection unload
      volumechange waiting webkitAnimationEnd webkitAnimationIteration webkitAnimationStart webkitTransitionEnd wheel`),
  },
});

export const BarProp = b.interface("BarProp", {
  exposed: inWindows,
  ...ofWindow,
  proto: { visible: { getter: b.bool, ...runs } },
});

export const External = b.interface("External", {
  exposed: inWindows,
  proto: each("AddSearchProvider IsSearchProviderInstalled", { rustName: "do_nothing" }),
});

export const IdleDeadline = b.interface("IdleDeadline", {
  rustPath: `${path}::IdleDeadline`,
  exposed: inWindows,
  proto: { timeRemaining: { returns: b.f64 }, didTimeout: { getter: b.bool } },
});

// ───────────────────────────── the screen ─────────────────────────────

const target = (name: string) => ({ extends: DesktopEventTarget, rustPath: `${path}::${name}` }) as const;

export const OrientationLockType = b.enumeration([
  "any",
  "natural",
  "landscape",
  "portrait",
  "portrait-primary",
  "portrait-secondary",
  "landscape-primary",
  "landscape-secondary",
]);
export const ScreenOrientation = b.interface("ScreenOrientation", {
  extends: DesktopEventTarget,
  exposed: inWindows,
  proto: {
    lock: { args: { orientation: OrientationLockType }, ...promise },
    unlock: {},
    type: { getter: utf8, rustName: "kind" },
    angle: { getter: b.u16 },
    ...handlers("change"),
  },
});

export const Screen = b.interface("Screen", {
  ...target("Screen"),
  ...ofWindow,
  exposed: inWindows,
  proto: {
    ...each("availWidth availHeight width height availLeft availTop", { getter: b.i32 }),
    ...each("colorDepth pixelDepth", { getter: b.u32, rustName: "color_depth" }),
    orientation: { getter: ScreenOrientation, cache: true, ...heap },
    isExtended: { getter: b.bool, secure: true },
    ...handlers("change"),
  },
});

export const VisualViewport = b.interface("VisualViewport", {
  ...target("VisualViewport"),
  ...ofWindow,
  exposed: inWindows,
  proto: {
    ...each("offsetLeft offsetTop", { getter: b.f64, rustName: "offset" }),
    ...each("pageLeft pageTop width height", { getter: b.f64, ...runs }),
    scale: { getter: b.f64 },
    ...handlers("resize scroll scrollend"),
  },
});

export const WindowControlsOverlay = b.interface("WindowControlsOverlay", {
  ...target("WindowControlsOverlay"),
  ...ofWindow,
  exposed: inWindows,
  proto: {
    visible: { getter: b.bool },
    getTitlebarAreaRect: { returns: b.ref("DOMRect"), capability: "heap" },
    ...handlers("geometrychange"),
  },
});

// ───────────────────────────── navigator ─────────────────────────────

export const AnyNavigator = b.interface("AnyNavigator", {
  abstract: true,
  internalFields: {
    scope: WindowTarget,
    connection: b.ref("NetworkInformation"),
    userAgentData: b.ref("NavigatorUAData"),
    languages: b.any,
    storage: b.ref("StorageManager"),
  },
});

export const NavigatorEverywhere = b.mixin("NavigatorEverywhere", {
  on: AnyNavigator,
  proto: {
    ...each("appCodeName appName appVersion platform product userAgent", { getter: utf8 }),
    language: { getter: utf8 },
    languages: { getter: b.any, ...js },
    onLine: { getter: b.bool, ...runs },
    hardwareConcurrency: { getter: b.u32 },
    deviceMemory: { getter: b.f64, secure: true },
    connection: { getter: b.ref("NetworkInformation"), cache: "connection", ...heap },
    userAgentData: { getter: b.ref("NavigatorUAData"), cache: "userAgentData", secure: true, ...heap },
    storage: { getter: b.ref("StorageManager"), cache: "storage", secure: true, ...heap },
  },
});

const handlerOfProtocol = {
  args: { scheme: text, url: usv },
  secure: true,
  rustName: "decline_protocol_handler",
  ...js,
} as const;

export const DomNavigator = b.interface("DomNavigator", {
  name: "Navigator",
  extends: AnyNavigator,
  exposed: inWindows,
  includes: [NavigatorEverywhere],
  proto: {
    ...each("productSub vendor vendorSub", { getter: utf8 }),
    ...each("cookieEnabled pdfViewerEnabled webdriver", { getter: b.bool }),
    doNotTrack: { getter: utf8.nullable },
    maxTouchPoints: { getter: b.i32 },
    plugins: { getter: b.ref("PluginArray"), cache: true, ...heap },
    mimeTypes: { getter: b.ref("MimeTypeArray"), cache: true, ...heap },
    scheduling: { getter: b.ref("Scheduling"), cache: true, ...heap },
    userActivation: { getter: b.ref("UserActivation").nullable, cache: true, ...heap },
    windowControlsOverlay: { getter: WindowControlsOverlay, cache: true, ...heap },
    keyboard: { getter: b.ref("Keyboard"), cache: true, secure: true, ...heap },
    ...each("registerProtocolHandler unregisterProtocolHandler", handlerOfProtocol),
    javaEnabled: { returns: b.bool },
    getGamepads: { returns: b.sequence(b.any), ...heap },
    vibrate: { args: { pattern: b.any }, length: 1, requiredArguments: 1, returns: b.bool },
    clipboard: { getter: b.ref("Clipboard"), cache: true, secure: true, ...heap },
    mediaDevices: { getter: b.ref("MediaDevices"), cache: true, secure: true, ...heap },
  },
});

export const WorkerNavigator = b.interface("WorkerNavigator", {
  extends: AnyNavigator,
  exposed: ["Worker"],
  includes: [NavigatorEverywhere],
});

const nothingListed = { exposed: inWindows, indexed: { getter: b.object, ...heap } } as const;
const nothingFound = {
  length: { getter: b.u32 },
  item: { args: { index: b.u32.wrap }, returns: b.object.nullable, ...heap },
  namedItem: { args: { name: b.DOMString }, returns: b.object.nullable, ...heap },
} as const;
export const PluginArray = b.interface("PluginArray", { ...nothingListed, proto: { refresh: {}, ...nothingFound } });
export const MimeTypeArray = b.interface("MimeTypeArray", { ...nothingListed, proto: nothingFound });

export const NetworkInformation = b.interface("NetworkInformation", {
  extends: DesktopEventTarget,
  exposed: everywhere,
  proto: {
    effectiveType: { getter: utf8 },
    rtt: { getter: b.u32 },
    downlink: { getter: b.f64 },
    saveData: { getter: b.bool },
    ...handlers("change"),
  },
});

export const IsInputPendingOptions = b.dictionary({ includeContinuous: flag }, { webidl: true });
export const Scheduling = b.interface("Scheduling", {
  exposed: inWindows,
  proto: { isInputPending: { args: { options: IsInputPendingOptions.default({}) }, returns: b.bool, ...runs } },
});

export const Keyboard = b.interface("Keyboard", {
  exposed: inWindows,
  secure: true,
  proto: { lock: { args: { keyCodes: b.sequence(b.DOMString).default([]) }, ...promise }, unlock: {} },
});

export const NavigatorUAData = b.interface("NavigatorUAData", {
  exposed: everywhere,
  ...ofScope,
  proto: {
    brands: { getter: b.any, cache: true, ...js },
    mobile: { getter: b.bool },
    platform: { getter: utf8 },
    getHighEntropyValues: { args: { hints: b.sequenceVec(text.owned) }, ...promise },
    toJSON: { returns: b.any, rustName: "to_json", ...js },
  },
});

// ───────────────────────────── workers ─────────────────────────────

export const WorkerLocation = b.interface("WorkerLocation", {
  rustPath: `${path}::WorkerLocation`,
  exposed: ["Worker"],
  proto: {
    href: { getter: utf8, stringifier: true },
    ...each("origin protocol host hostname port pathname search hash", { getter: utf8 }),
  },
});

export const WorkerGlobalScope = b.interface("WorkerGlobalScope", {
  extends: WindowTarget,
  rustPath: `${path}::WorkerGlobalScope`,
  size: 112,
  exposed: ["Worker"],
  internalFields: { port: b.any },
  includes: [ImageBitmapFactories, WindowOrWorkerGlobalScope],
  proto: {
    self: { getter: b.any, rustName: "itself", ...heap },
    location: { getter: WorkerLocation, cache: true, ...heap },
    indexedDB,
    navigator: { getter: WorkerNavigator, cache: true, ...heap },
    scheduler,
    ...handlers("error languagechange offline online rejectionhandled securitypolicyviolation unhandledrejection"),
    ...each("atob btoa", {
      args: { data: b.DOMString },
      returns: b.any.returning("string"),
      capability: "heap",
      throws: true,
    }),
    queueMicrotask: { args: { callback: b.callable }, capability: "heap", throws: true },
    fonts: { getter: b.ref("FontFaceSet"), capability: "js", throws: true },
  },
});

export const NamedWorkerScope = b.mixin("NamedWorkerScope", {
  on: WorkerGlobalScope,
  proto: { name: { getter: string, replaceable: true, ...heap } },
});

export const DedicatedWorkerGlobalScope = b.interface("DedicatedWorkerGlobalScope", {
  extends: WorkerGlobalScope,
  global: true,
  exposed: ["DedicatedWorker"],
  includes: [NamedWorkerScope],
  proto: {
    requestAnimationFrame: { args: { callback: b.callable }, returns: b.u32, ...heap },
    cancelAnimationFrame: { args: { handle: b.u32.wrap }, ...heap },
    ...handlers("message messageerror"),
  },
});

export const SharedWorkerGlobalScope = b.interface("SharedWorkerGlobalScope", {
  extends: WorkerGlobalScope,
  global: true,
  exposed: ["SharedWorker"],
  includes: [NamedWorkerScope],
  proto: handlers("connect"),
});
