import * as b from "../../codegen/bindgen-lib.ts";

/** `write` looks at whether the sink is closed before it throws for any `other` chunk. */
export const SinkChunk = b.union({
  text: b.string.allowStringObject,
  bytes: b.bufferSource.allowShared,
  other: b.any,
});

export const SinkPath = b.union({ missing: b.undefined, path: b.string.utf8.owned, other: b.any });

/** An `ArrayBufferSink` uses the first three members, a `FileSink` uses `path` and `fd`, and every other sink uses `highWaterMark`. */
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

const js = { capability: "js", throws: true } as const;
const method = { returns: b.any, ...js } as const;

const flush = { ...method, args: { wait: b.bool.otherAsNull }, length: 1 } as const;
const start = { ...js, args: { options: SinkStartOptions }, length: 1 } as const;

/** `SinkId` in `Sink.rs`. */
const sinkId = (constant: number) => ({ constant, enumerable: false, configurable: true }) as const;

const sinkPrototype = (id: number) =>
  ({
    close: js,
    flush,
    end: { ...method, passThis: true },
    start,
    write: { ...method, args: { chunk: SinkChunk.ifPassed }, length: 1 },
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
  /** `BunStreamSource.cpp` sets `source`, `closePromise` and `readableStream`, and Rust sets the others. */
  internalFields: ["source", "closePromise", "failReason", "readableStream", "pipeStream", "pipeDone"],
  proto: {
    close: { ...js, passThis: true, args: { error: b.any }, length: 0 },
    flush,
    end: { ...method, passThis: true },
    start,
    write: { ...method, args: { data: SinkChunk.ifPassed }, length: 1 },
    sinkId: { getter: b.u8, enumerable: false, configurable: true },
  },
});
