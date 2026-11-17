'use strict';
const show = x => JSON.stringify(x, (k, v) => typeof v === 'bigint' ? v + 'n' : v === undefined ? 'U' : typeof v === 'number' && (v !== v || Object.is(v, -0) || v === Infinity) ? (Object.is(v, -0) ? '-0' : String(v)) : v);
const holes = r => { let h = 0; for (let i = 0; i < r.length; i++) if (!(i in r)) h++; return h; };
const contents = {
  thenOdd: (i, n) => i < n >> 1 ? i + 0.5 : [NaN, -0, undefined, null, 1n, '', 2 ** 31, -1, 0.1, 0 / 0, -(0 / 0), Infinity][i % 12],
  nanLast: (i, n) => i === n - 1 ? NaN : i + 0.5, madeNaN: i => i % 5 === 4 ? Math.sqrt(-1 - i) : i + 0.5, thenWhole: (i, n) => i < n >> 1 ? i + 0.5 : i, minusZero: i => i % 3 ? i + 0.5 : -0,
};
function copied(L) { return Array.from(new Set(L)); }
function halved(L) { return Array.from(new Map(L.map((v, i) => [i, v])).values(), v => typeof v === 'number' ? v / 2 : v); }
function grouped(L) { return Object.values(Object.groupBy(L, (v, k) => k % 3)); }
function groupedInMap(L) { return [...Map.groupBy(L, (v, k) => k % 2).values()]; }
function fromArrayLike(L) { return Array.from({ length: L.length, ...L }); }
function flat(L) { return L.flatMap((v, k) => k & 1 ? [v] : [v, v]); }
globalThis.kept = [copied, halved, grouped, groupedInMap, fromArrayLike, flat];
for (const make of globalThis.kept) for (const c in contents) {
  let line = make.name + ' ' + c;
  for (const n of [0, 1, 2, 5, 6, 7, 17, 64, 300]) { const L = []; for (let i = 0; i < n; i++) L.push(contents[c](i, n)); const r = make(L), s = show(r); line += ' ' + s.length + ':' + s.slice(-16) + ':' + holes(r); }
  console.log(line);
}
