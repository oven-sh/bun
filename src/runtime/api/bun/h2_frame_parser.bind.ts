import * as b from "../../../codegen/bindgen-lib.ts";
import { TCPSocket, TLSSocket } from "../../socket/socket_body.bind.ts";

const js = { capability: "js", throws: true } as const;
/** What is not a number gets the error of the function it is passed to. */
const streamId = b.f64.otherAsNull;
const stream = { ...js, args: { streamId }, length: 1 } as const;
export const OptionalStreamId = b.union({ missing: b.null, id: b.f64, other: b.ignored });
/** `null` and `undefined` release the one the stream has. */
export const StreamContext = b.union({ release: b.null, context: b.object, other: b.ignored });
/** The elements of `many` are strings. */
export const Origins = b.union({
  none: b.null,
  one: b.string.allowStringObject.view,
  many: b.jsArray,
  other: b.ignored,
});

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

/** Both forms are walked twice: the pseudo-headers go first. */
export const RequestHeaders = b.union({ rawPairs: b.jsArray, record: b.object, other: b.ignored });

/** `options` of `request()`. */
export const RequestOptions = b.dictionary(
  {
    paddingStrategy: b.f64.otherAsNull,
    waitForTrailers: b.bool.otherAsNull,
    silent: { type: b.bool.optional, expected: ["boolean"] },
    endStream: { type: b.bool.optional, expected: ["boolean"] },
    exclusive: { type: b.bool.optional, expected: ["boolean"] },
    parent: { type: b.f64.optional, expected: ["number"] },
    weight: { type: b.f64.optional, expected: ["number"] },
    signal: {
      type: b.wrapped("WebCore::JSAbortSignal", "JSAbortSignal.h", { rustPath: "bun_jsc::AbortSignal" }).shared
        .optional,
      expected: ["AbortSignal"],
    },
  },
  { deferred: true, reportedAs: "options" },
);
export const RequestOptionsArgument = b.union({ missing: b.null, options: RequestOptions, other: b.ignored });

/** A `String` object is `other`: its `toString()` runs once the stream is known to take data. */
export const WriteData = b.union({ bytes: b.bufferSource.allowShared, text: b.string, other: b.opaque });
export const WriteEncoding = b.union({ utf8: b.undefined, name: b.string.view, other: b.opaque });
export const H2StringObject = b.union({ text: b.string.allowStringObject, other: b.ignored }, { fromJS: true });

export const H2NativeSocket = b.union({ tls: TLSSocket, tcp: TCPSocket, other: b.ignored }, { fromJS: true });

export const NumberSetting = b.union({ missing: b.null, number: b.f64, other: b.ignored });
export const FlagSetting = b.union({ missing: b.undefined, flag: b.bool, other: b.ignored });
/** From a setting id to its value. */
export const CustomSettingsRecord = b.union({ missing: b.undefined, record: b.object, other: b.ignored });
export const StreamResetBurst = b.union({ missing: b.undefined, number: b.f64, other: b.ignored });
/** From `maxOutstandingPings` on: the limits of a session, which only the constructor reads. A wrong type is ignored. */
export const H2Settings = b.dictionary(
  {
    headerTableSize: NumberSetting,
    enablePush: FlagSetting,
    initialWindowSize: NumberSetting,
    maxFrameSize: NumberSetting,
    maxConcurrentStreams: NumberSetting,
    maxHeaderListSize: NumberSetting,
    maxHeaderSize: NumberSetting,
    enableConnectProtocol: FlagSetting,
    customSettings: CustomSettingsRecord,
    remoteCustomSettings: b.jsArray.otherAsNull,
    maxOutstandingPings: b.f64.otherAsNull,
    maxSessionMemory: b.f64.otherAsNull,
    maxHeaderListPairs: b.f64.otherAsNull,
    maxSettings: b.f64.otherAsNull,
    maxSessionRejectedStreams: b.f64.otherAsNull,
    maxSessionInvalidFrames: b.f64.otherAsNull,
    strictFieldWhitespaceValidation: b.bool.otherAsNull,
    streamResetBurst: StreamResetBurst,
    streamResetRate: b.f64.otherAsNull,
    maxOutstandingSettings: b.f64.otherAsNull,
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

export const H2SettingsOption = b.union({ missing: b.null, settings: H2Settings, other: b.ignored });
export const H2FrameParserOptions = b.dictionary(
  {
    context: b.opaque.optional,
    handlers: H2Handlers.otherAsNull,
    /** An `H2NativeSocket`. */
    native: b.opaque.optional,
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
        streamId: OptionalStreamId,
      },
      expected: { origin: ["string"], value: ["string"] },
    },
    bufferSize: { returns: b.f64 },
    detach: { capability: "js", rustName: "detach_from_js" },
    emitAbortToAllStreams: { capability: "js" },
    emitErrorToAllStreams: { ...js, args: { code: b.f64.otherAsNull }, length: 1 },
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
        lastStreamID: OptionalStreamId,
        opaqueData: b.bufferSource.allowShared.otherAsNull,
      },
      length: 3,
    },
    noTrailers: stream,
    origin: { ...js, args: { origin: Origins } },
    ping: { ...js, args: { payload: b.bufferSource.allowShared.otherAsNull }, returns: b.bool, length: 0 },
    pushPromise: {
      ...js,
      args: {
        parentId: streamId,
        promisedId: streamId,
        headers: b.object.otherAsNull,
        sensitiveHeaders: b.object.otherAsNull,
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
        headers: RequestHeaders,
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
    setStreamContext: { ...js, args: { streamId, context: StreamContext } },
    setStreamReading: { args: { streamId, reading: b.bool.loose }, capability: "js" },
    settings: { ...js, args: { settings: H2Settings.otherAsNull }, returns: b.bool, length: 1 },
    writeStream: {
      ...js,
      args: {
        streamId,
        data: WriteData,
        encoding: WriteEncoding,
        close: b.bool.loose,
        callback: b.callable.otherAsNull,
        deferCallback: b.bool.loose.default(false),
      },
      returns: H2WriteResult,
      length: 3,
    },
  },
});
