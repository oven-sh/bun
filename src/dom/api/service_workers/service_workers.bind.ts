import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget } from "../core/core.bind.ts";
import { DesktopEvent, DesktopEventInit, OnEvent } from "../events/events.bind.ts";
import { DomMessagePort, SerializeOptions } from "../messaging/messaging.bind.ts";
import { DomRequest } from "../network/network.bind.ts";
import { CookieChangeEventInit, CookieStore, DomNotification, NotificationOptions } from "../site/site.bind.ts";
import { AnyNavigator, DomNavigator, ServiceWorkerGlobalScope, WorkerGlobalScope } from "../window/window.bind.ts";
import { DomWorkerType } from "../workers/workers.bind.ts";

export default b.module({
  rustPath: "crate::api::service_workers",
  feature: "Desktop",
  isCold: true,
  membersInTable: false,
});

const rust = (name: string) => `crate::api::service_workers::${name}`;
const heap = { capability: "heap" } as const;
const runs = { capability: "js", throws: true } as const;
const promise = { returns: b.any.returning("Promise"), rejects: true, ...runs } as const;
const forClients = { exposed: ["Window", "ServiceWorker"], secure: true } as const;
const forAll = { exposed: ["Window", "Worker"], secure: true } as const;
const forWorkers = { exposed: ["ServiceWorker"] } as const;
const string = b.DOMString.impl.as("crate::api::core::DomString");
const usv = b.USVString.impl.as("crate::api::core::DomString");
const text = { getter: b.DOMString.utf8 } as const;
const atom = b.DOMString.atom.as("crate::api::core::Atom");
const flag = b.bool.loose.default(false);
const dictionary = (members: Record<string, any>, more = {}) => b.dictionary(members, { webidl: true, ...more });
const field = (name: string) => ({ getter: b.any, field: name }) as const;
const nullable = (name: string) => ({ getter: b.object.nullable, field: name }) as const;
const on = (name: string) => OnEvent.of(`crate::api::core::atom!("${name}")`);
const postMessage = [
  { args: { message: b.any, transfer: b.sequence(b.object) }, ...runs },
  { args: { message: b.any, options: SerializeOptions.default({}) }, rustName: "post_message_with", ...runs },
] as const;

export const ServiceWorker = b.interface("ServiceWorker", {
  extends: DesktopEventTarget,
  rustPath: rust("ServiceWorker"),
  ...forClients,
  proto: { scriptURL: text, state: text, postMessage, onstatechange: on("statechange"), onerror: on("error") },
});

export const NavigationPreloadManager = b.interface("NavigationPreloadManager", {
  rustPath: rust("NavigationPreloadManager"),
  ...forAll,
  proto: {
    enable: promise,
    disable: promise,
    setHeaderValue: { args: { value: b.ByteString.impl.as("crate::api::core::DomString") }, ...promise },
    getState: promise,
  },
});

export const CookieSubscription = dictionary(
  { name: b.USVString.utf8.owned.optional, url: b.USVString.utf8.owned.optional },
  { fromJS: true },
);
const subscriptions = { args: { subscriptions: b.sequence(b.any) }, ...promise };
export const CookieStoreManager = b.interface("CookieStoreManager", {
  rustPath: rust("CookieStoreManager"),
  ...forClients,
  proto: { subscribe: subscriptions, getSubscriptions: promise, unsubscribe: subscriptions },
});

const pushOptions = { args: { options: b.any.omittable }, ...promise };
export const PushManager = b.interface("PushManager", {
  rustPath: rust("PushManager"),
  ...forAll,
  proto: { subscribe: pushOptions, getSubscription: promise, permissionState: pushOptions },
});

export const GetNotificationOptions = dictionary({ tag: b.DOMString.impl.optional });
export const ServiceWorkerRegistration = b.interface("ServiceWorkerRegistration", {
  extends: DesktopEventTarget,
  rustPath: rust("Registration"),
  ...forAll,
  internalFields: {
    installing: b.any,
    waiting: b.any,
    active: b.any,
    navigationPreload: NavigationPreloadManager,
    cookies: CookieStoreManager,
    pushManager: PushManager,
  },
  proto: {
    installing: nullable("installing"),
    waiting: nullable("waiting"),
    active: nullable("active"),
    navigationPreload: { getter: NavigationPreloadManager, cache: "navigationPreload", ...heap },
    scope: text,
    updateViaCache: text,
    update: promise,
    unregister: promise,
    onupdatefound: on("updatefound"),
    cookies: { getter: CookieStoreManager, cache: "cookies", exposed: forClients.exposed, ...heap },
    pushManager: { getter: PushManager, cache: "pushManager", ...heap },
    showNotification: { args: { title: string, options: NotificationOptions.default({}) }, ...promise },
    getNotifications: { args: { filter: GetNotificationOptions.default({}) }, ...promise },
  },
});

export const ServiceWorkerUpdateViaCache = b.enumeration(["imports", "all", "none"]);
export const RegistrationOptions = dictionary({
  scope: b.DOMString.utf8.optional,
  type: DomWorkerType.default("classic"),
  updateViaCache: ServiceWorkerUpdateViaCache.default("imports"),
});
export const ServiceWorkerContainer = b.interface("ServiceWorkerContainer", {
  extends: DesktopEventTarget,
  rustPath: rust("Container"),
  exposed: ["Window"],
  secure: true,
  internalFields: ["ready"],
  proto: {
    controller: { getter: b.any, ...heap },
    ready: { getter: b.any, rejects: true, capability: "js" },
    register: { args: { scriptURL: b.any, options: RegistrationOptions.default({}) }, ...promise },
    getRegistration: { args: { clientURL: usv.default("") }, ...promise },
    getRegistrations: promise,
    startMessages: { capability: "js" },
    oncontrollerchange: on("controllerchange"),
    onmessage: { getter: b.any, setter: true, capability: "js" },
    onmessageerror: on("messageerror"),
  },
});

export const NavigatorOfServiceWorkers = b.mixin("NavigatorOfServiceWorkers", {
  on: AnyNavigator,
  proto: { serviceWorker: { getter: ServiceWorkerContainer, secure: true, ...runs } },
});
b.include(DomNavigator, NavigatorOfServiceWorkers);

export const Client = b.interface("Client", {
  rustPath: rust("ClientObject"),
  size: 8,
  ...forWorkers,
  proto: { url: text, frameType: text, id: { getter: string }, type: text, postMessage },
});
export const WindowClient = b.interface("WindowClient", {
  extends: Client,
  rustPath: rust("WindowClientObject"),
  internalFields: ["ancestorOrigins"],
  ...forWorkers,
  proto: {
    visibilityState: text,
    focused: { getter: b.bool },
    ancestorOrigins: field("ancestorOrigins"),
    focus: promise,
    navigate: { args: { url: usv }, ...promise },
  },
});

export const ClientType = b.enumeration(["window", "worker", "sharedworker", "all"]);
export const ClientQueryOptions = dictionary({ includeUncontrolled: flag, type: ClientType.default("window") });
export const Clients = b.interface("Clients", {
  rustPath: rust("Clients"),
  ...forWorkers,
  proto: {
    get: { args: { id: b.DOMString.utf8 }, ...promise },
    matchAll: { args: { options: ClientQueryOptions.default({}) }, ...promise },
    openWindow: { args: { url: usv }, ...promise },
    claim: promise,
  },
});

export const ServiceScope = b.mixin("ServiceScope", {
  on: WorkerGlobalScope,
  proto: {
    clients: { getter: Clients, ...heap },
    registration: { getter: b.any, capability: "js" },
    serviceWorker: { getter: b.any, capability: "js" },
    skipWaiting: promise,
    cookieStore: { getter: CookieStore, ...heap },
  },
});
b.include(ServiceWorkerGlobalScope, ServiceScope);

const construct = (init: any) => ({ args: { type: atom, eventInitDict: init }, passStructure: true, ...runs }) as const;

export const ExtendableEvent = b.interface("ExtendableEvent", {
  extends: DesktopEvent,
  rustPath: rust("ExtendableEvent"),
  size: 64,
  ...forWorkers,
  construct: construct(DesktopEventInit.default({})),
  proto: { waitUntil: { args: { f: b.any }, ...runs } },
});
export const RunningStatus = b.enumeration(["running", "not-running"]);
export const RouterCondition = dictionary(
  {
    not: { type: b.any.omittable, rustName: "negated" },
    or: { type: b.sequence(b.any).optional, rustName: "alternatives" },
    requestDestination: b.DOMString.utf8.owned.optional,
    requestMethod: b.ByteString.impl.as("crate::api::core::DomString").optional,
    requestMode: b.DOMString.utf8.owned.optional,
    runningStatus: RunningStatus.optional,
    urlPattern: b.any.omittable,
  },
  { fromJS: true },
);
export const RouterSourceDict = dictionary({ cacheName: b.DOMString.impl.optional });
export const RouterSource = b.union({ named: RouterSourceDict, keyword: b.DOMString.utf8.owned }, { webidl: true });
export const RouterRule = dictionary({ condition: b.any.omittable, source: RouterSource }, { fromJS: true });
export const RouterRules = b.union({ several: b.sequence(b.any), one: b.object }, { webidl: true });
export const InstallEvent = b.interface("InstallEvent", {
  extends: ExtendableEvent,
  rustPath: rust("InstallEvent"),
  ...forWorkers,
  construct: construct(DesktopEventInit.default({})),
  proto: { addRoutes: { args: { rules: RouterRules }, ...promise } },
});

export const FetchEventInit = dictionary(
  {
    clientId: string.default(""),
    handled: b.any.omittable,
    preloadResponse: b.any.omittable,
    replacesClientId: string.default(""),
    request: DomRequest,
    resultingClientId: string.default(""),
  },
  { extends: DesktopEventInit },
);
export const FetchEvent = b.interface("FetchEvent", {
  extends: ExtendableEvent,
  rustPath: rust("FetchEvent"),
  ...forWorkers,
  internalFields: ["request", "preloadResponse", "handled"],
  construct: construct(FetchEventInit),
  proto: {
    request: field("request"),
    preloadResponse: { ...field("preloadResponse"), rejects: true },
    clientId: { getter: string },
    resultingClientId: { getter: string },
    replacesClientId: { getter: string },
    handled: { ...field("handled"), rejects: true },
    respondWith: { args: { r: b.any }, ...runs },
  },
});

export const ExtendableMessageEventInit = dictionary(
  {
    data: b.any.omittable,
    lastEventId: string.default(""),
    origin: usv.default(""),
    ports: b.sequence(DomMessagePort).default([]),
    source: b.object.nullable.optional,
  },
  { extends: DesktopEventInit },
);
export const ExtendableMessageEvent = b.interface("ExtendableMessageEvent", {
  extends: ExtendableEvent,
  rustPath: rust("ExtendableMessageEvent"),
  ...forWorkers,
  internalFields: ["data", "source", "ports"],
  construct: construct(ExtendableMessageEventInit.default({})),
  proto: {
    data: field("data"),
    origin: { getter: string },
    lastEventId: { getter: string },
    source: nullable("source"),
    ports: field("ports"),
  },
});

export const ExtendableCookieChangeEvent = b.interface("ExtendableCookieChangeEvent", {
  extends: ExtendableEvent,
  rustPath: rust("ExtendableCookieChangeEvent"),
  ...forWorkers,
  internalFields: ["changed", "deleted"],
  construct: construct(CookieChangeEventInit.default({})),
  proto: { changed: field("changed"), deleted: field("deleted") },
});

export const NotificationEventInit = dictionary(
  { action: string.default(""), notification: DomNotification },
  { extends: DesktopEventInit },
);
export const NotificationEvent = b.interface("NotificationEvent", {
  extends: ExtendableEvent,
  rustPath: rust("NotificationEvent"),
  ...forWorkers,
  internalFields: ["notification"],
  construct: construct(NotificationEventInit),
  proto: { notification: field("notification"), action: { getter: string } },
});
