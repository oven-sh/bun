import { nextTurns } from "../host.ts";
let sink;
let closed = 0;
function open(name, depth) { return { name, depth, [Symbol.dispose]() { closed += this.depth; } }; }
const makers = [open];
function bench(n) {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + makers[0]("a", i).depth) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
