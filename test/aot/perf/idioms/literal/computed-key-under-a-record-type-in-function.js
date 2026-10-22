import { nextTurns } from "../host.ts";
let sink;
function namedBehindKey(key, id) { return { id, [key]: id, label: "z" }; }
const names = ["a", "b", "c", "d"]; const makers = [namedBehindKey];
function bench(n) {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + makers[0](names[i & 3], i).id) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
