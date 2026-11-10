import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export function read(base) {
  const found = fileURLToPath(base).slice(0, -1) + "data.txt";
  return existsSync(found) ? readFileSync(found, "utf8") : "none";
}
export function readByUrl(base) {
  return readFileSync(new URL(base.slice(0, -1) + "data.txt"), "utf8");
}
