// Reference: bun build --compile
// Build prints: 1 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { read } from "./lib/index.mjs";
try {
  console.log("read", JSON.stringify(String(read(import.meta.url))));
} catch (error) {
  console.log("caught", error.code);
}
