const n = (value: number) => Number(process.argv[8] ?? value);
function make(text: string) { let pos = 0, odd = 0; return { run() { let turns = 0; while (pos < text.length) { turns++; if (text.charCodeAt(pos) === 32) { odd++; pos += 2; continue; } if (turns > 50) break; pos++; } return turns; }, get: () => pos + ":" + odd }; }
const m = make("a b  c   d e".repeat(n(2)));
console.log(m.run(), m.get());
