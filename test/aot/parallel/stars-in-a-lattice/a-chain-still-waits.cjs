// 200 barrels, each with one star over the one below: no star is carried out for a read.
// COUNT: counter:StarsRecorded = 200
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
function makeBarrel(level) {
  return { __esModule: true, level: level };
}
let top = { first: 1, second: 2 };
for (let level = 1; level <= 200; level++) {
  const barrel = makeBarrel(level);
  __exportStar(top, barrel);
  top = barrel;
}
console.log(top.first, top.second, top.missing === undefined, top.level);
