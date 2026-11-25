const kept = [];
function keeps(job) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; kept.push(job); return work; }
function calls(job) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return job() + work; }
const takers = [keeps, calls];
function check(step, first) { let wrong = 0; for (let k = 0; k < kept.length; k++) if (kept[k]() !== k * step + first) wrong++; return wrong; }
function make(start, wants) { let total = start; function add() { total++; } add(); { let inner = total * 2; const bump = () => { inner++; }; bump(); if (wants) return () => total + inner; } }
function once(take, n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const got = take(make(n | 0, true)); return got + work; }
function drive() { let sum = 0; for (let t = 0; t < 400; t++) sum += once(takers[t & 1], t * 10); return sum; }
console.log(make(5, false) === undefined, drive(), kept.length, check(60, 4));
