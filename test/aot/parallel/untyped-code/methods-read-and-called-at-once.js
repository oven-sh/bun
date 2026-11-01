// `this.step(1)` inside a class whose `step` the checker knows: the front end writes the read and the call apart. In code that is not hot the two are one method call. Here: the predicted method; an heir's; one replaced on the instance, on the prototype, by a getter, by a bound function, by a host function, by a proxy, by what is no function (the error's text and position), deleted; receivers that are no instance (call, apply, a borrowed method); calls in tail position and not, with none to seven arguments, with constants and with computed arguments whose evaluation changes the method; `this` seen by the callee; deep tail recursion.
const lines = [];
const say = (...words) => lines.push(words.map(String).join(" "));
class Walker {
  constructor(name) { this.name = name; this.count = 0; }
  step(n) { this.count += n; return this.name + ":" + this.count; }
  none() { return this.name + " none"; }
  seven(a, b, c, d, e, f, g) { return [this.name, a, b, c, d, e, f, g].join(); }
  tail() { return this.step(1); }
  tailNone() { return this.none(); }
  tailText() { return this.step("x"); }
  inner() { const said = this.step(2); return "<" + said + ">"; }
  twice() { return this.step(1) + " " + this.step(1); }
  many() { return this.seven(1, "two", true, null, undefined, 6, "seven"); }
  manyInner() { const said = this.seven(1, "two", true, null, undefined, 6, "seven"); return said.length; }
  computed(change) { return this.step(change(this)); }
  down(n) { if (n === 0) return this.name + " at the bottom"; return this.down(n - 1); }
  tested() { if (this.step(0)) return "truthy"; return "falsy"; }
  other(walker) { return walker.step(5); }
}
class Heir extends Walker {
  step(n) { return "heir " + super.step(n); }
  none() { return "heir none"; }
}
const place = error => String(error.stack).split("\n").filter(line => line.includes("methods-read-and-called-at-once")).slice(0, 2).map(line => line.replace(/^.*methods-read-and-called-at-once[^:]*/, "").replace(")", "")).join(" < ");
const names = ["tail", "tailNone", "tailText", "inner", "twice", "many", "manyInner", "tested"];
const show = (label, walker) => {
  for (const name of names) {
    try { say(label, name, Walker.prototype[name].call(walker)); } catch (error) { say(label, name, error.constructor.name, walker == null ? place(error).replace(/:(\d+):\d+/g, ":$1") : place(error)); }
  }
};
show("walker", new Walker("w"));
show("heir", new Heir("h"));
const replaced = new Walker("r"); replaced.step = function (n) { return "own " + this.name + " " + n; }; replaced.none = () => "an arrow"; show("replaced", replaced);
const bound = new Walker("b"); bound.step = Walker.prototype.step.bind(new Walker("elsewhere")); show("bound", bound);
const host = new Walker("host"); host.step = Math.abs; host.none = Date.now.bind(null, 0) && String; host.seven = Array.of; show("host", host);
const viaGetter = new Walker("g"); let reads = 0; Object.defineProperty(viaGetter, "step", { get() { reads++; return n => "got " + n + " " + reads; } }); show("getter", viaGetter);
const proxied = new Proxy(new Walker("p"), { get(target, key, receiver) { if (typeof key === "string" && key !== "name" && key !== "count") lines.push("  trap " + key); return Reflect.get(target, key, receiver); } }); show("proxy", proxied);
const callable = new Walker("c"); callable.step = new Proxy(function (n) { return "through a proxy " + n; }, {}); show("callable proxy", callable);
for (const [label, value] of [["number", 7], ["text", "t"], ["object", {}], ["null", null], ["undefined", undefined], ["symbol", Symbol.iterator], ["class", class {}]]) {
  const broken = new Walker(label); broken.step = value; broken.none = value; broken.seven = value; show("no function: " + label, broken);
}
const bare = new Walker("bare"); Object.setPrototypeOf(bare, null); show("no prototype", bare);
for (const receiver of [{ name: "plain", count: 0, step: n => "plain " + n, none: () => "plain none", seven: (...all) => all.length }, {}, "text", 5, true, null, undefined]) show("borrowed by " + (receiver === null ? "null" : typeof receiver), receiver);
const changing = new Walker("ch");
say("computed", changing.computed(w => 3));
say("computed, the method changes while the argument is worked out", changing.computed(w => { w.step = n => "the new one " + n; return 4; }));
say("computed, again", changing.computed(w => 5));
say("other", new Walker("a").other(new Walker("o")), new Walker("a").other(new Heir("oh")), new Walker("a").other({ step: n => n * 2 }));
say(new Walker("deep").down(200000), new Heir("deep heir").down(200000));
const original = Walker.prototype.step;
Walker.prototype.step = function (n) { return "patched " + this.name + " " + n; };
show("the prototype is patched", new Walker("pp")); show("the prototype is patched, heir", new Heir("ph"));
delete Walker.prototype.step;
show("the method is deleted", new Walker("d"));
Walker.prototype.step = original;
show("and put back", new Walker("back"));
const literal = {
  name: "literal", count: 0,
  step(n) { this.count += n; return this.name + " " + this.count; },
  tail() { return this.step(1); },
  inner() { const said = this.step(2); return "[" + said + "]"; },
};
say(literal.tail(), literal.inner(), literal.tail.call({ step: n => "borrowed " + n }));
literal.step = 3;
try { say(literal.tail()); } catch (error) { say(error.constructor.name, place(error)); }
try { say(literal.inner()); } catch (error) { say(error.constructor.name, place(error)); }
class Store {
  get(key) { return "store get " + key; }
  has(key) { return key === "k"; }
  set(key, value) { return "store set " + key + value; }
  add(value) { return "store add " + value; }
  push(value) { return "store push " + value; }
  tailGet(key) { return this.get(key); }
  innerGet(key) { const said = this.get(key); return "<" + String(said) + ">"; }
  tailHas(key) { return this.has(key); }
  innerHas(key) { if (this.has(key)) return "has it"; return "has it not"; }
  tailSet(key, value) { return this.set(key, value); }
  innerSet(key, value) { const said = this.set(key, value); return typeof said; }
  tailAdd(key) { return this.add(key); }
  innerAdd(key) { const said = this.add(key); return typeof said; }
  tailPush(key) { return this.push(key); }
  innerPush(key) { const said = this.push(key); return "<" + String(said) + ">"; }
}
const stores = { store: () => new Store(), map: () => new Map([["k", 1]]), set: () => new Set(["k"]), weak: () => new WeakMap(), array: () => [1], own: () => ({ get: key => "own get " + key, has: () => false, set: () => "own set", add: () => "own add", push: () => "own push" }), bare: () => ({}), nothing: () => null };
for (const [label, make] of Object.entries(stores)) {
  for (const name of Object.getOwnPropertyNames(Store.prototype).filter(name => /^(tail|inner)/.test(name))) {
    for (const key of ["k", "other"]) {
      try { const said = Store.prototype[name].call(make(), key, "v"); say("named as a collection's", label, name, key, typeof said === "object" ? Object.prototype.toString.call(said) : said); } catch (error) { say("named as a collection's", label, name, key, error.constructor.name); }
    }
  }
}
console.log(lines.join("\n"));
