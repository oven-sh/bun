// Reference: bun build --compile
// Build prints: 1 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { readFileSync } from "node:fs";
import { join } from "node:path";
try {
  console.log("read", JSON.stringify(String(readFileSync(new URL("./data.txt", import.meta.url), "utf8"))));
} catch (error) {
  console.log("caught", error.code);
}
