import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::node::tty_wrap" });

/** Raw mode of a terminal's stdin that has no handle. `mode` is a `uv_tty_mode_t`. 0, or a negative libuv errno. */
export const setStdinRawMode = b.fn({ args: { mode: b.i32.wrap }, returns: b.i32, capability: "js" });

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
      ctx: [
        table.writesContents(),
        table.storedByKey(table.keysNamed("errno"), table.i32),
        table.storedByKey(table.keysNamed("code", "syscall", "message"), table.string),
      ],
    },
  },
  internalFields: ["onread"],
  proto: {
    /** 0, or a negative libuv errno. `onread(nread, buffer)` gets what is read. */
    readStart: { returns: b.i32, capability: "js" },
    readStop: { returns: b.i32, capability: "js" },
    /** Node's signature: `req` is null. All of `data` is written before it returns. 0, or a negative libuv errno. */
    writeBuffer: { args: { req: b.any, data: b.bytes({ from: ["buffer"] }) }, returns: b.i32 },
    /** `mode` is a `uv_tty_mode_t`. 0, or a negative libuv errno. */
    setRawMode: { args: { mode: b.i32.wrap }, returns: b.i32 },
    /** Fills `size` with [columns, rows]. 0, or a negative libuv errno. */
    getWindowSize: {
      args: { size: b.jsArray },
      returns: b.i32,
      capability: "js",
      throws: true,
      uses: { size: [table.writesContents(), table.storedByKey(table.indexKeys, table.f64)] },
    },
    ref: { rustName: "do_ref" },
    unref: { rustName: "do_unref" },
    hasRef: { returns: b.bool },
    /** 0: Bun has no async ids. */
    getAsyncId: { returns: b.f64 },
    /** Every write is complete when `writeBuffer()` returns. 0, or a negative libuv errno. */
    setBlocking: { args: { enable: b.any }, returns: b.i32 },
    /** Node's `HandleWrap::Close`: `callback` runs once, from the loop, with the handle as `this`. A handle that is closed already takes none. */
    close: {
      args: { callback: b.any },
      length: 0,
      passThis: true,
      capability: "js",
      throws: true,
      uses: {
        callback: [
          table.retained,
          table.called({
            afterwards: "TouchesOnlyWhatRowNames",
            times: "Later",
            this: table.operand("this"),
            args: [],
            result: "Ignored",
          }),
        ],
      },
    },
    /** `onread(nread, buffer)`. It continues the async context that set it, as Node's `MakeCallback` continues the handle's. */
    onread: { getter: b.any, setter: { capability: "js" }, passThis: true },
    bytesRead: { getter: b.f64 },
    bytesWritten: { getter: b.f64 },
    fd: { getter: b.i32 },
  },
});
