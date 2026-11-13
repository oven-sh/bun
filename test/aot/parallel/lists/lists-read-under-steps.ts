// Lists read under what the steps of keys() and entries() give: of every kind, of another length, changed on the way, with keys() of their own.
const log: string[] = [];
const show = (x: any): string => Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + Array.from(x, show).join() + "]" : typeof x === "object" && x ? "{" + show(x.v) + "}" : String(x);
function sum(L: number[], M: number[]): any { let s = 0; for (const i of L.keys()) s += L[i]!; return s; }
function other(L: number[], M: number[]): any { let s = 0; for (const i of L.keys()) s += M[i]!; return s; }
function before(L: number[], M: number[]): any { let s = 0; for (const i of L.keys()) s += L[i - 1]! + M[i + 1]!; return s; }
function stepped(L: number[], M: number[]): any { let s = 0; for (let i of L.keys()) { i += 1; s += L[i]!; i *= 2; s += M[i]!; } return s; }
function stored(L: number[], M: number[]): any { for (const i of L.keys()) L[i] = M[i]! + 1; return [L, M]; }
function grown(L: number[], M: number[]): any { let s = 0; for (const i of L.keys()) { if (i < 4) L.push(i / 2); s += L[i]!; if (i > 20) break; } return [s, L.length]; }
function cut(L: number[], M: number[]): any { let s = 0; for (const i of L.keys()) { s += L[i]!; if (i === 1) L.length = 3; } return s; }
function emptied(L: number[], M: number[]): any { let s = ""; for (const i of L.keys()) { delete L[i + 1]; s += L[i]; } return s; }
function replaced(L: number[], M: number[]): any { let s = 0; for (const i of L.keys()) { s += L[i]!; if (i === 1) L = M; } return s; }
function thrown(L: number[], M: number[]): any { let s = 0; try { for (const i of L.keys()) { s += L[i]!; if (i === 3) throw s; } } catch (e) { return ["c", e]; } return s; }
function pairs(L: number[], M: number[]): any { let s = 0; for (const [i, x] of L.entries()) s += x * L[i]! + M[i]!; return s; }
function pair(L: number[], M: number[]): any { let s = ""; for (const p of L.entries()) s += L[p[0]] === p[1]; return s; }
function defaults(L: number[], M: number[]): any { let s = 0; for (const [i = 7, x = 5] of L.entries()) s += x + L[i]!; return s; }
function nested(L: number[], M: number[]): any { let s = 0; for (const i of L.keys()) for (const k of M.keys()) s += L[i]! * M[k]!; return s; }
function keptKeys(): any { const l: any = [4, 5, 6, 7]; l.keys = () => [3, 1, 0, 9][Symbol.iterator](); l.entries = () => [[2, "p"], [0, "q"]][Symbol.iterator](); return l; }
function withGetter(): any { const l = [1, 2, 3]; let n = 0; Object.defineProperty(l, 1, { get() { n++; if (n === 2) l.push(n * 10); return n; }, configurable: true }); return l; }
const inputs: (() => any)[] = [() => [5, 3, 8, 1, 9, 2], () => [1.5, 0.5, NaN, -0], () => [1, , 3, , 5], () => [1.5, , 2.5], () => ["b", "a"], () => [1, "x", null, undefined, true], () => [], () => Object.freeze([1, 2, 3]), () => JSON.parse("[4,3.5,2]"), () => Float64Array.from([3, 1.5]), () => new Map([[0, 1], [1, 2]]), keptKeys, withGetter, () => [2147483647, 2147483648, -1], () => new (class extends Array {})(3).fill(2)];
const others: (() => any)[] = [() => [10, 20, 30, 40, 50, 60], () => [0.5, 1.5], () => ["p", "q", "r"]];
for (let turn = 0; turn < 3; turn++)
  for (const input of inputs)
    for (const run of [sum, other, before, stepped, stored, grown, cut, emptied, replaced, thrown, pairs, pair, defaults, nested]) {
      let said: string;
      const list = input();
      try { said = show(run(list, turn === 2 ? list : others[turn]!())); } catch (e) { said = "!" + (e as any).constructor.name; }
      console.log(run.name, said.slice(0, 120), log.join());
    }
