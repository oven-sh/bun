const kept = [];
function keeps(job) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; kept.push(job); return work; }
function calls(job) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return (typeof job === "function" ? job() : job.get()) + work; }
const takers = [keeps, calls];
function read(job) { return typeof job === "function" ? job() : job.get(); }
function check(step) { let wrong = 0; for (let k = 0; k < kept.length; k++) if (read(kept[k]) !== k * step + 1) wrong++; return wrong; }
function make(start, which) { let total = start; function add() { total++; } add(); if (which === 1) return () => total; if (which === 2) return () => total + 0; }
function once(take, n, which) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const got = take(make(n | 0, which)); return got + work; }
function drive() { let sum = 0; for (let t = 0; t < 400; t++) sum += once(takers[t & 1], t * 10, 1 + ((t >> 1) & 1)); return sum; }
console.log(make(5, 0) === undefined, drive(), kept.length, check(20));
