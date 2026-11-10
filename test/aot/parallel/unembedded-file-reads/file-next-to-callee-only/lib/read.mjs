import { readFileSync } from "node:fs";
export function read(base) {
  return readFileSync(new URL("./data.txt", base), "utf8");
}
