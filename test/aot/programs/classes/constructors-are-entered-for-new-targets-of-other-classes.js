// Four constructors are entered, by value and through Reflect.construct, for seven new.targets: the class itself, classes below and beside it, classes and a function that have nothing to do with it.
const lines = [];
const chain = o => { const names = []; for (let p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) names.push(Object.hasOwn(p, "constructor") && typeof p.constructor === "function" ? p.constructor.name : "?"); return names.join("<"); };
const say = (what, made) => lines.push(what + ": " + (made === null || typeof made !== "object" ? String(made) : chain(made) + " | " + Reflect.ownKeys(made).map(String).join() + " | " + JSON.stringify(made)));
const attempt = (what, f) => { try { say(what, f()); } catch (error) { lines.push(what + ": " + error.constructor.name + ": " + error.message); } };
const again = (turns, f) => { let made; for (let i = 0; i < turns; i++) made = f(i); return made; };
class Base { a = 1; b = 2.5; c; constructor(x) { this.x = x; } }
class Below extends Base { d = "d"; }
class Lower extends Below { e = [1]; constructor(x) { super(x); this.y = x + 1; } }
class Side extends Base { a = "again"; z = 0; }
class Stranger { s = 1; }
class StrangerBelow extends Stranger { t = 2; }
function Old() { this.o = 1; }
const byValue = (C, x) => new C(x);
const targets = [Base, Below, Lower, Side, Stranger, StrangerBelow, Old];
for (const round of [0, 1, 2]) for (const C of targets) attempt("new " + C.name + " " + round, () => again(40, i => byValue(C, i)));
for (const callee of [Base, Below, Lower, Side]) for (const target of targets) attempt(callee.name + " for " + target.name, () => again(40, i => Reflect.construct(callee, [i], target)));
for (let i = 0; i < 300; i++) { const callee = [Base, Below, Lower][i % 3], target = targets[(i * 5 + (i >> 3)) % targets.length]; const made = Reflect.construct(callee, [i], target); if (Object.getPrototypeOf(made) !== target.prototype) lines.push("another prototype at " + i); if (!(i % 37)) say("mixed " + i, made); }
console.log(lines.join("\n"));
