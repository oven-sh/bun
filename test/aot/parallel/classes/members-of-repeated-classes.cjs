// COUNT: counter:UnobservedMembersDefined >= 100
// Classes that a function makes again and again: what others see of their members while more classes are made, changed, inherited and read in loops.
const { getPrototypeOf, defineProperty, getOwnPropertyNames } = Object;
const symbol = Symbol("member");
function make(g, Base, key) {
  return class extends Base {
    plain() { return "plain " + g.v; }
    again() { return super.again ? "again over " + super.again() : "again " + g.v; }
    get only() { return "only " + g.v; }
    set only(v) { g.v = v; }
    [symbol]() { return "symbol " + g.v; }
    [key]() { return "key " + g.v; }
    3() { return "three " + g.v; }
    toString() { return "made " + g.v; }
    static create(v) { const o = new this(); o.only = v; return o; }
    static get kind() { return "kind " + g.v; }
    static [key]() { return "static key " + g.v; }
  };
}
function narrow(g) {
  class Narrow {
    a() { return g.v; }
    b() { return this.a() + 1; }
  }
  return Narrow;
}
const told = [];
const show = o => [o.plain(), o.again(), o.only, o[symbol](), o.extra ? o.extra() : "-", o[3](), String(o), o.lent ? o.lent() : "-"].join("|");
class Root {
  extra() { return "extra of root"; }
}
let above = Root;
const made = [];
for (let i = 0; i < 24; i++) {
  const g = { v: i };
  const C = make(g, i % 4 === 3 ? above : i % 4 === 2 ? Root : Object, i % 3 ? "extra" : "plain");
  if (i % 4 === 1) above = C;
  made.push(C);
  const c = C.create(i * 10);
  told.push(i + ": " + show(c) + "|" + C.kind + "|" + (C.extra ? C.extra() : C.plain()));
  if (i % 5 === 4) C.prototype.lent = made[i - 1].prototype.plain;
  if (i % 6 === 5) defineProperty(Root.prototype, "extra", { value: () => "root changed " + i, configurable: true, writable: true });
  if (i % 7 === 6) delete made[i - 2].prototype.plain;
  if (i % 8 === 7) Object.setPrototypeOf(made[i - 3].prototype, made[i - 1].prototype);
  for (const D of made.slice(-4)) {
    let shown;
    try {
      shown = show(new D());
    } catch (e) {
      shown = e.constructor.name;
    }
    told.push("  " + shown);
  }
}
let sum = 0;
for (let round = 0; round < 40; round++) {
  const N = narrow({ v: round });
  const n = new N();
  for (let i = 0; i < 5; i++) sum += n.b();
  if (round % 9 === 8) N.prototype.a = function () { return 1000; };
  if (round % 11 === 10) defineProperty(N.prototype, "b", { get() { return () => 7; } });
  sum += n.b() + (n instanceof N) + getOwnPropertyNames(N.prototype).length;
}
let mixed = Object;
for (let i = 0; i < 8; i++) {
  const g = { v: i };
  mixed = (Base => class extends Base { m() { return (super.m ? super.m() : "") + g.v; } get p() { return (super.p ?? 0) + g.v; } static s() { return (super.s ? super.s() : "s") + g.v; } })(mixed);
  const o = new mixed();
  told.push(o.m() + " " + o.p + " " + mixed.s());
}
const proxied = new Proxy(Root, { get: (t, k, r) => (told.push("read " + String(k)), Reflect.get(t, k, r)) });
for (let i = 0; i < 3; i++) {
  const C = make({ v: -i }, proxied, "plain");
  told.push(show(new C()), getOwnPropertyNames(C.prototype).join(), getOwnPropertyNames(C).join());
}
console.log(told.join("\n"));
console.log(sum);
