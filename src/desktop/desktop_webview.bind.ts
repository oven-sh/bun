import * as b from "../codegen/bindgen-lib.ts";
import {
  anything,
  flag,
  js,
  number,
  ownedTextIfAny,
  ownedTexts,
  returnsObject,
  returnsPromise,
  text,
  textIfAny,
} from "./schema.ts";

export default b.module({
  rustPath: "crate::webview::for_scripts",
  feature: "Desktop",
  isCold: true,
  membersInTable: false,
});

const values = b.rest(b.any);
const property = { getter: b.any, ...js };
const numbers = b.array(b.f64).nullable;
const amount = number.default(0);

export const EngineChoice = b.dictionary(
  { type: ownedTextIfAny, path: ownedTextIfAny, args: ownedTexts.nullable },
  { fromJS: true },
);

export const ElectronRemoteFrame = b.interface("ElectronRemoteFrame", {
  ofModule: true,
  name: "WebFrameMain",
  rustPath: "crate::webview::frame::RemoteFrame",
  prototypeBase: "EventEmitter",
  noInterfaceObject: true,
  proto: {
    ipc: { ...property, cache: true },
    url: property,
    origin: property,
    name: property,
    routingId: { getter: b.i32 },
    frameToken: property,
    osProcessId: { getter: b.i32 },
    processId: { getter: b.i32 },
    frameTreeNodeId: { getter: b.i32 },
    parent: property,
    top: property,
    frames: property,
    framesInSubtree: property,
    detached: { getter: b.bool },
    visibilityState: { getter: b.string.utf8, ...js },
    isDestroyed: { returns: b.bool, rustName: "get_detached" },
    send: { args: { values }, ...js },
    postMessage: { args: { values }, ...js },
    reload: { returns: b.bool },
    collectJavaScriptCallStack: { rustName: "collect_java_script_call_stack", ...returnsPromise },
    executeJavaScript: { args: { values }, rustName: "execute_java_script", ...returnsPromise },
    printToPDF: { args: { values }, rustName: "print_to_pdf", ...returnsPromise },
  },
});

export const ElectronRemoteDebugger = b.interface("ElectronRemoteDebugger", {
  ofModule: true,
  name: "Debugger",
  rustPath: "crate::webview::debugger::Debugger",
  prototypeBase: "EventEmitter",
  noInterfaceObject: true,
  proto: {
    attach: js,
    isAttached: { returns: b.bool },
    detach: js,
    sendCommand: { args: { method: text, params: anything, sessionId: textIfAny }, ...returnsPromise },
  },
});

export const ElectronServiceWorkerMain = b.interface("ElectronServiceWorkerMain", {
  ofModule: true,
  name: "ServiceWorkerMain",
  rustPath: "crate::webview::worker::ServiceWorker",
  noInterfaceObject: true,
  proto: {
    ipc: { ...property, cache: true },
    scope: { getter: b.string.utf8 },
    scriptURL: { getter: b.string.utf8, rustName: "script_url" },
    versionId: { getter: b.f64 },
    isDestroyed: { returns: b.bool },
    send: { args: { values }, ...js },
    startTask: returnsObject,
  },
});

/** `bun_ui::script::event_of()` */
export const SurfaceEvent = b.dictionary(
  {
    t: b.string.utf8.owned,
    e: ownedTextIfAny,
    x: amount,
    y: amount,
    m: b.u32.wrap.default(0),
    b: b.u32.wrap.default(0),
    buttons: b.u32.wrap.default(0),
    n: b.u32.wrap.default(0),
    dx: amount,
    dy: amount,
    delta: amount,
    width: amount,
    height: amount,
    key: b.any,
    code: ownedTextIfAny,
    location: b.u32.wrap.default(0),
    repeat: flag,
    composing: flag,
    text: ownedTextIfAny,
    range: numbers,
    selection: numbers,
    paths: ownedTexts.nullable,
    direction: amount,
  },
  { fromJS: true },
);

/** A `WebContents` while its page is in the web engine, or an `<iframe>` that is. */
export const WebEngineRemote = b.interface("WebEngineRemote", {
  ofModule: true,
  rustPath: "crate::webview::remote::Remote",
  noInterfaceObject: true,
  internalFields: {
    contents: b.any,
    state: b.any,
    frames: b.any,
    cleanups: b.any,
    dialog: b.any,
    onFrame: b.any,
    page: b.any,
    element: b.any,
    deliver: b.any,
    embedder: b.any,
    carrier: b.ref("ElectronPortCarrier"),
    popup: b.ref("WebEngineRemote"),
    inspector: ElectronRemoteDebugger,
  },
  proto: {},
});

/** What an `<iframe>` element calls. The engine does not start for a frame that shows nothing. */
export const WebEngineFrameControls = b.interface("WebEngineFrameControls", {
  ofModule: true,
  rustPath: "crate::webview::embedded::Controls",
  noInterfaceObject: true,
  internalFields: { page: b.any, element: b.any, deliver: b.any, dispose: b.any, frame: WebEngineRemote },
  proto: {
    navigate: { args: { attributes: b.object }, ...js },
    attribute: { args: { name: text, value: b.string.utf8.nullable }, ...js },
    location: { args: { path: b.object, method: text, url: text }, ...js },
    post: { args: { path: b.object, envelope: b.object, targetOrigin: text }, ...js },
    place: { args: { width: number, height: number, isVisible: b.bool.loose, colorScheme: text, zoom: number }, ...js },
    input: { args: { event: b.object }, ...js },
    exitFullscreen: {},
    edit: { args: { command: text }, returns: b.bool },
    focusedFrame: returnsObject,
    dispose: js,
  },
});
