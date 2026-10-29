// RUN: lower
// OPTIONS: builtin-modules

// Direct eval declares the variable that the function uses.
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
  eval("var a = " + text);
  a.push(1);
  return a.length;
}

function iterates(text) {
  eval("var a = " + text);
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}

function readsCharCode(text) {
  eval("var s = " + text);
  return s.charCodeAt(0);
}

function truncates(text) {
  eval("var n = " + text);
  return n | 0;
}

function addsOne(text) {
  eval("var n = " + text);
  return n + 1;
}

function calls(text) {
  eval("var f = " + text);
  return f(1);
}

function addsMembers(text) {
  eval("var o = " + text);
  return o.x + o.y;
}

function storesMember(text) {
  eval("var o = " + text);
  o.x = 1;
  return o;
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

// GENERATED: attempt truncates
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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: function, v3: anything, v4: int[0, 4294967295], v5: anything, v6: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v7 = CreateMappedArguments v2, v4, v6, v5
// CHECK-NEXT: v8 = ToThis v1
// CHECK-NEXT: v9 = NewObject layout=[[L_5]]
// CHECK-NEXT: v10 = Null
// CHECK-NEXT: SetLiteralPrototype v9, v10
// CHECK-NEXT: v12 = FinishObject v9
// CHECK-NEXT: v13 = NewObject -, v7 layout=[[L_6]] fields=[0]
// CHECK-NEXT: v14 = ScopeHasBinding v12 key="eval"
// CHECK-NEXT: Branch v14 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Jump -> next b4(v12, v15)
// CHECK-NEXT: b3():
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Jump -> next b4(v16, v16)
// CHECK-NEXT: b4(v17, v18):
// CHECK-NEXT: v19 = TypeTest v17 testedType=object
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: v21 = PropGet v20 key="eval"
// CHECK-NEXT: Jump -> next b7(v21)
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="eval" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v25)
// CHECK-NEXT: b7(v26):
// CHECK-NEXT: v27 = String string="var n = "
// CHECK-NEXT: v28 = GetMappedArgument v7
// CHECK-NEXT: v29 = Add v27, v28
// CHECK-NEXT: v30 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v31 = StrictEq v26, v30
// CHECK-NEXT: Branch v31 -> taken b8(), notTaken b9(| 0)
// CHECK-NEXT: b8():
// CHECK-NEXT: v32 = DirectEval v29, v8, v3, v7, v0, v12, v13 evalScope=e3
// CHECK-NEXT: Jump -> next b10(v32)
// CHECK-NEXT: b9(v33):
// CHECK-NEXT: v34 = Call v33, v18, v29 calleeName="eval"
// CHECK-NEXT: Jump -> next b10(v34)
// CHECK-NEXT: b10(v35):
// CHECK-NEXT: v36 = ScopeHasBinding v12 key="n"
// CHECK-NEXT: Branch v36 -> taken b11(), notTaken b12()
// CHECK-NEXT: b11():
// CHECK-NEXT: v37 = Undefined
// CHECK-NEXT: Jump -> next b13(v12, v37)
// CHECK-NEXT: b12():
// CHECK-NEXT: v38 = Undefined
// CHECK-NEXT: Jump -> next b13(v38, v38)
// CHECK-NEXT: b13(v39, v40):
// CHECK-NEXT: v41 = TypeTest v39 testedType=object
// CHECK-NEXT: Branch v41 -> taken b14(| 0), notTaken b15(| 0)
// CHECK-NEXT: b14(v42):
// CHECK-NEXT: v43 = PropGet v42 key="n"
// CHECK-NEXT: Jump -> next b16(v43)
// CHECK-NEXT: b15(v44):
// CHECK-NEXT: v45 = Builtin builtin=GlobalThis
// CHECK-NEXT: v46 = PropGet v45 key="n" [isFreeName]
// CHECK-NEXT: Jump -> next b16(v46)
// CHECK-NEXT: b16(v47):
// CHECK-NEXT: v48 = Integer
// CHECK-NEXT: v49 = BitOr v47, v48
// CHECK-NEXT: v50 = Convert v49 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v50
// CHECK-NEXT: }
