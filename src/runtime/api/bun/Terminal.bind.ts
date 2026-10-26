import * as b from "../../../codegen/bindgen-lib.ts";

/** A termios flags word. The setter ignores its value once the terminal is closed. */
const flags = { getter: b.f64, setter: { type: b.opaque, capability: "js" }, throws: true } as const;
export const termiosFlags = b.conversion(b.f64.loose);

/** It only tells kinds apart: `toString` of a `String` object runs once the terminal is known to be open. */
export const TerminalData = b.union({
  missing: b.null,
  text: b.string.view,
  object: b.stringObject,
  buffer: b.bufferSource.allowShared,
  other: b.ignored,
});

/** `number` saturates and `other` wraps. */
export const TerminalSize = b.union({ number: b.f64, other: b.i32.allowBigInt.wrap });
export const TerminalOptions = b.dictionary(
  {
    cols: TerminalSize.nullable,
    rows: TerminalSize.nullable,
    name: { type: b.string.allowStringObject.utf8.owned.nullable, expected: ["string"] },
    data: b.callable.otherAsNull,
    exit: b.callable.otherAsNull,
    drain: b.callable.otherAsNull,
  },
  { deferred: true, reportedAs: "options" },
);

export const Terminal = b.class({
  rustPath: "crate::api::bun_terminal_body::Terminal",
  refCounted: true,
  finalize: true,
  construct: {
    passStructure: true,
    args: { options: TerminalOptions.otherAsNull },
    capability: "js",
    throws: true,
    length: 0,
  },
  internalFields: ["data", "drain", "exit"],
  proto: {
    close: { capability: "js" },
    closed: { getter: b.bool },
    controlFlags: flags,
    inputFlags: flags,
    localFlags: flags,
    outputFlags: flags,
    ref: { rustName: "do_ref" },
    resize: {
      args: { cols: b.f64.otherAsNull, rows: b.f64.otherAsNull },
      capability: "heap",
      throws: true,
      length: 2,
    },
    setRawMode: { args: { enabled: b.bool.loose }, capability: "heap", throws: true },
    unref: { rustName: "do_unref" },
    write: { args: { data: TerminalData }, returns: b.usize, capability: "js", throws: true },
    "@@asyncDispose": { returns: b.promise, capability: "js" },
  },
});
