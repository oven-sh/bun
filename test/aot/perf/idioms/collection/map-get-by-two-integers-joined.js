import { nextTurns } from "../host.ts";
let sink;
function getPair(m, a, b) { return m.get(a.id + "," + b.id); }
const m = new Map(); const ts = []; for (let k = 0; k < 4; k++) ts.push({ id: k * 37, name: "n" + k }); for (const a of ts) for (const b of ts) m.set(a.id + "," + b.id, a.id + b.id);
const getters = [getPair];
function bench(n) {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + getters[0](m, ts[i & 3], ts[(i >> 2) & 3])) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
