import * as b from "../../../codegen/bindgen-lib.ts";
import * as table from "../../../codegen/builtins/lib.ts";
import { TCPSocket, TLSSocket } from "../../socket/socket_body.bind.ts";

const js = { capability: "js", throws: true } as const;
/** What is not a number gets the error of the function it is passed to. */
const streamId = b.f64.otherAsNull;
const stream = { ...js, args: { streamId }, length: 1 } as const;
export const OptionalNumber = b.union({ none: b.null, number: b.f64, other: b.ignored });

export const H2FrameCounters = b.dictionary({ framesReceived: b.f64, framesSent: b.f64 });

export const H2SessionState = b.dictionary({
  effectiveLocalWindowSize: b.f64,
  effectiveRecvDataLength: b.f64,
  nextStreamID: b.f64,
  lastProcStreamID: b.f64,
  remoteWindowSize: b.f64,
  localWindowSize: b.f64,
  deflateDynamicTableSize: b.f64,
  inflateDynamicTableSize: b.f64,
  outboundQueueSize: b.f64,
});

export const H2StreamState = b.dictionary({
  localWindowSize: b.f64,
  state: b.f64,
  localClose: b.f64,
  remoteClose: b.f64,
  sumDependencyWeight: b.f64,
  weight: b.f64,
});

/** `options` of `request()`. */
export const H2RequestOptions = b.dictionary(
  {
    paddingStrategy: b.f64.otherAsNull,
    waitForTrailers: b.bool.otherAsNull,
    silent: { type: b.bool.optional, expected: ["boolean"] },
    endStream: { type: b.bool.optional, expected: ["boolean"] },
    exclusive: { type: b.bool.optional, expected: ["boolean"] },
    parent: { type: b.f64.optional, expected: ["number"] },
    weight: { type: b.f64.optional, expected: ["number"] },
    signal: {
      type: b.abortSignal.shared.optional,
      expected: ["AbortSignal"],
    },
  },
  { deferred: true, reportedAs: "options" },
);
export const RequestOptionsArgument = b.union({ none: b.null, options: H2RequestOptions, other: b.ignored });

export const H2NativeSocket = b.union({ tls: TLSSocket.withValue, tcp: TCPSocket.withValue, other: b.ignored });

export const FlagSetting = b.union({ missing: b.undefined, flag: b.bool, other: b.ignored });
/** From `maxOutstandingPings` on: the limits of a session, which only the constructor reads. A wrong type is ignored. */
export const H2Settings = b.dictionary(
  {
    headerTableSize: OptionalNumber,
    enablePush: FlagSetting,
    initialWindowSize: OptionalNumber,
    maxFrameSize: OptionalNumber,
    maxConcurrentStreams: OptionalNumber,
    maxHeaderListSize: OptionalNumber,
    maxHeaderSize: OptionalNumber,
    enableConnectProtocol: FlagSetting,
    customSettings: b.opaque.optional,
    remoteCustomSettings: b.jsArray.otherAsNull,
    maxOutstandingPings: b.jsNumber.otherAsNull,
    maxSessionMemory: b.jsNumber.otherAsNull,
    maxHeaderListPairs: b.jsNumber.otherAsNull,
    maxSettings: b.jsNumber.otherAsNull,
    maxSessionRejectedStreams: b.jsNumber.otherAsNull,
    maxSessionInvalidFrames: b.jsNumber.otherAsNull,
    strictFieldWhitespaceValidation: b.bool.otherAsNull,
    streamResetBurst: b.opaque.optional,
    streamResetRate: b.opaque.optional,
    maxOutstandingSettings: b.jsNumber.otherAsNull,
    maxSendHeaderBlockLength: b.f64.otherAsNull,
    strictSingleValueFields: b.bool.otherAsNull,
    paddingStrategy: b.f64.otherAsNull,
  },
  { deferred: true, reportedAs: "settings" },
);

const handler = b.callable.emptyStringAsNull;
export const H2Handlers = b.dictionary(
  {
    streamStart: handler,
    streamHeaders: handler,
    streamEnd: handler,
    streamData: handler,
    streamError: handler,
    remoteSettings: handler,
    localSettings: handler,
    wantTrailers: handler,
    ping: handler,
    end: handler,
    goaway: handler,
    aborted: handler,
    write: handler,
    altsvc: handler,
    origin: handler,
    frameError: handler,
    streamPush: handler,
    error: b.callable.optional,
    binaryType: b.string.allowStringObject.emptyStringAsNull,
  },
  { deferred: true, reportedAs: "handlers" },
);

export const H2SettingsOption = b.union({ none: b.null, settings: H2Settings, other: b.ignored });
export const H2FrameParserOptions = b.dictionary(
  {
    context: b.opaque.optional,
    handlers: H2Handlers.otherAsNull,
    native: H2NativeSocket,
    settings: H2SettingsOption,
    type: b.f64.otherAsNull,
  },
  { deferred: true, reportedAs: "options" },
);

/** `false` if the stream cannot send. */
export const H2WriteResult = b.union({ refused: b.bool, state: b.f64 });

/** The session of `node:http2`. */
export const H2FrameParser = b.class({
  rustPath: "crate::api::H2FrameParser",
  refCounted: true,
  finalize: true,
  types: [table.exactType("$Node.H2FrameParser"), table.exactType("$Bindgen.H2FrameParser")],
  construct: {
    passStructure: true,
    args: { options: H2FrameParserOptions.otherAsNull },
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
    altsvc: {
      ...js,
      args: {
        origin: b.string.allowStringObject.view.nullable,
        value: b.string.allowStringObject.view.nullable,
        streamId: OptionalNumber,
      },
      expected: { origin: ["string"], value: ["string"] },
    },
    bufferSize: { returns: b.f64 },
    detach: { capability: "js", rustName: "detach_from_js" },
    emitAbortToAllStreams: { capability: "js" },
    emitErrorToAllStreams: { ...js, args: { code: b.jsNumber.otherAsNull }, length: 1 },
    flush: { returns: b.usize, capability: "js", rustName: "flush_from_js" },
    forEachStream: { args: { callback: b.callable.otherAsNull, thisArg: b.opaque }, capability: "js" },
    getCurrentState: { returns: H2SessionState },
    getEndAfterHeaders: { ...stream, returns: b.bool },
    getFrameCounters: { returns: H2FrameCounters },
    getNextStream: { returns: b.i32, capability: "js" },
    getStreamContext: { ...stream, returns: b.object.optional },
    getStreamState: { ...stream, returns: H2StreamState },
    goaway: {
      ...js,
      args: {
        code: b.f64.otherAsNull,
        lastStreamID: OptionalNumber,
        opaqueData: b.bufferSource.allowShared.otherAsNull,
      },
      length: 3,
    },
    noTrailers: stream,
    origin: { ...js, args: { origin: b.opaque } },
    ping: { ...js, args: { payload: b.bufferSource.allowShared.otherAsNull }, returns: b.bool, length: 0 },
    pushPromise: {
      ...js,
      args: {
        parentId: streamId,
        promisedId: streamId,
        headers: b.object.otherAsNull,
        sensitiveHeaders: b.opaque,
      },
      returns: b.f64,
      length: 4,
    },
    read: { ...js, args: { data: b.bufferSource.allowShared.otherAsNull }, length: 1 },
    request: {
      ...js,
      args: {
        streamId,
        context: b.object.otherAsNull,
        headers: b.opaque,
        sensitiveHeaders: b.object.otherAsNull,
        options: RequestOptionsArgument,
      },
      returns: b.f64.optional,
      length: 2,
    },
    rstStream: { ...js, args: { streamId, code: b.f64.otherAsNull }, returns: b.bool.optional, length: 1 },
    sendTrailers: {
      ...js,
      args: { streamId, headers: b.object.otherAsNull, sensitiveHeaders: b.object.otherAsNull },
      length: 2,
    },
    setLocalWindowSize: {
      ...js,
      args: { windowSize: b.f64 },
      expected: { windowSize: "Expected windowSize to be a number" },
    },
    setNativeSocket: { args: { socket: H2NativeSocket }, capability: "js" },
    setNextStreamID: stream,
    setStreamContext: { ...js, args: { streamId, context: b.opaque } },
    setStreamReading: { args: { streamId, reading: b.bool.loose }, capability: "js" },
    settings: { ...js, args: { settings: H2Settings.otherAsNull }, returns: b.bool, length: 1 },
    writeStream: {
      ...js,
      args: {
        streamId,
        data: b.opaque,
        encoding: b.opaque,
        close: b.bool.loose,
        callback: b.opaque,
        deferCallback: b.bool.loose.default(false),
      },
      returns: H2WriteResult,
      length: 3,
    },
  },
});
