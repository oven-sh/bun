const n = (value: number) => Number(process.argv[8] ?? value);
function make() { let pos = 0; const sly: any = { valueOf() { pos += 3; return 1; } }; return { run(limit: number, by: any) { let sum = 0; while (pos < limit) { sum += by * 2; pos++; } return sum; }, sly, get: () => pos, set(to: number) { pos = to; } }; }
const m = make();
console.log(m.run(n(40), m.sly), m.get(), (m.set(0), m.run(n(40), 1)), m.get());
