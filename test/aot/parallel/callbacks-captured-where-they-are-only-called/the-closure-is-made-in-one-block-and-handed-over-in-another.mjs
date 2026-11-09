const N = Number(process.argv[2]) || 1000;
function looks(job) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return typeof job === "function" ? work : 0;
}
function descend(depth, turns, flag, f) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (!depth) {
    let sum = 0;
    for (let i = 0; i < turns; i++) {
      const k = () => f(1);
      if (flag) sum += looks(k);
    }
    return sum + work;
  }
  const below = descend(depth - 1, turns, flag, (x) => f(x) + 1);
  return below + 1;
}
function maker(depth, turns, flag, k) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const got = descend(depth, turns, flag, (x) => x * k);
  return got + work;
}
console.log(maker(N, N, JSON.parse("true"), 3));
