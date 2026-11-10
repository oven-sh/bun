// Reference: bun build --compile
// Build prints: 1 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { readFileSync } from "node:fs";
import { join } from "node:path";
let text = "the fallback";
try {
  text = readFileSync(join(import.meta.dirname, "data.txt"), "utf8");
} catch {}
console.log("read", JSON.stringify(text));
