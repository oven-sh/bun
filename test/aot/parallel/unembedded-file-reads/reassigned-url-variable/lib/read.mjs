import { readFileSync } from "node:fs";
export function read({ moduleUrl }) {
  return readFileSync(new URL("./data.txt", moduleUrl), "utf8");
}
export function readBeside(base) {
  return readFileSync(new URL("./data.txt", base), "utf8");
}
