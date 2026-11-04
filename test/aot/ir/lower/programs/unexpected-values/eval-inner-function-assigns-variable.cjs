// RUN: lower
// OPTIONS: builtin-modules

// Eval in an inner function assigns to a variable of the outer function.
const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

const arrays = [
  ["an array", "[5, 6]"],
  ["a subclass", "new (class extends Array { push(value) { log.push('Odd.push ' + value); return 42; } *[Symbol.iterator]() { log.push('Odd.iterator'); yield 'odd'; } })(5, 6)"],
  ["an array-like", "({ 0: 5, length: 7, push(value) { log.push('own push ' + value); return 'pushed'; }, [Symbol.iterator]() { log.push('own iterator'); return [8, 9][Symbol.iterator](); } })"],
  ["a proxy", "new Proxy([5, 6], { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push('set ' + String(key)); return Reflect.set(target, key, value, receiver); } })"],
  ["a frozen array", "Object.freeze([5, 6])"],
  ["a string", "'ab'"],
];

const strings = [
  ["a string", "'abc'"],
  ["an object with charCodeAt", "({ charCodeAt(index) { log.push('own charCodeAt ' + index); return 'mine'; } })"],
  ["a String object with its own charCodeAt", "Object.assign(new String('xyz'), { charCodeAt: () => -1 })"],
  ["an array", "['abc']"],
  ["a number", "65"],
];

const numbers = [
  ["an integer", "7"],
  ["a string", "'3'"],
  ["an object with valueOf", "({ valueOf() { log.push('valueOf'); return 2 ** 31 + 0.5; }, toString() { log.push('toString'); return 'text'; } })"],
  ["a bigint", "10n"],
  ["the largest int32", "2147483647"],
  ["minus zero", "-0"],
  ["undefined", "undefined"],
];

const functions = [
  ["a function", "(x => x + 1)"],
  ["a class", "(class Made { constructor(x) { log.push('constructed ' + x); } })"],
  ["a callable proxy", "new Proxy(x => x + 2, { apply(target, self, list) { log.push('apply ' + list.length); return Reflect.apply(target, self, list); } })"],
  ["a bound function", "(function (a, b) { return [this.tag, a, b]; }).bind({ tag: 'bound' }, 'first')"],
  ["an object with call", "({ call() { log.push('call'); return 'called'; } })"],
];

const objects = [
  ["an object", "({ x: 1, y: 2 })"],
  ["accessors", "({ get x() { log.push('get x'); return 10; }, set x(value) { log.push('set x ' + value); }, get y() { log.push('get y'); return 20; } })"],
  ["a proxy", "new Proxy({ y: 2, x: 1 }, { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push('set ' + String(key)); return Reflect.set(target, key, value, receiver); } })"],
  ["a frozen object", "Object.freeze({ x: 5, y: 6 })"],
  ["texts in another order", "({ y: '2', x: '1' })"],
  ["inherited members", "Object.create({ x: 3, y: 4 })"],
];

function pushes(text) {
  let a = [5, 6];
  const change = () => eval("a = " + text);
  const results = [];
  for (let round = 0; round < 3; round++) {
    a.push(1);
    results.push(a.length);
    if (round === 0) change();
  }
  return results;
}

function iterates(text) {
  let a = [5, 6];
  const change = () => eval("a = " + text);
  const results = [];
  for (let round = 0; round < 3; round++) {
    const seen = [];
    for (const x of a) seen.push(x);
    results.push(seen);
    if (round === 0) change();
  }
  return results;
}

function readsCharCode(text) {
  let s = "abc";
  const change = () => eval("s = " + text);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(s.charCodeAt(0));
    if (round === 0) change();
  }
  return results;
}

function truncates(text) {
  let n = 7;
  const change = () => eval("n = " + text);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(n | 0);
    if (round === 0) change();
  }
  return results;
}

function addsOne(text) {
  let n = 7;
  const change = () => eval("n = " + text);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(n + 1);
    if (round === 0) change();
  }
  return results;
}

function calls(text) {
  let f = x => x + 1;
  const change = () => eval("f = " + text);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(f(1));
    if (round === 0) change();
  }
  return results;
}

function addsMembers(text) {
  let o = ({ x: 1, y: 2 });
  const change = () => eval("o = " + text);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(o.x + o.y);
    if (round === 0) change();
  }
  return results;
}

function storesMember(text) {
  let o = ({ x: 1, y: 2 });
  const change = () => eval("o = " + text);
  const results = [];
  for (let round = 0; round < 3; round++) {
    o.x = 1;
    results.push(o);
    if (round === 0) change();
  }
  return results;
}

const table = [
  ["pushes", pushes, arrays],
  ["iterates", iterates, arrays],
  ["readsCharCode", readsCharCode, strings],
  ["truncates", truncates, numbers],
  ["addsOne", addsOne, numbers],
  ["calls", calls, functions],
  ["addsMembers", addsMembers, objects],
  ["storesMember", storesMember, objects],
];

function everyCase(round) {
  for (const [name, use, values] of table) {
    for (const [label, text] of [...values, values[0]]) attempt(round + " " + name + " " + label, () => use(text));
  }
}

console.log("strict:", (function () { return this === undefined; })());
everyCase("at first");
for (let i = 0; i < 2000; i++) {
  pushes("[5, 6]");
  iterates("[5, 6]");
  readsCharCode("'abc'");
  truncates("7");
  addsOne("7");
  calls("(x => x + 1)");
  addsMembers("({ x: 1, y: 2 })");
  storesMember("({ x: 1, y: 2 })");
}
everyCase("after 2000");

// GENERATED: attempt truncates f
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = Call v9, -, v1 calleeName="outcome"
// CHECK-NEXT: v11 = Add v8, v10
// CHECK-NEXT: v12 = Call v6, v4, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="truncates"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: anything, v3: int[0, 4294967295], v4: anything, v5: Array):
// CHECK-NEXT: v6 = CreateMappedArguments v1, v3, v5, v4
// CHECK-NEXT: v7 = ToThis v0
// CHECK-NEXT: v8 = NewObject -, v6 layout=[[L_2]] fields=[3]
// CHECK-NEXT: v9 = Integer integer=7
// CHECK-NEXT: v10 = Convert v9 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v8, v10 layout=[[L_2]]
// CHECK-NEXT: v12 = NewClosure v8, v7, v2, v6 function=[[f_3]]
// CHECK-NEXT: PutEnvironmentField v8, v12 layout=[[L_2]] field=1
// CHECK-NEXT: v14 = Data data=[[d_4]]
// CHECK-NEXT: PutEnvironmentField v8, v14 layout=[[L_2]] field=2
// CHECK-NEXT: v16 = Integer
// CHECK-NEXT: v17 = Convert v16 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v17)
// CHECK-NEXT: b1(v18):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v20 = Integer integer=3
// CHECK-NEXT: v21 = Less v18, v20
// CHECK-NEXT: Branch v21 -> taken b2(), notTaken b5()
// CHECK-NEXT: b2():
// CHECK-NEXT: v22 = PropGet v14 key="push"
// CHECK-NEXT: v23 = GetEnvironmentField v8 layout=[[L_2]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="n"
// CHECK-NEXT: v25 = Integer
// CHECK-NEXT: v26 = BitOr v24, v25
// CHECK-NEXT: v27 = Call v22, v14, v26 calleeKey="push" calleeName="results.push"
// CHECK-NEXT: v28 = Integer
// CHECK-NEXT: v29 = StrictEq v18, v28
// CHECK-NEXT: Branch v29 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v30 = Call v12 calleeName="change"
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v31 = Increment v18
// CHECK-NEXT: v32 = Convert v31 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v32)
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
