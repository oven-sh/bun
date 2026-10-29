import * as b from "../../../codegen/bindgen-lib.ts";

/** A termios flags word. The setter ignores its value once the terminal is closed. */
const flags = { getter: b.f64, setter: { type: b.opaque, capability: "js" }, throws: true } as const;

export const TerminalOptions = b.dictionary(
  {
    cols: b.opaque.nullable,
    rows: b.opaque.nullable,
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
    closed: { getter: b.bool, pure: true },
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
    write: { args: { data: b.opaque }, returns: b.usize, capability: "js", throws: true },
    "@@asyncDispose": { returns: b.promise, capability: "js" },
  },
});
