// 40 levels of two barrels, each with a star over both barrels below, by the helpers as TypeScript emits them. The roads from the top to a leaf double with each level, the stars do not.
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
function makeBarrel(level) {
  return { __esModule: true, level: level };
}
let left = { first: 1 };
let right = { second: 2 };
for (let level = 1; level <= 40; level++) {
  const a = makeBarrel(level), b = makeBarrel(level);
  __exportStar(left, a); __exportStar(right, a);
  __exportStar(left, b); __exportStar(right, b);
  left = a; right = b;
}
const { test } = require("bun:test");
test("names behind 40 levels of stars", () => {
  console.log(left.first, left.second, right.first, left.missing === undefined, "second" in right, "missing" in right, Object.keys(left).join());
});
