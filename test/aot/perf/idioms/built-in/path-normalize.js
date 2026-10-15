import { nextTurns } from "../host.ts";
import { normalize } from "node:path";
const directories = ["/Users/someone/projects/application/src/components", "/home/user/config/tool/settings/of/the/day", "/usr/local/lib/node_modules/typescript/lib", "/var/www/sites/example/releases/current/public"];
const names = ["button/index.tsx", "file.json", "typescript.js", "assets/app.css"];
const files = directories.map((directory, i) => directory + "/" + names[i]);
function bench(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += normalize(files[i & 3]).length;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
