function pick(i) { return i & 1 ? 3 : 5; }
function takes(job, weight) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return job() + weight + work;
}
function many(turns, f) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let sum = f(1);
  for (let i = 0; i < turns; i++) sum = (sum + takes(() => f(2), pick(i))) | 0;
  sum = (sum + f(3)) | 0;
  return sum + work;
}
function maker(turns, base) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let total = base;
  const got = many(turns, (x) => { total = (total + x) | 0; return total; });
  total = (total + 1) | 0;
  return got * 3 + total + work;
}
console.log(maker(4, 0), maker(4, 10), maker(4, 20), maker(4, 30));
