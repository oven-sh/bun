"use strict";
const names = JSON.parse('["a","b","c"]'), n = +process.argv[2] || 5;
function work(name, i) { if (i % 2) throw new Error(name); return name + i; }
function f(turns) { let out = ""; for (let i = 0; i < turns; i++) { const name = names[i % 3]; try { if (process.env.K124_NOT_SET) out += "set "; out += work(name, i) + " "; } catch (error) { out += "caught " + name + i + error.message + " "; } } return out; }
console.log(f(n));
