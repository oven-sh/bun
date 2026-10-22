import zlib from "node:zlib";
console.log(zlib.gunzipSync(zlib.gzipSync("hello")).toString(), zlib.inflateSync(zlib.deflateSync("hello")).length + 1, zlib.brotliDecompressSync(zlib.brotliCompressSync("hello")).toString(), zlib.zstdDecompressSync(zlib.zstdCompressSync("hello")).toString());
