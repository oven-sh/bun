const kept = [];
function keeps(job) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; kept.push(job); return work; }
function calls(job) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return job() + work; }
const takers = [keeps, calls];
function check(step, first) { let wrong = 0; for (let k = 0; k < kept.length; k++) if (kept[k]() !== k * step + first) wrong++; return wrong; }
function make(start, wants) { let total = start; function add() { total++; } add(); if (wants) return () => total; }
function again(job) { const other = make(-5, true); const mine = job(); return mine * 1000 + other() + make(-9, true)(); }
function once(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return again(make(n | 0, true)) + work; }
function drive() { let sum = 0; for (let t = 0; t < 400; t++) sum += once(t); return sum; }
console.log(make(5, false) === undefined, drive());
