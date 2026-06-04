// Hardcoded module "node:zlib/iter"
// Port of Node.js lib/zlib/iter.js (iterable compression/decompression API).
// Zstd transforms are not ported yet.

const {
  compressGzip,
  compressGzipSync,
  compressDeflate,
  compressDeflateSync,
  compressBrotli,
  compressBrotliSync,
  decompressGzip,
  decompressGzipSync,
  decompressDeflate,
  decompressDeflateSync,
  decompressBrotli,
  decompressBrotliSync,
} = require("internal/streams/iter/transform");

process.emitWarning("zlib/iter is an experimental feature and might change at any time", "ExperimentalWarning");

export default {
  // Compression transforms (async)
  compressGzip,
  compressDeflate,
  compressBrotli,

  // Compression transforms (sync)
  compressGzipSync,
  compressDeflateSync,
  compressBrotliSync,

  // Decompression transforms (async)
  decompressGzip,
  decompressDeflate,
  decompressBrotli,

  // Decompression transforms (sync)
  decompressGzipSync,
  decompressDeflateSync,
  decompressBrotliSync,
};
