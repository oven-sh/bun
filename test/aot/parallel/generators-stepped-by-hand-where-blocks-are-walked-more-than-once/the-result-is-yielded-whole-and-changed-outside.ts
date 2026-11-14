type Walk = Generator<number, string, number | undefined>;
function* walkOf(limit: number): Walk { let sum = 0; for (let i = 0; i < limit; i++) sum += (yield i) ?? 0; return "sum " + sum; }
function* relay(walk: Walk): Generator<IteratorResult<number, string>, string, void> { let out = ""; for (;;) { const step = walk.next(1); yield step; if (step.done) return out + "|" + step.value; out += step.value + ","; } }
let last = "";
for (let round = 0; round < 300; round++) {
  const through = relay(walkOf(4));
  let n = 0;
  for (;;) { const got = through.next(); if (got.done) { last = got.value; break; } const inner = got.value as any; if (n++ & 1) inner.value = "changed " + n; if (n === 4) inner.done = true; }
}
console.log(last);
