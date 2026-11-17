const n = (value: number) => Number(process.argv[8] ?? value);
function createScanner(text: string) { let pos = 0; const end = text.length; return { skip(stop: number) { while (pos < end) { if (text.charCodeAt(pos) === stop) break; pos++; } return pos; }, set(to: number) { pos = to; }, get: () => pos }; }
const s = createScanner("abc def  ghi".repeat(n(3)));
console.log(s.skip(32), s.get(), (s.set(4), s.skip(32)), (s.set(n(30)), s.skip(1)), s.get(), (s.set(n(99)), s.skip(32)), s.get());
