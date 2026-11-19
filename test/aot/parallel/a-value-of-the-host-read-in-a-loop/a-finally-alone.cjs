"use strict";
const n = +process.argv[2] || 5;
function f(turns) { let out = ""; for (let i = 0; i < turns; i++) { try { if (process.env.K124_NOT_SET) continue; out += i + " "; } finally { out += ";"; } } return out; }
console.log(f(n));
