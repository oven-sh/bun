import { nextTurns } from "../host.ts";
let sink;
function pair(i) { return [i, i + 1]; }
function viaPair(i) { return pair(i); }
function readsPair(i) { const [a, b] = viaPair(i); return (a + b) | 0; }
const callers = [readsPair];
function bench(n) {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + callers[0](i)) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
