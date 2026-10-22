import { nextTurns } from "../host.ts";
let sink;
function bench(holders, n) {
    let s = 0;
    for (let i = 0; i < n; i++) {
        const holder = holders[i & 0];
        holder.count = i;
        s += holder.count & 1;
    }
    return s;
}
globalThis.count = 0;
const A0 = [globalThis, { count: 0 }];
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(A0, n);
console.log(check, typeof sink);
