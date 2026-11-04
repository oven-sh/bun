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
// CHECK-LABEL: function {{*}}name="startsAsNegativeZero"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Double number=-0
// CHECK-NEXT: v2 = Convert v1 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v3 = ToBoolean v0
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(v2)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Convert v5 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v6)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Div v8, v7
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="marks"
// CHECK-NEXT: v12 = ElemGet v11, v7
// CHECK-NEXT: v13 = Integer
// CHECK-NEXT: v14 = BitOr v7, v13
// CHECK-NEXT: v15 = Builtin builtin=Object
// CHECK-NEXT: v16 = Builtin builtin=ObjectIs
// CHECK-NEXT: v17 = Double number=-0
// CHECK-NEXT: v18 = Call v16, v15, v7, v17 calleeName="Object.is"
// CHECK-NEXT: v19 = NewArray v7, v9, v12, v14, v18 contents=anything
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="choosesInfinity"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = ToBoolean v0
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = Double number=Infinity
// CHECK-NEXT: Jump -> next b3(v7)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="marks"
// CHECK-NEXT: v12 = ElemGet v11, v9
// CHECK-NEXT: v13 = Integer
// CHECK-NEXT: v14 = BitOr v9, v13
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: v16 = Sub v9, v15
// CHECK-NEXT: v17 = NewArray v9, v12, v14, v16 contents=anything
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
