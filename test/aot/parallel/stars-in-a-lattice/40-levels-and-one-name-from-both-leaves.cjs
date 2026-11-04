// 40 levels, and both leaves have the name: the first star wins at every level. `default` is bound by none, and what a barrel has itself stays.
// COUNT: counter:StarsRecorded = 160
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
let left = { first: 1, shared: "of the left leaf", default: "left", level: "of the left leaf" };
let right = { shared: "of the right leaf", second: 2, default: "right" };
for (let level = 1; level <= 40; level++) {
  const a = makeBarrel(level), b = makeBarrel(level);
  __exportStar(left, a); __exportStar(right, a);
  __exportStar(left, b); __exportStar(right, b);
  left = a; right = b;
}
console.log(left.shared, right.shared, left.default === undefined, "default" in right, left.level, Object.keys(left).join());
