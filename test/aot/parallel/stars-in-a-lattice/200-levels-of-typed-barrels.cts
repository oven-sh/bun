// 200 levels of typed barrels.
// COUNT: counter:StarsRecorded = 800
// COUNT: counter:StarsCarriedOutLate = 0
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
interface Barrel { __esModule?: boolean; level?: number; first?: number; second?: number; missing?: number }
function makeBarrel(level: number): Barrel {
  return { __esModule: true, level: level };
}
let left: Barrel = { first: 1 };
let right: Barrel = { second: 2 };
for (let level = 1; level <= 200; level++) {
  const a: Barrel = makeBarrel(level), b: Barrel = makeBarrel(level);
  __exportStar(left, a); __exportStar(right, a);
  __exportStar(left, b); __exportStar(right, b);
  left = a; right = b;
}
console.log(left.first, left.second, right.first, left.missing === undefined);
