// Under: --aot-harden=proof-checks: under that word the lookup in front of the loop is made again in the turn and the two answers are compared: NaN is no equal of itself, and no stop either.
const N = (text: string): number => JSON.parse(text);
const rates = new Map<string, number>([["a", NaN], ["b", 0.5], ["z", -0]]);
function sum(m: Map<string, number>, k: string, n: number) { let s = 0, holes = 0; for (let i = 0; i < n; i++) { const r = m.get(k); if (r !== r) holes++; else s += r ?? 100; } return s + ":" + holes; }
function marks(m: Map<number, unknown>, k: number, n: number) { let said = ""; for (let i = 0; i < n; i++) said += typeof m.get(k) + Object.is(m.get(k), NaN) + ","; return said; }
console.log(sum(rates, "a", N("4")), sum(rates, "b", N("4")), sum(rates, "c", N("2")), 1 / Number(sum(rates, "z", N("1")).split(":")[0]));
console.log(marks(new Map<number, unknown>([[1, NaN], [2, "x"], [3, {}]]), 1, N("2")), marks(new Map<number, unknown>([[1, NaN], [2, "x"]]), 2, N("2")), marks(new Map<number, unknown>(), 3, N("1")));
