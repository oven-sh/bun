import { writeFileSync } from "node:fs";
import { bench, run } from "./runner.mjs";

var short = "Hello World!";
var shortUTF16 = "Hello World 💕💕💕";
var long = "Hello World!".repeat(1024);
var longUTF16 = "Hello World 💕💕💕".repeat(1024);

bench(`${short.length} ascii`, () => {
  writeFileSync("/tmp/bun.bench-out.txt", short);
});

bench(`${short.length} utf8`, () => {
  writeFileSync("/tmp/bun.bench-out.txt", shortUTF16);
});

bench(`${long.length} ascii`, () => {
  writeFileSync("/tmp/bun.bench-out.txt", long);
});

bench(`${longUTF16.length} utf8`, () => {
  writeFileSync("/tmp/bun.bench-out.txt", longUTF16);
});

await run();
