const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number) { let scratch = 0; let sum = 0; for (let i = 0; i < limit; i++) { scratch = i * 2; sum += scratch; } return sum; }
console.log(run(n(5)), run(n(0)));
