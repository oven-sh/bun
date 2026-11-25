const kept = [];
function keeps(job) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; kept.push(job); return work; }
function calls(job) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return (typeof job === "function" ? job() : job.get()) + work; }
const takers = [keeps, calls];
function read(job) { return typeof job === "function" ? job() : job.get(); }
function check(step) { let wrong = 0; for (let k = 0; k < kept.length; k++) if (read(kept[k]) !== k * step + 1) wrong++; return wrong; }
function make(start, wants) { let total = start; function add() { total++; } add(); if (wants) return async () => { await 0; return total; }; }
const pending = [];
function starts(job) { pending.push(job()); return 0; }
function once(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return starts(make(n | 0, true)) + work; }
for (let t = 0; t < 200; t++) once(t * 10);
const got = await Promise.all(pending);
console.log(make(5, false) === undefined, got.length, got.filter((v, k) => v !== k * 10 + 1).length);
