const lib = require("./lib.cjs");
globalThis.kept = lib;
function sums(t) { let s = t & 1; for (let i = 0; i < 100; i++) s = s + (lib.add(i, t) + lib.low(i)) | 0; return s >>> 0; }
console.log(sums(3));
delete globalThis.kept.low;
try { console.log(sums(3)); } catch (error) { console.log(error instanceof TypeError, error.message); }
Object.defineProperty(globalThis.kept, "low", { get() { console.log("asked"); return (a) => a & 3; }, configurable: true });
console.log(lib.low(7), sums(0) > 0);
