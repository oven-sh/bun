const n = (value: number) => Number(process.argv[8] ?? value);
function make(text: string) { let pos = 0; const end = text.length; return { run() { const found: number[] = []; while (pos < end) { const cp = text.codePointAt(pos)!; found.push(cp); pos += cp >= 0x10000 ? 2 : 1; } return found.join() + ":" + pos; }, set(to: number) { pos = to; } }; }
const m = make("a\u{1F600}\uD83D".repeat(n(1))); const k = make("\uDE00😀\uD83D"); (globalThis as any).kept = [m, k];
console.log(m.run(), (m.set(2), m.run()), k.run(), (k.set(3), k.run()));
