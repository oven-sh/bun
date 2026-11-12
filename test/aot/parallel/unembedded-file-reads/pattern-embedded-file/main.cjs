// Build prints: 0 x warn: TS100098: This reads "data/a.json", but the executable has no file at that path. Embed it with --asset data/a.json
const fs = require("node:fs");
const path = require("node:path");
const name = process.argv[2] ?? "a";
console.log("required", JSON.stringify(require(`./data/${name}.json`)));
try {
  console.log("read", JSON.stringify(String(fs.readFileSync(path.join(__dirname, "data", "a.json"), "utf8"))));
} catch (error) {
  console.log("caught", error.code);
}
