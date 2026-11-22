"use strict";
function one(a, b) { return (a + b) | 0; }
function two(a, b) { return (a * b) | 0; }
let pick = one;
if (process.argv.length > 0) pick = two;
function total(turns, t) { let s = 0; for (let i = 0; i < turns; i++) s = (s + pick(i, t)) | 0; return s; }
const out = [total(4, 3)];
pick = 5;
out.push(total(0, 3));
try { out.push(total(2, 3)); } catch (error) { out.push(error.name); }
pick = undefined;
try { out.push(total(2, 3)); } catch (error) { out.push(error.name); }
pick = one;
out.push(total(4, 3));
console.log(out.join(" "));
