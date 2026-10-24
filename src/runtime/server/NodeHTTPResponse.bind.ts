import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::server::node_http_response" });

const eventHandler = {
  getter: b.opaque,
  setter: { capability: "js", type: b.opaque.nullable },
  passThis: true,
} as const;
const head = {
  statusCode: b.i32.validateInteger(100, 999).default(200),
  statusMessage: b.string.loose.utf8.nullable,
  /** The flat `[name, value, ...]` array, which C++ reads in place. */
  headers: b.object.otherAsNull,
};
const autoHeaders = { autoHeaderBits: b.u32.default(0), keepAliveTimeoutSecs: b.u32.default(0) };
const method = { returns: b.opaque, capability: "js", throws: true } as const;

/** A `callback` is in the place of the one after it. `name` is read only if there is a chunk. */
export const ChunkEncoding = b.union({
  callback: b.callable,
  name: b.string.allowStringObject.deferred,
  other: b.opaque,
});

const chunk = {
  chunk: b.bytes({ from: ["string", "buffer"], string: "asIs", held: "handle" }).nullable,
  encoding: ChunkEncoding.falsyAsNull,
};
const expected = { chunk: ["string", "Buffer", "Uint8Array"] } as const;
const strictContentLength = b.f64.optional;
const body = {
  args: { ...chunk, callback: b.callable.optional, strictContentLength },
  expected: { ...expected, callback: ["function"] },
} as const;

/** The native handle shared by a `node:http` `ServerResponse` and its `IncomingMessage`: `kHandle` in `src/js/internal/http.ts`. */
export const NodeHTTPResponse = b.class({
  rustPath: "crate::server::NodeHTTPResponse",
  refCounted: true,
  finalize: true,
  internalFields: ["onAborted", "onWritable", "onData", "pendingWriteBuffer"],
  proto: {
    abort: { capability: "js" },
    aborted: { getter: b.bool },
    bufferedAmount: { getter: b.u64 },
    cork: { ...method, args: { callback: b.callable } },
    end: { ...method, ...body, passThis: true, length: 2 },
    finished: { getter: b.bool },
    flags: { getter: b.i32 },
    flushHeaders: {},
    getBytesWritten: { returns: b.usize },
    hasBody: { getter: b.i32 },
    headersObject: { returns: b.object.optional, capability: "js" },
    notifyWhenReadParsed: { returns: b.bool },
    onabort: eventHandler,
    ondata: eventHandler,
    onwritable: eventHandler,
    pause: { returns: b.bool },
    pauseReads: {},
    ref: { rustName: "js_ref" },
    resume: { returns: b.bool },
    takeRawHeaders: { ...method, args: { headers: b.object.otherAsNull }, returns: b.jsArray.optional, length: 1 },
    takeRequestTrailers: {
      ...method,
      args: { useInsecureHTTPParser: b.bool.default(false) },
      returns: b.jsArray.optional,
      length: 0,
    },
    unref: { rustName: "js_unref" },
    upgraded: { getter: b.bool },
    write: { ...method, ...body, length: 3 },
    writeContinue: { capability: "js", throws: true },
    writeHead: { args: { ...head, ...autoHeaders }, capability: "js", throws: true, length: 3 },
    writeHeadAndEnd: {
      ...method,
      args: { ...head, ...chunk, strictContentLength, ...autoHeaders },
      expected,
      passThis: true,
      length: 8,
    },
    writeInformational: {
      args: { chunk: chunk.chunk, encoding: b.string.allowStringObject.otherAsNull.deferred },
      expected: { chunk: ["string", "Buffer", "TypedArray", "DataView"] },
      capability: "js",
      throws: true,
      length: 1,
    },
  },
});

/** The reactions to the promise that the `node:http` request handler returned. */
const reaction = { args: { value: b.opaque, context: NodeHTTPResponse.withValue }, capability: "js" } as const;
export const onResolve = b.fn({ ...reaction, export: "Bun__NodeHTTPRequest__onResolve" });
export const onReject = b.fn({ ...reaction, export: "Bun__NodeHTTPRequest__onReject" });
