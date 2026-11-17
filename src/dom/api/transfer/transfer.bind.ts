import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget, DomElement } from "../core/core.bind.ts";
import { DesktopEventInit, DesktopEvent as Event, OnEvent } from "../events/events.bind.ts";

export default b.module({ rustPath: "crate::api::transfer", feature: "Desktop", membersInTable: false, isCold: true });

const heap = { capability: "heap" } as const;
const string = b.DOMString.impl.as("crate::api::core::DomString");

export const FileList = b.interface("FileList", {
  internalFields: ["files", "transfer"],
  indexed: { getter: b.any },
  serializable: true,
  proto: { length: { getter: b.u32 }, item: { args: { index: b.u32.wrap }, returns: b.any } },
});

export const DataTransferItem = b.interface("DataTransferItem", {
  rustPath: "crate::api::transfer::DataTransferItem",
  internalFields: ["transfer", "file"],
  proto: {
    kind: { getter: string },
    type: { getter: string },
    getAsString: { args: { callback: b.callable.nullable }, capability: "js" },
    getAsFile: { returns: b.any },
    webkitGetAsEntry: { returns: b.ref("FileSystemEntry").nullable, ...heap },
  },
});

export const DataTransferItemList = b.interface("DataTransferItemList", {
  internalFields: ["transfer"],
  indexed: { getter: DataTransferItem },
  proto: {
    length: { getter: b.u32 },
    add: [
      {
        args: { data: b.object },
        returns: DataTransferItem.nullable,
        rustName: "add_file",
        capability: "js",
        throws: true,
      },
      {
        args: { data: string, type: string },
        returns: DataTransferItem.nullable,
        rustName: "add_text",
        throws: true,
        ...heap,
      },
    ],
    remove: { args: { index: b.u32.wrap }, throws: true, ...heap },
    clear: heap,
  },
});

export const DataTransfer = b.interface("DataTransfer", {
  rustPath: "crate::api::transfer::DataTransfer",
  internalFields: ["items", "list", "files", "types", "dragImage"],
  construct: {},
  proto: {
    dropEffect: { getter: string, setter: true, rustName: "drop_effect_name" },
    effectAllowed: { getter: string, setter: true, rustName: "effect_allowed_name" },
    items: { getter: DataTransferItemList, ...heap },
    setDragImage: { args: { image: DomElement, x: b.i32.wrap, y: b.i32.wrap }, rustName: "choose_drag_image" },
    types: { getter: b.any, throws: true, ...heap },
    getData: { args: { format: string }, returns: string, rustName: "get_data" },
    setData: { args: { format: string, data: string }, rustName: "set_data", ...heap },
    clearData: { args: { format: string.optional }, ...heap },
    files: { getter: FileList, ...heap },
  },
});

const path = "crate::api::transfer::clipboard";
const promises = { returns: b.any.returning("Promise"), rejects: true, throws: true, capability: "js" } as const;
const types = { getter: b.frozenArray(string), cache: true } as const;

export const PresentationStyle = b.enumeration(["unspecified", "inline", "attachment"]);
export const ClipboardItemOptions = b.dictionary(
  { presentationStyle: PresentationStyle.default("unspecified") },
  { webidl: true },
);
export const ClipboardItem = b.interface("ClipboardItem", {
  rustPath: `${path}::ClipboardItem`,
  internalFields: ["values"],
  construct: {
    args: { items: b.recordOf(b.DOMString.impl, b.any), options: ClipboardItemOptions.default({}) },
    passStructure: true,
    throws: true,
    ...heap,
  },
  static: { supports: { args: { type: string }, returns: b.bool } },
  proto: { presentationStyle: { getter: PresentationStyle }, types, getType: { args: { type: string }, ...promises } },
});

export const ClipboardUnsanitizedFormats = b.dictionary(
  { unsanitized: b.sequenceVec(b.DOMString.utf8.owned).optional },
  { webidl: true },
);
export const Clipboard = b.interface("Clipboard", {
  extends: DesktopEventTarget,
  rustPath: `${path}::Clipboard`,
  internalFields: ["window"],
  proto: {
    read: { args: { formats: ClipboardUnsanitizedFormats.default({}) }, ...promises },
    readText: promises,
    write: { args: { data: b.sequence(ClipboardItem) }, ...promises },
    writeText: { args: { data: string }, ...promises },
    onclipboardchange: OnEvent.of('crate::api::core::atom!("clipboardchange")'),
  },
});

export const ClipboardChangeEventInit = b.dictionary(
  { changeId: b.any.omittable, types: b.sequence(b.DOMString.impl).default([]) },
  { webidl: true, extends: DesktopEventInit },
);
export const ClipboardChangeEvent = b.interface("ClipboardChangeEvent", {
  extends: Event,
  rustPath: `${path}::ClipboardChangeEvent`,
  internalFields: ["changeId"],
  construct: {
    args: { type: b.DOMString.atom.as("crate::api::core::Atom"), eventInitDict: ClipboardChangeEventInit.default({}) },
    passStructure: true,
    throws: true,
    ...heap,
  },
  proto: { types, changeId: { getter: b.any, field: "changeId" } },
});

const callbacks = { successCallback: b.callable, errorCallback: b.callable.optional };
const exposed = ["Window"] as const;
export const FileSystemEntry = b.interface("FileSystemEntry", {
  rustPath: "crate::api::transfer::entries::FileSystemEntry",
  exposed,
  internalFields: ["file"],
  proto: {
    isFile: { getter: b.bool },
    isDirectory: { getter: b.bool },
    name: { getter: string },
    fullPath: { getter: string },
  },
});
export const FileSystemFileEntry = b.interface("FileSystemFileEntry", {
  extends: FileSystemEntry,
  exposed,
  proto: { file: { args: callbacks, ...heap } },
});
export const FileSystemDirectoryReader = b.interface("FileSystemDirectoryReader", {
  exposed,
  proto: { readEntries: { args: callbacks, throws: true, ...heap } },
});
export const FileSystemDirectoryEntry = b.interface("FileSystemDirectoryEntry", {
  extends: FileSystemEntry,
  exposed,
  proto: { createReader: { returns: FileSystemDirectoryReader, ...heap } },
});
