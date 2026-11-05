const n = (value: number) => Number(process.argv[8] ?? value);
function make(text: string) { let pos = 0; return { run() { let seen = 0; while (text.charAt(pos) !== "") { if (text.charAt(pos) === "b") seen++; pos++; } return seen + ":" + pos; }, byIndex() { let seen = 0; while (text[pos] !== undefined) { if (text[pos] === "a") seen++; pos++; } return seen + ":" + pos; }, set(to: number) { pos = to; } }; }
const m = make("abcab".repeat(n(2))); (globalThis as any).kept = m;
console.log(m.run(), (m.set(0), m.byIndex()), (m.set(-3), m.run()), (m.set(-3), m.byIndex()), (m.set(n(10)), m.run()), (m.set(2147483647), m.byIndex()));
