const lib = require("./lib.cjs");
globalThis.kept = lib;
function sums(t) { let s = t & 1; for (let i = 0; i < 100; i++) s = s + (lib.add(i, t) + lib.low(i)) | 0; return s >>> 0; }
console.log(sums(3));
globalThis.kept.add = function other(a, b) { return a - b | 0; };
console.log(sums(3));
globalThis.kept.low = function () { globalThis.kept.add = (a, b) => a * b | 0; return 1; };
console.log(sums(3));
