import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget } from "../core/core.bind.ts";
import { DesktopEvent, DesktopEventInit, OnEvent, WindowTarget } from "../events/events.bind.ts";
import { DomNavigator, DomWindow, WorkerGlobalScope } from "../window/window.bind.ts";

export default b.module({ rustPath: "crate::api::network", feature: "Desktop", isCold: true, membersInTable: false });

const heap = { capability: "heap" } as const;
const checks = { capability: "heap", throws: true } as const;
const runs = { capability: "js", throws: true } as const;
const promises = { returns: b.any, rejects: true, ...runs } as const;
const atom = b.DOMString.atom.as("crate::api::core::Atom");
const string = b.DOMString.impl.as("crate::api::core::DomString");
const usv = b.USVString.impl.as("crate::api::core::DomString");
const bytes = b.ByteString.impl.as("crate::api::core::DomString");
const exposed = ["Window", "Worker"] as const;
const rust = (name: string) => `crate::api::network::${name}`;
const dictionary = (members: Record<string, any>, more = {}) => b.dictionary(members, { webidl: true, ...more });
const handlers = (...names: string[]) =>
  Object.fromEntries(names.map(name => ["on" + name, OnEvent.of(`crate::api::core::atom!("${name}")`)]));

// ───────────────────────────── https://fetch.spec.whatwg.org/ ─────────────────────────────

export const HeadersInit = b.union(
  { pairs: b.sequence(b.sequence(b.ByteString)), record: b.recordOf(b.ByteString, b.ByteString) },
  { webidl: true },
);

export const DomHeadersIterator = b.interface("DomHeadersIterator", {
  name: "Headers Iterator",
  rustPath: rust("HeadersIterator"),
  noInterfaceObject: true,
  prototypeBase: "Iterator",
  proto: { next: { returns: b.object, ...checks } },
});

export const DomHeaders = b.interface("DomHeaders", {
  name: "Headers",
  rustPath: rust("Headers"),
  exposed,
  construct: { args: { init: HeadersInit.optional }, ...checks },
  sameFunction: { "@@iterator": "entries" },
  proto: {
    append: { args: { name: bytes, value: bytes }, ...checks },
    delete: { args: { name: bytes }, ...checks },
    get: { args: { name: bytes }, returns: b.ByteString.nullable, ...checks },
    getSetCookie: { returns: b.any, ...checks },
    has: { args: { name: bytes }, returns: b.bool, ...checks },
    set: { args: { name: bytes, value: bytes }, ...checks },
    entries: { returns: DomHeadersIterator, ...heap },
    keys: { returns: DomHeadersIterator, ...heap },
    values: { returns: DomHeadersIterator, ...heap },
    forEach: { args: { callback: b.callable, thisArg: b.any.omittable }, ...runs },
  },
});

export const BodySource = b.interface("BodySource", {
  rustPath: rust("BodySource"),
  noInterfaceObject: true,
  internalFields: ["signal", "reader"],
  proto: {
    pull: { args: { controller: b.any }, returns: b.any, ...runs },
    cancel: { args: { reason: b.any.omittable }, ...runs },
  },
});

export const Message = b.interface("Message", {
  abstract: true,
  rustPath: rust("Message"),
  size: 72,
  internalFields: { headers: DomHeaders, stream: b.any, reader: b.any, followed: b.any },
});

export const DomBody = b.mixin("DomBody", {
  on: Message,
  proto: {
    headers: { getter: DomHeaders, cache: "headers", ...heap },
    body: { getter: b.object.nullable, ...runs },
    bodyUsed: { getter: b.bool, ...heap },
    arrayBuffer: promises,
    blob: promises,
    bytes: promises,
    formData: promises,
    json: promises,
    text: promises,
    textStream: { returns: b.object, ...runs },
  },
});

export const DomReferrerPolicy = b.enumeration({
  Empty: "",
  NoReferrer: "no-referrer",
  NoReferrerWhenDowngrade: "no-referrer-when-downgrade",
  SameOrigin: "same-origin",
  Origin: "origin",
  StrictOrigin: "strict-origin",
  OriginWhenCrossOrigin: "origin-when-cross-origin",
  StrictOriginWhenCrossOrigin: "strict-origin-when-cross-origin",
  UnsafeUrl: "unsafe-url",
});
export const RequestMode = b.enumeration(["navigate", "same-origin", "no-cors", "cors"]);
export const DomRequestCredentials = b.enumeration(["omit", "same-origin", "include"]);
export const RequestCache = b.enumeration([
  "default",
  "no-store",
  "reload",
  "no-cache",
  "force-cache",
  "only-if-cached",
]);
export const RequestRedirect = b.enumeration(["follow", "error", "manual"]);
export const RequestDuplex = b.enumeration(["half"]);
export const RequestPriority = b.enumeration(["high", "low", "auto"]);

export const DomRequestInfo = b.union({ request: b.ref("DomRequest"), url: b.USVString.impl }, { webidl: true });
export const DomRequestInit = dictionary({
  body: b.any.omittable,
  cache: RequestCache.optional,
  credentials: DomRequestCredentials.optional,
  duplex: RequestDuplex.optional,
  headers: HeadersInit.optional,
  integrity: b.DOMString.utf8.optional,
  keepalive: b.bool.loose.optional,
  method: bytes.optional,
  mode: RequestMode.optional,
  priority: RequestPriority.optional,
  redirect: RequestRedirect.optional,
  referrer: usv.optional,
  referrerPolicy: DomReferrerPolicy.optional,
  signal: b.any.omittable,
  window: b.any.omittable,
});
export const DeferredRequestInit = dictionary({ activateAfter: b.double.optional }, { extends: DomRequestInit });

const keyword = { getter: b.DOMString, ...heap } as const;

export const DomRequest = b.interface("DomRequest", {
  name: "Request",
  extends: Message,
  includes: [DomBody],
  rustPath: rust("Request"),
  exposed,
  internalFields: ["signal"],
  construct: { args: { input: DomRequestInfo, init: DomRequestInit.default({}) }, passStructure: true, ...runs },
  proto: {
    method: keyword,
    url: keyword,
    destination: keyword,
    referrer: keyword,
    referrerPolicy: keyword,
    mode: keyword,
    credentials: keyword,
    cache: keyword,
    redirect: keyword,
    integrity: { getter: b.DOMString.utf8 },
    keepalive: { getter: b.bool },
    isReloadNavigation: { getter: b.bool },
    isHistoryNavigation: { getter: b.bool },
    signal: { getter: b.object, cache: "signal", ...heap },
    duplex: keyword,
    clone: { returns: b.ref("DomRequest"), rustName: "duplicate", ...runs },
  },
});

export const DomResponseInit = dictionary({
  headers: HeadersInit.optional,
  status: b.u16.wrap.default(200),
  statusText: bytes.default(""),
});

export const DomResponse = b.interface("DomResponse", {
  name: "Response",
  extends: Message,
  includes: [DomBody],
  rustPath: rust("Response"),
  exposed,
  construct: { args: { body: b.any.omittable, init: DomResponseInit.default({}) }, passStructure: true, ...runs },
  static: {
    error: { returns: b.ref("DomResponse"), ...heap },
    redirect: { args: { url: usv, status: b.u16.wrap.default(302) }, returns: b.ref("DomResponse"), ...runs },
    json: {
      args: { data: b.any, init: DomResponseInit.default({}) },
      returns: b.ref("DomResponse"),
      rustName: "of_json",
      ...runs,
    },
  },
  proto: {
    type: keyword,
    url: keyword,
    redirected: { getter: b.bool },
    status: { getter: b.u16 },
    ok: { getter: b.bool },
    statusText: keyword,
    clone: { returns: b.ref("DomResponse"), rustName: "duplicate", ...runs },
  },
});

export const PendingFetch = b.interface("PendingFetch", {
  rustPath: rust("PendingFetch"),
  noInterfaceObject: true,
  internalFields: ["promise", "signal", "upload", "response"],
});

export const FetchLaterResult = b.interface("FetchLaterResult", {
  rustPath: rust("FetchLaterResult"),
  exposed: ["Window"],
  secure: true,
  proto: { activated: { getter: b.bool } },
});

export const FetchingScope = b.mixin("FetchingScope", {
  on: WindowTarget,
  proto: { fetch: { args: { input: DomRequestInfo, init: DomRequestInit.default({}) }, ...promises } },
});
b.include(DomWindow, FetchingScope);
b.include(WorkerGlobalScope, FetchingScope);

export const DeferringWindow = b.partial("DeferringWindow", {
  on: DomWindow,
  proto: {
    fetchLater: {
      args: { input: DomRequestInfo, init: DeferredRequestInit.default({}) },
      returns: FetchLaterResult,
      secure: true,
      ...runs,
    },
  },
});

export const NavigatorBeacon = b.partial("NavigatorBeacon", {
  on: DomNavigator,
  proto: { sendBeacon: { args: { url: usv, data: b.any.omittable }, returns: b.bool, ...runs } },
});

// ───────────────────────────── https://xhr.spec.whatwg.org/ ─────────────────────────────

const notInServiceWorkers = ["Window", "DedicatedWorker", "SharedWorker"] as const;

export const XMLHttpRequestResponseType = b.enumeration({
  Empty: "",
  ArrayBuffer: "arraybuffer",
  Blob: "blob",
  Document: "document",
  Json: "json",
  Text: "text",
});

export const XMLHttpRequestEventTarget = b.interface("XMLHttpRequestEventTarget", {
  extends: DesktopEventTarget,
  exposed: notInServiceWorkers,
  proto: handlers("loadstart", "progress", "abort", "error", "load", "timeout", "loadend"),
});

export const XMLHttpRequestUpload = b.interface("XMLHttpRequestUpload", {
  extends: XMLHttpRequestEventTarget,
  exposed: notInServiceWorkers,
});

export const XMLHttpRequest = b.interface("XMLHttpRequest", {
  extends: XMLHttpRequestEventTarget,
  rustPath: rust("XMLHttpRequest"),
  exposed: notInServiceWorkers,
  internalFields: { upload: XMLHttpRequestUpload, text: b.any, value: b.any },
  constants: { UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4 },
  construct: {},
  proto: {
    ...handlers("readystatechange"),
    readyState: { getter: b.u16 },
    open: [
      { args: { method: bytes, url: usv }, rustName: "open", ...runs },
      {
        args: {
          method: bytes,
          url: usv,
          async: b.bool.loose,
          username: b.USVString.utf8.nullable.optional,
          password: b.USVString.utf8.nullable.optional,
        },
        rustName: "open_with",
        ...runs,
      },
    ],
    setRequestHeader: { args: { name: bytes, value: bytes }, ...checks },
    timeout: { getter: b.u32.wrap, setter: { type: b.u32.wrap, ...runs } },
    withCredentials: { getter: b.bool, setter: { type: b.bool.loose, ...checks } },
    upload: { getter: XMLHttpRequestUpload, cache: "upload", ...heap },
    send: { args: { body: b.any.omittable }, ...runs },
    abort: { capability: "js" },
    responseURL: keyword,
    status: { getter: b.u16 },
    statusText: keyword,
    getResponseHeader: { args: { name: bytes }, returns: b.ByteString.nullable, ...heap },
    getAllResponseHeaders: { returns: b.ByteString, ...heap },
    overrideMimeType: { args: { mime: b.DOMString.utf8 }, ...checks },
    responseType: {
      getter: XMLHttpRequestResponseType,
      setter: { type: XMLHttpRequestResponseType, ...checks },
      ignoreInvalid: true,
    },
    response: { getter: b.any, ...runs },
    responseText: { getter: b.any, ...runs },
    responseXML: { getter: b.any, exposed: ["Window"], ...runs },
  },
});

// ───────────────────────────── server-sent events ─────────────────────────────

export const EventSourceInit = dictionary({ withCredentials: b.bool.loose.default(false) });
export const EventSource = b.interface("EventSource", {
  extends: DesktopEventTarget,
  rustPath: rust("EventSource"),
  exposed,
  constants: { CONNECTING: 0, OPEN: 1, CLOSED: 2 },
  construct: { args: { url: usv, init: EventSourceInit.default({}) }, passStructure: true, ...runs },
  proto: {
    ...handlers("open", "message", "error"),
    url: keyword,
    withCredentials: { getter: b.bool },
    readyState: { getter: b.u16 },
    close: {},
  },
});

// ───────────────────────────── https://websockets.spec.whatwg.org/ ─────────────────────────────

export const DomCloseEventInit = dictionary(
  { code: b.u16.wrap.default(0), reason: b.USVString.impl.default(""), wasClean: b.bool.loose.default(false) },
  { extends: DesktopEventInit },
);
export const DomCloseEvent = b.interface("DomCloseEvent", {
  name: "CloseEvent",
  extends: DesktopEvent,
  rustPath: rust("CloseEvent"),
  exposed,
  construct: { args: { type: atom, init: DomCloseEventInit.default({}) } },
  proto: { wasClean: { getter: b.bool }, code: { getter: b.u16 }, reason: { getter: string, ...heap } },
});

export const DomBinaryType = b.enumeration({ Blob: "blob", ArrayBuffer: "arraybuffer" });
export const Protocols = b.union({ one: b.DOMString.utf8, list: b.sequence(b.DOMString) }, { webidl: true });
export const DomWebSocket = b.interface("DomWebSocket", {
  name: "WebSocket",
  extends: DesktopEventTarget,
  rustPath: rust("WebSocket"),
  exposed,
  constants: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
  construct: { args: { url: usv, protocols: Protocols.default([]) }, passStructure: true, ...runs },
  proto: {
    ...handlers("open", "error", "close", "message"),
    url: keyword,
    readyState: { getter: b.u16 },
    bufferedAmount: { getter: b.f64 },
    extensions: keyword,
    protocol: keyword,
    close: { args: { code: b.u16.clamp.optional, reason: b.USVString.utf8.optional }, ...checks },
    binaryType: { getter: DomBinaryType, setter: true, ignoreInvalid: true },
    send: { args: { data: b.any }, ...runs },
  },
});

// ───────────────────────────── https://w3c.github.io/ServiceWorker/#cache-objects ─────────────────────────────

const ignores = b.bool.loose.default(false);
export const CacheQueryOptions = dictionary({ ignoreMethod: ignores, ignoreSearch: ignores, ignoreVary: ignores });
export const MultiCacheQueryOptions = dictionary(
  { cacheName: b.DOMString.impl.optional },
  { extends: CacheQueryOptions },
);
const options = CacheQueryOptions.default({});

export const Cache = b.interface("Cache", {
  rustPath: rust("Cache"),
  exposed,
  secure: true,
  proto: {
    match: { args: { request: DomRequestInfo, options }, rustName: "find", ...promises },
    matchAll: { args: { request: DomRequestInfo.optional, options }, ...promises },
    add: { args: { request: DomRequestInfo }, ...promises },
    addAll: { args: { requests: b.sequence(DomRequestInfo) }, ...promises },
    put: { args: { request: DomRequestInfo, response: DomResponse }, ...promises },
    delete: { args: { request: DomRequestInfo, options }, ...promises },
    keys: { args: { request: DomRequestInfo.optional, options }, ...promises },
  },
});

export const CacheStorage = b.interface("CacheStorage", {
  rustPath: rust("CacheStorage"),
  exposed,
  secure: true,
  proto: {
    match: {
      args: { request: DomRequestInfo, options: MultiCacheQueryOptions.default({}) },
      rustName: "find",
      ...promises,
    },
    has: { args: { cacheName: string }, ...promises },
    open: { args: { cacheName: string }, ...promises },
    delete: { args: { cacheName: string }, ...promises },
    keys: promises,
  },
});
