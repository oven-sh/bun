// An object literal is allocated by a stub that remembers the literal's shape weakly. Here no object of any shape is alive when the next one is made, every collection is a full one and collections never stop, so the shapes are forgotten and made again all the time. The checks of validateAOTRuntime run at the head of the operation that the stub calls when it cannot allocate: they must not let the collector run there, between the stub's look at what it remembers and the operation's.
// Env: BUN_JSC_validateAOTRuntime=1
// Env: BUN_JSC_collectContinuously=1
// Env: BUN_JSC_useGenerationalGC=0
const held = [null];
function keep(o) { held[0] = o; const n = held[0].n; held[0] = null; return n; }
const makers = [
  i => ({ n: i, a0: 1 }), i => ({ n: i, a1: 1, b1: 2 }), i => ({ n: i, a2: 1, b2: 2, c2: 3 }), i => ({ n: i, a3: 1 }),
  i => ({ n: i, a4: 1, b4: 2 }), i => ({ n: i, a5: 1, b5: 2, c5: 3 }), i => ({ n: i, a6: 1 }), i => ({ n: i, a7: 1, b7: 2 }),
  i => ({ n: i, a8: 1, b8: 2, c8: 3 }), i => ({ n: i, a9: 1 }), i => ({ n: i, a10: 1, b10: 2 }), i => ({ n: i, a11: 1, b11: 2, c11: 3 }),
  i => ({ n: i, a12: 1 }), i => ({ n: i, a13: 1, b13: 2 }), i => ({ n: i, a14: 1, b14: 2, c14: 3 }), i => ({ n: i, a15: 1 }),
];
function fill(keys, from) { const out = {}; for (let i = 0; i < keys.length; i++) out[keys[i]] = from + i; return out; }
let sum = 0;
for (let round = 0; round < 6000; round++) {
  const keys = [];
  for (let i = 0; i < 12; i++) keys.push("k" + round + "_" + i);
  for (let turn = 0; turn < 3; turn++) sum += fill(keys, turn)[keys[11]];
  for (let i = 0; i < 64; i++) sum += keep(makers[i & 15](i));
}
console.log(sum);
