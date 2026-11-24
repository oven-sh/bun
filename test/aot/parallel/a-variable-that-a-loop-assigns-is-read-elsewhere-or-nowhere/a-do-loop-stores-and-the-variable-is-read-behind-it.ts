const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number) { let turns = 0; let last = "none"; do { last = "turn " + turns; turns++; } while (turns < limit); return last; }
console.log(run(n(3)), run(n(0)));
