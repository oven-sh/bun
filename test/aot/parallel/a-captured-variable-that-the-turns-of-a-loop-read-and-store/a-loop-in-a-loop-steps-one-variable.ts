const n = (value: number) => Number(process.argv[8] ?? value);
function make(text: string) { let pos = 0, words = 0; const end = text.length; return { run() { while (pos < end) { while (pos < end && text.charCodeAt(pos) === 32) pos++; if (pos < end) { words++; while (pos < end && text.charCodeAt(pos) !== 32) pos++; } } return words; }, get: () => pos }; }
const m = make("  ab cde  f ".repeat(n(4)));
console.log(m.run(), m.get());
