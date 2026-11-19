const held = new Set();
let spins = 0;
function spin() {
  for (let turn = 0; turn < 2; turn++) spins++;
}
function keep(work: any) {
  for (let turn = 0; turn < 2; turn++) spins += turn;
  held.add(work);
  spin();
  return held.size;
}
function drop(work: any) {
  for (let turn = 0; turn < 2; turn++) spins += turn;
  spin();
  return held.delete(work) ? 100 : -100;
}
function drain(count: any, stop: any, work: any) {
  let sum = 0;
  for (let at = 0; at < count; at++) {
    if (at === stop) return drop(work);
    sum += keep(work) + work(at);
  }
  return sum;
}
function main(round: any) {
  let total = 0;
  for (let at = 0; at < 4; at++) total += drain(at + 3 + round, 2, (n: any) => n + at);
  return total;
}
let all = 0;
for (let round = 0; round < 3; round++) all += main(round);
console.log(all, held.size, spins);
