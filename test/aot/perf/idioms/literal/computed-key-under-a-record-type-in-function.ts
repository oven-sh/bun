import { nextTurns } from "../host.ts";
let sink: unknown;
interface Named { id: number; label: string; [key: string]: unknown }
function namedBehindKey(key: string, id: number): Named { return { id, [key]: id, label: "z" }; }
const names = ["a", "b", "c", "d"]; const makers = [namedBehindKey];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + makers[0]!(names[i & 3]!, i).id) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
