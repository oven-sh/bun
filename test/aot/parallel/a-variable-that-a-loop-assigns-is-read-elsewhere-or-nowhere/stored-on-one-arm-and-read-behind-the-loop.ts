const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number) { let found = "nothing"; for (let i = 0; i < limit; i++) { if (i % 4 === 3) found = "at " + i; } return found; }
console.log(run(n(9)), run(n(3)), run(n(4)), run(n(0)));
