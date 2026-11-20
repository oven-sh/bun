"use strict";
class Sub extends Array {}
let touched: any = 0, shared: any = [1, 2, 3, 4, 5];
function xor(T: number[][], a: number[], n: number, r: number): any { for (let i = 0; i < n; i++) a[i] = T[r][i] ^ i; }
function adds(T: number[][], a: number[], n: number, r: number): any { for (let i = 0; i < n; i++) T[r][i] += a[i]; }
function two(T: number[][], a: number[], n: number, r: number): any { for (let i = 0; i < n; i++) { a[i] = T[r][i]; T[r + 1][i] = a[i] - 1; } }
function sums(T: number[][], a: number[], n: number, r: number): any { let s = 0; for (let i = 0; i < n; i++) { s += T[r][i]; a[i & 3] = s; } return s; }
function mixes(T: number[][], a: number[], n: number, r: number): any { for (let i = 0; i < n; i++) T[i & 1][i] = T[r][i] + 1; }
function replaced(T: number[][], a: number[], n: number, r: number): any { let s = 0; for (let i = 0; i < n; i++) { if (i === 2) T[r] = a; s += T[r][i]; } return s; }
function cut(T: number[][], a: number[], n: number, r: number): any { let s = 0; for (let i = 0; i < n; i++) { s += T[r][i]; if (i === 1) T.length = r; } return s; }
function pushed(T: number[][], a: number[], n: number, r: number): any { let s = 0; for (let i = 0; i < n; i++) { s += T[r][i]; if (i === 1) T.push(a); } return s; }
function most(T: number[][], a: number[], n: number, r: number): any { for (let i = 0; i < n; i++) T[r][i] = Math.max(T[r - 1][i], T[r][i]); }
function least(T: number[][], a: number[], n: number, r: number): any { for (let i = 1; i < n; i++) T[r][i] = Math.min(T[r - 1][i], T[r][i - 1]) + a[i]; }
function fills(T: number[][], a: number[], n: number, r: number): any { for (let i = 0; i < n; i++) T[r][i] = i * 2; }
function halves(T: number[][], a: number[], n: number, r: number): any { for (let i = 0; i < n; i++) T[r][i] = i / 2; }
function objects(T: number[][], a: number[], n: number, r: number): any { for (let i = 0; i < n; i++) (a as any)[i] = T[r][i] + ''; }
function moves(T: number[][], a: number[], n: number, r: number): any { for (let i = 0; i < n; i++) a[i] = T[r][i]; }
function back(T: number[][], a: number[], n: number, r: number): any { for (let i = n - 1; i >= 0; i--) T[r][i] = T[r][i + 1] + a[i]; }
function arms(T: number[][], a: number[], n: number, r: number): any { for (let i = 0; i < n; i++) { if (i & 1) T[r][i] = T[r - 1][i] + 1; else a[i] = T[r][i] - 1; } }
function steps(T: number[][], a: number[], n: number, r: number): any { for (let i = 0; i < n; i++) T[r][i]++; }
function own(T: number[][], a: number[], n: number, r: number): any { for (let i = 0; i < n; i++) T[r][i] = T[r][(i + 1) % n] * 2; }
function nest(T: number[][], a: number[], n: number, r: number): any { for (let y = 0; y < 3; y++) for (let i = 0; i < n; i++) T[y][i] = T[y][i] + a[i] + y; }
function nest2(T: number[][], a: number[], n: number, r: number): any { for (let y = 1; y < 3; y++) for (let i = 0; i < n; i++) T[y][i] = a[i] === T[y - 1][i] ? T[y - 1][i] + 1 : Math.max(T[y - 1][i], T[y][i]); }
function swap(T: number[][], a: number[], n: number, r: number): any { for (let i = 0; i < n; i++) { const t = T[r][i]; T[r][i] = T[r - 1][i]; T[r - 1][i] = t; } }
function short(T: number[][], a: number[], n: number, r: number): any { let s = 0; for (let i = 0; i < n && T[r][i] < 100; i++) s += T[r][i]; return s; }
function length(T: number[][], a: number[], n: number, r: number): any { let s = 0; for (let i = 0; i < T[r].length; i++) { s += T[r][i]; a[i] = s; } return s; }
function tail(T: number[][], a: number[], n: number, r: number): any { let s = 0; for (let i = 0; i < n; i++) { const row = T[r]; s += row[i]; row[i] = s; } return s; }
function whole(T: number[][], a: number[], n: number, r: number): any { let s = 0; for (let i = 0; i < n; i++) { T[i] = [i, i, i, i, i]; s += T[r][i]; } return s; }
const functions: any = { least, fills, halves, objects, moves, back, arms, steps };
function show(x: any, depth: any = 0): any { if (depth > 3) return "deep"; if (Array.isArray(x)) { let s = "["; for (let i = 0; i < x.length && i < 12; i++) s += (i ? "," : "") + (i in x ? show(x[i], depth + 1) : "hole"); return s + "]"; } if (ArrayBuffer.isView(x)) return "v" + (x as any).length; return Object.is(x, -0) ? "-0" : typeof x === "object" && x ? "{}" : String(x); }
const rows: any = { ints: (T: any, a: any) => ([1, 2, 3, 4, 5]), doubles: (T: any, a: any) => ([0.5, 1.5, 2.5, 3.5, 4.5]), late: (T: any, a: any) => ([1, 2, 3, 4, 5.5]), mixed: (T: any, a: any) => ([1, '2', null, 4.5, undefined]), holes: (T: any, a: any) => ([1, , 3, , 5]), short: (T: any, a: any) => ([1, 2]), empty: (T: any, a: any) => ([]), frozen: (T: any, a: any) => (Object.freeze([1, 2, 3, 4, 5])), missing: (T: any, a: any) => (undefined), text: (T: any, a: any) => ('01234'), bytes: (T: any, a: any) => (new Uint8Array([250, 251, 252, 253, 254])), floats: (T: any, a: any) => (new Float64Array(5)), shared: (T: any, a: any) => (shared), far: (T: any, a: any) => ([2147483647, 2147483648, -2147483649, 1073741824, 3]), zeros: (T: any, a: any) => ([-0, 0, NaN, Infinity, 1]), table: (T: any, a: any) => (T), held: (T: any, a: any) => (a), getter: (T: any, a: any) => (Object.defineProperty([1, 2, 3, 4, 5], 2, { get() { touched++; return 8; }, set() { touched += 10; } })), like: (T: any, a: any) => ({ length: 5, 0: 1, 1: 2, 2: 3, 3: 4, 4: 5 }), valued: (T: any, a: any) => ([{ valueOf() { touched += 100; T[1] = [9, 9, 9, 9, 9]; return 3; } }, 2, 3, 4, 5]) };
const tables: any = { plain: (T: any, kept: any) => T, frozen: (T: any, kept: any) => Object.freeze(T), hole: (T: any, kept: any) => (delete T[1], T), getter: (T: any, kept: any) => Object.defineProperty(T, 1, { get() { touched += 1000; return kept; }, set(x) { touched += 2000; } }), proxy: (T: any, kept: any) => new Proxy(T, {}), sub: (T: any, kept: any) => Object.setPrototypeOf(T, Sub.prototype) };
let hash = 0, count = 0;
function note(s: any) { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; count++; }
for (const name of Object.keys(functions)) {
  let before = hash;
  for (let round = 0; round < 1; round++) for (const one of Object.keys(rows)) for (const other of ["ints", "doubles", "holes", "table", "held", "shared", "missing"]) for (const kind of Object.keys(tables)) for (const list of [0, 1, 2, 3]) {
    if (round && kind !== "plain") continue;
    touched = 0; shared = [1, 2, 3, 4, 5];
    let a: any = list === 1 ? [0.5, 1.5, 2.5, 3.5, 4.5] : [5, 4, 3, 2, 1];
    let T: any = [[7, 7, 7, 7, 7], [6, 6, 6, 6, 6], [8, 8, 8, 8, 8]];
    T[1] = rows[one](T, a); T[2] = rows[other](T, a); if (list === 2) a = T; if (list === 3) a = T[1];
    let said: any; let U: any; try { U = tables[kind](T, [3, 3, 3, 3, 3]); said = functions[name](U, a, 5, 1); } catch (e: any) { said = e.name; }
    const line = name + " " + one + " " + other + " " + kind + " " + list + ": " + show(said) + " " + show(T) + " " + show(a) + " " + touched;
    note(line); if (process.argv[2] === name) console.log(line);
  }
  console.log(name, hash);
}
console.log(count, hash);
