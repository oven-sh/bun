// `#name in value` in loops over instances, subclasses, literals, lists, functions, proxies, stamped objects and primitives.
const lines: string[] = [];
const say = (name: string, value: unknown) => { lines.push(name + " " + String(value)); };
const attempt = (read: () => unknown) => { try { return read(); } catch (error) { return (error as Error).constructor.name + ": " + (error as Error).message; } };
class Base { #p = 1; #m() { return 2; } get #g() { return 3; } static #s = 4; static #t() { return 5; }
  static has(o: any) { return #p in o; } static hasMethod(o: any) { return #m in o; } static hasGetter(o: any) { return #g in o; } static hasStatic(o: any) { return #s in o; } static hasStaticMethod(o: any) { return #t in o; }
  static read(o: any) { return #p in o ? o.#p : -1; }
  static count(list: any[]) { let r = 0; for (const o of list) if (#p in o) r += o.#p; else r += 100; return r; }
  static both(list: any[]) { let r = ""; for (let i = 0; i < list.length; i++) { const o = list[i]; if (!(#p in o)) { r += "n"; continue; } o.#p += 1; r += o.#p + (#m in o ? "m" : "x"); } return r; }
  static late(list: any[]) { let n = 0; for (let i = list.length; i--;) n = n * 2 + (#p in list[i] ? 1 : 0); return n; }
}
class Below extends Base { own = 1; }
class FarBelow extends Below { other = "x"; }
class Other { p = 1; }
class Returns { constructor(o: any) { return o; } }
class Stamper extends Returns { #q: any = 7; static has(o: any) { return #q in o; } static sum(list: any[]) { let r = 0; for (const o of list) r += #q in o ? 1 : 10; return r; } }
class Late { #first: any; static inside: any[] = []; #second = Late.look(this); #third = 3;
  static look(o: any) { let r = ""; for (let i = 0; i < 2; i++) r += (#first in o) + "," + (#second in o) + "," + (#third in o) + ";"; Late.inside.push(r); return 2; } }
function classes() { return class Made { #p = 1; static has(o: any) { return #p in o; } static count(list: any[]) { let r = 0; for (const o of list) r += #p in o ? 1 : 0; return r; } }; }
const One = classes(), Two = classes();
const base = new Base(), below = new Below(), far = new FarBelow();
const deleted: any = { a: 1 }; delete deleted.a;
const grown: any = {}; for (let i = 0; i < 40; i++) grown["k" + i] = i;
const frozen = Object.freeze({ p: 1 });
const reflected = Reflect.construct(Base, [], Other), reflectedArray = Reflect.construct(Base, [], Array), nullProto: any = Object.setPrototypeOf(new Base(), null);
const extended: any = new Base(); extended.more = 1; extended[5] = 5;
const values: any[] = [base, below, far, {}, { p: 1 }, new Other(), [], [1, 2], () => 1, Base, Object.create(base), Object.create(null), new Proxy(base, {}), new Map(), /x/, new Date(0), deleted, grown, frozen, reflected, reflectedArray, nullProto, extended, globalThis, new Error("e"), Symbol.prototype, new String("s")];
for (let turn = 0; turn < 3; turn++) {
  for (const [name, list] of [["all", values], ["instances", [base, below, far, base]], ["bases", [base, new Base()]], ["none", [{}, { p: 1 }, new Other()]], ["mixed", [base, {}, below, []]]] as [string, any[]][]) {
    say(name + " count", attempt(() => Base.count(list)));
    say(name + " both", attempt(() => Base.both(list)));
    say(name + " late", attempt(() => Base.late(list)));
    let each = ""; for (const o of list) each += [Base.has(o), Base.hasMethod(o), Base.hasGetter(o), Base.hasStatic(o), Base.hasStaticMethod(o), Stamper.has(o), One.has(o)].map(Number).join("") + " ";
    say(name + " each", each);
  }
  for (const bad of [1, "s", null, undefined, true, 5n, Symbol("y")]) { say("bad " + typeof bad, attempt(() => Base.count([base, bad, {}]))); say("bad read", attempt(() => Base.read(bad))); }
  const stamped: any[] = [{}, { a: 1 }, [], () => 1, new Other(), new Base(), Object.freeze({})];
  say("stamped before", attempt(() => Stamper.sum(stamped)));
  for (const o of stamped) say("stamp", attempt(() => { new Stamper(o); return "fine"; }));
  say("stamped after", attempt(() => Stamper.sum(stamped)) + " " + stamped.map(o => Stamper.has(o)));
  say("stamped bases", attempt(() => Base.count(stamped)));
  say("stamp again", attempt(() => new Stamper(stamped[0])));
  new Late(); say("late", Late.inside.join("|")); Late.inside.length = 0;
  const ones: any[] = [new One(), new Two(), new One(), {}]; say("classes", One.count(ones) + " " + Two.count(ones) + " " + ones.map(o => One.has(o)) + " " + ones.map(o => Two.has(o)));
}
for (const line of lines) console.log(line);
