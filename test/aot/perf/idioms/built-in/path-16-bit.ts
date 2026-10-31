import { nextTurns } from "../host.ts";
import { basename, dirname, extname, join, normalize, relative } from "node:path";
const directories: string[] = ["/Users/someone/projects/応用/src/components", "/home/user/config/道具/settings/of/the/day", "/usr/local/lib/node_modules/型/lib", "/var/www/sites/例/releases/current/public"];
const names: string[] = ["button/索引.tsx", "file.json", "typescript.js", "assets/app.css"];
const files: string[] = directories.map((directory, i) => directory + "/" + names[i]);
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += join(directories[i & 3]!, names[i & 3]!).length + normalize(files[i & 3]!).length + relative(directories[i & 3]!, files[(i + 1) & 3]!).length + dirname(files[i & 3]!).length + basename(files[i & 3]!).length + extname(files[i & 3]!).length;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
