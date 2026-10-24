// Functions that are named as TypeScript's helpers and differ from them in one place are ordinary functions. So is one that differs from __exportStar in one place and calls the real __createBinding, which is the only known helper here, under another name.
// TODO: the build counts 3: look-alikes are taken for the helper: STATISTIC: KnownHelperFunctions = 1
// STATISTIC: KnownHelperCalls = 0
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
