import { nextTurns } from "../host.ts";
let sink: unknown;
interface Point { x: number; label: string }
function make(i: number): Point { const label = "p" + i + ":" + (i + 1); return { x: i, label }; }
function onlyX(i: number): number { return make(i).x; }
const callers = [onlyX];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + callers[0]!(i)) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
