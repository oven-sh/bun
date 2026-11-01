import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import zlib from "node:zlib";

const text = "compress me, ".repeat(400);
const gzipped = zlib.gzipSync(text);
console.log(gzipped.length < text.length, gzipped[0], gzipped[1], zlib.gunzipSync(gzipped).toString() === text);
console.log(zlib.inflateSync(zlib.deflateSync(Buffer.from(text), { level: 9 })).length, zlib.inflateRawSync(zlib.deflateRawSync(text)).length, zlib.unzipSync(gzipped).length);
console.log(zlib.brotliDecompressSync(zlib.brotliCompressSync(text)).toString() === text, zlib.zstdDecompressSync?.(zlib.zstdCompressSync(text)).length);
console.log((await promisify(zlib.gunzip)(await promisify(zlib.gzip)("async"))).toString(), zlib.crc32?.("hello"), zlib.constants.Z_BEST_COMPRESSION);
try {
  zlib.gunzipSync(Buffer.from("this is not gzip"));
} catch (error) {
  console.log(error.code, error.errno);
}
const codesHandedToCallback = [];
zlib.inflate(Buffer.from([1, 2, 3]), error => codesHandedToCallback.push(error.code));
process.on("exit", () => console.log("callback", ...codesHandedToCallback));

const pieces = [];
await pipeline(Readable.from([text.slice(0, 1000), text.slice(1000)]), zlib.createGzip(), zlib.createGunzip(), async function (source) {
  for await (const piece of source) pieces.push(piece);
});
console.log(Buffer.concat(pieces).toString() === text);
console.log(Bun.gunzipSync(Bun.gzipSync(text)).length, Bun.inflateSync(Bun.deflateSync("abc")).length);

const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")).pipeThrough(new DecompressionStream("gzip"));
console.log((await new Response(stream).text()) === text);

const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(gzipped, { headers: { "content-encoding": "gzip" } }) });
console.log((await (await fetch(server.url)).text()).length);
server.stop(true);
