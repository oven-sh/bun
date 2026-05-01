import { bench, run } from "../runner.mjs";
import zlib from "node:zlib";
import { promisify } from "node:util";

const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);

const short = "Hello World!";
const long = "Hello World!".repeat(1024);
const veryLong = "Hello World!".repeat(10240);

// Pre-compress some data for decompression tests
const shortBuf = Buffer.from(short);
const longBuf = Buffer.from(long);
const veryLongBuf = Buffer.from(veryLong);

let [shortCompressed, longCompressed, veryLongCompressed] = await Promise.all([
  deflate(shortBuf, { level: 6 }),
  deflate(longBuf, { level: 6 }),
  deflate(veryLongBuf, { level: 6 }),
]);

const format = new Intl.NumberFormat("en-US", { notation: "compact", unit: "byte" });
// Compression tests at different levels
bench(`deflate ${format.format(short.length)}B (level 1)`, async () => {
  await deflate(shortBuf, { level: 1 });
});

bench(`deflate ${format.format(short.length)} (level 6)`, async () => {
  await deflate(shortBuf, { level: 6 });
});

bench(`deflate ${format.format(long.length)} (level 1)`, async () => {
  await deflate(longBuf, { level: 1 });
});

bench(`deflate ${format.format(long.length)} (level 6)`, async () => {
  await deflate(longBuf, { level: 6 });
});

bench(`deflate ${format.format(veryLong.length)} (level 1)`, async () => {
  await deflate(veryLongBuf, { level: 1 });
});

bench(`deflate ${format.format(veryLong.length)} (level 6)`, async () => {
  await deflate(veryLongBuf, { level: 6 });
});

// Decompression tests
bench(`inflate ${format.format(short.length)}`, async () => {
  await inflate(shortCompressed);
});

bench(`inflate ${format.format(long.length)}`, async () => {
  await inflate(longCompressed);
});

bench(`inflate ${format.format(veryLong.length)}`, async () => {
  await inflate(veryLongCompressed);
});

await run();
