import { nextTurns } from "../host.ts";
let sink;
function unusedField(i, n) { let sum = 0; for (let k = 0; k < (n | 0); k++) sum += k * i; const p = { x: i, sum }; return p.x; }
const callers = [unusedField];
function bench(n) {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + callers[0](i, 16)) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
