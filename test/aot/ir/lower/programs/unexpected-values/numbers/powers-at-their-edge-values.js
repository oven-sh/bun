// RUN: lower
// OPTIONS: builtin-modules

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

function operator(base, exponent) {
  return base ** exponent;
}

function mathPow(base, exponent) {
  return Math.pow(base, exponent);
}

function truncated(base, exponent) {
  return (base ** exponent) | 0;
}

function assigned(base, exponent) {
  base **= exponent;
  return base;
}

function square(x) {
  return x ** 2;
}

function cube(x) {
  return x ** 3;
}

function root(x) {
  return x ** 0.5;
}

function reciprocal(x) {
  return x ** -1;
}

function inverseRoot(x) {
  return x ** -0.5;
}

function tenToThe(n) {
  return 10 ** n;
}

function twoToThe(n) {
  return 2 ** n;
}

function mathTenToThe(n) {
  return Math.pow(10, n);
}

for (let i = 0; i < 2000; i++) {
  operator(i & 7, i & 3);
  mathPow(i & 7, i & 3);
  truncated(i & 7, i & 3);
  assigned(i & 7, i & 3);
  square(i);
  cube(i & 255);
  root(i * i);
  reciprocal(i + 1);
}

const pairs = [[2, 10], [2, 30], [2, 31], [2, 32], [2, 53], [2, 64], [2, 1023], [2, 1024], [2, -1], [2, -1074], [2, -1075], [-2, 31], [-2, 32], [-2, 3], [10, 21], [10, 22], [10, -7], [3, 40], [7, 19], [0, 0], [-0, 0], [0, -1], [-0, -1], [-0, -2], [-0, 3], [-0, 2], [0, 0.5], [-8, 1 / 3], [-8, 0.5], [4, 0.5], [4, -0.5], [1, Infinity], [1, -Infinity], [-1, Infinity], [1, NaN], [NaN, 0], [NaN, -0], [NaN, 1], [0.5, Infinity], [2, Infinity], [2, -Infinity], [Infinity, 0], [Infinity, -1], [-Infinity, 3], [-Infinity, 2], [-Infinity, -3], [46341, 2], [65536, 2], [2147483647, 2], [-2147483648, 2], [1.0000001, 1e8], [5, 1], [5, 1.5]];
for (const [base, exponent] of pairs) {
  const label = "(" + show(base) + ", " + show(exponent) + ")";
  attempt("operator" + label, () => operator(base, exponent));
  attempt("mathPow" + label, () => mathPow(base, exponent));
  attempt("truncated" + label, () => truncated(base, exponent));
  attempt("assigned" + label, () => assigned(base, exponent));
}
for (const x of [3, -3, 0, -0, 46340, 46341, 65536, 2147483647, -2147483648, 1.5, 1e200, NaN, Infinity, -Infinity, 94906267]) {
  attempt("square(" + show(x) + ")", () => square(x));
  attempt("cube(" + show(x) + ")", () => cube(x));
  attempt("root(" + show(x) + ")", () => root(x));
  attempt("reciprocal(" + show(x) + ")", () => reciprocal(x));
}
for (const x of [2, 3, 5, 7, 10, 0.1, 0.3, 1e10, 123456789, 4, 0, -0, -1, Infinity, -Infinity, NaN]) attempt("inverseRoot(" + show(x) + ")", () => inverseRoot(x));
attempt("powers of ten that differ from their literals", () => {
  const differing = [];
  for (let n = 0; n <= 310; n++) if (tenToThe(n) !== Number("1e" + n)) differing.push(n);
  return differing;
});
attempt("powers of ten by Math.pow against the operator", () => {
  const differing = [];
  for (let n = -330; n <= 310; n++) if (!Object.is(tenToThe(n), mathTenToThe(n))) differing.push(n);
  return differing;
});
attempt("some powers of ten", () => [-324, -323, -308, -22, -1, 0, 1, 15, 16, 22, 23, 29, 100, 308, 309, 0.5, -0, NaN, "3", null].map(tenToThe));
attempt("some powers of two", () => [-1075, -1074, -1023, -1022, -1, -0, 0, 1, 30, 31, 32, 52, 53, 62, 63, 64, 1023, 1024, 0.5, 1.5, NaN, Infinity, -Infinity, "3", null, undefined, true].map(twoToThe));
attempt("powers of two multiply back to one", () => {
  const wrong = [];
  for (let n = -1022; n <= 1022; n++) if (twoToThe(n) * twoToThe(-n) !== 1) wrong.push(n);
  return wrong;
});

// GENERATED: outcome truncated root tenToThe mathTenToThe attempt
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
// CHECK-LABEL: function {{*}}name="truncated"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Pow v2, v3
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = BitOr v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="root"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Double number=0.5
// CHECK-NEXT: v3 = Pow v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tenToThe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=10
// CHECK-NEXT: v2 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Pow v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mathTenToThe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Math
// CHECK-NEXT: v2 = Builtin builtin=MathPow
// CHECK-NEXT: v3 = Integer integer=10
// CHECK-NEXT: v4 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v2, v1, v3, v4 calleeName="Math.pow"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=number flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="->"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = Call v8, -, v1 calleeName="outcome"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v6, v4, v0, v7, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
