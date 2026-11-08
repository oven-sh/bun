// The same, and the top is listed first, which makes the getters of every level.
// COUNT: counter:StarsRecorded = 100000
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
let top = { first: 1, second: 2 };
for (let level = 1; level <= 100000; level++) {
  const barrel = makeBarrel(level);
  __exportStar(top, barrel);
  top = barrel;
}
let answer;
try {
  answer = Object.keys(top).join() + " " + top.first;
} catch (error) {
  answer = error.constructor.name;
}
console.log(answer === "__esModule,level,first,second 1" || answer === "RangeError");
