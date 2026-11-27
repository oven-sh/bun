'use strict';
const L = []; for (let i = 0; i < 70; i++) L.push(i % 7 ? i + 0.5 : 0);
const S = new Set(L), M = new Map(L.map((v, i) => [i, v]));
function fractions(x, f) { return Float64Array.from(x, f); }
function bytes(x) { return Uint8Array.from(x); }
function truthy(x) { return x.filter(Boolean); }
function kept(x) { return x.filter(v => v > 30); }
function flat(x) { return x.flatMap((v, i) => i & 1 ? [v] : [v, [i]]); }
globalThis.kept = [fractions, bytes, truthy, kept, flat];
for (let round = 0; round < 3; round++) {
  console.log(fractions(S).join().length, fractions(M.values(), (v, i) => v + i).join().slice(-20), fractions(M.keys()).length, bytes(S).join().slice(-20));
  console.log(truthy(L).length, truthy(L).slice(-3).join(), kept(L).length, JSON.stringify(flat(L)).length, truthy([0, '', null, 'a', 1.5, {}, NaN]).length);
}
