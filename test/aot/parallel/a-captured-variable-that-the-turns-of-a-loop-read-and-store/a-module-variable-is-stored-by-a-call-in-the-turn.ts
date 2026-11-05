const n = (value: number) => Number(process.argv[8] ?? value);
let pos = 0; const bump = [() => { pos += 2; }, () => {}];
function run(limit: number, which: number): number { let turns = 0; while (pos < limit) { bump[which](); pos++; turns++; } return turns; }
console.log(run(n(30), n(0)), pos, (pos = 0, run(n(30), n(1))), pos);
