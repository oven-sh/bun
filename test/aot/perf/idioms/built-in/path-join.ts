import { nextTurns } from "../host.ts";
import { join } from "node:path";
const directories: string[] = ["/Users/someone/projects/application/src/components", "/home/user/config/tool/settings/of/the/day", "/usr/local/lib/node_modules/typescript/lib", "/var/www/sites/example/releases/current/public"];
const names: string[] = ["button/index.tsx", "file.json", "typescript.js", "assets/app.css"];
const files: string[] = directories.map((directory, i) => directory + "/" + names[i]);
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += join(directories[i & 3]!, names[i & 3]!).length;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
