import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget, DomElement } from "../core/core.bind.ts";
import { DesktopEventInit, DesktopEvent as Event, OnEvent } from "../events/events.bind.ts";
import { DomWindow } from "../window/window.bind.ts";

export default b.module({
  rustPath: "crate::api::history::entry",
  feature: "Desktop",
  isCold: true,
  membersInTable: false,
});

const path = "crate::api::history";
const heap = { capability: "heap" } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const atom = b.DOMString.atom.as("crate::api::core::Atom");
const string = b.DOMString.impl.as("crate::api::core::DomString");
const usv = b.USVString.impl.as("crate::api::core::DomString");
const text = b.DOMString.utf8;
const utf8 = b.string.utf8;
const flag = b.bool.loose.default(false);
const exposed = ["Window"] as const;
const words = (names: string) => names.trim().split(/\s+/);
const each = <T>(names: string, member: (name: string) => T) =>
  Object.fromEntries(words(names).map(name => [name, member(name)]));
const handlers = (events: string) =>
  Object.fromEntries(words(events).map(it => [`on${it}`, OnEvent.of(`crate::api::core::atom!("${it}")`)]));
const field = (getter: any) => (name: string) => ({ getter, field: name });
const dictionary = (members: Record<string, any>, base?: any) =>
  b.dictionary(members, { webidl: true, ...(base && { extends: base }) });
const construct = (init: any) => ({ args: { type: atom, eventInitDict: init }, passStructure: true, ...heap }) as const;
const FormData = b.instanceOf("FormData", "WebCore::JSDOMFormData", "JSDOMFormData.h");

export const ScrollRestoration = b.enumeration(["auto", "manual"]);
const changeState = { args: { data: b.any, unused: string, url: usv.nullable.optional }, ...js } as const;
export const History = b.interface("History", {
  rustPath: `${path}::History`,
  exposed,
  internalFields: ["window", "cachedState", "wrappers", "target"],
  proto: {
    length: { getter: b.u32, ...js },
    scrollRestoration: { getter: ScrollRestoration, setter: true, ignoreInvalid: true, ...js },
    state: { getter: b.any, ...js },
    go: { args: { delta: b.i32.wrap.default(0) }, ...js },
    back: js,
    forward: js,
    pushState: changeState,
    replaceState: changeState,
  },
});

export const Location = b.interface("Location", {
  rustPath: `${path}::Location`,
  exposed,
  internalFields: ["window", "origins", "noOrigins"],
  proto: {
    ancestorOrigins: { getter: b.any, unforgeable: true, ...runs },
    href: { getter: usv, setter: true, stringifier: true, unforgeable: true, ...js },
    origin: { getter: b.any, unforgeable: true, ...js },
    ...each("protocol host hostname port pathname search hash", () => ({
      getter: usv,
      setter: true,
      unforgeable: true,
      ...js,
    })),
    assign: { args: { url: usv }, unforgeable: true, ...js },
    replace: { args: { url: usv }, unforgeable: true, ...js },
    reload: { unforgeable: true, ...runs },
  },
});

export const NavigationType = b.enumeration(["push", "replace", "reload", "traverse"]);
export const NavigationHistoryBehavior = b.enumeration(["auto", "push", "replace"]);
export const NavigationTiming = b.enumeration(["after-transition", "manual"]);

export const NavigationHistoryEntry = b.interface("NavigationHistoryEntry", {
  extends: DesktopEventTarget,
  rustPath: `${path}::NavigationHistoryEntry`,
  exposed,
  internalFields: ["history"],
  proto: {
    ...each("key id url", () => ({ getter: utf8 })),
    index: { getter: b.i32 },
    sameDocument: { getter: b.bool },
    getState: { returns: b.any, ...js },
    ...handlers("dispose"),
  },
});

export const NavigationDestination = b.interface("NavigationDestination", {
  rustPath: `${path}::NavigationDestination`,
  exposed,
  internalFields: ["history"],
  proto: {
    ...each("key id url", () => ({ getter: utf8 })),
    index: { getter: b.i32 },
    sameDocument: { getter: b.bool },
    getState: { returns: b.any, ...js },
  },
});

export const NavigationTransition = b.interface("NavigationTransition", {
  rustPath: `${path}::NavigationTransition`,
  exposed,
  internalFields: ["from", "to", "committed", "finished"],
  proto: {
    navigationType: { getter: NavigationType },
    ...each("from to", field(b.any)),
    ...each("committed finished", name => ({ ...field(b.any)(name), rejects: true })),
  },
});

export const NavigationActivation = b.interface("NavigationActivation", {
  rustPath: `${path}::NavigationActivation`,
  exposed,
  internalFields: ["from", "entry"],
  proto: { ...each("from entry", field(b.object.nullable)), navigationType: { getter: NavigationType } },
});

export const NavigationOptions = dictionary({ info: b.any.omittable });
export const NavigationReloadOptions = dictionary({ state: b.any.omittable }, NavigationOptions);
export const NavigationNavigateOptions = dictionary(
  { history: NavigationHistoryBehavior.default("auto"), state: b.any.omittable },
  NavigationOptions,
);
export const NavigationUpdateCurrentEntryOptions = dictionary({ state: b.any });
export const NavigationInterceptOptions = dictionary({
  focusReset: NavigationTiming.optional,
  handler: b.callable.optional,
  precommitHandler: b.callable.optional,
  scroll: NavigationTiming.optional,
});

export const NavigationPrecommitController = b.interface("NavigationPrecommitController", {
  exposed,
  internalFields: { event: b.ref("NavigateEvent") },
  proto: {
    redirect: { args: { url: usv, options: NavigationNavigateOptions.default({}) }, ...js },
    addHandler: { args: { handler: b.callable }, throws: true, ...heap },
  },
});

export const NavigateEventInit = dictionary(
  {
    canIntercept: flag,
    destination: NavigationDestination,
    downloadRequest: string.nullable.optional,
    formData: FormData.nullable.optional,
    hasUAVisualTransition: flag,
    hashChange: flag,
    info: b.any.omittable,
    navigationType: NavigationType.default("push"),
    signal: b.instanceOf("AbortSignal", "WebCore::JSAbortSignal", "JSAbortSignal.h"),
    sourceElement: DomElement.nullable.optional,
    userInitiated: flag,
  },
  DesktopEventInit,
);
export const NavigateEvent = b.interface("NavigateEvent", {
  extends: Event,
  rustPath: `${path}::NavigateEvent`,
  exposed,
  internalFields: [
    "destination",
    "signal",
    "formData",
    "info",
    "sourceElement",
    "navigation",
    "tracker",
    "handlers",
    "precommitHandlers",
  ],
  construct: construct(NavigateEventInit),
  proto: {
    navigationType: { getter: NavigationType },
    ...each("destination signal formData sourceElement", field(b.object.nullable)),
    ...each("canIntercept userInitiated hashChange", () => ({ getter: b.bool })),
    downloadRequest: { getter: string.nullable },
    info: { getter: b.any, field: "info" },
    hasUAVisualTransition: { getter: b.bool, rustName: "has_visual_transition" },
    intercept: { args: { options: NavigationInterceptOptions.default({}) }, throws: true, ...heap },
    scroll: js,
  },
});

export const NavigationCurrentEntryChangeEventInit = dictionary(
  { from: NavigationHistoryEntry, navigationType: NavigationType.nullable.optional },
  DesktopEventInit,
);
export const NavigationCurrentEntryChangeEvent = b.interface("NavigationCurrentEntryChangeEvent", {
  extends: Event,
  rustPath: `${path}::NavigationCurrentEntryChangeEvent`,
  exposed,
  internalFields: ["from"],
  construct: construct(NavigationCurrentEntryChangeEventInit),
  proto: { navigationType: { getter: NavigationType.nullable }, from: { getter: b.any, field: "from" } },
});

const viewTransition = b.ref("ViewTransition").nullable.optional;
export const PageSwapEventInit = dictionary(
  { activation: NavigationActivation.nullable.optional, viewTransition },
  DesktopEventInit,
);
export const PageSwapEvent = b.interface("PageSwapEvent", {
  extends: Event,
  rustPath: `${path}::PageSwapEvent`,
  exposed,
  internalFields: ["activation", "viewTransition"],
  construct: construct(PageSwapEventInit.default({})),
  proto: each("activation viewTransition", field(b.object.nullable)),
});

export const NavigationTracker = b.interface("NavigationTracker", {
  rustPath: `${path}::Tracker`,
  noInterfaceObject: true,
  internalFields: ["committed", "finished", "entry", "info"],
  proto: {},
});

const result = { returns: b.any, ...js } as const;
const traverse = { args: { options: NavigationOptions.default({}) }, ...result } as const;
export const Navigation = b.interface("Navigation", {
  extends: DesktopEventTarget,
  rustPath: `${path}::Navigation`,
  exposed,
  internalFields: ["history", "activation", "transition", "event", "ongoing", "upcoming", "traversals", "resume"],
  proto: {
    entries: result,
    currentEntry: { getter: NavigationHistoryEntry.nullable, ...runs },
    updateCurrentEntry: { args: { options: NavigationUpdateCurrentEntryOptions }, ...js },
    transition: { getter: b.object.nullable, field: "transition" },
    activation: { getter: NavigationActivation.nullable, ...runs },
    canGoBack: { getter: b.bool, ...runs },
    canGoForward: { getter: b.bool, ...runs },
    navigate: { args: { url: usv, options: NavigationNavigateOptions.default({}) }, ...result },
    reload: { args: { options: NavigationReloadOptions.default({}) }, ...result },
    traverseTo: { args: { key: text, options: NavigationOptions.default({}) }, ...result },
    back: traverse,
    forward: traverse,
    ...handlers("navigate navigatesuccess navigateerror currententrychange"),
  },
});

const transfer = b.sequence(b.object).default([]);
export const WindowPostMessageOptions = dictionary({ targetOrigin: b.USVString.utf8.default("/"), transfer });
const postMessage = [
  { args: { message: b.any, targetOrigin: b.USVString.utf8, transfer }, ...js },
  { args: { message: b.any, options: WindowPostMessageOptions.default({}) }, rustName: "post_message_with", ...js },
] as const;

export const WindowMessaging = b.partial("WindowMessaging", {
  on: DomWindow,
  proto: { postMessage },
});

export const ForeignWindow = b.interface("ForeignWindow", {
  rustPath: `${path}::ForeignWindow`,
  noInterfaceObject: true,
  internalFields: ["itself", "location", "outer", "peer", "frame", "engine", "known"],
  proto: {
    ...each("window self frames", () => ({ getter: b.any, rustName: "itself" })),
    location: { getter: b.any, setter: { type: usv, ...js }, ...heap },
    close: runs,
    closed: { getter: b.bool, ...runs },
    focus: runs,
    blur: {},
    length: { getter: b.u32, ...runs },
    ...each("top opener parent", () => ({ getter: b.any, ...runs })),
    postMessage,
  },
});

export const ForeignLocation = b.interface("ForeignLocation", {
  rustPath: `${path}::ForeignLocation`,
  noInterfaceObject: true,
  internalFields: ["window"],
  proto: { href: { getter: usv, setter: true, ...js }, replace: { args: { url: usv }, ...js } },
});

/** As it comes back from what hosts the page. */
export const NavigateRequest = b.dictionary(
  {
    body: b.any.omittable,
    contentType: utf8.optional,
    download: string.optional,
    element: DomElement.optional,
    formData: b.any.omittable,
    hasTextActivation: flag,
    isByUser: flag,
    noDocument: b.any.omittable,
    referrerPolicy: string.optional,
    replace: flag,
    replaceIn: DomWindow.optional,
    source: utf8.default(""),
    srcdoc: string.optional,
  },
  { webidl: true, fromHost: true },
);

const window = DomWindow;
