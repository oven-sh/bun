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
// CHECK-NEXT: v8 = NewObject layout=[[L_2]]
// CHECK-NEXT: v9 = Null
// CHECK-NEXT: SetLiteralPrototype v8, v9
// CHECK-NEXT: v11 = FinishObject v8
// CHECK-NEXT: v12 = NewObject -, v6 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v13 = ScopeHasBinding v11 key="eval"
// CHECK-NEXT: Branch v13 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Jump -> next b3(v11, v14)
// CHECK-NEXT: b2():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Jump -> next b3(v15, v15)
// CHECK-NEXT: b3(v16, v17):
// CHECK-NEXT: v18 = TypeTest v16 testedType=object
// CHECK-NEXT: Branch v18 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: v20 = PropGet v19 key="eval"
// CHECK-NEXT: Jump -> next b6(v20)
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="eval" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v24)
// CHECK-NEXT: b6(v25):
// CHECK-NEXT: v26 = String string="var n = "
// CHECK-NEXT: v27 = GetMappedArgument v6
// CHECK-NEXT: v28 = Add v26, v27
// CHECK-NEXT: v29 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v30 = StrictEq v25, v29
// CHECK-NEXT: Branch v30 -> taken b7(), notTaken b8(| 0)
// CHECK-NEXT: b7():
// CHECK-NEXT: v31 = DirectEval v28, v7, v2, v6, v11, v12 evalScope=e3
// CHECK-NEXT: Jump -> next b9(v31)
// CHECK-NEXT: b8(v32):
// CHECK-NEXT: v33 = Call v32, v17, v28 calleeName="eval"
// CHECK-NEXT: Jump -> next b9(v33)
// CHECK-NEXT: b9(v34):
// CHECK-NEXT: v35 = ScopeHasBinding v11 key="n"
// CHECK-NEXT: Branch v35 -> taken b10(), notTaken b11()
// CHECK-NEXT: b10():
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Jump -> next b12(v11, v36)
// CHECK-NEXT: b11():
// CHECK-NEXT: v37 = Undefined
// CHECK-NEXT: Jump -> next b12(v37, v37)
// CHECK-NEXT: b12(v38, v39):
// CHECK-NEXT: v40 = TypeTest v38 testedType=object
// CHECK-NEXT: Branch v40 -> taken b13(| 0), notTaken b14(| 0)
// CHECK-NEXT: b13(v41):
// CHECK-NEXT: v42 = PropGet v41 key="n"
// CHECK-NEXT: Jump -> next b15(v42)
// CHECK-NEXT: b14(v43):
// CHECK-NEXT: v44 = Builtin builtin=GlobalThis
// CHECK-NEXT: v45 = PropGet v44 key="n" [isFreeName]
// CHECK-NEXT: Jump -> next b15(v45)
// CHECK-NEXT: b15(v46):
// CHECK-NEXT: v47 = Integer
// CHECK-NEXT: v48 = BitOr v46, v47
// CHECK-NEXT: Return v48
// CHECK-NEXT: }
