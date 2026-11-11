// Reference: bun build --compile
// Build prints: 1 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import fs from "node:fs";
const file = new URL("./data.txt", import.meta.url);
try {
  fs.closeSync(fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0)));
  console.log("opened");
} catch {
  console.log("not opened");
}
