import { nextTurns } from "../host.ts";
let sink: unknown;
const fresh = (text: string): string => JSON.parse(JSON.stringify(text));
const list: string[] = [];
for (let i = 0; i < 64; i++) list.push(fresh("name" + ((i * 37) & 63) + "x".repeat(i & 3)));
const asked: string[] = list.map(fresh);
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + list.indexOf(asked[i & 63]!)) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
