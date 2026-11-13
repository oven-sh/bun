const N = Number(process.argv[2]) || 1000;
function pick(i) {
  return i & 1 ? 3 : 5;
}
function takes(wants, job, weight) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (wants) return job() + weight + work;
  return (typeof job === "function" ? weight : 0) + work;
}
function descend(depth, turns, a, b, c, d, e, g, h, k, f) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (!depth) {
    let sum = 0;
    for (let i = 0; i < turns; i++) sum = (sum + takes(i + 1 === turns, () => f(1), pick(i))) | 0;
    return sum + work;
  }
  const below = descend(depth - 1, turns, a + 1, b + 2, c + 1, d + 2, e + 1, g + 2, h + 1, k + 2, (x) => f(x) + a + b + c + d + e + g + h + k);
  return below + 1;
}
function maker(depth, turns, m) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const got = descend(depth, turns, 1, 2, 3, 4, 5, 6, 7, 8, (x) => x * m);
  return got + work;
}
console.log(maker(N, N, 3));
