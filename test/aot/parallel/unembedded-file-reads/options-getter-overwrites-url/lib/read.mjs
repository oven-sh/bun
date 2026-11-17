import { readFileSync } from "node:fs";
export function byPattern({ early, moduleUrl }) {
  return early + readFileSync(new URL("./data.txt", moduleUrl), "utf8");
}
export function byMember(options) {
  return options.early + readFileSync(new URL("./data.txt", options.moduleUrl), "utf8");
}
