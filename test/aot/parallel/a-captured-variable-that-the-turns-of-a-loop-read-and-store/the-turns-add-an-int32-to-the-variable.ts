const n = (value: number) => Number(process.argv[8] ?? value);
function make(text: string) { let pos = 0; const end = text.length; const size = (ch: number) => ch >= 100 ? 2 : 1;
  return { run() { let seen = 0; while (pos < end) { const ch = text.charCodeAt(pos); seen += ch; pos += size(ch); } return seen; }, back(by: number) { let turns = 0; while (pos > 0) { pos -= by; turns++; } return turns; }, set(to: number) { pos = to; }, get: () => pos }; }
const m = make("abcdefgh".repeat(n(3)));
console.log(m.run(), m.get(), m.back(n(3)), m.get(), (m.set(n(7)), m.back(0.5)), m.get());
