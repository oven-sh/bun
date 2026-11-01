import { nextTurns } from "../host.ts";
let sink: unknown;
const answers: unknown[] = [new Response("a"), { status: 200 }, new Response("b"), "text"];
function isResponse(value: unknown): boolean { return value instanceof Response; }
const tests = [isResponse];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + (tests[0]!(answers[i & 3]) ? 1 : 0)) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
