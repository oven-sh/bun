// node:zlib: gzip, deflate, raw deflate and brotli, each synchronously, with a callback, with promisify and as a stream; options, crc32, a broken input, and constants.
import zlib from "node:zlib";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Readable, Writable } from "node:stream";

const text = "the quick brown fox ".repeat(50);
const pairs = [["gzipSync", "gunzipSync"], ["deflateSync", "inflateSync"], ["deflateRawSync", "inflateRawSync"], ["brotliCompressSync", "brotliDecompressSync"]];
for (const [pack, unpack] of pairs) {
  const packed = zlib[pack](text);
  console.log(pack, packed.length < text.length, zlib[unpack](packed).toString() === text);
}
console.log(zlib.unzipSync(zlib.gzipSync("either")).toString(), zlib.unzipSync(zlib.deflateSync("form")).toString());
console.log((await promisify(zlib.gunzip)(await promisify(zlib.gzip)("promisified"))).toString());
console.log(await new Promise(resolve => zlib.deflate("callback", (error, packed) => zlib.inflate(packed, (error2, plain) => resolve([error, error2, plain].join())))));
const parts = [];
await pipeline(Readable.from([text]), zlib.createGzip({ level: 9 }), zlib.createGunzip(), new Writable({ write(chunk, encoding, done) { parts.push(chunk); done(); } }));
console.log(Buffer.concat(parts).toString() === text);
const brotli = [];
await pipeline(Readable.from(["stream of brotli"]), zlib.createBrotliCompress(), zlib.createBrotliDecompress(), new Writable({ write(chunk, encoding, done) { brotli.push(chunk); done(); } }));
console.log(Buffer.concat(brotli).toString());
console.log(zlib.gzipSync("a", { level: 0 }).length > zlib.gzipSync("a", { level: 9 }).length - 10, zlib.gzipSync("magic")[0].toString(16), zlib.gzipSync("magic")[1].toString(16));
try {
  zlib.gunzipSync(Buffer.from("this is not gzip"));
} catch (error) {
  console.log(error.code, error.errno);
}
console.log(await promisify(zlib.inflate)(Buffer.from("nor this")).catch(error => error.code));
console.log(zlib.crc32("hello"), zlib.constants.Z_BEST_COMPRESSION, zlib.constants.BROTLI_PARAM_QUALITY);
