// RUN: lower
// OPTIONS: builtin-modules

// Built-ins entered in every way but a plain call: as callbacks of other built-ins (map, forEach with a receiver, then, reduce, replace, JSON), through call | apply | Reflect.apply | Reflect.construct, bound with and without operands, constructed through a bound function, getters and setters of the table called by hand.
function show(label, ...values) { console.log(label, ...values); }
function attempt(label, run) {
  try { run(); } catch (error) { console.log(label, "throws", error.constructor.name); }
}
attempt("Object as a callback", () => {
  const first = { a: 1 };
  const mapped = [first, 5, "t"].map(Object);
  mapped[0].extra = 1;
  show("Object as a callback", mapped[0] === first, first.extra, mapped[1] instanceof Number, mapped[2] instanceof String, typeof mapped[1]);
});
attempt("Object.freeze as a callback", () => {
  const first = { a: 1 };
  const mapped = [first].map(Object.freeze);
  show("Object.freeze as a callback", mapped[0] === first, Object.isFrozen(first));
});
attempt("Array as a callback", () => {
  const mapped = ["x"].map(Array);
  show("Array as a callback", mapped[0].length, mapped[0][0], mapped[0][1], Array.isArray(mapped[0][2]), mapped[0][2][0]);
});
attempt("Number and parseInt as callbacks", () => {
  show("Number and parseInt as callbacks", ["1", "2", "3"].map(Number).join(), ["1", "2", "3"].map(parseInt).join(), ["a", ""].map(Boolean).join(), [1, 2].map(String).join("|"));
});
attempt("methods with a receiver as callbacks", () => {
  const set = new Set();
  [1, 2, 2].forEach(set.add, set);
  const map = new Map();
  const key = { key: true };
  new Map([[key, 1]]).forEach(map.set, map);
  const weak = new WeakSet();
  [key].forEach(weak.add, weak);
  show("methods with a receiver as callbacks", set.size, map.size, map.get(1) === key, weak.has(key));
  const list = [];
  [1, 2].forEach(list.push, list);
  show("push as a callback", list.length, list[0], list[1], Array.isArray(list[2]));
});
attempt("a method without its receiver", () => [1].forEach(new Set().add));
attempt("handlers of promises", async () => {
  const held = { held: true };
  const got = await Promise.resolve(held).then(Object);
  got.extra = 1;
  const frozen = await Promise.resolve(held).then(Object.freeze);
  const listed = await Promise.resolve(3).then(Array);
  const wrapped = await Promise.resolve(held).then(Promise.resolve.bind(Promise));
  const keys = await Promise.resolve(held).then(Object.keys);
  show("handlers of promises", got === held, held.extra, frozen === held, Object.isFrozen(held), listed.length, wrapped === held, keys.join());
});
attempt("Reflect.apply and call of built-ins", () => {
  const held = { held: true };
  show("Reflect.apply", Reflect.apply(Object, undefined, [held]) === held, Reflect.apply(Object.freeze, null, [held]) === held, Reflect.apply(Array.prototype.reverse, held, []) === held,
    Reflect.apply(Map.prototype.set, new Map(), [1, held]).get(1) === held);
  show("call and apply", Object.call(null, held) === held, Object.apply(null, [held]) === held, Array.prototype.sort.call(held) === held, Function.prototype.call.call(Object, null, held) === held,
    Function.prototype.apply.call(Object, null, [held]) === held, Reflect.apply(Function.prototype.call, Object, [null, held]) === held);
});
attempt("bound built-ins", () => {
  const held = { held: true };
  const same = Object.bind(null);
  const withOperand = Object.bind(null, held);
  const define = Object.defineProperty.bind(Object);
  const freeze = Object.freeze.bind(Object, held);
  show("bound built-ins", same(held) === held, withOperand() === held, withOperand(5) === held, define(held, "x", { value: 1 }) === held, held.x, freeze() === held);
  const made = new same(held);
  const madeWith = new withOperand();
  show("bound built-ins constructed", made === held, madeWith === held);
  class Below extends same { tag = 1; constructor(value) { super(value); } }
  const below = new Below(held);
  show("a class below a bound Object", below === held, below.tag, held.tag);
});
attempt("constructors as callbacks", () => {
  const pairs = [[1, 2]];
  const maps = [pairs].map(list => Reflect.construct(Map, [list]));
  const construct = Reflect.construct.bind(null, Object);
  const held = { held: true };
  show("constructors as callbacks", maps[0].get(1), construct([held]) === held, construct([held], function Other() {}) === held);
  show("Array.from with a built-in", Array.from([held], Object)[0] === held, Array.from("ab", String.prototype.toUpperCase.call.bind(String.prototype.toUpperCase)).join());
});
attempt("sort and reduce with built-ins", () => {
  const held = { held: true };
  show("reduce", [held].reduce(Object.assign, {}).held, [1, 5, 3].reduce(Math.max), [[1], [2]].reduce(Function.prototype.call.bind(Array.prototype.concat)).length);
  show("replace", "a-b".replace("-", String), "ab".replace(/b/, Object) , "x".replace("x", Array));
  show("JSON", JSON.stringify({ a: 1 }, Array), JSON.parse("[1]", Object) instanceof String, JSON.stringify([held], (key, value) => value));
});
attempt("getters and setters of the table called by hand", () => {
  const size = Object.getOwnPropertyDescriptor(Map.prototype, "size").get;
  const proto = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__");
  const held = { held: true };
  const above = { above: true };
  show("getters by hand", size.call(new Map([[1, 2]])), proto.get.call(held) === Object.prototype, proto.set.call(held, above), held.above, [new Map([[1, 1]])].map(Function.prototype.call.bind(size)).join());
});
attempt("a getter on the wrong receiver", () => Object.getOwnPropertyDescriptor(Map.prototype, "size").get.call(new Set()));

// GENERATED: show attempt Below Other
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}, {type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = NewArray v0 contents=anything
// CHECK-NEXT: AppendSpread v7, v1
// CHECK-NEXT: v9 = CallList v6, v4, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Call v1 calleeName="run"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="throws"
// CHECK-NEXT: v10 = PropGet v3 key="constructor"
// CHECK-NEXT: v11 = PropGet v10 key="name"
// CHECK-NEXT: v12 = Call v8, v6, v0, v9, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Below"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1, v2 layout=[[L_1]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b10(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = CallDirect v6 function=[[f_2]]
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: v11 = TypeTest v10 testedType=object
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b8(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = TypeTest v13 testedType=undefined
// CHECK-NEXT: Branch v14 -> taken b5(| 0), notTaken b9(| 0)
// CHECK-NEXT: b5(v15):
// CHECK-NEXT: v16 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v16 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v17) frequency=Unlikely:
// CHECK-NEXT: v18 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v18
// CHECK-NEXT: b7(v19):
// CHECK-NEXT: Jump -> next b8(v19)
// CHECK-NEXT: b8(v20):
// CHECK-NEXT: Return v20
// CHECK-NEXT: b9(v21) frequency=Unlikely:
// CHECK-NEXT: v22 = NewRuntimeError runtimeError=DerivedConstructorResult name="Below"
// CHECK-NEXT: Throw v22
// CHECK-NEXT: b10(v23) frequency=Unlikely:
// CHECK-NEXT: v24 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Other"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
