const n = (value: number) => Number(process.argv[8] ?? value);
function make() { let pos = 0; return { *run(limit: number) { while (pos < limit) { yield pos; pos++; } }, set(to: number) { pos = to; }, get: () => pos }; }
const m = make(); const seen: number[] = [];
for (const at of m.run(n(12))) { seen.push(at); if (at === 3) m.set(8); }
console.log(seen.join(), m.get());
