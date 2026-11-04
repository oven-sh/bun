// 40 levels. A leaf and a barrel in the middle get names when the stars over them have run: nobody above has them. A barrel below the top gets one between the two stars over it: the second has it. What a leaf holds under an old name is read as it is now.
// COUNT: counter:StarsRecorded = 158
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
const leaf = { first: 1 };
let middle;
let left = leaf;
let right = { second: 2 };
for (let level = 1; level <= 40; level++) {
  const a = makeBarrel(level), b = makeBarrel(level);
  __exportStar(left, a); __exportStar(right, a);
  if (level === 40) left.between = "between";
  __exportStar(left, b); __exportStar(right, b);
  left = a; right = b;
  if (level === 10) middle = a;
}
leaf.tooLate = 3;
middle.tooLate = 4;
leaf.first = 10;
console.log(left.tooLate === undefined, "tooLate" in right, left.first, right.first, middle.tooLate, middle.first);
console.log(left.between, right.between, Object.keys(left).join(), Object.keys(right).join());
