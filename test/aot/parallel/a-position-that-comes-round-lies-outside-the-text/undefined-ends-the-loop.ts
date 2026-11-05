const n = (value: number) => Number(process.argv[8] ?? value);
function make(text: string) { let pos = 0; return { run() { let sum = 0; for (;;) { const cp = text.codePointAt(pos); if (cp === undefined) break; sum += cp; pos += cp > 0xFFFF ? 2 : 1; } return sum + ":" + pos; }, set(to: number) { pos = to; } }; }
const m = make("ab\u{1F600}c\u{10000}".repeat(n(2))); (globalThis as any).kept = m;
console.log(m.run(), (m.set(3), m.run()), (m.set(n(99)), m.run()), (m.set(-1), m.run()), (m.set(0.5), m.run()));
