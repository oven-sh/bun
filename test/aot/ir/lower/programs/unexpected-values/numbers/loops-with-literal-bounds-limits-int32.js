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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = Call v0 calleeName="run"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|number|string|symbol|bigint|object flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v1, -, v3 calleeName="show"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v6 = CatchValue
// CHECK-NEXT: v7 = String string="threw "
// CHECK-NEXT: v8 = PropGet v6 key="constructor"
// CHECK-NEXT: v9 = PropGet v8 key="name"
// CHECK-NEXT: v10 = Add v7, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="unsignedBound"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<number> flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=4294967293
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v4)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = Integer integer=4294967295
// CHECK-NEXT: v8 = LessEq v5, v7
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b8(| 0)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v10 = PropGet v2 key="push"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = URShift v9, v12
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = BitOr v9, v14
// CHECK-NEXT: v16 = Call v11, v2, v9, v13, v15 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v17 = PropGet v2 key="length"
// CHECK-NEXT: v18 = Convert v17 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v19 = Integer integer=20
// CHECK-NEXT: v20 = Greater v18, v19
// CHECK-NEXT: Branch v20 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v21 = Increment v9
// CHECK-NEXT: v22 = Convert v21 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v22)
// CHECK-NEXT: b8(v23):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v24 = Convert v2 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="countsWithAConstant"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<number> flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=2147483647
// CHECK-NEXT: v1 = Convert v0 declared={type=2147483647 flags=[IsExpected]}
// CHECK-NEXT: v2 = Convert v1 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v3 = Increment v2
// CHECK-NEXT: v4 = Convert v3 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v5 = Negate v1
// CHECK-NEXT: v6 = Integer integer=-2147483647
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Sub v6, v7
// CHECK-NEXT: v9 = Integer integer=-2147483648
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Decrement v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v13 = Integer
// CHECK-NEXT: v14 = BitOr v4, v13
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = BitOr v12, v15
// CHECK-NEXT: v17 = NewArray v4, v12, v14, v16 contents=number
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
