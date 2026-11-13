const N = Number(process.argv[2]) || 1000;
let scratch = [];
function pick(i) {
  return i & 1 ? 3 : 5;
}
function takes(wants, job, weight) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (wants) return job() + weight + work;
  return (typeof job === "function" ? weight : 0) + work;
}
function collectAndFill(salt) {
  scratch = [];
  Bun.gc(true);
  const filled = [];
  for (let i = 0; i < 20000; i++) {
    const t = i + salt;
    filled.push(() => t);
  }
  scratch = filled;
  return filled[salt % 20000]() - salt;
}
function descend(depth, turns, f) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (!depth) {
    let sum = 0;
    for (let i = 0; i < turns; i++) {
      if ((i & 255) === 1) sum = (sum + collectAndFill(i)) | 0;
      sum = (sum + takes((i & 255) === 2, () => f(1), pick(i))) | 0;
    }
    return sum + work;
  }
  const below = descend(depth - 1, turns, (x) => f(x) + depth);
  return below + 1;
}
function maker(depth, turns, k) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const got = descend(depth, turns, (x) => x * k);
  return got + work;
}
console.log(maker(64, N, 3), scratch.length);
