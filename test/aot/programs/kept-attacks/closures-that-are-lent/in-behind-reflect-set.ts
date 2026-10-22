// Closures that are lent: in behind reflect set. It prints what plain Bun prints.
interface Part { count: number; action: () => number; }
function fresh(): Part { return { count: 1, action: () => 3 }; }
function has(p: Part): boolean { return "action" in p; }
function own(p: Part): boolean { return Object.hasOwn(p, "action"); }
function call(p: Part): number { return p.action(); }
function keys(p: Part): string { return Object.keys(p).join(); }
let sum = 0;
for (let i = 0; i < 2000; i++) { const p = fresh(); sum += call(p) + (has(p) ? 1 : 0) + (own(p) ? 1 : 0); }
const p = fresh();
Reflect.set(p, "action", 5);
console.log(sum, has(p), own(p), keys(p), typeof p.action, JSON.stringify(p), { ...p }.action, Object.entries(p).length);
const q = fresh();
Object.defineProperty(q, "action", { value: "text", enumerable: true, writable: true, configurable: true });
console.log(has(q), own(q), keys(q), typeof q.action, JSON.stringify(q));
const r = fresh();
delete (r as Partial<Part>).action;
console.log(has(r), own(r), keys(r), typeof r.action, JSON.stringify(r));
