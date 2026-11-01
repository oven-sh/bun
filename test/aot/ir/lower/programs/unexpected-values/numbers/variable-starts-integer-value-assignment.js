// RUN: lower
// OPTIONS: builtin-modules

// A variable that starts as an integer gets a value nobody knows by a logical assignment.
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

const log = [];

function make(text) {
  return new Function("log", "return (" + text + ");")(log);
}

const impostors = [
  "7",
  "'3'",
  "''",
  "' 12 '",
  "'0x10'",
  "'abc'",
  "'1e3'",
  "'-0'",
  "null",
  "undefined",
  "true",
  "false",
  "NaN",
  "Infinity",
  "-Infinity",
  "-0",
  "0.5",
  "-1.5",
  "2147483647",
  "2147483648",
  "-2147483648",
  "-2147483649",
  "4294967295",
  "4294967297",
  "9007199254740993",
  "1e21",
  "10n",
  "-1n",
  "2n ** 64n",
  "[]",
  "[5]",
  "[1, 2]",
  "['0x10']",
  "[[7]]",
  "[null]",
  "({})",
  "Object.create(null)",
  "new Date(86400000)",
  "new Date(NaN)",
  "new Number(6)",
  "new String('8')",
  "new Boolean(true)",
  "Object(4n)",
  "Symbol('s')",
  "Object(Symbol('boxed'))",
  "Object.assign(function () {}, { toString() { log.push('toString'); return 'text of a function'; } })",
  "({ valueOf() { log.push('valueOf'); return 9; }, toString() { log.push('toString'); return '11'; } })",
  "({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return '13'; } })",
  "({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return {}; } })",
  "({ valueOf() { log.push('valueOf'); throw new RangeError('no'); } })",
  "({ valueOf() { log.push('valueOf'); return 5n; } })",
  "({ valueOf() { log.push('valueOf'); return '21'; } })",
  "({ valueOf() { log.push('valueOf'); return -0; } })",
  "({ valueOf() { log.push('valueOf'); return Symbol('inner'); } })",
  "({ valueOf: 5, toString() { log.push('toString'); return '17'; } })",
  "({ [Symbol.toPrimitive](hint) { log.push(hint); return hint === 'number' ? 1 : hint === 'string' ? '2' : 3; } })",
  "({ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } })",
  "({ [Symbol.toPrimitive]: undefined, valueOf() { log.push('valueOf'); return 15; } })",
  "({ [Symbol.toPrimitive]: 5 })",
  "new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === 'valueOf' ? () => 19 : undefined; } })",
];

function describe(use, text) {
  log.length = 0;
  const result = outcome(() => use(make(text)));
  return use.name + " of " + text + " -> " + result + (log.length ? " after " + log.join(", ") : "");
}

function runTable(uses, texts) {
  const first = [];
  for (const use of uses) {
    for (const text of texts) {
      first.push(describe(use, text));
      console.log(first[first.length - 1]);
    }
  }
  for (let i = 0; i < 2000; i++) for (const use of uses) use(i % 50);
  let same = 0;
  let at = 0;
  for (const use of uses) {
    const honest = outcome(() => use(7));
    for (const text of texts) {
      const again = describe(use, text);
      if (again === first[at++]) same++;
      else console.log("changed after 2000 honest calls:", again);
      const between = outcome(() => use(7));
      if (between !== honest) console.log("an honest call changed after", text, "->", between);
    }
  }
  console.log(same, "of", first.length, "are the same after 2000 honest calls");
}

const letters = ["a", "b", "c", "d", "e", "f", "g", "h"];

function orAssigned(unknown) {
  let index = 0;
  index ||= unknown;
  return [letters[index], index, index + 1];
}

function andAssigned(unknown) {
  let index = 1;
  index &&= unknown;
  return [letters[index], index, index + 1];
}

function nullishAssigned(unknown) {
  let index = 2;
  index ??= unknown;
  return [letters[index], index, index + 1];
}

function chosen(unknown) {
  let index = 0;
  index = unknown || 3;
  return [letters[index], index, index + 1];
}

runTable([orAssigned, andAssigned, nullishAssigned, chosen], impostors);

// GENERATED: outcome make attempt nullishAssigned
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
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Function" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="log"
// CHECK-NEXT: v5 = String string="return ("
// CHECK-NEXT: v6 = Add v5, v0
// CHECK-NEXT: v7 = String string=");"
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = Construct v3, -, v4, v8 calleeName="Function"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="log"
// CHECK-NEXT: v13 = Call v10, -, v12
// CHECK-NEXT: ReturnCall v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=LeftOutOfExecutable name="attempt"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="nullishAssigned"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array<undefined|null|number|string> flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Convert v1 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v3 = TypeTest v2 testedType=undefined|null
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Convert v0 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5(v6)
// CHECK-NEXT: b5(v7):
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="letters"
// CHECK-NEXT: v10 = ElemGet v9, v7
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Add v7, v12
// CHECK-NEXT: v14 = NewArray v11, v7, v13 contents=undefined|null|number|string
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<undefined|null|number|string> flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
