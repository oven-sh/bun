const seen = new Set<unknown>();
let before: unknown;
let same = 0;
function note(f: (x: number) => number, x: number): number { if (f === before) same++; before = f; seen.add(f); return f(x); }
function run(k: number): number { return note(x => x + k, k); }
function more(k: number): number { return note(x => x * k, k); }
let sum = 0;
for (let i = 0; i < 100; i++) sum += run(i) + more(i);
console.log(sum, seen.size, same);
