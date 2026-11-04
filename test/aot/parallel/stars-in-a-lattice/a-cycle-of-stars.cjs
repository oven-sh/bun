// Two barrels with stars over each other, 40 times round, and a third over both.
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
const one = { __esModule: true, first: 1 }, other = { __esModule: true, second: 2 }, top = { __esModule: true };
for (let turn = 0; turn < 40; turn++) {
  __exportStar(other, one); __exportStar(one, other);
  __exportStar(one, top); __exportStar(other, top);
}
__exportStar(top, top);
console.log(one.second, other.first, top.first, top.second, top.missing === undefined, Object.keys(one).join(), Object.keys(other).join(), Object.keys(top).join());
other.second = 20;
console.log(one.second, top.second);
