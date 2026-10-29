// A factory makes a constructor function anew at every call, so many closures share one function's code and each has a prototype of its own. What `new` makes follows every change to those prototypes.
const log = [];
const make = (tag, extra) => {
  const Impl = function (value) { this.value = value; this.tag = tag; };
  Impl.prototype = { kind: tag, ...extra, describe() { return this.kind + ":" + this.value + ":" + this.tag + ":" + Object.keys(this).join(); } };
  return Impl;
};
const all = [];
for (let i = 0; i < 40; i++) all.push(make("k" + i, i % 3 ? { more: i } : {}));
const round = label => {
  let sum = 0; const said = [];
  for (let turn = 0; turn < 30; turn++) {
    for (let i = 0; i < all.length; i++) {
      let made;
      try { made = new all[i](turn); } catch (error) { if (turn === 29) said.push(i + " throws " + error.constructor.name); continue; }
      sum += made.value === undefined ? 1000 : made.value;
      if (turn === 29 && i < 9) said.push(typeof made.describe === "function" ? made.describe() : "no describe, " + Object.keys(made).join() + ", " + made.kind);
    }
  }
  console.log(label + ":", sum, said.join(" | "), log.length ? "log " + log.length + " " + log.slice(-2).join() : "");
  log.length = 0;
};
round("as made");
round("again");
Object.defineProperty(all[1].prototype, "value", { set(v) { log.push("set " + v); }, configurable: true });
round("a setter on one prototype");
delete all[1].prototype.value;
round("the setter deleted");
all[2].prototype = { kind: "replaced" };
round("a prototype replaced");
Object.defineProperty(all[3].prototype, "tag", { value: "fixed", writable: false, configurable: true });
round("a read-only property on one prototype");
delete all[3].prototype.tag;
round("deleted again");
Object.setPrototypeOf(all[4].prototype, { set tag(v) { log.push("between " + v); }, inherited: true });
round("a prototype between with a setter");
all[5].prototype = 5;
round("a prototype that is no object");
const crossed = Reflect.construct(all[6], [7], all[7]);
console.log("another new.target:", crossed.describe(), Object.getPrototypeOf(crossed) === all[7].prototype);
if (typeof Bun !== "undefined") Bun.gc(true); else if (typeof gc === "function") gc();
round("after a collection");
for (let i = 0; i < 300; i++) all.push(make("late" + i, {}));
round("three hundred more closures");
