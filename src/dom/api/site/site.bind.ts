// What a site is, and what it may ask for.
import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget } from "../core/core.bind.ts";
import { Handler } from "../events/attributes.bind.ts";
import { DesktopEvent, DesktopEventInit } from "../events/events.bind.ts";
import { AnyNavigator, DomNavigator, DomWindow, WorkerNavigator } from "../window/window.bind.ts";

export default b.module({ rustPath: "crate::api::site", feature: "Desktop", isCold: true, membersInTable: false });

const path = "crate::api::site";
const heap = { capability: "heap" } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const promise = { returns: b.any.returning("Promise"), rejects: true, ...js } as const;
const everywhere = ["Window", "Worker"] as const;
const inWindows = ["Window"] as const;
const string = b.DOMString.impl.as("crate::api::core::DomString");
const usv = b.USVString.impl.as("crate::api::core::DomString");
const utf8 = b.DOMString.utf8;
const atom = b.DOMString.atom.as("crate::api::core::Atom");
const flag = b.bool.loose.default(false);
const dictionary = (members: Record<string, any>, more = {}) => b.dictionary(members, { webidl: true, ...more });
const each = (names: string, member: (name: string) => any) =>
  Object.fromEntries(names.split(/\s+/).map(it => [it, member(it)]));
const field = (name: string) => ({ getter: b.any, field: name }) as const;

// ───────────────────────────── errors ─────────────────────────────

export const DerivedException = b.interface("DerivedException", {
  abstract: true,
  prototypeBase: "DOMException",
  rustPath: `${path}::DerivedException`,
  size: 8,
});

export const QuotaExceededErrorOptions = dictionary({ quota: b.double.optional, requested: b.double.optional });
export const QuotaExceededError = b.interface("QuotaExceededError", {
  extends: DerivedException,
  rustPath: `${path}::QuotaExceededError`,
  exposed: everywhere,
  serializable: true,
  construct: {
    args: { message: string.default(""), options: QuotaExceededErrorOptions.default({}) },
    passStructure: true,
    ...heap,
    throws: true,
  },
  proto: { quota: { getter: b.f64.nullable }, requested: { getter: b.f64.nullable } },
});

// ───────────────────────────── origins ─────────────────────────────

export const DomOrigin = b.interface("DomOrigin", {
  name: "Origin",
  rustPath: `${path}::DomOrigin`,
  exposed: everywhere,
  construct: {},
  static: { from: { args: { value: b.any }, returns: b.ref("DomOrigin"), rustName: "of", ...js } },
  proto: {
    opaque: { getter: b.bool },
    isSameOrigin: { args: { other: b.ref("DomOrigin") }, returns: b.bool },
    isSameSite: { args: { other: b.ref("DomOrigin") }, returns: b.bool },
  },
});

// ───────────────────────────── permissions ─────────────────────────────

export const PermissionDescriptor = dictionary({ name: b.DOMString.impl }, { fromJS: true });

export const PermissionStatus = b.interface("PermissionStatus", {
  extends: DesktopEventTarget,
  rustPath: `${path}::PermissionStatus`,
  exposed: everywhere,
  proto: { state: { getter: b.string.utf8, ...runs }, name: { getter: b.string.utf8 }, onchange: Handler.of() },
});
export const Permissions = b.interface("Permissions", {
  exposed: everywhere,
  proto: { query: { args: { permissionDesc: b.object }, ...promise } },
});

export const NotificationDirection = b.enumeration(["auto", "ltr", "rtl"]);
export const VibratePattern = b.union({ once: b.u32.wrap, pattern: b.sequenceVec(b.u32.wrap) }, { webidl: true });
export const NotificationOptions = dictionary({
  actions: b.sequence(b.any).default([]),
  badge: usv.optional,
  body: string.default(""),
  data: b.any.omittable,
  dir: NotificationDirection.default("auto"),
  icon: usv.optional,
  image: usv.optional,
  lang: string.default(""),
  navigate: usv.optional,
  renotify: flag,
  requireInteraction: flag,
  silent: b.bool.loose.nullable.optional,
  tag: string.default(""),
  timestamp: b.u64.wrap.optional,
  vibrate: VibratePattern.optional,
});
export const DomNotification = b.interface("DomNotification", {
  name: "Notification",
  extends: DesktopEventTarget,
  rustPath: `${path}::Notification`,
  exposed: everywhere,
  internalFields: ["vibrate", "data", "actions"],
  construct: { args: { title: string, options: NotificationOptions.default({}) }, passStructure: true, ...js },
  static: {
    permission: { getter: b.string.utf8, ...runs },
    requestPermission: { args: { deprecatedCallback: b.callable.optional }, exposed: inWindows, ...promise },
    maxActions: { getter: b.u32 },
  },
  proto: {
    ...each("onclick onshow onerror onclose", () => Handler.of()),
    title: { getter: string },
    dir: { getter: NotificationDirection },
    ...each("lang body navigate tag image icon badge", () => ({ getter: string })),
    vibrate: field("vibrate"),
    timestamp: { getter: b.f64 },
    renotify: { getter: b.bool },
    silent: { getter: b.bool.nullable },
    requireInteraction: { getter: b.bool },
    data: field("data"),
    actions: field("actions"),
    close: runs,
  },
});

// ───────────────────────────── locks ─────────────────────────────

export const WebLockMode = b.enumeration(["shared", "exclusive"]);
export const WebLock = b.interface("WebLock", {
  name: "Lock",
  rustPath: `${path}::Lock`,
  exposed: everywhere,
  secure: true,
  proto: { name: { getter: string }, mode: { getter: WebLockMode } },
});
export const LockOptions = dictionary({
  ifAvailable: flag,
  mode: WebLockMode.default("exclusive"),
  signal: b.instanceOf("AbortSignal", "WebCore::JSAbortSignal", "JSAbortSignal.h").optional,
  steal: flag,
});
export const WebLockManager = b.interface("WebLockManager", {
  name: "LockManager",
  exposed: everywhere,
  secure: true,
  proto: {
    request: [
      { args: { name: string, callback: b.callable }, ...promise },
      { args: { name: string, options: LockOptions, callback: b.callable }, rustName: "request_with", ...promise },
    ],
    query: promise,
  },
});

// ───────────────────────────── reports ─────────────────────────────

export const SecurityPolicyViolationEventDisposition = b.enumeration(["enforce", "report"]);
const texts = "violatedDirective effectiveDirective originalPolicy sample";
export const SecurityPolicyViolationEventInit = dictionary(
  {
    ...each("documentURI referrer blockedURI sourceFile", () => b.USVString.impl.default("")),
    ...each(texts, () => b.DOMString.impl.default("")),
    disposition: SecurityPolicyViolationEventDisposition.default("enforce"),
    statusCode: b.u16.wrap.default(0),
    lineNumber: b.u32.wrap.default(0),
    columnNumber: b.u32.wrap.default(0),
  },
  { extends: DesktopEventInit },
);
export const ViolationText = b.family("ViolationText", { on: DesktopEvent, getter: string });
export const SecurityPolicyViolationEvent = b.interface("SecurityPolicyViolationEvent", {
  extends: DesktopEvent,
  rustPath: `${path}::SecurityPolicyViolationEvent`,
  exposed: everywhere,
  construct: {
    args: { type: atom, eventInitDict: SecurityPolicyViolationEventInit.default({}) },
    passStructure: true,
    ...heap,
  },
  proto: {
    ...each(`documentURI referrer blockedURI sourceFile ${texts}`, () => ViolationText.of()),
    disposition: { getter: SecurityPolicyViolationEventDisposition },
    statusCode: { getter: b.u16 },
    lineNumber: { getter: b.u32 },
    columnNumber: { getter: b.u32 },
  },
});

export const ReportingObserverOptions = dictionary({ buffered: flag, types: b.sequence(b.DOMString.impl).default([]) });
export const ReportingObserver = b.interface("ReportingObserver", {
  rustPath: `${path}::ReportingObserver`,
  exposed: everywhere,
  internalFields: ["callback", "queue"],
  construct: {
    args: { callback: b.callable, options: ReportingObserverOptions.default({}) },
    passStructure: true,
    ...heap,
  },
  proto: { observe: heap, disconnect: heap, takeRecords: { returns: b.any.returning("Array"), ...heap, throws: true } },
});
/** Of a realm. `types` goes with `reports`. */
export const Reports = b.interface("Reports", { internalFields: ["reports", "types", "observers"] });

// ───────────────────────────── cookies ─────────────────────────────

export const CookieSameSite = b.enumeration(["strict", "lax", "none"]);
export const CookieStoreGetOptions = dictionary({ name: utf8.optional, url: usv.optional });
export const CookieInit = dictionary({
  domain: utf8.nullable.optional,
  expires: b.double.nullable.optional,
  maxAge: b.i64.wrap.nullable.optional,
  name: utf8,
  partitioned: flag,
  path: utf8.default("/"),
  sameSite: CookieSameSite.default("strict"),
  value: utf8,
});
export const CookieStoreDeleteOptions = dictionary({
  domain: utf8.nullable.optional,
  name: utf8,
  partitioned: flag,
  path: utf8.default("/"),
});
const byNameOr = (name: string, options: any) => [
  { args: { name: utf8 }, rustName: name, ...promise },
  { args: { options }, rustName: name + "_with", ...promise },
];
export const CookieStore = b.interface("CookieStore", {
  extends: DesktopEventTarget,
  exposed: inWindows,
  secure: true,
  proto: {
    get: byNameOr("get", CookieStoreGetOptions.default({})),
    getAll: byNameOr("get_all", CookieStoreGetOptions.default({})),
    set: [
      { args: { name: utf8, value: utf8 }, ...promise },
      { args: { options: CookieInit }, rustName: "set_with", ...promise },
    ],
    delete: byNameOr("delete", CookieStoreDeleteOptions),
    onchange: Handler.of(),
  },
});

export const CookieChangeEventInit = dictionary(
  { changed: b.sequence(b.any).default([]), deleted: b.sequence(b.any).default([]) },
  { extends: DesktopEventInit },
);
export const CookieChangeEvent = b.interface("CookieChangeEvent", {
  extends: DesktopEvent,
  exposed: inWindows,
  secure: true,
  internalFields: ["changed", "deleted"],
  construct: { args: { type: atom, eventInitDict: CookieChangeEventInit.default({}) }, passStructure: true, ...js },
  proto: { changed: field("changed"), deleted: field("deleted") },
});

// ───────────────────────────── where they are found ─────────────────────────────

export const NavigatorOfSite = b.mixin("NavigatorOfSite", {
  on: AnyNavigator,
  proto: {
    permissions: { getter: Permissions, ...heap },
    locks: { getter: WebLockManager, secure: true, ...heap },
  },
});
for (const it of [DomNavigator, WorkerNavigator]) b.include(it, NavigatorOfSite);
export const WindowOfSite = b.partial("WindowOfSite", {
  on: DomWindow,
  proto: { cookieStore: { getter: CookieStore, secure: true, ...runs } },
});
