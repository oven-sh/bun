"use strict";
// COUNT: operation:operationAOTFillSiteAnswers <= 80
const add = (a, b) => (a + b) | 0, low = a => a & 15, none = () => 7, three = (a, b, c) => (a ^ b ^ c) | 0, four = (a, b, c, d) => (a + b - c + d) | 0;
const impl = { add, low, none, three, four };
const defineAll = (target, all) => { for (const name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true, configurable: true }); return target; };
const copyAll = (to, from) => { for (const key of Object.getOwnPropertyNames(from)) if (!Object.prototype.hasOwnProperty.call(to, key)) Object.defineProperty(to, key, { get: () => from[key], enumerable: true }); return to; };
const bind = (o, m, k, k2 = k) => Object.defineProperty(o, k2, { enumerable: true, get: function () { return m[k]; } });
const named = defineAll({}, { add: () => add, low: () => low, none: () => none, three: () => three, four: () => four });
const copied = copyAll(Object.defineProperty(Object.create(Object.getPrototypeOf(impl)), "default", { value: impl, enumerable: true }), impl);
const bound = {}; for (const key of Object.keys(impl)) bind(bound, impl, key); bind(bound, impl, "low", "lowest");
const each = {}; Object.keys(impl).forEach(function (key) { if (key in each && each[key] === impl[key]) return; Object.defineProperty(each, key, { enumerable: true, get: function () { return impl[key]; } }); });
function drive(turns) {
  let s = 0;
  for (let i = 0; i < turns; i++) {
    s = (s + named.add(i, 3) + named.low(i) + named.none() + named.three(i, 1, 2) + named.four(i, 1, 2, 3)) | 0;
    s = (s + copied.add(i, 5) + copied.low(i) + copied.none() + copied.three(i, 3, 4) + copied.four(i, 5, 6, 7) + copied.default.low(i)) | 0;
    s = (s + bound.add(i, 7) + bound.lowest(i) + bound.none() + each.add(i, 9) + each.three(i, 5, 6) + each.four(i, 7, 8, 9)) | 0;
  }
  return s;
}
console.log(drive(+(process.argv[2] ?? 3000)));
