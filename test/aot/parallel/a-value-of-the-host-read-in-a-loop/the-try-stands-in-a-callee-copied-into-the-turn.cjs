"use strict";
const n = +process.argv[2] || 5;
function work(i) { if (i % 2) throw new Error("odd"); return i; }
function one(i) { try { if (process.env.K124_NOT_SET) return "set"; return "" + work(i); } catch (error) { return error.message + i; } }
function f(turns) { let out = ""; for (let i = 0; i < turns; i++) out += one(i) + " "; return out; }
console.log(f(n));
