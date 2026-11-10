// STATISTIC: ListsAskedForBesideListsInFrontOfLoops >= 1
const rounds = Number(process.argv[2] ?? 3);
const marks = JSON.parse("[0.25, 137.25, 24.25, 161.25, 48.25, 185.25, 72.25, 209.25]");
const weights = JSON.parse("[0.5, 53.5, 106.5, 159.5, 212.5, 15.5, 68.5, 121.5]");
function tally(start) {
  let total = start & 3;
  for (let i = 0; i < marks.length; i++) {
    if (marks[i] < 100) continue;
    total += weights[i];
  }
  return total;
}
const byName = { tally };
const name = JSON.parse('"tally"');
let all = 0;
for (let round = 0; round < rounds; round++) all = (all * 31 + byName[name](round)) % 1000003;
console.log(all.toFixed(3));
