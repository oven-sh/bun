// 40 levels of one kind of barrel, and the two of level 20 get a name behind their stars, as `export { own } from` stands behind `export *`. Below them no star binds it, above them every first star does.
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
let left = { first: 1 };
let right = { second: 2 };
for (let level = 1; level <= 40; level++) {
  const a = makeBarrel(level), b = makeBarrel(level);
  __exportStar(left, a); __exportStar(right, a);
  __exportStar(left, b); __exportStar(right, b);
  if (level === 20) { a.own = "of the left barrel"; b.own = "of the right barrel"; }
  left = a; right = b;
}
console.log(left.own, right.own, left.first, right.second, left.missing === undefined, Object.keys(left).join());
