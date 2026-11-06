// RUN: lower
// OPTIONS: builtin-modules

// Indirect eval of constant text hands over the value.
"use strict";

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

attempt("pushes an array", () => { const a = (0, eval)("[5, 6]"); a.push(1); return a.length; });
attempt("pushes a subclass", () => { const a = (0, eval)("new (class extends Array { push(value) { log.push('Odd.push ' + value); return 42; } *[Symbol.iterator]() { log.push('Odd.iterator'); yield 'odd'; } })(5, 6)"); a.push(1); return a.length; });
attempt("pushes an array-like", () => { const a = (0, eval)("({ 0: 5, length: 7, push(value) { log.push('own push ' + value); return 'pushed'; }, [Symbol.iterator]() { log.push('own iterator'); return [8, 9][Symbol.iterator](); } })"); a.push(1); return a.length; });
attempt("pushes a proxy", () => { const a = (0, eval)("new Proxy([5, 6], { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push('set ' + String(key)); return Reflect.set(target, key, value, receiver); } })"); a.push(1); return a.length; });
attempt("pushes a frozen array", () => { const a = (0, eval)("Object.freeze([5, 6])"); a.push(1); return a.length; });
attempt("pushes a string", () => { const a = (0, eval)("'ab'"); a.push(1); return a.length; });

attempt("iterates an array", () => { const a = (0, eval)("[5, 6]"); const seen = []; for (const x of a) seen.push(x); return seen; });
attempt("iterates a subclass", () => { const a = (0, eval)("new (class extends Array { push(value) { log.push('Odd.push ' + value); return 42; } *[Symbol.iterator]() { log.push('Odd.iterator'); yield 'odd'; } })(5, 6)"); const seen = []; for (const x of a) seen.push(x); return seen; });
attempt("iterates an array-like", () => { const a = (0, eval)("({ 0: 5, length: 7, push(value) { log.push('own push ' + value); return 'pushed'; }, [Symbol.iterator]() { log.push('own iterator'); return [8, 9][Symbol.iterator](); } })"); const seen = []; for (const x of a) seen.push(x); return seen; });
attempt("iterates a proxy", () => { const a = (0, eval)("new Proxy([5, 6], { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push('set ' + String(key)); return Reflect.set(target, key, value, receiver); } })"); const seen = []; for (const x of a) seen.push(x); return seen; });
attempt("iterates a frozen array", () => { const a = (0, eval)("Object.freeze([5, 6])"); const seen = []; for (const x of a) seen.push(x); return seen; });
attempt("iterates a string", () => { const a = (0, eval)("'ab'"); const seen = []; for (const x of a) seen.push(x); return seen; });

attempt("readsCharCode a string", () => { const s = (0, eval)("'abc'"); return s.charCodeAt(0); });
attempt("readsCharCode an object with charCodeAt", () => { const s = (0, eval)("({ charCodeAt(index) { log.push('own charCodeAt ' + index); return 'mine'; } })"); return s.charCodeAt(0); });
attempt("readsCharCode a String object with its own charCodeAt", () => { const s = (0, eval)("Object.assign(new String('xyz'), { charCodeAt: () => -1 })"); return s.charCodeAt(0); });
attempt("readsCharCode an array", () => { const s = (0, eval)("['abc']"); return s.charCodeAt(0); });
attempt("readsCharCode a number", () => { const s = (0, eval)("65"); return s.charCodeAt(0); });

attempt("truncates an integer", () => { const n = (0, eval)("7"); return n | 0; });
attempt("truncates a string", () => { const n = (0, eval)("'3'"); return n | 0; });
attempt("truncates an object with valueOf", () => { const n = (0, eval)("({ valueOf() { log.push('valueOf'); return 2 ** 31 + 0.5; }, toString() { log.push('toString'); return 'text'; } })"); return n | 0; });
attempt("truncates a bigint", () => { const n = (0, eval)("10n"); return n | 0; });
attempt("truncates the largest int32", () => { const n = (0, eval)("2147483647"); return n | 0; });
attempt("truncates minus zero", () => { const n = (0, eval)("-0"); return n | 0; });
attempt("truncates undefined", () => { const n = (0, eval)("undefined"); return n | 0; });

attempt("addsOne an integer", () => { const n = (0, eval)("7"); return n + 1; });
attempt("addsOne a string", () => { const n = (0, eval)("'3'"); return n + 1; });
attempt("addsOne an object with valueOf", () => { const n = (0, eval)("({ valueOf() { log.push('valueOf'); return 2 ** 31 + 0.5; }, toString() { log.push('toString'); return 'text'; } })"); return n + 1; });
attempt("addsOne a bigint", () => { const n = (0, eval)("10n"); return n + 1; });
attempt("addsOne the largest int32", () => { const n = (0, eval)("2147483647"); return n + 1; });
attempt("addsOne minus zero", () => { const n = (0, eval)("-0"); return n + 1; });
attempt("addsOne undefined", () => { const n = (0, eval)("undefined"); return n + 1; });

attempt("calls a function", () => { const f = (0, eval)("(x => x + 1)"); return f(1); });
attempt("calls a class", () => { const f = (0, eval)("(class Made { constructor(x) { log.push('constructed ' + x); } })"); return f(1); });
attempt("calls a callable proxy", () => { const f = (0, eval)("new Proxy(x => x + 2, { apply(target, self, list) { log.push('apply ' + list.length); return Reflect.apply(target, self, list); } })"); return f(1); });
attempt("calls a bound function", () => { const f = (0, eval)("(function (a, b) { return [this.tag, a, b]; }).bind({ tag: 'bound' }, 'first')"); return f(1); });
attempt("calls an object with call", () => { const f = (0, eval)("({ call() { log.push('call'); return 'called'; } })"); return f(1); });

attempt("addsMembers an object", () => { const o = (0, eval)("({ x: 1, y: 2 })"); return o.x + o.y; });
attempt("addsMembers accessors", () => { const o = (0, eval)("({ get x() { log.push('get x'); return 10; }, set x(value) { log.push('set x ' + value); }, get y() { log.push('get y'); return 20; } })"); return o.x + o.y; });
attempt("addsMembers a proxy", () => { const o = (0, eval)("new Proxy({ y: 2, x: 1 }, { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push('set ' + String(key)); return Reflect.set(target, key, value, receiver); } })"); return o.x + o.y; });
attempt("addsMembers a frozen object", () => { const o = (0, eval)("Object.freeze({ x: 5, y: 6 })"); return o.x + o.y; });
attempt("addsMembers texts in another order", () => { const o = (0, eval)("({ y: '2', x: '1' })"); return o.x + o.y; });
attempt("addsMembers inherited members", () => { const o = (0, eval)("Object.create({ x: 3, y: 4 })"); return o.x + o.y; });

attempt("storesMember an object", () => { const o = (0, eval)("({ x: 1, y: 2 })"); o.x = 1; return o; });
attempt("storesMember accessors", () => { const o = (0, eval)("({ get x() { log.push('get x'); return 10; }, set x(value) { log.push('set x ' + value); }, get y() { log.push('get y'); return 20; } })"); o.x = 1; return o; });
attempt("storesMember a proxy", () => { const o = (0, eval)("new Proxy({ y: 2, x: 1 }, { get(target, key, receiver) { log.push('get ' + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push('set ' + String(key)); return Reflect.set(target, key, value, receiver); } })"); o.x = 1; return o; });
attempt("storesMember a frozen object", () => { const o = (0, eval)("Object.freeze({ x: 5, y: 6 })"); o.x = 1; return o; });
attempt("storesMember texts in another order", () => { const o = (0, eval)("({ y: '2', x: '1' })"); o.x = 1; return o; });
attempt("storesMember inherited members", () => { const o = (0, eval)("Object.create({ x: 3, y: 4 })"); o.x = 1; return o; });

// GENERATED: outcome attempt
// CHECK-LABEL: function {{*}}name="outcome"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_1]] field=2
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v3, v5 key="length"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b8():
// CHECK-NEXT: v7 = Call v1 calleeName="run"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|number|string|bigint|object flags=[IsExpected]}
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_1]] field=2
// CHECK-NEXT: v10 = CheckInitialized v9 name="log"
// CHECK-NEXT: v11 = PropGet v10 key="join"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v13 = String string=", "
// CHECK-NEXT: v14 = Call v12, v10, v13 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v16 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v17 = Call v16, -, v8 calleeName="show"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = ToBoolean v15
// CHECK-NEXT: Branch v19 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v20) handler=b8():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v21 = String string=" | "
// CHECK-NEXT: v22 = Add v21, v20
// CHECK-NEXT: Jump -> next b7(v22)
// CHECK-NEXT: b5(v23) handler=b8():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b8():
// CHECK-NEXT: v24 = String string=""
// CHECK-NEXT: Jump -> next b7(v24)
// CHECK-NEXT: b7(v25) handler=b8():
// CHECK-NEXT: v26 = Add v18, v25
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v27
// CHECK-NEXT: b8() role=CatchHandler:
// CHECK-NEXT: v28 = CatchValue
// CHECK-NEXT: v29 = GetEnvironmentField v0 layout=[[L_1]] field=2
// CHECK-NEXT: v30 = CheckInitialized v29 name="log"
// CHECK-NEXT: v31 = PropGet v30 key="join"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v33 = String string=", "
// CHECK-NEXT: v34 = Call v32, v30, v33 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v36 = String string="threw "
// CHECK-NEXT: v37 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v38 = Call v37, -, v28 calleeName="show"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v40 = Add v36, v39
// CHECK-NEXT: v41 = ToBoolean v35
// CHECK-NEXT: Branch v41 -> taken b9(| 0), notTaken b11(| 0)
// CHECK-NEXT: b9(v42):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v43 = String string=" | "
// CHECK-NEXT: v44 = Add v43, v42
// CHECK-NEXT: Jump -> next b13(v44)
// CHECK-NEXT: b11(v45):
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12():
// CHECK-NEXT: v46 = String string=""
// CHECK-NEXT: Jump -> next b13(v46)
// CHECK-NEXT: b13(v47):
// CHECK-NEXT: v48 = Add v40, v47
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v49
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: undefined|null|function):
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
// CHECK-NEXT: v11 = Call v10, -, v2 calleeName="outcome"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Add v9, v12
// CHECK-NEXT: v14 = Call v7, v5, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
