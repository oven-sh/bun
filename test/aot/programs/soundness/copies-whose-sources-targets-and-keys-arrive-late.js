// Copies of properties whose sources, targets, keys and excluded keys arrive late.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { console.log(parts.map(String).join(" | ")); }
function dynamic(text) { return (text + "!").slice(0, text.length); }

// 1: the source gets a property after the copy was seen
{
  const source = { a: 1 };
  function grow(s) { s.late = "text"; }
  grow(chain(source));
  const copy = { ...source };
  show("1", copy.a + 1, copy.late.length);
}
// 2: another source, another target
{
  function assign(t, s) { return Object.assign(t, s); }
  const t1 = assign({}, { a: 1 });
  const t2 = assign(chain({ own: true }), { a: 1 });
  const t3 = assign({}, chain({ b: "text" }));
  show("2", t1.a + 1, t2.a + 1, t2.own, t3.b.length, t3.a);
}
// 3: Object.assign runs a setter that appears late on the chain of the target
{
  const log = [];
  const proto = {};
  const target = Object.create(proto);
  function assign(t, s) { return Object.assign(t, s); }
  assign({}, { x: 0 });
  Object.defineProperty(chain(proto), "x", { set(v) { log.push(v); this.hidden = v; }, configurable: true });
  assign(target, { x: 5 });
  show("3", Object.keys(target).join(), target.hidden + 1, log.join());
}
// 4: the getter of a source appears late
{
  const source = { a: 1 };
  Object.defineProperty(chain(source), "g", { get() { return helper(); }, enumerable: true });
  function helper() { return ["from getter"]; }
  const copy = { ...source };
  show("4", copy.g.length, copy.g[0].length, Object.getOwnPropertyDescriptor(copy, "g").value.length);
}
// 5: a rest pattern whose excluded key is one name first and two names later
{
  function omit(o, k) { const { [k]: dropped, ...rest } = o; return rest; }
  const first = omit({ a: 1, b: "text" }, "a");
  show("5a", first.a, first.b.length);
  const second = omit({ a: 1, b: "text" }, chain("b"));
  show("5b", second.a + 1, second.b);
}
// 6: a rest pattern with a key that nobody can name
{
  function omit(o, k) { const { [k]: dropped, ...rest } = o; return rest; }
  const rest = omit({ a: 1, b: "text" }, dynamic("a"));
  show("6", rest.a, rest.b.length);
  const rest2 = omit({ a: 1, b: "text" }, dynamic("zz"));
  show("6b", rest2.a + 1, rest2.b.length);
}
// 7: a string as a source, arriving late
{
  function spread(s) { return { ...s }; }
  show("7a", Object.keys(spread({ a: 1 })).join());
  const characters = spread(chain("hi"));
  show("7b", Object.keys(characters).join(), characters[0].length, characters[1]);
}
// 8: unnamed members of the source
{
  const source = {};
  source[dynamic("k")] = [1, 2];
  const copy = { ...source };
  show("8", copy.k.length);
  const source2 = {};
  const copy2 = Object.assign({ k: 0 }, source2);
  show("8b", copy2.k + 1);
  function fill(s) { s[dynamic("k")] = "text"; }
  fill(chain(source2));
  const copy3 = Object.assign({ k: 0 }, source2);
  show("8c", copy3.k.length);
}
// 9: a copy of a copy of a copy, the first source grows last
{
  const source = { a: 1 };
  function clone(o) { return { ...o }; }
  const make = () => clone(clone(clone(source)));
  show("9a", make().a + 1, make().z);
  chain(source).z = () => "called";
  show("9b", make().z());
}
// 10: symbols and non-enumerable properties
{
  const s = Symbol("s");
  const source = { [s]: "symbol" };
  Object.defineProperty(source, "hidden", { value: 1, enumerable: false });
  const copy = { ...chain(source) };
  show("10", copy[s].length, copy.hidden, "hidden" in copy);
}
// 11: arrays as sources and targets
{
  const copy = Object.assign([], chain([1, "two"]));
  show("11", copy.length, copy[0] + 1, copy[1].length);
  const spread = { ...chain(["zero"]) };
  show("11b", spread[0].length, spread["0"].length);
}
