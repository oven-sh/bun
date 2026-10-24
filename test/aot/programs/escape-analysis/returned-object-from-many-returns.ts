// A function returns a fresh one-field object from many `return` statements, also after `??`, `||` and `&&`; it is called directly and as a value, and the result is kept, tested and read.
declare const console: { log(...v: unknown[]): void };
type Result = { done: boolean };
type Cmd = { id: number, mode: string, text: string };
class Queue {
    items: Cmd[] = [];
    peek(f: (c: Cmd) => boolean): Cmd | undefined { for (const c of this.items) if (f(c)) return c; return undefined; }
}
type Params = { queue: Queue, run: (c: Cmd[]) => void, waits?: (c: Cmd) => boolean, stale?: number };
let busy: number | undefined = undefined;
let ran: string[] = [];
function pending(): number | undefined { return busy; }
function first(q: Queue): Cmd | undefined { return q.items.length ? q.items[0] : undefined; }
function a(c: Cmd): boolean { return c.id > 1; }
function b(id: number): boolean { return (id & 1) === 1; }
function slash(c: Cmd): boolean { return c.text.charCodeAt(0) === 47; }
function alone(q: Queue, c: Cmd, run: (c: Cmd[]) => void): void { q.items = q.items.filter(x => x !== c); run([c]); }
function all(q: Queue, mode: string, run: (c: Cmd[]) => void): number { const same = q.items.filter(x => x.mode === mode); q.items = q.items.filter(x => x.mode !== mode); run(same); return same.length; }
export function step({ queue, run, waits = () => true, stale }: Params): Result {
    if (pending() !== undefined) {
        const own = queue.peek(c => a(c) && b(c.id));
        const head = own ?? first(queue);
        if (!head || (own === undefined && waits(head))) { return { done: false } }
        alone(queue, head, run);
        return { done: true }
    }
    const next = first(queue);
    if (!next) { return { done: false } }
    if (slash(next) || next.mode === "x") { alone(queue, next, run); return { done: true } }
    if (stale !== undefined && next.id < stale) { queue.items.shift(); return { done: queue.items.length > 0 } }
    if (next.mode === "y" && !waits(next)) { return { done: all(queue, "y", run) > 1 } }
    if (next.text.length > 6) { alone(queue, next, run); return { done: false } }
    if (next.mode === "z") { return { done: true } }
    all(queue, next.mode, run);
    return { done: true }
}
const make = (seed: number): Queue => { const q = new Queue(); for (let i = 0; i < 6; i++) { const k = seed * 7 + i * 3; q.items.push({ id: k % 5, mode: "wxyz"[k & 3], text: (k % 3 ? "" : "/") + "t".repeat(k % 9) }); } return q; };
const run = (c: Cmd[]): void => { ran.push(c.map(x => x.id + x.mode).join("")); };
(globalThis as any).kept = [step];
// A value from untyped code also gets the type Result, which opens the type at that position: any object can have it.
const stranger: Result = (globalThis as any).given ?? { done: true };
const strangers: Result[] = [stranger];
const byValue: ((p: Params) => Result)[] = [step];
let out = "";
for (let seed = 0; seed < 24; seed++) {
    const q = make(seed); busy = seed & 4 ? seed : undefined;
    for (let i = 0; i < 8; i++) {
        const p: Params = { queue: q, run, waits: seed & 1 ? c => c.id > 2 : undefined, stale: seed & 2 ? 2 : undefined };
        if (step(p).done) out += "1"; else out += "0";               // read
        const kept = step(p); out += kept.done ? "a" : "b"; (globalThis as any).last = kept;   // kept
        out += byValue[0](p).done ? "A" : "B";                      // by value
        const { done } = step(p); if (!done && !q.items.length) break;
    }
    out += ".";
}
console.log(out); console.log(ran.join()); console.log(strangers.map(r => r.done).join()); console.log(JSON.stringify((globalThis as any).last));
