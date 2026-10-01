import fs from "node:fs";
import path from "node:path";
const dir = "/workspace/ref/typescript-go/internal/bundled/libs";
const start = process.argv[2] ?? "lib.esnext.full.d.ts";
const seen = new Set(), order = [];
(function visit(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const text = fs.readFileSync(path.join(dir, name), "utf8");
  for (const m of text.matchAll(/^\/\/\/\s*<reference\s+lib="([^"]+)"\s*\/>/gm)) visit("lib." + m[1] + ".d.ts");
  order.push(path.join(dir, name));
})(start);
fs.writeFileSync(process.argv[3], order.join("\n") + "\n");
console.log(start, "closure files", order.length, "bytes", order.reduce((a, f) => a + fs.statSync(f).size, 0));
