// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: KnownHelperCalls = 0

// FILE: main.cjs
// Functions that are named as TypeScript's helpers and differ from them in one place are ordinary functions. So is one that differs from __exportStar in one place and calls the real __createBinding, which is the only known helper here, under another name.
// Todo: the build counts 3: look-alikes are taken for the helper: STATISTIC: KnownHelperFunctions = 1
"use strict";
var __createBinding = function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: false, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
};
var __exportStar = function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
function shadowed(Object) {
  return function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
  };
}
function shadowsUndefined(undefined) {
  return function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
  };
}
var swapped = function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(o, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
};
var readsOtherKey = function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k2]; } };
    }
    Object.defineProperty(o, k2, desc);
};
var oneMoreStatement = function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
    return o;
};
var comparesLoosely = function(o, m, k, k2) {
    if (k2 == undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
};
var asksForAnotherMarker = function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esmodule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
};
var real = function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
};
var takesDefaultToo = function(m, exports) {
    for (var p in m) if (!Object.prototype.hasOwnProperty.call(exports, p)) real(exports, m, p);
};
var takesOwnNamesOnly = function(m, exports) {
    for (var p of Object.keys(m)) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) real(exports, m, p);
};
var overwrites = function(m, exports) {
    for (var p in m) if (p !== "default") real(exports, m, p);
};
var asksTheSource = function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(m, p)) real(exports, m, p);
};
var bindsUnderOneName = function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) real(exports, m, p, "last");
};
function describe(object) {
  return Reflect.ownKeys(object).map(key => {
    const d = Reflect.getOwnPropertyDescriptor(object, key);
    return `${String(key)}: ${Object.keys(d).map(name => `${name}=${typeof d[name] === "function" ? "function" : d[name]}`).join(" ")}`;
  }).join("; ");
}
const target = {};
__exportStar({ a: 1, b: 2 }, target);
console.log(describe(target), Object.keys(target).length);
const calls = [];
const own = shadowed({
  getOwnPropertyDescriptor(m, k) { calls.push(`describe ${k}`); return undefined; },
  defineProperty(o, k, d) { calls.push(`define ${k}`); o[k] = "mine"; },
});
const byOwn = {};
own(byOwn, { a: 1 }, "a");
console.log(describe(byOwn), calls.join());
const byNull = {};
shadowsUndefined(null)(byNull, { a: 1 }, "a", null);
shadowsUndefined(null)(byNull, { a: 1 }, "a");
console.log(describe(byNull));
const bySwapped = { a: 0 };
try { swapped(bySwapped, { a: 1 }, "a"); } catch (error) { console.log(error.constructor.name); }
console.log(describe(bySwapped));
const byOtherKey = {};
readsOtherKey(byOtherKey, { a: 1, z: 26 }, "a", "z");
console.log(describe(byOtherKey), byOtherKey.z);
console.log(oneMoreStatement({}, { a: 1 }, "a").a);
const byLooseComparison = {};
comparesLoosely(byLooseComparison, { a: 1 }, "a", null);
console.log(describe(byLooseComparison));
const marked = { __esModule: true, get a() { return 1; } };
const byAnotherMarker = {};
asksForAnotherMarker(byAnotherMarker, marked, "a");
console.log(describe(byAnotherMarker), Object.getOwnPropertyDescriptor(byAnotherMarker, "a").get === Object.getOwnPropertyDescriptor(marked, "a").get);
const byTheRealOne = {};
real(byTheRealOne, marked, "a");
console.log(describe(byTheRealOne), Object.getOwnPropertyDescriptor(byTheRealOne, "a").get === Object.getOwnPropertyDescriptor(marked, "a").get);

const source = Object.create({ inherited: "inherited" });
source.a = 1;
source.default = "default";
for (const star of [takesDefaultToo, takesOwnNamesOnly, overwrites, asksTheSource, bindsUnderOneName]) {
  const to = { a: "mine" };
  try {
    star(source, to);
  } catch (error) {
    console.log(error.constructor.name);
  }
  console.log(describe(to), to.a, to.last);
}
const byDirectCalls = { a: "mine" };
takesDefaultToo(source, byDirectCalls);
overwrites({ a: 2 }, byDirectCalls);
console.log(describe(byDirectCalls), byDirectCalls.a);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: describe takesDefaultToo defineProperty a
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="map"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v7 = NewClosure v0 function=[[f_2]]
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="map" calleeName="map"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v12 = String string="; "
// CHECK-NEXT: v13 = Call v11, v9, v12 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v13 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="takesDefaultToo"
// CHECK: module=[[m_0]] position={{*}} text={{*}} length=2 captures=[{type=undefined|null|[[f_4]] flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_4]], v1: undefined|null|object, v2: anything):
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
// CHECK-NEXT: v12 = Builtin builtin=ObjectPrototypeHasOwnProperty
// CHECK-NEXT: v13 = PropGet v12 key="call"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v14, v12, v2, v11 calleeKey="call" calleeName="Object.prototype.hasOwnProperty.call"
// CHECK-NEXT: v16 = Convert v15 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v17 = ToBoolean v16
// CHECK-NEXT: Branch v17 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v20 = Call v0, -, v2, v1, v11 calleeName="real"
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b2(v11)
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="defineProperty"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 captures=[{type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=anything}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: undefined|null|object, v2: anything, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = PropGet v0 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="define "
// CHECK-NEXT: v7 = ToString v2
// CHECK-NEXT: v8 = Strcat v6, v7
// CHECK-NEXT: v9 = Call v5, v0, v8 calleeKey="push" calleeName="calls.push"
// CHECK-NEXT: v10 = String string="mine"
// CHECK-NEXT: ElemSet v1, v2, v10
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="a"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
