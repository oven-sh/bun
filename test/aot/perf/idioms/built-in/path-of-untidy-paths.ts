import { nextTurns } from "../host.ts";
import { join, normalize, resolve } from "node:path";
const untidy: string[] = ["/Users/someone/projects/application/src/../lib/components/./button", "/home/user//config/tool/settings/../../other/day/", "/usr/local/lib/node_modules/typescript/lib/../bin/./tsc", "/var/www/sites/example/releases/current/../../shared//public"];
const tails: string[] = ["../index.tsx", "./file.json", "../../typescript.js", "assets//app.css"];
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += normalize(untidy[i & 3]!).length + join(untidy[i & 3]!, tails[i & 3]!).length + resolve(untidy[i & 3]!, tails[i & 3]!).length;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
