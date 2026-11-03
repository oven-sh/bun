import { nextTurns } from "../host.ts";
let sink: unknown;
const toString = Object.prototype.toString;
const payloads: unknown[] = JSON.parse('["Hello, world!","{\\"ok\\":true}",42,"x"]');
function isText(payload: unknown): boolean { return toString.call(payload) === "[object String]"; }
const tests = [isText];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + (tests[0]!(payloads[i & 3]) ? 1 : 0)) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
