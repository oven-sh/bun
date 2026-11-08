const n = (value: number) => Number(process.argv[8] ?? value);
function make() { let pos = 0; return { run(limit: number) { let turns = 0; while (pos < limit) { pos++; turns++; } return turns; }, set(to: number) { pos = to; }, get: () => pos }; }
const m = make();
m.set(n(2147483640)); console.log(m.run(2147483660), m.get());
m.set(n(0.5)); console.log(m.run(4), m.get());
m.set(NaN); console.log(m.run(4), m.get());
m.set(-2147483648); console.log(m.run(-2147483640), m.get());
(m.set as any)("7"); console.log(m.run(10), m.get(), typeof m.get());
