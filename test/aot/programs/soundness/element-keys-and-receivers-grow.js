// Element accesses whose keys and receivers grow, one after the other and both at once.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { console.log(parts.map(String).join(" | ")); }

// 1: the receivers are known first, another key arrives late
{
  const first = { a: 1, b: "first b", c: [1] };
  const second = { a: 2.5, b: { deep: true }, c: null };
  function get(o, k) { return o[k]; }
  show("1a", get(first, "a") + 1, get(second, "a") + 1);
  const late = chain("b");
  show("1b", get(first, late).length, get(second, late).deep);
  const later = chain(chain("c"));
  show("1c", get(first, later).length, get(second, later));
}
// 2: the key is known first, another receiver arrives late
{
  function get(o, k) { return o[k]; }
  show("2a", get({ a: 1 }, "a") + 1);
  show("2b", get(chain({ a: "text" }), "a").length);
  show("2c", get(chain(chain({ get a() { return [1, 2, 3]; } })), "a").length);
}
// 3: both arrive through one call
{
  function get(pair) { return pair.o[pair.k]; }
  show("3a", get({ o: { a: 1, z: "z" }, k: "a" }) + 1);
  show("3b", get(chain({ o: { b: "text", a: false }, k: "b" })).length);
  show("3c", get({ o: { a: 1, z: "z" }, k: "z" }).length, get({ o: { b: "text", a: false }, k: "a" }));
}
// 4: stores
{
  function put(o, k, v) { o[k] = v; }
  const target = { a: 0, b: 0 };
  const other = { a: "s", b: "s" };
  put(target, "a", 1);
  put(chain(other), "a", 2);
  put(target, chain("b"), "late");
  put(other, chain("b"), [3]);
  show("4", target.a + 1, target.b.length, other.a + 1, other.b.length);
}
// 5: one index, then another, then a counter, then a string of digits
{
  function get(o, k) { return o[k]; }
  const list = [1, "two", [3], { four: 4 }];
  show("5a", get(list, 0) + 1);
  show("5b", get(list, chain(1)).length);
  let text = "";
  for (let i = 0; i < list.length; i++) text += typeof get(list, i) + ",";
  show("5c", text, get(list, chain("3")).four, get(list, "length"));
}
// 6: a symbol, a number that is no index, and an object as a key
{
  function get(o, k) { return o[k]; }
  const s = Symbol("s");
  const o = { [s]: "symbol", "-1": "minus one", "1.5": "fraction", "[object Object]": "object", name: 0 };
  show("6", get(o, "name") + 1, get(o, chain(s)).length, get(o, chain(-1)).length, get(o, chain(1.5)).length, get(o, chain({})).length);
  const withToString = { toString() { return "name"; } };
  show("6b", get(o, chain(withToString)) + 1);
}
// 7: the key list of a loop grows while the loop's body is known
{
  const keys = ["a"];
  const o = { a: 1, b: "b", c: () => "called" };
  function all() { const found = []; for (const k of keys) found.push(o[k]); return found; }
  show("7a", all().length);
  keys.push(chain("b"));
  keys.push(chain("c"));
  const found = all();
  show("7b", found[0] + 1, found[1].length, found[2]());
}
// 8: delete and `in` under a key that grows
{
  function remove(o, k) { return delete o[k]; }
  function has(o, k) { return k in o; }
  const o = { a: 1, b: 2, c: 3 };
  remove(o, "a");
  remove(o, chain("b"));
  show("8", has(o, "a"), has(o, chain("b")), has(o, chain("c")), o.a, o.b, o.c + 1);
}
