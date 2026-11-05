const n = (value: number) => Number(process.argv[8] ?? value);
function make(first: string, second: string) { let pos = 0; let text = first; return { run(limit: number, at: number) { let sum = 0; while (pos < limit) { const cp = text.codePointAt(pos); sum += cp === undefined ? -1 : cp; if (pos === at) text = second; pos++; } return sum + ":" + pos + ":" + text; } }; }
const m = make("abcdefgh".repeat(n(1)), "xy"); (globalThis as any).kept = m;
console.log(m.run(n(6), n(3)));
