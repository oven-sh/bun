import { nextTurns } from "../host.ts";
let sink: unknown;
const parts: string[] = JSON.parse('["text/html","application/json","; charset=","utf-8"]');
const holders = [{ last: "text/html; charset=utf-8" }, { last: "application/json; charset=utf-8" }];
function isNew(holder: { last: string }, value: string): number { if (holder.last !== value) { holder.last = value; return 1; } return 0; }
const tests = [isNew];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + tests[0]!(holders[i & 1]!, parts[i & 1]! + parts[2]! + parts[3]!)) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
