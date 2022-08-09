import { copyFileSync, writeFileSync } from "node:fs";
import { bench, run } from "mitata";

const size = parseInt(process.env.FILE_SIZE, 10) || 1024 * 4;
const rand = new Float64Array(size);
for (let i = 0; i < size; i++) {
  rand[i] = Math.random();
}
const dest = `/tmp/fs-test-copy-file-${(Math.random() * 100000 + 100).toString(
  32
)}`;
const src = `/tmp/fs-test-copy-file-${(Math.random() * 100000 + 100).toString(
  32
)}`;
writeFileSync(src, new Buffer(rand.buffer));

bench(`copyFileSync(${rand.buffer.byteLength} bytes)`, () =>
  copyFileSync(src, dest)
);

await run();
