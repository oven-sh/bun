// With the file as an asset the compiler knows that the executable holds it and hands no warning on. So the bun-ignore comment silences nothing.
// Flags: --asset ./info/data.json
// Build prints: 0 x warn: TS100098: This reads "info/data.json", but the executable has no file at that path. Embed it with --asset info/data.json
// Build prints: 1 x warn: TS100073: This comment silences nothing: the build reports no TS100098 on the line that it applies to
import fs from "node:fs";
const stem = process.argv[2] ?? "data";
console.log("required", import.meta.require("./info/" + stem + ".json").commit);
try {
  // bun-ignore TS100098
  console.log("read", JSON.parse(fs.readFileSync(new URL("./info/data.json", import.meta.url), "utf8")).commit);
} catch (error) {
  console.log("read threw", error.code);
}
