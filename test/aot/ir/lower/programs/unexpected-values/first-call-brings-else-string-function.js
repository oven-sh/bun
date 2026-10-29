// RUN: lower
// OPTIONS: builtin-modules

// The first call brings something else than a string or a function.
"use strict";

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

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

console.log("strict:", (function () { return this === undefined; })());

function readsCharCode1(s) {
  return s.charCodeAt(0);
}
attempt("readsCharCode: an object with charCodeAt comes first", () => readsCharCode1(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })));
attempt("readsCharCode: a string comes second", () => readsCharCode1("abc"));
attempt("readsCharCode: an object with charCodeAt comes third", () => readsCharCode1(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })));

function readsCharCode2(s) {
  return s.charCodeAt(0);
}
attempt("readsCharCode: a String object with its own charCodeAt comes first", () => readsCharCode2(Object.assign(new String("xyz"), { charCodeAt: () => -1 })));
attempt("readsCharCode: a string comes second", () => readsCharCode2("abc"));
attempt("readsCharCode: a String object with its own charCodeAt comes third", () => readsCharCode2(Object.assign(new String("xyz"), { charCodeAt: () => -1 })));

function readsCharCode3(s) {
  return s.charCodeAt(0);
}
attempt("readsCharCode: an array comes first", () => readsCharCode3(["abc"]));
attempt("readsCharCode: a string comes second", () => readsCharCode3("abc"));
attempt("readsCharCode: an array comes third", () => readsCharCode3(["abc"]));

function readsCharCode4(s) {
  return s.charCodeAt(0);
}
attempt("readsCharCode: a number comes first", () => readsCharCode4(65));
attempt("readsCharCode: a string comes second", () => readsCharCode4("abc"));
attempt("readsCharCode: a number comes third", () => readsCharCode4(65));

function calls1(f) {
  return f(1);
}
attempt("calls: a class comes first", () => calls1(class Made { constructor(x) { log.push("constructed " + x); } }));
attempt("calls: a function comes second", () => calls1(x => x + 1));
attempt("calls: a class comes third", () => calls1(class Made { constructor(x) { log.push("constructed " + x); } }));

function calls2(f) {
  return f(1);
}
attempt("calls: a callable proxy comes first", () => calls2(logged(x => x + 2)));
attempt("calls: a function comes second", () => calls2(x => x + 1));
attempt("calls: a callable proxy comes third", () => calls2(logged(x => x + 2)));

function calls3(f) {
  return f(1);
}
attempt("calls: a bound function comes first", () => calls3(function (a, b) { return [this.tag, a, b]; }.bind({ tag: "bound" }, "first")));
attempt("calls: a function comes second", () => calls3(x => x + 1));
attempt("calls: a bound function comes third", () => calls3(function (a, b) { return [this.tag, a, b]; }.bind({ tag: "bound" }, "first")));

function calls4(f) {
  return f(1);
}
attempt("calls: an object with call comes first", () => calls4(({ call() { log.push("call"); return "called"; } })));
attempt("calls: a function comes second", () => calls4(x => x + 1));
attempt("calls: an object with call comes third", () => calls4(({ call() { log.push("call"); return "called"; } })));

// GENERATED: logged calls1 get set apply
// CHECK-LABEL: function {{*}}name="logged"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|[[f_2]]|[[f_3]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|[[f_2]]|[[f_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Proxy
// CHECK-NEXT: v3 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v5 = NewObject layout=[[L_6]]
// CHECK-NEXT: PropDefine v5, v4 key="get"
// CHECK-NEXT: v7 = NewClosure v0 function=[[f_7]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v5, v8 key="set"
// CHECK-NEXT: v10 = NewClosure v0 function=[[f_9]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v5, v11 key="apply"
// CHECK-NEXT: v13 = FinishObject v5
// CHECK-NEXT: v14 = Construct v2, -, v1, v13 calleeName="Proxy"
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="calls1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="f"
// CHECK-NEXT: ReturnCall v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: undefined|null|string|symbol, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_1]] field=2
// CHECK-NEXT: v5 = CheckInitialized v4 name="log"
// CHECK-NEXT: v6 = PropGet v5 key="push"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_12]] flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="get "
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v9, -, v2 calleeName="String"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v7, v5, v12 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v14 = Builtin builtin=Reflect
// CHECK-NEXT: v15 = Builtin builtin=ReflectGet
// CHECK-NEXT: v16 = Call v15, v14, v1, v2, v3 calleeName="Reflect.get"
// CHECK-NEXT: ReturnCall v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=4 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}, {type=anything}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: undefined|null|string|symbol, v3: anything, v4: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_1]] field=2
// CHECK-NEXT: v6 = CheckInitialized v5 name="log"
// CHECK-NEXT: v7 = PropGet v6 key="push"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_12]] flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="set "
// CHECK-NEXT: v10 = Builtin builtin=String
// CHECK-NEXT: v11 = Call v10, -, v2 calleeName="String"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Add v9, v12
// CHECK-NEXT: v14 = Call v8, v6, v13 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v15 = Builtin builtin=Reflect
// CHECK-NEXT: v16 = Builtin builtin=ReflectSet
// CHECK-NEXT: v17 = Call v16, v15, v1, v2, v3, v4 calleeName="Reflect.set"
// CHECK-NEXT: ReturnCall v17 casts=[{declared={type=boolean flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="apply"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|[[f_14]] flags=[IsExpected]}, {type=anything}, {type=undefined|null|Array flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|[[f_14]], v2: anything, v3: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_1]] field=2
// CHECK-NEXT: v5 = CheckInitialized v4 name="log"
// CHECK-NEXT: v6 = PropGet v5 key="push"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_12]] flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="apply "
// CHECK-NEXT: v9 = PropGet v3 key="length"
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Add v8, v10
// CHECK-NEXT: v12 = Call v7, v5, v11 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v13 = Builtin builtin=Reflect
// CHECK-NEXT: v14 = Builtin builtin=ReflectApply
// CHECK-NEXT: v15 = Call v14, v13, v1, v2, v3 calleeName="Reflect.apply"
// CHECK-NEXT: ReturnCall v15
// CHECK-NEXT: }
