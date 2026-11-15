// Build prints: 1 x warn: TS100098: This reads "info/data.json", but the executable has no file at that path. Embed it with --asset info/data.json
import fs from "node:fs";
const stem = process.argv[2] ?? "data";
console.log("required", import.meta.require("./info/" + stem + ".json").commit);
const at = process.argv[3] ? new URL("./info/data.json", import.meta.url) : new URL("./info/../info/data.json", import.meta.url);
try {
  console.log("read", JSON.parse(fs.readFileSync(at, "utf8")).commit);
} catch (error) {
  console.log("read threw", error.code);
}
/* Output:
required 94714fd
read threw ENOENT
*/
