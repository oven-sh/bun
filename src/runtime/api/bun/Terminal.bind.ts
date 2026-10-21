import * as b from "../../../codegen/bindgen-lib.ts";

/** A word of termios flags. What is assigned is converted only while the terminal is open. */
const flags = { getter: b.any, setter: { capability: "js" }, capability: "heap", throws: true } as const;

export const Terminal = b.class({
  rustPath: "crate::api::bun_terminal_body::Terminal",
  refCounted: true,
  finalize: true,
  configurable: false,
  construct: { passStructure: true, args: { options: b.any }, capability: "js", throws: true, length: 0 },
  /** The callbacks. */
  internalFields: ["data", "drain", "exit"],
  proto: {
    close: { capability: "js" },
    closed: { getter: b.bool },
    controlFlags: flags,
    inputFlags: flags,
    localFlags: flags,
    outputFlags: flags,
    ref: { rustName: "do_ref" },
    resize: { args: { cols: b.any, rows: b.any }, capability: "heap", throws: true },
    setRawMode: { args: { enabled: b.bool.loose }, capability: "heap", throws: true },
    unref: { rustName: "do_unref" },
    write: { args: { data: b.any }, returns: b.usize, capability: "js", throws: true },
    "@@asyncDispose": { returns: b.any, capability: "js" },
  },
});
