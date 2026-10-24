import * as b from "../../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;
const method = { returns: b.any, ...js } as const;
const buffer = b.bytes({ from: ["buffer"], held: "handle" });

/** What the session calls. Each gets the `context` of the options first. */
export const H2Handlers = b.dictionary({
  streamStart: b.callable.optional,
  streamHeaders: b.callable.optional,
  streamEnd: b.callable.optional,
  streamData: b.callable.optional,
  streamError: b.callable.optional,
  remoteSettings: b.callable.optional,
  localSettings: b.callable.optional,
  wantTrailers: b.callable.optional,
  ping: b.callable.optional,
  end: b.callable.optional,
  error: b.callable.optional,
  goaway: b.callable.optional,
  aborted: b.callable.optional,
  /** Takes the output of a session with no native socket. */
  write: b.callable,
  altsvc: b.callable.optional,
  origin: b.callable.optional,
  frameError: b.callable.optional,
  streamPush: b.callable.optional,
});
/** `native` is the handle of a `net.Socket` or `tls.TLSSocket`, `settings` the session's options and initial settings, and `type` 0 for a server. */
export const H2FrameParserOptions = b.dictionary({
  context: b.any,
  handlers: H2Handlers,
  native: b.any,
  settings: b.any,
  type: { type: b.u32.default(1), rustName: "session_type" },
});

/** The session of `node:http2`. */
export const H2FrameParser = b.class({
  rustPath: "crate::api::H2FrameParser",
  refCounted: true,
  finalize: true,
  memoryCost: true,
  construct: {
    passStructure: true,
    args: { options: H2FrameParserOptions },
    capability: "js",
    throws: true,
    length: 0,
  },
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
    altsvc: { ...js, args: { origin: b.any, value: b.any, streamId: b.u32 } },
    bufferSize: { returns: b.f64 },
    detach: {
      args: { keepOutput: b.bool.loose.default(false) },
      capability: "js",
      rustName: "detach_from_js",
      length: 1,
    },
    emitErrorToAllStreams: { args: { code: b.u32 }, capability: "js" },
    flush: { returns: b.usize, capability: "js", rustName: "flush_from_js" },
    forEachStream: { args: { callback: b.callable, closed: b.bool.default(false) }, capability: "js" },
    getCurrentState: { returns: b.any, capability: "js" },
    getFrameCounters: { returns: b.any, capability: "js" },
    getNextStream: { returns: b.i32, capability: "js" },
    getStreamContext: { args: { streamId: b.u32 }, returns: b.any, capability: "js" },
    getStreamState: { args: { streamId: b.u32 }, returns: b.any, capability: "js" },
    goaway: { args: { code: b.u32, lastStreamID: b.i32.wrap, opaqueData: buffer }, capability: "js" },
    hasOpenStreams: { returns: b.bool },
    hasRejectedSend: { returns: b.bool },
    isStreamClosed: { args: { streamId: b.u32 }, returns: b.bool },
    noTrailers: { args: { streamId: b.u32 }, capability: "js" },
    origin: { ...js, args: { origin: b.any } },
    ping: { args: { payload: buffer }, returns: b.bool, capability: "js" },
    pushPromise: { ...method, args: { parentId: b.u32, promisedId: b.u32, headers: b.any, sensitiveHeaders: b.any } },
    read: { ...js, args: { data: buffer } },
    releaseStream: { args: { streamId: b.u32 }, returns: b.bool },
    request: {
      ...js,
      args: {
        streamId: b.u32,
        context: b.any,
        headers: b.any,
        sensitiveHeaders: b.any,
        options: b.any,
        informational: b.bool.loose.default(false),
      },
      length: 2,
    },
    rstStream: { args: { streamId: b.u32, code: b.u32 }, capability: "js" },
    sendTrailers: { ...js, args: { streamId: b.u32, headers: b.any, sensitiveHeaders: b.any } },
    setLocalWindowSize: { args: { windowSize: b.u32 }, capability: "js" },
    setNativeSocket: { args: { socket: b.any }, capability: "js" },
    setNextStreamID: { args: { streamId: b.u32.wrap }, capability: "js" },
    setStreamContext: { args: { streamId: b.u32, context: b.any }, capability: "js" },
    setStreamReading: { args: { streamId: b.u32, reading: b.bool }, capability: "js" },
    settings: { ...js, args: { settings: b.any } },
    validateRequest: { ...js, args: { headers: b.any } },
    writeStream: {
      ...method,
      args: {
        streamId: b.u32,
        data: b.any,
        encoding: b.any,
        close: b.bool,
        callback: b.any,
        deferCallback: b.bool.default(false),
      },
      length: 3,
    },
  },
});
