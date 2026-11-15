const n = (value: number) => Number(process.argv[8] ?? value);
function make() { let pos = 0; return { async run(limit: number) { let turns = 0; while (pos < limit) { await null; pos++; turns++; } return turns; }, set(to: number) { pos = to; }, get: () => pos }; }
const m = make(); const running = m.run(n(10)); m.set(6);
console.log(await running, m.get());
