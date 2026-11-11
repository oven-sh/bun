// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { readFileSync } from "node:fs";
try {
  console.log("read", JSON.stringify(String(readFileSync(new URL("./data.txt", "file:///nowhere/"), "utf8"))));
} catch (error) {
  console.log("caught", error.code);
}
