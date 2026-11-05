const n = (value: number) => Number(process.argv[8] ?? value);
function make(text: string) { let pos = 0; return { run(limit: number) { let sum = 0; while (pos < limit) { sum += text.codePointAt(pos) ?? 1; pos++; } return sum + ":" + pos; }, set(to: number) { pos = to; } }; }
const m = make("xyz".repeat(n(1))); (globalThis as any).kept = m;
console.log(m.run(n(50)), (m.set(0), m.run(n(2))), (m.set(2), m.run(n(4))));
