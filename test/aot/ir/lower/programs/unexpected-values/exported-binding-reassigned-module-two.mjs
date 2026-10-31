// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// An exported binding is reassigned by its module between two uses.
import { a, f, n, o, replace, s } from "./bindings.mjs";
import * as bindings from "./bindings.mjs";

const log = (globalThis.log = []);

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

console.log("strict:", (function () { return this === undefined; })());

function pushes(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    a.push(1);
    results.push(a.length);
    if (round === 0) replace(index);
  }
  return results;
}

function iterates(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    const seen = [];
    for (const x of a) seen.push(x);
    results.push(seen);
    if (round === 0) replace(index);
  }
  return results;
}

function readsCharCode(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(s.charCodeAt(0));
    if (round === 0) replace(index);
  }
  return results;
}

function truncates(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(n | 0);
    if (round === 0) replace(index);
  }
  return results;
}

function addsOne(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(n + 1);
    if (round === 0) replace(index);
  }
  return results;
}

function calls(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(f(1));
    if (round === 0) replace(index);
  }
  return results;
}

function addsMembers(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(o.x + o.y);
    if (round === 0) replace(index);
  }
  return results;
}

function storesMember(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    o.x = 1;
    results.push(o);
    if (round === 0) replace(index);
  }
  return results;
}

function pushesThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    bindings.a.push(1);
    results.push(bindings.a.length);
    if (round === 0) replace(index);
  }
  return results;
}

function iteratesThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    const seen = [];
    for (const x of bindings.a) seen.push(x);
    results.push(seen);
    if (round === 0) replace(index);
  }
  return results;
}

function readsCharCodeThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(bindings.s.charCodeAt(0));
    if (round === 0) replace(index);
  }
  return results;
}

function truncatesThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(bindings.n | 0);
    if (round === 0) replace(index);
  }
  return results;
}

function addsOneThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(bindings.n + 1);
    if (round === 0) replace(index);
  }
  return results;
}

function callsThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(bindings.f(1));
    if (round === 0) replace(index);
  }
  return results;
}

function addsMembersThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(bindings.o.x + bindings.o.y);
    if (round === 0) replace(index);
  }
  return results;
}

function storesMemberThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    bindings.o.x = 1;
    results.push(bindings.o);
    if (round === 0) replace(index);
  }
  return results;
}

const table = [
  ["pushes", pushes],
  ["pushesThroughTheNamespace", pushesThroughTheNamespace],
  ["iterates", iterates],
  ["iteratesThroughTheNamespace", iteratesThroughTheNamespace],
  ["readsCharCode", readsCharCode],
  ["readsCharCodeThroughTheNamespace", readsCharCodeThroughTheNamespace],
  ["truncates", truncates],
  ["truncatesThroughTheNamespace", truncatesThroughTheNamespace],
  ["addsOne", addsOne],
  ["addsOneThroughTheNamespace", addsOneThroughTheNamespace],
  ["calls", calls],
  ["callsThroughTheNamespace", callsThroughTheNamespace],
  ["addsMembers", addsMembers],
  ["addsMembersThroughTheNamespace", addsMembersThroughTheNamespace],
  ["storesMember", storesMember],
  ["storesMemberThroughTheNamespace", storesMemberThroughTheNamespace],
];

function everyCase(round) {
  for (const [name, use] of table) {
    for (const index of [0, 1, 2, 3, 0]) attempt(round + " " + name + " set " + index, () => use(index));
  }
}

everyCase("at first");
for (let i = 0; i < 2000; i++) {
  pushes(0);
  pushesThroughTheNamespace(0);
  iterates(0);
  iteratesThroughTheNamespace(0);
  readsCharCode(0);
  readsCharCodeThroughTheNamespace(0);
  truncates(0);
  truncatesThroughTheNamespace(0);
  addsOne(0);
  addsOneThroughTheNamespace(0);
  calls(0);
  callsThroughTheNamespace(0);
  addsMembers(0);
  addsMembersThroughTheNamespace(0);
  storesMember(0);
  storesMemberThroughTheNamespace(0);
}
everyCase("after 2000");

// FILE: bindings.mjs
class Odd extends Array {
  push(value) {
    globalThis.log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    globalThis.log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      globalThis.log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      globalThis.log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      globalThis.log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

const sets = [
  () => ({ a: [5, 6], s: "abc", n: 7, f: x => x + 1, o: ({ x: 1, y: 2 }) }),
  () => ({ a: Odd.of(5, 6), s: ({ charCodeAt(index) { globalThis.log.push("own charCodeAt " + index); return "mine"; } }), n: "3", f: class Made { constructor(x) { globalThis.log.push("constructed " + x); } }, o: ({ get x() { globalThis.log.push("get x"); return 10; }, set x(value) { globalThis.log.push("set x " + value); }, get y() { globalThis.log.push("get y"); return 20; } }) }),
  () => ({ a: ({ 0: 5, length: 7, push(value) { globalThis.log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { globalThis.log.push("own iterator"); return [8, 9][Symbol.iterator](); } }), s: Object.assign(new String("xyz"), { charCodeAt: () => -1 }), n: ({ valueOf() { globalThis.log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { globalThis.log.push("toString"); return "text"; } }), f: logged(x => x + 2), o: logged({ y: 2, x: 1 }) }),
  () => ({ a: logged([5, 6]), s: ["abc"], n: 10n, f: function (a, b) { return [this.tag, a, b]; }.bind({ tag: "bound" }, "first"), o: Object.freeze({ x: 5, y: 6 }) }),
];

export let { a, s, n, f, o } = sets[0]();

export function replace(index) {
  ({ a, s, n, f, o } = sets[index]());
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: attempt truncates
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
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = Call v9, -, v1 calleeName="outcome"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="truncates"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="replace"
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="replace"
// CHECK-NEXT: v5 = Data data=[[d_4]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = Integer integer=3
// CHECK-NEXT: v13 = Less v10, v12
// CHECK-NEXT: Branch v13 -> taken b3(| 0), notTaken b10(| 0)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v15 = PropGet v7 key="push"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="n"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|number|string|bigint|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v20 = Integer
// CHECK-NEXT: v21 = BitOr v19, v20
// CHECK-NEXT: v22 = Call v16, v7, v21 calleeKey="push" calleeName="results.push"
// CHECK-NEXT: v23 = Integer
// CHECK-NEXT: v24 = StrictEq v14, v23
// CHECK-NEXT: Branch v24 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v25):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v27 = CheckInitialized v26 name="replace"
// CHECK-NEXT: v28 = Call v27, -, v0 calleeName="replace"
// CHECK-NEXT: Jump -> next b8(v25)
// CHECK-NEXT: b7(v29):
// CHECK-NEXT: Jump -> next b8(v29)
// CHECK-NEXT: b8(v30):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v31 = Increment v30
// CHECK-NEXT: v32 = Convert v31 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v32)
// CHECK-NEXT: b10(v33):
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
