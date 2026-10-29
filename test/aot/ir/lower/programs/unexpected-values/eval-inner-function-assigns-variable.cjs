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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|string, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string=" -> "
// CHECK-NEXT: v9 = Add v1, v8
// CHECK-NEXT: v10 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11, -, v2 calleeName="outcome"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v14 = Add v9, v13
// CHECK-NEXT: v15 = Call v7, v5, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="truncates"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array<number> flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: function, v3: anything, v4: int[0, 4294967295], v5: anything, v6: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v7 = CreateMappedArguments v2, v4, v6, v5
// CHECK-NEXT: v8 = ToThis v1
// CHECK-NEXT: v9 = NewObject -, v7 layout=[[L_5]] fields=[3]
// CHECK-NEXT: v10 = Integer integer=7
// CHECK-NEXT: v11 = Convert v10 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v9, v11 layout=[[L_5]]
// CHECK-NEXT: v13 = NewClosure v0, v9, v8, v3, v7 function=[[f_6]]
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v9, v14 layout=[[L_5]] field=1
// CHECK-NEXT: v16 = Data data=[[d_8]]
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v9, v18 layout=[[L_5]] field=2
// CHECK-NEXT: v20 = Integer
// CHECK-NEXT: v21 = Convert v20 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v21)
// CHECK-NEXT: b2(v22):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v24 = Integer integer=3
// CHECK-NEXT: v25 = Less v22, v24
// CHECK-NEXT: Branch v25 -> taken b3(| 0), notTaken b10(| 0)
// CHECK-NEXT: b3(v26):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v27 = PropGet v18 key="push"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v29 = GetEnvironmentField v9 layout=[[L_5]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="n"
// CHECK-NEXT: v31 = Integer
// CHECK-NEXT: v32 = BitOr v30, v31
// CHECK-NEXT: v33 = Call v28, v18, v32 calleeKey="push" calleeName="results.push"
// CHECK-NEXT: v34 = Integer
// CHECK-NEXT: v35 = StrictEq v26, v34
// CHECK-NEXT: Branch v35 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v36):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v37 = Call v14 calleeName="change"
// CHECK-NEXT: Jump -> next b8(v36)
// CHECK-NEXT: b7(v38):
// CHECK-NEXT: Jump -> next b8(v38)
// CHECK-NEXT: b8(v39):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v40 = Increment v39
// CHECK-NEXT: v41 = Convert v40 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v41)
// CHECK-NEXT: b10(v42):
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v43 = Convert v18 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: Return v43
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
