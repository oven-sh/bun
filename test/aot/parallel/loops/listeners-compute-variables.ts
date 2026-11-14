// Listeners that a loop copies in compute variables of the file from themselves: the version of the loop carries the variables.
class Emitter { private readonly listeners: ((x: number) => void)[] = []; on(f: (x: number) => void): void { this.listeners.push(f); } emit(x: number): void { for (const f of this.listeners) f(x); } }
const emitter = new Emitter();
let seen = 0;
emitter.on(x => { seen += x; }); emitter.on(x => { seen ^= x; });
function run(turns: number): number { let n = 0; for (let k = 0; k < turns; k++) { emitter.emit(k & 7); n += seen & 3; } return n; }
let big = 2147483600; const sums: ((x: number) => void)[] = [];
sums.push(x => { big += x; }, x => { big = big * 2 - x; });
function grow(turns: number): string { let s = ""; for (let k = 0; k < turns; k++) { for (const f of sums) f(k & 7); if (k % 5 === 4) { s += big + " "; big = k; } } return s; }
let mixed: any = 1; const parts: ((x: number) => void)[] = [];
parts.push(x => { mixed += x; }, x => { mixed |= x; });
function mix(turns: number): void { for (let k = 0; k < turns; k++) for (const f of parts) f(k); }
let left = 0; const thrown: ((x: number) => void)[] = [];
thrown.push(x => { left += x; }, x => { if (x === 6) throw new Error("left"); left -= 1; });
function leave(turns: number): void { for (let k = 0; k < turns; k++) for (const f of thrown) f(k); }
let added = 0; const more: ((x: number) => void)[] = [];
more.push(x => { added += x; if (x === 2) more.push(y => { added += 10 * y; }); });
function add(turns: number): void { for (let k = 0; k < turns; k++) for (const f of more) f(k); }
console.log(run(0), seen, run(1), seen, run(20), seen);
seen = 2147483647; console.log(run(9), seen); seen = NaN; console.log(run(3), seen); seen = 0.5; console.log(run(4), seen); seen = -0; console.log(run(1), Object.is(seen, -0), run(3), seen);
console.log(grow(12), big, grow(40), big); big = NaN; console.log(grow(4), big); big = -0; console.log(grow(1), Object.is(big, -0), big);
mix(6); console.log(mixed); mixed = "s"; mix(3); console.log(mixed); mixed = { valueOf() { seen += 100; return 3; } }; mix(2); console.log(mixed, seen);
try { leave(10); } catch (e) { console.log((e as Error).message, left); } left = 5; leave(4); console.log(left);
add(6); console.log(added); add(4); console.log(added);
