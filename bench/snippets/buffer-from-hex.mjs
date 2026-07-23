// @runtime bun,node,deno
import { Buffer } from "node:buffer";
import { bench, run } from "../runner.mjs";

function makeBenchmark(size) {
  const hexInput = Buffer.alloc(size, "abcdefghijklmnopqrstuvwxyz0123456789").toString("hex");

  bench(`Buffer.from(${size} bytes, 'hex')`, () => {
    Buffer.from(hexInput, "hex");
  });
}

[16, 32, 64, 512, 64 * 1024, 512 * 1024, 1024 * 1024 * 8].forEach(makeBenchmark);

await run();
