import { readFileSync } from "node:fs";
export function readBeside(base) {
  return readFileSync(new URL("./data.txt", base), "utf8");
}
