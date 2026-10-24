// Captured variables that are never assigned after a closure could have seen them can be copied into the closure.
function call<T>(f: () => T): T { return f(); }
function parameter(a: number, b: string) { return call(() => a + b.length); }
function withDefault(a: number, depth = 3) { return call(() => a * depth); }
function constant(a: number) { const k = a + 1; return call(() => k * 2); }
function unassignedLet(a: number) { let k = a + 1; return call(() => k * 3); }
function nested(a: number) { return call(() => call(() => call(() => a + 1))); }
function caught() { try { throw new Error("x"); } catch (e) { return call(() => (e as Error).message); } }
function forOf(list: number[]) { const fs: (() => number)[] = []; for (const x of list) fs.push(() => x * 2); return fs.map(f => f()).join(); }
function forIn(o: Record<string, number>) { const fs: (() => string)[] = []; for (const k in o) fs.push(() => k); return fs.map(f => f()).join(); }
function forLet() { const fs: (() => number)[] = []; for (let i = 0; i < 3; i++) fs.push(() => i); return fs.map(f => f()).join(); }
function direct(a: number, b: number) { return inner(1) + inner(2); function inner(c: number) { return a * c + b; } }
function mutual(n: number, step: number): number { return even(n); function even(k: number): number { return k <= 0 ? 0 : odd(k - step) + 1; } function odd(k: number): number { return k <= 0 ? 0 : even(k - step) + 1; } }
function constArrow(a: number) { const twice = (x: number) => x * a; const use = () => twice(2) + twice(3); return use(); }
class Holder { constructor(public v: number) {} get() { return call(() => this.v + 1); } nested() { return call(() => call(() => this.v + 2)); } }
function args(..._: number[]) { return (function (this: unknown, _a: number, _b: number) { return call(() => arguments.length); })(1, 2); }
console.log(parameter(1, "ab"), withDefault(2), withDefault(2, 5), constant(1), unassignedLet(1), nested(1), caught());
console.log(forOf([1, 2, 3]), forIn({ a: 1, b: 2 }), forLet(), direct(2, 3), mutual(5, 1), constArrow(4));
console.log(new Holder(1).get(), new Holder(1).nested(), args());
