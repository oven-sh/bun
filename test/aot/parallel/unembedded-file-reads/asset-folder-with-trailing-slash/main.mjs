// Flags: --asset ./sub/
// Build prints: 0 x warn: TS100098: This reads "sub/data.txt", but the executable has no file at that path. Embed it with --asset sub/data.txt
import { readFileSync } from "node:fs";
import { join } from "node:path";
try {
  console.log("read", JSON.stringify(String(readFileSync(join(import.meta.dirname, "sub", "data.txt"), "utf8"))));
} catch (error) {
  console.log("caught", error.code);
}
