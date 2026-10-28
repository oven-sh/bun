import * as b from "../../../codegen/bindgen-lib.ts";

/** A termios flags word. The setter ignores its value once the terminal is closed. */
const flags = {
  getter: b.any.returning("number"),
  setter: { capability: "js" },
  capability: "heap",
  throws: true,
} as const;

export const Terminal = b.class({
  rustPath: "crate::api::bun_terminal_body::Terminal",
  refCounted: true,
  finalize: true,
  construct: { passStructure: true, args: { options: b.any }, capability: "js", throws: true, length: 0 },
  internalFields: ["data", "drain", "exit"],
  proto: {
    close: { capability: "js" },
    closed: { getter: b.bool, pure: true },
    controlFlags: flags,
    inputFlags: flags,
    localFlags: flags,
    outputFlags: flags,
    ref: { rustName: "do_ref" },
    resize: { args: { cols: b.any, rows: b.any }, capability: "heap", throws: true },
    setRawMode: { args: { enabled: b.bool.loose }, capability: "heap", throws: true },
    unref: { rustName: "do_unref" },
    write: { args: { data: b.any }, returns: b.usize, capability: "js", throws: true },
    "@@asyncDispose": { returns: b.any.returning("Promise"), capability: "js" },
  },
});
