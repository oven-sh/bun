import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { bench, run } from "../runner.mjs";

var hugeFile = Buffer.alloc(1024 * 1024 * 64);
var medFile = Buffer.alloc(1024 * 1024 * 16);
var humongousFile = Buffer.alloc(1024 * 1024 * 256);

bench(
  `fs.writeFile ${new Intl.NumberFormat("en-US", {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "narrow",
  }).format(humongousFile.byteLength / 1024 / 1024)}`,
  async () => {
    await writeFile("/tmp/bun.bench-out.humongousFile.txt" + ((Math.random() * 65432) | 0).toString(16), humongousFile);
  },
);

bench(
  `fs.writeFile ${new Intl.NumberFormat("en-US", {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "narrow",
  }).format(hugeFile.byteLength / 1024 / 1024)}`,
  async () => {
    await writeFile("/tmp/bun.bench-out.huge.txt" + ((Math.random() * 65432) | 0).toString(16), hugeFile);
  },
);

bench(
  `fs.writeFile ${new Intl.NumberFormat("en-US", {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "narrow",
  }).format(medFile.byteLength / 1024 / 1024)}`,
  async () => {
    await writeFile("/tmp/bun.bench-out.medium.txt" + ((Math.random() * 65432) | 0).toString(16), medFile);
  },
);

await run();
