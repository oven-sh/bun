import * as b from "../../codegen/bindgen-lib.ts";

const callback = { getter: b.any, setter: true, passThis: true, capability: "heap" } as const;
const head = { statusCode: b.any, statusMessage: b.any, headers: b.any };
const autoHeaders = { autoHeaderBits: b.any, keepAliveTimeoutSecs: b.any };
const write = { returns: b.any, passThis: true, capability: "js", throws: true } as const;

/** The native handle shared by a `node:http` `ServerResponse` and its `IncomingMessage`: `kHandle` in `src/js/internal/http.ts`. */
export const NodeHTTPResponse = b.class({
  rustPath: "crate::server::NodeHTTPResponse",
  refCounted: true,
  finalize: true,
  fromJS: true,
  configurable: false,
  internalFields: ["onAborted", "onWritable", "onData", "pendingWriteBuffer"],
  proto: {
    abort: { capability: "js" },
    aborted: { getter: b.bool },
    bufferedAmount: { getter: b.u64 },
    cork: { args: { callback: b.any }, returns: b.any, capability: "js", throws: true, length: 1 },
    end: {
      ...write,
      args: { chunk: b.any, encoding: b.any, callback: b.any, strictContentLength: b.any },
      length: 2,
    },
    finished: { getter: b.bool },
    flags: { getter: b.i32 },
    flushHeaders: {},
    getBytesWritten: { returns: b.usize },
    hasBody: { getter: b.i32 },
    headersObject: { returns: b.any, capability: "heap" },
    notifyWhenReadParsed: { returns: b.bool },
    onabort: callback,
    ondata: { ...callback, capability: "js" },
    onwritable: callback,
    pause: { returns: b.bool, rustName: "do_pause" },
    pauseReads: { rustName: "pause_socket_reads" },
    ref: { rustName: "do_ref" },
    resume: { returns: b.bool, capability: "js", rustName: "do_resume" },
    takeRawHeaders: { args: { headers: b.any }, returns: b.any, capability: "heap", throws: true, length: 1 },
    takeRequestTrailers: {
      args: { useInsecureHTTPParser: b.bool.loose },
      returns: b.any,
      capability: "heap",
      throws: true,
      length: 0,
    },
    unref: { rustName: "do_unref" },
    upgraded: { getter: b.bool },
    write: {
      ...write,
      args: { chunk: b.any, encoding: b.any, callback: b.any, strictContentLength: b.any },
      length: 3,
    },
    writeContinue: { capability: "heap", throws: true },
    writeHead: { args: { ...head, ...autoHeaders }, capability: "js", throws: true, length: 3 },
    writeHeadAndEnd: {
      ...write,
      args: { ...head, chunk: b.any, encoding: b.any, strictContentLength: b.any, ...autoHeaders },
      length: 8,
    },
    writeInformational: { args: { data: b.any, encoding: b.any }, capability: "js", throws: true, length: 1 },
  },
});
