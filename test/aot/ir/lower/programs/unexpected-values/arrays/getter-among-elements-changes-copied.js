// RUN: lower
// OPTIONS: builtin-modules

// A getter among the elements changes the array while it is copied.
function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

const uses = {
  spread: list => [...list],
  spreadBetween: list => ["before", ...list, "after"],
  spreadTwice: list => [...list, ...list],
  spreadIntoACall: list => ((...values) => values)(...list),
  pushAll(list) {
    const out = ["start"];
    out.push(...list);
    return out;
  },
  concat: list => [].concat(list),
  ownConcat: list => list.concat(["end"]),
  slice: list => list.slice(),
  from: list => Array.from(list),
  walk(list) {
    const seen = [];
    for (const value of list) {
      seen.push(value);
      if (seen.length === 10) break;
    }
    return seen;
  },
  byIndex(list) {
    const seen = [];
    for (let i = 0; i < list.length && i < 10; i++) seen.push(list[i]);
    return seen;
  },
  rest(list) {
    const [first, ...others] = list;
    return [first, others];
  },
  map: list => list.map(value => value),
  filter: list => list.filter(() => true),
  join: list => list.join(),
  json: list => JSON.stringify(list),
  toSorted: list => list.toSorted(),
  toReversed: list => list.toReversed(),
  flat: list => [list, list].flat(),
  values: list => Object.values(list),
  assign: list => Object.assign([], list),
  set: list => [...new Set(list)],
  apply: list => ((...values) => values).apply(null, list),
  includes: list => list.includes("pushed"),
  reduce: list => list.reduce((text, value) => text + "|" + value, ""),
};

const changes = {
  "pushes two": list => { list.push("pushed", "pushed too"); },
  "pops": list => { list.pop(); },
  "shrinks to two": list => { list.length = 2; },
  "empties": list => { list.length = 0; },
  "deletes the next": list => { delete list[2]; },
  "stores to the next": list => { list[2] = "stored"; },
  "stores a double to the next": list => { list[2] = 0.5; },
  "becomes a plain element": list => { Object.defineProperty(list, 1, { value: "plain", writable: true }); },
  "shifts": list => { list.shift(); },
  "reverses": list => { Object.defineProperty(list, 1, { value: "plain", writable: true }); list.reverse(); },
};

function make(change) {
  const list = [1, 2, 3, 4];
  let calls = 0;
  Object.defineProperty(list, 1, {
    get() {
      if (calls++ === 0) change(list);
      return "got";
    },
    enumerable: true,
    configurable: true,
  });
  return list;
}

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([1, 2, 3, 4]);

for (const use in uses) for (const change in changes) attempt(use + ", the getter " + change, () => uses[use](make(changes[change])));

// GENERATED: rest values reverses get
// CHECK-LABEL: function {{*}}name="rest"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=1 [isDestructuring, hasRest]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b9():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b9():
// CHECK-NEXT: v5 = NewArray contents=anything
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b9():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b5(), notTaken b8()
// CHECK-NEXT: b5() handler=b9():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v11 = NewArray v4, v5 contents=anything
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b8() handler=b9():
// CHECK-NEXT: AppendElement v5, v9
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b9() role=IterationCleanup subject=v1:
// CHECK-NEXT: v14 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="values"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string|object flags=[IsExpected]}] results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|string|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectValues
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.values"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|Array flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="reverses"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = String string="plain"
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: v7 = NewObject -, v4 layout=[[L_4]] fields=[4]
// CHECK-NEXT: PropDefine v7, v6 key="writable"
// CHECK-NEXT: v9 = FinishObject v7
// CHECK-NEXT: v10 = Call v2, v1, v0, v3, v9 calleeName="Object.defineProperty"
// CHECK-NEXT: v11 = PropGet v0 key="reverse"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12, v0 calleeKey="reverse" calleeName="list.reverse"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_5]] flags=[IsFromCompiler]}, {type=undefined|null|function flags=[IsExpected]}, {type=undefined|null|Array<number> flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: env [[L_5]], v1: undefined|null|function, v2: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_5]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="calls"
// CHECK-NEXT: v5 = ToNumeric v4
// CHECK-NEXT: v6 = Increment v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v8 = GetEnvironmentField v0 layout=[[L_5]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="calls"
// CHECK-NEXT: PutEnvironmentField v0, v7 layout=[[L_5]]
// CHECK-NEXT: v11 = Integer
// CHECK-NEXT: v12 = StrictEq v5, v11
// CHECK-NEXT: Branch v12 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v13 = Call v1, -, v2 calleeName="change"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = String string="got"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
