import * as b from "../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;
const method = { returns: b.opaque, ...js } as const;

/** `write` looks at whether the sink is closed before it throws for a `nullish` or `other` chunk. */
export const SinkChunk = b.union({
  text: b.string.allowStringObject.view,
  bytes: b.bufferSource.allowShared,
  nullish: b.null,
  other: b.ignored,
});

/** `start` fails with `EINVAL` if `path` is not a string. */
export const SinkPath = b.union({ missing: b.undefined, path: b.string.allowStringObject, other: b.ignored });

/** An empty `text` is `missing`. `start` fails with `EBADF` for what is not an integer from 0 that fits an `i32`. */
export const SinkStartFd = b.union({ missing: b.null, number: b.f64, text: b.string, other: b.ignored });

const highWaterMark = b.f64.otherAsNull;
const fileMembers = {
  path: SinkPath,
  fd: SinkStartFd,
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

const JSPromise = b.cell("JSC::JSPromise", "JavaScriptCore/JSPromise.h");
const JSReadableStream = b.cell("WebCore::JSReadableStream", "streams/JSReadableStream.h");

/** What `pull(controller)` of a `type: "direct"` stream gets when a native sink consumes the stream, and what the pump of any other stream writes to. */
export const ReadableSinkController = b.class({
  ...sinkClass,
  rustPath: "crate::webcore::sink::ReadableSinkController",
  internalFields: {
    /** Notified when the sink closes: a `JSDirectStreamSource` or a `JSReadStreamIntoSinkOperation`. */
    source: b.cell("JSC::JSCell", "JavaScriptCore/JSCell.h"),
    /** Direct streams only: settles when the controller closes. */
    closePromise: JSPromise,
    /** The `error` of the first `close(error)`. */
    failReason: b.opaque,
    readableStream: JSReadableStream,
    /** While a native sink pipes a stream in, it roots only this cell, which holds these two for it (`PipeCell` in `streams.rs`). */
    pipeStream: JSReadableStream,
    pipeDone: JSPromise,
  },
  proto: {
    close: { ...js, args: { error: b.opaque.falsyAsNull }, length: 0, calledFromCpp: true },
    flush,
    end: { ...method, calledFromCpp: true },
    start: start(ReadableSinkControllerStartOptions),
    write: { ...method, args: { data: SinkChunk }, requiredArguments: 1, calledFromCpp: true },
    sinkId: { getter: b.u8, enumerable: false, configurable: true },
  },
  calledFromCpp: {
    isDetached: { returns: b.bool },
    /** `close(error)` for an `error` that can be falsy. */
    closeWithError: { ...js, args: { error: b.opaque } },
    startWithHighWaterMark: { ...js, args: { highWaterMark: b.f64 } },
    writeBytes: { ...method, args: { bytes: b.byteSpan } },
  },
  calledFromRust: {
    /** `undefined`, a promise for the end of the stream, or the `Exception` of a failure. */
    assignToStream: { capability: "js", args: { stream: b.opaque }, returns: b.opaque },
    onClose: { args: { reason: b.opaque, sinkClosed: b.bool }, throws: true },
    onReady: { throws: true },
    setPipe: { args: { stream: b.opaque, done: b.opaque } },
    pipeStream: { returns: b.opaque },
    clearPipeStream: {},
    setPipeDone: { args: { done: b.opaque } },
    pipeDone: { returns: b.opaque },
    takePipeDone: { returns: b.opaque },
    setFailReason: { args: { reason: b.opaque } },
  },
});
