import { nextTurns } from "../host.ts";
let sink;
function both(r, g, name) { return { ...r, name, g }; }
const sources = [{ a: 1, b: "x" }, JSON.parse('{"a":2,"b":"parsed"}'), JSON.parse('{"g":3,"name":"has both","z":1}'), JSON.parse('{"a":1,"b":2,"c":3,"d":4}')];
const doers = [both];
function bench(n) {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + doers[0](sources[i & 3], i, "z").g) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
