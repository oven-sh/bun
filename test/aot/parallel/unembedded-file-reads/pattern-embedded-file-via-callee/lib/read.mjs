import fs from "node:fs";
export function readInfo(base) {
  return fs.readFileSync(new URL("./info/data.json", base), "utf8");
}
