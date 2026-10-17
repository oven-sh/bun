// Values that a function with a `catch` block keeps in registers survive an exception that unwinds through several frames without `catch` blocks.
declare const console: { log(...args: unknown[]): void }
let depthToThrowAt = 0; let turns = 0
class Thrown { constructor(public n: number) {} }
function bottom(d: number): number { turns++; if (d >= depthToThrowAt) throw new Thrown(d); return d }
function none(d: number): number { return next(d + 1) + 1 }
function fewIntegers(d: number): number { const a = d * 3 + 1, b = d * 5 + 2; const r = next(d + 1); return r + a + b }
function manyIntegers(d: number): number { const a = d + 11, b = d * 2 + 12, c = d * 3 + 13, e = d * 4 + 14, f = d * 5 + 15, g = d * 6 + 16, h = d * 7 + 17, i = d * 8 + 18; const r = next(d + 1); return r + a + b + c + e + f + g + h + i }
function doubles(d: number): number { const a = d + 0.5, b = d * 1.25 + 0.25, c = d * 2.5 + 0.125, e = d / 3 + 0.75, f = d * 0.1 + 1.5; const r = next(d + 1); return r + a + b + c + e + f }
function cells(d: number): number { const a = "s" + d, b = [d, d + 1], c = { k: d }; const r = next(d + 1); return r + a.length + b.length + c.k }
function handlerElsewhere(d: number): number { let x = d; try { x += bottomless(d) } catch { x = -1 } const r = next(d + 1); return r + x }
function bottomless(d: number): number { return d & 1 }
let finallies = 0
function withFinally(d: number): number { const a = d * 9 + 1; try { return next(d + 1) + a } finally { finallies += a } }
const kinds: ((d: number) => number)[] = [none, fewIntegers, manyIntegers, doubles, cells, handlerElsewhere, manyIntegers, none, doubles, fewIntegers]
let plan: number[] = []
function next(d: number): number { return d < plan.length ? kinds[plan[d]](d) : bottom(d) }
function catcher(seed: number): string {
  const i1 = seed + 1, i2 = seed * 2 + 3, i3 = seed * 3 + 5, i4 = seed * 5 + 7, i5 = seed * 7 + 11, i6 = seed * 11 + 13, i7 = seed * 13 + 17, i8 = seed * 17 + 19
  const d1 = seed + 0.5, d2 = seed * 1.5 + 0.25, d3 = seed / 7 + 0.125, d4 = seed * 0.3 + 2.5, d5 = seed * 2.25 + 0.0625, d6 = seed / 9 + 4.5
  const s1 = "t" + seed, o1 = { v: seed * 19 + 23 }, a1 = [seed, seed + 2]
  let got = "returned "
  try { got += next(0) } catch (e) { got = e instanceof Thrown ? "caught " + e.n : "caught another" }
  return got + " | " + (i1 + i2 + i3 + i4 + i5 + i6 + i7 + i8) + " " + (d1 + d2 + d3 + d4 + d5 + d6).toFixed(6) + " " + s1 + " " + o1.v + " " + a1.join("+")
}
function five(label: string, p: number[], at: number, run: (seed: number) => string = catcher): void { plan = p; depthToThrowAt = at; const seen: string[] = []; for (let t = 0; t < 5; t++) seen.push(run(7)); console.log(label + ": " + seen[0]); console.log("   the later four are the first: " + seen.every(s => s === seen[0])) }
five("nothing between", [], 0)
five("one that keeps nothing", [0], 0)
five("one that keeps many integers", [2], 0)
five("one that keeps doubles", [3], 0)
five("all kinds, ten deep", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0)
five("the many outermost, the none innermost", [2, 3, 1, 4, 0], 0)
five("the none outermost, the many innermost", [0, 4, 1, 3, 2], 0)
five("forty deep", Array.from({ length: 40 }, (_, k) => (k * 7 + 3) % 10), 0)
five("nothing is thrown", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 1000)
kinds.push(withFinally); five("a finally in the middle", [2, 3, 10, 1, 2], 0); console.log("   finallies " + finallies)
function throughMap(d: number): number { const a = d * 21 + 1, b = d + 0.75; return [d].map(x => next(x + 1))[0] + a + b }
kinds.push(throughMap); five("a callback of map in the middle", [2, 11, 3, 2], 0)
function throughBound(d: number): number { const a = d * 23 + 1; const f = next.bind(null, d + 1); return f() + a }
kinds.push(throughBound); five("a bound function in the middle", [3, 12, 2, 1], 0)
const holder = { d: 0, get deeper(): number { return next(this.d + 1) } }
function throughGetter(d: number): number { const a = d * 29 + 1, b = d * 0.5 + 0.5; holder.d = d; return holder.deeper + a + b }
kinds.push(throughGetter); five("a getter in the middle", [2, 13, 3, 2], 0)
function nested(seed: number): string { const k1 = seed * 31 + 1, k2 = seed + 0.375; let inner = ""; try { inner = catcher(seed + 1); plan = [2, 3]; next(0) } catch (e) { inner += " / outer caught " + (e as Thrown).n } return inner + " / " + k1 + " " + k2 }
five("a catcher under a catcher", [1, 2], 0, nested)
function thin(): number { try { return next(0) } catch (e) { return -1 - (e as Thrown).n } }
function thinWithFinally(): number { try { try { return next(0) } finally { finallies++ } } catch (e) { return -1 - (e as Thrown).n } }
const thins: (() => number)[] = [thin, thinWithFinally]
function fat(seed: number): string {
  let i1 = seed + 1, i2 = seed * 2 + 3, i3 = seed * 3 + 5, i4 = seed * 5 + 7, i5 = seed * 7 + 11, i6 = seed * 11 + 13, i7 = seed * 13 + 17, i8 = seed * 17 + 19
  let d1 = seed + 0.5, d2 = seed * 1.5 + 0.25, d3 = seed / 7 + 0.125, d4 = seed * 0.3 + 2.5, d5 = seed * 2.25 + 0.0625, d6 = seed / 9 + 4.5, d7 = seed * 0.7 + 8.5, d8 = seed / 11 + 16.5
  let got = 0
  for (let k = 0; k < 6; k++) { got += thins[k & 1](); i1 += i2 & 7; i2 += i3 & 7; i3 += i4 & 7; i4 += i5 & 7; i5 += i6 & 7; i6 += i7 & 7; i7 += i8 & 7; i8 += i1 & 7; d1 += d2 * 0.5; d2 += d3 * 0.5; d3 += d4 * 0.5; d4 += d5 * 0.5; d5 += d6 * 0.5; d6 += d7 * 0.5; d7 += d8 * 0.5; d8 += d1 * 0.5 }
  return got + " | " + [i1, i2, i3, i4, i5, i6, i7, i8].join(",") + " | " + [d1, d2, d3, d4, d5, d6, d7, d8].map(x => x.toFixed(4)).join(",")
}
function fatter(seed: number): string { let a = seed * 41 + 1, b = seed * 43 + 2, c = seed + 0.0625; let s = ""; for (let k = 0; k < 2; k++) { s += fat(seed + k) + " ; "; a += b & 15; b += a & 15; c += a * 0.25 } return s + a + " " + b + " " + c }
five("a thin catcher under a fat caller, nothing between", [], 0, fat)
five("a thin catcher under a fat caller, many integers between", [2], 0, fat)
five("a thin catcher under a fat caller, doubles between", [3], 0, fat)
five("a thin catcher under a fat caller, all kinds, ten deep", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0, fat)
five("a thin catcher under a fat caller, forty deep", Array.from({ length: 40 }, (_, k) => (k * 7 + 3) % 10), 0, fat)
five("a thin catcher under two fat callers", [2, 3, 2, 3, 1, 4], 0, fatter)
async function later(d: number): Promise<number> { const a = d * 37 + 1; return next(d + 1) + a }
async function main(): Promise<void> {
  plan = [2, 3, 1]; depthToThrowAt = 0; const seen: string[] = []
  for (let t = 0; t < 5; t++) { const i1 = t * 0 + 41, d1 = 0.625, s1 = "u"; let got = ""; try { got = "fulfilled " + await later(-1) } catch (e) { got = "rejected " + (e as Thrown).n } seen.push(got + " " + i1 + " " + d1 + " " + s1) }
  console.log("an async function rejects: " + seen[0]); console.log("   the later four are the first: " + seen.every(s => s === seen[0])); console.log("turns " + turns)
}
main()
