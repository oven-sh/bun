import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::node_zlib_binding" });

export const crc32 = b.fn({
  args: {
    data: b.bytes({ from: ["string", "buffer"], refuse: ["stringObject"] }),
    value: b.u32.validateInteger().default(0),
  },
  expected: { data: ["Buffer", "TypedArray", "DataView", "string"] },
  returns: b.u32,
});

const method = { capability: "js", throws: true, passThis: true, length: 0 } as const;
/** A number saturates to a `u32`, `true` is 1 and anything else is 0. Only `flush` refuses `undefined`. */
export const WriteNumber = b.union({ number: b.f64, flag: b.bool, missing: b.undefined, other: b.ignored });
/** `null` is a write that only flushes. */
export const WriteInput = b.union({
  buffer: b.bufferSource.allowShared,
  missing: b.undefined,
  flushOnly: b.null,
  other: b.ignored,
});
const write = {
  ...method,
  args: {
    flush: WriteNumber,
    in_: WriteInput,
    inOff: WriteNumber,
    inLen: WriteNumber,
    out: b.bufferSource.allowShared.otherAsNull,
    outOff: WriteNumber,
    outLen: WriteNumber,
  },
} as const;
const int32 = b.i32.validateInteger();
/** An error shows `other`. */
export const Uint32ArrayArgument = b.union({
  array: b.cell("JSC::JSUint32Array", "JavaScriptCore/JSTypedArrays.h", {
    rustPath: "bun_jsc::bindgen::BufferSource",
    tsType: "Uint32Array",
  }),
  other: b.opaque,
});
export const ProcessCallback = b.union({ callable: b.callable, other: b.opaque });
export const Dictionary = b.union({ none: b.undefined, buffer: b.bufferSource.allowShared, other: b.opaque });

/** The native handle of a `node:zlib` stream: `kHandle` in `src/js/node/zlib.ts`. */
const compressionStream = <Init extends object, Params extends object>(
  rustPath: string,
  [firstMode, lastMode]: readonly [number, number],
  init: Init,
  params: Params,
) =>
  b.class({
    rustPath,
    refCounted: true,
    rustTraits: ["crate::node::node_zlib_binding::CompressionStreamImpl"],
    estimatedSize: true,
    construct: { args: { mode: b.u8.validateInteger(firstMode, lastMode) }, capability: "js", length: 0 },
    internalFields: ["writeCallback", "errorCallback", "pendingInput", "pendingOutput", "writeResult"],
    proto: {
      close: {},
      init: { ...method, ...init },
      onerror: { getter: b.opaque, setter: { type: b.callable.otherAsNull, capability: "js" }, passThis: true },
      params,
      reset: method,
      write,
      writeSync: write,
    },
  });

export const NativeZlib = compressionStream(
  "crate::node::zlib::native_zlib::NativeZlib",
  [1, 7],
  {
    args: {
      windowBits: int32,
      level: int32,
      memLevel: int32,
      strategy: int32,
      writeState: Uint32ArrayArgument,
      processCallback: ProcessCallback,
      dictionary: Dictionary,
    },
  },
  { ...method, args: { level: int32, strategy: int32 } },
);

export const NativeBrotli = compressionStream(
  "crate::node::zlib::native_brotli::NativeBrotli",
  [8, 9],
  {
    args: {
      initParamsArray: Uint32ArrayArgument,
      writeState: Uint32ArrayArgument,
      processCallback: ProcessCallback,
      dictionary: Dictionary,
    },
    returns: b.bool,
  },
  {},
);

export const NativeZstd = compressionStream(
  "crate::node::zlib::native_zstd::NativeZstd",
  [10, 11],
  {
    args: {
      initParamsArray: Uint32ArrayArgument,
      pledgedSrcSize: b.f64.otherAsNull,
      writeState: Uint32ArrayArgument,
      processCallback: ProcessCallback,
      dictionary: Dictionary,
    },
    returns: b.bool,
  },
  {},
);
