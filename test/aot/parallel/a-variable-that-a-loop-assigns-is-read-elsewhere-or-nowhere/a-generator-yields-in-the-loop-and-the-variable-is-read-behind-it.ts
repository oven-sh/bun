const n = (value: number) => Number(process.argv[8] ?? value);
function* run(limit: number) { let last = "none"; for (let i = 0; i < limit; i++) { last = "turn " + i; yield i; } return last; }
function drain(limit: number) { const it = run(limit); let step = it.next(); let count = 0; while (!step.done) { count++; step = it.next(); } return count + " " + step.value; }
console.log(drain(n(3)), drain(n(0)));
