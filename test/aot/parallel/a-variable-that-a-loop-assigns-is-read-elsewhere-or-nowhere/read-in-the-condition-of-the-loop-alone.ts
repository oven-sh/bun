const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number) { let more = true; let turns = 0; while (more) { turns++; more = turns < limit; } return turns; }
console.log(run(n(4)), run(n(0)));
