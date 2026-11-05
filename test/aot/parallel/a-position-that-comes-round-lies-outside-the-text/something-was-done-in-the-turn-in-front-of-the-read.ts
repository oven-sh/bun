const n = (value: number) => Number(process.argv[8] ?? value);
function make(text: string) { let pos = 0, turns = 0; return { run(limit: number) { let sum = 0; while (pos < limit) { turns++; const cp = text.codePointAt(pos); sum += cp === undefined ? 1000 : cp; pos++; } return [sum, pos, turns].join(); }, set(to: number) { pos = to; } }; }
const m = make("abc".repeat(n(1))); (globalThis as any).kept = m;
console.log(m.run(n(6)), (m.set(-2), m.run(n(1))), (m.set(1), m.run(n(2))));
