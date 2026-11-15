// The leaf is frozen.
// COUNT: counter:StarsRecorded >= 2
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
const leaf = { __esModule: true, first: 1, second: 2 };
const middle = { __esModule: true, ownOfMiddle: "middle" };
const top = { __esModule: true, ownOfTop: "top" };
__exportStar(leaf, middle);
__exportStar(middle, top);
function read(barrel) {
  return barrel.first;
}
function readOften(turns) {
  let found = 0;
  for (let turn = 0; turn < turns; turn++) found += read(top) === undefined ? 0 : 1;
  return found;
}
Object.freeze(leaf);
console.log(String(read(top)), readOften(5), String(read(middle)), String(top.second), "first" in top);
console.log(readOften(300), String(read(top)), String(read(middle)), Object.keys(top).join(), Object.keys(middle).join());
