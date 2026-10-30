#!/usr/bin/env python3
"""many-structures-many-names.py <names>: MANY STRUCTURES x MANY NAMES: thousands of objects, each with its own random subset of <names> names in a random order; every name is read from every object through one site a name; the value says which object and which name it belongs to, so the program checks itself (a read that answers for another name or another Structure is counted), and prints a digest. Then most objects are dropped, garbage is made so that their Structures die, new ones are made, and all is read again: five rounds. With <names> above 65,536 the sites are many and the objects few: a name's number no longer fits 16 bits."""
import sys
N = int(sys.argv[1])
big = N > 2000
print('let state = 12345; function pick(n) { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; return (state >>> 8) % n; }')
print('const NAMES = []; for (let i = 0; i < %d; i++) NAMES.push("q" + i);' % N)
print('const read = [')
for i in range(N): print('o=>o.q%d,' % i, end='' if i % 12 else '\n')
print('];')
print('const write = [')
for i in range(0, N, 1 if not big else 16): print('(o,v)=>{o.q%d=v},' % i, end='' if i % 12 else '\n')
print('];')
print('''const STEP = %d;
let wrong = 0, digest = 0, serial = 0;
function make() { const o = {}; const id = ++serial; const count = 1 + pick(%d); const has = new Set(); for (let i = 0; i < count; i++) { const k = pick(NAMES.length); if (has.has(k)) continue; has.add(k); if (k %% STEP === 0 && pick(2)) write[k / STEP](o, id * 100000 + k); else o[NAMES[k]] = id * 100000 + k; } return { o, id, has }; }
function check(all, from, to) { for (const e of all) for (let k = from; k < to; k++) { const v = read[k](e.o); const want = e.has.has(k) ? e.id * 100000 + k : undefined; if (v !== want) { if (wrong++ < 5) console.log("WRONG", e.id, k, String(v), String(want)); } digest = (Math.imul(digest, 31) + (v === undefined ? 7 : v)) | 0; } }
let all = [];
for (let round = 0; round < 5; round++) {
  while (all.length < %d) all.push(make());
  check(all, 0, NAMES.length);
  for (const e of all) if (pick(3) === 0) { const ks = [...e.has]; const k = ks[pick(ks.length)]; delete e.o[NAMES[k]]; e.has.delete(k); const j = pick(NAMES.length); if (!e.has.has(j)) { e.o[NAMES[j]] = e.id * 100000 + j; e.has.add(j); } }
  check(all, 0, NAMES.length);
  console.log("round", round, all.length, wrong, digest);
  all = all.filter(() => pick(10) === 0);
  let junk = []; for (let i = 0; i < 200000; i++) junk.push({ i }); junk = [];
}
console.log("wrong", wrong, "digest", digest);''' % (1 if not big else 16, 20 if not big else 12, 3000 if not big else 24))
