const depth = 1500, turns = 1000000;
function pick(i) {
  return i & 1 ? 3 : 5;
}
function takes(wants, job, weight) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (wants) return job() + weight + work;
  return (typeof job === "function" ? weight : 0) + work;
}
function descend(depth, turns, f) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (!depth) {
    let sum = 0;
    for (let i = 0; i < turns; i++) sum = (sum + takes(i + 1 === turns, () => f(1), pick(i))) | 0;
    return sum + work;
  }
  const below = descend(depth - 1, turns, (x) => f(x) + 1);
  return below + 1;
}
function maker(depth, turns, k) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const got = descend(depth, turns, (x) => x * k);
  return got + work;
}
console.log(maker(depth, turns, 3));
