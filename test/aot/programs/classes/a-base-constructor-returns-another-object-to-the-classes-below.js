// A base constructor returns an object of its own choice, or what is no object, to classes below it, which lay their fields and private names on what they get.
const lines = [];
const chain = o => { const names = []; for (let p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) names.push(Object.hasOwn(p, "constructor") && typeof p.constructor === "function" ? p.constructor.name : "?"); return names.join("<"); };
const say = (what, made) => lines.push(what + ": " + (made === null || typeof made !== "object" ? String(made) : chain(made) + " | " + Reflect.ownKeys(made).map(String).join() + " | " + JSON.stringify(made)));
const attempt = (what, f) => { try { say(what, f()); } catch (error) { lines.push(what + ": " + error.constructor.name + ": " + error.message); } };
const again = (turns, f) => { let made; for (let i = 0; i < turns; i++) made = f(i); return made; };
const shared = { shared: true };
class Returns { a = 1; constructor(what) { this.x = 1; if (what === 1) return shared; if (what === 2) return [1, 2]; if (what === 3) return 5; if (what === 4) return function f() { }; if (what === 5) return new Map(); if (what === 6) return null; if (what === 7) return Object.create(null); } }
class Below extends Returns { b = 2; constructor(what) { super(what); this.y = 2; } }
class Lower extends Below { #p = 3; c = 3; read() { return this.#p; } static has(o) { return #p in o; } }
class ReturnsBelow extends Returns { constructor(what) { super(0); if (what === 1) return shared; if (what === 3) return 5; if (what === 8) return undefined; } }
const byValue = (C, x) => new C(x);
for (const C of [Returns, Below, Lower, ReturnsBelow]) for (let what = 0; what < 9; what++) {
  for (const key of Object.keys(shared)) if (key !== "shared") delete shared[key];
  attempt(C.name + " " + what, () => { const made = again(what === 1 && C === Lower ? 1 : 30, () => byValue(C, what)); return typeof made === "function" ? { isFunction: true, keys: Object.keys(made).join() } : made instanceof Map ? { isMap: true, keys: Object.keys(made).join() } : made; });
}
lines.push(String(Lower.has(byValue(Lower, 0))), String(Lower.has(byValue(Lower, 2))), String(Lower.has(byValue(Below, 0))), String(byValue(Lower, 0).read()));
function OldBase(what) { this.o = 1; if (what) return shared; }
class BelowOld extends OldBase { n = 1; }
attempt("below a function", () => again(30, () => byValue(BelowOld, 0)));
attempt("below a function that returns", () => again(1, () => byValue(BelowOld, 1)));
attempt("a function for a class", () => again(30, () => Reflect.construct(OldBase, [0], Below)));
attempt("a class for a function", () => again(30, () => Reflect.construct(Below, [0], OldBase)));
console.log(lines.join("\n"));
