// Build prints: 1 x warn: TS100098: This reads "info/data.json", but the executable has no file at that path. Embed it with --asset info/data.json
import { readInfo } from "./lib/read.mjs";
const stem = process.argv[2] ?? "data";
try {
  console.log("required", import.meta.require("./info/" + stem + ".json").commit);
} catch (error) {
  console.log("require threw", error.code);
}
try {
  console.log("read", JSON.parse(readInfo(import.meta.url)).commit);
} catch (error) {
  console.log("read threw", error.code);
}
/* Output:
required 94714fd
read threw ENOENT
*/
