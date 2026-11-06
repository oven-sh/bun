// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: KnownHelperFunctions >= 4
// STATISTIC: KnownHelperCalls >= 7

// FILE: main.cjs
// A helper's variable holds what the program gave it: a function it assigns later, or the one that `this` has, as the emitted text asks. The other helpers and the calls in the file call that.
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
const describe = object => Object.entries(Object.getOwnPropertyDescriptors(object)).map(([key, d]) => `${key}:${Object.keys(d)}`).join(" ");
const before = {};
__exportStar({ a: 1 }, before);
console.log(describe(before));
const original = __createBinding;
__createBinding = function (o, m, k) { o[k] = `mine ${m[k]}`; };
const between = {};
__exportStar({ a: 1 }, between);
console.log(describe(between), between.a);
__createBinding = undefined;
try {
  __exportStar({ a: 1 }, {});
} catch (error) {
  console.log(error.constructor.name);
}
console.log(__exportStar({}, {}));
__createBinding = original;
const after = {};
__exportStar({ a: 1 }, after);
console.log(describe(after));

const originalStar = __exportStar;
__exportStar = function (m, exports) { exports.names = Object.keys(m).join(); };
const byAnotherStar = {};
__exportStar({ a: 1, b: 2 }, byAnotherStar);
console.log(describe(byAnotherStar), byAnotherStar.names);
__exportStar = originalStar;
const byTheStarAgain = {};
__exportStar({ a: 1, b: 2 }, byTheStarAgain);
console.log(describe(byTheStarAgain));

const borrowed = { bind: original, star: originalStar };
const byMethod = {};
borrowed.bind(byMethod, { a: 1 }, "a");
original.call(null, byMethod, { b: 2 }, "b");
original.apply(undefined, [byMethod, { c: 3 }, "c", "renamed"]);
Reflect.apply(original, 5, [byMethod, { d: 4 }, "d"]);
borrowed.star({ e: 5 }, byMethod);
console.log(describe(byMethod), original.length, JSON.stringify(original.name), originalStar.length, JSON.stringify(originalStar.name));
console.log(new original({}, { a: 1 }, "a") instanceof original);

function emittedInAFunction() {
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
  const to = {};
  __exportStar({ a: 1 }, to);
  return `${describe(to)} ${to.a}`;
}
console.log(emittedInAFunction.call(undefined));
console.log(emittedInAFunction.call({}));
console.log(emittedInAFunction.call({ __createBinding(o, m, k) { o[k] = `bound by what this has: ${m[k]}`; } }));
console.log(emittedInAFunction.call({ __exportStar(m, exports) { exports.a = "starred by what this has"; } }));
console.log(emittedInAFunction.call({ __createBinding: original, __exportStar: originalStar }));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: describe __createBinding __exportStar get
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectEntries
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectGetOwnPropertyDescriptors
// CHECK-NEXT: v5 = Call v4, v3, v0 calleeName="Object.getOwnPropertyDescriptors"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v2, v1, v6 calleeName="Object.entries"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|Array<undefined|null|number|string|symbol|bigint|[[L_2]]>> flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="map"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v11 = NewClosure function=[[f_4]]
// CHECK-NEXT: v12 = Call v10, v8, v11 calleeKey="map" calleeName="map"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="join"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v16 = String string=" "
// CHECK-NEXT: v17 = Call v15, v13, v16 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v17 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__createBinding"
// CHECK: module=[[m_0]] position={{*}} text={{*}} length=3 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|object flags=[IsExpected]}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|object, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = String string="mine "
// CHECK-NEXT: v4 = ElemGet v1, v2
// CHECK-NEXT: v5 = ToString v4
// CHECK-NEXT: v6 = Strcat v3, v5
// CHECK-NEXT: ElemSet v0, v2, v6
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__exportStar"
// CHECK: module=[[m_0]] position={{*}} text={{*}} length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|number|string|symbol|bigint|[[L_7]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|number|string|symbol|bigint|[[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeName="Object.keys"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="join"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v7, v5 calleeKey="join" calleeName="join"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropSet v1, v9 key="names"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__createBinding"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|object flags=[IsExpected]}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|object, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = String string="bound by what this has: "
// CHECK-NEXT: v4 = ElemGet v1, v2
// CHECK-NEXT: v5 = ToString v4
// CHECK-NEXT: v6 = Strcat v3, v5
// CHECK-NEXT: ElemSet v0, v2, v6
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__exportStar"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|number|string|symbol|bigint|[[L_10]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|number|string|symbol|bigint|[[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = String string="starred by what this has"
// CHECK-NEXT: PropSet v1, v2 key="a"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} captures=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|number|string|symbol flags=[IsExpected]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|number|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} captures=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|number|string|symbol flags=[IsExpected]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|number|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
