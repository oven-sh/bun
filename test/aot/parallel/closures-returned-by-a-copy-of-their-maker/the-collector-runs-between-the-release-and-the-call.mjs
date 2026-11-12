const kept = [];
function keeps(job) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; kept.push(job); return work; }
function calls(job) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return (typeof job === "function" ? job() : job.get()) + work; }
const takers = [keeps, calls];
function read(job) { return typeof job === "function" ? job() : job.get(); }
function check(step) { let wrong = 0; for (let k = 0; k < kept.length; k++) if (read(kept[k]) !== k * step + 1) wrong++; return wrong; }
function gcThenCall(job) { Bun.gc(true); return job(); }
function make(start, wants) { let box = { n: start }; function add() { box = { n: box.n + 1 }; } add(); if (wants) return () => box.n; }
function once(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return gcThenCall(make(n | 0, true)) + work; }
let sum = 0; for (let t = 0; t < 40; t++) sum += once(t * 10);
console.log(make(5, false) === undefined, sum);
