import * as b from "../../../codegen/bindgen-lib.ts";
import * as table from "../../../codegen/builtins/lib.ts";

const js = { capability: "js", throws: true } as const;
const method = { returns: b.any, ...js } as const;
const stream = { ...method, args: { streamId: b.any } } as const;

/** The session of `node:http2`. */
export const H2FrameParser = b.class({
  rustPath: "crate::api::H2FrameParser",
  refCounted: true,
  finalize: true,
  types: [table.exactType("$Node.H2FrameParser"), table.exactType("$Bindgen.H2FrameParser")],
  construct: { passStructure: true, args: { options: b.any }, capability: "js", throws: true, length: 0 },
  /** `context` is the receiver of the handlers, which are the `handlers` of the options. */
  internalFields: [
    "context",
    "onError",
    "onWrite",
    "onStreamError",
    "onStreamStart",
    "onStreamHeaders",
    "onStreamEnd",
    "onStreamData",
    "onRemoteSettings",
    "onLocalSettings",
    "onWantTrailers",
    "onPing",
    "onEnd",
    "onGoAway",
    "onAborted",
    "onAltSvc",
    "onOrigin",
    "onFrameError",
    "onStreamPush",
  ],
  proto: {
    altsvc: { ...js, args: { origin: b.any, value: b.any, streamId: b.any } },
    bufferSize: { returns: b.f64 },
    detach: { capability: "js", rustName: "detach_from_js" },
    emitAbortToAllStreams: { capability: "js" },
    emitErrorToAllStreams: { ...js, args: { code: b.any } },
    flush: { returns: b.usize, capability: "js", rustName: "flush_from_js" },
    forEachStream: { args: { callback: b.any, thisArg: b.any }, capability: "js" },
    getCurrentState: { returns: b.any.returning("object"), capability: "js" },
    getEndAfterHeaders: { ...stream, returns: b.bool },
    getFrameCounters: { returns: b.any.returning("object"), capability: "js" },
    getNextStream: { returns: b.i32, capability: "js" },
    getStreamContext: stream,
    getStreamState: { ...stream, returns: b.any.returning("object") },
    goaway: { ...js, args: { code: b.any, lastStreamID: b.any, opaqueData: b.any } },
    noTrailers: { ...js, args: { streamId: b.any } },
    origin: { ...js, args: { origin: b.any } },
    ping: { ...js, args: { payload: b.any }, returns: b.bool, length: 0 },
    pushPromise: {
      ...js,
      args: { parentId: b.any, promisedId: b.any, headers: b.any, sensitiveHeaders: b.any },
      returns: b.any.returning("number"),
    },
    read: { ...js, args: { data: b.any } },
    request: {
      ...js,
      args: { streamId: b.any, context: b.any, headers: b.any, sensitiveHeaders: b.any, options: b.any },
      returns: b.any.returning("number", "undefined"),
      length: 2,
    },
    rstStream: {
      ...js,
      args: { streamId: b.any, code: b.any },
      returns: b.any.returning("boolean", "undefined"),
      length: 1,
    },
    sendTrailers: { ...js, args: { streamId: b.any, headers: b.any, sensitiveHeaders: b.any }, length: 2 },
    setLocalWindowSize: { ...js, args: { windowSize: b.any } },
    setNativeSocket: { args: { socket: b.any }, capability: "js" },
    setNextStreamID: { ...js, args: { streamId: b.any } },
    setStreamContext: { ...js, args: { streamId: b.any, context: b.any } },
    setStreamReading: { args: { streamId: b.any, reading: b.any }, capability: "js" },
    settings: { ...js, args: { settings: b.any }, returns: b.bool },
    writeStream: {
      ...js,
      args: { streamId: b.any, data: b.any, encoding: b.any, close: b.any, callback: b.any, deferCallback: b.any },
      returns: b.any.returning("boolean", "number"),
      length: 3,
    },
  },
});
