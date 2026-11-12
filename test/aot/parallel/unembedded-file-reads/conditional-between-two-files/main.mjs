// Reference: bun build --compile
// Build prints: 1 x warn: TS100098: This reads "a.txt", but the executable has no file at that path. Embed it with --asset a.txt
// Build prints: 1 x warn: TS100098: This reads "b.txt", but the executable has no file at that path. Embed it with --asset b.txt
import { readFileSync } from "node:fs";
try {
  console.log("read", JSON.stringify(String(readFileSync(new URL(process.argv[2] ? "./a.txt" : "./b.txt", import.meta.url), "utf8"))));
} catch (error) {
  console.log("caught", error.code);
}
