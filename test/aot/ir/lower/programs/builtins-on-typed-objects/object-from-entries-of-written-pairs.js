// RUN: lower
// OPTIONS: builtin-modules

// Object.fromEntries of pairs that are written in the call: computed keys, equal keys, __proto__, order of evaluation, holes, spreads and pairs that are no lists.
const log = [];
const note = (label, value) => (log.push(label), value);
const show = (label, object) => {
  const own = Reflect.ownKeys(object).map(key => `${String(key)}=${JSON.stringify(Object.getOwnPropertyDescriptor(object, key))}`);
  console.log(label, own.join(" "), "|", Object.getPrototypeOf(object) === Object.prototype, "|", log.splice(0).join());
};
const attempt = (label, run) => {
  try {
    show(label, run());
  } catch (error) {
    console.log(label, "throws", error.constructor.name, error.message.replace(/ \(evaluating.*$/, ""), "|", log.splice(0).join());
  }
};

attempt("two names", () => Object.fromEntries([["x", note("x", 1)], ["y", note("y", 2)]]));
attempt("order of evaluation", () => Object.fromEntries([[note("k1", "a"), note("v1", 1)], [note("k2", "b"), note("v2", 2)]]));
attempt("a name twice", () => Object.fromEntries([["a", 1], ["b", 2], ["a", 3]]));
attempt("a name twice, by a variable", () => { const k = "a"; return Object.fromEntries([[k, 1], ["b", 2], [k, 3]]); });
attempt("__proto__ is an own property", () => Object.fromEntries([["__proto__", { inherited: 1 }], ["b", 2]]));
attempt("__proto__ by a variable", () => { const k = ["__pro", "to__"].join(""); return Object.fromEntries([[k, null]]); });
attempt("indexes come first", () => Object.fromEntries([["b", 1], [2, "two"], ["a", 2], ["1", "one"], [0, "zero"]]));
attempt("numbers that are no indexes", () => Object.fromEntries([[1.5, 1], [-1, 2], [4294967295, 3], [4294967294, 4], [1e21, 5], [-0, 6], [NaN, 7]]));
attempt("symbols", () => Object.fromEntries([[Symbol.iterator, 1], ["a", 2], [Symbol.for("shared"), 3], [Symbol.toStringTag, "Tag"]]));
attempt("keys that are no strings", () => Object.fromEntries([[null, 1], [undefined, 2], [true, 3], [10n, 4], [[1, 2], 5], [{}, 6]]));
attempt("names of Object.prototype", () => Object.fromEntries([["toString", 1], ["constructor", 2], ["hasOwnProperty", 3], ["valueOf", 4]]));
attempt("more than two in a pair", () => Object.fromEntries([["a", note("v", 1), note("third", 2), note("fourth", 3)], ["b", note("w", 4)]]));
attempt("a pair of one", () => Object.fromEntries([["a"], ["b", 2]]));
attempt("an empty pair", () => Object.fromEntries([[], ["b", 2]]));
attempt("a hole for the key", () => Object.fromEntries([[, 1], ["b", 2]]));
attempt("a hole for the value", () => Object.fromEntries([["a", , 3]]));
attempt("a hole for a pair", () => Object.fromEntries([["a", 1], , ["b", 2]]));
attempt("a spread in a pair", () => Object.fromEntries([[...["a", 1]], ["b", 2]]));
attempt("a spread of pairs", () => Object.fromEntries([...[["a", 1]], ["b", 2]]));
attempt("no pair", () => Object.fromEntries([]));
attempt("a string for a pair", () => Object.fromEntries(["ab", ["c", 1]]));
attempt("a number for a pair", () => Object.fromEntries([["a", 1], 5]));
attempt("two arguments", () => Object.fromEntries([["a", 1]], note("second", 2)));
attempt("no argument", () => Object.fromEntries());

const keyThat = (label, text) => ({ toString: () => note(label, text) });
attempt("keys are converted behind every expression", () => Object.fromEntries([[keyThat("convert a", "a"), note("v1", 1)], [keyThat("convert b", "b"), note("v2", 2)]]));
attempt("Symbol.toPrimitive of a key", () => Object.fromEntries([[{ [Symbol.toPrimitive]: hint => note("hint " + hint, "p") }, note("v", 1)]]));
attempt("a key that cannot be converted", () => Object.fromEntries([["a", note("v1", 1)], [{ toString() { note("convert"); throw new RangeError("no key"); } }, note("v2", 2)], [keyThat("never", "c"), note("v3", 3)]]));
attempt("a value that throws", () => Object.fromEntries([[keyThat("never", "a"), note("v1", 1)], ["b", (() => { throw new RangeError("no value"); })()], ["c", note("never", 3)]]));
attempt("a key without a primitive", () => Object.fromEntries([[Object.create(null), 1]]));

const functions = Object.fromEntries([["arrow", () => 1], ["plain", function () {}], ["named", function own() {}], ["klass", class {}]]);
console.log("functions get no name from the key", Object.keys(functions).map(key => JSON.stringify(functions[key].name)).join());

const made = [1, 2, 3].map(n => Object.fromEntries([["n", n], ["square", n * n]]));
made[0].extra = true;
delete made[1].n;
console.log("each evaluation makes its own", JSON.stringify(made), made[0] !== made[1]);

function withConditions(flag, other) {
  return Object.fromEntries([["a", flag ? note("yes", 1) : note("no", 2)], [flag ? "b" : "c", other ?? note("default", 0)], ["d", flag && other]]);
}
attempt("conditions among the values", () => withConditions(true, undefined));
attempt("conditions among the values, the other way", () => withConditions(false, 7));

function* yields() {
  return Object.fromEntries([["first", yield 1], ["second", yield 2]]);
}
const generator = yields();
generator.next();
generator.next("one");
console.log("values that are yielded", JSON.stringify(generator.next("two").value));

(async () => {
  const awaited = Object.fromEntries([["a", await Promise.resolve(1)], [await Promise.resolve("b"), 2]]);
  console.log("values that are awaited", JSON.stringify(awaited));
})();

{
  const Object = { fromEntries: list => "a function of the program: " + list.length };
  console.log("another Object", Object.fromEntries([["a", 1], ["b", 2]]));
}
function shadowed(Object) {
  return Object.fromEntries([["a", 1]]);
}
console.log("a parameter named Object", shadowed({ fromEntries: list => list[0].join("=") }));
const { fromEntries } = Object;
attempt("the function in a variable", () => fromEntries([["a", 1], ["b", 2]]));
attempt("called with call", () => Object.fromEntries.call(null, [["a", 1]]));
attempt("an optional call", () => Object.fromEntries?.([["a", 1]]));
attempt("by a computed name", () => Object["fromEntries"]([["a", 1], ["b", note("b", 2)]]));
attempt("through globalThis", () => globalThis.Object.fromEntries([["a", 1]]));

const list = [["a", 1], ["b", 2]];
attempt("a list that somebody else holds", () => Object.fromEntries(list));
const pair = ["a", 1];
attempt("a pair that somebody else holds", () => Object.fromEntries([pair, ["b", 2]]));

const frozen = Object.freeze(Object.fromEntries([["a", 1]]));
console.log("frozen at once", Object.isFrozen(frozen), JSON.stringify(frozen));
const nested = Object.fromEntries([["inner", Object.fromEntries([["deep", Object.fromEntries([["x", 1]])]])], ["list", [Object.fromEntries([["y", 2]])]]]);
console.log("one in another", JSON.stringify(nested));
let reads = 0;
for (let turn = 0; turn < 2000; turn++) {
  const point = Object.fromEntries([["x", turn], ["y", turn + 1]]);
  reads += point.x + point.y + ("z" in point ? 1 : 0);
}
console.log("read by name", reads);

// GENERATED: yields show [Symbol.toPrimitive]
// CHECK-LABEL: function {{*}}name="yields"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<int[1, 2]> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Builtin builtin=ObjectFromEntries
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Convert v4 declared={type=int[1, 2] flags=[IsExpected]}
// CHECK-NEXT: v6 = Yield v5
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Switch v8 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v7
// CHECK-NEXT: b4():
// CHECK-NEXT: v9 = Integer integer=2
// CHECK-NEXT: v10 = Convert v9 declared={type=int[1, 2] flags=[IsExpected]}
// CHECK-NEXT: v11 = Yield v10
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: Switch v13 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v12
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v12
// CHECK-NEXT: b7():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: v15 = NewObject -, v7, v12 layout=[[L_1]] fields=[0, 1]
// CHECK-NEXT: v16 = FinishObject v15
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Reflect
// CHECK-NEXT: v3 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v4 = Call v3, v2, v1 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="map"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v8 = NewClosure v1 function=[[f_4]]
// CHECK-NEXT: v9 = Call v7, v5, v8 calleeKey="map" calleeName="map"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v10 key="join"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v18 = String string=" "
// CHECK-NEXT: v19 = Call v17, v10, v18 calleeKey="join" calleeName="own.join"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v21 = String string="|"
// CHECK-NEXT: v22 = Builtin builtin=Object
// CHECK-NEXT: v23 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v24 = Call v23, v22, v1 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v25 = Builtin builtin=ObjectPrototype
// CHECK-NEXT: v26 = StrictEq v24, v25
// CHECK-NEXT: v27 = String string="|"
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v29 = CheckInitialized v28 name="log"
// CHECK-NEXT: v30 = PropGet v29 key="splice"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v32 = Integer
// CHECK-NEXT: v33 = Call v31, v29, v32 calleeKey="splice" calleeName="log.splice"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v34 key="join"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v37 = Call v36, v34 calleeKey="join" calleeName="join"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v39 = Call v15, v13, v0, v20, v21, v26, v27, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.toPrimitive]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsNamedByComputedKey] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="note"
// CHECK-NEXT: v3 = String string="hint "
// CHECK-NEXT: v4 = Add v3, v0
// CHECK-NEXT: v5 = String string="p"
// CHECK-NEXT: v6 = Call v2, -, v4, v5 calleeName="note"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: }
