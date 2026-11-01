// RUN: lower
// OPTIONS: builtin-modules

// for..of over receivers whose type the compiler does not know: the order of visits, what the body may do to the collection meanwhile, and every way in which a map, a set or an array can stop being iterated as usual.
const said = [];
const text = value => Array.isArray(value) ? "[" + value.map(text).join(",") + "]" : typeof value === "object" && value !== null ? "{" + Object.keys(value).join(",") + "}" : typeof value === "function" ? "a function" : String(value);
const walk = (iterable, body) => { const seen = []; for (const value of iterable) { seen.push(text(value)); if (body && body(value, iterable) === "stop") break; } return seen.join(" "); };
const pairs = (iterable, body) => { const seen = []; for (const [key, value] of iterable) { seen.push(text(key) + "=" + text(value)); if (body && body(key, value, iterable) === "stop") break; } return seen.join(" "); };
const show = (label, result) => said.push(label + ": " + result);
const attempt = (label, f) => { try { show(label, f()); } catch (error) { show(label, error.constructor.name); } };
const mapOf = (n, key = i => "k" + i) => { const map = new Map(); for (let i = 0; i < n; i++) map.set(key(i), i); return map; };
const setOf = (n, key = i => "k" + i) => { const set = new Set(); for (let i = 0; i < n; i++) set.add(key(i)); return set; };
const kinds = { strings: i => "k" + i, numbers: i => i * 7, halves: i => i + 0.5, mixed: i => i % 3 === 0 ? "k" + i : i % 3 === 1 ? i : Symbol.for("s" + i) };

for (const [kind, key] of Object.entries(kinds)) {
  for (const n of [0, 1, 4, 5, 9, 40]) {
    show(kind + " map of " + n, walk(mapOf(n, key)));
    show(kind + " map of " + n + " by pairs", pairs(mapOf(n, key)));
    show(kind + " set of " + n, walk(setOf(n, key)));
  }
  show(kind + ": the one visited is deleted", pairs(mapOf(6, key), (k, v, map) => { map.delete(k); }));
  show(kind + ": the next one is deleted", pairs(mapOf(6, key), (k, v, map) => { map.delete(key(v + 1)); }));
  show(kind + ": an earlier one is deleted", pairs(mapOf(6, key), (k, v, map) => { if (v > 1) map.delete(key(v - 2)); }));
  show(kind + ": all the others are deleted", pairs(mapOf(9, key), (k, v, map) => { for (let i = 0; i < 9; i++) if (i !== v) map.delete(key(i)); }));
  show(kind + ": entries are added up to thirty", pairs(mapOf(3, key), (k, v, map) => { if (map.size < 30) map.set(key(map.size), map.size); }));
  show(kind + ": deleted and added again", pairs(mapOf(4, key), (k, v, map) => { if (v === 1) { map.delete(key(0)); map.set(key(0), "again"); } }));
  show(kind + ": cleared at the second", pairs(mapOf(5, key), (k, v, map) => { if (v === 1) map.clear(); }));
  show(kind + ": cleared and filled again", pairs(mapOf(5, key), (k, v, map) => { if (v === 1) { map.clear(); map.set(key(7), "n"); map.set(key(8), "m"); } }));
  show(kind + ": values are replaced ahead", pairs(mapOf(5, key), (k, v, map) => { if (typeof v === "number" && v < 4) map.set(key(v + 1), "r" + v); }));
  show(kind + ": a set, the one visited is deleted", walk(setOf(6, key), (k, set) => { set.delete(k); }));
  show(kind + ": a set grows up to thirty", walk(setOf(3, key), (k, set) => { if (set.size < 30) set.add(key(set.size)); }));
  show(kind + ": a set is cleared and filled again", walk(setOf(5, key), (k, set) => { if (k === key(1)) { set.clear(); set.add(key(9)); } }));
  show(kind + ": a set shrinks to nothing", walk(setOf(40, key), (k, set) => { for (let i = 0; i < 40; i++) set.delete(key(i)); }));
  show(kind + ": left at the third", pairs(mapOf(6, key), (k, v) => v === 2 ? "stop" : undefined));
}

show("a key of another kind arrives among strings", pairs(mapOf(4), (k, v, map) => { if (v === 1) map.set(99, "number"); }));
show("a key of another kind arrives in a set of strings", walk(setOf(4), (k, set) => { if (k === "k1") set.add(99); }));
show("keys of every kind", pairs(new Map([[1, "one"], ["1", "text"], [NaN, "nan"], [-0, "zero"], [null, "null"], [undefined, "undefined"], [1.5, "half"], [10n, "big"], [true, "true"]])));
show("values of every kind", pairs(new Map([["a", undefined], ["b", null], ["c", 0], ["d", -0], ["e", 1.5], ["f", "text"], ["g", true], ["h", 2 ** 40], ["i", [1]], ["j", { x: 1 }]])));

{
  const map = mapOf(3), kept = [];
  for (const pair of map) kept.push(pair);
  show("every pair is an array of its own", [kept[0] !== kept[1], kept.every(Array.isArray), kept.map(pair => pair.length).join(), Object.getPrototypeOf(kept[2]) === Array.prototype].join(" "));
  kept[0][1] = "changed"; kept[0].push("more");
  show("a pair may be changed and the map is not", text(kept[0]) + " " + map.get("k0"));
}
{
  const map = mapOf(3), seen = [];
  for (const [a] of map) for (const [b, n] of map) seen.push(a + b + n);
  show("a map within itself", seen.join(" "));
  const set = setOf(3), both = [];
  for (const a of set) { for (const b of set) { if (b === "k1") break; both.push(a + b); } }
  show("a set within itself, the inner loop left", both.join(" "));
}
for (const [first, , third = "none", ...rest] of new Map([["a", 1]])) show("more names than a pair has", [first, third, rest.length].join(" "));
for (const { 0: key, length } of mapOf(1)) show("a pair taken apart by name", key + " " + length);

{
  const map = mapOf(3);
  map[Symbol.iterator] = function* () { yield ["own", 1]; };
  show("a map with an iterator of its own", pairs(map));
  const set = setOf(3);
  set[Symbol.iterator] = () => [7, 8][Symbol.iterator]();
  show("a set with an iterator of its own", walk(set));
  const named = mapOf(2);
  named.label = "more";
  show("a map with another property", pairs(named));
  const array = [1, 2, 3];
  array[Symbol.iterator] = function* () { yield "own"; };
  show("an array with an iterator of its own", walk(array));
  const labelled = [1, 2];
  labelled.label = "more";
  show("an array with another property", walk(labelled));
}
{
  class Doubled extends Map { *[Symbol.iterator]() { for (const key of super.keys()) yield [key, key]; } }
  class Plain extends Map {}
  class Backwards extends Set { [Symbol.iterator]() { return [...super.values()].reverse()[Symbol.iterator](); } }
  class List extends Array { *[Symbol.iterator]() { yield this.length; } }
  class Same extends Array {}
  show("a subclass of Map with an iterator", pairs(new Doubled([["a", 1], ["b", 2]])));
  show("a subclass of Map without one", pairs(new Plain([["a", 1], ["b", 2]])));
  show("a subclass of Set with an iterator", walk(new Backwards(["a", "b", "c"])));
  show("a subclass of Array with an iterator", walk(List.of(4, 5, 6)));
  show("a subclass of Array without one", walk(Same.of(4, 5, 6)));
}
{
  const map = mapOf(2);
  Object.setPrototypeOf(map, { [Symbol.iterator]: function* () { yield ["from the prototype", this instanceof Map]; } });
  show("a map under another prototype", pairs(map));
  const bare = mapOf(2);
  Object.setPrototypeOf(bare, null);
  attempt("a map without a prototype", () => pairs(bare));
  const set = setOf(2);
  Object.setPrototypeOf(set, Object.create(Set.prototype, { [Symbol.iterator]: { value: () => ["between"][Symbol.iterator]() } }));
  show("a set under a prototype between", walk(set));
  const array = [1, 2];
  Object.setPrototypeOf(array, { [Symbol.iterator]: function* () { yield "from the prototype"; } });
  show("an array under another prototype", walk(array));
  const borrowed = { [Symbol.iterator]: Map.prototype[Symbol.iterator] };
  attempt("the iterator of maps on another object", () => pairs(borrowed));
}
{
  const changing = mapOf(4), seen = [];
  for (const [key] of changing) { seen.push(key); if (key === "k1") changing[Symbol.iterator] = function* () { yield ["late", 0]; }; }
  show("an iterator of its own given during the walk", seen.join(" ") + " then " + pairs(changing));
}
show("arrays", [walk([]), walk([1]), walk([1, , 3]), walk([1.5, 2.5]), walk(["a", {}, null]), walk(Array(3)), walk(Object.freeze([1, 2]))].join(" | "));
show("an array grows and shrinks", walk([1, 2, 3], (value, array) => { if (value === 1) array.push(4); if (value === 2) array.length = 3; }));
show("other things", [walk("héllo"), walk(new Uint8Array([1, 2])), walk(mapOf(2).keys()), walk(mapOf(2).values()), walk(mapOf(2).entries()), walk(setOf(2).values()), walk(setOf(2).entries()), walk((function () { return arguments; })(1, 2))].join(" | "));
for (const nothing of [undefined, null, 1, true, {}, () => 1, Symbol.iterator]) attempt("not iterable: " + text(nothing), () => walk(nothing));
console.log(said.join("\n"));

// GENERATED: attempt numbers mixed Doubled value
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="show"
// CHECK-NEXT: v4 = Call v1 calleeName="f"
// CHECK-NEXT: v5 = Call v3, -, v0, v4 calleeName="show"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v6 = CatchValue
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="show"
// CHECK-NEXT: v9 = PropGet v6 key="constructor"
// CHECK-NEXT: v10 = PropGet v9 key="name"
// CHECK-NEXT: v11 = Call v8, -, v0, v10 calleeName="show"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="numbers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer integer=7
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mixed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|number|string|symbol flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer integer=3
// CHECK-NEXT: v3 = Mod v1, v2
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = StrictEq v3, v4
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = String string="k"
// CHECK-NEXT: v7 = Add v6, v1
// CHECK-NEXT: Jump -> next b5(v7)
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Integer integer=3
// CHECK-NEXT: v9 = Mod v1, v8
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: v11 = StrictEq v9, v10
// CHECK-NEXT: Branch v11 -> taken b4(), notTaken b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5(v1)
// CHECK-NEXT: b5(v12):
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|number|string|symbol flags=[IsExpected]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b6():
// CHECK-NEXT: v14 = Builtin builtin=Symbol
// CHECK-NEXT: v15 = Builtin builtin=SymbolFor
// CHECK-NEXT: v16 = String string="s"
// CHECK-NEXT: v17 = Add v16, v1
// CHECK-NEXT: v18 = Call v15, v14, v17 calleeName="Symbol.for"
// CHECK-NEXT: ReturnCall v18 casts=[{declared={type=undefined|null|number|string|symbol flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Doubled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="value"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|[[L_6]]|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_7]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key=@@iterator
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1 calleeKey=@@iterator
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_6]]|Generator flags=[IsExpected]}}]
// CHECK-NEXT: }
