globalThis.later.push(() => exports.early, () => exports.late, () => exports.C, () => new C().x, () => l, () => module.exports === exports, () => Object.keys(module.exports).join());
exports.early = 1;
null.x;
let l = 5;
class C { x = 1; }
exports.late = 2;
exports.C = C;
module.exports = { replaced: true };
