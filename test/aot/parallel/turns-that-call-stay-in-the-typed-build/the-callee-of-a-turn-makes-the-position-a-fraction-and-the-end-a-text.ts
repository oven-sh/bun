function makeReader(words: string) {
  let text: string = words, at: number = 0, end: number = words.length;
  let calls = 0;
  function unitAt(i: number): number { return text.charCodeAt(i); }
  function jolt(): void { calls++; if (calls % 4 === 0) at = at + 1.5; else if (calls % 4 === 2) { at++; end = ("" + end) as unknown as number; } else at++; }
  function count(): number {
    let units = 0;
    while (at < end) {
      const unit = unitAt(at);
      if (unit === 92) { jolt(); continue; }
      units += unit === unit ? unit : 1000;
      at++;
    }
    return units;
  }
  function take(next: string): void { text = next; at = 0; end = next.length; }
  return { count, take, seen: () => calls + ":" + at + ":" + typeof end };
}
const reader = makeReader("");
(globalThis as any).readers = [reader];
let sum = 0;
for (let k = 0; k < 200; k++) { reader.take("cccc\\ccccccc\\cccccccccc\\cccccc\\ccc"); sum += reader.count(); }
console.log(sum, reader.seen());
