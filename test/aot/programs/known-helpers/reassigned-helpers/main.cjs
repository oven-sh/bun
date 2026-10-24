// A helper's variable holds what the program gave it: a function it assigns later, or the one that `this` has, as the emitted text asks. The other helpers and the calls in the file call that.
// STATISTIC: KnownHelperFunctions >= 4
// STATISTIC: KnownHelperCalls >= 7
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
