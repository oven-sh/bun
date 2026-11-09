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
const write = {
  ...method,
  args: {
    flush: b.any,
    in_: b.any,
    inOff: b.any,
    inLen: b.any,
    out: b.any,
    outOff: b.any,
    outLen: b.any,
  },
} as const;
const int32 = b.i32.validateInteger();

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
      onerror: { getter: b.any, setter: { capability: "js" }, passThis: true },
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
      writeState: b.any,
      processCallback: b.any,
      dictionary: b.any,
    },
  },
  { ...method, args: { level: int32, strategy: int32 } },
);

export const NativeBrotli = compressionStream(
  "crate::node::zlib::native_brotli::NativeBrotli",
  [8, 9],
  { args: { initParamsArray: b.any, writeState: b.any, processCallback: b.any, dictionary: b.any }, returns: b.bool },
  {},
);

export const NativeZstd = compressionStream(
  "crate::node::zlib::native_zstd::NativeZstd",
  [10, 11],
  {
    args: {
      initParamsArray: b.any,
      pledgedSrcSize: b.any,
      writeState: b.any,
      processCallback: b.any,
      dictionary: b.any,
    },
    returns: b.bool,
  },
  {},
);
