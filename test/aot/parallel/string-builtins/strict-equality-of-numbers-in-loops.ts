// Strict equality in loops where integers are expected and anything arrives: cases that are members of an object, array elements, results of calls, on both sides.
let next = 0;
let S: any = { A: next++, B: next++, C: next++, D: next++, E: next++, F: next++ };
const doubles = new Float64Array([0, 1, 2, 3, 1.5, -0, NaN, 4, 2147483647, 2147483648, -2147483648, 1e300]);
const values: any[] = [0, 1, 2, 3, 4, 5, 6, -1, -0, 1.5, NaN, Infinity, 2147483647, 2147483648, -2147483648, "", "0", "1", "a", 0n, 1n, 5n, null, undefined, true, false, {}, [], Symbol.iterator, () => 1, new Number(1), new String("1"), ...doubles];
const same = { x: 1 };
values.push(same, same, "long text one", "long text " + (next > 3 ? "one" : "two"));
let digest = 0;
const note = (n: number) => { digest = (Math.imul(digest, 31) + n) | 0; };
function classify(state: any): number { switch (state) { case S.A: return 1; case S.B: return 2; case S.C: return 3; case S.D: return 4; case S.E: return 5; case S.F: return 6; default: return 0; } }
function walk(list: any[], turns: number): number {
  const parser: any = { state: S.A, n: 0 };
  for (let i = 0; i < turns; i++) {
    switch (parser.state) {
      case S.A: parser.state = S.B; parser.n += 1; continue;
      case S.B: parser.state = list[i % list.length]; parser.n += 2; continue;
      case S.C: parser.state = S.D; parser.n += 3; continue;
      case S.D: parser.state = S.E; parser.n += 4; continue;
      case S.E: parser.state = S.F; parser.n += 5; continue;
      case S.F: parser.state = S.A; parser.n += 6; continue;
      default: parser.n += 100; parser.state = S.A;
    }
  }
  return parser.n;
}
function pairs(left: any[], right: any[]): number { let hits = 0; for (let i = 0; i < left.length; i++) for (let k = 0; k < right.length; k++) { if (left[i] === right[k]) hits = (Math.imul(hits, 7) + i * 64 + k) | 0; if (left[i] !== right[k]) hits = (hits + 1) | 0; } return hits; }
function numberAndAny(numbers: number[], any: any[]): number { let hits = 0; for (const n of numbers) for (const a of any) { if (n === a) hits = (Math.imul(hits, 5) + 1) | 0; const same = a === n; if (same) hits = (hits + 2) | 0; } return hits; }
function stored(list: any[]): boolean[] { const out: boolean[] = []; for (let i = 1; i < list.length; i++) out.push(list[i] === list[i - 1]); return out; }
for (let round = 0; round < 4; round++) {
  note(walk(values, 400));
  note(pairs(values, values));
  note(numberAndAny([0, 1, 2, 1.5, -0, NaN, 2147483648], values));
  for (const value of values) note(classify(value));
  note(stored(values).filter(Boolean).length);
  console.log(round, digest);
  if (round === 1) S = { A: 1.5, B: "b", C: NaN, D: -0, E: 3n, F: same };
  if (round === 2) S = { get A() { note(7); return 0; }, B: doubles[1], C: doubles[2], D: doubles[5], E: undefined, F: null };
}
console.log(walk([S.B, S.C], 50), pairs([...doubles], [0, 1, 2, 3]), classify(doubles[5]), classify(0), classify(-0), classify(null), classify(undefined));
