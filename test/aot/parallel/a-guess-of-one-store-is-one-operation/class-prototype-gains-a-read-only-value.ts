// Object.defineProperty(Crate.prototype, "label", { value, writable: false }): a store below it throws in strict code
// The subject is entered by value, from code that the build has not seen: so it has a body of its own, which is not copied into the body of the module.
const call = new Function("f", "a", "b", "return f(a, b)") as (f: Function, a?: unknown, b?: unknown) => any;
function attempt(f: Function, a?: unknown, b?: unknown) { try { call(f, a, b); return "stored"; } catch (e) { return (e as Error).constructor.name; } }

class Crate { weight: number; declare label?: string; constructor(w: number) { this.weight = w; } }
function setLabel(c: Crate, v: string) { c.label = v; }
const seed = new Crate(0); seed.label = "seed";
const early = new Crate(1), late = new Crate(2);
console.log(attempt(setLabel, early, "a"));
Object.defineProperty(Crate.prototype, "label", { value: "fixed", writable: false, configurable: true });
for (let i = 0; i < 3; i++) console.log(attempt(setLabel, late, "b" + i), Object.keys(late).join(), String(late.label), attempt(setLabel, early, "c" + i), String(early.label));
