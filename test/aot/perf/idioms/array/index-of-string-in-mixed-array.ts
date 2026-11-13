import { nextTurns } from "../host.ts";
let sink: unknown;
const fresh = (text: string): string => JSON.parse(JSON.stringify(text));
const list: unknown[] = [];
for (let i = 0; i < 32; i++) list.push(i & 1 ? fresh("name" + i) : i & 2 ? i : { i });
const asked: string[] = [];
for (let i = 0; i < 32; i++) asked.push(fresh("name" + i));
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + list.indexOf(asked[i & 31]!)) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
