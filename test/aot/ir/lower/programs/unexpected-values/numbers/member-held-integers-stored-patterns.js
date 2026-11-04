// RUN: lower
// OPTIONS: builtin-modules

// A member that held integers is stored to by patterns loop heads and built ins.
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

function makeGauge() {
  return { level: 0, name: "gauge" };
}

function raise(gauge) {
  gauge.level = gauge.level + 1;
  return gauge.level;
}

function reset(gauge) {
  gauge.level = 0;
}

function report(gauge) {
  return [gauge.level, gauge.level + 1, gauge.level * 2, gauge.level & 7, gauge.level < 5, typeof gauge.level];
}

const routes = {
  "an assignment pattern": (gauge, value) => {
    ({ level: gauge.level } = { level: value });
  },
  "a list pattern": (gauge, value) => {
    [gauge.level] = [value];
  },
  "the head of a for-of": (gauge, value) => {
    for (gauge.level of [value]);
  },
  "the head of a for-in": (gauge, value) => {
    for (gauge.level in { [String(value)]: 1 });
  },
  "a proxy around it": (gauge, value) => {
    new Proxy(gauge, {}).level = value;
  },
  "Object.assign from a literal": (gauge, value) => {
    Object.assign(gauge, { level: value });
  },
  "Object.defineProperty": (gauge, value) => {
    Object.defineProperty(gauge, "level", { value });
  },
  "Reflect.set": (gauge, value) => {
    Reflect.set(gauge, "level", value);
  },
  "a logical assignment": (gauge, value) => {
    gauge.level &&= value;
  },
  "a default in a pattern": (gauge, value) => {
    ({ level: gauge.level = value } = {});
  },
};

const warm = makeGauge();
for (let i = 0; i < 2000; i++) {
  raise(warm);
  report(warm);
  if ((i & 7) === 7) reset(warm);
}
console.log("after 2000 honest rounds", show(report(warm)));

for (const route of Object.keys(routes)) {
  for (const value of ["3", 0.5, -0, undefined, null, 3n, NaN, 2147483647, { valueOf: () => 3 }]) {
    const gauge = makeGauge();
    raise(gauge);
    routes[route](gauge, value);
    attempt(route + " stores " + show(value) + ": report", () => report(gauge));
    attempt(route + " stores " + show(value) + ": raise", () => [raise(gauge), gauge.level]);
  }
}

attempt("made by JSON", () => report(JSON.parse('{"level":"3","name":"gauge"}')));
attempt("made by a spread", () => report({ ...makeGauge(), level: "3" }));
attempt("made by Object.create", () => report(Object.create(makeGauge(), { level: { value: 2.5 } })));
attempt("made by Object.fromEntries", () => report(Object.fromEntries([["level", "3"], ["name", "gauge"]])));
attempt("made by structuredClone", () => report(structuredClone({ level: 3n, name: "gauge" })));
attempt("an honest gauge afterwards", () => {
  const gauge = makeGauge();
  return [raise(gauge), report(gauge)];
});

// GENERATED: outcome makeGauge report reset Object.defineProperty Reflect.set
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
// CHECK-LABEL: function {{*}}name="makeGauge"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_2]]
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="report"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|object):
// CHECK-NEXT: v1 = PropGet v0 key="level"
// CHECK-NEXT: v2 = PropGet v0 key="level"
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = PropGet v0 key="level"
// CHECK-NEXT: v6 = Integer integer=2
// CHECK-NEXT: v7 = Mul v5, v6
// CHECK-NEXT: v8 = PropGet v0 key="level"
// CHECK-NEXT: v9 = Integer integer=7
// CHECK-NEXT: v10 = BitAnd v8, v9
// CHECK-NEXT: v11 = PropGet v0 key="level"
// CHECK-NEXT: v12 = Integer integer=5
// CHECK-NEXT: v13 = Less v11, v12
// CHECK-NEXT: v14 = PropGet v0 key="level"
// CHECK-NEXT: v15 = TypeOf v14
// CHECK-NEXT: v16 = NewArray v1, v4, v7, v10, v13, v15 contents=anything
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="reset"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_3]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_3]]):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: PropSet v0, v1 key="level"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Object.defineProperty"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v4 = String string="level"
// CHECK-NEXT: v5 = NewObject -, v1 layout=[[L_4]] fields=[4]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Call v3, v2, v0, v4, v6 calleeName="Object.defineProperty"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Reflect.set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = Builtin builtin=Reflect
// CHECK-NEXT: v3 = Builtin builtin=ReflectSet
// CHECK-NEXT: v4 = String string="level"
// CHECK-NEXT: v5 = Call v3, v2, v0, v4, v1 calleeName="Reflect.set"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
