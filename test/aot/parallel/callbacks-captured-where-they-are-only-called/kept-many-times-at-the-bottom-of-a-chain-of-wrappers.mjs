const N = Number(process.argv[2]) || 1000;
const kept = [];
function descend(depth, keeps, f) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (!depth) {
    for (let i = 0; i < keeps; i++) kept.push(() => f(1));
    return work;
  }
  const below = descend(depth - 1, keeps, (x) => f(x) + 1);
  return below + 1;
}
function maker(depth, keeps, k) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const got = descend(depth, keeps, (x) => x * k);
  return got + work;
}
console.log(maker(N, N, 3), kept.length, kept[0](), kept[N - 1]());
