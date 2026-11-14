// Build prints: 0 x warn: TS100098: This reads "info/data.json", but the executable has no file at that path. Embed it with --asset info/data.json
import fs from "node:fs";
const stem = process.argv[2] ?? "data";
try {
  console.log("required", import.meta.require("./info/" + stem + ".json").commit);
} catch (error) {
  console.log("require threw", error.code);
}
try {
  console.log("read", JSON.parse(fs.readFileSync(new URL("./info/data.json", import.meta.url), "utf8")).commit);
} catch (error) {
  console.log("read threw", error.code);
}
/* Output:
required 94714fd
read 94714fd
*/
