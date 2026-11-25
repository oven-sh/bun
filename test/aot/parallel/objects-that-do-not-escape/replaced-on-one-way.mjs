// An object that only one way out of a branch passes on is allocated on that way.
const seen = [];
class Info {
  constructor(i) {
    this.hit = false;
    this.distance = i;
    this.shape = null;
  }
}
function test(i) {
  const found = new Info(i);
  found.hit = i % 3 === 0;
  found.shape = { i };
  return found;
}
function shade(i, shadows) {
  let info = new Info(-1);
  if (shadows) info = test(i);
  if (info.hit) return info.distance;
  seen.push(info);
  return info.distance + (info.shape ? info.shape.i : 100);
}
function run(n, shadows) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let info = new Info(i);
    if (i & 1) info = test(i);
    else if (i === 4) info = null;
    if (info === null) continue;
    sum += shade(i, shadows) + info.distance;
    if (info.hit) sum += 1000;
    if (info.shape !== null) info.shape.i++;
  }
  return sum;
}
function rejects(i) {
  const info = new Info(i);
  if (i > 3) throw info;
  return info.distance;
}
console.log(run(9, true), run(9, false), run(3, true));
console.log(seen.length, seen.map(info => info.distance + ":" + info.hit + ":" + (info.shape && info.shape.i)).join(), new Set(seen).size);
for (let i = 0; i < 6; i++) {
  try {
    console.log(rejects(i));
  } catch (info) {
    console.log("caught", info.distance, info instanceof Info);
  }
}
