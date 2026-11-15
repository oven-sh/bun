// Static fields that are assigned behind their class, with reads of methods, absent names and unknown keys between.
class Arg {
  constructor(kind) { this.kind = kind; }
  static code(kind) { switch (kind) { case Arg.Use: return 1; case Arg.Def: return 2; case Arg.Never: return 3; default: return 4; } }
  static bump(by) { Arg.count += by; return this.count; }
}
console.log("early", Arg.Use, "Use" in Arg, Object.keys(Arg).join());
Arg.Use = Symbol("Use");
Arg.Def = Symbol("Def");
Arg.count = 0;
if (process.argv.length > 99) Arg.debug = true;
globalThis.holder = [Arg];
const show = () => console.log([Arg.Use, Arg.Def, Arg.count, Arg.debug, Arg.late].map(String).join(), Object.keys(Arg).join(), Reflect.ownKeys(Arg).map(String).join());
const run = n => { let sum = 0; for (let i = 0; i < n; i++) { sum += Arg.code(i & 1 ? Arg.Use : Arg.Def) + Arg.bump(1); if (Arg.debug) sum += 1000; } return sum; };
const ask = (K, key) => String(K[key]);
console.log(run(5), ask(Arg, "count"), run(20), ask(Arg, "Never"));
show();
class Heir extends Arg { static own = 5; }
console.log(String(Heir.Use), Heir.count, Heir.own, "Def" in Heir, Object.hasOwn(Heir, "Def"), Heir.bump(2), Arg.count);
Heir.count = 50;
console.log(Heir.bump(1), Arg.count, Object.keys(Heir).join());
Arg.late = "late";
show();
Object.defineProperty(Arg, "Def", { get() { return this.late; }, configurable: true });
console.log(run(5), Arg.Def);
delete Arg.Use;
console.log(run(5), Arg.Use, "Use" in Arg);
Function.prototype.Use = "above";
console.log(Arg.Use, Arg.code("above"), run(3));
delete Function.prototype.Use;
Object.freeze(Arg);
Arg.count = -1;
let refused = "";
try { run(4); } catch (error) { refused = error.constructor.name; }
console.log(Arg.count, Object.isFrozen(Arg), refused);
show();
