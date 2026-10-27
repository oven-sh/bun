// What JavaScript cannot otherwise reach of bun_libdeflate: test/js/node/zlib/zlib.test.js
import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::libdeflate_test" });

const bytes = b.bytes({ from: ["buffer"] });

export const Encoding = b.enumeration(["deflate", "zlib", "gzip"]);
export const Decoding = b.enumeration(["deflate", "gzip"]);

export const Outcome = b.dictionary({
  /** "bad data", "insufficient space" or "no such level". */
  error: b.string.utf8.optional,
  /** How much of its input a decompressor read. */
  read: b.usize.optional,
  /** How many bytes the output got, and their CRC-32. */
  written: b.usize,
  crc32: b.u32,
  /** Of a `Vec` that is appended to: whether what it held is still there. */
  keptWhatItHeld: b.bool.optional,
  /** Of a `Vec`: whether it was reallocated elsewhere. */
  moved: b.bool.optional,
  capacity: b.usize.optional,
});

export const maxBytesNeeded = b.fn({ args: { inputLength: b.usize, encoding: Encoding }, returns: b.usize });

export const CompressToSliceOptions = b.dictionary({
  level: b.i32,
  encoding: Encoding.default("deflate"),
  room: b.usize,
});

export const CompressToVecOptions = b.dictionary({
  level: b.i32,
  encoding: Encoding.default("deflate"),
  /** How many bytes the `Vec` holds, and how many more it has room for. */
  held: b.usize.default(0),
  spare: b.usize.default(0),
});

/** The same compressor gets `first` first. */
export const compressToSlice = b.fn({
  args: { input: bytes, options: CompressToSliceOptions, first: bytes.optional },
  returns: Outcome,
});
export const compressToVec = b.fn({
  args: { input: bytes, options: CompressToVecOptions, first: bytes.optional },
  returns: Outcome,
});

export const DecompressToSliceOptions = b.dictionary({
  decoding: Decoding.default("deflate"),
  room: b.usize,
});

export const DecompressToVecOptions = b.dictionary({
  decoding: Decoding.default("deflate"),
  /** How many bytes the `Vec` holds, and how many more it has room for. */
  held: b.usize.default(0),
  spare: b.usize,
  /** The output replaces what the `Vec` holds, and the `Vec` grows up to this. Without it, the output is appended within `spare`. */
  maxLength: b.usize.optional,
});

/** The same decompressor gets `first` first. */
export const decompressToSlice = b.fn({
  args: { stream: bytes, options: DecompressToSliceOptions, first: bytes.optional },
  returns: Outcome,
});
export const decompressToVec = b.fn({
  args: { stream: bytes, options: DecompressToVecOptions, first: bytes.optional },
  returns: Outcome,
});
