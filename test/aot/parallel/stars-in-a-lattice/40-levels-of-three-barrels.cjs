// 40 levels of three barrels, each with a star over all three below.
// COUNT: counter:StarsRecorded = 360
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
let below = [{ first: 1 }, { second: 2 }, { third: 3 }];
for (let level = 1; level <= 40; level++) {
  const here = [makeBarrel(level), makeBarrel(level), makeBarrel(level)];
  for (let target = 0; target < 3; target++) {
    for (let source = 0; source < 3; source++) __exportStar(below[source], here[target]);
  }
  below = here;
}
console.log(below[0].first, below[1].second, below[2].third, below[0].missing === undefined, Object.keys(below[2]).join());
