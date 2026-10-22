// The member captures the object it lies in, is stored behind the literal, and is only called: the closure is made on demand. Then something else than a function is put under the name.
interface Part { count: number; action?: () => number; }
function fresh(n: number): Part { const part: Part = { count: n }; part.action = () => part.count + 2; return part; }
function has(p: Part): boolean { return "action" in p; }
function own(p: Part): boolean { return Object.hasOwn(p, "action"); }
function call(p: Part): number { return p.action!(); }
function keys(p: Part): string { return Object.keys(p).join(); }
function kind(p: Part): string { return typeof p.action; }
function read(p: Part): unknown { return p.action; }
let sum = 0;
for (let i = 0; i < 2000; i++) { const p = fresh(i & 3); sum += call(p) + (has(p) ? 1 : 0) + (own(p) ? 1 : 0); }
const p = fresh(1);
Reflect.set(p, "action", 5);
console.log(sum, has(p), own(p), keys(p), kind(p), read(p), JSON.stringify(p), { ...p }.action, Object.entries(p).length);
const q = fresh(1);
Object.defineProperty(q, "action", { value: "text", enumerable: true, writable: true, configurable: true });
console.log(has(q), own(q), keys(q), kind(q), read(q), JSON.stringify(q));
const r = fresh(1);
delete r.action;
console.log(has(r), own(r), keys(r), kind(r), read(r), JSON.stringify(r));
const s = fresh(1);
Reflect.set(s, "action", undefined);
console.log(has(s), own(s), keys(s), kind(s), read(s), JSON.stringify(s));
