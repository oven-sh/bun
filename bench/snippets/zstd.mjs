// Bun's zstd codec (src/zstd), one line per case: best time in milliseconds.
//
//   bun run build:release bench/snippets/zstd.mjs
//
// There is nothing to compare with in here: run it with the build before a change and the one after. Use release
// builds, which optimize the crates at link time.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import zlib from "node:zlib";

const root = join(import.meta.dir, "../..");
const files = (directory, extension) =>
  readdirSync(join(root, directory), { recursive: true })
    .filter(name => name.endsWith(extension))
    .sort()
    .map(name => readFileSync(join(root, directory, name)));
const pieces = (bytes, size) =>
  Array.from({ length: Math.floor(bytes.length / size) }, (_, i) => bytes.subarray(i * size, (i + 1) * size));

const MB = 1 << 20;
const text = Buffer.concat(files("docs", ".mdx")).subarray(0, 4 * MB);
const code = Buffer.concat(files("test/js/node/test/parallel", ".js")).subarray(0, 8 * MB);
const json = readFileSync(join(root, "test/bun.lock"));
const images = Buffer.concat(files("docs/images", ".png")).subarray(0, 4 * MB);

const subjects = {
  "text, whole": [text],
  "code, whole": [code],
  "JSON, whole": [json],
  "images, whole": [images],
  "code, 128 KB pieces": pieces(code.subarray(0, 4 * MB), 128 << 10),
  "code, 5 KB pieces": pieces(code.subarray(0, 2 * MB), 5 << 10),
  "code, 200 byte pieces": pieces(code.subarray(0, MB / 2), 200),
};

async function report(name, inputs, fn) {
  let best = Infinity;
  for (let round = 0, total = 0; round < 3 || total < 5e8; round++) {
    const start = Bun.nanoseconds();
    for (const input of inputs) await fn(input);
    const elapsed = Bun.nanoseconds() - start;
    best = Math.min(best, elapsed);
    total += elapsed;
  }
  console.log(`${(best / 1e6).toFixed(2).padStart(9)}  ${name}`);
}

for (const [subject, inputs] of Object.entries(subjects)) {
  for (const level of [1, 3, 9, 19]) {
    const compress = input => Bun.zstdCompressSync(input, { level });
    await report(`Bun.zstdCompressSync, ${subject}, level ${level}`, inputs, compress);
    await report(`Bun.zstdDecompressSync, ${subject}, level ${level}`, inputs.map(compress), Bun.zstdDecompressSync);
  }
}

function throughNode(stream, input) {
  for (let i = 0; i < input.length; i += 64 << 10) stream.write(input.subarray(i, i + (64 << 10)));
  return buffer(stream.end());
}
const throughWeb = (stream, input) => new Response(new Blob([input]).stream().pipeThrough(stream)).bytes();

const { ZSTD_c_compressionLevel, ZSTD_c_enableLongDistanceMatching, ZSTD_c_nbWorkers } = zlib.constants;
const dictionary = code.subarray(-110 << 10);
const small = subjects["code, 5 KB pieces"];
const streamed = await throughNode(zlib.createZstdCompress(), code);

await report("zlib.createZstdCompress", [code], it => throughNode(zlib.createZstdCompress(), it));
await report("zlib.createZstdDecompress", [streamed], it => throughNode(zlib.createZstdDecompress(), it));
await report("CompressionStream", [code], it => throughWeb(new CompressionStream("zstd"), it));
await report("DecompressionStream", [streamed], it => throughWeb(new DecompressionStream("zstd"), it));
for (const [name, params] of [
  ["long distance matching", { [ZSTD_c_enableLongDistanceMatching]: 1 }],
  ...[1, 3, 9].map(level => [`level ${level}, 4 workers`, { [ZSTD_c_compressionLevel]: level, [ZSTD_c_nbWorkers]: 4 }]),
  ["long distance matching, 4 workers", { [ZSTD_c_enableLongDistanceMatching]: 1, [ZSTD_c_nbWorkers]: 4 }],
]) {
  await report(`zlib.zstdCompressSync, ${name}`, [Buffer.concat([code, text, code])], it =>
    zlib.zstdCompressSync(it, { params }),
  );
}
const withDictionary = it => zlib.zstdCompressSync(it, { dictionary });
await report("zlib.zstdCompressSync, 5 KB pieces, dictionary", small, withDictionary);
await report("zlib.zstdDecompressSync, 5 KB pieces, dictionary", small.map(withDictionary), it =>
  zlib.zstdDecompressSync(it, { dictionary }),
);

using server = Bun.serve({
  port: 0,
  fetch: () => new Response(streamed, { headers: { "Content-Encoding": "zstd" } }),
});
await report("fetch, Content-Encoding: zstd", [server.url], async url => (await fetch(url)).bytes());
