// Setters and getters that appear late on any level of a prototype chain, by every way of defining one.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
const out = [];
function show(...parts) { console.log(parts.map(String).join(" | ")); }

function makeChain() {
  const top = { level: "top" };
  const middle = Object.create(top); middle.level = "middle";
  const bottom = Object.create(middle); bottom.level = "bottom";
  return { top, middle, bottom };
}
function store(o, v) { o.x = v; }
function load(o) { return o.x; }
function describe(o) { return Object.keys(o).join(",") + ":" + typeof load(o) + ":" + String(load(o)); }

// 1: Object.defineProperty on the top level
{
  const c = makeChain();
  store(c.bottom, 1);
  show("1a", describe(c.bottom));
  const d = makeChain();
  Object.defineProperty(chain(d.top), "x", { set(v) { out.push("1 set " + v); this.hidden = v + 1; }, get() { return "got " + this.hidden; }, configurable: true });
  store(d.bottom, 2);
  show("1b", describe(d.bottom), d.bottom.hidden + 1, out.join());
}
// 2: __defineSetter__ / __defineGetter__ on the middle level
{
  const d = makeChain();
  store(d.bottom, 5);
  const e = makeChain();
  chain(e.middle).__defineSetter__("x", function (v) { out.push("2 set " + v); this.hidden = [v]; });
  chain(e.middle).__defineGetter__("x", function () { return this.hidden; });
  store(e.bottom, 6);
  show("2", describe(d.bottom), describe(e.bottom), e.bottom.hidden.length, out.join());
}
// 3: Object.defineProperties with a map that gets the key late
{
  const map = {};
  const e = makeChain();
  function fill(m) { m.x = { set(v) { out.push("3 set " + v); this.hidden = { v }; }, get() { return this.hidden.v * 2; }, configurable: true }; }
  fill(chain(map));
  Object.defineProperties(e.top, map);
  store(e.bottom, 7);
  show("3", describe(e.bottom), e.bottom.hidden.v, out.join());
}
// 4: Reflect.defineProperty
{
  const e = makeChain();
  Reflect.defineProperty(chain(e.middle), "x", { set(v) { out.push("4 set " + v); this.hidden = String(v); } });
  store(e.bottom, 8);
  show("4", describe(e.bottom), e.bottom.hidden.length, out.join());
}
// 5: a new link: the object with the accessor becomes a prototype after the store was seen
{
  const accessors = { set x(v) { out.push("5 set " + v); this.hidden = v * 3; }, get x() { return this.hidden + 0.5; } };
  const e = makeChain();
  store(e.bottom, 9);
  show("5a", describe(e.bottom));
  const f = makeChain();
  Object.setPrototypeOf(chain(f.top), chain(accessors));
  store(f.bottom, 10);
  show("5b", describe(f.bottom), f.bottom.hidden, out.join());
}
// 6: __proto__ assignment in the middle of the chain
{
  const accessors = { set x(v) { out.push("6 set " + v); this.hidden = "h" + v; }, get x() { return this.hidden; } };
  const f = makeChain();
  chain(f.middle).__proto__ = chain(accessors);
  store(f.bottom, 11);
  show("6", describe(f.bottom), f.bottom.hidden.length, out.join());
}
// 7: a class member under a computed key that arrives late
{
  const names = ["y"];
  names.push(chain("x"));
  const name = names[names.length - 1];
  class Holder { set [name](v) { out.push("7 set " + v); this.hidden = v - 1; } get [name]() { return this.hidden; } }
  class Child extends Holder {}
  const o = new Child();
  store(o, 12);
  show("7", describe(o), o.hidden + 1, out.join());
}
// 8: the setter is reached only because an earlier getter ran
{
  const e = makeChain();
  Object.defineProperty(e.top, "install", { get() { Object.defineProperty(e.middle, "x", { set(v) { out.push("8 set " + v); this.hidden = v; }, get() { return -this.hidden; }, configurable: true }); return 1; } });
  const before = e.bottom.install;
  store(e.bottom, 13);
  show("8", before, describe(e.bottom), e.bottom.hidden, out.join());
}
