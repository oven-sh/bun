// Reference: bun build --compile
// Build prints: 0 x warn: TS100098: This reads "a.txt", but the executable has no file at that path. Embed it with --asset a.txt
// Build prints: 1 x warn: TS100098: This reads "b.txt", but the executable has no file at that path. Embed it with --asset b.txt
import { read } from "./lib/read.mjs";
try {
  console.log("read", JSON.stringify(String(read(import.meta.url))));
} catch (error) {
  console.log("caught", error.code);
}
