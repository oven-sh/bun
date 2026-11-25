const out = [];
const unseen = (x) => [x][JSON.parse("0")];
function smash(n, x) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return n ? smash(n - 1, unseen(x + work)) + 1 : x;
}
function pick(i) { return i & 1 ? 3 : 5; }
function takes(job, weight) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  job();
  return weight + work;
}
function borrows(turns, f) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const t = i;
    sum = (sum + takes(() => f(t), pick(i))) | 0;
  }
  f(100);
  return sum + work;
}
function maker(turns, base) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let total = base;
  const got = borrows(turns, async (x) => { await null; total += x; out.push(base + ":" + total); });
  return got + work;
}
function drive() { return maker(3, 0) + maker(3, 1000) + 0; }
async function main() {
  const got = drive();
  const depth = smash(300, 0);
  await null;
  await null;
  console.log(got, depth, out.join(" "));
}
main();
