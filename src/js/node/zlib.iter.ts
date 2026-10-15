// Hardcoded module "node:zlib/iter"
// Public entry point for the iterable compression/decompression API.
// Usage: require('zlib/iter') or require('node:zlib/iter')
// Requires: --experimental-stream-iter (gated at module resolution)

process.emitWarning("zlib/iter is an experimental feature and might change at any time", "ExperimentalWarning");

const {
  compressGzip,
  compressGzipSync,
  compressDeflate,
  compressDeflateSync,
  compressBrotli,
  compressBrotliSync,
  compressZstd,
  compressZstdSync,
  decompressGzip,
  decompressGzipSync,
  decompressDeflate,
  decompressDeflateSync,
  decompressBrotli,
  decompressBrotliSync,
  decompressZstd,
  decompressZstdSync,
} = require("internal/streams/iter/transform");

export default {
  // Compression transforms (async)
  compressGzip,
  compressDeflate,
  compressBrotli,
  compressZstd,

  // Compression transforms (sync)
  compressGzipSync,
  compressDeflateSync,
  compressBrotliSync,
  compressZstdSync,

  // Decompression transforms (async)
  decompressGzip,
  decompressDeflate,
  decompressBrotli,
  decompressZstd,

  // Decompression transforms (sync)
  decompressGzipSync,
  decompressDeflateSync,
  decompressBrotliSync,
  decompressZstdSync,
};
