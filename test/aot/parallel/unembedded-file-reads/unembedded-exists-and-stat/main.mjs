// Reference: bun build --compile
// Build prints: 3 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import fs from "node:fs";
const at = new URL("./data.txt", import.meta.url);
console.log("exists", fs.existsSync(at));
try {
  console.log("size", fs.statSync(at).size);
} catch (error) {
  console.log("caught", error.code);
}
console.log("file exists", await Bun.file(at).exists());
