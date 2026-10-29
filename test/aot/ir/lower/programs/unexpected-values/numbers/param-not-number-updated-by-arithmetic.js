// RUN: lower
// OPTIONS: builtin-modules

// A parameter that is not a number is updated by arithmetic.
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

const impostors = [
  ["7", () => 7],
  ["'3'", () => '3'],
  ["''", () => ''],
  ["' 12 '", () => ' 12 '],
  ["'0x10'", () => '0x10'],
  ["'abc'", () => 'abc'],
  ["'1e3'", () => '1e3'],
  ["'-0'", () => '-0'],
  ["null", () => null],
  ["undefined", () => undefined],
  ["true", () => true],
  ["false", () => false],
  ["NaN", () => NaN],
  ["Infinity", () => Infinity],
  ["-Infinity", () => -Infinity],
  ["-0", () => -0],
  ["0.5", () => 0.5],
  ["-1.5", () => -1.5],
  ["2147483647", () => 2147483647],
  ["2147483648", () => 2147483648],
  ["-2147483648", () => -2147483648],
  ["-2147483649", () => -2147483649],
  ["4294967295", () => 4294967295],
  ["4294967297", () => 4294967297],
  ["9007199254740993", () => 9007199254740993],
  ["1e21", () => 1e21],
  ["10n", () => 10n],
  ["-1n", () => -1n],
  ["2n ** 64n", () => 2n ** 64n],
  ["[]", () => []],
  ["[5]", () => [5]],
  ["[1, 2]", () => [1, 2]],
  ["['0x10']", () => ['0x10']],
  ["[[7]]", () => [[7]]],
  ["[null]", () => [null]],
  ["({})", () => ({})],
  ["Object.create(null)", () => Object.create(null)],
  ["new Date(86400000)", () => new Date(86400000)],
  ["new Date(NaN)", () => new Date(NaN)],
  ["new Number(6)", () => new Number(6)],
  ["new String('8')", () => new String('8')],
  ["new Boolean(true)", () => new Boolean(true)],
  ["Object(4n)", () => Object(4n)],
  ["Symbol('s')", () => Symbol('s')],
  ["Object(Symbol('boxed'))", () => Object(Symbol('boxed'))],
  ["Object.assign(function () {}, { toString() { log.push('toString'); return 'text of a function'; } })", () => Object.assign(function () {}, { toString() { log.push('toString'); return 'text of a function'; } })],
  ["({ valueOf() { log.push('valueOf'); return 9; }, toString() { log.push('toString'); return '11'; } })", () => ({ valueOf() { log.push('valueOf'); return 9; }, toString() { log.push('toString'); return '11'; } })],
  ["({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return '13'; } })", () => ({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return '13'; } })],
  ["({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return {}; } })", () => ({ valueOf() { log.push('valueOf'); return {}; }, toString() { log.push('toString'); return {}; } })],
  ["({ valueOf() { log.push('valueOf'); throw new RangeError('no'); } })", () => ({ valueOf() { log.push('valueOf'); throw new RangeError('no'); } })],
  ["({ valueOf() { log.push('valueOf'); return 5n; } })", () => ({ valueOf() { log.push('valueOf'); return 5n; } })],
  ["({ valueOf() { log.push('valueOf'); return '21'; } })", () => ({ valueOf() { log.push('valueOf'); return '21'; } })],
  ["({ valueOf() { log.push('valueOf'); return -0; } })", () => ({ valueOf() { log.push('valueOf'); return -0; } })],
  ["({ valueOf() { log.push('valueOf'); return Symbol('inner'); } })", () => ({ valueOf() { log.push('valueOf'); return Symbol('inner'); } })],
  ["({ valueOf: 5, toString() { log.push('toString'); return '17'; } })", () => ({ valueOf: 5, toString() { log.push('toString'); return '17'; } })],
  ["({ [Symbol.toPrimitive](hint) { log.push(hint); return hint === 'number' ? 1 : hint === 'string' ? '2' : 3; } })", () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return hint === 'number' ? 1 : hint === 'string' ? '2' : 3; } })],
  ["({ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } })", () => ({ [Symbol.toPrimitive](hint) { log.push(hint); return {}; } })],
  ["({ [Symbol.toPrimitive]: undefined, valueOf() { log.push('valueOf'); return 15; } })", () => ({ [Symbol.toPrimitive]: undefined, valueOf() { log.push('valueOf'); return 15; } })],
  ["({ [Symbol.toPrimitive]: 5 })", () => ({ [Symbol.toPrimitive]: 5 })],
  ["new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === 'valueOf' ? () => 19 : undefined; } })", () => new Proxy({}, { get(target, key) { log.push('get ' + String(key)); return key === 'valueOf' ? () => 19 : undefined; } })],
];

function describe(use, [text, make]) {
  log.length = 0;
  const result = outcome(() => use(make()));
  return use.name + " of " + text + " -> " + result + (log.length ? " after " + log.join(", ") : "");
}

function runTable(uses, rows) {
  const first = [];
  for (const use of uses) {
    for (const row of rows) {
      first.push(describe(use, row));
      console.log(first[first.length - 1]);
    }
  }
  for (let i = 0; i < 2000; i++) for (const use of uses) use(i % 50);
  let same = 0;
  let at = 0;
  for (const use of uses) {
    const honest = outcome(() => use(7));
    for (const row of rows) {
      const again = describe(use, row);
      if (again === first[at++]) same++;
      else console.log("changed after 2000 honest calls:", again);
      const between = outcome(() => use(7));
      if (between !== honest) console.log("an honest call changed after", row[0], "->", between);
    }
  }
  console.log(same, "of", first.length, "are the same after 2000 honest calls");
}

function plusAssign(value) {
  value += 1;
  return value;
}

function minusAssign(value) {
  value -= 1;
  return value;
}

function timesAssign(value) {
  value *= 2;
  return value;
}

function divideAssign(value) {
  value /= 2;
  return value;
}

runTable([plusAssign, minusAssign, timesAssign, divideAssign], impostors);

// GENERATED: outcome attempt divideAssign [Symbol.toPrimitive]
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
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=LeftOutOfExecutable name="attempt"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="divideAssign"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Div v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.toPrimitive]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|int[1, 3]|"2" flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v4, v2, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = String string="number"
// CHECK-NEXT: v7 = StrictEq v0, v6
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: Jump -> next b10(v9)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v11 = String string="string"
// CHECK-NEXT: v12 = StrictEq v10, v11
// CHECK-NEXT: Branch v12 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v13):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v14 = String string="2"
// CHECK-NEXT: Jump -> next b10(v14)
// CHECK-NEXT: b8(v15):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v16 = Integer integer=3
// CHECK-NEXT: Jump -> next b10(v16)
// CHECK-NEXT: b10(v17):
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|int[1, 3]|"2" flags=[IsExpected]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.toPrimitive]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v4, v2, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = Data data=[[d_5]]
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
