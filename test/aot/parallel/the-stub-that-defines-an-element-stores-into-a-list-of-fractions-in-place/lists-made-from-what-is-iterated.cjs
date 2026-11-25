'use strict';
const show = x => JSON.stringify(x, (k, v) => typeof v === 'bigint' ? v + 'n' : v === undefined ? 'U' : typeof v === 'number' && (v !== v || Object.is(v, -0)) ? (Object.is(v, -0) ? '-0' : String(v)) : v);
const contents = {
  whole: i => i, fractions: i => i + 0.5, wholeThenFractions: (i, n) => i < n >> 1 ? i : i + 0.25, wholeThenTexts: (i, n) => i < n >> 1 ? i : 't' + i,
  fractionsThenObjects: (i, n) => i < n >> 1 ? i + 0.5 : { i }, odd: i => [NaN, -0, undefined, null, 1n, '', 2 ** 31, -1, 0.1][i % 9],
};
const sources = {
  set: L => new Set(L), values: L => new Map(L.map((v, i) => [i, v])).values(), keys: L => new Map(L.map((v, i) => [v, i])).keys(), entries: L => new Map(L.map((v, i) => [i, v])).entries(),
  generator: L => (function* () { for (const v of L) yield v; })(),
  byHand: L => ({ [Symbol.iterator]() { let k = 0; return { next: () => k < L.length ? { done: false, value: L[k++] } : { done: true, value: undefined } }; } }),
};
function copied(S) { return Array.from(S); }
function mapped(S) { return Array.from(S, (v, k) => [v, k].length + k); }
function spread(S) { return [...S, 'x', 1.5]; }
function grouped(S) { return Object.values(Object.groupBy(S, (v, k) => k % 3)); }
globalThis.kept = [copied, mapped, spread, grouped];
for (const make of globalThis.kept) for (const c in contents) for (const s in sources) {
  let line = make.name + ' ' + c + ' ' + s;
  for (const n of [0, 1, 5, 6, 7, 17, 64, 300]) { const L = []; for (let i = 0; i < n; i++) L.push(contents[c](i, n)); const r = show(make(sources[s](L))); line += ' ' + r.length + ':' + r.slice(-14); }
  console.log(line);
}
