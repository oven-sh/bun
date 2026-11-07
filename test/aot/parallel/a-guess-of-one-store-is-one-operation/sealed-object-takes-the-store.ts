// Object.seal(o): a store into a property that is there goes through
// The subject is entered by value, from code that the build has not seen: so it has a body of its own, which is not copied into the body of the module.
const call = new Function("f", "a", "b", "return f(a, b)") as (f: Function, a?: unknown, b?: unknown) => any;
function attempt(f: Function, a?: unknown, b?: unknown) { try { call(f, a, b); return "stored"; } catch (e) { return (e as Error).constructor.name; } }

class Crate { weight: number; owner: unknown; constructor(w: number) { this.weight = w; this.owner = "nobody"; } }
function setOwner(c: Crate, v: unknown) { c.owner = v; }
const sealed = new Crate(2);
console.log(attempt(setOwner, sealed, "a"));
Object.seal(sealed);
for (let i = 0; i < 3; i++) console.log(attempt(setOwner, sealed, "d" + i), String(sealed.owner), Object.isSealed(sealed));
