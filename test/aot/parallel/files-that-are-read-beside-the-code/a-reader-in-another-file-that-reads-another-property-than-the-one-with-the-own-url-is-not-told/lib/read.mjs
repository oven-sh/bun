import { readFileSync } from "node:fs";
export function read(options) {
  return readFileSync(new URL("./data.txt", options.moduleUrl), "utf8");
}
