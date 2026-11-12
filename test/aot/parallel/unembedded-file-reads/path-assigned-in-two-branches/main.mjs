// Reference: bun build --compile
// Build prints: 1 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { readFileSync } from "node:fs";
import { join } from "node:path";
let file;
if (process.argv[2]) file = process.argv[2];
else file = join(import.meta.dirname, "data.txt");
try {
  console.log("read", JSON.stringify(String(readFileSync(file, "utf8"))));
} catch (error) {
  console.log("caught", error.code);
}
