// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import fs from "node:fs";
import { join } from "node:path";
const here = import.meta.dirname;
let first = join(here, "data.txt");
first = join(here, "absent.txt");
var second = join(here, "data.txt");
second = join(here, "absent.txt");
function inFunction() {
  let path = join(here, "data.txt");
  path = join(here, "data.txt");
  path = join(here, "absent.txt");
  return fs.existsSync(path);
}
const seen = [fs.existsSync(first), fs.existsSync(first), fs.existsSync(second), inFunction()];
for (let turn = 0; turn < 2; turn++) {
  let path = join(here, "data.txt");
  path = join(here, "absent.txt");
  seen.push(fs.existsSync(path));
}
console.log(seen.join());
