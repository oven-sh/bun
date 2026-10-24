import * as b from "../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;
const method = { returns: b.any, ...js } as const;

/** `write` looks at whether the sink is closed before it throws for any `other` chunk. */
export const SinkChunk = b.union({
  text: b.string.allowStringObject.view,
  bytes: b.bufferSource.allowShared,
  other: b.any,
});

/** What is not a string fails `start` with `EINVAL`. */
export const SinkPath = b.union({ missing: b.undefined, path: b.string.allowStringObject, other: b.any });

const highWaterMark = b.f64.otherAsNull;
const fileMembers = {
  path: SinkPath,
  /** What `Fd::from_js` takes. */
  fd: b.any.emptyStringAsNull,
};
const ignoresNonObjects = { allowArray: true, nonObjectAsEmpty: true } as const;

export const ArrayBufferSinkStartOptions = b.dictionary(
  { asUint8Array: b.bool.otherAsNull, stream: b.bool.otherAsNull, highWaterMark },
  ignoresNonObjects,
);
export const FileSinkStartOptions = b.dictionary(fileMembers, { ...ignoresNonObjects, fromJS: true });
export const NetworkSinkStartOptions = b.dictionary({ highWaterMark }, ignoresNonObjects);
/** A `FileSink` uses `path` and `fd`, and every other sink uses `highWaterMark`. */
export const ReadableSinkControllerStartOptions = b.dictionary({ highWaterMark, ...fileMembers }, ignoresNonObjects);

/** `undefined` once the sink is closed, and `null` for a sink that has none. */
export const SinkFd = b.union({ closed: b.undefined, none: b.null, fd: b.i32 });

const flush = { ...method, args: { wait: b.bool.otherAsNull }, length: 1 } as const;
const start = (options: b.Type) => ({ ...js, args: { options: options.nullable.default({}) }, length: 1 }) as const;

const sinkClass = { writable: false, memoryCost: true } as const;
const sinkPrototype = (sinkId: number, startOptions: b.Type) =>
  ({
    close: js,
    flush,
    end: { ...method, passThis: true },
    start: start(startOptions),
    write: { ...method, args: { chunk: SinkChunk }, requiredArguments: 1 },
    ref: { invalidThis: "undefined" },
    unref: { invalidThis: "undefined" },
    _getFd: { returns: SinkFd },
    sinkId: { constant: sinkId, enumerable: false, configurable: true },
  }) as const;

export const ArrayBufferSink = b.class({
  ...sinkClass,
  rustPath: "crate::webcore::sink::JSSink<crate::webcore::sink::ArrayBufferSink>",
  construct: {},
  call: { returns: b.self, capability: "heap" },
  proto: sinkPrototype(0, ArrayBufferSinkStartOptions),
});

export const FileSink = b.class({
  ...sinkClass,
  rustPath: "crate::webcore::sink::JSSink<crate::webcore::FileSink>",
  construct: "illegal",
  proto: sinkPrototype(2, FileSinkStartOptions),
});

export const NetworkSink = b.class({
  ...sinkClass,
  rustPath: "crate::webcore::sink::JSSink<crate::webcore::streams::NetworkSink>",
  construct: "illegal",
  proto: sinkPrototype(6, NetworkSinkStartOptions),
});

/** What `pull(controller)` of a `type: "direct"` stream gets when a native sink consumes the stream, and what the pump of any other stream writes to. */
export const ReadableSinkController = b.class({
  ...sinkClass,
  rustPath: "crate::webcore::sink::ReadableSinkController",
  internalFields: {
    /** What hears the sink close: a `JSDirectStreamSource` or a `JSReadStreamIntoSinkOperation`. */
    source: "JSC::JSCell",
    /** Of a direct stream: settles when the controller closes. */
    closePromise: "JSC::JSPromise",
    /** The first `close(error)`. */
    failReason: "JSC::JSValue",
    readableStream: "WebCore::JSReadableStream",
    /** A `PipeCell` keeps these two here: the stream its sink ends, and the promise its owner awaits. */
    pipeStream: "WebCore::JSReadableStream",
    pipeDone: "JSC::JSPromise",
  },
  headers: ["streams/JSReadableStream.h"],
  proto: {
    close: { ...js, args: { error: b.any.falsyAsNull }, length: 0, calledFromCpp: true },
    flush,
    end: { ...method, calledFromCpp: true },
    start: start(ReadableSinkControllerStartOptions),
    write: { ...method, args: { data: SinkChunk }, requiredArguments: 1, calledFromCpp: true },
    sinkId: { getter: b.u8, enumerable: false, configurable: true },
  },
  calledFromCpp: {
    isAttached: { returns: b.bool },
    /** The source failed. `reason` can be falsy. */
    closeWithError: { ...js, args: { reason: b.any } },
    startWithHighWaterMark: { ...js, args: { highWaterMark: b.f64 } },
    writeBytes: { ...method, args: { bytes: b.byteSpan } },
  },
  calledFromRust: {
    /** `undefined`, a promise for the end of the stream, or the `Exception` of a failure. */
    assignToStream: { args: { stream: b.any }, returns: b.any },
    onClose: { args: { reason: b.any, sinkClosed: b.bool }, throws: true },
    onReady: { throws: true },
  },
});
