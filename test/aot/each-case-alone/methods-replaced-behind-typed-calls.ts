class Base {
  v = 1;
  m() { return "base m" + this.v; }
  n() { return "base n"; }
  get g() { return "base g"; }
  static s() { return "base s"; }
}
class Mid extends Base {
  m() { return "mid m>" + super.m(); }
  static s() { return "mid s>" + super.s(); }
}
class Leaf extends Mid {
  n() { return "leaf n>" + super.n(); }
}
function calls(o: Base): string {
  try {
    return [o.m(), o.n(), o.g].join();
  } catch (e) {
    return "throws " + (e as Error).constructor.name;
  }
}
function t(name: string, change: (o: any, other: Leaf) => unknown): void {
  const warm: Base[] = [new Base(), new Mid(), new Leaf()];
  for (let i = 0; i < 100; i++) for (const w of warm) calls(w);
  const o = new Leaf();
  const other = new Leaf();
  let said = "";
  try {
    said = String(change(o, other) ?? "");
  } catch (e) {
    said = "throws " + (e as Error).constructor.name;
  }
  console.log(name, said, "|", calls(o), "|", calls(other), "|", calls(new Leaf()), "|", calls(new Mid()), "|", calls(new Base()), "|", calls(warm[2]), "|", Leaf.s(), Mid.s());
}
const nothing = process.env.NOBODY_HAS_SET_THIS ?? "";
const key = (text: string): any => text + nothing;
t("nothing", () => {});
t("an own method by a store", o => { o.m = () => "own m"; });
t("an own method by a computed store", o => { o[key("m")] = () => "own m"; });
t("an own method by a definition", o => { Object.defineProperty(o, "m", { value: () => "own m" }); });
t("an own getter that returns a method", o => { Object.defineProperty(o, "m", { get: () => () => "own getter m" }); });
t("an own method by Object.assign", o => { Object.assign(o, { m: () => "own m", n: () => "own n" }); });
t("an own method by Object.assign of parsed names", o => { Object.assign(o, Object.fromEntries([[key("m"), () => "own m"]])); });
t("an own method by Reflect.set", o => Reflect.set(o, "m", () => "own m"));
t("an own method by Reflect.set with a receiver", o => Reflect.set({}, "m", () => "own m", o));
t("an own method by a store through super", o => { ({ __proto__: {}, go(this: any) { (super.m as any) = () => "own m"; } }).go.call(o); });
t("an own method by a class that returns the object", o => { class R { constructor(x: object) { return x; } } class S extends R { m = () => "own m"; } new S(o); });
t("an own method that is not callable", o => { o.m = 5; });
t("an own method that is undefined", o => { o.m = undefined; });
t("an own method that is deleted again", o => { o.m = () => "own m"; delete o.m; });
t("an own property over the getter", o => { Object.defineProperty(o, "g", { value: "own g" }); });
t("a store to the getter", o => { o.g = "stored"; });
t("the method of the leaf's prototype is added", () => { (Leaf.prototype as any).m = function () { return "leaf m"; }; });
t("the method of the leaf's prototype is added by a computed key", () => { (Leaf.prototype as any)[key("m")] = function () { return "leaf m"; }; });
t("the method of the middle is replaced", () => { Mid.prototype.m = function () { return "new mid m"; }; });
t("the method of the middle is deleted", () => delete (Mid.prototype as any).m);
t("the method of the base is replaced", () => { Base.prototype.m = function () { return "new base m"; }; });
t("the method of the base is deleted", () => delete (Base.prototype as any).m);
t("the method of the base becomes a getter", () => { Object.defineProperty(Base.prototype, "m", { get() { return () => "base getter m"; } }); });
t("the getter of the base is replaced", () => { Object.defineProperty(Base.prototype, "g", { get() { return "new base g"; } }); });
t("the getter of the base becomes a value", () => { Object.defineProperty(Base.prototype, "g", { value: "value g" }); });
t("the getter is hidden by the middle", () => { Object.defineProperty(Mid.prototype, "g", { get() { return "mid g"; }, configurable: true }); });
t("methods are assigned to a prototype", () => { Object.assign(Leaf.prototype, { m() { return "assigned m"; }, n() { return "assigned n"; } }); });
t("methods are defined on a prototype all together", () => { Object.defineProperties(Mid.prototype, { m: { value() { return "defined m"; } }, n: { value() { return "defined n"; } } }); });
t("the prototype of the object is the middle's", o => { Object.setPrototypeOf(o, Mid.prototype); });
t("the prototype of the object is the base's", o => { o.__proto__ = Base.prototype; });
t("the prototype of the object is null", o => { Object.setPrototypeOf(o, null); });
t("the prototype of the object is another object", o => { Object.setPrototypeOf(o, { m() { return "other m"; }, n() { return "other n"; }, g: "other g" }); });
t("the prototype of the object is an heir of the leaf's", o => { Object.setPrototypeOf(o, Object.create(Leaf.prototype, { m: { value() { return "between m"; } } })); });
t("the prototype of the object is a proxy", o => { Object.setPrototypeOf(o, new Proxy(Leaf.prototype, { get(target, k, r) { return k === "m" ? () => "proxy m" : Reflect.get(target, k, r); } })); });
t("the prototype of the leaf's prototype is the base's", () => { Object.setPrototypeOf(Leaf.prototype, Base.prototype); });
t("the prototype of the middle's prototype is another object", () => { Object.setPrototypeOf(Mid.prototype, { m() { return "stranger m"; }, n() { return "stranger n"; }, g: "stranger g" }); });
t("the prototype of the base's prototype has the names", () => { Object.setPrototypeOf(Base.prototype, { m() { return "above m"; }, extra() { return 1; } }); delete (Base.prototype as any).m; });
t("the prototype of the leaf's prototype is a proxy", () => { Object.setPrototypeOf(Leaf.prototype, new Proxy(Mid.prototype, { get(target, k, r) { return k === "m" ? () => "proxy m" : Reflect.get(target, k, r); } })); });
t("the static of the middle is replaced", () => { Mid.s = () => "new mid s"; });
t("the static of the base is replaced", () => { Base.s = () => "new base s"; });
t("the leaf gets a static of its own", () => { (Leaf as any).s = () => "leaf s"; });
t("the base of the leaf class is the base class", () => { Object.setPrototypeOf(Leaf, Base); });
t("the static of the middle is deleted", () => delete (Mid as any).s);
t("text that arrives while the program runs replaces a method", () => { new Function("C", "C.prototype.m = function () { return 'from text'; }" + nothing)(Mid); });
t("text that arrives while the program runs gives the object a method", o => { new Function("o", "o.m = function () { return 'from text'; }" + nothing)(o); });
t("a method is replaced while it runs", o => { const old = Mid.prototype.m; Mid.prototype.m = function (this: Mid) { Mid.prototype.m = function () { return "second"; }; return "first>" + old.call(this); }; return calls(o); });
t("a getter replaces a method when it is read", o => { Object.defineProperty(Base.prototype, "g", { get() { Base.prototype.n = () => "n from g"; return "g ran"; }, configurable: true }); return calls(o); });
t("a frozen prototype", () => { Object.freeze(Mid.prototype); Mid.prototype.m = () => "never"; });
t("an own method under a frozen prototype", o => { Object.freeze(Leaf.prototype); Object.freeze(Mid.prototype); Object.freeze(Base.prototype); o.m = () => "own m"; });
t("a definition under a frozen prototype", o => { Object.freeze(Mid.prototype); Object.defineProperty(o, "m", { value: () => "own m" }); });
t("an object that was not made by its class", () => calls(Object.create(Leaf.prototype)));
t("an object of another class with the same members", () => calls(new (class { v = 2; m() { return "stranger m"; } n() { return "stranger n"; } g = "stranger g"; })() as Base));
t("a literal with the same members", () => calls({ v: 3, m() { return "literal m"; }, n() { return "literal n"; }, g: "literal g" } as Base));
t("a method taken off and called on another object", (o, other) => { const m = o.m; other.v = 9; return m.call(other) + Base.prototype.m.call({ v: 7 } as Base); });
t("a method bound and stored back", o => { o.m = o.m.bind({ v: 5 }); });
t("an heir made late", () => { class Late extends Leaf { m() { return "late m>" + super.m(); } } return calls(new Late()); });
t("an heir made from a computed base", () => { const C: any = [Leaf, Mid][Number(nothing)]; class Late extends C { n() { return "late n>" + super.n(); } } return calls(new Late() as Base); });
