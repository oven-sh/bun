"use strict";
class Sub extends Array {}
let touched = 0, shared = [1, 2, 3, 4, 5];
function xor(T, a, n, r) { for (let i = 0; i < n; i++) a[i] = T[r][i] ^ i; }
function adds(T, a, n, r) { for (let i = 0; i < n; i++) T[r][i] += a[i]; }
function two(T, a, n, r) { for (let i = 0; i < n; i++) { a[i] = T[r][i]; T[r + 1][i] = a[i] - 1; } }
function sums(T, a, n, r) { let s = 0; for (let i = 0; i < n; i++) { s += T[r][i]; a[i & 3] = s; } return s; }
function mixes(T, a, n, r) { for (let i = 0; i < n; i++) T[i & 1][i] = T[r][i] + 1; }
function replaced(T, a, n, r) { let s = 0; for (let i = 0; i < n; i++) { if (i === 2) T[r] = a; s += T[r][i]; } return s; }
function cut(T, a, n, r) { let s = 0; for (let i = 0; i < n; i++) { s += T[r][i]; if (i === 1) T.length = r; } return s; }
function pushed(T, a, n, r) { let s = 0; for (let i = 0; i < n; i++) { s += T[r][i]; if (i === 1) T.push(a); } return s; }
function most(T, a, n, r) { for (let i = 0; i < n; i++) T[r][i] = Math.max(T[r - 1][i], T[r][i]); }
function least(T, a, n, r) { for (let i = 1; i < n; i++) T[r][i] = Math.min(T[r - 1][i], T[r][i - 1]) + a[i]; }
function fills(T, a, n, r) { for (let i = 0; i < n; i++) T[r][i] = i * 2; }
function halves(T, a, n, r) { for (let i = 0; i < n; i++) T[r][i] = i / 2; }
function objects(T, a, n, r) { for (let i = 0; i < n; i++) a[i] = T[r][i] + ''; }
function moves(T, a, n, r) { for (let i = 0; i < n; i++) a[i] = T[r][i]; }
function back(T, a, n, r) { for (let i = n - 1; i >= 0; i--) T[r][i] = T[r][i + 1] + a[i]; }
function arms(T, a, n, r) { for (let i = 0; i < n; i++) { if (i & 1) T[r][i] = T[r - 1][i] + 1; else a[i] = T[r][i] - 1; } }
function steps(T, a, n, r) { for (let i = 0; i < n; i++) T[r][i]++; }
function own(T, a, n, r) { for (let i = 0; i < n; i++) T[r][i] = T[r][(i + 1) % n] * 2; }
function nest(T, a, n, r) { for (let y = 0; y < 3; y++) for (let i = 0; i < n; i++) T[y][i] = T[y][i] + a[i] + y; }
function nest2(T, a, n, r) { for (let y = 1; y < 3; y++) for (let i = 0; i < n; i++) T[y][i] = a[i] === T[y - 1][i] ? T[y - 1][i] + 1 : Math.max(T[y - 1][i], T[y][i]); }
function swap(T, a, n, r) { for (let i = 0; i < n; i++) { const t = T[r][i]; T[r][i] = T[r - 1][i]; T[r - 1][i] = t; } }
function short(T, a, n, r) { let s = 0; for (let i = 0; i < n && T[r][i] < 100; i++) s += T[r][i]; return s; }
function length(T, a, n, r) { let s = 0; for (let i = 0; i < T[r].length; i++) { s += T[r][i]; a[i] = s; } return s; }
function tail(T, a, n, r) { let s = 0; for (let i = 0; i < n; i++) { const row = T[r]; s += row[i]; row[i] = s; } return s; }
function whole(T, a, n, r) { let s = 0; for (let i = 0; i < n; i++) { T[i] = [i, i, i, i, i]; s += T[r][i]; } return s; }
const functions = { least, fills, halves, objects, moves, back, arms, steps };
function show(x, depth = 0) { if (depth > 3) return "deep"; if (Array.isArray(x)) { let s = "["; for (let i = 0; i < x.length && i < 12; i++) s += (i ? "," : "") + (i in x ? show(x[i], depth + 1) : "hole"); return s + "]"; } if (ArrayBuffer.isView(x)) return "v" + x.length; return Object.is(x, -0) ? "-0" : typeof x === "object" && x ? "{}" : String(x); }
const rows = { ints: (T, a) => ([1, 2, 3, 4, 5]), doubles: (T, a) => ([0.5, 1.5, 2.5, 3.5, 4.5]), late: (T, a) => ([1, 2, 3, 4, 5.5]), mixed: (T, a) => ([1, '2', null, 4.5, undefined]), holes: (T, a) => ([1, , 3, , 5]), short: (T, a) => ([1, 2]), empty: (T, a) => ([]), frozen: (T, a) => (Object.freeze([1, 2, 3, 4, 5])), missing: (T, a) => (undefined), text: (T, a) => ('01234'), bytes: (T, a) => (new Uint8Array([250, 251, 252, 253, 254])), floats: (T, a) => (new Float64Array(5)), shared: (T, a) => (shared), far: (T, a) => ([2147483647, 2147483648, -2147483649, 1073741824, 3]), zeros: (T, a) => ([-0, 0, NaN, Infinity, 1]), table: (T, a) => (T), held: (T, a) => (a), getter: (T, a) => (Object.defineProperty([1, 2, 3, 4, 5], 2, { get() { touched++; return 8; }, set() { touched += 10; } })), like: (T, a) => ({ length: 5, 0: 1, 1: 2, 2: 3, 3: 4, 4: 5 }), valued: (T, a) => ([{ valueOf() { touched += 100; T[1] = [9, 9, 9, 9, 9]; return 3; } }, 2, 3, 4, 5]) };
const tables = { plain: (T, kept) => T, frozen: (T, kept) => Object.freeze(T), hole: (T, kept) => (delete T[1], T), getter: (T, kept) => Object.defineProperty(T, 1, { get() { touched += 1000; return kept; }, set(x) { touched += 2000; } }), proxy: (T, kept) => new Proxy(T, {}), sub: (T, kept) => Object.setPrototypeOf(T, Sub.prototype) };
let hash = 0, count = 0;
function note(s) { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; count++; }
for (const name of Object.keys(functions)) {
  let before = hash;
  for (let round = 0; round < 1; round++) for (const one of Object.keys(rows)) for (const other of ["ints", "doubles", "holes", "table", "held", "shared", "missing"]) for (const kind of Object.keys(tables)) for (const list of [0, 1, 2, 3]) {
    if (round && kind !== "plain") continue;
    touched = 0; shared = [1, 2, 3, 4, 5];
    let a = list === 1 ? [0.5, 1.5, 2.5, 3.5, 4.5] : [5, 4, 3, 2, 1];
    let T = [[7, 7, 7, 7, 7], [6, 6, 6, 6, 6], [8, 8, 8, 8, 8]];
    T[1] = rows[one](T, a); T[2] = rows[other](T, a); if (list === 2) a = T; if (list === 3) a = T[1];
    let said; let U; try { U = tables[kind](T, [3, 3, 3, 3, 3]); said = functions[name](U, a, 5, 1); } catch (e) { said = e.name; }
    const line = name + " " + one + " " + other + " " + kind + " " + list + ": " + show(said) + " " + show(T) + " " + show(a) + " " + touched;
    note(line); if (process.argv[2] === name) console.log(line);
  }
  console.log(name, hash);
}
console.log(count, hash);
