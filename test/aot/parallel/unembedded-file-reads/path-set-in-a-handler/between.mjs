import { readFileSync } from "node:fs";
import { join } from "node:path";
const one = { valueOf() { throw new Error("no number"); } };
let path = "";
try {
  path = join(import.meta.dirname, "set.txt");
  one + 1;
  path = "";
} catch {}
try {
  console.log(readFileSync(path, "utf8"));
} catch (error) {
  console.log(error.code);
}
