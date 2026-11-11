// Reference: bun build --compile
// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { read, readByUrl } from "./lib/read.mjs";
console.log("read", JSON.stringify(read(import.meta.url)));
try {
  console.log("read", JSON.stringify(readByUrl(import.meta.url)));
} catch (error) {
  console.log("caught", error.code);
}
