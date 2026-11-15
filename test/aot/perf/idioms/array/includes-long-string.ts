import { nextTurns } from "../host.ts";
let sink: unknown;
const fresh = (text: string): string => JSON.parse(JSON.stringify(text));
const list: string[] = [];
for (let i = 0; i < 16; i++) list.push(fresh("/a/rather/long/path/that/goes/on/and/on/for/a/while/" + i + "/index.html"));
const asked: string[] = [];
for (let i = 0; i < 32; i++) asked.push(fresh("/a/rather/long/path/that/goes/on/and/on/for/a/while/" + i + "/index.html"));
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) if (list.includes(asked[i & 31]!)) s = (s + 1) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
