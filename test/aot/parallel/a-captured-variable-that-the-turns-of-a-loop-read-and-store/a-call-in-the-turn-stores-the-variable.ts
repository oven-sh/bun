const n = (value: number) => Number(process.argv[8] ?? value);
function make() { let pos = 0; const bump = [() => { pos += 2; }, () => {}]; return { run(limit: number, which: number) { let turns = 0; while (pos < limit) { bump[which](); pos++; turns++; } return turns; }, get: () => pos, set(to: number) { pos = to; } }; }
const m = make();
console.log(m.run(n(30), n(0)), m.get(), (m.set(0), m.run(n(30), n(1))), m.get());
