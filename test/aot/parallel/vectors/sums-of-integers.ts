// Numbers that sum integers of views and lists: bases with fractions, -0, beyond 2 ** 52, NaN; holes and other values in lists; more elements than one stretch takes.
function say(x: unknown) { return Object.is(x, -0) ? "-0" : String(x); }
function integers(n: number, how: number) {
  const list: number[] = [];
  let s = 12345 + how;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) | 0;
    list.push(how === 0 ? i % 7 : how === 1 ? s : how === 2 ? 2147483647 : how === 3 ? -2147483648 : 0);
  }
  return list;
}
class Holder {
  list: number[];
  readonly words: Int32Array;
  readonly bytes: Uint8Array;
  readonly halves: Int16Array;
  constructor(list: number[]) { this.list = list; this.words = Int32Array.from(list); this.bytes = Uint8Array.from(list); this.halves = Int16Array.from(list); }
  sumOfList(base: number) { let s = base; for (let i = 0; i < this.list.length; i++) s += this.list[i]!; return s; }
  sumOfWords(base: number) { let s = base; for (let i = 0; i < this.words.length; i++) s += this.words[i]!; return s; }
  sumOfBytes(base: number) { let s = base; for (let i = 0; i < this.bytes.length; i++) s += this.bytes[i]!; return s; }
  sumOfHalves(base: number) { let s = base; for (let i = 0; i < this.halves.length; i++) s += this.halves[i]! * 3; return s; }
  twoSums(base: number) { let s = base, t = 0, x = 0; for (let i = 0; i < this.words.length; i++) { s += this.words[i]!; t += this.words[i]! & 255; x ^= this.words[i]!; } return [s, t, x].join(); }
  upTo(last: number) { let s = 0; for (let i = 0; i <= last; i++) s += this.list[i]!; return s; }
  until(limit: number) { let s = 0; for (let i = 0; i < this.list.length; i++) { s += this.list[i]!; if (s > limit) break; } return s; }
}
const bases = [0, -0, 0.5, -0.25, 1e300, 2 ** 52, 2 ** 52 - 1, 2 ** 52 + 1, -(2 ** 52), 2 ** 53, NaN, Infinity, -Infinity, 1234567];
for (const n of [0, 1, 15, 16, 17, 33, 16384, 16400, 40001]) {
  for (let how = 0; how < 5; how++) {
    const holder = new Holder(integers(n, how));
    for (const base of n > 100 ? bases.slice(0, 6) : bases)
      console.log(n, how, say(base), say(holder.sumOfList(base)), say(holder.sumOfWords(base)), say(holder.sumOfBytes(base)), say(holder.sumOfHalves(base)), holder.twoSums(base));
    console.log(say(holder.upTo(n - 1)), say(holder.upTo(n)), say(holder.upTo(n - 2)), say(holder.until(1e6)));
  }
}
const others: ((list: number[], at: number) => void)[] = [
  (list, at) => { delete list[at]; }, (list, at) => { list[at] = 0.5; }, (list, at) => { list[at] = NaN; }, (list, at) => { list[at] = -0; }, (list, at) => { list[at] = 2 ** 32; },
  (list, at) => { (list as unknown[])[at] = "7"; }, (list, at) => { (list as unknown[])[at] = undefined; }, (list, at) => { (list as unknown[])[at] = null; }, (list) => { list.length += 3; },
  (list) => { for (let i = 0; i < list.length; i++) delete list[i]; },
];
for (const change of others) {
  for (const [n, at] of [[40, 0], [40, 17], [40, 39], [20000, 3], [20000, 16390], [33, 32]]) {
    const holder = new Holder(integers(n, 1));
    change(holder.list, at);
    console.log(n, at, say(holder.sumOfList(0)), say(holder.sumOfList(-0)), say(holder.upTo(n - 1)));
  }
}
