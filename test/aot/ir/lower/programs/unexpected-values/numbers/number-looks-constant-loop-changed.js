// RUN: lower
// OPTIONS: builtin-modules

// A number that looks constant in a loop is changed by a callee.
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function nothing() {}

function capturedVariable(rounds, at, replacement) {
  let factor = 2;
  const change = () => {
    factor = replacement;
  };
  const seen = [];
  for (let i = 0; i < rounds; i++) {
    seen.push(factor * 3, factor | 0, factor + 1);
    (i === at ? change : nothing)();
  }
  return seen;
}

function memberOfAnObject(rounds, at, replacement) {
  const holder = { factor: 2 };
  const change = target => {
    target.factor = replacement;
  };
  const seen = [];
  for (let i = 0; i < rounds; i++) {
    seen.push(holder.factor * 3, holder.factor | 0, holder.factor + 1);
    (i === at ? change : nothing)(holder);
  }
  return seen;
}

function elementOfAnArray(rounds, at, replacement) {
  const list = [2, 4];
  const change = target => {
    target[0] = replacement;
  };
  const seen = [];
  for (let i = 0; i < rounds; i++) {
    seen.push(list[0] * 3, list[0] | 0, list[0] + 1);
    (i === at ? change : nothing)(list);
  }
  return seen;
}

function lengthOfAnArray(rounds, at, replacement) {
  const list = [1, 2, 3, 4];
  const change = target => {
    target.length = replacement;
  };
  const seen = [];
  for (let i = 0; i < rounds; i++) {
    seen.push(list.length, list.length - 1, list[list.length - 1]);
    (i === at ? change : nothing)(list);
  }
  return seen;
}

let shared = 2;
function changeShared(value) {
  shared = value;
}

function moduleVariable(rounds, at, replacement) {
  shared = 2;
  const seen = [];
  for (let i = 0; i < rounds; i++) {
    seen.push(shared * 3, shared | 0, shared + 1);
    if (i === at) changeShared(replacement);
  }
  return seen;
}

function boundOfTheLoop(at, replacement) {
  const limits = { rounds: 6 };
  const change = target => {
    target.rounds = replacement;
  };
  const seen = [];
  for (let i = 0; i < limits.rounds; i++) {
    seen.push(i);
    (i === at ? change : nothing)(limits);
    if (seen.length === 9) break;
  }
  return seen;
}

function memberBehindAGetter(rounds, at, replacement) {
  let reads = 0;
  const holder = {
    get factor() {
      return reads++ > at * 3 + 2 ? replacement : 2;
    },
  };
  const seen = [];
  for (let i = 0; i < rounds; i++) seen.push(holder.factor * 3, holder.factor | 0, holder.factor + 1);
  return seen;
}

function conversionThatChanges(rounds, at, replacement) {
  let calls = 0;
  const factor = { valueOf: () => (calls++ > at * 3 + 2 ? replacement : 2) };
  const seen = [];
  for (let i = 0; i < rounds; i++) seen.push(factor * 3, factor | 0, factor + 1);
  return seen;
}

for (let i = 0; i < 1000; i++) {
  capturedVariable(3, 1, 3);
  memberOfAnObject(3, 1, 3);
  elementOfAnArray(3, 1, 3);
  lengthOfAnArray(3, 1, 3);
  moduleVariable(3, 1, 3);
  boundOfTheLoop(1, 4);
  memberBehindAGetter(3, 1, 3);
  conversionThatChanges(3, 1, 3);
}

for (const replacement of [5, "5", "", 0.5, -0, null, undefined, true, 5n, NaN, 2147483647, 2147483648, [5], { valueOf: () => 5 }, Symbol("s")]) {
  const label = show(replacement);
  attempt("capturedVariable becomes " + label, () => capturedVariable(3, 1, replacement));
  attempt("memberOfAnObject becomes " + label, () => memberOfAnObject(3, 1, replacement));
  attempt("elementOfAnArray becomes " + label, () => elementOfAnArray(3, 1, replacement));
  attempt("moduleVariable becomes " + label, () => moduleVariable(3, 1, replacement));
  attempt("memberBehindAGetter becomes " + label, () => memberBehindAGetter(3, 1, replacement));
  attempt("conversionThatChanges becomes " + label, () => conversionThatChanges(3, 1, replacement));
  attempt("boundOfTheLoop becomes " + label, () => boundOfTheLoop(1, replacement));
}
for (const replacement of [0, 1, 2, 6, "2", 2.5, -1, null, 4294967295]) attempt("lengthOfAnArray becomes " + show(replacement), () => lengthOfAnArray(3, 1, replacement));

// GENERATED: memberBehindAGetter attempt factor
// CHECK-LABEL: function {{*}}name="memberBehindAGetter"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=undefined|null|boolean|number|string|symbol|bigint|[[L_1]]|Array<number> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: undefined|null|boolean|number|string|symbol|bigint|[[L_1]]|Array<number>):
// CHECK-NEXT: v3 = NewObject -, v1, v2 layout=[[L_2]] fields=[0, 1]
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v3, v5 layout=[[L_2]] field=2
// CHECK-NEXT: v7 = NewObject layout=[[L_3]]
// CHECK-NEXT: v8 = NewClosure v3 function=[[f_4]]
// CHECK-NEXT: DefineGetter v7, v8 key="factor"
// CHECK-NEXT: v10 = FinishObject v7
// CHECK-NEXT: v11 = Data data=[[d_5]]
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = Convert v12 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v13)
// CHECK-NEXT: b1(v14):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v16 = Less v14, v0
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = PropGet v11 key="push"
// CHECK-NEXT: v18 = PropGet v10 key="factor"
// CHECK-NEXT: v19 = Integer integer=3
// CHECK-NEXT: v20 = Mul v18, v19
// CHECK-NEXT: v21 = PropGet v10 key="factor"
// CHECK-NEXT: v22 = Integer
// CHECK-NEXT: v23 = BitOr v21, v22
// CHECK-NEXT: v24 = PropGet v10 key="factor"
// CHECK-NEXT: v25 = Integer integer=1
// CHECK-NEXT: v26 = Add v24, v25
// CHECK-NEXT: v27 = Call v17, v11, v20, v23, v26 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v28 = Increment v14
// CHECK-NEXT: v29 = Convert v28 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v29)
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="->"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v9 = Call v8, -, v1 calleeName="outcome"
// CHECK-NEXT: v10 = Call v6, v4, v0, v7, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="factor"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=env [[L_2]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_2]]):
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_2]] field=2
// CHECK-NEXT: v2 = CheckInitialized v1 name="reads"
// CHECK-NEXT: v3 = ToNumeric v2
// CHECK-NEXT: v4 = Increment v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_2]] field=2
// CHECK-NEXT: v7 = CheckInitialized v6 name="reads"
// CHECK-NEXT: PutEnvironmentField v0, v5 layout=[[L_2]] field=2
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v10 = Integer integer=3
// CHECK-NEXT: v11 = Mul v9, v10
// CHECK-NEXT: v12 = Integer integer=2
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: v14 = Greater v3, v13
// CHECK-NEXT: Branch v14 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v15 = GetEnvironmentField v0 layout=[[L_2]] field=1
// CHECK-NEXT: Jump -> next b3(v15)
// CHECK-NEXT: b2():
// CHECK-NEXT: v16 = Integer integer=2
// CHECK-NEXT: Jump -> next b3(v16)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
