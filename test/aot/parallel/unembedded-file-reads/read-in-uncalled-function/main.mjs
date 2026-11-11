// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import fs from "node:fs";
const at = new URL("./data.txt", import.meta.url);
function unused() {
  const nested = () => fs.existsSync(at);
  return nested() && fs.readFileSync(at, "utf8");
}
const alsoUnused = () => fs.statSync(at);
console.log("nothing is read");
