// Reference: bun build --compile
// Build prints: 1 x warn: TS100098: This reads "notes.json", but the executable has no file at that path. Embed it with --asset notes.json
// Build prints: 0 x warn: TS100098: This reads "../notes.json", but the executable has no file at that path. Embed it with --asset ../notes.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const NOTES = "notes.json";
function readNotes(base) {
  const folder = path.dirname(fileURLToPath(base));
  for (const found of [path.resolve(folder, NOTES), path.resolve(folder, "..", NOTES)]) {
    try {
      return JSON.parse(fs.readFileSync(found, "utf8"));
    } catch {}
  }
  return null;
}
console.log("read", JSON.stringify(readNotes(import.meta.url)));
