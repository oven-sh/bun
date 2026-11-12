// Sorts with (a, b) => a - b and (a, b) => b - a beside sorts with an opaque comparator: every list must come out the same, element by element (Object.is).
const opaque: ((a: any, b: any) => number)[] = [(a, b) => { const d = a - b; return d; }, (a, b) => { const d = b - a; return d; }];
let state = 12345;
function random(): number { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; return state; }
function show(list: any[]): string {
  let text = String(list.length);
  for (let i = 0; i < list.length; i++) text += "," + (i in list ? (Object.is(list[i], -0) ? "-0" : String(list[i])) : "hole");
  return text;
}
const makers: [string, (n: number) => any[]][] = [
  ["int32", n => Array.from({ length: n }, () => random() - 0x3fffffff)],
  ["small ints", n => Array.from({ length: n }, () => random() % 50)],
  ["one value", n => Array.from({ length: n }, () => 7)],
  ["limits", n => Array.from({ length: n }, (_, i) => [2147483647, -2147483648, 0, -1, 1, 65535, -65536][(random() >> 3) % 7])],
  ["doubles", n => Array.from({ length: n }, () => random() / 1e3 - 1e6)],
  ["wide doubles", n => Array.from({ length: n }, () => (random() - 0x3fffffff) * Math.pow(10, (random() % 600) - 300))],
  ["infinities", n => Array.from({ length: n }, () => [Infinity, -Infinity, 0, 1.5, -1.5, Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE][(random() >> 4) % 8])],
  ["uint32", n => Array.from({ length: n }, () => (random() * 4) >>> 0)],
  ["mixed", n => { const a: any[] = ["x"]; a.pop(); for (let i = 0; i < n; i++) a.push(random() % 3 ? random() % 1000 : random() / 7); return a; }],
  ["ints in contiguous", n => { const a: any[] = ["x"]; a.pop(); for (let i = 0; i < n; i++) a.push(random() % 1000 - 500); return a; }],
  ["negative zero", n => Array.from({ length: n }, () => [0, -0, 1, -1, 0.5][(random() >> 2) % 5])],
  ["NaN", n => { const a: any[] = ["x"]; a.pop(); for (let i = 0; i < n; i++) a.push(i % 17 === 5 ? NaN : random() % 100); return a; }],
  ["hole", n => { const a: any[] = Array.from({ length: n }, () => random() % 1000); delete a[n >> 1]; return a; }],
  ["hole in front", n => { const a: any[] = Array.from({ length: n }, () => random() % 1000); delete a[0]; return a; }],
  ["hole in doubles", n => { const a: any[] = Array.from({ length: n }, () => random() / 3); delete a[n - 1]; return a; }],
  ["undefined", n => { const a: any[] = Array.from({ length: n }, () => random() % 1000); a[n >> 2] = undefined; return a; }],
  ["strings of digits", n => Array.from({ length: n }, () => String(random() % 1000))],
  ["one string", n => { const a: any[] = Array.from({ length: n }, () => random() % 1000); a[n - 1] = "12"; return a; }],
  ["objects with valueOf", n => Array.from({ length: n }, () => { const v = random() % 100; return { valueOf: () => v, toString: () => "o" + v }; })],
  ["bigint last", n => { const a: any[] = Array.from({ length: n }, () => random() % 1000); a[n - 1] = null; return a; }],
  ["sorted", n => Array.from({ length: n }, (_, i) => i * 3 - 100)],
  ["falling", n => Array.from({ length: n }, (_, i) => 100 - i * 3)],
];
let wrong = 0;
for (const [name, make] of makers) {
  for (const n of [2, 3, 63, 64, 65, 66, 100, 511, 512, 513, 2048]) {
    for (let direction = 0; direction < 2; direction++) {
      const list = make(n);
      const other = list.slice();
      const asked = opaque[direction];
      let first: string, second: string;
      try { const answer = direction ? list.sort((a, b) => b - a) : list.sort((a, b) => a - b); first = show(list) + (answer === list ? "" : " ANOTHER LIST"); } catch (e) { first = "throws " + (e as Error).name; }
      try { other.sort(asked); second = show(other); } catch (e) { second = "throws " + (e as Error).name; }
      if (first !== second) { wrong++; if (wrong < 20) console.log("DIFFERS", name, n, direction, "\n ", first.slice(0, 200), "\n ", second.slice(0, 200)); }
    }
  }
}
// what is not writable, what is shared, what is longer than its storage
function outcome(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).name + ": " + (e as Error).message; } }
const hundred = () => Array.from({ length: 100 }, (_, i) => (i * 37) % 101);
console.log("frozen", outcome(() => show((Object.freeze(hundred()) as number[]).sort((a, b) => a - b))));
console.log("sealed", outcome(() => show(Object.seal(hundred()).sort((a, b) => a - b)).slice(0, 40)));
console.log("not extensible", outcome(() => show(Object.preventExtensions(hundred()).sort((a, b) => b - a)).slice(0, 40)));
class Numbers extends Array<number> {}
console.log("subclass", outcome(() => { const s = Numbers.from(hundred()) as Numbers; const r = s.sort((a, b) => a - b); return show(s).slice(0, 40) + (r === s) + (r instanceof Numbers); }));
const literal = () => [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50, 69, 68, 67, 66, 65, 64, 63, 62, 61, 60];
console.log("literal", show(literal().sort((a, b) => a - b)) === show(literal().sort((a, b) => { const d = a - b; return d; })), literal()[0]);
console.log("accessor", outcome(() => { const a: number[] = hundred(); Object.defineProperty(a, 3, { get: () => 5, set() { throw new RangeError("set"); }, configurable: true }); return show(a.sort((x, y) => x - y)).slice(0, 40); }));
console.log("arguments", outcome(() => (function (...rest: number[]) { return show(rest.sort((a, b) => b - a)).slice(0, 30); }).apply(null, hundred())));
console.log("wrong", wrong);
