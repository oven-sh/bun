// By the helper as TypeScript emitted it up to 4.5 a getter calls the getter below it. Where the stack runs out that is an error like any other; where the getters are not made it does not run out.
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
  answer = top.first;
} catch (error) {
  answer = error.constructor.name;
}
console.log(answer === 1 || answer === "RangeError", "second" in top, "missing" in top);
