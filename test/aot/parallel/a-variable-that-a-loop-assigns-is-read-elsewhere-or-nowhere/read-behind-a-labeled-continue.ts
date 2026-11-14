const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number) { let last = "none"; outer: for (let i = 0; i < limit; i++) { for (let j = 0; j < 3; j++) { if (j === 1) continue outer; last = i + "." + j; } last = "never"; } return last; }
console.log(run(n(3)), run(n(0)));
