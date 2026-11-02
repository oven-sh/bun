import { nextTurns } from "../host.ts";
let sink: unknown;
function countsMissing(...args: unknown[]): number { let n = 0; for (let k = args.length + 1; k >= -1; k--) if (args[k] === undefined) n++; return n; }
const callers = [countsMissing];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + callers[0]!(i, 1, 2)) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
