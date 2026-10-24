// Functions that were given a property, lost one again, or got another prototype are still recognized and called correctly at call sites that predict them.
declare const console: any;
interface Handler { run(x: number): number; name2?: string }
function makeAdder(k: number): (x: number) => number { return (x: number): number => x + k; }
function makeHandler(k: number): Handler { return { run: (x: number): number => x * k }; }
function callMany(f: (x: number) => number, n: number): number { let s = 0; for (let i = 0; i < n; i++) s += f(i); return s; }
function runMany(h: Handler, n: number): number { let s = 0; for (let i = 0; i < n; i++) s += h.run(i); return s; }
const out: string[] = [];
// As it was made.
const plain = makeAdder(1);
out.push("as made: " + callMany(plain, 1000));
// Given a property, then called at the same site.
const named: any = makeAdder(2); named.displayName = "two";
out.push("given a property: " + callMany(named, 1000) + " " + named.displayName);
// Given a property between two calls.
const later: any = makeAdder(3);
const before = callMany(later, 500); later.extra = { v: 1 }; later.more = 2;
out.push("given properties between: " + before + " " + callMany(later, 500) + " " + Object.keys(later).join(","));
// A property that is deleted again: the original Structure does not come back.
const back: any = makeAdder(4); back.p = 1; delete back.p;
out.push("given and taken: " + callMany(back, 1000) + " " + Object.keys(back).length);
// Its prototype changed; frozen; `name` and `length` redefined.
const reparented: any = makeAdder(5); Object.setPrototypeOf(reparented, { inherited: 7 });
out.push("another prototype: " + callMany(reparented, 1000) + " " + reparented.inherited + " " + (typeof reparented.call));
const frozen = Object.freeze(makeAdder(6));
out.push("frozen: " + callMany(frozen, 1000) + " " + Object.isFrozen(frozen));
const renamed: any = makeAdder(7); Object.defineProperty(renamed, "name", { value: "renamed" }); Object.defineProperty(renamed, "length", { value: 9 });
out.push("renamed: " + callMany(renamed, 1000) + " " + renamed.name + " " + renamed.length);
// In a field that is expected to hold one function.
const h1 = makeHandler(2), h2 = makeHandler(3); (h2.run as any).tag = "t";
out.push("in a field: " + runMany(h1, 1000) + " " + runMany(h2, 1000) + " " + (h2.run as any).tag);
// Mixed in one loop.
const mixed = [plain, named, later, back, reparented, frozen, renamed];
let sum = 0; for (let r = 0; r < 300; r++) for (const f of mixed) sum += f(r);
out.push("mixed: " + sum);
// Another function of the same shape at the site; a value that is not a function.
out.push("another function: " + callMany((x: number): number => x - 1, 1000));
try { callMany({ call: 1 } as any, 1); } catch (e: any) { out.push("no function: " + e.constructor.name); }
try { callMany(undefined as any, 1); } catch (e: any) { out.push("undefined: " + e.constructor.name); }
// Async functions and generators have their own Structures.
function makeAsync(k: number): (x: number) => Promise<number> { return async (x: number): Promise<number> => x + k; }
function makeGenerator(k: number): (x: number) => Generator<number> { return function* (x: number): Generator<number> { yield x + k; }; }
const a1 = makeAsync(1), a2: any = makeAsync(2); a2.p = 1;
const g1 = makeGenerator(1), g2: any = makeGenerator(2); g2.p = 1;
let gs = 0; for (let i = 0; i < 300; i++) { gs += g1(i).next().value + g2(i).next().value; }
out.push("generators: " + gs);
// Classes that are evaluated more than once, constructed through a value.
function makeClass(k: number) { return class Made { v: number; constructor(x: number) { this.v = x + k; } get twice(): number { return this.v * 2; } static tag = k; }; }
function construct(C: new (x: number) => { v: number; twice: number }, n: number): number { let s = 0; for (let i = 0; i < n; i++) s += new C(i).twice; return s; }
const C1 = makeClass(1), C2: any = makeClass(2); C2.added = "a";
out.push("classes: " + construct(C1, 1000) + " " + construct(C2, 1000) + " " + C1.tag + " " + C2.tag + " " + C2.added + " " + (new C1(0) instanceof C1) + " " + (new C2(0) instanceof C1));
Promise.all([a1(1), a2(1)]).then(r => { out.push("async: " + r.join(",")); for (const line of out) console.log(line); });
export {};
