import { nextTurns } from "../host.ts";
let sink: any;
// A constructor asks its options for names that one literal of the program has, and is handed another literal of the program. Behind that it stores its fields.
function State(this: any, options: any) {
    this.flags = 1;
    if (options && options.objectMode) this.flags |= 2;
    if (options && options.emitClose === false) this.flags |= 4;
    this.mark = options ? 16 : 64;
    this.buffer = null;
    this.index = 0;
    this.length = 0;
    this.pipes = null;
}
State.prototype = {};
Object.defineProperty(State.prototype, "isObjectMode", { get(this: any) { return (this.flags & 2) !== 0; }, enumerable: false });
const usual: any = { objectMode: true, emitClose: false, autoDestroy: true };
const handed: any = process.env.AOT_PERF_NAMES ? usual : { read() {} };
const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0];
function bench(n: number) {
    let s = 0;
    for (let i = 0; i < n; i++) {
        const made = new (State as any)(handed);
        kept[i & 7] = made;
        s += made.mark;
    }
    return s;
}
sink = new (State as any)(usual);
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check, typeof sink);
