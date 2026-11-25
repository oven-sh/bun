// Reference: bun build --compile
// Build prints: 2 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import fs from "node:fs";
const at = new URL("./data.txt", import.meta.url);
function probe() {
  return fs.existsSync(at);
}
const tools = {
  probe() {
    return fs.existsSync(at);
  },
};
console.log([0].map(probe).join(), tools.probe());
