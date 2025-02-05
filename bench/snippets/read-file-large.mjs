import { readFile } from "node:fs/promises";

import { writeFileSync } from "node:fs";

(function () {
  writeFileSync("/tmp/bun-bench-large.text", Buffer.alloc(1024 * 1024 * 8, "abcdefg!"));
})();
if (globalThis.Bun) {
  Bun.gc(true);
}

console.log("Before:", "RSS", (process.memoryUsage.rss() / 1024 / 1024) | 0, "MB");

for (let i = 0; i < 1024; i++) {
  await readFile("/tmp/bun-bench-large.text");
}
console.log("After:", "RSS", (process.memoryUsage.rss() / 1024 / 1024) | 0, "MB");
