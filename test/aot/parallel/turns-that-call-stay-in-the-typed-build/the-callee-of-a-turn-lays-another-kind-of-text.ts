function makeReader(words: string) {
  let text: string = words, at = 0, end = words.length;
  const odd = { charCodeAt(i: number): number { return i % 5 === 4 ? 92 : 66; }, length: 40 };
  let swaps = 0;
  function unitAt(i: number): number { return text.charCodeAt(i); }
  function swap(): void { swaps++; at++; if (swaps % 3 === 0) { text = odd as unknown as string; end = 40 > at ? 40 : at; } else if (swaps % 3 === 1) { text = "aaaa\\aaaaaaaa\\aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; end = text.length; } }
  function count(): number {
    let units = 0;
    while (at < end) {
      const unit = unitAt(at);
      if (unit === 92) { swap(); continue; }
      units += unit;
      at++;
    }
    return units;
  }
  function take(next: string): void { text = next; at = 0; end = next.length; }
  return { count, take, seen: () => swaps };
}
const reader = makeReader("");
(globalThis as any).readers = [reader];
let sum = 0;
for (let k = 0; k < 200; k++) { reader.take("bbbb\\bbbbbbbbbbb\\bbbbbbbbbbbbbbbbb\\bbbb"); sum += reader.count(); }
console.log(sum, reader.seen());
