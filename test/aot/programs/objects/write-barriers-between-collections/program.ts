declare const console: { log(...v: unknown[]): void };
const young: () => void = (globalThis as any).edenGC ?? (() => {});
const full: () => void = (globalThis as any).fullGC ?? (() => {});
class P { constructor(public n: number, public next: P | null) {} }
function chain(n: number): P { let p = new P(n, null); for (let i = 0; i < 40; i++) p = new P(n + i, p); return p; }
function sum(p: P | null): number { let s = 0; while (p) { s += p.n; p = p.next; } return s; }
let filler: P[] = [];
// What a collection of the young has freed is taken again at once, with other numbers in it.
function refill(): void { filler = []; for (let i = 0; i < 400; i++) filler.push(chain(1000000 + i)); }
function later(n: number): Promise<number> { return new Promise(resolve => { Promise.resolve().then(() => { young(); refill(); resolve(n); }); }); }
// ONE activation: its frame is old from the first round on (a full collection); every round stores four FRESH objects to it and is suspended; while it is, the young are collected.
async function kept(seed: number): Promise<number> {
  let total = await later(seed);
  full();
  for (let round = 0; round < 30; round++) {
    const a = chain(total & 7), b = chain(round), c = chain(round + 1), d = chain(round + 2);
    total += await later(round);
    total += sum(a) + sum(b) + sum(c) + sum(d);
  }
  return total;
}
function* yielded(seed: number): Generator<number, number, number> {
  let total = seed;
  total += yield -1;
  for (let round = 0; round < 30; round++) {
    const a = chain(total & 7), b = chain(round), c = chain(round + 1), d = chain(round + 2);
    total += yield round;
    total += sum(a) + sum(b) + sum(c) + sum(d);
  }
  return total;
}
const g = yielded(3); let r = g.next(0); full(); while (!r.done) { young(); refill(); r = g.next(1); }
console.log("yielded", r.value, filler.length);
kept(5).then(v => console.log("kept", v, filler.length));
