import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget } from "../core/core.bind.ts";
import { DesktopEvent, DesktopEventInit, OnEvent } from "../events/events.bind.ts";

export default b.module({ rustPath: "crate::api::storage", feature: "Desktop", isCold: true, membersInTable: false });

const heap = { capability: "heap" } as const;
const runs = { capability: "js", throws: true } as const;
const promises = { returns: b.any, rejects: true, ...runs } as const;
const flag = b.bool.loose.default(false);
const atom = b.DOMString.atom.as("crate::api::core::Atom");
const string = b.DOMString.impl.as("crate::api::core::DomString");
const usv = b.USVString.impl.as("crate::api::core::DomString");
const name = b.USVString.utf8;
const blob = b.instanceOf("Blob", "Bun::Bindgen::Generated::JSBlob", "GeneratedBlob.h");
const exposed = ["Window", "Worker"] as const;
const secure = { exposed, secure: true } as const;
const rust = (name: string) => `crate::api::storage::${name}`;
const dictionary = (members: Record<string, any>, more = {}) => b.dictionary(members, { webidl: true, ...more });

export const DOMStringList = b.interface("DOMStringList", {
  rustPath: rust("DOMStringList"),
  exposed,
  indexed: { getter: string, ...heap },
  proto: {
    length: { getter: b.u32 },
    item: { args: { index: b.u32.wrap }, returns: string.nullable, rustName: "indexed_get", ...heap },
    contains: { args: { string }, returns: b.bool },
  },
});

// ───────────────────────────── web storage ─────────────────────────────

export const WebStorage = b.interface("WebStorage", {
  name: "Storage",
  rustPath: rust("WebStorage"),
  exposed: ["Window"],
  internalFields: { window: b.ref("DomWindow") },
  named: { getter: string, setter: true, deleter: true, ...runs },
  proto: {
    length: { getter: b.u32, ...heap, throws: true },
    key: { args: { index: b.u32.wrap }, returns: atom.nullable, ...heap, throws: true },
    getItem: { args: { key: atom }, returns: string.nullable, ...heap, throws: true },
    setItem: { args: { key: atom, value: string }, ...runs },
    removeItem: { args: { key: atom }, ...runs },
    clear: runs,
  },
});

const stored = {
  key: string.nullable.optional,
  oldValue: string.nullable.optional,
  newValue: string.nullable.optional,
};
export const StorageEventInit = dictionary(
  { ...stored, url: usv.default(""), storageArea: WebStorage.nullable.optional },
  { extends: DesktopEventInit },
);
export const StorageEvent = b.interface("StorageEvent", {
  extends: DesktopEvent,
  rustPath: rust("StorageEvent"),
  exposed: ["Window"],
  internalFields: { storageArea: WebStorage },
  construct: { args: { type: atom, init: StorageEventInit.default({}) }, passStructure: true, ...heap },
  proto: {
    key: { getter: string.nullable, ...heap },
    oldValue: { getter: string.nullable, ...heap },
    newValue: { getter: string.nullable, ...heap },
    url: { getter: string, ...heap },
    storageArea: { getter: WebStorage.nullable, field: "storageArea" },
    initStorageEvent: {
      args: {
        type: atom,
        bubbles: flag,
        cancelable: flag,
        ...stored,
        url: usv.default(""),
        storageArea: WebStorage.nullable.optional,
      },
    },
  },
});

// ───────────────────────────── reading files ─────────────────────────────

export const ProgressEventInit = dictionary(
  { lengthComputable: flag, loaded: b.double.default(0), total: b.double.default(0) },
  { extends: DesktopEventInit },
);
export const ProgressEvent = b.interface("ProgressEvent", {
  extends: DesktopEvent,
  rustPath: rust("ProgressEvent"),
  exposed,
  construct: { args: { type: atom, init: ProgressEventInit.default({}) } },
  proto: { lengthComputable: { getter: b.bool }, loaded: { getter: b.f64 }, total: { getter: b.f64 } },
});

const reading = (more: object) => ({
  readAsArrayBuffer: { args: { blob }, ...runs, ...more },
  readAsBinaryString: { args: { blob }, ...runs, ...more },
  readAsText: { args: { blob, encoding: b.DOMString.utf8.optional }, ...runs, ...more },
  readAsDataURL: { args: { blob }, rustName: "read_as_data_url", ...runs, ...more },
});
export const DomFileReader = b.interface("DomFileReader", {
  name: "FileReader",
  extends: DesktopEventTarget,
  rustPath: rust("FileReader"),
  exposed,
  internalFields: ["result", "error"],
  constants: { EMPTY: 0, LOADING: 1, DONE: 2 },
  construct: {},
  proto: {
    ...reading({}),
    abort: { capability: "js" },
    readyState: { getter: b.u16 },
    result: { getter: b.any, field: "result" },
    error: { getter: b.object.nullable, field: "error" },
    ...Object.fromEntries(
      ["loadstart", "progress", "load", "abort", "error", "loadend"].map(name => [
        "on" + name,
        OnEvent.of(`crate::api::core::atom!("${name}")`),
      ]),
    ),
  },
});
export const FileReaderSync = b.interface("FileReaderSync", {
  exposed: ["DedicatedWorker", "SharedWorker"],
  construct: {},
  proto: reading({ returns: b.any }),
});

// ───────────────────────────── the file system ─────────────────────────────

export const StorageManager = b.interface("StorageManager", {
  internalFields: { scope: b.ref("WindowTarget") },
  ...secure,
  proto: {
    persisted: promises,
    persist: { ...promises, exposed: ["Window"] },
    estimate: promises,
    getDirectory: promises,
  },
});

export const FileSystemHandleKind = b.enumeration(["file", "directory"]);
export const FileSystemPermissionMode = b.enumeration(["read", "readwrite"]);
export const FileSystemWritableMode = b.enumeration(["exclusive", "siloed"]);
export const FileSystemSyncAccessMode = b.enumeration(["readwrite", "read-only", "readwrite-unsafe"]);
export const WriteCommandType = b.enumeration(["write", "seek", "truncate"]);
export const FileSystemPermissionDescriptor = dictionary({ mode: FileSystemPermissionMode.default("read") });
export const FileSystemCreateWritableOptions = dictionary({
  keepExistingData: flag,
  mode: FileSystemWritableMode.default("siloed"),
});
export const FileSystemSyncAccessOptions = dictionary({ mode: FileSystemSyncAccessMode.default("readwrite") });
export const FileSystemGetOptions = dictionary({ create: flag });
export const FileSystemRemoveOptions = dictionary({ recursive: flag });
export const FileSystemReadWriteOptions = dictionary({ at: b.u64.enforceRange().optional });
export const WriteParams = dictionary(
  {
    type: WriteCommandType,
    size: b.u64.wrap.nullable.optional,
    position: b.u64.wrap.nullable.optional,
    data: b.any.omittable,
  },
  { fromJS: true },
);

const permission = { args: { descriptor: FileSystemPermissionDescriptor.default({}) }, ...promises };
export const FileSystemHandle = b.interface("FileSystemHandle", {
  ...secure,
  rustPath: rust("FileSystemHandle"),
  proto: {
    kind: { getter: FileSystemHandleKind },
    name: { getter: name },
    isSameEntry: { args: { other: b.ref("FileSystemHandle") }, ...promises },
    queryPermission: permission,
    requestPermission: { ...permission, rustName: "query_permission" },
    remove: { args: { options: FileSystemRemoveOptions.default({}) }, ...promises },
  },
});

export const FileSystemFileHandle = b.interface("FileSystemFileHandle", {
  ...secure,
  extends: FileSystemHandle,
  serializable: true,
  proto: {
    getFile: promises,
    createWritable: { args: { options: FileSystemCreateWritableOptions.default({}) }, ...promises },
    createSyncAccessHandle: {
      args: { options: FileSystemSyncAccessOptions.default({}) },
      exposed: ["DedicatedWorker"],
      ...promises,
    },
    move: [
      { args: { name }, rustName: "rename", ...promises },
      { args: { directory: b.ref("FileSystemDirectoryHandle") }, rustName: "move_to", ...promises },
      { args: { directory: b.ref("FileSystemDirectoryHandle"), name }, rustName: "move_and_rename", ...promises },
    ],
  },
});

export const FileSystemDirectoryIterator = b.interface("FileSystemDirectoryIterator", {
  name: "FileSystemDirectoryHandle AsyncIterator",
  rustPath: rust("FileSystemDirectoryIterator"),
  noInterfaceObject: true,
  prototypeBase: "AsyncIterator",
  proto: { next: promises },
});

const iterates = { returns: FileSystemDirectoryIterator, ...heap } as const;
export const FileSystemDirectoryHandle = b.interface("FileSystemDirectoryHandle", {
  ...secure,
  extends: FileSystemHandle,
  serializable: true,
  sameFunction: { "@@asyncIterator": "entries" },
  proto: {
    getFileHandle: { args: { name, options: FileSystemGetOptions.default({}) }, ...promises },
    getDirectoryHandle: { args: { name, options: FileSystemGetOptions.default({}) }, ...promises },
    removeEntry: { args: { name, options: FileSystemRemoveOptions.default({}) }, ...promises },
    resolve: { args: { possibleDescendant: FileSystemHandle }, ...promises },
    entries: iterates,
    keys: iterates,
    values: iterates,
  },
});

export const FileSystemWritableFileStream = b.interface("FileSystemWritableFileStream", {
  ...secure,
  rustPath: rust("FileSystemWritableFileStream"),
  prototypeBase: "WritableStream",
  internalFields: ["stream"],
  proto: {
    mode: { getter: FileSystemWritableMode },
    write: { args: { data: b.any }, ...promises },
    seek: { args: { position: b.u64.wrap }, ...promises },
    truncate: { args: { size: b.u64.wrap }, ...promises },
  },
});

const transfers = {
  args: { buffer: b.bufferSource.allowShared, options: FileSystemReadWriteOptions.default({}) },
  returns: b.u64,
  ...runs,
};
export const FileSystemSyncAccessHandle = b.interface("FileSystemSyncAccessHandle", {
  exposed: ["DedicatedWorker"],
  secure: true,
  rustPath: rust("FileSystemSyncAccessHandle"),
  proto: {
    mode: { getter: FileSystemSyncAccessMode },
    read: transfers,
    write: transfers,
    truncate: { args: { newSize: b.u64.enforceRange() }, ...runs },
    getSize: { returns: b.u64, ...runs },
    flush: runs,
    close: {},
  },
});
