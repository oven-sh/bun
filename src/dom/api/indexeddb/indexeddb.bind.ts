import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget } from "../core/core.bind.ts";
import { DesktopEvent, DesktopEventInit, OnEvent } from "../events/events.bind.ts";

export default b.module({ rustPath: "crate::api::indexeddb", feature: "Desktop", isCold: true, membersInTable: false });

const heap = { capability: "heap" } as const;
const checks = { capability: "heap", throws: true } as const;
const runs = { capability: "js", throws: true } as const;
const flag = b.bool.loose.default(false);
const atom = b.DOMString.atom.as("crate::api::core::Atom");
const string = b.DOMString.impl.as("crate::api::core::DomString");
const exposed = ["Window", "Worker"] as const;
const rust = (name: string) => `crate::api::indexeddb::${name}`;
const field = (name: string, getter: any = b.any) => ({ getter, field: name }) as const;
const handlers = (...names: string[]) =>
  Object.fromEntries(names.map(name => ["on" + name, OnEvent.of(`crate::api::core::atom!("${name}")`)]));
const dictionary = (members: Record<string, any>) => b.dictionary(members, { webidl: true });
const request = { returns: b.ref("IDBRequest"), ...runs } as const;
const names = { getter: b.ref("DOMStringList"), ...heap } as const;

export const IDBRequestReadyState = b.enumeration(["pending", "done"]);
export const IDBTransactionMode = b.enumeration(["readonly", "readwrite", "versionchange"]);
export const IDBTransactionDurability = b.enumeration(["default", "strict", "relaxed"]);
export const IDBCursorDirection = b.enumeration(["next", "nextunique", "prev", "prevunique"]);
export const IDBNames = b.union({ one: b.DOMString, several: b.sequence(b.DOMString) }, { webidl: true });

export const IDBTransactionOptions = dictionary({ durability: IDBTransactionDurability.default("default") });
export const IDBObjectStoreParameters = dictionary({ keyPath: IDBNames.nullable.optional, autoIncrement: flag });
export const IDBIndexParameters = dictionary({ unique: flag, multiEntry: flag });
export const IDBGetAllOptions = b.dictionary(
  { query: b.any.omittable, count: b.u32.enforceRange().optional, direction: IDBCursorDirection.default("next") },
  { webidl: true, fromJS: true },
);
export const IDBVersionChangeEventInit = b.dictionary(
  { oldVersion: b.u64.wrap.default(0), newVersion: b.u64.wrap.nullable.optional },
  { webidl: true, extends: DesktopEventInit },
);

export const IDBRequest = b.interface("IDBRequest", {
  extends: DesktopEventTarget,
  rustPath: rust("IDBRequest"),
  exposed,
  internalFields: {
    result: b.any,
    error: b.any,
    source: b.any,
    transaction: b.ref("IDBTransaction"),
    next: b.ref("IDBRequest"),
    cursor: b.ref("IDBCursor"),
  },
  proto: {
    result: { getter: b.any, ...checks },
    error: { getter: b.object.nullable, ...checks },
    source: field("source", b.object.nullable),
    transaction: field("transaction", b.ref("IDBTransaction").nullable),
    readyState: { getter: IDBRequestReadyState },
    ...handlers("success", "error"),
  },
});

export const IDBOpenDBRequest = b.interface("IDBOpenDBRequest", {
  extends: IDBRequest,
  exposed,
  proto: handlers("blocked", "upgradeneeded"),
});

export const IDBVersionChangeEvent = b.interface("IDBVersionChangeEvent", {
  extends: DesktopEvent,
  rustPath: rust("IDBVersionChangeEvent"),
  exposed,
  construct: { args: { type: atom, init: IDBVersionChangeEventInit.default({}) } },
  proto: { oldVersion: { getter: b.u64 }, newVersion: { getter: b.u64.nullable } },
});

export const IDBFactory = b.interface("IDBFactory", {
  internalFields: { scope: b.ref("WindowTarget") },
  exposed,
  proto: {
    open: { args: { name: string, version: b.u64.enforceRange().optional }, returns: IDBOpenDBRequest, ...runs },
    deleteDatabase: { args: { name: string }, returns: IDBOpenDBRequest, ...runs },
    databases: { returns: b.any, rejects: true, ...runs },
    cmp: { args: { first: b.any, second: b.any }, returns: b.i16, ...runs },
  },
});

export const IDBDatabase = b.interface("IDBDatabase", {
  extends: DesktopEventTarget,
  rustPath: rust("IDBDatabase"),
  exposed,
  internalFields: { upgrade: b.ref("IDBTransaction"), transactions: b.any },
  proto: {
    name: { getter: string, ...heap },
    version: { getter: b.u64 },
    objectStoreNames: names,
    transaction: {
      args: {
        storeNames: IDBNames,
        mode: IDBTransactionMode.default("readonly"),
        options: IDBTransactionOptions.default({}),
      },
      returns: b.ref("IDBTransaction"),
      ...runs,
    },
    close: {},
    createObjectStore: {
      args: { name: string, options: IDBObjectStoreParameters.default({}) },
      returns: b.ref("IDBObjectStore"),
      ...checks,
    },
    deleteObjectStore: { args: { name: string }, ...checks },
    ...handlers("abort", "close", "error", "versionchange"),
  },
});

export const IDBTransaction = b.interface("IDBTransaction", {
  extends: DesktopEventTarget,
  rustPath: rust("IDBTransaction"),
  exposed,
  internalFields: {
    db: IDBDatabase,
    error: b.any,
    first: IDBRequest,
    last: IDBRequest,
    opener: IDBRequest,
    stores: b.any,
  },
  proto: {
    objectStoreNames: names,
    mode: { getter: IDBTransactionMode },
    durability: { getter: IDBTransactionDurability },
    db: field("db", IDBDatabase),
    error: field("error", b.object.nullable),
    objectStore: { args: { name: string }, returns: b.ref("IDBObjectStore"), ...checks },
    commit: checks,
    abort: checks,
    ...handlers("abort", "complete", "error"),
  },
});

export const IDBSource = b.interface("IDBSource", {
  abstract: true,
  rustPath: rust("IDBSource"),
  internalFields: { transaction: IDBTransaction, keyPath: b.any, objectStore: b.ref("IDBObjectStore"), indexes: b.any },
});

const count = b.u32.enforceRange().optional;
const direction = IDBCursorDirection.default("next");
export const IDBReading = b.mixin("IDBReading", {
  on: IDBSource,
  proto: {
    name: { getter: string, setter: true, ...checks },
    keyPath: { getter: b.any, ...checks },
    get: { args: { query: b.any }, ...request },
    getKey: { args: { query: b.any }, ...request },
    getAll: { args: { queryOrOptions: b.any.omittable, count }, ...request },
    getAllKeys: { args: { queryOrOptions: b.any.omittable, count }, ...request },
    getAllRecords: { args: { options: IDBGetAllOptions.default({}) }, ...request },
    count: { args: { query: b.any.omittable }, ...request },
    openCursor: { args: { query: b.any.omittable, direction }, ...request },
    openKeyCursor: { args: { query: b.any.omittable, direction }, ...request },
  },
});

export const IDBObjectStore = b.interface("IDBObjectStore", {
  extends: IDBSource,
  includes: [IDBReading],
  exposed,
  proto: {
    indexNames: names,
    transaction: field("transaction", IDBTransaction),
    autoIncrement: { getter: b.bool },
    put: { args: { value: b.any, key: b.any.omittable }, ...request },
    add: { args: { value: b.any, key: b.any.omittable }, ...request },
    delete: { args: { query: b.any }, ...request },
    clear: { ...request, ...checks },
    index: { args: { name: string }, returns: b.ref("IDBIndex"), ...checks },
    createIndex: {
      args: { name: string, keyPath: IDBNames, options: IDBIndexParameters.default({}) },
      returns: b.ref("IDBIndex"),
      ...checks,
    },
    deleteIndex: { args: { name: string }, ...checks },
  },
});

export const IDBIndex = b.interface("IDBIndex", {
  extends: IDBSource,
  includes: [IDBReading],
  exposed,
  proto: {
    objectStore: field("objectStore", IDBObjectStore),
    multiEntry: { getter: b.bool },
    unique: { getter: b.bool },
  },
});

export const IDBKeyRange = b.interface("IDBKeyRange", {
  rustPath: rust("IDBKeyRange"),
  exposed,
  proto: {
    lower: { getter: b.any, ...checks },
    upper: { getter: b.any, ...checks },
    lowerOpen: { getter: b.bool },
    upperOpen: { getter: b.bool },
    includes: { args: { key: b.any }, returns: b.bool, ...runs },
  },
  static: {
    only: { args: { value: b.any }, returns: b.ref("IDBKeyRange"), ...runs },
    lowerBound: { args: { lower: b.any, open: flag }, returns: b.ref("IDBKeyRange"), ...runs },
    upperBound: { args: { upper: b.any, open: flag }, returns: b.ref("IDBKeyRange"), ...runs },
    bound: {
      args: { lower: b.any, upper: b.any, lowerOpen: flag, upperOpen: flag },
      returns: b.ref("IDBKeyRange"),
      ...runs,
    },
  },
});

export const IDBRecord = b.interface("IDBRecord", {
  exposed,
  internalFields: ["key", "primaryKey", "value"],
  proto: { key: field("key"), primaryKey: field("primaryKey"), value: field("value") },
});

export const IDBCursor = b.interface("IDBCursor", {
  rustPath: rust("IDBCursor"),
  exposed,
  internalFields: { source: IDBSource, request: IDBRequest, key: b.any, primaryKey: b.any, value: b.any },
  proto: {
    source: field("source", b.object),
    direction: { getter: IDBCursorDirection },
    key: field("key"),
    primaryKey: field("primaryKey"),
    request: field("request", IDBRequest),
    advance: { args: { count: b.u32.enforceRange() }, ...checks },
    continue: { args: { key: b.any.omittable }, rustName: "proceed", ...runs },
    continuePrimaryKey: { args: { key: b.any, primaryKey: b.any }, ...runs },
    update: { args: { value: b.any }, ...request },
    delete: { ...request, ...checks },
  },
});

export const IDBCursorWithValue = b.interface("IDBCursorWithValue", {
  extends: IDBCursor,
  exposed,
  proto: { value: field("value") },
});
