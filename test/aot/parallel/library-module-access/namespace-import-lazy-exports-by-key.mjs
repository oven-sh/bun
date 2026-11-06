// The namespace object of node:fs is the receiver of a call, and its lazy exports are read under keys that the build does not know.
import * as fs from "node:fs";
console.log(String(fs.existsSync(process.execPath)));
const typeUnder = key => typeof fs[key];
console.log(
  typeUnder(process.argv[2] ?? "promises"),
  typeUnder(["Read", "Stream"].join("")),
  typeof fs[process.argv[3] ?? "promises"].readFile,
);
