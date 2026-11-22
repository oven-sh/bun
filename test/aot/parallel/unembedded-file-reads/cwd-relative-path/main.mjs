// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { readFileSync } from "node:fs";
import { join } from "node:path";
try {
  console.log("read", JSON.stringify(String(readFileSync("data.txt", "utf8"))));
} catch (error) {
  console.log("caught", error.code);
}
