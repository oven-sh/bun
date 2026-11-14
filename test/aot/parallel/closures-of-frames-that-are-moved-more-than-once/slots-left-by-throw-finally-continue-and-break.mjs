function pick(i) { return i & 1 ? 3 : 5; }
function takes(job, weight) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return job() + weight + work;
}
function borrows(f, i) {
  let work = 0;
  for (let j = 0; j < 2; j++) work = (work + j) | 0;
  let got = 0;
  try {
    got = takes(() => f(i), pick(i));
  } finally {
    got = (got + takes(() => f(0), pick(i))) | 0;
  }
  return got + work;
}
function maker(count) {
  let work = 0;
  for (let j = 0; j < 2; j++) work = (work + j) | 0;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const t = i;
    try {
      sum = (sum + borrows((x) => { if (x && x % 3 === 0) throw t; return x + t; }, i)) | 0;
    } catch (e) {
      sum = (sum + e * 100) | 0;
      continue;
    }
    if (i > 7) break;
  }
  return sum + work;
}
console.log(maker(20));
