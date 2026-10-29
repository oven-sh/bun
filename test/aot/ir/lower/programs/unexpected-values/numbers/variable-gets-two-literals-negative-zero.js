// RUN: lower
// OPTIONS: builtin-modules

// A variable gets one of two literals and one is negative zero.
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

const marks = ["a", "b", "c", "d"];

function startsAsNegativeZero(flag) {
  let z = -0;
  if (flag) z = 1;
  return [z, 1 / z, marks[z], z | 0, Object.is(z, -0)];
}

function choosesNegativeZero(flag) {
  let z = 0;
  z = flag ? 1 : -0;
  return [z, 1 / z, marks[z], z | 0, Object.is(z, -0)];
}

function choosesAFraction(flag) {
  let n = 0;
  n = flag ? 1 : 0.5;
  return [n, marks[n], n | 0, n + 1];
}

function choosesALargeLiteral(flag) {
  let n = 0;
  n = flag ? 1 : 2147483648;
  return [n, marks[n & 3], n | 0, n + 1];
}

function choosesTheLargestInt32(flag) {
  let n = 0;
  n = flag ? 1 : 2147483647;
  n++;
  return [n, marks[n & 3], n | 0];
}

function choosesNaN(flag) {
  let n = 0;
  n = flag ? 1 : NaN;
  return [n, marks[n], n | 0, n === n];
}

function choosesInfinity(flag) {
  let n = 0;
  n = flag ? 1 : Infinity;
  return [n, marks[n], n | 0, n - 1];
}

function negatesZero(flag) {
  let n = 0;
  if (!flag) n = -n;
  return [n, 1 / n, marks[n]];
}

function assignsNegativeZeroLate(count) {
  let n = 0;
  for (let i = 0; i < count; i++) n = i & 3;
  if (count > 5) n = -0;
  return [n, 1 / n, marks[n]];
}

function hexAndExponentLiterals(flag) {
  let n = 0x7fffffff;
  if (flag) n = 1e3;
  else n = 0xffffffff;
  return [n, n | 0, marks[n & 3], n + 1];
}

const uses = [startsAsNegativeZero, choosesNegativeZero, choosesAFraction, choosesALargeLiteral, choosesTheLargestInt32, choosesNaN, choosesInfinity, negatesZero, hexAndExponentLiterals];
for (let i = 0; i < 2000; i++) for (const use of uses) use(true);
for (const use of uses) {
  attempt(use.name + "(true)", () => use(true));
  attempt(use.name + "(false)", () => use(false));
  attempt(use.name + "(true) again", () => use(true));
}
attempt("assignsNegativeZeroLate(3)", () => assignsNegativeZeroLate(3));
attempt("assignsNegativeZeroLate(9)", () => assignsNegativeZeroLate(9));

// GENERATED: outcome startsAsNegativeZero choosesInfinity
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
// CHECK-LABEL: function {{*}}name="startsAsNegativeZero"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array<undefined|null|boolean|number|string> flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Double number=-0
// CHECK-NEXT: v2 = Convert v1 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v3 = ToBoolean v0
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Convert v5 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5(v6)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5(v2)
// CHECK-NEXT: b5(v8):
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: v10 = Div v9, v8
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="marks"
// CHECK-NEXT: v13 = ElemGet v12, v8
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = BitOr v8, v15
// CHECK-NEXT: v17 = Builtin builtin=Object
// CHECK-NEXT: v18 = Builtin builtin=ObjectIs
// CHECK-NEXT: v19 = Double number=-0
// CHECK-NEXT: v20 = Call v18, v17, v8, v19 calleeName="Object.is"
// CHECK-NEXT: v21 = Convert v20 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v22 = NewArray v8, v10, v14, v16, v21 contents=undefined|null|boolean|number|string
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|Array<undefined|null|boolean|number|string> flags=[IsExpected]}
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="choosesInfinity"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array<undefined|null|number|string> flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = ToBoolean v0
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: Jump -> next b6(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v7 = Double number=Infinity
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b6(v8):
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="marks"
// CHECK-NEXT: v12 = ElemGet v11, v9
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = BitOr v9, v14
// CHECK-NEXT: v16 = Integer integer=1
// CHECK-NEXT: v17 = Sub v9, v16
// CHECK-NEXT: v18 = NewArray v9, v13, v15, v17 contents=undefined|null|number|string
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|Array<undefined|null|number|string> flags=[IsExpected]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
