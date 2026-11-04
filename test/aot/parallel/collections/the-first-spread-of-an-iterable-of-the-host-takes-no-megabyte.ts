// The run time hands such a spread to a function of the library. Finding that function must not cost a table of a megabyte that stays for the life of the process.
import { readFileSync } from "node:fs";
function privateKB(): number {
  try {
    return Number(/RssAnon:\s+(\d+)/.exec(readFileSync("/proc/self/status", "utf8"))![1]);
  } catch {
    return 0;
  }
}
const headers = new Headers({ a: "1", b: "2", c: "3" });
privateKB();
const before = privateKB();
const first = [...headers];
const [x, y] = headers;
const behind = privateKB();
console.log(JSON.stringify(first), JSON.stringify(x), JSON.stringify(y), "under 400 KB:", behind - before < 400);
let all = 0;
for (let i = 0; i < 1000; i++) all += [...headers].length;
console.log(all);
