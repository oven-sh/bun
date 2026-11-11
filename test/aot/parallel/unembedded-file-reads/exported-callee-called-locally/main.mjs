// Reference: bun build --compile
// Build prints: 1 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { readFileSync } from "node:fs";
export function read(base) {
  return readFileSync(new URL("./data.txt", base), "utf8");
}
try {
  console.log("read", JSON.stringify(String(read(import.meta.url))));
} catch (error) {
  console.log("caught", error.code);
}
