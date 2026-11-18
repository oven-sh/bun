// Reference: bun build --compile
// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { read, readBeside } from "./lib/read.mjs";
let moduleUrl = import.meta.url;
moduleUrl = "file:///made-up/place/x.mjs";
try {
  console.log("read", JSON.stringify(String(read({ moduleUrl }))));
} catch (error) {
  console.log("caught", error.code ?? error.name);
}
try {
  console.log("read", JSON.stringify(String(readBeside(moduleUrl))));
} catch (error) {
  console.log("caught", error.code ?? error.name);
}
