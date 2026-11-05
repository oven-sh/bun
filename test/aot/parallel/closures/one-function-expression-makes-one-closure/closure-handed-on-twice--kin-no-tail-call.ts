const seen = new Set();
let notes = 0;
function note(sum) {
  for (let turn = 0; turn < 2; turn++) notes += sum;
}
function countApart(first, second) {
  let sum = 0;
  for (let turn = 0; turn < 3; turn++) sum += turn;
  seen.clear();
  seen.add(first);
  seen.add(second);
  note(sum);
  return seen.size * 10 + (first === second ? 1 : 0);
}
function relay(work, open) {
  if (!open) return 0;
  const got = countApart(work, work);
  return got;
}
function main(round) {
  let total = 0;
  for (let at = 0; at < 6; at++) total += relay(() => at + round, at % 3 !== 0);
  return total;
}
let all = 0;
for (let round = 0; round < 3; round++) all += main(round);
console.log(all, notes);
