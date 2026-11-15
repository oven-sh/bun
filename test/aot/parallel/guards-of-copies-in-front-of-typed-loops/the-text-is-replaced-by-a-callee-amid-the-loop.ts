function makeReader(words: string, hook: (at: number) => void) {
  let text: string = words, at = 0, end = words.length;
  function unitAt(s: string, i: number): number { return s.charCodeAt(i); }
  function count(): number { let spaces = 0; while (at < end) { if (unitAt(text, at) === 32) { spaces++; hook(at); } at++; } return spaces; }
  function take(next: unknown): void { text = next as string; }
  function rewind(next: string): void { text = next; at = 0; end = next.length; }
  return { count, take, rewind };
}
let turns = 0;
const reader = makeReader("", (at) => { turns++; if (turns % 5 === 0) reader.take({ charCodeAt(i: number): number { return i % 4 === 0 ? 32 : 66; } }); else if (turns % 5 === 2) reader.take("x x x x x x x x x x x x"); });
(globalThis as any).readers = [reader];
let sum = 0;
for (let k = 0; k < 300; k++) { reader.rewind("a b  c d e f g h i j k"); sum += reader.count(); }
console.log(sum, turns);
