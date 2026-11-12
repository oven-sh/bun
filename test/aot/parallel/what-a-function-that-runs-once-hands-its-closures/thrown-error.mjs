const kept = [];
function run(seed) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const text = "n" + (seed + work);
  try { throw new Error("no", { cause: () => text }); } catch {}
  kept.push(() => text + "!");
  return work;
}
console.log(run(JSON.parse("20")));
console.log(kept[0]());
