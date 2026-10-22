import { nextTurns } from "../host.ts";
let sink;
function bench(source, n) {
    let s = 0;
    for (let i = 0; i < n; i++) {
        let t = 0;
        const stepper = source.open();
        for (let r = stepper.step(); !r.finished; r = stepper.step()) t += r.item;
        s += t;
    }
    return s;
}
const A0 = { open() { let j = 0; return { step() { return j < 4 ? { finished: false, item: j++ } : { finished: true, item: 0 }; } }; } };
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(A0, n);
console.log(check, typeof sink);
