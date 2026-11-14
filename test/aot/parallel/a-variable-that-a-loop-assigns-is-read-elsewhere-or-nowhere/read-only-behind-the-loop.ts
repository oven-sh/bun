const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number) { let last = -1; for (let i = 0; i < limit; i++) { last = i * 3; } return last; }
console.log(run(n(5)), run(n(0)), run(n(1)));
