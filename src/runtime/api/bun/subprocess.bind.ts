import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::bun::subprocess::testing_apis" });

/** A stream, a file descriptor, `null` or `undefined`, made the first time it is read. */
const stdio = { getter: b.any, capability: "js" } as const;

/** What `Bun.spawn` returns. */
export const Subprocess = b.class({
  rustPath: "crate::api::bun::subprocess::Subprocess<'static>",
  refCounted: true,
  finalize: true,
  memoryCost: true,
  internalFields: ["exitedPromise", "ipcCallback", "onDisconnectCallback", "onExitCallback", "terminal"],
  proto: {
    connected: { getter: b.bool },
    disconnect: {},
    exitCode: { getter: b.u8.nullable },
    exited: { getter: b.any.returning("Promise"), capability: "js", passThis: true },
    kill: { args: { signal: b.any }, capability: "js", throws: true, passThis: true },
    killed: { getter: b.bool },
    pid: { getter: b.i32 },
    readable: { ...stdio, throws: true, cache: "stdout", rustName: "stdout" },
    ref: { rustName: "do_ref" },
    resourceUsage: { returns: b.any.returning("ResourceUsage", "undefined"), capability: "js", throws: true },
    send: {
      args: { message: b.any, handle: b.any, options: b.any, callback: b.any },
      returns: b.bool,
      capability: "js",
      throws: true,
      length: 1,
    },
    signalCode: { getter: b.any.returning("string", "number", "null"), capability: "js" },
    stderr: { ...stdio, throws: true, cache: true },
    stdin: { ...stdio, cache: true },
    stdio: { getter: b.any.returning("Array"), capability: "js", throws: true },
    stdout: { ...stdio, throws: true, cache: true },
    terminal: { internalField: "terminal" },
    unref: { rustName: "do_unref" },
    writable: { ...stdio, cache: "stdin", rustName: "stdin" },
    "@@asyncDispose": {
      returns: b.any.returning("Promise", "undefined"),
      capability: "js",
      throws: true,
      passThis: true,
    },
  },
});

export const injectStdioReadError = b.fn({
  args: { subprocess: Subprocess, kind: b.string.loose },
  returns: b.bool,
  capability: "js",
  throws: true,
});
export const closeStdinWriter = b.fn({ args: { subprocess: Subprocess }, returns: b.bool, capability: "js" });
