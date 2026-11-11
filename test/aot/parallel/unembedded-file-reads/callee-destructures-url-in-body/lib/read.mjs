import { readFileSync } from "node:fs";
export function read(options) {
  const { name, moduleUrl } = options;
  if (name) console.log(name);
  return readFileSync(new URL("./data.txt", moduleUrl), "utf8");
}
