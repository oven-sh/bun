import { bench, run } from "../runner.mjs";
import { brotliCompress, brotliDecompress, createBrotliCompress, createBrotliDecompress } from "node:zlib";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";

const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

const testData =
  process.argv.length > 2
    ? readFileSync(process.argv[2])
    : Buffer.alloc(1024 * 1024 * 16, "abcdefghijklmnopqrstuvwxyz");
let compressed;

bench("brotli compress", async () => {
  compressed = await brotliCompressAsync(testData);
});

bench("brotli decompress", async () => {
  await brotliDecompressAsync(compressed);
});

bench("brotli compress stream", async () => {
  const source = Readable.from([testData]);
  const compress = createBrotliCompress();
  await pipeline(source, compress);
});

await run();
