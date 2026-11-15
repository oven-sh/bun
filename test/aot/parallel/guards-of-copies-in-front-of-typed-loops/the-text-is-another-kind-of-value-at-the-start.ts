function makeReader(words: string) {
  let text: string = words, at = 0, end = words.length;
  function unitAt(s: string, i: number): number { return s.charCodeAt(i); }
  function skipWord(): number { while (at < end && unitAt(text, at) !== 32) at++; return at; }
  function take(next: unknown, length: number): void { text = next as string; at = 0; end = length; }
  return { skipWord, take };
}
const reader = makeReader("alpha beta");
(globalThis as any).readers = [reader];
let sum = 0;
for (let k = 0; k < 400; k++) { reader.take("word" + (k % 7) + " rest", 10); sum += reader.skipWord(); }
const odd = { charCodeAt(i: number): number { return i === 3 ? 32 : 65; } };
reader.take(odd, 8);
const first = reader.skipWord();
reader.take(["no", "text"], 2);
let said = "";
try { reader.skipWord(); } catch (error) { said = (error as Error).constructor.name; }
reader.take("back again", 10);
console.log(sum, first, said, reader.skipWord());
