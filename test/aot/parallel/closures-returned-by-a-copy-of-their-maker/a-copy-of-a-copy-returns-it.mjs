const kept = [];
function keeps(job) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; kept.push(job); return work; }
function calls(job) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return (typeof job === "function" ? job() : job.get()) + work; }
const takers = [keeps, calls];
function read(job) { return typeof job === "function" ? job() : job.get(); }
function check(step) { let wrong = 0; for (let k = 0; k < kept.length; k++) if (read(kept[k]) !== k * step + 1) wrong++; return wrong; }
function make(start, wants) { let total = start; function add() { total++; } add(); if (wants) return () => total; }
function outer(n, wants) { if (wants) return make(n, true); }
function once(take, n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const got = take(outer(n | 0, true)); return got + work; }
function drive() { let sum = 0; for (let t = 0; t < 400; t++) sum += once(takers[t & 1], t * 10); return sum; }
console.log(make(5, false) === undefined, outer(1, false) === undefined, drive(), kept.length, check(20));
