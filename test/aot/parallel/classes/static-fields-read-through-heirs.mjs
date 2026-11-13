// A static field of a class is read through its heirs: own values, accessors and other parents hide it.
class Base { static count = 0; static list = [1]; static make(n) { Base.count = n; return new this(n); } static bump() { Base.count += 1; return this.count; } constructor(n) { this.n = n; } }
class Middle extends Base { static own = 5; }
class Heir extends Middle {}
class Other extends Base {}
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
const loops = n => { let s = 0; for (let i = 0; i < n; i++) { s += Heir.make(i & 3).n + Heir.count + Heir.own; s += Middle.count + Other.count; } return s + ":" + Heir.list.length; };
const show = label => console.log(label, attempt(() => loops(30)), attempt(() => Heir.bump()), attempt(() => Middle.bump()), attempt(() => Other.bump()), Base.count, Heir.count, Other.count);
show("as written");
Heir.count = 100; show("own on the heir");
delete Heir.count; show("deleted");
Middle.count = "m"; show("own between");
delete Middle.count; show("deleted between");
let reads = 0;
Object.defineProperty(Other, "count", { get() { reads++; return -1; }, configurable: true }); show("accessor");
delete Other.count; show("accessor deleted");
Object.setPrototypeOf(Heir, { make: Base.make, bump() { return "b"; }, own: 1, list: [], count: "parent" }); show("other parent");
Object.setPrototypeOf(Heir, Middle); show("back");
delete Base.count; show("deleted at the base");
Base.count = 3; show("laid again");
Object.defineProperty(Base, "count", { get() { reads += 10; return 7; }, set(v) { reads += 100; }, configurable: true }); show("accessor at the base");
console.log(reads, Object.keys(Heir).join(), Object.keys(Other).join());
