const N = Number(process.argv[2]) || 1000;
const kept = [];
function descend(depth, f) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  kept.push(() => f(1));
  if (!depth) return work;
  const below = descend(depth - 1, (x) => f(x) + 1);
  return below + 1;
}
function maker(depth, k) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const got = descend(depth, (x) => x * k);
  return got + work;
}
console.log(maker(N, 3), kept.length, kept[0](), kept[N]());
