// Object.defineProperty(o, "owner", { writable: false }): the field leaves its slot, and the store throws in strict code
// The subject is entered by value, from code that the build has not seen: so it has a body of its own, which is not copied into the body of the module.
const call = new Function("f", "a", "b", "return f(a, b)") as (f: Function, a?: unknown, b?: unknown) => any;
function attempt(f: Function, a?: unknown, b?: unknown) { try { call(f, a, b); return "stored"; } catch (e) { return (e as Error).constructor.name; } }

class Crate { weight: number; owner: unknown; constructor(w: number) { this.weight = w; this.owner = "nobody"; } }
function setOwner(c: Crate, v: unknown) { c.owner = v; }
const plain = new Crate(1), fixed = new Crate(2);
console.log(attempt(setOwner, plain, "a"), attempt(setOwner, fixed, "b"));
Object.defineProperty(fixed, "owner", { writable: false });
for (let i = 0; i < 3; i++) console.log(attempt(setOwner, fixed, "c" + i), String(fixed.owner), attempt(setOwner, plain, "d" + i), String(plain.owner));
