// What new.target holds as its prototype is exchanged between two constructions, is no object, is a proxy whose traps are written down; new.target itself is a proxy, revoked or throwing; prototypes are linked anew.
const lines = [];
const chain = o => { const names = []; for (let p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) names.push(Object.hasOwn(p, "constructor") && typeof p.constructor === "function" ? p.constructor.name : "?"); return names.join("<"); };
const say = (what, made) => lines.push(what + ": " + (made === null || typeof made !== "object" ? String(made) : chain(made) + " | " + Reflect.ownKeys(made).map(String).join() + " | " + JSON.stringify(made)));
const attempt = (what, f) => { try { say(what, f()); } catch (error) { lines.push(what + ": " + error.constructor.name + ": " + error.message); } };
const again = (turns, f) => { let made; for (let i = 0; i < turns; i++) made = f(i); return made; };
class Base { a = 1; n = 0.5; constructor(x) { this.x = x; } }
class Below extends Base { d = "d"; }
function Target() { }
const construct = (callee, target, turns = 40) => again(turns, i => Reflect.construct(callee, [i], target));
const one = { tag: "one" }, two = Object.create(Below.prototype, { tag: { value: "two", enumerable: true } });
for (const callee of [Base, Below]) {
  Target.prototype = one; attempt(callee.name + " one", () => construct(callee, Target)); lines.push(String(Object.getPrototypeOf(construct(callee, Target)) === one));
  Target.prototype = two; attempt(callee.name + " two", () => construct(callee, Target)); lines.push(String(Object.getPrototypeOf(construct(callee, Target)) === two));
  Target.prototype = Below.prototype; attempt(callee.name + " the prototype of Below", () => construct(callee, Target));
  Target.prototype = Base.prototype; attempt(callee.name + " the prototype of Base", () => construct(callee, Target));
  for (const value of [null, undefined, 0, 7, "text", true, Symbol.iterator, 10n]) { Target.prototype = value; attempt(callee.name + " " + String(value), () => construct(callee, Target)); lines.push(String(Object.getPrototypeOf(construct(callee, Target, 2)) === Object.prototype)); }
  const log = [];
  Target.prototype = new Proxy(Below.prototype, { get(t, k, r) { log.push("get " + String(k)); return Reflect.get(t, k, r); }, set(t, k, v, r) { log.push("set " + String(k)); return Reflect.set(t, k, v, r); }, defineProperty(t, k, d) { log.push("define " + String(k)); return Reflect.defineProperty(t, k, d); }, has(t, k) { log.push("has " + String(k)); return Reflect.has(t, k); }, getPrototypeOf(t) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(t); } });
  const made = construct(callee, Target, 3);
  lines.push(callee.name + " proxy as prototype: " + Reflect.ownKeys(made).join() + " | " + log.join() + " | " + (made instanceof Base));
  let reads = 0;
  const watched = new Proxy(Below, { get(t, k, r) { if (k === "prototype") reads++; return Reflect.get(t, k, r); } });
  attempt(callee.name + " proxy as new.target", () => construct(callee, watched, 5)); lines.push("prototype read " + reads);
  const revoked = Proxy.revocable(Below, {}); revoked.revoke();
  attempt(callee.name + " revoked", () => construct(callee, revoked.proxy, 1));
  const throwing = new Proxy(Below, { get(t, k, r) { if (k === "prototype") throw new RangeError("no prototype"); return Reflect.get(t, k, r); } });
  attempt(callee.name + " throwing", () => construct(callee, throwing, 1));
}
for (let i = 0; i < 200; i++) { Target.prototype = i & 1 ? one : i & 2 ? two : Below.prototype; const made = Reflect.construct(i % 3 ? Base : Below, [i], Target); if (Object.getPrototypeOf(made) !== Target.prototype) lines.push("another prototype at " + i); }
Object.setPrototypeOf(Below.prototype, one);
attempt("Below above one", () => again(40, i => new Below(i)));
Object.setPrototypeOf(Below.prototype, null);
attempt("Below above nothing", () => again(40, i => new Below(i)));
Object.setPrototypeOf(Below, function () { return { other: 1 }; });
attempt("Below with another parent", () => again(40, i => new Below(i)));
console.log(lines.join("\n"));
