import { readFileSync } from "node:fs";
import { join } from "node:path";
export function read(base, own) {
  return readFileSync(own ? join(import.meta.dirname, "a.txt") : new URL("./b.txt", base), "utf8");
}
