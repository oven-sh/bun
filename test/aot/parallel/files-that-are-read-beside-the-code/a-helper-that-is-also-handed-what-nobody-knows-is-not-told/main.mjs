// Reference: bun build --compile
// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
function read(options) {
  return readFileSync(fileURLToPath(new URL("./data.txt", options.moduleUrl)), "utf8");
}
try {
  console.log("read", JSON.stringify(String(read({ moduleUrl: import.meta.url }))));
} catch (error) {
  console.log("caught", error.code);
}
try {
  console.log("read", JSON.stringify(String(read({ moduleUrl: process.argv[2] ?? "file:///nowhere/" }))));
} catch (error) {
  console.log("caught", error.code);
}
