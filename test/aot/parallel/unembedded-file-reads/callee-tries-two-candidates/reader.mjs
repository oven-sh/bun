import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const NOTES = "notes.json";
export function readNotes(base) {
  const folder = path.dirname(fileURLToPath(base));
  for (const found of [path.resolve(folder, NOTES), path.resolve(folder, "..", NOTES)]) {
    try {
      return JSON.parse(fs.readFileSync(found, "utf8"));
    } catch {}
  }
  return null;
}
