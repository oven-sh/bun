// RUN: lower
// OPTIONS: builtin-modules

// Loops with literal bounds at the limits of int32.
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

function upToTheLargest() {
  const seen = [];
  for (let i = 2147483645; i <= 2147483647; i++) {
    seen.push(i);
    if (seen.length > 6) break;
  }
  return seen;
}

function pastTheLargest() {
  const seen = [];
  for (let i = 2147483645; i < 2147483650; i++) seen.push(i);
  return seen;
}

function downToTheSmallest() {
  const seen = [];
  for (let i = -2147483646; i >= -2147483648; i--) {
    seen.push(i);
    if (seen.length > 6) break;
  }
  return seen;
}

function pastTheSmallest() {
  const seen = [];
  for (let i = -2147483646; i > -2147483651; i--) seen.push(i);
  return seen;
}

function byThreeToTheLargest() {
  const seen = [];
  for (let i = 2147483640; i < 2147483647; i += 3) seen.push(i);
  return seen;
}

function afterTheLoop() {
  let i = 2147483645;
  for (; i <= 2147483647; i++);
  return [i, i | 0, i + 1];
}

function whileNotEqual() {
  let i = 2147483646;
  let rounds = 0;
  while (i !== 2147483649) {
    i++;
    rounds++;
    if (rounds > 6) break;
  }
  return [i, rounds];
}

function unsignedBound() {
  const seen = [];
  for (let i = 4294967293; i <= 4294967295; i++) {
    seen.push(i, i >>> 0, i | 0);
    if (seen.length > 20) break;
  }
  return seen;
}

function countsWithAConstant() {
  const LARGEST = 2147483647;
  let n = LARGEST;
  n++;
  let m = -LARGEST - 1;
  m--;
  return [n, m, n | 0, m | 0];
}

function sumsOfLargeIndexes() {
  let total = 0;
  for (let i = 2147483600; i < 2147483700; i++) total += i;
  return [total, total | 0];
}

function nestedCounters() {
  let count = 2147483640;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) count++;
  return [count, count | 0];
}

function halving() {
  const seen = [];
  for (let i = 5; i > 0; i /= 2) {
    seen.push(i);
    if (seen.length === 5) break;
  }
  return seen;
}

function halvingByAShift() {
  const seen = [];
  for (let i = -2147483648; i !== -1 && i !== 0; i >>= 8) seen.push(i);
  return seen;
}

function halvingByAnUnsignedShift() {
  const seen = [];
  for (let i = -2147483648; i !== 0; i >>>= 8) seen.push(i);
  return seen;
}

const uses = [upToTheLargest, pastTheLargest, downToTheSmallest, pastTheSmallest, byThreeToTheLargest, afterTheLoop, whileNotEqual, unsignedBound, countsWithAConstant, sumsOfLargeIndexes, nestedCounters, halving, halvingByAShift, halvingByAnUnsignedShift];
for (const round of ["first", "second"]) for (const use of uses) attempt(round + " " + use.name, use);

// GENERATED: outcome unsignedBound countsWithAConstant
// CHECK-LABEL: function {{*}}name="outcome"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = Call v0 calleeName="run"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="show"
// CHECK-NEXT: Return v3
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v4 = CatchValue
// CHECK-NEXT: v5 = String string="threw "
// CHECK-NEXT: v6 = PropGet v4 key="constructor"
// CHECK-NEXT: v7 = PropGet v6 key="name"
// CHECK-NEXT: v8 = Add v5, v7
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="unsignedBound"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_2]]
// CHECK-NEXT: v1 = Integer integer=4294967293
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v2)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = Integer integer=4294967295
// CHECK-NEXT: v6 = LessEq v3, v5
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = PropGet v0 key="push"
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = URShift v3, v8
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = BitOr v3, v10
// CHECK-NEXT: v12 = Call v7, v0, v3, v9, v11 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v13 = PropGet v0 key="length"
// CHECK-NEXT: v14 = Integer integer=20
// CHECK-NEXT: v15 = Greater v13, v14
// CHECK-NEXT: Branch v15 -> taken b4(), notTaken b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v16 = Increment v3
// CHECK-NEXT: v17 = Convert v16 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v17)
// CHECK-NEXT: b4():
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="countsWithAConstant"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=2147483647
// CHECK-NEXT: v1 = Convert v0 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v4 = Negate v0
// CHECK-NEXT: v5 = Integer integer=-2147483647
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = Sub v5, v6
// CHECK-NEXT: v8 = Integer integer=-2147483648
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Decrement v9
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = BitOr v3, v12
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = BitOr v11, v14
// CHECK-NEXT: v16 = NewArray v3, v11, v13, v15 contents=anything
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
