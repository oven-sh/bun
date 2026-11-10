import { readFileSync } from "node:fs";
export function read({ moduleUrl }) {
  return readFileSync(new URL("./data.txt", moduleUrl), "utf8");
}
