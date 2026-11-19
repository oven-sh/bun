"use strict";
function one(a, b) { return (a + b) | 0; }
function two(a, b) { return (a * b) | 0; }
function total(turns, t) { let s = 0; for (let i = 0; i < turns; i++) s = (s + pick(i, t)) | 0; return s; }
const out = [];
out.push(total(0, 1));
try { out.push(total(3, 1)); } catch (error) { out.push(error.name); }
let pick = one;
if (process.argv.length > 0) pick = two;
out.push(total(4, 3));
console.log(out.join(" "));
