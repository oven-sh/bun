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
  memoryCost: true,
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
  internalFields: ["onread", "onwritecomplete"],
  proto: {
    /** 0, or a negative libuv errno. `onread(nread, buffer)` gets what is read. */
    readStart: { returns: b.i32, capability: "js" },
    readStop: { returns: b.i32, capability: "js" },
    /** Node's `writeBuffer(req, data)`, with null for `req`. 0: the write is complete. Negative: a libuv errno. 1: the rest goes out from the loop, and the handle then calls `onwritecomplete(status)`. Node answers a `WriteWrap` there and calls its `oncomplete(status)`: https://github.com/nodejs/node/blob/v26.12.1/lib/internal/stream_base_commons.js#L129-L152 */
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
    /** How the writes of this handle complete: with `true` each is complete when `writeBuffer()` returns. It changes `O_NONBLOCK` of a descriptor that the handle opened, never of the one that `fd` answers, which libuv's `uv_stream_set_blocking()` changes. 0, or a negative libuv errno. */
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
    /** `onwritecomplete(status)`, with the handle as `this`: once for each `writeBuffer()` that answered 1, in the order of the calls. `status` is 0 or a negative libuv errno. */
    onwritecomplete: { setter: true, internalField: "onwritecomplete" },
    bytesRead: { getter: b.f64 },
    bytesWritten: { getter: b.f64 },
    /** libuv's `write_queue_size`: the bytes that wait for the loop. */
    writeQueueSize: { getter: b.u32 },
    fd: { getter: b.i32 },
  },
});
