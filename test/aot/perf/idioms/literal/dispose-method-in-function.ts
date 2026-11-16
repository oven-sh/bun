import { nextTurns } from "../host.ts";
let sink: unknown;
interface Span { name: string; depth: number; [Symbol.dispose](): void }
let closed = 0;
function open(name: string, depth: number): Span { return { name, depth, [Symbol.dispose]() { closed += this.depth; } }; }
const makers = [open];
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + makers[0]!("a", i).depth) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
