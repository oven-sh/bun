// 40 levels of marked barrels hand one getter up from the bottom: the descriptor of the top holds the getter of the first level.
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
let lowest;
let left = { first: 1 };
let right = { second: 2 };
for (let level = 1; level <= 40; level++) {
  const a = makeBarrel(level), b = makeBarrel(level);
  __exportStar(left, a); __exportStar(right, a);
  if (level === 1) lowest = a;
  __exportStar(left, b); __exportStar(right, b);
  left = a; right = b;
}
const top = Object.getOwnPropertyDescriptor(left, "first"), bottom = Object.getOwnPropertyDescriptor(lowest, "first");
console.log(typeof top.get, top.set, top.enumerable, top.configurable, top.get === bottom.get, top.get(), Object.getOwnPropertyDescriptor(left, "missing"));
