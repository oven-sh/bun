const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number) { let seen = 100; let sum = 0; for (let i = 0; i < limit; i++) { for (let j = 0; j < 2; j++) { sum += seen; } seen = i; } return sum; }
console.log(run(n(4)), run(n(0)), run(n(1)));
