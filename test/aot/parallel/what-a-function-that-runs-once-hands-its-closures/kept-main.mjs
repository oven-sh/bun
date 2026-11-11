let collected = 0;
const registry = new FinalizationRegistry(() => { collected++; });
function run(seed) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const a = { n: seed + 1 }, b = { n: seed + 2 }, c = { n: seed + 3 };
  const d = { n: seed + 4 }, e = { n: seed + 5 }, f = { n: seed + 6 };
  for (const each of [a, b, c, d, e, f]) registry.register(each, 0);
  const read = () => a.n + b.n + c.n + d.n + e.n + f.n;
  return read() + work;
}
function dig(depth) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return depth > 0 ? (dig(depth - 1) + work) | 0 : 0;
}
console.log(run(1), dig(200));
for (let turn = 0; turn < 6; turn++) {
  Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 5));
}
console.log(collected >= 3);
