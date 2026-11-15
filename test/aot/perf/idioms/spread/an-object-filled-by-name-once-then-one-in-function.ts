import { nextTurns } from "../host.ts";
let sink: unknown;
interface Defaults { a: number; b: number; c: number }
// An ordinary object that is given its names once, as the defaults of a module are, and is then copied again and again with one more name.
const defaults: Defaults = Object.create(Object.prototype);
defaults.a = 1; defaults.b = 2; defaults.c = 3;
function withExtra(extra: number) { return { ...defaults, extra }; }
const makers = [withExtra];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) { const made = makers[0]!(i & 7); s = (s + made.a + made.c + made.extra) | 0; }
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
