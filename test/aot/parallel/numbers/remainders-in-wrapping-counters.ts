// Counters that wrap at a constant and at a length: of variables of a module, captured variables, fields, and elements.
let at = 0, seed = 42;
const ring = [1, 2, 3, 4, 5, 6, 7];
function step(by: number): number { at = (at + by) % 7; at = (at - 1 + 7) % 7; return ring[at]!; }
function lehmer(): number { seed = (seed * 16807) % 2147483647; return seed; }
function makeWrap(n: number): (by: number) => number { let p = n; return by => (p = (p + by) % 11); }
class Ring { head = 0; size = 0; readonly slots: number[] = new Array(5).fill(0); push(v: number): void { this.slots[(this.head + this.size) % this.slots.length] = v; if (this.size < this.slots.length) this.size++; else this.head = (this.head + 1) % this.slots.length; } sum(): number { let s = 0; for (let i = 0; i < this.size; i++) s = s * 10 + this.slots[(this.head + i) % this.slots.length]!; return s; } }
const show = (x: number): string => (Object.is(x, -0) ? "-0" : String(x));
for (const by of [0, 1, 3, 6, 7, 8, -1, -7, -13, 0.5, NaN, 1e300, 4294967296]) { at = 0; const wrap = makeWrap(by), text: string[] = []; for (let i = 0; i < 5; i++) text.push(show(step(by)), show(at), show(wrap(by))); console.log(by, text.join(" ")); }
let total = 0; for (let i = 0; i < 1000; i++) total = (total + lehmer()) % 1000003; console.log(total, seed);
for (const s of [0, -0, 1, -42, 2147483647, 9007199254740991, Infinity]) { seed = s; console.log(show(lehmer()), show(lehmer()), show(-s % 10), show(Math.floor(s) % 1000), show(Math.round(-s) % 16)); }
const r = new Ring(); for (let i = 1; i < 13; i++) { r.push(i % 10); console.log(r.sum(), r.head, r.size); }
export {};
