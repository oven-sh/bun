// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: KnownHelperFunctions >= 2
// STATISTIC: KnownHelperCalls >= 2

// FILE: main.cjs
// A descriptor is an ordinary object under Object.prototype, and the helpers find Object.defineProperty and its like by name. Plain Bun lets a program change those built-ins, a compiled program refuses the change. Either way __createBinding and __exportStar do what the same text does in functions that are no known helpers.
// Todo: the build counts 4: STATISTIC: KnownHelperFunctions <= 3
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var ordinaryBinding = function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
    return undefined;
};
var ordinaryStar = function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) ordinaryBinding(exports, m, p);
};
const known = { bind: (o, m, k, k2) => __createBinding(o, m, k, k2), star: (m, o) => __exportStar(m, o) };
const ordinary = { bind: (o, m, k, k2) => ordinaryBinding(o, m, k, k2), star: (m, o) => ordinaryStar(m, o) };

// What the program itself uses does not go through the names that it changes.
const RealObject = Object;
const { defineProperty, getOwnPropertyDescriptor, getOwnPropertyNames, freeze, create } = Object;
const { hasOwnProperty } = Object.prototype;
const { call } = Function.prototype;
const { apply, ownKeys } = Reflect;
const describeProperty = Reflect.getOwnPropertyDescriptor;
const redefine = Reflect.defineProperty;

function describe(object) {
  return ownKeys(object).map(key => {
    const d = describeProperty(object, key);
    return `${String(key)}: ${getOwnPropertyNames(d).map(name => `${name}=${typeof d[name] === "function" ? "function" : String(d[name])}`).join(" ")}`;
  }).join("; ");
}
let log = [];
function outcomeOf(helpers, work) {
  log = [];
  try {
    log.push(work(helpers));
  } catch (error) {
    log.push(`threw ${error.constructor.name}: ${error.message}`);
  }
  return log.join(" | ");
}

const accessor = { get a() { return "from the getter of the source"; } };
const markedAccessor = { __esModule: true, get a() { return "from the getter of the source"; }, set a(v) { log.push(`the setter of the source takes ${v}`); } };
const symbol = Symbol("s");
const works = {
  data({ bind }) { const to = {}; bind(to, { a: 1 }, "a"); return `${describe(to)} ${to.a}`; },
  storeToTheBinding({ bind }) { const to = {}; bind(to, { a: 1 }, "a"); to.a = 3; return `${describe(to)} ${to.a}`; },
  frozenSource({ bind }) { const to = {}; bind(to, freeze({ a: 1 }), "a"); return `${describe(to)} ${to.a}`; },
  frozenAndMarkedSource({ bind }) { const to = {}; bind(to, freeze({ a: 1, __esModule: true }), "a"); return `${describe(to)} ${to.a}`; },
  accessor({ bind }) { const to = {}; bind(to, accessor, "a"); return `${describe(to)} ${to.a} ${describeProperty(to, "a").get === describeProperty(accessor, "a").get}`; },
  accessorOfAMarkedSource({ bind }) { const to = {}; bind(to, markedAccessor, "a"); to.a = 3; return `${describe(to)} ${to.a} ${describeProperty(to, "a").get === describeProperty(markedAccessor, "a").get}`; },
  absentName({ bind }) { const to = {}; bind(to, {}, "a"); return `${describe(to)} ${to.a}`; },
  otherName({ bind }) { const to = {}; bind(to, { a: 1 }, "a", "b"); return `${describe(to)} ${to.a} ${to.b}`; },
  symbolAndIndex({ bind }) { const to = {}; bind(to, { [symbol]: 1, 0: 2 }, symbol); bind(to, { [symbol]: 1, 0: 2 }, 0); return `${describe(to)} ${to[symbol]} ${to[0]}`; },
  nameTheTargetHas({ bind }) { const to = { a: "mine" }; bind(to, { a: 1 }, "a"); return `${describe(to)} ${to.a}`; },
  frozenTarget({ bind }) { const to = freeze({}); bind(to, { a: 1 }, "a"); return describe(to); },
  star({ star }) { const to = { b: "mine" }; star({ a: 1, b: 2, default: 3, c: 4 }, to); return `${describe(to)} ${to.a} ${to.b} ${to.c}`; },
  starOverAMarkedSource({ star }) { const to = {}; star(markedAccessor, to); return `${describe(to)} ${to.a}`; },
  starWithoutPrototypes({ star }) { const to = create(null); const from = create(null); from.a = 1; star(from, to); return `${describe(to)} ${to.a}`; },
};
function compare(label, change, undo) {
  let isChanged = true;
  try {
    change();
  } catch {
    isChanged = false;
  }
  const different = [];
  try {
    for (const name of getOwnPropertyNames(works)) {
      const outcomes = [outcomeOf(known, works[name]), outcomeOf(ordinary, works[name])];
      if (outcomes[0] !== outcomes[1]) different.push(`\n  ${name}\n    the known helper: ${outcomes[0]}\n    the ordinary function: ${outcomes[1]}`);
    }
  } finally {
    if (isChanged) undo();
  }
  console.log(`${label}: ${different.length ? `DIFFERENT${different.join("")}` : "alike"}`);
}

const before = {};
__exportStar({ a: 1 }, before);
console.log(describe(before), before.a);
compare("nothing changed", () => {}, () => {});

compare("Object.prototype.configurable", () => { Object.prototype.configurable = true; }, () => { delete Object.prototype.configurable; });
compare("Object.prototype.enumerable", () => { Object.prototype.enumerable = false; }, () => { delete Object.prototype.enumerable; });
compare("Object.prototype.writable", () => { Object.prototype.writable = true; }, () => { delete Object.prototype.writable; });
compare("Object.prototype.value", () => { Object.prototype.value = 5; }, () => { delete Object.prototype.value; });
compare("Object.prototype.get", () => { Object.prototype.get = function () { return "inherited getter"; }; }, () => { delete Object.prototype.get; });
compare("Object.prototype.set", () => { Object.prototype.set = function (v) { log.push(`the inherited setter takes ${v}`); }; }, () => { delete Object.prototype.set; });
compare("Object.prototype.__esModule", () => { Object.prototype.__esModule = true; }, () => { delete Object.prototype.__esModule; });
compare("Object.prototype.a", () => { Object.prototype.a = "inherited"; }, () => { delete Object.prototype.a; });
compare("Object.prototype.seen", () => { Object.prototype.seen = "enumerable and inherited"; }, () => { delete Object.prototype.seen; });
compare(
  "Object.prototype.hasOwnProperty",
  () => { Object.prototype.hasOwnProperty = function (key) { log.push(`asked for ${String(key)}`); return key === "c"; }; },
  () => { Object.prototype.hasOwnProperty = hasOwnProperty; },
);
compare(
  "Function.prototype.call",
  () => { Function.prototype.call = function (receiver, ...passed) { log.push(`called with ${passed.map(String)}`); return apply(this, receiver, passed); }; },
  () => { Function.prototype.call = call; },
);
compare(
  "Object.defineProperty",
  () => { Object.defineProperty = function (o, k, d) { log.push(`defines ${String(k)} by ${getOwnPropertyNames(d)}`); return defineProperty(o, k, d); }; },
  () => { Object.defineProperty = defineProperty; },
);
compare("an Object.defineProperty that does nothing", () => { Object.defineProperty = function (o) { log.push("ignored"); return o; }; }, () => { Object.defineProperty = defineProperty; });
compare(
  "no Object.defineProperty",
  () => { delete Object.defineProperty; },
  () => { redefine(RealObject, "defineProperty", { value: defineProperty, writable: true, enumerable: false, configurable: true }); },
);
compare(
  "Object.getOwnPropertyDescriptor",
  () => { Object.getOwnPropertyDescriptor = function (m, k) { log.push(`describes ${String(k)}`); return { value: "mine", writable: false, enumerable: true, configurable: false }; }; },
  () => { Object.getOwnPropertyDescriptor = getOwnPropertyDescriptor; },
);
compare(
  "globalThis.Object",
  () => {
    globalThis.Object = {
      getOwnPropertyDescriptor(m, k) { log.push(`another Object describes ${String(k)}`); return undefined; },
      defineProperty(o, k, d) { log.push(`another Object defines ${String(k)}`); o[k] = d.get(); },
      prototype: { hasOwnProperty(key) { log.push(`another Object is asked for ${String(key)}`); return false; } },
    };
  },
  () => { globalThis.Object = RealObject; },
);

compare("afterwards", () => {}, () => {});
const afterwards = {};
__exportStar({ a: 1 }, afterwards);
console.log(describe(afterwards), afterwards.a);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: ordinaryStar frozenTarget hasOwnProperty
// CHECK-LABEL: function {{*}}name="ordinaryStar"
// CHECK: module=[[m_0]] position={{*}} text={{*}} length=2 captures=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]], v1: undefined|null|object, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = ForInOpen v1
// CHECK-NEXT: Jump -> next b2(v3)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = ForInStep v4, v1
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: b4():
// CHECK-NEXT: v11 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = String string="default"
// CHECK-NEXT: v13 = StrictEq v11, v12
// CHECK-NEXT: Branch v13 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: Jump -> next b11(v14)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v16 = Builtin builtin=ObjectPrototypeHasOwnProperty
// CHECK-NEXT: v17 = PropGet v16 key="call"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v19 = Call v18, v16, v2, v15 calleeKey="call" calleeName="Object.prototype.hasOwnProperty.call"
// CHECK-NEXT: v20 = Convert v19 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v21 = ToBoolean v20
// CHECK-NEXT: Branch v21 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v22):
// CHECK-NEXT: Jump -> next b11(v15)
// CHECK-NEXT: b9(v23):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v24 = Call v0, -, v2, v1, v15 calleeName="ordinaryBinding"
// CHECK-NEXT: Jump -> next b11(v15)
// CHECK-NEXT: b11(v25):
// CHECK-NEXT: Jump -> next b2(v25)
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="frozenTarget"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 captures=[{type=[[f_3]] flags=[IsFromCompiler]}, {type=undefined|null|[[f_4]]|builtin(ObjectFreeze) flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: [[f_3]], v1: undefined|null|[[f_4]]|builtin(ObjectFreeze), v2: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = TypeTest v2 testedType=undefined|null
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v5 = NewRuntimeError runtimeError=NotDestructurable name="bind"
// CHECK-NEXT: Throw v5
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: v7 = PropGet v6 key="bind"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v9 = Data data=[[d_7]]
// CHECK-NEXT: v10 = Call v1, -, v9 calleeName="freeze"
// CHECK-NEXT: v11 = Data data=[[d_8]]
// CHECK-NEXT: v12 = String string="a"
// CHECK-NEXT: v13 = Call v8, -, v10, v11, v12 calleeName="bind"
// CHECK-NEXT: v14 = Call v0, -, v10 calleeName="describe"
// CHECK-NEXT: ReturnCall v14 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hasOwnProperty"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 captures=[{type=env [[L_9]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol flags=[IsExpected]}] results=[{type=false flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: env [[L_9]], v1: undefined|null|number|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_9]] field=6
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="another Object is asked for "
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v7, -, v1 calleeName="String"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v10 = ToString v9
// CHECK-NEXT: v11 = Strcat v6, v10
// CHECK-NEXT: v12 = Call v5, v3, v11 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v13 = Boolean
// CHECK-NEXT: v14 = Convert v13 declared={type=false flags=[IsExpected]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
