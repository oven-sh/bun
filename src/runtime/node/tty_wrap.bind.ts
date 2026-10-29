import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

/** `process.binding("tty_wrap").TTY`: Node's `LibuvStreamWrap` over a tty fd. */
export const TTY = b.class({
  rustPath: "crate::node::tty_wrap::TTY",
  refCounted: true,
  finalize: true,
  /** `ctx` gets `errno`, `code`, `syscall` and `message` where `uv_tty_init` would have failed. */
  construct: {
    passStructure: true,
    args: { fd: b.any, ctx: b.any },
    capability: "js",
    throws: true,
    uses: {
      fd: table.inspected,
      ctx: [table.definesName(["errno"], table.i32), table.definesName(["code", "syscall", "message"], table.string)],
    },
  },
  internalFields: ["onread"],
  proto: {
    /** 0, or a negative libuv errno. `onread(nread, buffer)` gets what is read. */
    readStart: { returns: b.i32, capability: "js" },
    readStop: { returns: b.i32, capability: "js" },
    /** Writes all of `data` before it returns. 0, or a negative libuv errno. */
    writeBuffer: { args: { data: b.bytes({ from: ["buffer"] }) }, returns: b.i32 },
    /** 0, or a negative libuv errno. */
    setRawMode: { args: { mode: b.bool.loose }, returns: b.i32 },
    /** Fills `size` with [columns, rows]. */
    getWindowSize: {
      args: { size: b.any },
      returns: b.bool,
      capability: "js",
      throws: true,
      uses: { size: [table.writesContents(), table.storedByKey(table.indexKeys, table.f64)] },
    },
    ref: { rustName: "do_ref" },
    unref: { rustName: "do_unref" },
    close: { capability: "js" },
    onread: { internalField: "onread", setter: true },
    bytesRead: { getter: b.f64 },
    bytesWritten: { getter: b.f64 },
    fd: { getter: b.i32 },
  },
});
