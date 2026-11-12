// Outer loops that read and store around counted inner loops that only read, and counts that an inner loop steps: lists of every kind that change under the loop, lists that are one list, exits out of the inner loop.
const lists: (() => any)[] = [() => [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8], () => [0.5, 1.5, 4, 1.25, 5, 9, 2.75, 6], () => [3, , 4, 1, , 9, 2], () => [3, 1, "4", 1, null, 9], () => [], () => Object.freeze([3, 1, 4, 1, 5, 9, 2, 6]), () => new Uint8Array([3, 1, 4, 1, 5, 9, 2]), () => Object.defineProperty([3, 1, 4, 1, 5, 9], 2, { get() { return 7; }, set() { }, configurable: true }), () => [2147483647, -2147483648, 4294967295, 1, 2], () => [3, NaN, 4, -0, 5]];
const values: any[][] = [[1], [2.5, 1], ["x", 2], [undefined, 3]];
function stores(a: number[], vals: number[], n: number, T: number): any { let s = 0; for (let i = T; i < n; i++) { const x = a[i]!; for (let j = i; j > i - T; j--) s += a[j - 1]!; a[i - T] = x; s += x; } return s + vals.length; }
function fills(a: any, vals: any, n: number, T: number): any { let s = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < T; j++) s += a[j]; a[i] = vals[i % vals.length]; } return s; }
function finds(a: any, vals: any, n: number, T: number): any { let s = 0; for (let i = 0; i < n; i++) { const x = a[i]; let k = 0; for (; k < T; k++) if (a[k] === x) break; s += k; a[k] = vals[0]; } return s; }
function counts(a: any, vals: any, n: number, T: number): any { let s = 0; for (let i = 0; i < n; i++) { let c = 0; for (let j = 0; j < T; j++) if (a[j] < a[i]) c++; s += c; vals[i % 3] = c; } return s; }
function bits(a: number[], vals: number[], n: number, T: number): any { let s = 0, z = 0; for (let i = 0; i < n; i++) { for (let m = a[i]! as number; m; m &= m - 1) { s++; if (s > 60) { z = s; s = 0; } } if (i === T) vals[0] = s; } return s + "," + z; }
function halves(a: number[], vals: number[], n: number, T: number): any { let s = 0; for (let i = 0; i < n; i++) { let x = a[i]!, g = 0; while (x % 2 === 0 && g++ < 40) { x /= 2; s++; } } return s + T + vals.length; }
function deep(a: any, vals: any, n: number, T: number): any { let s = 0, c = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < T; j++) for (let k = j; k < 4; k++) if (a[k] !== a[i]) c++; s += c; if (i === 2) a[1] = vals[0]; } return s + c; }
function early(a: any, vals: any, n: number, T: number): any { let s = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < T; j++) { if (a[j] === vals[0]) return "found " + i + " " + j; s += a[j]; } a[i] = vals[i % vals.length]; } return s; }
function labels(a: any, vals: any, n: number, T: number): any { let s = 0; outer: for (let i = 0; i < n; i++) { for (let j = 0; j < T; j++) { if (a[j] === 9) continue outer; if (s > 40) break outer; s += a[j]; } a[i] = vals[0]; } return s; }
function calls(a: any, vals: any, n: number, T: number): any { let s = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < T; j++) s += a[j]; if (i === 3) change(a, vals); } return s; }
function change(a: any, vals: any): void { try { a.length = 3; a[1] = vals[0]; } catch { } }
for (let turn = 0; turn < 20; turn++) {
  const lines: string[] = [];
  for (const g of [stores, fills, finds, counts, bits, halves, deep, early, labels, calls]) for (const make of lists) for (const vals of values) for (const [n, T] of [[1, 4], [4, 4], [9, 1], [9, 3], [12, 6], [5, 0]] as [number, number][]) {
    const a = make(); let got: string; try { got = String(g(a, vals.slice(), n, T)); } catch (e) { got = (e as Error).name; }
    lines.push(g.name + " " + got + " " + Array.prototype.join.call(a) + a.length);
  }
  if (turn === 0 || turn === 19) console.log(lines.join("\n"));
}
