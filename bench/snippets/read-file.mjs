import { readFileSync, writeFileSync } from "node:fs";
import { bench, run } from "../runner.mjs";

var short = (function () {
  const text = "Hello World!";
  const path = "/tmp/bun-bench-short.text";
  writeFileSync(path, text, "utf8");
  return { path, length: text.length };
})();
var shortUTF16 = (function () {
  const text = "Hello World 💕💕💕";
  const path = "/tmp/bun-bench-shortUTF16.text";
  writeFileSync(path, text, "utf8");
  return { path, length: text.length };
})();
var long = (function () {
  const text = "Hello World!".repeat(1024);
  const path = "/tmp/bun-bench-long.text";
  writeFileSync(path, text, "utf8");
  return { path, length: text.length };
})();
var longUTF16 = (function () {
  const text = "Hello World 💕💕💕".repeat(1024);
  const path = "/tmp/bun-bench-longUTF16.text";
  writeFileSync(path, text, "utf8");
  return { path, length: text.length };
})();

bench(`${short.length} ascii`, () => {
  readFileSync(short.path, "utf-8");
});

bench(`${short.length} utf8`, () => {
  readFileSync(shortUTF16.path, "utf-8");
});

bench(`${long.length} ascii`, () => {
  readFileSync(long.path, "utf-8");
});

bench(`${longUTF16.length} utf8`, () => {
  readFileSync(longUTF16.path, "utf-8");
});

await run();
