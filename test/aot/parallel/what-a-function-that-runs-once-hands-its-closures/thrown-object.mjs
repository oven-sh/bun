const kept = [];
function run(seed) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const box = { n: seed + work };
  try { throw { retry: () => box.n }; } catch {}
  kept.push(() => box.n + 1);
  return work;
}
console.log(run(JSON.parse("20")));
console.log(kept[0]());
