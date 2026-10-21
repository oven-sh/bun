import * as b from "../../../codegen/bindgen-lib.ts";

/** A stream, a file descriptor, `null` or `undefined`, made the first time it is read. */
const stdio = { getter: b.any, capability: "js", throws: true } as const;

/** What `Bun.spawn` returns. */
export const Subprocess = b.class({
  rustPath: "crate::api::bun::subprocess::Subprocess<'static>",
  refCounted: true,
  finalize: true,
  memoryCost: true,
  configurable: false,
  internalFields: ["exitedPromise", "ipcCallback", "onDisconnectCallback", "onExitCallback", "terminal"],
  proto: {
    connected: { getter: b.bool },
    disconnect: {},
    exitCode: { getter: b.u8.nullable },
    exited: { getter: b.any, capability: "js", passThis: true },
    kill: { args: { signal: b.any }, capability: "js", throws: true, passThis: true },
    killed: { getter: b.bool },
    pid: { getter: b.i32 },
    readable: { ...stdio, cache: "stdout", rustName: "stdout" },
    ref: { rustName: "do_ref" },
    resourceUsage: { returns: b.any, capability: "js", throws: true },
    send: {
      args: { message: b.any, handle: b.any, options: b.any, callback: b.any },
      returns: b.bool,
      capability: "js",
      throws: true,
      length: 1,
      rustName: "do_send",
    },
    signalCode: { getter: b.any, capability: "js" },
    stderr: { ...stdio, cache: true },
    stdin: { ...stdio, cache: true },
    stdio: { getter: b.any, capability: "js", throws: true },
    stdout: { ...stdio, cache: true },
    terminal: { internalField: "terminal" },
    unref: { rustName: "do_unref" },
    writable: { ...stdio, cache: "stdin", rustName: "stdin" },
    "@@asyncDispose": { returns: b.any, capability: "js", throws: true, passThis: true },
  },
});
