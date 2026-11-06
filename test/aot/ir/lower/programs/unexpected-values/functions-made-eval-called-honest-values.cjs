// RUN: lower
// OPTIONS: builtin-modules

// Functions made by eval are called with honest values and lookalikes.
const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

const arrays = [
  ["an array", () => [5, 6]],
  ["a subclass", () => Odd.of(5, 6)],
  ["an array-like", () => ({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })],
  ["a proxy", () => logged([5, 6])],
  ["a frozen array", () => Object.freeze([5, 6])],
  ["a string", () => "ab"],
];

const strings = [
  ["a string", () => "abc"],
  ["an object with charCodeAt", () => ({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })],
  ["a String object with its own charCodeAt", () => Object.assign(new String("xyz"), { charCodeAt: () => -1 })],
  ["an array", () => ["abc"]],
  ["a number", () => 65],
];

const numbers = [
  ["an integer", () => 7],
  ["a string", () => "3"],
  ["an object with valueOf", () => ({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })],
  ["a bigint", () => 10n],
  ["the largest int32", () => 2147483647],
  ["minus zero", () => -0],
  ["undefined", () => undefined],
];

const functions = [
  ["a function", () => x => x + 1],
  ["a class", () => class Made { constructor(x) { log.push("constructed " + x); } }],
  ["a callable proxy", () => logged(x => x + 2)],
  ["a bound function", () => function (a, b) { return [this.tag, a, b]; }.bind({ tag: "bound" }, "first")],
  ["an object with call", () => ({ call() { log.push("call"); return "called"; } })],
];

const objects = [
  ["an object", () => ({ x: 1, y: 2 })],
  ["accessors", () => ({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })],
  ["a proxy", () => logged({ y: 2, x: 1 })],
  ["a frozen object", () => Object.freeze({ x: 5, y: 6 })],
  ["texts in another order", () => ({ y: "2", x: "1" })],
  ["inherited members", () => Object.create({ x: 3, y: 4 })],
];

const decoded = text => Buffer.from(text).toString();

const pushes = eval(decoded("(function (a) { a.push(1); return a.length; })"));

const iterates = eval(decoded("(function (a) { const seen = []; for (const x of a) seen.push(x); return seen; })"));

const readsCharCode = eval(decoded("(function (s) { return s.charCodeAt(0); })"));

const truncates = eval(decoded("(function (n) { return n | 0; })"));

const addsOne = eval(decoded("(function (n) { return n + 1; })"));

const calls = eval(decoded("(function (f) { return f(1); })"));

const addsMembers = eval(decoded("(function (o) { return o.x + o.y; })"));

const storesMember = eval(decoded("(function (o) { o.x = 1; return o; })"));

const table = [
  ["pushes", pushes, arrays],
  ["iterates", iterates, arrays],
  ["readsCharCode", readsCharCode, strings],
  ["truncates", truncates, numbers],
  ["addsOne", addsOne, numbers],
  ["calls", calls, functions],
  ["addsMembers", addsMembers, objects],
  ["storesMember", storesMember, objects],
];

function everyCase(round) {
  for (const [name, use, values] of table) {
    for (const [label, make] of [...values, values[0]]) attempt(round + " " + name + " " + label, () => use(make()));
  }
}

console.log("strict:", (function () { return this === undefined; })());
everyCase("at first");
for (let i = 0; i < 2000; i++) {
  pushes([5, 6]);
  iterates([5, 6]);
  readsCharCode("abc");
  truncates(7);
  addsOne(7);
  calls(x => x + 1);
  addsMembers(({ x: 1, y: 2 }));
  storesMember(({ x: 1, y: 2 }));
}
everyCase("after 2000");

// GENERATED: Odd decoded apply y
// CHECK-LABEL: function {{*}}name="Odd"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="decoded"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 captures=[{type=object flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: object, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ScopeHasBinding v0 key="Buffer"
// CHECK-NEXT: Branch v2 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Jump -> next b4(v0, v3)
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Jump -> next b4(v4, v4)
// CHECK-NEXT: b4(v5, v6):
// CHECK-NEXT: v7 = TypeTest v5 testedType=object
// CHECK-NEXT: Branch v7 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v8):
// CHECK-NEXT: v9 = PropGet v8 key="Buffer"
// CHECK-NEXT: Jump -> next b7(v9)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="Buffer" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Buffer) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v13)
// CHECK-NEXT: b7(v14):
// CHECK-NEXT: v15 = PropGet v14 key="from"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(BufferFrom) flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v16, v14, v1 calleeKey="from" calleeName="Buffer.from"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|Buffer flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="toString"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v21 = Call v20, v18 calleeKey="toString" calleeName="toString"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="apply"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] length=3 captures=[{type=env [[L_5]] flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|[[f_6]] flags=[IsExpected]}, {type=anything}, {type=undefined|null|Array flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: env [[L_5]], v1: object, v2: undefined|null|[[f_6]], v3: anything, v4: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_5]] field=5
// CHECK-NEXT: v6 = CheckInitialized v5 name="log"
// CHECK-NEXT: v7 = PropGet v6 key="push"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="apply "
// CHECK-NEXT: v10 = PropGet v4 key="length"
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v12 = Add v9, v11
// CHECK-NEXT: v13 = Call v8, v6, v12 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v14 = ScopeHasBinding v1 key="Reflect"
// CHECK-NEXT: Branch v14 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Jump -> next b4(v1, v15)
// CHECK-NEXT: b3():
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Jump -> next b4(v16, v16)
// CHECK-NEXT: b4(v17, v18):
// CHECK-NEXT: v19 = TypeTest v17 testedType=object
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: v21 = PropGet v20 key="Reflect"
// CHECK-NEXT: Jump -> next b7(v21)
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Reflect" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Reflect) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v25)
// CHECK-NEXT: b7(v26):
// CHECK-NEXT: v27 = PropGet v26 key="apply"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(ReflectApply) flags=[IsExpected]}
// CHECK-NEXT: v29 = Call v28, v26, v2, v3, v4 calleeKey="apply" calleeName="Reflect.apply"
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="y"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsSloppy, HasExplicitName] captures=[{type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="push"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="get y"
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = Integer integer=20
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
