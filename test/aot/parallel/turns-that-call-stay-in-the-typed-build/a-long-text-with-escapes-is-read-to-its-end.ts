function makeReader(words: string) {
  let text: string = words, at = 0, end = words.length, escapes = 0;
  function unitAt(i: number): number { return text.charCodeAt(i); }
  function readEscape(): string { escapes++; at += 2; return "<" + text.charAt(at - 1) + ">"; }
  function readQuoted(): string {
    const quote = unitAt(at);
    at++;
    let result = "";
    let start = at;
    while (true) {
      if (at >= end) { result += text.substring(start, at); break; }
      const unit = unitAt(at);
      if (unit === quote) { result += text.substring(start, at); at++; break; }
      if (unit === 92) { result += text.substring(start, at); result += readEscape(); start = at; continue; }
      at++;
    }
    return result;
  }
  function take(next: unknown, length: number): void { text = next as string; at = 0; end = length; }
  return { readQuoted, take, seen: () => escapes + ":" + at };
}
const reader = makeReader("");
(globalThis as any).readers = [reader];
let long = "'";
for (let k = 0; k < 400; k++) long += k % 7 === 3 ? "\\n" : "word" + k;
long += "' rest";
let sum = 0;
for (let k = 0; k < 60; k++) { reader.take(long, long.length); sum += reader.readQuoted().length; }
reader.take("'plain' x", 9);
console.log(sum, reader.readQuoted(), reader.seen());
