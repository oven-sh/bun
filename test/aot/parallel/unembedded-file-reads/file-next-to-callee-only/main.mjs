// Reference: bun build --compile
// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
// Build prints: 0 x warn: TS100098: This reads "lib/data.txt", but the executable has no file at that path. Embed it with --asset lib/data.txt
import { read } from "./lib/read.mjs";
try {
  console.log("read", JSON.stringify(String(read(import.meta.url))));
} catch (error) {
  console.log("caught", error.code);
}
