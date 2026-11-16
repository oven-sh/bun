import { nextTurns } from "../host.ts";
type Listeners = Record<string | symbol, Function | undefined>;
function make(): Listeners { return { close: undefined, error: undefined, prefinish: undefined, finish: undefined, drain: undefined, data: undefined, end: undefined, readable: undefined }; }
let kept: Listeners = make();
const keys = ["close", "error", "data", "other"];
function listener() {}
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) { kept = make(); kept[keys[i & 3]!] = listener; s = (s + 1) | 0; }
    return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, Object.keys(kept).length);
