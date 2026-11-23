// Reference: bun build --compile
// Build prints: 1 x warn: TS100098: This reads "a.txt", but the executable has no file at that path. Embed it with --asset a.txt
// Build prints: 1 x warn: TS100098: This reads "b.txt", but the executable has no file at that path. Embed it with --asset b.txt
import { readFileSync } from "node:fs";
const read = (base, name) => readFileSync(new URL(name, base), "utf8");
try {
  console.log("read", JSON.stringify(String(read(import.meta.url, "./a.txt"))));
} catch (error) {
  console.log("caught", error.code);
}
try {
  console.log("read", JSON.stringify(String(read(import.meta.url, "./b.txt"))));
} catch (error) {
  console.log("caught", error.code);
}
