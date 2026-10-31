import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::server::node_http_response" });

const eventHandler = { getter: b.any, setter: { capability: "js" }, passThis: true } as const;
const head = {
  /** `ServerResponse` has checked the range. */
  statusCode: b.u16.default(200),
  statusMessage: b.string.loose.nullable,
  /** The flat `[name, value, ...]` array, which C++ reads in place. */
  headers: b.any,
};
const autoHeaders = { autoHeaderBits: b.u32.default(0), keepAliveTimeoutSecs: b.u32.default(0) };
const method = { returns: b.any, capability: "js", throws: true } as const;
const chunk = {
  chunk: b.bytes({ from: ["string", "buffer"], string: "asIs", held: "handle" }).nullable,
  /** Read only if there is a chunk. */
  encoding: b.any,
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
  types: [table.exactType("$Node.NodeHTTPResponse"), table.exactType("$Bindgen.NodeHTTPResponse")],
  lockedObjects: ["prototype"],
  internalFields: ["onAborted", "onWritable", "onData", "pendingWriteBuffer"],
  proto: {
    abort: { capability: "js" },
    bufferedAmount: { getter: b.u64, pure: true },
    end: { ...method, ...body, returns: b.any.returning("number", "undefined"), passThis: true, length: 2 },
    finished: { getter: b.bool, pure: true },
    flags: { getter: b.i32, pure: true },
    flushHeaders: {},
    hasBody: { getter: b.i32, pure: true },
    headersObject: { returns: b.any.returning("object", "undefined"), capability: "js" },
    notifyWhenReadParsed: { returns: b.bool },
    onabort: eventHandler,
    ondata: eventHandler,
    onwritable: eventHandler,
    pause: { returns: b.bool },
    resume: { returns: b.bool },
    takeRawHeaders: { ...method, args: { headers: b.any }, returns: b.any.returning("Array", "undefined") },
    takeRequestTrailers: {
      ...method,
      args: { useInsecureHTTPParser: b.bool.default(false) },
      returns: b.any.returning("Array", "undefined"),
      length: 0,
    },
    write: { ...method, ...body, returns: b.any.returning("number"), length: 3 },
    writeContinue: { capability: "js", throws: true },
    writeHead: { args: { ...head, ...autoHeaders }, capability: "js", throws: true, length: 3 },
    writeHeadAndEnd: {
      ...method,
      args: { ...head, ...chunk, strictContentLength, ...autoHeaders },
      expected,
      returns: b.any.returning("number", "undefined"),
      passThis: true,
      length: 8,
    },
    writeHeadAndWrite: {
      ...method,
      args: { ...head, ...chunk, callback: b.callable.optional, strictContentLength, ...autoHeaders },
      expected: body.expected,
      length: 9,
    },
    writeInformational: {
      args: chunk,
      expected: { chunk: ["string", "Buffer", "TypedArray", "DataView"] },
      capability: "js",
      throws: true,
      length: 1,
    },
    /** `writeHeadAndEnd` for the usual arguments, read as they are. `undefined`: nothing was written. */
    writeWholeResponse: {
      ...method,
      args: { args: b.any.variadic },
      returns: b.any.returning("number", "undefined"),
      passThis: true,
      rustName: "write_whole_response_as_given",
      length: 8,
    },
  },
});

/** The reactions to the promise that the `node:http` request handler returned. */
const reaction = { args: { value: b.any, context: NodeHTTPResponse.withValue }, capability: "js" } as const;
export const onResolve = b.fn({ ...reaction, export: "Bun__NodeHTTPRequest__onResolve" });
export const onReject = b.fn({ ...reaction, export: "Bun__NodeHTTPRequest__onReject" });
