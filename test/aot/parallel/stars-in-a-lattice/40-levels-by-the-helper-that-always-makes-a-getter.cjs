// 40 levels by the helper as TypeScript emitted it up to 4.5: each level has getters of its own, which read the level below.
// COUNT: counter:StarsRecorded = 160
// COUNT: counter:StarsCarriedOutLate = 0
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
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
console.log(left.first, left.second, right.first, left.missing === undefined, left.level, "second" in right);
