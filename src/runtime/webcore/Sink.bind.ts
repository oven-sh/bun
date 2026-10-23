import * as b from "../../codegen/bindgen-lib.ts";

/** `write` looks at whether the sink is closed before it reports an `invalid` chunk. */
export const SinkChunk = b.union({
  text: b.string.allowStringObject,
  bytes: b.bufferSource.allowShared,
  invalid: b.any,
});

export const SinkPath = b.union({ absent: b.undefined, path: b.string.utf8.owned, invalid: b.any });

/** An `ArrayBufferSink` reads the first three, a `FileSink` `path` and `fd`, and every other sink `highWaterMark`. */
export const SinkStartOptions = b.dictionary(
  {
    asUint8Array: b.bool.otherAsNull,
    stream: b.bool.otherAsNull,
    highWaterMark: b.f64.otherAsNull,
    path: SinkPath,
    /** What `Fd::from_js` takes. */
    fd: b.any.emptyStringAsNull,
  },
  { allowArray: true, nonObjectAsEmpty: true, fromJS: true },
);

/** `undefined` once the sink is closed, and `null` for a sink that has none. */
export const SinkFd = b.union({ closed: b.undefined, none: b.null, fd: b.i32 });

const method = { returns: b.any, capability: "js", throws: true } as const;

const flush = { ...method, args: { wait: b.bool.otherAsNull }, length: 1 } as const;
const start = { capability: "js", throws: true, args: { options: SinkStartOptions }, length: 1 } as const;
const write = { ...method, args: { chunk: SinkChunk.ifPassed }, length: 1 } as const;

/** `SinkId` in `Sink.rs`. */
const sinkId = (constant: number) => ({ constant, enumerable: false, configurable: true }) as const;

const sinkPrototype = (id: number) =>
  ({
    close: { capability: "js", throws: true },
    flush,
    end: { ...method, passThis: true },
    start,
    write,
    ref: { invalidThis: "undefined" },
    unref: { invalidThis: "undefined" },
    _getFd: { returns: SinkFd },
    sinkId: sinkId(id),
  }) as const;

export const ArrayBufferSink = b.class({
  rustPath: "crate::webcore::sink::JSSink<crate::webcore::sink::ArrayBufferSink>",
  writable: false,
  memoryCost: true,
  construct: {},
  call: { returns: b.self, capability: "heap" },
  proto: sinkPrototype(0),
});

export const FileSink = b.class({
  rustPath: "crate::webcore::sink::JSSink<crate::webcore::FileSink>",
  writable: false,
  memoryCost: true,
  construct: "illegal",
  proto: sinkPrototype(2),
});

export const NetworkSink = b.class({
  rustPath: "crate::webcore::sink::JSSink<crate::webcore::streams::NetworkSink>",
  writable: false,
  memoryCost: true,
  construct: "illegal",
  proto: sinkPrototype(6),
});

/** What `pull(controller)` of a `type: "direct"` stream gets when a native sink consumes the stream, and what the pump of any other stream writes to. */
export const ReadableSinkController = b.class({
  rustPath: "crate::webcore::sink::ReadableSinkController",
  writable: false,
  /** `BunStreamSource.cpp` has `source`, `closePromise`, `failReason` and `readableStream`; the sink's `PipeCell` has the others. */
  internalFields: ["source", "closePromise", "failReason", "readableStream", "pipeStream", "pipeDone"],
  proto: {
    close: { capability: "js", throws: true, passThis: true, args: { error: b.any }, length: 0 },
    flush,
    end: { ...method, passThis: true },
    start,
    write,
    sinkId: { getter: b.u8, enumerable: false, configurable: true },
  },
});
