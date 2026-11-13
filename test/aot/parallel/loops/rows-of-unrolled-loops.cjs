// Loops over the columns of a grid whose rows are found before the loop: by constants, and under the counter of an inner loop of a constant number of iterations. The iterations fill arrays of their own. The rows are of every kind, the same array twice, the grid itself, and change while a loop runs.
const show = v => { const seen = []; return JSON.stringify(v, (k, x) => { if (typeof x === 'object' && x) { if (seen.includes(x)) return 'seen' + seen.indexOf(x); seen.push(x); if (Array.isArray(x)) return Array.from(x, (y, i) => i in x ? y : 'hole'); if (ArrayBuffer.isView(x)) return ['view', ...x]; } return Object.is(x, -0) ? '-0' : x === undefined ? 'undefined' : typeof x === 'number' && !Number.isFinite(x) ? String(x) : typeof x === 'bigint' ? x + 'n' : x; }); };
let calls = 0; const kept = [];
class Own extends Array { }
function grid(k) { var g = [[], [], [], []]; for (var i = 0; i < 16; i++) g[i % 4][Math.floor(i / 4)] = (i * 37 + k) & 255; return g; }
function touch(s) { calls++; if (calls % 3 === 0) s[1] = [1, 2, 3, 4]; if (calls % 5 === 0) s[2][1] = "touched"; }
function columns(s, n, at) { for (var c = 0; c < 4; c++) { var a = new Array(4), b = new Array(4); for (var i = 0; i < 4; i++) { a[i] = s[i][c]; b[i] = s[i][c] & 128 ? s[i][c] << 1 ^ 283 : s[i][c] << 1; } s[0][c] = b[0] ^ a[1] ^ b[1] ^ a[2] ^ a[3]; s[1][c] = a[0] ^ b[1] ^ a[2] ^ b[2] ^ a[3]; s[2][c] = a[0] ^ a[1] ^ b[2] ^ a[3] ^ b[3]; s[3][c] = a[0] ^ b[0] ^ a[1] ^ a[2] ^ b[3]; } return s; }
function literal(s, n, at) { for (var c = 0; c < 4; c++) { var a = [0, 0, 0, 0]; for (var i = 0; i < 4; i++) a[i] = s[3 - i][c]; s[0][c] = a[0] ^ a[1]; s[3][c] = a[2] & 255 | a[3]; } return s; }
function part(s, n, at) { for (var c = 0; c < n; c++) { var a = new Array(4); for (var i = 1; i < 4; i++) a[i] = s[i][c] & 15; s[1][c] = a[1] ^ a[2]; s[2][c] ^= a[3]; if (c === at) s[0][c] = a[0] ^ 1; } return s; }
function numbers(s, n, at) { for (var c = 0; c < s[0].length; c++) { var a = new Array(4); for (var i = 0; i < 4; i++) a[i] = s[i][c] * 2; s[0][c] = a[0] + a[1]; s[2][c] = a[2] - a[3] / 4; } return s; }
function replaced(s, n, at) { for (var c = 0; c < 4; c++) { var a = new Array(4); for (var i = 0; i < 4; i++) a[i] = s[i][c]; s[0][c] = a[1] ^ a[2]; if (c === at) s[1] = [50, 60, 70, 80]; s[1][c] = a[0] ^ a[3]; } return s; }
function shrinks(s, n, at) { for (var c = 0; c < 4; c++) { var a = new Array(4); for (var i = 0; i < 4; i++) a[i] = s[i][c]; s[0][c] = a[1] ^ a[2]; if (c === at) s[2].length = 2; s[2][c] = a[0] ^ a[3]; } return s; }
function callsOut(s, n, at) { for (var c = 0; c < 4; c++) { var a = new Array(4); for (var i = 0; i < 4; i++) a[i] = s[i][c]; s[0][c] = a[1] ^ a[2]; if (c === at) touch(s); s[2][c] = a[0] ^ a[3]; } return s; }
function becomes(s, n, at) { for (var c = 0; c < 4; c++) { var a = new Array(4); for (var i = 0; i < 4; i++) a[i] = s[i][c]; if (c === at) s[1] = a; s[1][c] = a[0] ^ a[3]; s[3][c] = a[1] & 7; } return s; }
function keeps(s, n, at) { for (var c = 0; c < 4; c++) { var a = [1, 2, 3, 4]; for (var i = 0; i < 4; i++) a[i] = s[i][c] ^ 5; s[1][c] = a[0] ^ a[3]; s[3][3 - c] = a[1] & 7; kept.push(a); } return s; }
function stores(s, n, at) { for (var c = 0; c < 4; c++) { var t = 0; for (var i = 0; i < 4; i++) { t = t ^ s[i][c]; s[i][c] ^= 1; } s[0][c] = t; s[1][c] = t + 1 | 0; } return s; }
function down(s, n, at) { for (var c = 3; c >= 0; c--) { var a = new Array(4); var i = 0; while (i < 4) { a[i] = s[i][c]; i++; } s[0][c] = a[1] ^ a[2]; s[1][c + 1] = a[0] ^ a[3]; } return s; }
const kinds = {
  plain: k => [[1 + k, 2, 3, 4], [5, 6 ^ k, 7, 8], [9, 10, 11, 12], [13, 14, 15, 128 + k]],
  grid,
  'doubles': k => [[1.5, 2, 3, 4], [5, 6.25, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]],
  'one-of-doubles': k => [[1, 2, 3, 4], [5, 6, 7, 8], [9.5, 10, 11, 12], [13, 14, 15, 16]],
  'large': k => [[4294967295, 2, 3, 4], [5, 2147483648, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]],
  'texts': k => [['1', 2, 3, 4], [5, 'b', 7, 8], [9, 10, '11', 12], [13, 14, 15, 16]],
  'objects': k => [[{ valueOf() { calls++; return 3; } }, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]],
  'holes': k => [[1, , 3, 4], [5, 6, 7, 8], [9, 10, , 12], [13, 14, 15, 16]],
  'short': k => [[1, 2], [5, 6, 7, 8], [9], [13, 14, 15, 16]],
  'empty': k => [[], [], [], []],
  'missing-row': k => [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]],
  'undefined-row': k => [[1, 2, 3, 4], undefined, [9, 10, 11, 12], [13, 14, 15, 16]],
  'null-row': k => [[1, 2, 3, 4], [5, 6, 7, 8], null, [13, 14, 15, 16]],
  'number-row': k => [[1, 2, 3, 4], 7, [9, 10, 11, 12], [13, 14, 15, 16]],
  'text-row': k => [[1, 2, 3, 4], 'abcd', [9, 10, 11, 12], [13, 14, 15, 16]],
  'same-rows': k => (r => [r, r, [9, 10, 11, 12], r])([1, 2, 3, 4]),
  'two-same': k => (r => [[1, 2, 3, 4], r, [9, 10, 11, 12], r])([5, 6, 7, 8]),
  'holder-as-row': k => (g => { g[2] = g; return g; })([[1, 2, 3, 4], [5, 6, 7, 8], 0, [13, 14, 15, 16]]),
  'view-row': k => [[1, 2, 3, 4], new Uint8Array([5, 6, 7, 8]), [9, 10, 11, 12], [13, 14, 15, 16]],
  'view-of-doubles': k => [[1, 2, 3, 4], [5, 6, 7, 8], new Float64Array([9.5, 10, 11, 12]), [13, 14, 15, 16]],
  'object-row': k => [[1, 2, 3, 4], { 0: 5, 1: 6, 2: 7, 3: 8 }, [9, 10, 11, 12], [13, 14, 15, 16]],
  'frozen-row': k => [[1, 2, 3, 4], Object.freeze([5, 6, 7, 8]), [9, 10, 11, 12], [13, 14, 15, 16]],
  'sealed-row': k => [[1, 2, 3, 4], [5, 6, 7, 8], Object.seal([9, 10, 11, 12]), [13, 14, 15, 16]],
  'accessor-row': k => [[1, 2, 3, 4], Object.defineProperty([5, 6, 7, 8], '2', { get() { calls++; return 77; }, set(v) { calls += 100; } }), [9, 10, 11, 12], [13, 14, 15, 16]],
  'own-class': k => [[1, 2, 3, 4], Own.from([5, 6, 7, 8]), [9, 10, 11, 12], [13, 14, 15, 16]],
  'inherits': k => [[1, 2, 3, 4], Object.setPrototypeOf([5, , 7, 8], { 1: 66, __proto__: Array.prototype }), [9, 10, 11, 12], [13, 14, 15, 16]],
  'proxy-row': k => [[1, 2, 3, 4], new Proxy([5, 6, 7, 8], { get(t, k) { if (k === '1') calls++; return t[k]; } }), [9, 10, 11, 12], [13, 14, 15, 16]],
  'proxy-holder': k => new Proxy([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]], { get(t, k) { calls++; return t[k]; } }),
  'object-holder': k => ({ 0: [1, 2, 3, 4], 1: [5, 6, 7, 8], 2: [9, 10, 11, 12], 3: [13, 14, 15, 16] }),
  'accessor-holder': k => Object.defineProperty([[1, 2, 3, 4], 0, [9, 10, 11, 12], [13, 14, 15, 16]], '1', { get() { calls++; return [calls, 6, 7, 8]; } }),
  'frozen-holder': k => Object.freeze([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]),
  'long-rows': k => [[1, 2, 3, 4, 5, 6], [5, 6, 7, 8, 9], [9, 10, 11, 12, 13], [13, 14, 15, 16, 17]],
  'undefined-elements': k => [[1, undefined, 3, 4], [5, 6, 7, 8], [9, null, 11, 12], [13, 14, true, 16]],
  'sparse': k => (r => { r[5000] = 1; r.length = 4; return [[1, 2, 3, 4], r, [9, 10, 11, 12], [13, 14, 15, 16]]; })([5, 6, 7, 8]),
  'bigints': k => [[1n, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]],
  'minus-zero': k => [[-0, 0, -0, 1], [0, -0, 7, 8], [NaN, Infinity, 11, 12], [13, 14, 15, -0]],
};
let all = 0; const note = s => { for (let i = 0; i < s.length; i++) all = Math.imul(all, 31) + s.charCodeAt(i) | 0; console.log(s.length > 160 ? s.slice(0, 110) + s.slice(-40) : s); };
function run(f, name, make, rounds) {
  for (let k = 0; k < 5; k++) {
    let s, told;
    try { s = make(k); for (let round = 0; round < rounds; round++) f(s, 4, k); told = "done"; } catch (e) { told = e instanceof Error ? e.constructor.name : "thrown " + String(e); }
    note(f.name + " " + name + " " + k + " " + told + " " + calls + " " + show(s));
  }
}
for (const f of [columns, literal, part, numbers, replaced, shrinks, callsOut, becomes, keeps, stores, down]) {
  run(f, "plain", kinds.plain, 3); run(f, "grid", grid, 3);
  for (const name of Object.keys(kinds)) run(f, name, kinds[name], 2);
}
note(show(kept)); console.log(all);
