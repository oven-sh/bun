import { lib } from "./lib.mjs";
globalThis.kept = lib;
function sums(t) { let s = t & 1; for (let i = 0; i < 100; i++) s = s + (lib.add(i, t) + lib.low(i)) | 0; return s >>> 0; }
console.log(sums(3), sums(4));
