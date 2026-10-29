// RUN: lower
// OPTIONS: builtin-modules

// A field of small integers of an object literal gets other values out of sight.
function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "array(" + value.length + ")";
  if (typeof value === "object" && value !== null) return "object";
  return String(value);
}

function attempt(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

const makers = {
  literal: start => ({ count: start, step: 1 }),
};

function readCount(counter) {
  return counter.count;
}

function addToCount(counter) {
  return counter.count + counter.step;
}

function maskCount(counter) {
  return counter.count | 0;
}

function kindOfCount(counter) {
  return typeof counter.count;
}

function sumCounts(counters) {
  let total = 0;
  for (let i = 0; i < counters.length; i++) total += counters[i].count;
  return total;
}

const name = JSON.parse('"count"');
const storeMadeAtRunTime = new Function("counter", "value", "counter.count = value;");

const writers = {
  "a computed name": (counter, value) => {
    counter[name] = value;
  },
  "Reflect.set": (counter, value) => {
    Reflect.set(counter, name, value);
  },
  "Object.assign": (counter, value) => {
    Object.assign(counter, { [name]: value });
  },
  "Object.defineProperty": (counter, value) => {
    Object.defineProperty(counter, name, { value });
  },
  "a function made at run time": (counter, value) => {
    storeMadeAtRunTime(counter, value);
  },
  "a destructuring assignment": (counter, value) => {
    [counter[name]] = [value];
  },
  "the head of a for-of loop": (counter, value) => {
    for (counter[name] of [value]);
  },
  "Object.entries and a loop": (counter, value) => {
    for (const [key, entry] of Object.entries({ [name]: value })) counter[key] = entry;
  },
};

const values = [
  1.5,
  -0,
  NaN,
  Infinity,
  2147483647,
  2147483648,
  -2147483648,
  -2147483647,
  -2147483646,
  -2147483645,
  -2147483644,
  -2147483643,
  -2147483649,
  4294967296,
  "7",
  "",
  true,
  null,
  undefined,
  10n,
  Symbol.iterator,
  [3],
  { valueOf: () => 9 },
  () => 1,
];

for (const [made, make] of Object.entries(makers)) {
  const honest = [];
  for (let i = 0; i < 2000; i++) honest.push(make(i & 1023));
  console.log(made, "honest sum", sumCounts(honest));
  let checks = 0;
  for (const counter of honest)
    checks += readCount(counter) + addToCount(counter) + maskCount(counter) + kindOfCount(counter).length;
  console.log(made, "honest checks", checks);

  for (const [way, write] of Object.entries(writers)) {
    for (const value of values) {
      const counter = make(5);
      const outcome = attempt(() => write(counter, value));
      console.log(
        made + ",",
        way + ",",
        show(value) + ":",
        outcome === "undefined" ? "stored" : outcome,
        "read",
        attempt(() => readCount(counter)),
        "added",
        attempt(() => addToCount(counter)),
        "masked",
        attempt(() => maskCount(counter)),
        "typeof",
        attempt(() => kindOfCount(counter)),
        "keys",
        Object.keys(counter).join(),
        "own",
        Object.hasOwn(counter, "count"),
      );
    }
  }

  const mixed = [make(1), make(2), make(3)];
  writers["a computed name"](mixed[1], 0.25);
  console.log(made, "a sum over three with a fraction in the middle", sumCounts(mixed));
  writers["a computed name"](mixed[1], "x");
  console.log(made, "a sum over three with a string in the middle", show(sumCounts(mixed)));
  writers["a computed name"](mixed[1], 4);
  console.log(made, "a sum over three honest ones again", sumCounts(mixed));
}

// GENERATED: maskCount sumCounts Reflect.set Object.assign Object.defineProperty valueOf
// CHECK-LABEL: function {{*}}name="maskCount"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="count"
// CHECK-NEXT: v2 = Convert v1 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = BitOr v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sumCounts"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|number|string|symbol|bigint|[[L_1]]> flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|number|string|symbol|bigint|[[L_1]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = PropGet v0 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Less v6, v9
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = ElemGet v0, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="count"
// CHECK-NEXT: v15 = Add v5, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v17 = Increment v11
// CHECK-NEXT: v18 = Convert v17 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v16, v18)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v20 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Reflect.set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Reflect
// CHECK-NEXT: v3 = Builtin builtin=ReflectSet
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="name"
// CHECK-NEXT: v6 = Call v3, v2, v0, v5, v1 calleeName="Reflect.set"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Object.assign"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v4 = NewDictionary
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="name"
// CHECK-NEXT: v7 = ToPropertyKey v6
// CHECK-NEXT: ElemDefine v4, v7, v1
// CHECK-NEXT: v9 = Call v3, v2, v0, v4 calleeName="Object.assign"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Object.defineProperty"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="name"
// CHECK-NEXT: v6 = NewObject -, v1 layout=[[L_6]] fields=[4]
// CHECK-NEXT: v7 = FinishObject v6
// CHECK-NEXT: v8 = Call v3, v2, v0, v5, v7 calleeName="Object.defineProperty"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=9
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
