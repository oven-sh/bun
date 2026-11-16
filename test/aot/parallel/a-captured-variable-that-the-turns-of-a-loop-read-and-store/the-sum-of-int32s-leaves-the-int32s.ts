const n = (value: number) => Number(process.argv[8] ?? value);
function make() { let pos = 0; return { run(limit: number, by: number) { let turns = 0; const step = by | 0; while (pos < limit) { pos += step; turns++; } return turns; }, set(to: number) { pos = to; }, get: () => pos }; }
const m = make();
m.set(n(2147483000)); console.log(m.run(2147485000, n(500)), m.get()); m.set(n(-2147483648)); console.log(m.run(-2147483000, n(300)), m.get()); m.set(0.25); console.log(m.run(3, 1), m.get());
